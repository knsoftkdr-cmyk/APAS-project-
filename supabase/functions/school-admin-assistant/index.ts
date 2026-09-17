// school-admin-assistant
//
// Backs the "School Admin Assistant" widget on the School Admin dashboard
// (src/components/ai-assistant/AISchoolAdminAssistantWidget.tsx).
//
// SECURITY: the caller's identity is ALWAYS derived from their verified
// Supabase auth JWT (never from a client-supplied field). The caller must
// have role "school_admin". The school is resolved the same way
// SuperAdminPanel does it: school_admin_schools first, then profiles.school_id
// as a fallback. Every query below is explicitly scoped to that ONE school_id,
// on top of whatever RLS policies already exist - so this assistant can only
// ever discuss that one school's data.
//
// Answers questions about: Admissions, Transport, Communication, School Admin,
// Analytics, Surveys, Academic Calendar, Semester Engine, Report Cards, Alumni,
// Marketplace, Exam Seating, Hall Tickets, Invigilation, Houses, Student
// Transfers, ID Cards, Lifecycle Timeline, Syllabus Coverage, School Quality
// Index, Competency Heatmap, Competency Definitions, Rotation Schedules,
// Special Education (SEN), Electives, Branch Management, Resource Analytics.
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
              generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
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

// Kept in sync with src/lib/subjectUtils.ts (can't import across the
// Deno/Vite boundary, so this is a small inlined copy).
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

function tally(rows: any[], key: string, fallback = "unspecified"): string {
  const m = new Map<string, number>();
  rows.forEach((r) => {
    const k = r[key] || fallback;
    m.set(k, (m.get(k) || 0) + 1);
  });
  return Array.from(m.entries()).map(([k, v]) => `${k}: ${v}`).join(", ") || "none";
}

interface Ctx {
  supabase: any;
  authUserId: string;
  schoolId: string | null;
  schoolName: string | null;
  fullName: string | null;
  authHeader: string;
  supabaseUrl: string;
}

async function safe(label: string, fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[school-admin-assistant] ${label} failed:`, e);
    return `${label.toUpperCase()}: Not available right now.`;
  }
}

// Student profile ids for this school (used by lifecycle + anything keyed on
// profiles.id rather than students.id).
async function schoolStudentProfileIds(ctx: Ctx): Promise<string[]> {
  const { data } = await ctx.supabase
    .from("students").select("id, profile_id").eq("school_id", ctx.schoolId);
  return (data || []).map((s: any) => s.profile_id ?? s.id).filter(Boolean);
}

// ---- 1. Admissions ----
async function buildAdmissionsContext(ctx: Ctx): Promise<string> {
  return safe("ADMISSIONS", async () => {
    if (!ctx.schoolId) return "ADMISSIONS: No school on file.";
    const { data: intakes } = await ctx.supabase
      .from("admission_intakes")
      .select("id, grade, academic_year, total_seats, status")
      .eq("school_id", ctx.schoolId).order("academic_year", { ascending: false }).limit(15);
    if (!intakes || intakes.length === 0) return "ADMISSIONS: No admission intakes have been created.";
    const intakeIds = intakes.map((i: any) => i.id);
    const { data: applicants } = await ctx.supabase
      .from("admission_applicants").select("intake_id, status").in("intake_id", intakeIds);
    const byIntake = new Map<string, Record<string, number>>();
    (applicants || []).forEach((a: any) => {
      const m = byIntake.get(a.intake_id) || {};
      m[a.status] = (m[a.status] || 0) + 1;
      byIntake.set(a.intake_id, m);
    });
    const rows = intakes.map((i: any) => {
      const s = byIntake.get(i.id) || {};
      const statusStr = Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(", ") || "no applicants yet";
      return `- Grade ${i.grade}, ${i.academic_year} [${i.status}]: ${i.total_seats ?? "?"} seats. Applicants - ${statusStr}`;
    });
    return `ADMISSIONS (this school only):\n- Total applicants across intakes: ${(applicants || []).length}\n${rows.join("\n")}`;
  });
}

// ---- 2. Transport ----
async function buildTransportContext(ctx: Ctx): Promise<string> {
  return safe("TRANSPORT", async () => {
    if (!ctx.schoolId) return "TRANSPORT: No school on file.";
    const [{ data: vehicles }, { count: driverCount }, { data: routes }, { count: assignmentCount }] = await Promise.all([
      ctx.supabase.from("vehicles").select("status").eq("school_id", ctx.schoolId),
      ctx.supabase.from("drivers").select("*", { count: "exact", head: true }).eq("school_id", ctx.schoolId),
      ctx.supabase.from("transport_routes").select("name").eq("school_id", ctx.schoolId).limit(25),
      ctx.supabase.from("transport_assignments").select("*", { count: "exact", head: true }).eq("school_id", ctx.schoolId),
    ]);
    const routeNames = (routes || []).map((r: any) => r.name).filter(Boolean).slice(0, 12).join(", ");
    return `TRANSPORT (this school only):\n- Vehicles: ${vehicles?.length ?? 0}${vehicles?.length ? ` (by status - ${tally(vehicles, "status")})` : ""}\n- Drivers: ${driverCount ?? 0}\n- Routes: ${routes?.length ?? 0}${routeNames ? ` - ${routeNames}` : ""}\n- Student transport assignments: ${assignmentCount ?? 0}`;
  });
}

// ---- 3. Communication (this admin's own inbox/outbox) ----
async function buildCommunicationContext(ctx: Ctx): Promise<string> {
  return safe("COMMUNICATION", async () => {
    const { data } = await ctx.supabase
      .from("teacher_messages").select("*")
      .or(`sender_id.eq.${ctx.authUserId},recipient_id.eq.${ctx.authUserId}`)
      .order("created_at", { ascending: false }).limit(15);
    if (!data || data.length === 0) return "COMMUNICATION: No messages in this school admin's inbox.";
    const otherIds = [...new Set(data.map((m: any) => (m.sender_id === ctx.authUserId ? m.recipient_id : m.sender_id)))].filter(Boolean);
    const { data: others } = otherIds.length
      ? await ctx.supabase.from("profiles").select("id, full_name, role").in("id", otherIds)
      : { data: [] };
    const byId = new Map((others || []).map((p: any) => [p.id, `${p.full_name}${p.role ? ` (${p.role})` : ""}`]));
    const unread = data.filter((m: any) => m.recipient_id === ctx.authUserId && !m.is_read).length;
    const rows = data.slice(0, 8).map((m: any) => {
      const fromMe = m.sender_id === ctx.authUserId;
      const text = (m.message ?? m.content ?? "").toString().slice(0, 80);
      const other = fromMe ? m.recipient_id : m.sender_id;
      return `- ${fromMe ? "You" : byId.get(other) || "Someone"} (${fmtDate(m.created_at)}): "${text}"`;
    });
    return `COMMUNICATION (this school admin's own inbox/outbox only):\nUnread messages: ${unread}.\nRecent:\n${rows.join("\n")}`;
  });
}

