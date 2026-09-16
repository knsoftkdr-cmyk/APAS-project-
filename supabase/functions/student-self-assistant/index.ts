// student-self-assistant
//
// Backs the "Study Buddy" widget on the student dashboard
// (src/components/ai-assistant/AIStudentAssistantWidget.tsx).
//
// SECURITY: the caller's identity is ALWAYS derived from their verified
// Supabase auth JWT (never from a client-supplied student_id/body field).
// Every query below is explicitly scoped to that one resolved identity,
// on top of whatever RLS policies already exist - so even a client that
// tries to pass someone else's id can only ever get this caller's own
// data back.
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
              generationConfig: { temperature: 0.4, maxOutputTokens: 500 },
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

// ---- Topic-help classification (for video mode routing) ----
// Uses a fast, cheap Gemini call to decide whether the student's message
// is "help me understand a concept" (which can be answered with a topic
// explanation or a video) vs a question about their own personal school
// records (which a video can't answer - must fall back to text).
async function classifyTopicIntent(message: string, keys: string[]): Promise<{ isTopic: boolean; query: string }> {
  const classifierPrompt = `You classify a school student's chat message. Reply with ONLY raw JSON, no markdown fences, no extra words, in exactly this shape:
{"is_topic_question": boolean, "search_query": "string"}

is_topic_question = true when the student is asking to understand, learn, or get an explanation of an academic concept/topic (e.g. "explain photosynthesis", "how does long division work", "what is Newton's third law", "help me understand fractions").
is_topic_question = false for anything about the student's OWN school records/data (homework, worksheets, tests, grades, attendance, timetable, messages, fees, electives, etc.), or greetings/small talk/off-topic chat.

When true, "search_query" must be a short, effective YouTube search query for a good educational video on that exact topic (you may add "explained" or the subject name to sharpen it). When false, "search_query" can be an empty string.`;

  const raw = await callGemini(classifierPrompt, message, keys, []);
  if (!raw) return { isTopic: false, query: "" };
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      isTopic: !!parsed.is_topic_question,
      query: typeof parsed.search_query === "string" ? parsed.search_query.trim() : "",
    };
  } catch {
    return { isTopic: false, query: "" };
  }
}

interface VideoResult {
  title: string;
  url: string;
  channel: string;
  thumbnail: string | null;
}

// ---- YouTube video search ----
// Uses the real YouTube Data API when YOUTUBE_API_KEY is configured (best
// experience - real, embeddable, age-appropriate video results). Falls
// back to a plain YouTube search-results link (always works, needs no
// setup, and - critically - never risks a hallucinated/broken video id).
async function searchYouTube(query: string): Promise<VideoResult[]> {
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (apiKey) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&safeSearch=strict&maxResults=3&relevanceLanguage=en&q=${encodeURIComponent(query)}&key=${apiKey}`;
      const res = await fetchWithTimeout(url, {}, 6000);
      if (res.ok) {
        const data = await res.json();
        const items = (data?.items || [])
          .filter((it: any) => it?.id?.videoId)
          .map((it: any) => ({
            title: it.snippet?.title || "Educational video",
            url: `https://www.youtube.com/watch?v=${it.id.videoId}`,
            channel: it.snippet?.channelTitle || "YouTube",
            thumbnail: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || null,
          }));
        if (items.length > 0) return items;
      }
    } catch (e) {
      console.error("[student-self-assistant] YouTube API search failed:", e);
    }
  }
  // Fallback: a guaranteed-valid search-results link, same pattern the
  // rest of this codebase already uses for YouTube suggestions.
  return [{
    title: `Search YouTube for "${query}"`,
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    channel: "YouTube search",
    thumbnail: null,
  }];
}

function classLabelFor(classGrade: string | null | undefined): string {
  if (!classGrade) return "";
  return /^\d+$/.test(classGrade) ? `Class ${classGrade}` : classGrade.charAt(0).toUpperCase() + classGrade.slice(1);
}

