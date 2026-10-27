// supabase/functions/_shared/handlers/classBriefing.ts
//
// AI CLASS BRIEFING (sheet row 41). Not a standalone edge function (deployment limit): `ai-teacher-assistant`
// routes to it via action "class_briefing" - see _shared/mergedRouter.ts.
//
// Body: { action: "class_briefing", refresh?: boolean, tz?: IANA zone (default Asia/Kolkata) }
// Returns: Briefing (classBriefingModel.ts) + { date, generated_at, cached }
//
// Summarises the caller's own classes (class_teachers) for today: live sessions, attendance still to mark,
// homework due, grading backlog (homework + exam answers), at-risk students and the weakest topics by BKT mastery.
// Only counts and topic names go to the model - never student names. One briefing per teacher per day is
// cached in teacher_class_briefings for 3 hours; refresh=true rebuilds it.

// deno-lint-ignore-file no-explicit-any
import { callAi, getAiConfig } from "../aiClient.ts";
import { parseAiJson } from "../iepModel.ts";
import {
  BRIEFING_SYSTEM_PROMPT, buildBriefingPrompt, mergeAiBriefing, rulesBriefing, type BriefingFacts, type ClassFacts,
} from "../classBriefingModel.ts";
import { authenticateStaff, corsHeaders, json } from "../learningGroupsData.ts";

type Row = Record<string, any>;
const CACHE_MS = 3 * 60 * 60 * 1000;

const normClass = (s: unknown) => String(s ?? "").toLowerCase().replace(/\b(class|grade|std)\b\.?/g, "").replace(/\s+/g, "");
const normSection = (s: unknown) => String(s ?? "").trim().toUpperCase();

function localParts(tz: string, d = new Date()) {
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...o }).format(d);
  return { date: fmt({ year: "numeric", month: "2-digit", day: "2-digit" }), weekday: fmt({ weekday: "long" }) };
}
const hhmm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

async function teacherHomework(admin: any, teacherId: string): Promise<Row[]> {
  // Deployed schemas differ: some use assigned_by, some teacher_id.
  for (const col of ["assigned_by", "teacher_id"]) {
    const { data, error } = await admin.from("homework_assignments").select("*").eq(col, teacherId).limit(500);
    if (!error) return data ?? [];
  }
  return [];
}

