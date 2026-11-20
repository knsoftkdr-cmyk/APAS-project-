// supabase/functions/_shared/teacherAgentData.ts
//
// Read-only data look-ups for the teacher APAS Agent (extract-lesson-intent): "which students haven't submitted
// homework?", "how many worksheets are pending?", "who is absent today?", "any doubts?", "my appointments"...
//
// SECURITY: every query runs with the TEACHER'S OWN session (a Supabase client built from their JWT), so Row Level
// Security applies exactly as on the pages they open - the agent can never see more than the teacher already can.
// Nothing here writes. Each topic is isolated: a missing table / column only fails that topic, never the chat.
//
// Each look-up returns small, plain facts (names, counts, dates) that the model turns into a short spoken answer.

// deno-lint-ignore-file no-explicit-any
type Db = any;

export const TEACHER_DATA_TOPICS = [
  "overview",          // everything pending today, in one go
  "homework",          // homework: who has / hasn't submitted, awaiting evaluation
  "worksheets",        // worksheet submissions waiting for review
  "attendance",        // today's attendance: classes not marked, absent / late students
  "doubts",            // open student doubts
  "appointments",      // upcoming parent appointments
  "interventions",     // active interventions / at-risk follow-ups
  "calendar",          // upcoming exams, homework deadlines, events (next 2 weeks)
  "assessments",       // uploaded assessment papers waiting for evaluation
  "classes",           // my classes and how many students in each
] as const;
export type TeacherDataTopic = (typeof TEACHER_DATA_TOPICS)[number];

/** Where the teacher can see the details of each topic (paths from the sidebar). */
export const TOPIC_PAGE: Record<TeacherDataTopic, { path: string; title: string }> = {
  overview: { path: "/teacher-workspace", title: "Dashboard" },
  homework: { path: "/analytics", title: "Analytics" },
  worksheets: { path: "/submissions", title: "Worksheet Submissions" },
  attendance: { path: "/attendance", title: "Attendance" },
  doubts: { path: "/doubts", title: "Student Doubts" },
  appointments: { path: "/teacher/appointments", title: "Appointments" },
  interventions: { path: "/teacher-at-risk", title: "At-Risk Students" },
  calendar: { path: "/academic-calendar", title: "Academic Calendar" },
  assessments: { path: "/assessment-evaluation", title: "Assessment Evaluation" },
  classes: { path: "/classroom", title: "My Classroom" },
};

export interface DataFilters {
  class_level?: string | null;
  section?: string | null;
  subject?: string | null;
  student_name?: string | null;
}

const MAX_NAMES = 25;