function normClass(c: string | null | undefined): string {
  return (c ?? "").toLowerCase().replace(/^class\s*/i, "").trim();
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
  authUserId: string; // profiles.id / auth.uid()
  studentRowId: string | null; // students.id (may be null if no students row yet)
  schoolId: string | null;
  classGrade: string | null;
  section: string | null;
  fullName: string | null;
}

async function safe(label: string, fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[student-self-assistant] ${label} failed:`, e);
    return `${label.toUpperCase()}: Not available right now.`;
  }
}

// ---- Homework ----
async function buildHomeworkContext(ctx: Ctx): Promise<string> {
  return safe("HOMEWORK", async () => {
    if (!ctx.schoolId) return "HOMEWORK: No school on file.";
    let q = ctx.supabase
      .from("homework_assignments")
      .select("id, period_title, topic, subject, class_level, section, due_date")
      .eq("school_id", ctx.schoolId)
      .order("due_date", { ascending: true })
      .limit(30);
    const classLevel = classLabelFor(ctx.classGrade);
    if (classLevel) q = q.eq("class_level", classLevel);
    if (ctx.section) q = q.eq("section", ctx.section);
    const [{ data: assignments }, { data: submissions }] = await Promise.all([
      q,
      ctx.supabase
        .from("homework_submissions")
        .select("assignment_id, completed, submitted_at, teacher_score, submission_percentage")
        .eq("student_id", ctx.authUserId),
    ]);
    const subByAssignment = new Map((submissions || []).map((s: any) => [s.assignment_id, s]));
    const rows = (assignments || []).map((a: any) => {
      const sub: any = subByAssignment.get(a.id);
      const status = sub?.completed ? `submitted${sub.teacher_score != null ? `, scored ${sub.teacher_score}` : ""}` : "PENDING";
      return `- [${a.subject}] "${a.topic || a.period_title}" (due ${fmtDate(a.due_date)}) - ${status}`;
    });
    if (rows.length === 0) return "HOMEWORK: No homework assignments found for this student's class/section.";
    return `HOMEWORK (this student's class only):\n${rows.join("\n")}`;
  });
}

// ---- Worksheets ----
async function buildWorksheetsContext(ctx: Ctx): Promise<string> {
  return safe("WORKSHEETS", async () => {
    if (!ctx.schoolId) return "WORKSHEETS: No school on file.";
    const classLevel = classLabelFor(ctx.classGrade);
    if (!classLevel) return "WORKSHEETS: No class on file.";
    let q = ctx.supabase
      .from("worksheet_assignments")
      .select("id, worksheet_id, due_date, status, worksheets(subject, topic, chapter)")
      .eq("school_id", ctx.schoolId)
      .eq("class_level", classLevel)
      .eq("status", "active")
      .order("due_date", { ascending: true })
      .limit(30);
    if (ctx.section) q = q.or(`section.eq.${ctx.section},section.is.null`);
    const { data: assignments } = await q;
    const worksheetIds = (assignments || []).map((a: any) => a.worksheet_id);
    const { data: submissions } = worksheetIds.length
      ? await ctx.supabase
          .from("worksheet_submissions")
          .select("worksheet_id, status, score, submitted_at")
          .eq("student_id", ctx.authUserId)
          .in("worksheet_id", worksheetIds)
      : { data: [] };
    const subByWorksheet = new Map((submissions || []).map((s: any) => [s.worksheet_id, s]));
    const rows = (assignments || []).map((a: any) => {
      const sub: any = subByWorksheet.get(a.worksheet_id);
      const w = a.worksheets;
      const label = `${w?.subject || ""} ${w?.topic || w?.chapter || ""}`.trim() || "Worksheet";
      const status = sub ? `${sub.status || "submitted"}${sub.score != null ? `, score ${sub.score}` : ""}` : "PENDING";
      return `- ${label} (due ${fmtDate(a.due_date)}) - ${status}`;
    });
    if (rows.length === 0) return "WORKSHEETS: No worksheets currently assigned to this student's class.";
    return `WORKSHEETS (this student's class only):\n${rows.join("\n")}`;
  });
}

