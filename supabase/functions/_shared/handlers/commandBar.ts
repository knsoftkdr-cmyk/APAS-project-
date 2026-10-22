// supabase/functions/_shared/handlers/commandBar.ts
//
// AI COMMAND BAR (server side). Not a standalone edge function (deployment limit): `ai-teacher-assistant`
// routes to it via action "command_bar" - see _shared/mergedRouter.ts. The anchor's original behaviour (a body
// without a matching `action`) is untouched.
//
// Body:  { action: "command_bar", text?: string, intent_id?: string, params?: {class?,section?,subject?}, local_date?: "YYYY-MM-DD" }
//
// SECURITY MODEL
//   * Authenticated with the caller's own JWT. The role and school(s) are read from `profiles` (and
//     `school_admin_schools`) here - the body carries no role, user id or school id and none is accepted.
//   * Every read uses the CALLER'S client (anon key + their Authorization header), so Row Level Security still
//     applies. The service-role key is not used anywhere in this file. Reads are additionally filtered to the
//     caller's own school(s) / classes / children, because RLS on several tables is not school-scoped.
//   * The model (Gemini, via _shared/aiClient.ts) only ever picks an intent id from the role's allowlist; it
//     sees the typed sentence and the intent list - never database content. Its output is validated
//     (commandModel.validateAiPick). It cannot write SQL, choose a table, a route, or a record.
//   * Read-only: this handler performs NO writes. Actions only return a PREVIEW; nothing is created, changed,
//     sent or deleted here.
//   * Errors returned to the browser are generic; database messages are logged server-side only.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAi, getAiConfig } from "../aiClient.ts";
import { corsHeaders, json } from "../learningGroupsData.ts";
import {
  classKey, classLabel, tokenize,
  AI_SYSTEM_PROMPT, INTENT_BY_ID, buildAiPrompt, cleanCommand, extractParams, intentAllowedFor, intentsForRole,
  monthStart, parseAiJson, resolveRules, resolveToday, routeFor, sanitizeParams, validateAiPick,
  type CommandParams, type IntentDef, type Resolution,
} from "../commandModel.ts";

type Row = Record<string, any>;

const AI_TIMEOUT_MS = 9000;
const STATUSES = ["present", "absent", "late", "half_day", "excused"] as const;
const STATUS_LABEL: Record<string, string> = { present: "Present", absent: "Absent", late: "Late", half_day: "Half day", excused: "Excused" };

interface Ctx {
  uc: any;               // the caller's own (RLS-bound) client
  userId: string;
  role: string;
  schoolIds: string[];
  today: string;
}

export interface CommandResponse {
  status: "answer" | "navigate" | "preview" | "clarify" | "unsupported" | "forbidden" | "none" | "client" | "error";
  intent?: { id: string; kind: string; label: string };
  interpreted_by?: "rules" | "ai";
  message: string;
  facts?: { label: string; value: string }[];
  rows?: { title: string; subtitle?: string; route?: string }[];
  note?: string;
  links?: { label: string; route: string }[];
  route?: string;
  preview?: {
    title: string;
    lines: { label: string; value: string }[];
    consequences: string[];
    handoff?: { label: string; route: string };
  };
  followUp?: { question: string; options: { label: string; intent_id: string; params?: CommandParams }[] };
  params?: CommandParams;
  suggestions?: { label: string; route?: string; text?: string }[];
}

const ok = (body: CommandResponse) => json(body, 200);
const intentInfo = (d: IntentDef) => ({ id: d.id, kind: d.kind, label: d.label });
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// ───────────────────────────────────────────── entry point ─────────────────────────────────────────────

