// hod-assistant
//
// Backs the "HOD Assistant" widget on the HOD dashboard
// (src/components/ai-assistant/AIHODAssistantWidget.tsx).
//
// SECURITY: the caller's identity is ALWAYS derived from their verified
// Supabase auth JWT (never from a client-supplied field). The caller must
// have role "hod". Every query below is explicitly scoped to that HOD's
// OWN school_id, on top of whatever RLS policies already exist - so this
// assistant can only ever discuss that one school's data.
//
// Answers questions about: Reports, Communication, Surveys, Academic
// Calendar, Timetable, Syllabus Coverage, Competency Heatmap, and
// Competency Definitions.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function getGeminiKeys(): string[] {
  return [
    Deno.env.get("Worksheet_gemini_api_key"),
    Deno.env.get("GOOGLE_GEMINI_API_KEY_2"),
    Deno.env.get("GEMINI_KEY_2"),
    Deno.env.get("GEMINI_KEY_3"),
    Deno.env.get("GEMINI_KEY_4"),
  ].filter((k): k is string => !!k && k.trim().length > 0);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  keys: string[],
  history: { role: string; text: string }[] = [],
): Promise<string | null> {
  const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
  for (const key of keys) {
    for (const model of models) {
      try {
        const response = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [
                ...history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] })),
                { role: "user", parts: [{ text: userPrompt }] },
              ],
              generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
            }),
          },
          8000,
        );
        if (response.status === 429 || response.status === 503) continue;
        if (!response.ok) continue;
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text.trim();
      } catch (_e) {
        // try next key/model
      }
    }
  }
  return null;
}

// Known spelling/casing variants folded into one canonical name - kept in
// sync with src/lib/subjectUtils.ts (can't import across the Deno/Vite
// boundary, so this is a small inlined copy).
const SUBJECT_ALIASES: Record<string, string> = {
  maths: "Mathematics", math: "Mathematics", mathematics: "Mathematics",
  science: "Science", social: "Social Studies", "social studies": "Social Studies",
  english: "English", "computer science": "Computer Science", computers: "Computer Science",
  hindi: "Hindi", telugu: "Telugu",
};
function normalizeSubject(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (SUBJECT_ALIASES[lower]) return SUBJECT_ALIASES[lower];
  return trimmed.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.substring(1).toLowerCase());
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "no date set";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

interface Ctx {
  supabase: any;
  authUserId: string;
  schoolId: string | null;
  fullName: string | null;
  authHeader: string;
  supabaseUrl: string;
}

async function safe(label: string, fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[hod-assistant] ${label} failed:`, e);
    return `${label.toUpperCase()}: Not available right now.`;
  }
}

// ---- Reports (delegates to the same executive-report function that
// powers the Executive Reporting page, so the numbers always match) ----
async function buildReportsContext(ctx: Ctx): Promise<string> {
  return safe("REPORTS", async () => {
    if (!ctx.schoolId) return "REPORTS: No school on file.";
    const resp = await fetchWithTimeout(
      `${ctx.supabaseUrl}/functions/v1/executive-report`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: ctx.authHeader },
        body: JSON.stringify({ school_id: ctx.schoolId }),
      },
      10000,
    );
    if (!resp.ok) return "REPORTS: Report data isn't available right now.";
    const r = await resp.json();
    if (r?.error) return "REPORTS: Report data isn't available right now.";
    const s = r.summary || {};
    const lines = [
      `- Students: ${s.total_students ?? "—"}, Teachers: ${s.total_teachers ?? "—"}`,
      `- Average academic performance: ${s.average_performance != null ? `${s.average_performance}%` : "no data yet"}`,
      `- At-risk students: ${s.at_risk_count ?? 0} (high: ${r.at_risk?.high ?? 0}, medium: ${r.at_risk?.medium ?? 0}, low: ${r.at_risk?.low ?? 0})`,
      `- Homework completion rate: ${s.homework_completion_pct != null ? `${s.homework_completion_pct}%` : "no data yet"}`,
      `- Overall school health score: ${r.health_score != null ? `${r.health_score}/100` : "not enough data yet"}`,
    ];
    if (Array.isArray(r.grade_wise) && r.grade_wise.length) {
      lines.push(`- Grade-wise average scores: ${r.grade_wise.map((g: any) => `${g.grade}: ${g.avg_score}%`).join(", ")}`);
    }
    if (Array.isArray(r.action_items) && r.action_items.length) {
      lines.push(`- Flagged action items: ${r.action_items.map((a: any) => a.text).join(" | ")}`);
    }
    return `REPORTS (this school's executive report only):\n${lines.join("\n")}`;
  });
}