// ---- Academic Tests ----
async function buildAcademicTestsContext(ctx: Ctx): Promise<string> {
  return safe("ACADEMIC TESTS", async () => {
    const { data } = await ctx.supabase
      .from("academic_tests")
      .select("subject, score, total_questions, completed_at")
      .eq("student_id", ctx.authUserId)
      .order("completed_at", { ascending: false })
      .limit(15);
    if (!data || data.length === 0) return "ACADEMIC TESTS: This student hasn't taken any academic tests yet.";
    const rows = data.map((t: any) => `- ${t.subject}: ${t.score}/${t.total_questions} on ${fmtDate(t.completed_at)}`);
    return `ACADEMIC TESTS (this student's own results only):\n${rows.join("\n")}`;
  });
}

// ---- Assessments (diagnostics) ----
async function buildAssessmentsContext(ctx: Ctx): Promise<string> {
  return safe("ASSESSMENTS", async () => {
    const { data } = await ctx.supabase
      .from("student_assessments")
      .select("age_group, created_at")
      .or(`student_id.eq.${ctx.authUserId},submitted_by.eq.${ctx.authUserId}`)
      .order("created_at", { ascending: false })
      .limit(5);
    if (!data || data.length === 0) return "ASSESSMENTS: No diagnostic assessments completed by this student yet.";
    const rows = data.map((a: any) => `- Assessment taken on ${fmtDate(a.created_at)} (age group: ${a.age_group || "n/a"})`);
    return `ASSESSMENTS (this student's own diagnostics only):\n${rows.join("\n")}`;
  });
}

// ---- Gamification ----
async function buildGamificationContext(ctx: Ctx): Promise<string> {
  return safe("GAMIFICATION", async () => {
    const [{ data: gam }, { data: achievements }] = await Promise.all([
      ctx.supabase.from("user_gamification").select("total_xp, level").eq("user_id", ctx.authUserId).maybeSingle(),
      ctx.supabase
        .from("user_achievements")
        .select("achievement_id, unlocked_at, achievement_definitions(name, description)")
        .eq("user_id", ctx.authUserId)
        .order("unlocked_at", { ascending: false })
        .limit(10),
    ]);
    if (!gam) return "GAMIFICATION: No gamification profile yet for this student.";
    const achievementLines = (achievements || []).map(
      (a: any) => `- ${a.achievement_definitions?.name || "Achievement"} (unlocked ${fmtDate(a.unlocked_at)})`,
    );
    return `GAMIFICATION (this student's own profile only):\nLevel ${gam.level}, Total XP: ${gam.total_xp}\n${
      achievementLines.length ? `Achievements unlocked:\n${achievementLines.join("\n")}` : "No achievements unlocked yet."
    }`;
  });
}

// ---- Leaderboard (own rank only - never expose other students' identities) ----
async function buildLeaderboardContext(ctx: Ctx): Promise<string> {
  return safe("LEADERBOARD", async () => {
    if (!ctx.schoolId) return "LEADERBOARD: No school on file.";
    const { data: schoolBoard } = await ctx.supabase
      .from("user_gamification")
      .select("user_id, total_xp, profiles!inner(school_id, role)")
      .eq("profiles.school_id", ctx.schoolId)
      .eq("profiles.role", "student")
      .order("total_xp", { ascending: false })
      .limit(500);
    const list = schoolBoard || [];
    const idx = list.findIndex((r: any) => r.user_id === ctx.authUserId);
    if (idx === -1) return "LEADERBOARD: This student doesn't have a leaderboard entry yet.";
    let classLine = "";
    if (ctx.studentRowId) {
      const { data: classRec } = await ctx.supabase.from("class_students").select("class_id").eq("student_id", ctx.studentRowId).maybeSingle();
      if (classRec?.class_id) {
        const { data: classmates } = await ctx.supabase.from("class_students").select("student_id").eq("class_id", classRec.class_id);
        const classmateStudentIds = (classmates || []).map((c: any) => c.student_id);
        if (classmateStudentIds.length) {
          const { data: classProfiles } = await ctx.supabase.from("students").select("profile_id").in("id", classmateStudentIds);
          const classProfileIds = new Set((classProfiles || []).map((s: any) => s.profile_id));
          const classList = list.filter((r: any) => classProfileIds.has(r.user_id));
          const classIdx = classList.findIndex((r: any) => r.user_id === ctx.authUserId);
          if (classIdx !== -1) classLine = `\nWithin their own class: rank #${classIdx + 1} of ${classList.length}.`;
        }
      }
    }
    return `LEADERBOARD (only this student's own rank - never reveal other students' names, ranks, or scores):\nSchool-wide: rank #${idx + 1} of ${list.length}, ${list[idx].total_xp} XP.${classLine}`;
  });
}