export async function handleClassBriefing(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await authenticateStaff(req);
    if (!auth.ok) return auth.res;
    const { admin, userId } = auth.ctx;
    const body = await req.json().catch(() => ({}));

    let tz = typeof body.tz === "string" && body.tz ? body.tz : "Asia/Kolkata";
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { tz = "Asia/Kolkata"; }
    const { date, weekday } = localParts(tz);

    if (body.refresh !== true) {
      const { data: cached } = await admin.from("teacher_class_briefings").select("payload, created_at")
        .eq("teacher_id", userId).eq("briefing_date", date).maybeSingle();
      if (cached && Date.now() - new Date(cached.created_at).getTime() < CACHE_MS) {
        return json({ ...cached.payload, date, generated_at: cached.created_at, cached: true });
      }
    }

    // ── Facts ────────────────────────────────────────────────────────────────────────────────
    const { data: profile } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    const { data: links } = await admin.from("class_teachers").select("class_id, subject, classes(id, name, section)").eq("teacher_id", userId);
    const classMap = new Map<string, { id: string; name: string; section: string | null; subjects: Set<string> }>();
    for (const l of links ?? []) {
      if (!l.classes) continue;
      const c = classMap.get(l.class_id) ?? { id: l.class_id, name: l.classes.name, section: l.classes.section, subjects: new Set<string>() };
      if (l.subject) c.subjects.add(l.subject);
      classMap.set(l.class_id, c);
    }
    const classIds = [...classMap.keys()];

    const [rosterRes, attRes, sessRes, homework, paperRes] = await Promise.all([
      classIds.length ? admin.from("class_students").select("class_id, student_id").in("class_id", classIds) : { data: [] },
      classIds.length ? admin.from("attendance_records").select("class_id, student_id").in("class_id", classIds).eq("date", date) : { data: [] },
      admin.from("virtual_classroom_sessions").select("class_id, title, subject, scheduled_start").eq("teacher_id", userId)
        .gte("scheduled_start", new Date(Date.now() - 18 * 3600000).toISOString())
        .lte("scheduled_start", new Date(Date.now() + 30 * 3600000).toISOString()),
      teacherHomework(admin, userId),
      classIds.length ? admin.from("generated_assessment_paper_assignments").select("id, class_id").eq("assigned_by", userId).in("class_id", classIds) : { data: [] },
    ]);

    const rosterBy = new Map<string, string[]>();
    for (const r of rosterRes.data ?? []) rosterBy.set(r.class_id, [...(rosterBy.get(r.class_id) ?? []), r.student_id]);
    const markedBy = new Map<string, Set<string>>();
    for (const r of attRes.data ?? []) markedBy.set(r.class_id, (markedBy.get(r.class_id) ?? new Set()).add(r.student_id));

    // Homework -> class by grade + section text.
    const tomorrow = localParts(tz, new Date(Date.now() + 86400000)).date;
    const hwClass = (h: Row) => [...classMap.values()].find((c) =>
      normClass(h.class_level ?? h.class_grade ?? h.class_name) === normClass(c.name) && (!h.section || normSection(h.section) === normSection(c.section)))?.id ?? null;
    const hwIds = homework.map((h) => h.id);
    const { data: subs } = hwIds.length
      ? await admin.from("homework_submissions").select("assignment_id").in("assignment_id", hwIds).is("teacher_score", null).not("submitted_at", "is", null).limit(2000)
      : { data: [] };
    const hwById = new Map(homework.map((h) => [h.id, h]));

    const paperClass = new Map<string, string>((paperRes.data ?? []).map((p: Row) => [p.id, p.class_id]));
    const { data: attempts } = paperClass.size
      ? await admin.from("generated_assessment_paper_attempts").select("assignment_id").in("assignment_id", [...paperClass.keys()]).eq("status", "submitted")
      : { data: [] };

    const allStudents = [...new Set((rosterRes.data ?? []).map((r: Row) => r.student_id))];
    const { data: preds } = allStudents.length
      ? await admin.from("student_predictions").select("student_id, risk_level").in("student_id", allStudents).in("risk_level", ["high", "medium"])
      : { data: [] };
    const riskOf = new Map<string, string>();
    for (const p of preds ?? []) if (riskOf.get(p.student_id) !== "high") riskOf.set(p.student_id, p.risk_level);

    const classes: ClassFacts[] = [];
    for (const c of classMap.values()) {
      const roster = rosterBy.get(c.id) ?? [];
      const weak = new Map<string, { sum: number; n: number; students: Set<string> }>();
      if (roster.length) {
        const { data: mastery } = await admin.from("student_mastery")
          .select("student_id, p_mastery, learning_objectives(subtopics(topics(topic_name)))")
          .in("student_id", roster).gte("opportunities_count", 2).limit(5000);
        for (const m of mastery ?? []) {
          const topic = m.learning_objectives?.subtopics?.topics?.topic_name;
          if (!topic) continue;
          const w = weak.get(topic) ?? { sum: 0, n: 0, students: new Set<string>() };
          w.sum += Number(m.p_mastery); w.n++; w.students.add(m.student_id);
          weak.set(topic, w);
        }
      }
      classes.push({
        class_id: c.id,
        label: `${c.name}${c.section ? " - " + c.section : ""}`,
        subject: [...c.subjects].join(", ") || null,
        roster: roster.length,
        attendance_marked: markedBy.get(c.id)?.size ?? 0,
        live_sessions_today: (sessRes.data ?? [])
          .filter((s: Row) => s.class_id === c.id && localParts(tz, new Date(s.scheduled_start)).date === date)
          .map((s: Row) => ({ title: s.title || s.subject || "Live class", start: hhmm(s.scheduled_start, tz) })),
        homework_due_soon: homework.filter((h) => hwClass(h) === c.id && h.due_date && [date, tomorrow].includes(String(h.due_date).slice(0, 10))).length,
        submissions_to_grade: (subs ?? []).filter((s: Row) => hwClass(hwById.get(s.assignment_id) ?? {}) === c.id).length,
        exam_attempts_to_review: (attempts ?? []).filter((a: Row) => paperClass.get(a.assignment_id) === c.id).length,
        high_risk: roster.filter((id) => riskOf.get(id) === "high").length,
        medium_risk: roster.filter((id) => riskOf.get(id) === "medium").length,
        weak_topics: [...weak.entries()]
          .filter(([, w]) => w.students.size >= 3)
          .map(([topic, w]) => ({ topic, avg_mastery: Math.round((w.sum / w.n) * 100), students: w.students.size }))
          .filter((t) => t.avg_mastery < 60)
          .sort((a, b) => a.avg_mastery - b.avg_mastery)
          .slice(0, 3),
      });
    }
    classes.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

    const facts: BriefingFacts = { date, weekday, teacher_first_name: String(profile?.full_name ?? "Teacher").split(" ")[0], classes };

    // ── AI summary (falls back to the rules briefing) ────────────────────────────────────────
    let briefing = rulesBriefing(facts);
    let model: string | null = null;
    if (classes.length) {
      try {
        const r = await callAi(getAiConfig(), buildBriefingPrompt(facts), { system: BRIEFING_SYSTEM_PROMPT, temperature: 0.3, maxOutputTokens: 4096 });
        briefing = mergeAiBriefing(parseAiJson(r.text), facts);
        model = r.model;
      } catch (e) {
        console.error("class briefing AI unavailable, using rules briefing", e);
      }
    }

    const generatedAt = new Date().toISOString();
    await admin.from("teacher_class_briefings").upsert(
      { teacher_id: userId, briefing_date: date, payload: briefing, model, created_at: generatedAt },
      { onConflict: "teacher_id,briefing_date" },
    );
    return json({ ...briefing, date, generated_at: generatedAt, cached: false });
  } catch (e) {
    console.error("class-briefing error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