// ---- Communication (this HOD's own message inbox/outbox) ----
async function buildCommunicationContext(ctx: Ctx): Promise<string> {
  return safe("COMMUNICATION", async () => {
    const { data } = await ctx.supabase
      .from("teacher_messages")
      .select("*")
      .or(`sender_id.eq.${ctx.authUserId},recipient_id.eq.${ctx.authUserId}`)
      .order("created_at", { ascending: false })
      .limit(15);
    if (!data || data.length === 0) return "COMMUNICATION: No messages in this HOD's inbox.";
    const otherIds = [...new Set(data.map((m: any) => (m.sender_id === ctx.authUserId ? m.recipient_id : m.sender_id)))].filter(Boolean);
    const { data: otherProfiles } = otherIds.length
      ? await ctx.supabase.from("profiles").select("id, full_name").in("id", otherIds)
      : { data: [] };
    const nameById = new Map((otherProfiles || []).map((p: any) => [p.id, p.full_name]));
    const unread = data.filter((m: any) => m.recipient_id === ctx.authUserId && !m.is_read).length;
    const rows = data.slice(0, 8).map((m: any) => {
      const fromMe = m.sender_id === ctx.authUserId;
      const text = (m.message ?? m.content ?? "").toString().slice(0, 80);
      const other = fromMe ? m.recipient_id : m.sender_id;
      return `- ${fromMe ? "You" : nameById.get(other) || "Someone"} (${fmtDate(m.created_at)}): "${text}"`;
    });
    return `COMMUNICATION (this HOD's own inbox/outbox only):\nUnread messages: ${unread}.\nRecent:\n${rows.join("\n")}`;
  });
}

// ---- Surveys (school-wide, since HODs can see all school surveys) ----
async function buildSurveysContext(ctx: Ctx): Promise<string> {
  return safe("SURVEYS", async () => {
    if (!ctx.schoolId) return "SURVEYS: No school on file.";
    const { data: surveys } = await ctx.supabase
      .from("surveys")
      .select("id, title, status, target_type, is_anonymous, created_at")
      .eq("school_id", ctx.schoolId)
      .order("created_at", { ascending: false })
      .limit(15);
    if (!surveys || surveys.length === 0) return "SURVEYS: No surveys have been created for this school.";
    const surveyIds = surveys.map((s: any) => s.id);
    const { data: receipts } = await ctx.supabase
      .from("survey_receipts")
      .select("survey_id")
      .in("survey_id", surveyIds);
    const responseCounts = new Map<string, number>();
    (receipts || []).forEach((r: any) => responseCounts.set(r.survey_id, (responseCounts.get(r.survey_id) || 0) + 1));
    const rows = surveys.map((s: any) =>
      `- "${s.title}" [${s.status}] target: ${s.target_type}${s.is_anonymous ? " (anonymous)" : ""}, ${responseCounts.get(s.id) || 0} response(s), created ${fmtDate(s.created_at)}`
    );
    return `SURVEYS (this school's surveys only):\n${rows.join("\n")}`;
  });
}