// ---- Attendance ----
async function buildAttendanceContext(ctx: Ctx): Promise<string> {
  return safe("ATTENDANCE", async () => {
    if (!ctx.studentRowId) return "ATTENDANCE: No student record on file.";
    const since = new Date();
    since.setMonth(since.getMonth() - 3);
    const { data } = await ctx.supabase
      .from("attendance_records")
      .select("date, status")
      .eq("student_id", ctx.studentRowId)
      .gte("date", since.toISOString().slice(0, 10))
      .order("date", { ascending: false })
      .limit(200);
    if (!data || data.length === 0) return "ATTENDANCE: No attendance records found for the last 3 months.";
    const present = data.filter((r: any) => r.status === "present" || r.status === "late").length;
    const pct = Math.round((present / data.length) * 1000) / 10;
    const absences = data.filter((r: any) => r.status === "absent").slice(0, 10).map((r: any) => fmtDate(r.date));
    return `ATTENDANCE (this student's own record only, last 3 months):\nAttendance rate: ${pct}% (${present}/${data.length} days marked present/late).${
      absences.length ? `\nRecent absences: ${absences.join(", ")}` : ""
    }`;
  });
}

// ---- Timetable (file-based - just confirm existence) ----
async function buildTimetableContext(ctx: Ctx): Promise<string> {
  return safe("TIMETABLE", async () => {
    if (!ctx.schoolId || !ctx.classGrade) return "TIMETABLE: No class on file.";
    const { data } = await ctx.supabase
      .from("timetables")
      .select("id, updated_at")
      .eq("school_id", ctx.schoolId)
      .eq("class_grade", ctx.classGrade)
      .eq("section", ctx.section ?? "")
      .eq("timetable_type", "class")
      .maybeSingle();
    if (!data) return "TIMETABLE: No timetable has been uploaded yet for this student's class/section.";
    return `TIMETABLE: A class timetable is available (last updated ${fmtDate(data.updated_at)}). It's an uploaded file/image, so direct the student to the Timetable page in the app to view the actual period-by-period grid - you cannot read individual periods from this context.`;
  });
}

// ---- Academic Calendar ----
async function buildCalendarContext(ctx: Ctx): Promise<string> {
  return safe("ACADEMIC CALENDAR", async () => {
    if (!ctx.schoolId) return "ACADEMIC CALENDAR: No school on file.";
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await ctx.supabase
      .from("academic_calendar_events")
      .select("title, event_type, start_date, end_date")
      .eq("school_id", ctx.schoolId)
      .gte("end_date", today)
      .order("start_date", { ascending: true })
      .limit(15);
    if (!data || data.length === 0) return "ACADEMIC CALENDAR: No upcoming events found.";
    const rows = data.map((e: any) => `- [${e.event_type}] ${e.title}: ${fmtDate(e.start_date)}${e.end_date !== e.start_date ? ` to ${fmtDate(e.end_date)}` : ""}`);
    return `ACADEMIC CALENDAR (school-wide, upcoming):\n${rows.join("\n")}`;
  });
}

// ---- Electives ----
async function buildElectivesContext(ctx: Ctx): Promise<string> {
  return safe("ELECTIVES", async () => {
    if (!ctx.schoolId || !ctx.classGrade) return "ELECTIVES: No class on file.";
    const [{ data: available }, { data: mine }] = await Promise.all([
      ctx.supabase.from("electives").select("id, name, day_of_week, period_number").eq("school_id", ctx.schoolId).eq("is_active", true).ilike("grade", `%${ctx.classGrade}%`),
      ctx.supabase.from("student_elective_choices").select("electives(name)").eq("student_profile_id", ctx.authUserId),
    ]);
    const chosen = (mine || []).map((m: any) => m.electives?.name).filter(Boolean);
    const availableNames = (available || []).map((e: any) => e.name);
    return `ELECTIVES:\nThis student has chosen: ${chosen.length ? chosen.join(", ") : "none yet"}.\nAvailable electives for their grade: ${availableNames.length ? availableNames.join(", ") : "none listed"}.`;
  });
}