// ---- 4. School Admin (the /super-admin console: people, classes, permissions) ----
async function buildSchoolAdminContext(ctx: Ctx): Promise<string> {
  return safe("SCHOOL ADMIN", async () => {
    if (!ctx.schoolId) return "SCHOOL ADMIN: No school on file.";
    const [{ data: people }, { data: classes }, { data: perms }, { count: parentLinkCount }] = await Promise.all([
      ctx.supabase.from("profiles").select("role").eq("school_id", ctx.schoolId),
      ctx.supabase.from("classes").select("name, section").eq("school_id", ctx.schoolId),
      ctx.supabase.from("role_permissions").select("role, module_name, allowed").eq("school_id", ctx.schoolId),
      ctx.supabase.from("class_teachers").select("*", { count: "exact", head: true }),
    ]);
    const roleCounts = tally(people || [], "role", "unassigned");
    const classList = (classes || []).slice(0, 25).map((c: any) => `${c.name}${c.section ? `-${c.section}` : ""}`).join(", ");
    const denied = (perms || []).filter((p: any) => !p.allowed);
    const deniedByRole = new Map<string, string[]>();
    denied.forEach((p: any) => {
      const list = deniedByRole.get(p.role) || [];
      list.push(p.module_name);
      deniedByRole.set(p.role, list);
    });
    const permRows = Array.from(deniedByRole.entries()).map(([role, mods]) => `  - ${role}: ${mods.slice(0, 12).join(", ")}`);
    return `SCHOOL ADMIN CONSOLE (this school only):\n- School: ${ctx.schoolName || "unnamed"}\n- People by role: ${roleCounts}\n- Classes (${classes?.length ?? 0}): ${classList || "none"}\n- Teacher-class-subject assignments on file: ${parentLinkCount ?? 0}\n- Module permissions currently TURNED OFF:\n${permRows.length ? permRows.join("\n") : "  - none (all modules allowed for all roles)"}`;
  });
}

// ---- 5. Analytics (delegates to executive-report, so numbers match the page) ----
async function buildAnalyticsContext(ctx: Ctx): Promise<string> {
  return safe("ANALYTICS", async () => {
    if (!ctx.schoolId) return "ANALYTICS: No school on file.";
    const resp = await fetchWithTimeout(
      `${ctx.supabaseUrl}/functions/v1/executive-report`,
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: ctx.authHeader }, body: JSON.stringify({ school_id: ctx.schoolId }) },
      10000,
    );
    if (!resp.ok) return "ANALYTICS: Report data isn't available right now.";
    const r = await resp.json();
    if (r?.error) return "ANALYTICS: Report data isn't available right now.";
    const s = r.summary || {};
    const lines = [
      `- Students: ${s.total_students ?? "—"}, Teachers: ${s.total_teachers ?? "—"}`,
      `- Average academic performance: ${s.average_performance != null ? `${s.average_performance}%` : "no data yet"}`,
      `- At-risk students: ${s.at_risk_count ?? 0} (high: ${r.at_risk?.high ?? 0}, medium: ${r.at_risk?.medium ?? 0}, low: ${r.at_risk?.low ?? 0})`,
      `- Homework completion rate: ${s.homework_completion_pct != null ? `${s.homework_completion_pct}%` : "no data yet"}`,
      `- Overall school health score: ${r.health_score != null ? `${r.health_score}/100` : "not enough data yet"}`,
    ];
    if (Array.isArray(r.grade_wise) && r.grade_wise.length) lines.push(`- Grade-wise average scores: ${r.grade_wise.map((g: any) => `${g.grade}: ${g.avg_score}%`).join(", ")}`);
    if (Array.isArray(r.action_items) && r.action_items.length) lines.push(`- Flagged action items: ${r.action_items.map((a: any) => a.text).join(" | ")}`);
    return `ANALYTICS (this school's executive report only):\n${lines.join("\n")}`;
  });
}

