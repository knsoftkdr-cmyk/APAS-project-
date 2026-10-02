// supabase/functions/_shared/handlers/iepGenerator.ts
//
// INDIVIDUAL EDUCATION PLAN (IEP) GENERATOR. Not a standalone edge function (deployment limit):
// `ai-teacher-assistant` routes to it via action "iep_generate" - see _shared/mergedRouter.ts. The anchor's
// original behaviour (body without an `action`), "copilot" and "ptm_prep" are untouched.
//
// Staff only. Body:
//   { action: "iep_generate", sen_student_id: uuid, duration_months?: 3-12, focus_domains?: string[], teacher_notes?: string }
//
// Returns a DRAFT (title, dates, present levels, goals, accommodations, strategies). It saves NOTHING: the
// Special Needs screen shows the draft, the case manager edits it, and saving goes through the same
// iep_plans / iep_goals / sen_accommodations inserts the screen already used.
//
// Access: admin / principal / hod / school_admin in the SEN student's school, or the teacher who is that
// student's case manager. Everyone else gets 403.
//
// Privacy: the student's name never leaves the system (replaced by STU_01 before the model call and restored
// afterwards). SEN category and case notes ARE sent, because they are the point of the plan; the caller is
// already authorised to see them. If no AI key is set or every model fails, a rules-based draft is returned
// (source: "rules"). Every data source is optional; a missing table becomes a data gap, not an error.

// deno-lint-ignore-file no-explicit-any
import { authenticateStaff, corsHeaders, json, UUID_RE } from "../learningGroupsData.ts";
import { callAi, getAiConfig } from "../aiClient.ts";
import {
  AI_SYSTEM_PROMPT, buildAiUserPrompt, buildFallbackIep, clampDuration, parseAiJson, parseFocusDomains,
  sanitiseAiIep, type IepDraft, type IepInput,
} from "../iepModel.ts";

type Row = Record<string, any>;
const DAY = 86_400_000;
const ADMIN_ROLES = ["admin", "principal", "hod", "school_admin"];
const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);

async function safe<T>(label: string, q: PromiseLike<{ data: T | null; error: any }>, fallback: T): Promise<{ data: T; ok: boolean }> {
  try {
    const { data, error } = await q;
    if (error) { console.warn(`iep_generate: ${label} unavailable:`, error.message ?? error); return { data: fallback, ok: false }; }
    return { data: (data ?? fallback) as T, ok: true };
  } catch (e) {
    console.warn(`iep_generate: ${label} threw:`, e instanceof Error ? e.message : e);
    return { data: fallback, ok: false };
  }
}

function makeScrubber(fullName: string) {
  const token = "STU_01";
  const parts = [fullName, ...fullName.split(/\s+/)].map((p) => p.trim()).filter((p) => p.length >= 3)
    .sort((a, b) => b.length - a.length);
  const first = fullName.trim().split(/\s+/)[0] || "the student";
  return {
    scrub(text: string): string {
      let out = text;
      for (const p of parts) out = out.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), token);
      return out;
    },
    restore(text: string): string { return text.replace(/STU_\d{2,3}/g, first); },
  };
}

function flattenTopics(tree: Row[]): Array<{ topic: string; subject: string; p: number; attempted: number }> {
  const out: Array<{ topic: string; subject: string; p: number; attempted: number }> = [];
  for (const subj of tree ?? []) for (const ch of subj.chapters ?? []) for (const t of ch.topics ?? []) {
    out.push({ topic: t.name, subject: subj.subject, p: Number(t.p_mastery), attempted: Number(t.attempted_count ?? 0) });
  }
  return out;
}

