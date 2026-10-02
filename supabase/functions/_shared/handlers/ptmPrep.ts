// supabase/functions/_shared/handlers/ptmPrep.ts
//
// PARENT-TEACHER MEETING INTELLIGENCE. Not a standalone edge function (deployment limit): `ai-teacher-assistant`
// routes to it via action "ptm_prep" - see _shared/mergedRouter.ts. The anchor's original behaviour (body without an
// `action`) and the "copilot" action are untouched.
//
// Staff only. Body:  { action: "ptm_prep", appointment_id: uuid, refresh?: boolean }
//
// Builds a discussion-point brief for ONE booked meeting from the data the teacher can already see: the meeting's
// stated agenda, attendance, marks, homework completion, behaviour records, the teacher's own notes, interventions,
// concept mastery / misconceptions, predicted risk, goals and previous meetings with this parent.
//
// Access: the teacher on the appointment (and still teaching that student), or admin / principal / hod / school_admin
// in the appointment's school. Everyone else gets 403.
//
// Privacy: the student's name never leaves the system - it is replaced by STU_01 before the model call and restored
// afterwards. The parent's name is never sent. Safeguarding, medical, SEN/IEP and fee data are deliberately NOT read.
//
// Resilience: every data source is optional (a failing or empty source becomes a "data gap", not an error), and if no
// AI key is configured or every model fails, the deterministic brief is returned (source: "rules").
//
// Caching: an AI-written brief is stored in `ptm_prep_briefs` (migration 20261012000000; RLS on, no client policies, so
// it is never readable by parents - which is why it is NOT a column on `appointments`, parents select("*") from that).
// Works without the migration - it just regenerates each time. Reused for 12h unless the agenda changed or `refresh`.

// deno-lint-ignore-file no-explicit-any
import { canStaffAccessStudent } from "../studentAccess.ts";
import { authenticateStaff, corsHeaders, json, UUID_RE } from "../learningGroupsData.ts";
import { callAi, getAiConfig } from "../aiClient.ts";
import {
  AI_SYSTEM_PROMPT, appointmentFingerprint, buildAiUserPrompt, buildDataGaps, buildFallbackPrep, buildSignals,
  parseAiJson, sanitiseAiPrep, type PtmInput, type PtmPrep,
} from "../ptmPrepModel.ts";

type Row = Record<string, any>;

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DAY = 86_400_000;
const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Runs a query; a failure or empty result yields `fallback` so one missing table never breaks the brief. */
async function safe<T>(label: string, q: PromiseLike<{ data: T | null; error: any }>, fallback: T): Promise<{ data: T; ok: boolean }> {
  try {
    const { data, error } = await q;
    if (error) { console.warn(`ptm_prep: ${label} unavailable:`, error.message ?? error); return { data: fallback, ok: false }; }
    return { data: (data ?? fallback) as T, ok: true };
  } catch (e) {
    console.warn(`ptm_prep: ${label} threw:`, e instanceof Error ? e.message : e);
    return { data: fallback, ok: false };
  }
}