export async function handleCommandBar(req: Request): Promise<Response> {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization", code: "unauthenticated" }, 401);

    const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await uc.auth.getUser();
    if (authErr || !user) return json({ error: "Your session has expired. Please sign in again.", code: "unauthenticated" }, 401);

    let body: Row;
    try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }

    // Identity and scope come from the database, never from the request.
    const { data: profile } = await uc.from("profiles").select("role, school_id").eq("id", user.id).maybeSingle();
    if (!profile?.role) return json({ error: "Not permitted" }, 403);
    const role: string = profile.role;

    const schoolSet = new Set<string>();
    if (profile.school_id) schoolSet.add(profile.school_id);
    const { data: extra } = await uc.from("school_admin_schools").select("school_id").eq("school_admin_id", user.id);
    for (const r of extra ?? []) if (r?.school_id) schoolSet.add(r.school_id);

    const ctx: Ctx = { uc, userId: user.id, role, schoolIds: [...schoolSet], today: resolveToday(body.local_date) };

    const text = cleanCommand(body.text);
    const hint = typeof body.intent_id === "string" ? INTENT_BY_ID[body.intent_id] : undefined;
    if (!text && !hint) return json({ error: "Type a command first." }, 400);

    // 1. Resolve: a valid, role-allowed hint (a button the user clicked) -> rules -> AI fallback.
    let resolution: Resolution;
    if (hint && intentAllowedFor(hint, role)) {
      const params = { ...extractParams(text), ...sanitizeParams(body.params) };
      resolution = { status: "matched", intent: hint, params, source: "rules", confidence: 1 };
    } else {
      resolution = resolveRules(text, role);
      if (resolution.status === "none" && text) resolution = await resolveWithAi(text, role);
    }

    return ok(await respond(ctx, resolution, text));
  } catch (e) {
    console.error("[command_bar] unexpected error:", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}

// ───────────────────────────────────────────── AI fallback ─────────────────────────────────────────────

async function resolveWithAi(text: string, role: string): Promise<Resolution> {
  try {
    const cfg = getAiConfig();
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ai timeout")), AI_TIMEOUT_MS));
    const { text: out } = await Promise.race([
      callAi(cfg, buildAiPrompt(text, role), { system: AI_SYSTEM_PROMPT, temperature: 0, maxOutputTokens: 256 }),
      timeout,
    ]);
    return validateAiPick(parseAiJson(out), role, text);
  } catch (e) {
    // No key, provider down, timeout: degrade to "couldn't understand" - rules-based commands keep working.
    console.error("[command_bar] AI interpretation unavailable:", e instanceof Error ? e.message : e);
    return { status: "none", unavailable: true } as Resolution;
  }
}

// ───────────────────────────────────────────── dispatch ─────────────────────────────────────────────

async function respond(ctx: Ctx, r: Resolution, text: string): Promise<CommandResponse> {
  if (r.status === "forbidden") {
    return { status: "forbidden", message: "That command isn't available for your account.", suggestions: suggestionsFor(ctx.role) };
  }
  if (r.status === "ambiguous") {
    return {
      status: "clarify",
      message: "I found more than one thing you might mean.",
      followUp: { question: "Which one did you mean?", options: r.candidates.map((c) => ({ label: c.label, intent_id: c.id })) },
    };
  }
  if (r.status === "none") {
    const unavailable = (r as any).unavailable === true;
    return {
      status: "none",
      message: unavailable
        ? "I couldn't interpret that right now. Try one of these, or open a module from the menu."
        : "I didn't understand that. Here are some things I can do.",
      suggestions: suggestionsFor(ctx.role),
    };
  }

  const def = r.intent;
  const base = { intent: intentInfo(def), interpreted_by: r.source, params: r.params };

  if (def.handler === "client") return { ...base, status: "client", message: "" };

  if (def.kind === "navigate") {
    const route = routeFor(def, ctx.role);
    if (!route) return { ...base, status: "none", message: "That page isn't available for your account." };
    return { ...base, status: "navigate", route, message: `Opening ${def.label}.` };
  }

  if (def.kind === "unsupported") {
    const alt = routeFor(def, ctx.role, "alt");
    return {
      ...base, status: "unsupported", message: def.unsupportedReason ?? "I can't do that from here yet.",
      links: alt ? [{ label: `Open ${altLabel(alt)}`, route: alt }] : [],
    };
  }

  try {
    const out = await runIntent(ctx, def, r.params, text);
    return { ...base, ...out } as CommandResponse;
  } catch (e) {
    console.error(`[command_bar] ${def.id} failed:`, e instanceof Error ? e.message : e);
    const page = INFO_PAGE[def.id];
    return {
      ...base, status: "error",
      message: `I couldn't retrieve that right now. Please try again${page ? ` or open the ${page.label} page` : ""}.`,
      links: page ? [{ label: `Open ${page.label}`, route: page.route }] : [],
    };
  }
}

function altLabel(route: string): string {
  const map: Record<string, string> = {
    "/item-bank": "the assessment hub", "/timetable": "the timetable", "/ai-tutor": "the AI tutor",
    "/teacher-communication": "communication", "/admin-communication": "communication",
  };
  return map[route.split("?")[0]] ?? "the page";
}

function suggestionsFor(role: string) {
  return intentsForRole(role)
    .filter((i) => i.kind !== "unsupported" && i.example)
    .slice(0, 6)
    .map((i) => ({ label: i.example, text: i.example }));
}

const INFO_PAGE: Record<string, { label: string; route: string }> = {
  "info.attendance_today": { label: "Attendance", route: "/attendance" },
  "info.attendance_mine": { label: "Attendance", route: "/attendance" },
  "info.homework_pending": { label: "Homework", route: "/dashboard" },
  "info.exams_upcoming": { label: "Exams", route: "/my-exams" },
  "info.exam_results_latest": { label: "Exams", route: "/my-exams" },
  "info.admissions_pending": { label: "Admissions", route: "/admissions" },
  "info.schools_count": { label: "School management", route: "/knsoft-admin" },
};

async function runIntent(ctx: Ctx, def: IntentDef, params: CommandParams, text: string): Promise<Partial<CommandResponse>> {
  switch (def.id) {
    case "info.attendance_today": return attendanceToday(ctx);
    case "info.attendance_mine": return attendanceMine(ctx);
    case "info.homework_pending": return homeworkPending(ctx);
    case "info.exams_upcoming": return examsUpcoming(ctx);
    case "info.exam_results_latest": return examResultsLatest(ctx);
    case "info.admissions_pending": return admissionsPending(ctx);
    case "info.schools_count": return schoolsCount(ctx);
    case "action.create_homework": return createHomeworkPreview(ctx, def, params, text);
    default:
      return { status: "unsupported", message: "I can't do that from here yet." };
  }
}

const fail = (label: string, error: any): never => { throw new Error(`${label}: ${error?.message ?? "query failed"}`); };

// ───────────────────────────────────────────── information executors (read-only) ─────────────────────────────────────────────

async function statusCounts(ctx: Ctx, build: (q: any) => any): Promise<Record<string, number>> {
  const results = await Promise.all(STATUSES.map(async (st) => {
    const q = build(ctx.uc.from("attendance_records").select("id", { count: "exact", head: true }).eq("status", st));
    const { count, error } = await q;
    if (error) fail("attendance_records", error);
    return [st, count ?? 0] as const;
  }));
  return Object.fromEntries(results);
}

async function attendanceToday(ctx: Ctx): Promise<Partial<CommandResponse>> {
  if (ctx.schoolIds.length === 0) return { status: "answer", message: "Your account isn't linked to a school, so there is no attendance to show." };

  let classIds: string[] | null = null;
  if (ctx.role === "teacher") {
    const { data, error } = await ctx.uc.from("class_teachers").select("class_id").eq("teacher_id", ctx.userId);
    if (error) fail("class_teachers", error);
    classIds = [...new Set<string>((data ?? []).map((r: Row) => r.class_id))];
    if (classIds.length === 0) return { status: "answer", message: "You aren't assigned to any classes yet, so there is no attendance to show." };
  }

  const counts = await statusCounts(ctx, (q) => {
    let b = q.in("school_id", ctx.schoolIds).eq("date", ctx.today);
    if (classIds) b = b.in("class_id", classIds);
    return b;
  });
  const total = STATUSES.reduce((n, s) => n + counts[s], 0);
  const scope = classIds ? "across your classes" : "across your school";
  const links = [{ label: "Open Attendance", route: "/attendance" }];

  if (total === 0) {
    return { status: "answer", message: `No attendance has been marked yet today ${scope}.`, links };
  }
  const absent = counts.absent;
  return {
    status: "answer",
    message: `Today, ${plural(absent, "student")} ${absent === 1 ? "is" : "are"} marked absent ${scope}.`,
    facts: STATUSES.filter((s) => counts[s] > 0 || s === "present" || s === "absent").map((s) => ({ label: STATUS_LABEL[s], value: String(counts[s]) })),
    note: `Based on ${plural(total, "attendance record")} marked so far today. Classes that haven't marked attendance yet aren't counted.`,
    links,
  };
}

async function studentRows(ctx: Ctx): Promise<{ id: string; name: string }[]> {
  if (ctx.role === "student") {
    const { data, error } = await ctx.uc.from("students").select("id, full_name").eq("profile_id", ctx.userId).maybeSingle();
    if (error) fail("students", error);
    return data ? [{ id: data.id, name: data.full_name ?? "You" }] : [];
  }
  // parent: only children linked to THIS authenticated parent (parent_students.student_id is the child's profile id)
  const { data: links, error } = await ctx.uc.from("parent_students").select("student_id").eq("parent_id", ctx.userId);
  if (error) fail("parent_students", error);
  const profileIds = [...new Set<string>((links ?? []).map((l: Row) => l.student_id).filter(Boolean))].slice(0, 6);
  if (profileIds.length === 0) return [];
  const { data: kids, error: kErr } = await ctx.uc.from("students").select("id, full_name, profile_id").in("profile_id", profileIds);
  if (kErr) fail("students", kErr);
  // Links exist but none of the child records are readable (RLS): say "couldn't retrieve", not "no children linked".
  if ((kids ?? []).length === 0) fail("students", { message: "linked children not readable" });
  return (kids ?? []).map((k: Row) => ({ id: k.id, name: k.full_name ?? "Your child" }));
}

async function attendanceMine(ctx: Ctx): Promise<Partial<CommandResponse>> {
  const links = [{ label: "Open Attendance", route: "/attendance" }];
  if (ctx.schoolIds.length === 0) return { status: "answer", message: "Your account isn't linked to a school, so there is no attendance to show." };
  const kids = await studentRows(ctx);
  if (kids.length === 0) {
    return { status: "answer", message: ctx.role === "parent" ? "No children are linked to your account yet." : "I couldn't find your student record.", links };
  }
  const start = monthStart(ctx.today);
  const per = await Promise.all(kids.map(async (k) => ({
    k,
    counts: await statusCounts(ctx, (q) => q.in("school_id", ctx.schoolIds).eq("student_id", k.id).gte("date", start).lte("date", ctx.today)),
  })));
  const summary = (c: Record<string, number>) => STATUSES.filter((s) => c[s] > 0).map((s) => `${STATUS_LABEL[s]} ${c[s]}`).join(" · ");
  const totalAll = per.reduce((n, p) => n + STATUSES.reduce((m, s) => m + p.counts[s], 0), 0);
  if (totalAll === 0) return { status: "answer", message: "No attendance has been recorded for this month yet.", links };

  if (ctx.role === "student") {
    const c = per[0].counts;
    return {
      status: "answer",
      message: `This month you're marked absent ${plural(c.absent, "day")} and late ${plural(c.late, "day")}.`,
      facts: STATUSES.filter((s) => c[s] > 0 || s === "present" || s === "absent").map((s) => ({ label: STATUS_LABEL[s], value: String(c[s]) })),
      note: "Counts are for this calendar month so far.", links,
    };
  }
  return {
    status: "answer",
    message: per.length === 1 ? `Here is ${per[0].k.name}'s attendance for this month.` : "Here is your children's attendance for this month.",
    rows: per.map((p) => ({ title: p.k.name, subtitle: summary(p.counts) || "No records yet" })),
    note: "Counts are for this calendar month so far.", links,
  };
}

async function homeworkPending(ctx: Ctx): Promise<Partial<CommandResponse>> {
  const links = [{ label: "Open Homework", route: "/dashboard" }];
  const me = (await studentRows(ctx))[0];
  if (!me) return { status: "answer", message: "I couldn't find your student record.", links };

  const { data: cs, error: csErr } = await ctx.uc.from("class_students").select("class_id").eq("student_id", me.id).limit(3);
  if (csErr) fail("class_students", csErr);
  const classIds = [...new Set<string>((cs ?? []).map((r: Row) => r.class_id))];
  if (classIds.length === 0) return { status: "answer", message: "You aren't in a class yet, so no homework is assigned.", links };
  const { data: classes, error: cErr } = await ctx.uc.from("classes").select("name, section").in("id", classIds);
  if (cErr) fail("classes", cErr);

  const assignments: Row[] = [];
  for (const c of classes ?? []) {
    const { data, error } = await ctx.uc.from("homework_assignments")
      .select("id, title, subject, created_at")
      .eq("class_level", c.name).eq("section", c.section).eq("status", "active")
      .order("created_at", { ascending: false }).limit(50);
    if (error) fail("homework_assignments", error);
    assignments.push(...(data ?? []));
  }
  if (assignments.length === 0) return { status: "answer", message: "No homework is assigned to your class right now.", links };

  const { data: subs, error: sErr } = await ctx.uc.from("homework_submissions").select("assignment_id")
    .eq("student_id", ctx.userId).in("assignment_id", assignments.map((a) => a.id));
  if (sErr) fail("homework_submissions", sErr);
  const done = new Set((subs ?? []).map((s: Row) => s.assignment_id));
  const pending = assignments.filter((a) => !done.has(a.id));

  return {
    status: "answer",
    message: pending.length === 0 ? "You've submitted all the homework assigned to your class." : `You have ${plural(pending.length, "homework assignment")} not yet submitted.`,
    rows: pending.slice(0, 5).map((a) => ({
      title: a.title ?? "Homework",
      subtitle: [a.subject, a.created_at ? `assigned ${String(a.created_at).slice(0, 10)}` : null].filter(Boolean).join(" · "),
    })),
    note: "APAS doesn't record a due date for homework, so this lists everything not yet submitted rather than what is due on a given day.",
    links,
  };
}

async function examsUpcoming(ctx: Ctx): Promise<Partial<CommandResponse>> {
  const isStudent = ctx.role === "student";
  let q = ctx.uc.from("generated_assessment_paper_assignments")
    .select("id, title, due_at").eq("status", "active").gte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true }).limit(5);
  if (!isStudent) q = q.eq("assigned_by", ctx.userId); // staff: the ones THEY assigned (RLS lets all staff read all schools' rows)
  const { data, error } = await q;
  if (error) fail("generated_assessment_paper_assignments", error);
  const links = [{ label: isStudent ? "Open My Exams" : "Open Assessment hub", route: isStudent ? "/my-exams" : "/item-bank" }];
  const rows: Row[] = data ?? [];
  if (rows.length === 0) return { status: "answer", message: "There are no upcoming exams with a due date.", links };
  return {
    status: "answer",
    message: `You have ${plural(rows.length, "upcoming exam")}${isStudent ? "" : " that you assigned"}.`,
    rows: rows.map((r) => ({
      title: r.title,
      subtitle: `Due ${new Date(r.due_at).toISOString().slice(0, 10)}`,
      route: isStudent ? `/exam/${r.id}` : undefined,
    })),
    note: "Only exams with a due date are listed.", links,
  };
}