// ---- Academic Calendar ----
async function buildAcademicCalendarContext(ctx: Ctx): Promise<string> {
  return safe("ACADEMIC CALENDAR", async () => {
    if (!ctx.schoolId) return "ACADEMIC CALENDAR: No school on file.";
    const { data } = await ctx.supabase
      .from("academic_calendar_events")
      .select("title, description, event_type, start_date, end_date")
      .eq("school_id", ctx.schoolId)
      .order("start_date", { ascending: true });
    if (!data || data.length === 0) return "ACADEMIC CALENDAR: No events on the school calendar.";
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = data.filter((e: any) => e.end_date >= today).slice(0, 12);
    const past = data.filter((e: any) => e.end_date < today).slice(-5);
    const fmtRow = (e: any) => `- [${e.event_type}] "${e.title}": ${fmtDate(e.start_date)}${e.end_date && e.end_date !== e.start_date ? ` to ${fmtDate(e.end_date)}` : ""}`;
    const parts = [];
    if (upcoming.length) parts.push(`Upcoming:\n${upcoming.map(fmtRow).join("\n")}`);
    if (past.length) parts.push(`Recently past:\n${past.map(fmtRow).join("\n")}`);
    return `ACADEMIC CALENDAR (this school's calendar only):\n${parts.join("\n")}`;
  });
}

// ---- Timetable (timetables are uploaded files per class/teacher, not
// granular period rows - so we report coverage: who has one uploaded and
// when it was last updated, not a period-by-period grid) ----
async function buildTimetableContext(ctx: Ctx): Promise<string> {
  return safe("TIMETABLE", async () => {
    if (!ctx.schoolId) return "TIMETABLE: No school on file.";
    const { data } = await ctx.supabase
      .from("timetables")
      .select("timetable_type, class_grade, section, teacher_id, created_at")
      .eq("school_id", ctx.schoolId)
      .order("created_at", { ascending: false });
    if (!data || data.length === 0) return "TIMETABLE: No timetables have been uploaded for this school yet.";
    const classTts = data.filter((t: any) => t.timetable_type === "class");
    const teacherTts = data.filter((t: any) => t.timetable_type === "teacher");
    const classRows = classTts.slice(0, 15).map((t: any) => `- Class ${t.class_grade}${t.section ? ` - ${t.section}` : ""} (uploaded ${fmtDate(t.created_at)})`);
    return `TIMETABLE (this school only - uploaded timetable files, not a live period grid):\n${classTts.length} class timetable(s), ${teacherTts.length} individual teacher timetable(s) on file.\n${classRows.join("\n")}`;
  });
}

// ---- Syllabus Coverage (summarized version of SchoolSyllabusOverview) ----
async function buildSyllabusCoverageContext(ctx: Ctx): Promise<string> {
  return safe("SYLLABUS COVERAGE", async () => {
    if (!ctx.schoolId) return "SYLLABUS COVERAGE: No school on file.";
    const { data: assignments } = await ctx.supabase
      .from("class_teachers")
      .select("teacher_id, subject, class_id, classes!inner(id, name, section, school_id), profiles!class_teachers_teacher_id_fkey(full_name)")
      .eq("classes.school_id", ctx.schoolId);
    if (!assignments || assignments.length === 0) return "SYLLABUS COVERAGE: No teacher-class-subject assignments found.";

    const rows = assignments.filter((a: any) => a.subject && a.classes).slice(0, 60);
    const results = await Promise.all(rows.map(async (a: any) => {
      const className = (a.classes.name as string).replace(/\b\w/g, (c: string) => c.toUpperCase());
      const subject = normalizeSubject(a.subject);
      const [{ data: chapters }, { count: covered }, { count: coveredNoSchool }] = await Promise.all([
        ctx.supabase.from("curriculum_chapters").select("id, books!inner(class_name, subject, school_id)")
          .ilike("books.class_name", className).ilike("books.subject", subject).eq("books.school_id", ctx.schoolId),
        ctx.supabase.from("lessons").select("id", { count: "exact", head: true })
          .eq("teacher_id", a.teacher_id).ilike("class_level", className).ilike("subject", subject).eq("school_id", ctx.schoolId),
        ctx.supabase.from("lessons").select("id", { count: "exact", head: true })
          .eq("teacher_id", a.teacher_id).ilike("class_level", className).ilike("subject", subject).is("school_id", null),
      ]);
      const total = chapters?.length ?? 0;
      const coveredCount = (covered ?? 0) + (coveredNoSchool ?? 0);
      const pct = total > 0 ? Math.min(100, Math.round((coveredCount / total) * 100)) : null;
      return {
        teacher: a.profiles?.full_name || "Unknown teacher",
        className, section: a.classes.section, subject, pct,
      };
    }));

    const withPct = results.filter((r) => r.pct !== null) as { teacher: string; className: string; section: string; subject: string; pct: number }[];
    if (withPct.length === 0) return "SYLLABUS COVERAGE: No curriculum chapter data available to compute coverage.";
    const overall = Math.round(withPct.reduce((sum, r) => sum + r.pct, 0) / withPct.length);
    const sorted = [...withPct].sort((a, b) => a.pct - b.pct);
    const lowest = sorted.slice(0, 5).map((r) => `- ${r.teacher}: ${r.className}-${r.section} ${r.subject} at ${r.pct}%`);
    const highest = sorted.slice(-5).reverse().map((r) => `- ${r.teacher}: ${r.className}-${r.section} ${r.subject} at ${r.pct}%`);
    return `SYLLABUS COVERAGE (this school only, ${withPct.length} class-subject combinations):\nOverall average coverage: ${overall}%.\nLowest coverage:\n${lowest.join("\n")}\nHighest coverage:\n${highest.join("\n")}`;
  });
}