// ---- 6. Surveys ----
async function buildSurveysContext(ctx: Ctx): Promise<string> {
  return safe("SURVEYS", async () => {
    if (!ctx.schoolId) return "SURVEYS: No school on file.";
    const { data: surveys } = await ctx.supabase
      .from("surveys").select("id, title, status, target_type, is_anonymous, created_at")
      .eq("school_id", ctx.schoolId).order("created_at", { ascending: false }).limit(15);
    if (!surveys || surveys.length === 0) return "SURVEYS: No surveys have been created for this school.";
    const surveyIds = surveys.map((s: any) => s.id);
    const { data: receipts } = await ctx.supabase.from("survey_receipts").select("survey_id").in("survey_id", surveyIds);
    const counts = new Map<string, number>();
    (receipts || []).forEach((r: any) => counts.set(r.survey_id, (counts.get(r.survey_id) || 0) + 1));
    const rows = surveys.map((s: any) => `- "${s.title}" [${s.status}] target: ${s.target_type}${s.is_anonymous ? " (anonymous)" : ""}, ${counts.get(s.id) || 0} response(s), created ${fmtDate(s.created_at)}`);
    return `SURVEYS (this school's surveys only):\n${rows.join("\n")}`;
  });
}

// ---- 7. Academic Calendar ----
async function buildAcademicCalendarContext(ctx: Ctx): Promise<string> {
  return safe("ACADEMIC CALENDAR", async () => {
    if (!ctx.schoolId) return "ACADEMIC CALENDAR: No school on file.";
    const { data } = await ctx.supabase
      .from("academic_calendar_events").select("title, event_type, start_date, end_date")
      .eq("school_id", ctx.schoolId).order("start_date", { ascending: true });
    if (!data || data.length === 0) return "ACADEMIC CALENDAR: No events on the school calendar.";
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = data.filter((e: any) => e.end_date >= today).slice(0, 12);
    const past = data.filter((e: any) => e.end_date < today).slice(-5);
    const fmtRow = (e: any) => `- [${e.event_type}] "${e.title}": ${fmtDate(e.start_date)}${e.end_date && e.end_date !== e.start_date ? ` to ${fmtDate(e.end_date)}` : ""}`;
    const parts: string[] = [];
    if (upcoming.length) parts.push(`Upcoming:\n${upcoming.map(fmtRow).join("\n")}`);
    if (past.length) parts.push(`Recently past:\n${past.map(fmtRow).join("\n")}`);
    return `ACADEMIC CALENDAR (this school's calendar only):\n${parts.join("\n")}`;
  });
}

// ---- 8. Semester Engine ----
async function buildSemesterEngineContext(ctx: Ctx): Promise<string> {
  return safe("SEMESTER ENGINE", async () => {
    if (!ctx.schoolId) return "SEMESTER ENGINE: No school on file.";
    const [{ data: years }, { data: semesters }] = await Promise.all([
      ctx.supabase.from("academic_years").select("id, name, is_active").eq("school_id", ctx.schoolId).order("created_at", { ascending: false }),
      ctx.supabase.from("academic_semesters").select("id, name, academic_year_id, is_active").eq("school_id", ctx.schoolId).order("created_at", { ascending: false }),
    ]);
    if (!years || years.length === 0) return "SEMESTER ENGINE: No academic years have been set up.";
    const activeYear = years.find((y: any) => y.is_active);
    const activeSemesters = (semesters || []).filter((s: any) => s.is_active);
    return `SEMESTER ENGINE (this school only):\n- Active academic year: ${activeYear?.name || "none set"}\n- Academic years on file: ${years.map((y: any) => y.name).join(", ")}\n- Active semester(s): ${activeSemesters.map((s: any) => s.name).join(", ") || "none"}\n- Total semesters on file: ${(semesters || []).length}`;
  });
}

// ---- 9. Report Cards ----
async function buildReportCardsContext(ctx: Ctx): Promise<string> {
  return safe("REPORT CARDS", async () => {
    if (!ctx.schoolId) return "REPORT CARDS: No school on file.";
    const { data: students } = await ctx.supabase.from("students").select("id").eq("school_id", ctx.schoolId);
    const studentIds = (students || []).map((s: any) => s.id);
    if (studentIds.length === 0) return "REPORT CARDS: No students on file.";
    const { data: gpas } = await ctx.supabase
      .from("student_gpa").select("gpa").in("student_id", studentIds).not("gpa", "is", null).limit(3000);
    if (!gpas || gpas.length === 0) return "REPORT CARDS: No GPA/report card data available yet.";
    const avgGpa = (gpas.reduce((s: number, g: any) => s + Number(g.gpa || 0), 0) / gpas.length).toFixed(2);
    return `REPORT CARDS (this school only):\n- Report cards generated: ${gpas.length}\n- Average GPA: ${avgGpa}`;
  });
}