async function examResultsLatest(ctx: Ctx): Promise<Partial<CommandResponse>> {
  const links = [{ label: "Open My Exams", route: "/my-exams" }];
  const me = (await studentRows(ctx))[0];
  if (!me) return { status: "answer", message: "I couldn't find your student record.", links };
  const { data, error } = await ctx.uc.from("generated_assessment_paper_attempts")
    .select("assignment_id, total_score, total_max_marks, graded_at")
    .eq("student_id", me.id).eq("status", "graded").order("graded_at", { ascending: false }).limit(5);
  if (error) fail("generated_assessment_paper_attempts", error);
  const attempts: Row[] = data ?? [];
  if (attempts.length === 0) return { status: "answer", message: "You don't have any graded exams yet.", links };
  const { data: titles, error: tErr } = await ctx.uc.from("generated_assessment_paper_assignments").select("id, title").in("id", attempts.map((a) => a.assignment_id));
  if (tErr) fail("generated_assessment_paper_assignments", tErr);
  const titleOf = new Map((titles ?? []).map((t: Row) => [t.id, t.title]));
  const fmt = (a: Row) => (a.total_score == null ? "Score not available" : `${Number(a.total_score)}/${Number(a.total_max_marks)}`);
  const latest = attempts[0];
  return {
    status: "answer",
    message: `Your latest graded exam is ${titleOf.get(latest.assignment_id) ?? "an exam"}: ${fmt(latest)}.`,
    rows: attempts.map((a) => ({ title: String(titleOf.get(a.assignment_id) ?? "Exam"), subtitle: `${fmt(a)}${a.graded_at ? ` · graded ${String(a.graded_at).slice(0, 10)}` : ""}` })),
    links,
  };
}