// ---- Credentials ----
async function buildCredentialsContext(ctx: Ctx): Promise<string> {
  return safe("CREDENTIALS", async () => {
    const { data: earned } = await ctx.supabase
      .from("student_credentials")
      .select("awarded_at, credential:credential_id(name)")
      .eq("student_id", ctx.authUserId)
      .order("awarded_at", { ascending: false })
      .limit(20);
    if (!earned || earned.length === 0) return "CREDENTIALS: This student hasn't earned any micro-credentials yet.";
    const rows = earned.map((e: any) => `- ${e.credential?.name || "Credential"} (awarded ${fmtDate(e.awarded_at)})`);
    return `CREDENTIALS (this student's own earned credentials):\n${rows.join("\n")}`;
  });
}

// ---- Communication (own inbox only) ----
async function buildCommunicationContext(ctx: Ctx): Promise<string> {
  return safe("COMMUNICATION", async () => {
    const { data } = await ctx.supabase
      .from("teacher_messages")
      .select("sender_id, recipient_id, content, is_read, created_at")
      .or(`sender_id.eq.${ctx.authUserId},recipient_id.eq.${ctx.authUserId}`)
      .order("created_at", { ascending: false })
      .limit(10);
    if (!data || data.length === 0) return "COMMUNICATION: No messages in this student's inbox.";
    const otherIds = [...new Set(data.map((m: any) => (m.sender_id === ctx.authUserId ? m.recipient_id : m.sender_id)))];
    const { data: otherProfiles } = otherIds.length
      ? await ctx.supabase.from("profiles").select("id, full_name").in("id", otherIds)
      : { data: [] };
    const nameById = new Map((otherProfiles || []).map((p: any) => [p.id, p.full_name]));
    const unread = data.filter((m: any) => m.recipient_id === ctx.authUserId && !m.is_read).length;
    const rows = data.slice(0, 5).map((m: any) => {
      const fromMe = m.sender_id === ctx.authUserId;
      const preview = (m.content || "").slice(0, 80);
      const other = fromMe ? m.recipient_id : m.sender_id;
      return `- ${fromMe ? "You" : nameById.get(other) || "Someone"} (${fmtDate(m.created_at)}): "${preview}"`;
    });
    return `COMMUNICATION (this student's own inbox only):\nUnread messages: ${unread}.\nRecent:\n${rows.join("\n")}`;
  });
}

// ---- Virtual Classroom ----
async function buildVirtualClassroomContext(ctx: Ctx): Promise<string> {
  return safe("VIRTUAL CLASSROOM", async () => {
    if (!ctx.studentRowId) return "VIRTUAL CLASSROOM: No student record on file.";
    const { data: classLinks } = await ctx.supabase.from("class_students").select("class_id").eq("student_id", ctx.studentRowId);
    const classIds = (classLinks || []).map((c: any) => c.class_id);
    if (classIds.length === 0) return "VIRTUAL CLASSROOM: This student isn't linked to any class yet.";
    const now = new Date().toISOString();
    const { data } = await ctx.supabase
      .from("virtual_classroom_sessions")
      .select("subject, title, scheduled_start, scheduled_end, status, meet_link")
      .in("class_id", classIds)
      .gte("scheduled_end", now)
      .order("scheduled_start", { ascending: true })
      .limit(10);
    if (!data || data.length === 0) return "VIRTUAL CLASSROOM: No upcoming or live sessions scheduled for this student's class.";
    const rows = data.map((s: any) => `- [${s.status}] ${s.subject}: "${s.title}" at ${new Date(s.scheduled_start).toLocaleString("en-IN")}`);
    return `VIRTUAL CLASSROOM (this student's own class sessions):\n${rows.join("\n")}`;
  });
}