// ---- Competency Heatmap (proficiency distribution per subject) ----
async function buildCompetencyHeatmapContext(ctx: Ctx): Promise<string> {
  return safe("COMPETENCY HEATMAP", async () => {
    if (!ctx.schoolId) return "COMPETENCY HEATMAP: No school on file.";
    const [{ data: classes }, { data: competencies }] = await Promise.all([
      ctx.supabase.from("classes").select("id").eq("school_id", ctx.schoolId),
      ctx.supabase.from("competencies").select("id, subject").eq("school_id", ctx.schoolId),
    ]);
    if (!classes?.length || !competencies?.length) return "COMPETENCY HEATMAP: No classes or competencies defined yet.";
    const classIds = classes.map((c: any) => c.id);
    const competencyIds = competencies.map((c: any) => c.id);
    const subjectByCompetency = new Map(competencies.map((c: any) => [c.id, normalizeSubject(c.subject)]));

    const { data: assessments } = await ctx.supabase
      .from("competency_assessments")
      .select("student_id, competency_id, class_id, proficiency, assessed_date")
      .in("competency_id", competencyIds)
      .in("class_id", classIds)
      .order("assessed_date", { ascending: false });
    if (!assessments || assessments.length === 0) return "COMPETENCY HEATMAP: No competency assessments recorded yet.";

    // Keep only the latest assessment per (student, competency).
    const latest = new Map<string, any>();
    for (const row of assessments) {
      const key = `${row.student_id}::${row.competency_id}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    const bySubject = new Map<string, { beginner: number; developing: number; proficient: number; advanced: number }>();
    for (const row of latest.values()) {
      const subject = subjectByCompetency.get(row.competency_id) || "Unknown";
      const bucket = bySubject.get(subject) || { beginner: 0, developing: 0, proficient: 0, advanced: 0 };
      const level = (row.proficiency || "").toLowerCase();
      if (level in bucket) (bucket as any)[level] += 1;
      bySubject.set(subject, bucket);
    }
    const rows = Array.from(bySubject.entries()).map(([subject, b]) => {
      const total = b.beginner + b.developing + b.proficient + b.advanced;
      const strongPct = total > 0 ? Math.round(((b.proficient + b.advanced) / total) * 100) : 0;
      return `- ${subject}: ${total} student assessments - beginner ${b.beginner}, developing ${b.developing}, proficient ${b.proficient}, advanced ${b.advanced} (${strongPct}% proficient or advanced)`;
    });
    return `COMPETENCY HEATMAP (this school only, latest assessment per student/competency):\n${rows.join("\n")}`;
  });
}

// ---- Competency Definitions (the master list of tracked competencies) ----
async function buildCompetencyDefinitionsContext(ctx: Ctx): Promise<string> {
  return safe("COMPETENCY DEFINITIONS", async () => {
    if (!ctx.schoolId) return "COMPETENCY DEFINITIONS: No school on file.";
    const { data } = await ctx.supabase
      .from("competencies")
      .select("subject, name, description, grade_level")
      .eq("school_id", ctx.schoolId)
      .order("subject", { ascending: true })
      .order("name", { ascending: true });
    if (!data || data.length === 0) return "COMPETENCY DEFINITIONS: No competencies have been defined for this school yet.";
    const bySubject = new Map<string, string[]>();
    for (const c of data) {
      const subject = normalizeSubject(c.subject);
      const list = bySubject.get(subject) || [];
      list.push(`${c.name} (${c.grade_level || "All Grades"})`);
      bySubject.set(subject, list);
    }
    const rows = Array.from(bySubject.entries()).map(([subject, names]) => `- ${subject}: ${names.join("; ")}`);
    return `COMPETENCY DEFINITIONS (this school only, ${data.length} total):\n${rows.join("\n")}`;
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message, history } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ type: "message", text: "I didn't catch a question there - could you try again?" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const keys = getGeminiKeys();
    if (keys.length === 0) {
      return new Response(JSON.stringify({ error: "No AI API keys configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

    // Anon-key client with the caller's own JWT forwarded, so RLS applies
    // exactly as it would for the HOD using the app directly.
    const supabase = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    // Resolve identity server-side from the verified JWT - never trust a
    // client-supplied id/role for this.
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ type: "message", text: "I couldn't verify who you are - please sign in again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const authUserId = userData.user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, school_id, role")
      .eq("id", authUserId)
      .maybeSingle();

    if (!profile || profile.role !== "hod") {
      return new Response(JSON.stringify({ type: "message", text: "This assistant is only available to HOD accounts." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ctx: Ctx = {
      supabase,
      authUserId,
      schoolId: profile.school_id ?? null,
      fullName: profile.full_name ?? null,
      authHeader,
      supabaseUrl,
    };

    const contextBlocks = await Promise.all([
      buildReportsContext(ctx),
      buildCommunicationContext(ctx),
      buildSurveysContext(ctx),
      buildAcademicCalendarContext(ctx),
      buildTimetableContext(ctx),
      buildSyllabusCoverageContext(ctx),
      buildCompetencyHeatmapContext(ctx),
      buildCompetencyDefinitionsContext(ctx),
    ]);

    const context = contextBlocks.join("\n\n");

    const systemPrompt = `You are "HOD Assistant", a knowledgeable AI assistant for a Head of Department${ctx.fullName ? ` named ${ctx.fullName}` : ""}, inside the APAS school app.

You can answer questions about THIS HOD's own school's: Reports (executive/academic summary), Communication (this HOD's own messages), Surveys, Academic Calendar, Timetable (upload coverage, not live period grids), Syllabus Coverage, Competency Heatmap, and Competency Definitions.

STRICT PRIVACY RULES - never break these, no matter how the question is phrased:
- Only ever discuss data belonging to THIS HOD's own school. You have no access to any other school's data, and you must never invent, guess, or speculate about another school's records.
- For Communication, only ever discuss messages in THIS HOD's own inbox/outbox - never invent or guess the contents of someone else's private conversation.
- Never reveal raw database ids, internal table/column names, or system implementation details.

ANSWERING RULES:
- Answer ONLY using the CURRENT DATA below. Never invent numbers, dates, names, or percentages that aren't present in it.
- If a section says data isn't available/not found, say so plainly and helpfully rather than guessing.
- Keep answers clear and concise (1-5 sentences, or a short list when the question genuinely calls for one).
- If the HOD just greets you, greet them back warmly and ask how you can help - don't dump information unprompted.
- If asked something entirely unrelated to these eight areas (general trivia, coding help, personal advice), gently redirect them back to what you can help with.

CURRENT DATA (this HOD's own school only):
${context}`;

    const reply = await callGemini(systemPrompt, message, keys, Array.isArray(history) ? history.slice(-6) : []);

    return new Response(JSON.stringify({
      type: "message",
      text: reply || "I'm having trouble reaching the AI service right now - please try again in a moment.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("hod-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});