// ---- 10. Alumni ----
async function buildAlumniContext(ctx: Ctx): Promise<string> {
  return safe("ALUMNI", async () => {
    if (!ctx.schoolId) return "ALUMNI: No school on file.";
    const { data } = await ctx.supabase
      .from("alumni_profiles")
      .select("batch_year, graduated_class, graduation_date, current_occupation, higher_education")
      .eq("school_id", ctx.schoolId).order("graduation_date", { ascending: false });
    if (!data || data.length === 0) return "ALUMNI: No alumni records for this school yet.";
    const withOccupation = data.filter((a: any) => a.current_occupation && a.current_occupation.trim()).length;
    const withHigherEd = data.filter((a: any) => a.higher_education && a.higher_education.trim()).length;
    const recent = data.slice(0, 5).map((a: any) => `- Batch ${a.batch_year}, class ${a.graduated_class}, graduated ${fmtDate(a.graduation_date)}${a.higher_education ? `, higher education: ${a.higher_education}` : ""}${a.current_occupation ? `, occupation: ${a.current_occupation}` : ""}`);
    return `ALUMNI (this school only):\n- Total alumni on record: ${data.length}\n- By batch year: ${tally(data, "batch_year", "unknown")}\n- By graduating class: ${tally(data, "graduated_class", "unknown")}\n- Occupation recorded for ${withOccupation}, higher-education recorded for ${withHigherEd}\nMost recent:\n${recent.join("\n")}`;
  });
}

// ---- 11. Marketplace ----
async function buildMarketplaceContext(ctx: Ctx): Promise<string> {
  return safe("MARKETPLACE", async () => {
    if (!ctx.schoolId) return "MARKETPLACE: No school on file.";
    const { data } = await ctx.supabase
      .from("marketplace_listings").select("content_type, status, price, title")
      .eq("publisher_school_id", ctx.schoolId);
    if (!data || data.length === 0) return "MARKETPLACE: No marketplace listings published by this school.";
    const titles = data.slice(0, 8).map((l: any) => `- "${l.title}" [${l.status}] ${l.content_type}${l.price != null ? `, price ${l.price}` : ""}`);
    return `MARKETPLACE (listings published by this school only):\nTotal: ${data.length}\nBy status: ${tally(data, "status")}\nBy type: ${tally(data, "content_type")}\n${titles.join("\n")}`;
  });
}

// ---- 12. Exam Seating ----
async function buildExamSeatingContext(ctx: Ctx): Promise<string> {
  return safe("EXAM SEATING", async () => {
    if (!ctx.schoolId) return "EXAM SEATING: No school on file.";
    const [{ data: halls }, { data: schedules }, { data: seats }] = await Promise.all([
      ctx.supabase.from("exam_halls").select("id, name").eq("school_id", ctx.schoolId),
      ctx.supabase.from("exam_schedules").select("id, subject, exam_date, classes").eq("school_id", ctx.schoolId).order("exam_date", { ascending: false }).limit(15),
      ctx.supabase.from("seating_arrangements").select("exam_schedule_id").eq("school_id", ctx.schoolId),
    ]);
    if (!schedules || schedules.length === 0) return "EXAM SEATING: No exam schedules on file.";
    const seated = new Set((seats || []).map((s: any) => s.exam_schedule_id));
    const rows = schedules.map((s: any) => `- ${s.subject} on ${fmtDate(s.exam_date)}, classes: ${(s.classes || []).join(", ") || "—"} - seating ${seated.has(s.id) ? "assigned" : "NOT assigned"}`);
    return `EXAM SEATING (this school only, ${halls?.length ?? 0} hall(s): ${(halls || []).map((h: any) => h.name).join(", ") || "none"}):\n${rows.join("\n")}`;
  });
}

// ---- 13. Hall Tickets ----
async function buildHallTicketsContext(ctx: Ctx): Promise<string> {
  return safe("HALL TICKETS", async () => {
    if (!ctx.schoolId) return "HALL TICKETS: No school on file.";
    const { data: schedules } = await ctx.supabase
      .from("exam_schedules").select("id, subject, exam_date, classes")
      .eq("school_id", ctx.schoolId).order("exam_date", { ascending: false }).limit(15);
    if (!schedules || schedules.length === 0) return "HALL TICKETS: No exams scheduled.";
    const ids = schedules.map((s: any) => s.id);
    const { data: seats } = ids.length
      ? await ctx.supabase.from("seating_arrangements").select("exam_schedule_id").in("exam_schedule_id", ids)
      : { data: [] };
    const countBy = new Map<string, number>();
    (seats || []).forEach((s: any) => countBy.set(s.exam_schedule_id, (countBy.get(s.exam_schedule_id) || 0) + 1));
    const rows = schedules.map((s: any) => `- ${s.subject} on ${fmtDate(s.exam_date)}: ${countBy.get(s.id) || 0} hall ticket(s)/seat(s) generated`);
    return `HALL TICKETS (this school only):\n${rows.join("\n")}`;
  });
}