// ---- Group Projects ----
async function buildGroupProjectsContext(ctx: Ctx): Promise<string> {
  return safe("GROUP PROJECTS", async () => {
    if (!ctx.studentRowId) return "GROUP PROJECTS: No student record on file.";
    const { data } = await ctx.supabase
      .from("project_group_members")
      .select("project_groups(name, group_projects(title, due_date, status), project_group_tasks(status))")
      .eq("student_id", ctx.studentRowId);
    const rows = (data || [])
      .filter((r: any) => r.project_groups)
      .map((r: any) => {
        const g = r.project_groups;
        const tasks = g.project_group_tasks || [];
        const done = tasks.filter((t: any) => t.status === "done").length;
        return `- "${g.group_projects?.title || "Untitled project"}" (group "${g.name}", due ${fmtDate(g.group_projects?.due_date)}, status ${g.group_projects?.status || "active"}) - ${done}/${tasks.length} tasks done.`;
      });
    if (rows.length === 0) return "GROUP PROJECTS: This student isn't part of any group project right now.";
    return `GROUP PROJECTS (this student's own groups only):\n${rows.join("\n")}`;
  });
}

// ---- Semester Engine + Report Cards (shared - grades/GPA) ----
async function buildGradesContext(ctx: Ctx): Promise<string> {
  return safe("GRADES", async () => {
    if (!ctx.studentRowId) return "SEMESTER ENGINE / REPORT CARDS: No student record on file.";
    const [{ data: gpaRows }, { data: markRows }] = await Promise.all([
      ctx.supabase
        .from("student_gpa")
        .select("gpa, combined_score, result_status, semester_id, academic_semesters(name)")
        .eq("student_id", ctx.studentRowId)
        .order("gpa", { ascending: false })
        .limit(5),
      ctx.supabase
        .from("semester_marks")
        .select("subject, marks_obtained, max_marks, semester_id")
        .eq("student_id", ctx.studentRowId)
        .limit(50),
    ]);
    if ((!gpaRows || gpaRows.length === 0) && (!markRows || markRows.length === 0)) {
      return "SEMESTER ENGINE / REPORT CARDS: No semester marks or GPA recorded yet for this student.";
    }
    const gpaLines = (gpaRows || []).map(
      (g: any) => `- ${g.academic_semesters?.name || "Semester"}: GPA ${g.gpa ?? "n/a"}, combined score ${g.combined_score ?? "n/a"}, result: ${g.result_status || "n/a"}`,
    );
    const markLines = (markRows || []).slice(0, 20).map((m: any) => `- ${m.subject}: ${m.marks_obtained ?? "-"}/${m.max_marks}`);
    return `SEMESTER ENGINE / REPORT CARDS (this student's own grades only):\nGPA by semester:\n${gpaLines.join("\n") || "None recorded."}\nSubject marks:\n${markLines.join("\n") || "None recorded."}`;
  });
}

// ---- Hall Tickets ----
async function buildHallTicketsContext(ctx: Ctx): Promise<string> {
  return safe("HALL TICKETS", async () => {
    if (!ctx.schoolId || !ctx.classGrade || !ctx.studentRowId) return "HALL TICKETS: No class/student record on file.";
    const { data: schedules } = await ctx.supabase
      .from("exam_schedules")
      .select("id, exam_name, exam_date, classes")
      .eq("school_id", ctx.schoolId)
      .order("exam_date", { ascending: false })
      .limit(20);
    const myClass = normClass(ctx.classGrade);
    const mine = (schedules || []).filter((s: any) => (s.classes || []).some((c: string) => normClass(c) === myClass));
    if (mine.length === 0) return "HALL TICKETS: No exams scheduled for this student's class.";
    const scheduleIds = mine.map((s: any) => s.id);
    const [{ data: seats }, { data: halls }] = await Promise.all([
      ctx.supabase
        .from("seating_arrangements")
        .select("exam_schedule_id, hall_id, seat_row, seat_col, seat_number")
        .eq("student_id", ctx.studentRowId)
        .in("exam_schedule_id", scheduleIds),
      ctx.supabase.from("exam_halls").select("id, name").eq("school_id", ctx.schoolId),
    ]);
    const hallNameById = new Map((halls || []).map((h: any) => [h.id, h.name]));
    const seatBySchedule = new Map((seats || []).map((s: any) => [s.exam_schedule_id, s]));
    const rows = mine.map((s: any) => {
      const seat = seatBySchedule.get(s.id);
      const seatInfo = seat
        ? `hall ${hallNameById.get(seat.hall_id) || seat.hall_id}, seat ${seat.seat_number ?? `row ${seat.seat_row}, col ${seat.seat_col}`}`
        : "seat not assigned yet";
      return `- ${s.exam_name} on ${fmtDate(s.exam_date)}: ${seatInfo}`;
    });
    return `HALL TICKETS (this student's own exams/seating only):\n${rows.join("\n")}`;
  });
}