export async function handleIepGenerator(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await authenticateStaff(req);
    if (!auth.ok) return auth.res;
    const { admin, caller, userClient } = auth.ctx;

    const body: Row = await req.json().catch(() => ({}));
    const senId = body.sen_student_id;
    if (typeof senId !== "string" || !UUID_RE.test(senId)) return json({ error: "sen_student_id must be a valid id" }, 400);

    // ── the SEN record + access ──────────────────────────────────────────────────────────────
    const { data: sen, error: senErr } = await admin.from("sen_students").select("*").eq("id", senId).maybeSingle();
    if (senErr) throw senErr;
    if (!sen) return json({ error: "SEN student not found" }, 404);

    if (caller.schoolId && sen.school_id && caller.schoolId !== sen.school_id) {
      return json({ error: "This student belongs to a different school" }, 403);
    }
    const isAdminRole = ADMIN_ROLES.includes(caller.role);
    const isCaseManager = !!sen.case_manager_id && sen.case_manager_id === caller.userId;
    if (!isAdminRole && !isCaseManager) {
      return json({ error: "Only the case manager or a school administrator can draft an IEP for this student" }, 403);
    }

    const { data: student } = await admin.from("students").select("id, full_name, class, section").eq("id", sen.student_id).maybeSingle();
    if (!student) return json({ error: "No student record found for this SEN student" }, 404);

    const now = Date.now();
    const sid = student.id as string;
    const today = isoDate(now);
    const duration = clampDuration(body.duration_months);
    const focus = parseFocusDomains(body.focus_domains);
    const teacherNotes = typeof body.teacher_notes === "string" ? body.teacher_notes.trim().slice(0, 1500) || null : null;

    // ── gather data (all optional) ───────────────────────────────────────────────────────────
    const [attendance, marks, behaviour, plans, accs, therapy, tree] = await Promise.all([
      safe<Row[]>("attendance", admin.from("attendance_records").select("status, date").eq("student_id", sid).gte("date", isoDate(now - 90 * DAY)).limit(500), []),
      safe<Row[]>("marks", admin.from("student_marks").select("subject, marks_obtained, max_marks, exam_date").eq("student_id", sid).order("exam_date", { ascending: false }).limit(80), []),
      safe<Row[]>("behaviour", admin.from("behaviour_records").select("category, title, points, recorded_date").eq("student_id", sid).order("recorded_date", { ascending: false }).limit(40), []),
      safe<Row[]>("previous IEPs", admin.from("iep_plans")
        .select("title, status, start_date, end_date, goals:iep_goals(domain, goal_description, progress_status), reviews:iep_reviews(review_date, summary)")
        .eq("sen_student_id", senId).order("created_at", { ascending: false }).limit(3), []),
      safe<Row[]>("accommodations", admin.from("sen_accommodations").select("accommodation_type, applies_to, description, active").eq("sen_student_id", senId), []),
      safe<Row[]>("therapy", admin.from("therapy_sessions").select("therapy_type, goals_addressed, session_date").eq("sen_student_id", senId).order("session_date", { ascending: false }).limit(8), []),
      // Runs as the caller, so the RPC enforces its own access rules (same as the Teacher Copilot / PTM prep).
      safe<any>("mastery tree", userClient.rpc("get_student_mastery_tree", { p_student_id: sid, p_book_id: null }), null),
    ]);

    // attendance: excused days are not counted; late counts as present
    let attendanceRate: number | null = null;
    if (attendance.ok) {
      const counted = attendance.data.filter((r) => String(r.status).toLowerCase() !== "excused");
      if (counted.length >= 5) {
        const present = counted.filter((r) => ["present", "late"].includes(String(r.status).toLowerCase())).length;
        attendanceRate = Math.round((present / counted.length) * 1000) / 10;
      }
    }

    // marks: weighted per-subject % over the latest results, weakest first
    let marksSummary: IepInput["marks"] = null;
    if (marks.ok && marks.data.length) {
      const bySubject = new Map<string, { o: number; m: number }>();
      for (const r of marks.data) {
        const o = Number(r.marks_obtained), m = Number(r.max_marks);
        if (!r.subject || !Number.isFinite(o) || !Number.isFinite(m) || m <= 0) continue;
        const cur = bySubject.get(String(r.subject)) ?? { o: 0, m: 0 };
        bySubject.set(String(r.subject), { o: cur.o + o, m: cur.m + m });
      }
      const list = [...bySubject.entries()].map(([subject, v]) => ({ subject, pct: Math.round((v.o / v.m) * 100) })).sort((a, b) => a.pct - b.pct);
      marksSummary = list.length ? list : null;
    }

    const topics = flattenTopics(Array.isArray(tree.data) ? tree.data : []).filter((t) => t.attempted > 0 && Number.isFinite(t.p));
    const weakTopics = tree.ok && topics.length
      ? [...topics].sort((a, b) => a.p - b.p).slice(0, 5).map((t) => ({ topic: t.topic, subject: t.subject, mastery_pct: Math.round(t.p * 100) }))
      : null;

    const beh = behaviour.ok && behaviour.data.length
      ? {
        positive: behaviour.data.filter((b) => Number(b.points ?? 0) > 0).length,
        negative: behaviour.data.filter((b) => Number(b.points ?? 0) < 0).length,
        recent: behaviour.data.slice(0, 4).map((b) => String(b.title ?? b.category ?? "")).filter(Boolean),
      }
      : null;

    const input: IepInput = {
      today,
      category: String(sen.category ?? "Other"),
      diagnosis_notes: sen.diagnosis_notes ? String(sen.diagnosis_notes) : null,
      review_cycle_months: Number.isFinite(Number(sen.review_cycle_months)) && Number(sen.review_cycle_months) > 0 ? Number(sen.review_cycle_months) : 6,
      grade: student.class ? `Class ${student.class}${student.section ? `-${student.section}` : ""}` : null,
      duration_months: duration,
      focus_domains: focus,
      teacher_notes: teacherNotes,
      attendance_rate: attendanceRate,
      marks: marksSummary,
      weak_topics: weakTopics,
      behaviour: beh,
      prior_plans: plans.data.map((p) => ({
        title: String(p.title ?? ""), status: String(p.status ?? ""), start_date: p.start_date ?? null, end_date: p.end_date ?? null,
        goals: (p.goals ?? []).map((g: Row) => ({ domain: String(g.domain ?? ""), goal_description: String(g.goal_description ?? ""), progress_status: String(g.progress_status ?? "not_started") })),
        last_review_summary: ((p.reviews ?? []) as Row[]).sort((a, b) => String(b.review_date).localeCompare(String(a.review_date)))[0]?.summary ?? null,
      })),
      accommodations: accs.data.map((a) => ({ accommodation_type: String(a.accommodation_type ?? ""), applies_to: String(a.applies_to ?? ""), description: a.description ?? null, active: a.active !== false })),
      therapy: therapy.data.map((t) => ({ therapy_type: String(t.therapy_type ?? ""), goals_addressed: t.goals_addressed ?? null })),
    };

    const fallback = buildFallbackIep(input);

    // ── AI drafting (optional) ───────────────────────────────────────────────────────────────
    const warnings: string[] = [];
    let draft: IepDraft = fallback;
    let source: "ai" | "rules" = "rules";
    let model: string | null = null;
    try {
      const { scrub, restore } = makeScrubber(String(student.full_name ?? ""));
      const result = await callAi(getAiConfig(), buildAiUserPrompt(input, scrub), { system: AI_SYSTEM_PROMPT, temperature: 0.3, maxOutputTokens: 6144 });
      const merged = sanitiseAiIep(parseAiJson(result.text), input, fallback, restore);
      if (merged) { draft = merged; source = "ai"; model = result.model; }
      else warnings.push("The AI response could not be used, so this draft is built from templates and your records. Please personalise it.");
    } catch (e) {
      console.error("iep_generate AI failed:", e instanceof Error ? e.message : e);
      warnings.push("AI drafting is unavailable right now, so this draft is built from templates and your records. Please personalise it.");
    }

    const dataGaps: string[] = [];
    if (!input.diagnosis_notes && !teacherNotes) dataGaps.push("No case notes on the SEN record, so goals are general. Add notes or a request and generate again for a closer fit.");
    if (!attendance.ok || attendanceRate == null) dataGaps.push("Not enough attendance data to describe attendance.");
    if (!marksSummary) dataGaps.push("No marks on record.");
    if (!weakTopics) dataGaps.push("No concept-mastery data.");
    if (!beh) dataGaps.push("No behaviour records.");

    return json({
      sen_student_id: senId, student_name: student.full_name, generated_at: new Date(now).toISOString(),
      source, model, draft, warnings, data_gaps: dataGaps,
    });
  } catch (e: any) {
    console.error("iep_generate error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, typeof e?.status === "number" ? e.status : 500);
  }
}