function makeScrubber(fullName: string) {
  const token = "STU_01";
  const parts = [fullName, ...fullName.split(/\s+/)].map((p) => p.trim()).filter((p) => p.length >= 3)
    .sort((a, b) => b.length - a.length); // longest first so "Anna Maria" wins over "Anna"
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

export async function handlePtmPrep(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await authenticateStaff(req);
    if (!auth.ok) return auth.res;
    const { ctx } = auth;
    const { admin, caller, userClient } = ctx;

    const body: Row = await req.json().catch(() => ({}));
    const appointmentId = body.appointment_id;
    if (typeof appointmentId !== "string" || !UUID_RE.test(appointmentId)) return json({ error: "appointment_id must be a valid id" }, 400);
    const refresh = body.refresh === true;

    // ── the appointment + access ─────────────────────────────────────────────────────────────
    const { data: appt, error: apptErr } = await admin.from("appointments").select("*").eq("id", appointmentId).maybeSingle();
    if (apptErr) throw apptErr;
    if (!appt) return json({ error: "Appointment not found" }, 404);

    if (caller.role === "teacher") {
      if (appt.teacher_id !== caller.userId) return json({ error: "This meeting is not assigned to you" }, 403);
    } else if (caller.schoolId && appt.school_id && caller.schoolId !== appt.school_id) {
      return json({ error: "This appointment belongs to a different school" }, 403);
    }

    // appointments.student_id is the student's PROFILE id; the academic tables key on students.id.
    let { data: student } = await admin.from("students").select("id, profile_id, full_name, class, section").eq("profile_id", appt.student_id).maybeSingle();
    if (!student) ({ data: student } = await admin.from("students").select("id, profile_id, full_name, class, section").eq("id", appt.student_id).maybeSingle());
    if (!student) return json({ error: "No student record found for this appointment" }, 404);

    const access = await canStaffAccessStudent(admin, caller, student.id);
    if (!access.ok) return json({ error: access.error }, access.status ?? 403);

    // ── cache ────────────────────────────────────────────────────────────────────────────────
    const fingerprint = appointmentFingerprint(appt);
    if (!refresh) {
      const hit = await safe<Row | null>("cache", admin.from("ptm_prep_briefs").select("*").eq("appointment_id", appt.id).maybeSingle(), null);
      const row = hit.data;
      const at = row?.generated_at ? Date.parse(row.generated_at) : NaN;
      if (row?.prep && row.fingerprint === fingerprint && Number.isFinite(at) && Date.now() - at < CACHE_TTL_MS) {
        return json({
          appointment_id: appt.id, student_name: student.full_name, generated_at: row.generated_at,
          source: row.source ?? "ai", cached: true, prep: row.prep, warnings: [],
        });
      }
    }

    // ── gather data (all optional) ───────────────────────────────────────────────────────────
    const now = Date.now();
    const sid = student.id as string;
    const pid = (student.profile_id ?? null) as string | null;
    const apptDate = (appt.appointment_date as string | null) ?? isoDate(now);

    const homeworkAssignments = await safe<Row[]>("homework assignments",
      admin.from("homework_assignments").select("id")
        .eq("class_level", student.class ?? "").eq("section", student.section ?? "")
        .gte("created_at", new Date(now - 60 * DAY).toISOString()).limit(200), []);
    const assignmentIds = homeworkAssignments.data.map((a) => a.id);

    const [attendance, marks, tests, submissions, behaviour, notes, interventions, prediction, goals, previous, tree, misc, risk] = await Promise.all([
      safe<Row[]>("attendance", admin.from("attendance_records").select("status, date").eq("student_id", sid).gte("date", isoDate(now - 90 * DAY)).limit(500), []),
      safe<Row[]>("marks", admin.from("student_marks").select("subject, marks_obtained, max_marks, exam_date").eq("student_id", sid).order("exam_date", { ascending: false }).limit(80), []),
      pid ? safe<Row[]>("practice tests", admin.from("academic_tests").select("subject, score, total_questions, completed_at").eq("student_id", pid).order("completed_at", { ascending: false }).limit(30), []) : Promise.resolve({ data: [] as Row[], ok: false }),
      pid && assignmentIds.length ? safe<Row[]>("homework submissions", admin.from("homework_submissions").select("assignment_id, submitted_at").eq("student_id", pid).in("assignment_id", assignmentIds), []) : Promise.resolve({ data: [] as Row[], ok: false }),
      safe<Row[]>("behaviour", admin.from("behaviour_records").select("category, title, points, recorded_date, action_taken").eq("student_id", sid).order("recorded_date", { ascending: false }).limit(60), []),
      safe<Row[]>("teacher notes", admin.from("teacher_notes").select("note_type, note, created_at, follow_up_date, follow_up_completed").eq("student_id", sid).eq("teacher_id", appt.teacher_id).order("created_at", { ascending: false }).limit(30), []),
      safe<Row[]>("interventions", admin.from("student_interventions").select("*").eq("student_id", sid).order("created_at", { ascending: false }).limit(8), []),
      safe<Row[]>("prediction", admin.from("student_predictions").select("*").eq("student_id", sid).order("created_at", { ascending: false }).limit(1), []),
      safe<Row[]>("goals", admin.from("student_goals").select("title, status, progress_percent, target_date").eq("student_id", sid).order("created_at", { ascending: false }).limit(6), []),
      safe<Row[]>("previous meetings", admin.from("appointments").select("appointment_date, reason_category, reason_note, status")
        .eq("student_id", appt.student_id).eq("teacher_id", appt.teacher_id).neq("id", appt.id)
        .in("status", ["completed", "confirmed"]).lt("appointment_date", apptDate).order("appointment_date", { ascending: false }).limit(3), []),
      // Mastery RPCs run as the caller (they enforce their own access rules), exactly as the Teacher Copilot does.
      safe<any>("mastery tree", userClient.rpc("get_student_mastery_tree", { p_student_id: sid, p_book_id: null }), null),
      safe<any>("misconceptions", userClient.rpc("get_student_misconceptions", { p_student_id: sid, p_min_occurrences: 2, p_book_id: null }), null),
      safe<any>("risk signals", userClient.rpc("get_student_risk_core", { p_student_id: sid }), null),
    ]);

    // mastery is "available" only if the tree RPC answered with something
    let mastery: PtmInput["mastery"] = null;
    const topics = flattenTopics(Array.isArray(tree.data) ? tree.data : []).filter((t) => t.attempted > 0);
    if (tree.ok && topics.length) {
      const pct = (n: number) => Math.round(n * 100);
      mastery = {
        weak_topics: [...topics].sort((a, b) => a.p - b.p).slice(0, 5).map((t) => ({ topic: t.topic, subject: t.subject, mastery_pct: pct(t.p) })),
        strong_topics: [...topics].sort((a, b) => b.p - a.p).slice(0, 4).map((t) => ({ topic: t.topic, subject: t.subject, mastery_pct: pct(t.p) })),
        misconceptions: (Array.isArray(misc.data) ? misc.data : []).slice(0, 4).map((m: Row) => ({
          misconception: String(m.misconception_text ?? ""), topic: String(m.topic_name ?? ""), severity: String(m.severity ?? ""), times_seen: Number(m.occurrence_count ?? 0),
        })),
        risk_signals: ((risk.data?.causes ?? []) as Row[]).map((c) => ({ signal: String(c.cause_type ?? ""), strength: String(c.evidence_strength ?? ""), detail: String(c.explanation ?? "") })),
      };
    }

    const pred = prediction.data[0];
    const input: PtmInput = {
      now,
      appointment: {
        reason_category: appt.reason_category ?? null, reason_note: appt.reason_note ?? null,
        requested_by: appt.requested_by ?? "parent", meeting_mode: appt.meeting_mode ?? null, date: appt.appointment_date ?? null,
      },
      previous_meetings: previous.data.map((p) => ({ date: p.appointment_date, reason_category: p.reason_category ?? null, reason_note: p.reason_note ?? null })),
      attendance: attendance.ok ? attendance.data.map((r) => ({ status: String(r.status), date: String(r.date) })) : null,
      marks: marks.ok ? marks.data.map((r) => ({ subject: String(r.subject ?? ""), obtained: Number(r.marks_obtained), max: Number(r.max_marks), at: r.exam_date ?? null })) : null,
      practice_tests: tests.ok ? tests.data.map((r) => ({ subject: String(r.subject ?? ""), score: Number(r.score), total: Number(r.total_questions), at: r.completed_at ?? null })) : null,
      homework: homeworkAssignments.ok && assignmentIds.length
        ? { assigned: assignmentIds.length, submitted: submissions.data.filter((s) => s.submitted_at).length } : null,
      behaviour: behaviour.ok ? behaviour.data.map((b) => ({ category: String(b.category ?? ""), title: String(b.title ?? ""), points: Number(b.points ?? 0), date: b.recorded_date ?? null, action_taken: b.action_taken ?? null })) : null,
      notes: notes.ok ? notes.data.map((n) => ({ type: String(n.note_type ?? ""), note: String(n.note ?? ""), date: n.created_at ?? null, follow_up_date: n.follow_up_date ?? null, follow_up_completed: !!n.follow_up_completed })) : null,
      interventions: interventions.ok ? interventions.data.map((i) => ({
        reason: String(i.reason ?? ""), priority: i.priority ?? null, tier: i.tier ?? null, status: String(i.status ?? ""),
        review_date: i.review_date ?? null, effectiveness: i.effectiveness ?? null, action_plan: Array.isArray(i.action_plan) ? i.action_plan.map(String) : [],
      })) : null,
      mastery,
      prediction: pred ? { risk_level: String(pred.risk_level ?? ""), factors: Array.isArray(pred.contributing_factors) ? pred.contributing_factors.map((f: unknown) => typeof f === "string" ? f : JSON.stringify(f)) : [] } : null,
      goals: goals.ok ? goals.data.map((g) => ({ title: String(g.title ?? ""), status: String(g.status ?? ""), progress_percent: g.progress_percent ?? null, target_date: g.target_date ?? null })) : null,
    };

    const signals = buildSignals(input);
    const fallback = buildFallbackPrep(input, signals);

    // ── AI phrasing (optional) ───────────────────────────────────────────────────────────────
    const warnings: string[] = [];
    let prep: PtmPrep = fallback;
    let source: "ai" | "rules" = "rules";
    let model: string | null = null;

    if (signals.length || input.appointment.reason_note) {
      try {
        const { scrub, restore } = makeScrubber(String(student.full_name ?? ""));
        const result = await callAi(getAiConfig(), buildAiUserPrompt(input, signals, scrub), {
          system: AI_SYSTEM_PROMPT, temperature: 0.3, maxOutputTokens: 4096,
        });
        const merged = sanitiseAiPrep(parseAiJson(result.text), input, signals, fallback, restore);
        if (merged) { prep = merged; source = "ai"; model = result.model; }
        else warnings.push("The AI response could not be used, so these points are generated from your records only.");
      } catch (e) {
        console.error("ptm_prep AI failed:", e instanceof Error ? e.message : e);
        warnings.push("AI wording is unavailable right now, so these points are generated from your records only.");
      }
    }

    const mergedGaps = buildDataGaps(input);
    for (const [label, r] of [["attendance", attendance], ["marks", marks], ["behaviour records", behaviour], ["interventions", interventions]] as const) {
      if (!r.ok && !mergedGaps.some((g) => g.toLowerCase().startsWith(label.split(" ")[0]))) mergedGaps.push(`Could not read ${label}.`);
    }
    prep = { ...prep, data_gaps: mergedGaps };

    // ── cache write (best effort; only AI-written briefs, so a rules-only brief is retried next time) ─
    const generatedAt = new Date(now).toISOString();
    if (source === "ai") {
      const { error: cacheErr } = await admin.from("ptm_prep_briefs").upsert(
        { appointment_id: appt.id, prep, source, model, fingerprint, generated_at: generatedAt }, { onConflict: "appointment_id" });
      if (cacheErr) console.warn("ptm_prep: could not cache (is migration 20261012000000 applied?):", cacheErr.message);
    }

    return json({
      appointment_id: appt.id, student_name: student.full_name, generated_at: generatedAt,
      source, cached: false, prep, warnings,
    });
  } catch (e: any) {
    console.error("ptm_prep error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, typeof e?.status === "number" ? e.status : 500);
  }
}