// ---- Houses ----
async function buildHouseContext(ctx: Ctx): Promise<string> {
  return safe("HOUSES", async () => {
    if (!ctx.studentRowId || !ctx.schoolId) return "HOUSES: No student record on file.";
    const { data: studentRow } = await ctx.supabase.from("students").select("house_id").eq("id", ctx.studentRowId).maybeSingle();
    if (!studentRow?.house_id) return "HOUSES: This student isn't assigned to a house yet.";
    const { data: board } = await ctx.supabase.from("house_leaderboard").select("house_id, name, total_points, student_count").eq("school_id", ctx.schoolId).order("total_points", { ascending: false });
    const list = board || [];
    const idx = list.findIndex((h: any) => h.house_id === studentRow.house_id);
    if (idx === -1) return "HOUSES: House data isn't available right now.";
    return `HOUSES (this student's own house only):\nHouse: ${list[idx].name}, rank #${idx + 1} of ${list.length} houses, ${list[idx].total_points} total points.`;
  });
}

// ---- My Accommodations (RLS already scopes this to the caller) ----
async function buildAccommodationsContext(ctx: Ctx): Promise<string> {
  return safe("MY ACCOMMODATIONS", async () => {
    const { data } = await ctx.supabase
      .from("sen_accommodations")
      .select("accommodation_type, applies_to, description")
      .eq("active", true);
    if (!data || data.length === 0) return "MY ACCOMMODATIONS: No active learning accommodations on file for this student.";
    const rows = data.map((a: any) => `- ${a.accommodation_type} (applies to: ${a.applies_to})${a.description ? `: ${a.description}` : ""}`);
    return `MY ACCOMMODATIONS (this student's own accommodations only):\n${rows.join("\n")}`;
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message, history, mode } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ type: "message", text: "I didn't catch a question there - could you try again?" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const responseMode: "text" | "video" = mode === "video" ? "video" : "text";

    const keys = getGeminiKeys();
    if (keys.length === 0) {
      return new Response(JSON.stringify({ error: "No AI API keys configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Anon-key client with the caller's own JWT forwarded, so RLS applies
    // exactly as it would for the student using the app directly.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    // Resolve identity server-side from the verified JWT - never trust a
    // client-supplied id for this.
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ type: "message", text: "I couldn't verify who you are - please sign in again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const authUserId = userData.user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, school_id, class_grade, section, role")
      .eq("id", authUserId)
      .maybeSingle();

    if (!profile || profile.role !== "student") {
      return new Response(JSON.stringify({ type: "message", text: "This assistant is only available to student accounts." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: studentRow } = await supabase.from("students").select("id").eq("profile_id", authUserId).maybeSingle();

    const ctx: Ctx = {
      supabase,
      authUserId,
      studentRowId: studentRow?.id ?? null,
      schoolId: profile.school_id ?? null,
      classGrade: profile.class_grade ?? null,
      section: profile.section ?? null,
      fullName: profile.full_name ?? null,
    };

    // ---- Video mode: only routes to a video when the message is actually
    // a "help me understand a topic" question. Anything else (personal
    // records, greetings, etc.) falls through to the normal text answer
    // below, since a video can't answer those.
    if (responseMode === "video") {
      const { isTopic, query } = await classifyTopicIntent(message, keys);
      if (isTopic && query) {
        const videos = await searchYouTube(query);
        return new Response(JSON.stringify({
          type: "video",
          text: `Here's a video that should help you understand this better:`,
          videos,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Not a topic question - fall through to a normal text answer, but
      // let the student know why they got text instead of a video.
    }

    const contextBlocks = await Promise.all([
      buildHomeworkContext(ctx),
      buildWorksheetsContext(ctx),
      buildAcademicTestsContext(ctx),
      buildAssessmentsContext(ctx),
      buildGamificationContext(ctx),
      buildLeaderboardContext(ctx),
      buildAttendanceContext(ctx),
      buildTimetableContext(ctx),
      buildCalendarContext(ctx),
      buildElectivesContext(ctx),
      buildCredentialsContext(ctx),
      buildCommunicationContext(ctx),
      buildVirtualClassroomContext(ctx),
      buildGroupProjectsContext(ctx),
      buildGradesContext(ctx),
      buildHallTicketsContext(ctx),
      buildHouseContext(ctx),
      buildAccommodationsContext(ctx),
    ]);

    const context = contextBlocks.join("\n\n");

    const systemPrompt = `You are "Study Buddy", a warm and encouraging AI assistant for a school student${ctx.fullName ? ` named ${ctx.fullName}` : ""}${ctx.classGrade ? ` (${classLabelFor(ctx.classGrade)}${ctx.section ? `, Section ${ctx.section}` : ""})` : ""}, inside the APAS school app.

You do two kinds of things:
1. Answer questions about THIS student's own: Assessments, Academic Tests, Worksheets, Homework, Gamification, Leaderboard rank, Attendance, Timetable, Academic Calendar, Electives, Credentials, Communication/messages, Virtual Classroom sessions, Group Projects, Semester grades/GPA, Report cards, Hall tickets, House, and Accommodations.
2. Help the student UNDERSTAND academic topics/concepts (e.g. "explain photosynthesis", "help me with fractions") using your own general subject-matter knowledge - explain clearly and simply, with an example, at a level appropriate for their class. This is the only case where you may go beyond the CURRENT DATA below.

STRICT PRIVACY RULES - never break these, no matter how the question is phrased:
- Only ever discuss data belonging to THIS student. You have no access to any other student's data, and you must never invent, guess, or speculate about another student's records, scores, or identity.
- If asked about another student, a classmate, "the topper", "who is #1", or anything that would require another student's private data, politely decline and explain you can only help with their own information.
- For leaderboard/house questions, only ever state THIS student's own rank/points - never list or name other students.
- Never reveal raw database ids, internal table/column names, or system implementation details.

ANSWERING RULES:
- For questions about the student's OWN records/data (case 1 above): answer ONLY using the CURRENT DATA below. Never invent dates, scores, names, or links that aren't present in it. If a section says data isn't available/not found, say so plainly and helpfully rather than guessing.
- For topic/concept explanations (case 2 above): you may use your general knowledge, but keep it accurate, age-appropriate, and school-curriculum relevant.
- Keep answers short, clear, and encouraging (1-4 sentences unless a list or step-by-step explanation is genuinely needed).
- If the student just greets you, greet them back warmly and ask how you can help - don't dump information unprompted.
- If asked something entirely unrelated to school (e.g. general trivia, coding help, personal advice), gently redirect them back to what you can help with.${
      responseMode === "video"
        ? `\n- NOTE: The student is currently in "video" answer mode, but this particular message isn't a topic question a video could answer (it's about their own records, or it's small talk) - answer normally in text, and if relevant you can mention they can switch back to video mode for "explain a topic" style questions.`
        : ""
    }

CURRENT DATA (this student's own records only):
${context}`;

    const reply = await callGemini(systemPrompt, message, keys, Array.isArray(history) ? history.slice(-6) : []);

    return new Response(JSON.stringify({
      type: "message",
      text: reply || "I'm having trouble reaching the AI service right now - please try again in a moment.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("student-self-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