async function admissionsPending(ctx: Ctx): Promise<Partial<CommandResponse>> {
  const links = [{ label: "Open Admissions", route: "/admissions" }];
  if (ctx.schoolIds.length === 0) return { status: "answer", message: "Your account isn't linked to a school.", links };
  const { count, error } = await ctx.uc.from("admission_applicants").select("id", { count: "exact", head: true })
    .in("school_id", ctx.schoolIds).eq("status", "under_review");
  if (error) fail("admission_applicants", error);
  const n = count ?? 0;
  return {
    status: "answer",
    message: n === 0 ? "There are no admission applications under review." : `${plural(n, "admission application")} ${n === 1 ? "is" : "are"} under review.`,
    note: "\"Pending\" means applications with the status Under review.", links,
  };
}

async function schoolsCount(ctx: Ctx): Promise<Partial<CommandResponse>> {
  if (ctx.role !== "knsoft_admin") return { status: "forbidden", message: "That command isn't available for your account." }; // belt and braces
  const [{ count, error }, { data, error: lErr }] = await Promise.all([
    ctx.uc.from("schools").select("id", { count: "exact", head: true }),
    ctx.uc.from("schools").select("name").order("name", { ascending: true }).limit(8),
  ]);
  if (error) fail("schools", error);
  if (lErr) fail("schools", lErr);
  const n = count ?? 0;
  return {
    status: "answer",
    message: `${plural(n, "school")} ${n === 1 ? "is" : "are"} registered on the platform.`,
    rows: (data ?? []).map((s: Row) => ({ title: s.name })),
    note: n > 8 ? `Showing the first 8 of ${n}.` : undefined,
    links: [{ label: "Open School management", route: "/knsoft-admin" }],
  };
}