// ---- 14. Invigilation ----
async function buildInvigilationContext(ctx: Ctx): Promise<string> {
  return safe("INVIGILATION", async () => {
    if (!ctx.schoolId) return "INVIGILATION: No school on file.";
    const [{ data: assignments }, { data: schedules }, { data: halls }, { data: teachers }] = await Promise.all([
      ctx.supabase.from("invigilation_assignments").select("exam_schedule_id, hall_id, teacher_id").eq("school_id", ctx.schoolId),
      ctx.supabase.from("exam_schedules").select("id, subject, exam_date").eq("school_id", ctx.schoolId).order("exam_date", { ascending: false }).limit(15),
      ctx.supabase.from("exam_halls").select("id, name").eq("school_id", ctx.schoolId),
      ctx.supabase.from("profiles").select("id, full_name").eq("school_id", ctx.schoolId).eq("role", "teacher"),
    ]);
    if (!schedules || schedules.length === 0) return "INVIGILATION: No exam schedules on file, so nothing to invigilate yet.";
    const hallName = new Map((halls || []).map((h: any) => [h.id, h.name]));
    const teacherName = new Map((teachers || []).map((t: any) => [t.id, t.full_name]));
    const byExam = new Map<string, any[]>();
    (assignments || []).forEach((a: any) => {
      const list = byExam.get(a.exam_schedule_id) || [];
      list.push(a);
      byExam.set(a.exam_schedule_id, list);
    });
    const dutyCount = new Map<string, number>();
    (assignments || []).forEach((a: any) => dutyCount.set(a.teacher_id, (dutyCount.get(a.teacher_id) || 0) + 1));
    const rows = schedules.map((s: any) => {
      const list = byExam.get(s.id) || [];
      const detail = list.map((a: any) => `${teacherName.get(a.teacher_id) || "Unknown teacher"} in ${hallName.get(a.hall_id) || "unassigned hall"}`).join("; ");
      return `- ${s.subject} on ${fmtDate(s.exam_date)}: ${list.length} invigilator(s)${detail ? ` - ${detail}` : " - NONE assigned"}`;
    });
    const busiest = Array.from(dutyCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, n]) => `${teacherName.get(id) || "Unknown"}: ${n} duty/duties`).join(", ");
    return `INVIGILATION (this school only):\n- Total invigilation assignments: ${(assignments || []).length} across ${teachers?.length ?? 0} teacher(s)\n- Teachers with most duties: ${busiest || "none assigned yet"}\n${rows.join("\n")}`;
  });
}

// ---- 15. Houses ----
async function buildHousesContext(ctx: Ctx): Promise<string> {
  return safe("HOUSES", async () => {
    if (!ctx.schoolId) return "HOUSES: No school on file.";
    const { data: board } = await ctx.supabase
      .from("house_leaderboard").select("name, total_points, student_count")
      .eq("school_id", ctx.schoolId).order("total_points", { ascending: false });
    if (!board || board.length === 0) return "HOUSES: No houses have been set up.";
    const rows = board.map((h: any, i: number) => `- #${i + 1} ${h.name}: ${h.total_points} points, ${h.student_count ?? "?"} students`);
    return `HOUSES (this school only):\n${rows.join("\n")}`;
  });
}

// ---- 16. Student Transfers ----
async function buildStudentTransfersContext(ctx: Ctx): Promise<string> {
  return safe("STUDENT TRANSFERS", async () => {
    if (!ctx.schoolId) return "STUDENT TRANSFERS: No school on file.";
    const { data } = await ctx.supabase
      .from("student_transfers")
      .select("transfer_type, status, transfer_date, new_class, new_section, reason, previous_school_name, new_school_name, created_at, students:student_id(full_name)")
      .or(`from_school_id.eq.${ctx.schoolId},to_school_id.eq.${ctx.schoolId}`)
      .order("created_at", { ascending: false }).limit(40);
    if (!data || data.length === 0) return "STUDENT TRANSFERS: No transfer requests involving this school.";
    const pending = data.filter((t: any) => t.status === "pending");
    const rows = data.slice(0, 10).map((t: any) => `- ${t.students?.full_name || "A student"} [${t.transfer_type}] status ${t.status}, dated ${fmtDate(t.transfer_date)}${t.new_class ? `, moving to class ${t.new_class}${t.new_section ? ` ${t.new_section}` : ""}` : ""}${t.new_school_name ? `, to ${t.new_school_name}` : ""}${t.previous_school_name ? `, from ${t.previous_school_name}` : ""}${t.reason ? ` - reason: ${t.reason}` : ""}`);
    return `STUDENT TRANSFERS (transfers in or out of this school only):\n- Total on file: ${data.length}, pending approval: ${pending.length}\n- By status: ${tally(data, "status")}\n- By type: ${tally(data, "transfer_type")}\nMost recent:\n${rows.join("\n")}`;
  });
}