/** "Class 5", "class-5", "5", "Grade 5", "5th" -> "5";  "LKG" -> "lkg". */
export function normClass(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/\b(class|grade|std\.?|standard)\b/g, "")
    .replace(/(\d+)\s*(st|nd|rd|th)\b/, "$1")
    .replace(/[\s\-_.]+/g, "")
    .trim();
}
const normSection = (v: unknown) => String(v ?? "").trim().toUpperCase();
const normName = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function todayIST(offsetDays = 0): string {
  const d = new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

function matchesClass(f: DataFilters, classLevel: unknown, section: unknown): boolean {
  if (f.class_level && normClass(f.class_level) !== normClass(classLevel)) return false;
  if (f.section && normSection(f.section) !== normSection(section)) return false;
  return true;
}

function names(list: string[]) {
  const uniq = [...new Set(list.filter(Boolean))];
  return { count: uniq.length, names: uniq.slice(0, MAX_NAMES), more: Math.max(0, uniq.length - MAX_NAMES) };
}

// ---------------------------------------------------------------------------------------------------------------
// shared look-ups
// ---------------------------------------------------------------------------------------------------------------

interface Ctx { db: Db; uid: string; schoolId: string | null; f: DataFilters }

async function myClasses(ctx: Ctx): Promise<{ id: string; name: string; section: string }[]> {
  const { data } = await ctx.db.from("class_teachers").select("class_id, classes(id, name, section)").eq("teacher_id", ctx.uid);
  return (data ?? [])
    .map((r: any) => r.classes)
    .filter(Boolean)
    .map((c: any) => ({ id: c.id, name: String(c.name ?? ""), section: String(c.section ?? "") }));
}

interface RosterStudent { id: string; profile_id: string | null; name: string; class: string; section: string }

let rosterCache: { key: string; rows: RosterStudent[] } | null = null;
async function schoolRoster(ctx: Ctx): Promise<RosterStudent[]> {
  const key = `${ctx.uid}|${ctx.schoolId}`;
  if (rosterCache?.key === key) return rosterCache.rows;
  let rows: RosterStudent[] = [];
  if (ctx.schoolId) {
    const { data } = await ctx.db.from("students").select("id, profile_id, full_name, class, section, status")
      .eq("school_id", ctx.schoolId).limit(5000);
    rows = (data ?? [])
      .filter((s: any) => !s.status || String(s.status).toLowerCase() === "active")
      .map((s: any) => ({ id: s.id, profile_id: s.profile_id ?? null, name: String(s.full_name ?? ""), class: String(s.class ?? ""), section: String(s.section ?? "") }));
  }
  rosterCache = { key, rows };
  return rows;
}

let profileRosterCache: { key: string; rows: RosterStudent[] } | null = null;
async function schoolStudentProfiles(ctx: Ctx): Promise<RosterStudent[]> {
  const key = `${ctx.uid}|${ctx.schoolId}`;
  if (profileRosterCache?.key === key) return profileRosterCache.rows;
  let rows: RosterStudent[] = [];
  if (ctx.schoolId) {
    const { data } = await ctx.db.from("profiles").select("id, full_name, class_grade, section")
      .eq("role", "student").eq("school_id", ctx.schoolId).limit(5000);
    rows = (data ?? []).map((p: any) => ({ id: p.id, profile_id: p.id, name: String(p.full_name ?? ""), class: String(p.class_grade ?? ""), section: String(p.section ?? "") }));
  }
  profileRosterCache = { key, rows };
  return rows;
}

/**
 * Students of one class/section. Student PROFILES first - the same list the Analytics tab uses for homework status -
 * then the ERP students table as a fallback.
 */
async function classRoster(ctx: Ctx, classLevel: unknown, section: unknown): Promise<RosterStudent[]> {
  const c = normClass(classLevel), s = normSection(section);
  const inClass = (r: RosterStudent) => normClass(r.class) === c && (!s || normSection(r.section) === s);
  const fromProfiles = (await schoolStudentProfiles(ctx)).filter(inClass);
  if (fromProfiles.length) return fromProfiles;
  return (await schoolRoster(ctx)).filter(inClass);
}

/** Loose subject match: "maths" ~ "Mathematics", "sci" ~ "Science". */
function subjectMatches(wanted: unknown, actual: unknown): boolean {
  const w = String(wanted ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const a = String(actual ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return true;
  if (!a) return false;
  return a.includes(w) || w.includes(a) || a.slice(0, 4) === w.slice(0, 4);
}

// ---------------------------------------------------------------------------------------------------------------
// topics
// ---------------------------------------------------------------------------------------------------------------

/** The teacher's homework: assigned_by is the column the app writes (teacher_id is only a generated alias). */
async function myHomeworkRows(ctx: Ctx): Promise<any[]> {
  for (const col of ["assigned_by", "teacher_id"]) {
    const { data, error } = await ctx.db.from("homework_assignments").select("*").eq(col, ctx.uid)
      .order("created_at", { ascending: false }).limit(80);
    if (!error) {
      if (data?.length) return data;
      continue;
    }
  }
  // Last resort - exactly how the Analytics tab reads it: this school's homework for the class asked about.
  if (ctx.schoolId && ctx.f.class_level) {
    const { data, error } = await ctx.db.from("homework_assignments").select("*").eq("school_id", ctx.schoolId)
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  }
  return [];
}

async function homework(ctx: Ctx) {
  const rows = await myHomeworkRows(ctx);
  const since = todayIST(-21);
  let list = rows.filter((a: any) =>
    matchesClass(ctx.f, a.class_level, a.section) &&
    subjectMatches(ctx.f.subject, a.subject ?? a.title) &&
    String(a.status ?? "active").toLowerCase() !== "cancelled");
  // Recent / still-open homework first; older ones only if nothing recent matches.
  const recent = list.filter((a: any) => String(a.due_date ?? a.assigned_at ?? a.created_at ?? "").slice(0, 10) >= since);
  list = (recent.length ? recent : list).slice(0, 6);
  if (!list.length) {
    return {
      homework: [],
      note: rows.length
        ? `You have ${rows.length} homework assignment(s), but none match ${[ctx.f.class_level && `class ${ctx.f.class_level}`, ctx.f.section && `section ${ctx.f.section}`, ctx.f.subject].filter(Boolean).join(", ")}. Classes with homework: ${[...new Set(rows.slice(0, 20).map((a: any) => `${a.class_level ?? ""} ${a.section ?? ""} ${a.subject ?? ""}`.trim()))].join("; ")}.`
        : "No homework assignments found for this teacher.",
    };
  }

  const ids = list.map((a: any) => a.id);
  const { data: subs } = await ctx.db.from("homework_submissions")
    .select("assignment_id, student_id, student_name, completed, submitted_at, teacher_score").in("assignment_id", ids);

  const out = [];
  for (const a of list) {
    const aSubs = (subs ?? []).filter((s: any) => s.assignment_id === a.id);
    const done = aSubs.filter((s: any) => s.completed === true || (s.completed == null && s.submitted_at));
    const doneIds = new Set(done.map((s: any) => s.student_id).filter(Boolean));
    const doneNames = new Set(done.map((s: any) => normName(s.student_name)).filter(Boolean));
    const roster = await classRoster(ctx, a.class_level, a.section);
    const pending = roster.filter((st) => !doneIds.has(st.id) && !(st.profile_id && doneIds.has(st.profile_id)) && !doneNames.has(normName(st.name)));
    out.push({
      homework: a.title || a.topic || a.subject || "Homework",
      type: a.assignment_type === "in-class" ? "in class" : "at home",
      subject: a.subject ?? null,
      class: a.class_level, section: a.section,
      assigned_on: String(a.assigned_at ?? a.created_at ?? "").slice(0, 10) || null,
      due: a.due_date ? String(a.due_date).slice(0, 10) : null,
      students_in_class: roster.length || null,
      submitted: done.length,
      not_submitted: roster.length ? names(pending.map((p) => p.name)) : "unknown (class list not found)",
      waiting_for_your_evaluation: done.filter((s: any) => s.teacher_score == null).length,
    });
  }
  return { homework: out };
}

async function worksheets(ctx: Ctx) {
  const { data: ws, error } = await ctx.db.from("worksheets").select("id").eq("teacher_id", ctx.uid).limit(1000);
  if (error) throw new Error(error.message);
  const ids = (ws ?? []).map((w: any) => w.id);
  if (!ids.length) return { worksheets_waiting_for_review: 0 };
  const { data: subs } = await ctx.db.from("worksheet_submissions")
    .select("student_name, class_level, section, status, submitted_at, worksheets(subject, topic, chapter)")
    .in("worksheet_id", ids).in("status", ["submitted", "ai_reviewed"])
    .order("submitted_at", { ascending: true }).limit(200);
  const rows = (subs ?? []).filter((s: any) => matchesClass(ctx.f, s.class_level, s.section));
  const waiting = rows.filter((s: any) => s.status === "submitted");
  const aiChecked = rows.filter((s: any) => s.status === "ai_reviewed");
  return {
    not_reviewed_yet: waiting.length,
    ai_checked_needs_your_confirmation: aiChecked.length,
    oldest_first: waiting.slice(0, 15).map((s: any) => ({
      student: s.student_name, class: s.class_level, section: s.section,
      worksheet: s.worksheets?.topic || s.worksheets?.chapter || s.worksheets?.subject || null,
      submitted_on: String(s.submitted_at ?? "").slice(0, 10),
    })),
  };
}

async function attendance(ctx: Ctx) {
  const classes = (await myClasses(ctx)).filter((c) => matchesClass(ctx.f, c.name, c.section));
  if (!classes.length) return { note: "You are not assigned as a class teacher of any class." };
  const today = todayIST();
  const { data: recs, error } = await ctx.db.from("attendance_records")
    .select("class_id, student_id, status").in("class_id", classes.map((c) => c.id)).eq("date", today);
  if (error) throw new Error(error.message);
  const roster = await schoolRoster(ctx);
  const nameOf = (id: string) => roster.find((r) => r.id === id || r.profile_id === id)?.name ?? "A student";
  return {
    date: today,
    classes: classes.map((c) => {
      const r = (recs ?? []).filter((x: any) => x.class_id === c.id);
      return {
        class: c.name, section: c.section,
        marked_today: r.length > 0,
        present: r.filter((x: any) => x.status === "present").length,
        absent: names(r.filter((x: any) => x.status === "absent").map((x: any) => nameOf(x.student_id))),
        late: names(r.filter((x: any) => x.status === "late").map((x: any) => nameOf(x.student_id))),
      };
    }),
  };
}

async function doubts(ctx: Ctx) {
  const { data, error } = await ctx.db.from("doubts")
    .select("student_name, class_label, subject, question, status, created_at")
    .eq("teacher_id", ctx.uid).in("status", ["new", "in_progress"])
    .order("created_at", { ascending: true }).limit(30);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter((d: any) => !ctx.f.subject || String(d.subject).toLowerCase().includes(String(ctx.f.subject).toLowerCase()));
  return {
    open_doubts: rows.length,
    new_not_answered: rows.filter((d: any) => d.status === "new").length,
    oldest_first: rows.slice(0, 10).map((d: any) => ({
      student: d.student_name, class: d.class_label, subject: d.subject,
      question: String(d.question ?? "").slice(0, 140), asked_on: String(d.created_at).slice(0, 10), status: d.status,
    })),
  };
}

async function appointments(ctx: Ctx) {
  const { data, error } = await ctx.db.from("appointments")
    .select("appointment_date, start_time, end_time, status, reason_category, meeting_mode, student_id")
    .eq("teacher_id", ctx.uid).in("status", ["pending", "confirmed"]).gte("appointment_date", todayIST())
    .order("appointment_date", { ascending: true }).order("start_time", { ascending: true }).limit(15);
  if (error) throw new Error(error.message);
  const roster = await schoolRoster(ctx);
  return {
    upcoming: (data ?? []).map((a: any) => ({
      date: a.appointment_date, time: String(a.start_time ?? "").slice(0, 5), status: a.status,
      about: a.reason_category, mode: a.meeting_mode,
      student: roster.find((r) => r.id === a.student_id || r.profile_id === a.student_id)?.name ?? null,
    })),
    waiting_for_your_approval: (data ?? []).filter((a: any) => a.status === "pending").length,
  };
}

async function interventions(ctx: Ctx) {
  const { data, error } = await ctx.db.from("student_interventions")
    .select("*, students(full_name)").eq("teacher_id", ctx.uid).eq("status", "active").limit(40);
  if (error) throw new Error(error.message);
  const today = todayIST();
  const rows = (data ?? []).map((iv: any) => ({
    student: iv.students?.full_name ?? null,
    about: iv.title ?? iv.intervention_type ?? iv.type ?? iv.concern ?? iv.reason ?? null,
    review_date: iv.review_date ?? null,
  }));
  return {
    active_interventions: rows.length,
    review_due_today_or_overdue: rows.filter((r) => r.review_date && r.review_date <= today),
    list: rows.slice(0, 15),
  };
}

async function calendar(ctx: Ctx) {
  const { data, error } = await ctx.db.rpc("get_calendar_feed", { p_from: todayIST(), p_to: todayIST(14) });
  if (error) throw new Error(error.message);
  return {
    next_14_days: (data ?? []).slice(0, 20).map((e: any) => ({
      what: e.title, kind: e.kind, subject: e.subject, date: e.start_date, time: e.start_time,
    })),
  };
}

async function assessments(ctx: Ctx) {
  const { data, error } = await ctx.db.from("assessment_evaluations")
    .select("student_name, class_level, section, subject, status, created_at")
    .eq("teacher_id", ctx.uid).neq("status", "reviewed")
    .order("created_at", { ascending: true }).limit(100);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter((r: any) => matchesClass(ctx.f, r.class_level, r.section));
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return {
    papers_not_finalised: rows.length, by_status: byStatus,
    oldest_first: rows.slice(0, 10).map((r: any) => ({ student: r.student_name, class: r.class_level, section: r.section, subject: r.subject, status: r.status })),
  };
}

async function classes(ctx: Ctx) {
  const list = await myClasses(ctx);
  const out = [];
  for (const c of list) out.push({ class: c.name, section: c.section, students: (await classRoster(ctx, c.name, c.section)).length });
  return { my_classes: out };
}

const HANDLERS: Record<Exclude<TeacherDataTopic, "overview">, (ctx: Ctx) => Promise<unknown>> = {
  homework, worksheets, attendance, doubts, appointments, interventions, calendar, assessments, classes,
};

async function safely(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (e) {
    return { unavailable: true, reason: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
  }
}

/** Run one topic (or the "overview" of everything pending) for the signed-in teacher. */
export async function getTeacherData(db: Db, uid: string, topic: TeacherDataTopic, f: DataFilters = {}) {
  rosterCache = null;
  profileRosterCache = null;
  const { data: prof } = await db.from("profiles").select("school_id, full_name, role").eq("id", uid).maybeSingle();
  const ctx: Ctx = { db, uid, schoolId: prof?.school_id ?? null, f };
  if (topic === "overview") {
    const [hw, ws, att, dbt, appt, iv] = await Promise.all([
      safely(() => homework(ctx)), safely(() => worksheets(ctx)), safely(() => attendance(ctx)),
      safely(() => doubts(ctx)), safely(() => appointments(ctx)), safely(() => interventions(ctx)),
    ]);
    return { teacher: prof?.full_name ?? null, today: todayIST(), homework: hw, worksheets: ws, attendance: att, doubts: dbt, appointments: appt, interventions: iv };
  }
  return { today: todayIST(), [topic]: await safely(() => HANDLERS[topic](ctx)) };
}