// ───────────────────────────────────────────── action preview (NO writes) ─────────────────────────────────────────────

async function createHomeworkPreview(ctx: Ctx, def: IntentDef, params: CommandParams, text: string): Promise<Partial<CommandResponse>> {
  // The classes this person may create homework for: a teacher's assigned classes; school staff: their school's.
  type C = { id: string; name: string; section: string };
  let classes: C[] = [];
  if (ctx.role === "teacher" || ctx.role === "hod") {
    const { data: ct, error } = await ctx.uc.from("class_teachers").select("class_id").eq("teacher_id", ctx.userId);
    if (error) fail("class_teachers", error);
    const ids = [...new Set<string>((ct ?? []).map((r: Row) => r.class_id))];
    if (ids.length) {
      const { data, error: cErr } = await ctx.uc.from("classes").select("id, name, section").in("id", ids);
      if (cErr) fail("classes", cErr);
      classes = data ?? [];
    }
  } else {
    const { data, error } = await ctx.uc.rpc("my_school_classes");
    if (error) fail("my_school_classes", error);
    classes = (data ?? []).map((c: Row) => ({ id: c.id, name: c.name, section: c.section }));
  }
  classes.sort((a, b) => (a.name + a.section).localeCompare(b.name + b.section, undefined, { numeric: true }));
  if (classes.length === 0) {
    return { status: "answer", message: ctx.role === "teacher" || ctx.role === "hod" ? "You aren't assigned to any classes, so I can't prepare homework." : "I couldn't find any classes for your school." };
  }

  // Buttons carry the class id. The id is re-checked below against THIS caller's list, so it cannot select anyone else's class.
  const options = (list: C[]) => list.slice(0, 12).map((c) => ({ label: classLabel(c), intent_id: def.id, params: { class_id: c.id, ...(params.subject ? { subject: params.subject } : {}) } }));

  let matches: C[] = [];
  if (params.class_id) {
    matches = classes.filter((c) => c.id === params.class_id);
    if (matches.length === 0) return { status: "answer", message: "I couldn't find that class among the classes you can create homework for." };
  } else if (params.class) {
    // "class 1" must match a class stored as "1", "01", "1st" or "Class 1".
    const byClass = classes.filter((c) => classKey(c.name) === params.class);
    if (byClass.length === 0) {
      return { status: "clarify", message: `I couldn't find Class ${params.class} among your classes.`, followUp: { question: "Which class did you mean?", options: options(classes) } };
    }
    matches = params.section ? byClass.filter((c) => String(c.section).trim().toUpperCase() === params.section) : byClass;
    if (matches.length === 0) {
      return { status: "clarify", message: `I couldn't find section ${params.section} of Class ${params.class}.`, followUp: { question: `Which section of Class ${params.class}?`, options: options(byClass) } };
    }
  } else {
    // Non-numeric names the person may have typed: "nursery", "lkg".
    const words = new Set(tokenize(text));
    const named = classes.filter((c) => { const k = classKey(c.name); return k.length >= 2 && !/^\d+$/.test(k) && words.has(k); });
    if (named.length > 0) matches = params.section ? named.filter((c) => String(c.section).trim().toUpperCase() === params.section) : named;
  }

  // Never guess the target: ask.
  if (matches.length === 0) {
    return { status: "clarify", message: "I can prepare a homework draft.", followUp: { question: "Which class should I create the homework for?", options: options(classes) } };
  }
  if (matches.length > 1) {
    return { status: "clarify", message: "That class has more than one section.", followUp: { question: "Which section did you mean?", options: options(matches) } };
  }

  const target = matches[0];
  const route = routeFor(def, ctx.role) ?? "/adaptive-homework/generate";
  return {
    status: "preview",
    message: "Here's the draft. Nothing has been created.",
    preview: {
      title: "Create homework",
      lines: [
        { label: "Class", value: classLabel(target) },
        { label: "Subject", value: params.subject ? params.subject[0].toUpperCase() + params.subject.slice(1) : "Not set - choose in the generator" },
        { label: "Title, instructions and questions", value: "Created in the homework generator" },
      ],
      consequences: [
        "Nothing is saved or sent to students by the command bar.",
        "The existing homework generator creates the assignment from your syllabus; you review and assign it there.",
        "The class and subject above are not carried over automatically - pick them again in the generator.",
      ],
      handoff: { label: "Open homework generator", route },
    },
  };
}