// ---- 17. ID Cards ----
async function buildIDCardsContext(ctx: Ctx): Promise<string> {
  return safe("ID CARDS", async () => {
    if (!ctx.schoolId) return "ID CARDS: No school on file.";
    const { data: students } = await ctx.supabase
      .from("students").select("class, photo_url, blood_group, admission_number, parent_phone")
      .eq("school_id", ctx.schoolId).eq("status", "active");
    if (!students || students.length === 0) return "ID CARDS: No active students on file, so no ID cards can be generated.";
    const missingPhoto = students.filter((s: any) => !s.photo_url).length;
    const missingAdmNo = students.filter((s: any) => !s.admission_number).length;
    const missingBlood = students.filter((s: any) => !s.blood_group).length;
    const missingParentPhone = students.filter((s: any) => !s.parent_phone).length;
    return `ID CARDS (this school only - cards are generated on demand from active student records):\n- Active students eligible for an ID card: ${students.length}\n- By class: ${tally(students, "class", "unassigned")}\n- Records missing a photo: ${missingPhoto}\n- Records missing an admission number: ${missingAdmNo}\n- Records missing a blood group: ${missingBlood}\n- Records missing a parent phone: ${missingParentPhone}`;
  });
}

// ---- 18. Lifecycle Timeline ----
async function buildLifecycleContext(ctx: Ctx): Promise<string> {
  return safe("LIFECYCLE TIMELINE", async () => {
    if (!ctx.schoolId) return "LIFECYCLE TIMELINE: No school on file.";
    const studentIds = await schoolStudentProfileIds(ctx);
    if (studentIds.length === 0) return "LIFECYCLE TIMELINE: No students on file.";
    const { data } = await ctx.supabase
      .from("student_lifecycle_events").select("event_type, event_date, details")
      .in("student_id", studentIds.slice(0, 500))
      .order("event_date", { ascending: false }).limit(200);
    if (!data || data.length === 0) return "LIFECYCLE TIMELINE: No lifecycle events recorded for this school's students yet.";
    const thisYear = new Date().getFullYear();
    const thisYearCount = data.filter((e: any) => (e.event_date || "").startsWith(String(thisYear))).length;
    const recent = data.slice(0, 8).map((e: any) => `- ${e.event_type} on ${fmtDate(e.event_date)}`);
    return `LIFECYCLE TIMELINE (this school's students only, ${data.length} most recent events):\n- By event type: ${tally(data, "event_type")}\n- Events recorded in ${thisYear}: ${thisYearCount}\nMost recent:\n${recent.join("\n")}`;
  });
}

// ---- 19. Syllabus Coverage ----
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
        ctx.supabase.from("curriculum_chapters").select("id, books!inner(class_name, subject, school_id)").ilike("books.class_name", className).ilike("books.subject", subject).eq("books.school_id", ctx.schoolId),
        ctx.supabase.from("lessons").select("id", { count: "exact", head: true }).eq("teacher_id", a.teacher_id).ilike("class_level", className).ilike("subject", subject).eq("school_id", ctx.schoolId),
        ctx.supabase.from("lessons").select("id", { count: "exact", head: true }).eq("teacher_id", a.teacher_id).ilike("class_level", className).ilike("subject", subject).is("school_id", null),
      ]);
      const total = chapters?.length ?? 0;
      const coveredCount = (covered ?? 0) + (coveredNoSchool ?? 0);
      const pct = total > 0 ? Math.min(100, Math.round((coveredCount / total) * 100)) : null;
      return { teacher: a.profiles?.full_name || "Unknown teacher", className, section: a.classes.section, subject, pct };
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

// ---- 20. School Quality Index ----
async function buildSchoolQualityIndexContext(ctx: Ctx): Promise<string> {
  return safe("SCHOOL QUALITY INDEX", async () => {
    if (!ctx.schoolId) return "SCHOOL QUALITY INDEX: No school on file.";
    const resp = await fetchWithTimeout(
      `${ctx.supabaseUrl}/functions/v1/school-quality-index`,
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: ctx.authHeader }, body: JSON.stringify({ school_id: ctx.schoolId }) },
      10000,
    );
    if (!resp.ok) return "SCHOOL QUALITY INDEX: Not available right now.";
    const r = await resp.json();
    if (r?.error) return "SCHOOL QUALITY INDEX: Not available right now.";
    return `SCHOOL QUALITY INDEX (this school only):\n${JSON.stringify(r).slice(0, 1200)}`;
  });
}

// ---- 21. Competency Heatmap ----
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
      .from("competency_assessments").select("student_id, competency_id, class_id, proficiency, assessed_date")
      .in("competency_id", competencyIds).in("class_id", classIds).order("assessed_date", { ascending: false });
    if (!assessments || assessments.length === 0) return "COMPETENCY HEATMAP: No competency assessments recorded yet.";
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

// ---- 22. Competency Definitions ----
async function buildCompetencyDefinitionsContext(ctx: Ctx): Promise<string> {
  return safe("COMPETENCY DEFINITIONS", async () => {
    if (!ctx.schoolId) return "COMPETENCY DEFINITIONS: No school on file.";
    const { data } = await ctx.supabase
      .from("competencies").select("subject, name, grade_level")
      .eq("school_id", ctx.schoolId).order("subject", { ascending: true }).order("name", { ascending: true });
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

// ---- 23. Rotation Schedules ----
async function buildRotationContext(ctx: Ctx): Promise<string> {
  return safe("ROTATION SCHEDULES", async () => {
    if (!ctx.schoolId) return "ROTATION SCHEDULES: No school on file.";
    const { data: cycles } = await ctx.supabase
      .from("rotation_cycles").select("id, name, is_active, created_at")
      .eq("school_id", ctx.schoolId).order("created_at", { ascending: false });
    if (!cycles || cycles.length === 0) return "ROTATION SCHEDULES: No rotation cycles have been set up.";
    const cycleIds = cycles.map((c: any) => c.id);
    const [{ data: blocks }, { data: groups }] = await Promise.all([
      ctx.supabase.from("rotation_blocks").select("rotation_cycle_id").in("rotation_cycle_id", cycleIds),
      ctx.supabase.from("rotation_groups").select("rotation_cycle_id").in("rotation_cycle_id", cycleIds),
    ]);
    const blockCounts = new Map<string, number>();
    (blocks || []).forEach((b: any) => blockCounts.set(b.rotation_cycle_id, (blockCounts.get(b.rotation_cycle_id) || 0) + 1));
    const groupCounts = new Map<string, number>();
    (groups || []).forEach((g: any) => groupCounts.set(g.rotation_cycle_id, (groupCounts.get(g.rotation_cycle_id) || 0) + 1));
    const rows = cycles.map((c: any) => `- "${c.name}"${c.is_active ? " (active)" : " (inactive)"}: ${blockCounts.get(c.id) || 0} block(s), ${groupCounts.get(c.id) || 0} group(s)`);
    return `ROTATION SCHEDULES (this school only):\n${rows.join("\n")}`;
  });
}

// ---- 24. Special Education (SEN) ----
async function buildSENContext(ctx: Ctx): Promise<string> {
  return safe("SPECIAL EDUCATION (SEN)", async () => {
    if (!ctx.schoolId) return "SEN: No school on file.";
    const { data: senStudents } = await ctx.supabase
      .from("sen_students").select("id, category, status").eq("school_id", ctx.schoolId);
    if (!senStudents || senStudents.length === 0) return "SEN: No students currently enrolled in the SEN program.";
    const senIds = senStudents.map((s: any) => s.id);
    const { count: planCount } = senIds.length
      ? await ctx.supabase.from("iep_plans").select("*", { count: "exact", head: true }).in("sen_student_id", senIds)
      : { count: 0 };
    return `SEN (this school only):\n- Total SEN students: ${senStudents.length}\n- By category: ${tally(senStudents, "category", "Unspecified")}\n- By status: ${tally(senStudents, "status", "Unspecified")}\n- Active IEP plans: ${planCount ?? 0}`;
  });
}

// ---- 25. Electives ----
async function buildElectivesContext(ctx: Ctx): Promise<string> {
  return safe("ELECTIVES", async () => {
    if (!ctx.schoolId) return "ELECTIVES: No school on file.";
    const { data: electives } = await ctx.supabase
      .from("electives").select("id, name, subject, capacity")
      .eq("school_id", ctx.schoolId).order("created_at", { ascending: false }).limit(20);
    if (!electives || electives.length === 0) return "ELECTIVES: No electives have been set up.";
    const ids = electives.map((e: any) => e.id);
    const { data: choices } = ids.length
      ? await ctx.supabase.from("student_elective_choices").select("elective_id").in("elective_id", ids)
      : { data: [] };
    const countBy = new Map<string, number>();
    (choices || []).forEach((c: any) => countBy.set(c.elective_id, (countBy.get(c.elective_id) || 0) + 1));
    const rows = electives.map((e: any) => `- "${e.name}"${e.subject ? ` (${e.subject})` : ""}: ${countBy.get(e.id) || 0}${e.capacity ? `/${e.capacity}` : ""} enrolled`);
    return `ELECTIVES (this school only):\n${rows.join("\n")}`;
  });
}

// ---- 26. Branch Management ----
async function buildBranchManagementContext(ctx: Ctx): Promise<string> {
  return safe("BRANCH MANAGEMENT", async () => {
    if (!ctx.schoolId) return "BRANCH MANAGEMENT: No school on file.";
    const { data } = await ctx.supabase
      .from("branches").select("name, code, is_active")
      .eq("school_id", ctx.schoolId).order("created_at", { ascending: false });
    if (!data || data.length === 0) return "BRANCH MANAGEMENT: No branches have been set up for this school.";
    const rows = data.map((b: any) => `- ${b.name}${b.code ? ` (${b.code})` : ""}: ${b.is_active ? "active" : "inactive"}`);
    return `BRANCH MANAGEMENT (this school only):\n${rows.join("\n")}`;
  });
}

// ---- 27. Resource Analytics ----
async function buildResourceAnalyticsContext(ctx: Ctx): Promise<string> {
  return safe("RESOURCE ANALYTICS", async () => {
    if (!ctx.schoolId) return "RESOURCE ANALYTICS: No school on file.";
    const { data: facilities } = await ctx.supabase
      .from("facilities").select("id, name, capacity").eq("school_id", ctx.schoolId);
    if (!facilities || facilities.length === 0) return "RESOURCE ANALYTICS: No facilities have been set up.";
    const facilityIds = facilities.map((f: any) => f.id);
    const today = new Date().toISOString().slice(0, 10);
    const { data: bookings } = facilityIds.length
      ? await ctx.supabase.from("facility_bookings").select("facility_id, booking_date").in("facility_id", facilityIds).gte("booking_date", today)
      : { data: [] };
    const countBy = new Map<string, number>();
    (bookings || []).forEach((b: any) => countBy.set(b.facility_id, (countBy.get(b.facility_id) || 0) + 1));
    const rows = facilities.map((f: any) => `- ${f.name}${f.capacity ? ` (capacity ${f.capacity})` : ""}: ${countBy.get(f.id) || 0} upcoming booking(s)`);
    return `RESOURCE ANALYTICS (this school only, facility bookings from today onward):\n${rows.join("\n")}`;
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
    // exactly as it would for the school admin using the app directly.
    const supabase = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ type: "message", text: "I couldn't verify who you are - please sign in again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const authUserId = userData.user.id;

    const { data: profile } = await supabase
      .from("profiles").select("id, full_name, school_id, role").eq("id", authUserId).maybeSingle();

    if (!profile || profile.role !== "school_admin") {
      return new Response(JSON.stringify({ type: "message", text: "This assistant is only available to School Admin accounts." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve the school the same way SuperAdminPanel does: the
    // school_admin_schools mapping first, profiles.school_id as fallback.
    let schoolId: string | null = null;
    const { data: mapping } = await supabase
      .from("school_admin_schools").select("school_id").eq("school_admin_id", authUserId).maybeSingle();
    schoolId = mapping?.school_id ?? profile.school_id ?? null;

    let schoolName: string | null = null;
    if (schoolId) {
      const { data: school } = await supabase.from("schools").select("name").eq("id", schoolId).maybeSingle();
      schoolName = school?.name ?? null;
    }

    const ctx: Ctx = {
      supabase,
      authUserId,
      schoolId,
      schoolName,
      fullName: profile.full_name ?? null,
      authHeader,
      supabaseUrl,
    };

    const contextBlocks = await Promise.all([
      buildAdmissionsContext(ctx),
      buildTransportContext(ctx),
      buildCommunicationContext(ctx),
      buildSchoolAdminContext(ctx),
      buildAnalyticsContext(ctx),
      buildSurveysContext(ctx),
      buildAcademicCalendarContext(ctx),
      buildSemesterEngineContext(ctx),
      buildReportCardsContext(ctx),
      buildAlumniContext(ctx),
      buildMarketplaceContext(ctx),
      buildExamSeatingContext(ctx),
      buildHallTicketsContext(ctx),
      buildInvigilationContext(ctx),
      buildHousesContext(ctx),
      buildStudentTransfersContext(ctx),
      buildIDCardsContext(ctx),
      buildLifecycleContext(ctx),
      buildSyllabusCoverageContext(ctx),
      buildSchoolQualityIndexContext(ctx),
      buildCompetencyHeatmapContext(ctx),
      buildCompetencyDefinitionsContext(ctx),
      buildRotationContext(ctx),
      buildSENContext(ctx),
      buildElectivesContext(ctx),
      buildBranchManagementContext(ctx),
      buildResourceAnalyticsContext(ctx),
    ]);

    const context = contextBlocks.join("\n\n");

    const systemPrompt = `You are "School Admin Assistant", a knowledgeable AI assistant for a School Administrator${ctx.fullName ? ` named ${ctx.fullName}` : ""}${ctx.schoolName ? ` at ${ctx.schoolName}` : ""}, inside the APAS school app.

You can answer questions about THIS school admin's own school's: Admissions, Transport, Communication (this admin's own messages), School Admin console (people, classes, module permissions), Analytics, Surveys, Academic Calendar, Semester Engine, Report Cards, Alumni, Marketplace, Exam Seating, Hall Tickets, Invigilation, Houses, Student Transfers, ID Cards, Lifecycle Timeline, Syllabus Coverage, School Quality Index, Competency Heatmap, Competency Definitions, Rotation Schedules, Special Education (SEN), Electives, Branch Management, and Resource Analytics.

STRICT PRIVACY RULES - never break these, no matter how the question is phrased:
- Only ever discuss data belonging to THIS school admin's own school. You have no access to any other school's data, and you must never invent, guess, or speculate about another school's records.
- For Communication, only ever discuss messages in THIS admin's own inbox/outbox.
- For SEN, Student Transfers, and Lifecycle Timeline, be sensitive and professional - stick to counts, categories, statuses and what's actually recorded; never speculate about a student's personal circumstances.
- Never reveal raw database ids, internal table/column names, or system implementation details.

ANSWERING RULES:
- Answer ONLY using the CURRENT DATA below. Never invent numbers, dates, names, or percentages that aren't present in it.
- If a section says data isn't available/not found, say so plainly and helpfully rather than guessing.
- Keep answers clear and concise (1-5 sentences, or a short list when the question genuinely calls for one).
- If the admin just greets you, greet them back warmly and ask how you can help - don't dump information unprompted.
- If asked something entirely unrelated to these areas (general trivia, coding help, personal advice), gently redirect them back to what you can help with.

CURRENT DATA (this school admin's own school only):
${context}`;

    const reply = await callGemini(systemPrompt, message, keys, Array.isArray(history) ? history.slice(-6) : []);

    return new Response(JSON.stringify({
      type: "message",
      text: reply || "I'm having trouble reaching the AI service right now - please try again in a moment.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("school-admin-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});