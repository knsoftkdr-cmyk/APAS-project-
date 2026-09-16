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

async function callGemini(systemPrompt: string, userPrompt: string, keys: string[], history: { role: string; text: string }[] = []): Promise<string | null> {
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
              generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
            }),
          },
          5000,
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
// A cheap Gemini call decides whether the parent's message is genuinely
// "help me understand an academic topic/concept" (which a video can
// answer) vs a question about their own child's school records, which a
// video can never answer - those always stay as text.
async function classifyTopicIntent(message: string, keys: string[]): Promise<{ isTopic: boolean; query: string; topicWords: string[] }> {
  const classifierPrompt = `You classify a parent's chat message to a school app assistant. Reply with ONLY raw JSON, no markdown fences, no extra words, in exactly this shape:
{"is_topic_question": boolean, "search_query": "string", "topic_keywords": ["string", ...]}

is_topic_question = true ONLY when the parent is asking to understand, learn about, or get an explanation of an academic concept/topic so they can help their child (e.g. "explain photosynthesis", "how does long division work", "what is a fraction", "help me understand Newton's third law").
is_topic_question = false for anything about their child's OWN school records/logistics (bus, fees, report card, attendance, appointments, calendar, hall tickets, surveys, safeguarding, messages from school), or greetings/small talk/off-topic chat.

When true: "search_query" is a short, effective YouTube search query for a good educational explainer video on that exact topic. "topic_keywords" is 2-5 lowercase single-word keywords that MUST appear (or close variants of them) in a genuinely relevant video's title for it to count as a real match - used to reject off-topic results.
When false: "search_query" and "topic_keywords" can be empty.`;

  const raw = await callGemini(classifierPrompt, message, keys, []);
  if (!raw) return { isTopic: false, query: "", topicWords: [] };
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      isTopic: !!parsed.is_topic_question,
      query: typeof parsed.search_query === "string" ? parsed.search_query.trim() : "",
      topicWords: Array.isArray(parsed.topic_keywords) ? parsed.topic_keywords.map((w: any) => String(w).toLowerCase().trim()).filter(Boolean) : [],
    };
  } catch {
    return { isTopic: false, query: "", topicWords: [] };
  }
}

interface VideoResult {
  title: string;
  url: string;
  channel: string;
  thumbnail: string | null;
}

// ---- YouTube video search ----
// Uses the real YouTube Data API when YOUTUBE_API_KEY is configured, then
// STRICTLY filters results down to ones that actually match the topic -
// a result only survives if its title (or description) contains at
// least half of the classifier's topic keywords (min 1). This is what
// guarantees "related videos only" - an off-topic top result is dropped
// rather than shown. Falls back to a plain, guaranteed-valid YouTube
// search-results link (never a fabricated/broken video id) when the API
// key is absent, the call fails, or nothing passes the relevance check.
function isRelevant(text: string, topicWords: string[]): boolean {
  if (topicWords.length === 0) return true;
  const lower = text.toLowerCase();
  const hits = topicWords.filter((w) => lower.includes(w));
  return hits.length >= Math.max(1, Math.ceil(topicWords.length / 2));
}

async function searchYouTube(query: string, topicWords: string[]): Promise<VideoResult[]> {
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (apiKey) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&safeSearch=strict&maxResults=8&relevanceLanguage=en&q=${encodeURIComponent(query)}&key=${apiKey}`;
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
            _desc: it.snippet?.description || "",
          }))
          // STRICT relevance filter - drop anything that doesn't actually
          // mention the topic, rather than showing "close enough" results.
          .filter((v: any) => isRelevant(`${v.title} ${v._desc}`, topicWords))
          .slice(0, 3)
          .map(({ _desc, ...v }: any) => v);
        if (items.length > 0) return items;
      }
    } catch (e) {
      console.error("[parent-assistant] YouTube API search failed:", e);
    }
  }
  // Fallback: a guaranteed-valid search-results link for the exact topic -
  // always on-topic since it's the parent's own topic used as the query,
  // never a specific (possibly wrong) video id.
  return [{
    title: `Search YouTube for "${query}"`,
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    channel: "YouTube search",
    thumbnail: null,
  }];
}

function timeStringToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function isoToLocalMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function formatDuration(minutes: number): string {
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMin = minutes % 60;
    return `${hours} hour${hours === 1 ? "" : "s"}${remMin > 0 ? ` ${remMin} min` : ""}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

// ---- Transport section (unchanged from parent-bus-assistant) ----
async function buildTransportContext(supabase: any, studentId: string): Promise<string> {
  const { data: assignment } = await supabase
    .from("transport_assignments")
    .select("route_id, pickup_stop_id, drop_stop_id, transport_routes(route_name, route_number, vehicle_id, drivers(name, phone), bus_attendants(name, phone))")
    .eq("student_id", studentId)
    .eq("status", "active")
    .maybeSingle();

  if (!assignment) {
    return "TRANSPORT: No active bus route is set up for this child yet.";
  }

  const route: any = assignment.transport_routes;
  const driver: any = route?.drivers;
  const attendant: any = route?.bus_attendants;
  const vehicleId: string | null = route?.vehicle_id ?? null;
  const routeId = assignment.route_id;
  const pickupStopId = assignment.pickup_stop_id;
  const dropStopId = assignment.drop_stop_id;

  const [{ data: stops }, { data: position }, { data: todayArrivals }] = await Promise.all([
    routeId ? supabase.from("route_stops").select("id, stop_name, pickup_time, drop_time").eq("route_id", routeId) : Promise.resolve({ data: [] }),
    vehicleId ? supabase.from("vehicle_locations").select("latitude, longitude, updated_at").eq("vehicle_id", vehicleId).maybeSingle() : Promise.resolve({ data: null }),
    routeId ? supabase.from("stop_arrivals").select("stop_id, arrived_at").eq("route_id", routeId).eq("arrival_date", new Date().toISOString().slice(0, 10)) : Promise.resolve({ data: [] }),
  ]);

  const stopById = new Map((stops || []).map((s: any) => [s.id, s]));
  const pickupStop = pickupStopId ? stopById.get(pickupStopId) : null;
  const dropStop = dropStopId ? stopById.get(dropStopId) : null;
  const arrivalMap = new Map((todayArrivals || []).map((a: any) => [a.stop_id, a.arrived_at]));

  const targetStop = pickupStopId && !arrivalMap.has(pickupStopId)
    ? pickupStop
    : dropStopId && !arrivalMap.has(dropStopId)
    ? dropStop
    : null;

  let liveStatusLine = "No live GPS data available for this bus right now.";
  let etaLine = "";
  if (position) {
    const ageMinutes = Math.round((Date.now() - new Date(position.updated_at).getTime()) / 60000);
    const isStale = ageMinutes > 2;
    const isVeryStale = ageMinutes > 24 * 60;
    liveStatusLine = isVeryStale
      ? `No recent GPS signal - the last known location was ${formatDuration(ageMinutes)} ago. The driver likely hasn't started sharing location today.`
      : isStale
      ? `Last GPS update was ${formatDuration(ageMinutes)} ago - this may be out of date.`
      : `Bus location is live, last updated ${formatDuration(ageMinutes)} ago.`;

    if (!isStale && targetStop?.latitude != null && targetStop?.longitude != null) {
      try {
        const etaRes = await fetchWithTimeout(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/get-traffic-eta`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              originLat: position.latitude, originLng: position.longitude,
              destLat: targetStop.latitude, destLng: targetStop.longitude,
            }),
          },
          4000,
        );
        if (etaRes.ok) {
          const etaData = await etaRes.json();
          if (etaData?.success) {
            const mins = Math.max(1, Math.round(etaData.liveSeconds / 60));
            etaLine = `Estimated ${mins} minute(s) away from ${targetStop.stop_name}, ${Math.round((etaData.distanceMeters / 1000) * 10) / 10} km.`;
          }
        }
      } catch (_e) { /* ETA is best-effort */ }
    }
  }

  let delayLine = "";
  if (routeId && targetStop?.id) {
    const { data: arrivalHistory } = await supabase
      .from("stop_arrivals").select("arrived_at").eq("route_id", routeId).eq("stop_id", targetStop.id)
      .order("arrival_date", { ascending: false }).limit(30);
    const pickupMin = targetStop.pickup_time ? timeStringToMinutes(targetStop.pickup_time) : null;
    const dropMin = targetStop.drop_time ? timeStringToMinutes(targetStop.drop_time) : null;
    if (arrivalHistory && arrivalHistory.length >= 3 && (pickupMin != null || dropMin != null)) {
      const deltas = arrivalHistory.map((row: any) => {
        const actualMin = isoToLocalMinutes(row.arrived_at);
        let scheduledMin: number;
        if (pickupMin != null && dropMin != null) {
          scheduledMin = Math.abs(actualMin - pickupMin) <= Math.abs(actualMin - dropMin) ? pickupMin : dropMin;
        } else {
          scheduledMin = (pickupMin ?? dropMin) as number;
        }
        return actualMin - scheduledMin;
      });
      const avg = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
      if (Math.abs(avg) >= 2) {
        delayLine = `Historically this stop runs about ${avg > 0 ? `${avg} min late` : `${Math.abs(avg)} min early`} (based on ${deltas.length} recent days).`;
      }
    }
  }

  const arrivedPickupText = pickupStopId && arrivalMap.has(pickupStopId)
    ? `Bus already reached the pickup stop today at ${new Date(arrivalMap.get(pickupStopId)!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
    : "";
  const arrivedDropText = dropStopId && arrivalMap.has(dropStopId)
    ? `Bus already reached the drop stop today at ${new Date(arrivalMap.get(dropStopId)!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
    : "";

  return `
TRANSPORT:
Route: ${route?.route_name || "-"}${route?.route_number ? ` (${route.route_number})` : ""}
Driver: ${driver?.name || "not set"}${driver?.phone ? `, phone ${driver.phone}` : ""}
Attendant: ${attendant?.name || "not set"}${attendant?.phone ? `, phone ${attendant.phone}` : ""}
Pickup stop: ${pickupStop?.stop_name || "not set"}${pickupStop?.pickup_time ? ` at ${pickupStop.pickup_time}` : ""}
Drop stop: ${dropStop?.stop_name || "not set"}${dropStop?.drop_time ? ` at ${dropStop.drop_time}` : ""}
${liveStatusLine}
${etaLine}
${delayLine}
${arrivedPickupText}
${arrivedDropText}
  `.trim();
}

// ---- Fees section (via existing get_parent_fee_details RPC) ----
async function buildFeesContext(supabase: any, studentId: string): Promise<string> {
  try {
    const { data, error } = await supabase.rpc("get_parent_fee_details", { p_student_id: studentId });
    if (error || !data) return "FEES: Fee details are not available right now.";
    return `FEES (raw data, use only what's relevant to the question):\n${JSON.stringify(data)}`;
  } catch (_e) {
    return "FEES: Fee details are not available right now.";
  }
}

// TODO: homework + assessments sections - need table/column names before
// these can be added safely.
function buildHomeworkAssessmentsPlaceholder(): string {
  return "HOMEWORK & ASSESSMENTS: Not wired up yet - if asked, say this is coming soon rather than guessing.";
}

// ---- Resolved child shape used by all the new sections below ----
interface ChildRecord {
  profileId: string;    // profiles.id - used by appointments, transport, fees
  studentRowId: string; // students.id - used by attendance, marks, safeguarding, seating
  fullName: string;
  className: string;
  section: string;
  schoolId: string;
}

// ---- Report card (latest semester marks + GPA) ----
async function buildReportCardContext(supabase: any, child: ChildRecord): Promise<string> {
  const { data: sem } = await supabase
    .from("academic_semesters")
    .select("id, name")
    .eq("school_id", child.schoolId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sem) return "REPORT CARD: No semester/report data has been set up for this school yet.";

  const [{ data: marks }, { data: gpaRow }] = await Promise.all([
    supabase.from("semester_marks").select("subject, marks_obtained, max_marks").eq("semester_id", sem.id).eq("student_id", child.studentRowId),
    supabase.from("student_gpa").select("gpa, combined_score, result_status").eq("semester_id", sem.id).eq("student_id", child.studentRowId).maybeSingle(),
  ]);

  if ((!marks || marks.length === 0) && !gpaRow) {
    return `REPORT CARD (${sem.name}): No marks have been entered yet for this semester.`;
  }

  const subjectLines = (marks || [])
    .map((m: any) => `${m.subject}: ${m.marks_obtained ?? "-"}/${m.max_marks}`)
    .join("; ");

  const gpaLine = gpaRow
    ? `GPA: ${gpaRow.gpa ?? "-"}, Combined score: ${gpaRow.combined_score ?? "-"}, Result: ${gpaRow.result_status ?? "-"}.`
    : "";

  return `REPORT CARD (${sem.name}):\nSubject-wise marks: ${subjectLines || "not entered yet"}\n${gpaLine}`.trim();
}

// ---- Attendance (last 30 days) ----
async function buildAttendanceContext(supabase: any, child: ChildRecord): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data: records } = await supabase
    .from("attendance_records")
    .select("date, status")
    .eq("student_id", child.studentRowId)
    .gte("date", since.toISOString().slice(0, 10))
    .order("date", { ascending: false });

  if (!records || records.length === 0) {
    return "ATTENDANCE (last 30 days): No attendance records found for this period.";
  }

  const total = records.length;
  const present = records.filter((r: any) => r.status === "present").length;
  const pct = Math.round((present / total) * 100);
  const absences = records.filter((r: any) => r.status !== "present").slice(0, 8)
    .map((r: any) => `${r.date} (${r.status})`).join(", ");

  return `ATTENDANCE (last 30 days): ${present}/${total} days present (${pct}%).${absences ? ` Non-present days: ${absences}.` : ""}`;
}

// ---- Hall tickets / seating for upcoming exams ----
async function buildHallTicketContext(supabase: any, child: ChildRecord): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: schedules } = await supabase
    .from("exam_schedules")
    .select("id, subject, exam_date, start_time, end_time, classes")
    .eq("school_id", child.schoolId)
    .gte("exam_date", today)
    .order("exam_date", { ascending: true })
    .limit(20);

  const normalizedClass = (child.className || "").toLowerCase().replace(/^class\s*/i, "").trim();
  const mine = (schedules || []).filter((s: any) =>
    (s.classes || []).some((c: string) => c.toLowerCase().replace(/^class\s*/i, "").trim() === normalizedClass)
  );

  if (mine.length === 0) return "HALL TICKETS: No upcoming exams scheduled for this child's class.";

  const ids = mine.map((s: any) => s.id);
  const { data: seats } = await supabase
    .from("seating_arrangements")
    .select("exam_schedule_id, hall_id, seat_row, seat_col, seat_number, exam_halls(name)")
    .in("exam_schedule_id", ids)
    .eq("student_id", child.studentRowId);
  const seatBySchedule = new Map((seats || []).map((s: any) => [s.exam_schedule_id, s]));

  const lines = mine.map((s: any) => {
    const seat = seatBySchedule.get(s.id);
    const seatText = seat
      ? `Hall: ${seat.exam_halls?.name ?? "-"}, Seat: ${seat.seat_number ?? `${seat.seat_row ?? "-"}${seat.seat_col ?? ""}`}`
      : "Seat not allotted yet";
    return `${s.subject} on ${s.exam_date} (${s.start_time}-${s.end_time}) - ${seatText}`;
  });

  return `HALL TICKETS / UPCOMING EXAMS:\n${lines.join("\n")}`;
}

// ---- Appointments (account-level, spans all children) ----
async function buildAppointmentsContext(supabase: any, parentAuthId: string, nameByProfileId: Map<string, string>): Promise<string> {
  const { data: appts } = await supabase
    .from("appointments")
    .select("student_id, teacher_id, appointment_date, start_time, status, reason_category, meeting_mode")
    .eq("parent_id", parentAuthId)
    .order("appointment_date", { ascending: false })
    .limit(10);

  if (!appts || appts.length === 0) return "APPOINTMENTS: No appointments booked with teachers.";

  const teacherIds = [...new Set(appts.map((a: any) => a.teacher_id))];
  const { data: teacherProfiles } = teacherIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", teacherIds)
    : { data: [] };
  const teacherName = new Map((teacherProfiles || []).map((p: any) => [p.id, p.full_name]));

  const lines = appts.map((a: any) =>
    `${nameByProfileId.get(a.student_id) ?? "Child"} with ${teacherName.get(a.teacher_id) ?? "teacher"} on ${a.appointment_date} ${a.start_time} - ${a.status} (${a.reason_category}, ${a.meeting_mode})`
  );

  return `APPOINTMENTS:\n${lines.join("\n")}`;
}

// ---- Academic calendar (shared per school) ----
async function buildCalendarContext(supabase: any, schoolIds: string[]): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: events } = await supabase
    .from("academic_calendar_events")
    .select("title, description, event_type, start_date, end_date")
    .in("school_id", schoolIds)
    .gte("end_date", today)
    .order("start_date", { ascending: true })
    .limit(10);

  if (!events || events.length === 0) return "ACADEMIC CALENDAR: No upcoming events found.";

  const lines = events.map((e: any) =>
    `${e.title} (${e.event_type}) - ${e.start_date}${e.end_date !== e.start_date ? ` to ${e.end_date}` : ""}${e.description ? `: ${e.description}` : ""}`
  );
  return `ACADEMIC CALENDAR (upcoming):\n${lines.join("\n")}`;
}

// ---- Surveys targeted at this parent (account-level) ----
async function buildSurveysContext(supabase: any, parentAuthId: string, schoolIds: string[], classIds: string[]): Promise<string> {
  const { data: surveys } = await supabase
    .from("surveys")
    .select("id, title, status, target_type, is_anonymous")
    .in("school_id", schoolIds)
    .eq("status", "active");

  if (!surveys || surveys.length === 0) return "SURVEYS: No active surveys right now.";

  const classTargeted = surveys.filter((s: any) => s.target_type === "class_parents");
  const classTargetedIds = classTargeted.map((s: any) => s.id);
  const { data: targetRows } = classTargetedIds.length
    ? await supabase.from("survey_target_classes").select("survey_id, class_id").in("survey_id", classTargetedIds)
    : { data: [] };
  const targetedSurveyIds = new Set(
    (targetRows || []).filter((r: any) => classIds.includes(r.class_id)).map((r: any) => r.survey_id)
  );

  const { data: receipts } = await supabase.from("survey_receipts").select("survey_id").eq("respondent_id", parentAuthId);
  const respondedIds = new Set((receipts || []).map((r: any) => r.survey_id));

  const relevant = surveys.filter((s: any) =>
    (s.target_type === "all_parents" || targetedSurveyIds.has(s.id)) && !respondedIds.has(s.id)
  );

  if (relevant.length === 0) return "SURVEYS: No pending surveys for this parent right now.";

  const lines = relevant.map((s: any) => `"${s.title}"${s.is_anonymous ? " (anonymous)" : ""} - not yet responded`);
  return `SURVEYS (pending):\n${lines.join("\n")}`;
}

// ---- Safeguarding incidents concerning this parent's children only ----
async function buildSafeguardingContext(supabase: any, studentRowIds: string[], nameByStudentRowId: Map<string, string>): Promise<string> {
  if (studentRowIds.length === 0) return "SAFEGUARDING: No records.";
  const { data: incidents } = await supabase
    .from("safeguarding_incidents")
    .select("student_id, category, severity, status, description, created_at, resolved_at")
    .in("student_id", studentRowIds)
    .order("created_at", { ascending: false })
    .limit(10);

  if (!incidents || incidents.length === 0) return "SAFEGUARDING: No safeguarding records for these children.";

  const lines = incidents.map((i: any) =>
    `${nameByStudentRowId.get(i.student_id) ?? "Child"}: ${i.category} (${i.severity}) - status: ${i.status}, reported ${i.created_at?.slice(0, 10)}${i.resolved_at ? `, resolved ${i.resolved_at.slice(0, 10)}` : ""}`
  );
  return `SAFEGUARDING UPDATES:\n${lines.join("\n")}`;
}

// ---- School <-> parent messages (account-level) ----
async function buildCommunicationContext(supabase: any, parentAuthId: string): Promise<string> {
  const { data: msgs } = await supabase
    .from("teacher_messages")
    .select("sender_id, recipient_id, message, is_read, created_at")
    .or(`sender_id.eq.${parentAuthId},recipient_id.eq.${parentAuthId}`)
    .order("created_at", { ascending: false })
    .limit(10);

  if (!msgs || msgs.length === 0) return "COMMUNICATION: No messages from school staff.";

  const senderIds = [...new Set(msgs.filter((m: any) => m.recipient_id === parentAuthId).map((m: any) => m.sender_id))];
  const { data: senderProfiles } = senderIds.length
    ? await supabase.from("profiles").select("id, full_name, role").in("id", senderIds)
    : { data: [] };
  const senderName = new Map((senderProfiles || []).map((p: any) => [p.id, `${p.full_name} (${p.role})`]));

  const unreadCount = msgs.filter((m: any) => m.recipient_id === parentAuthId && !m.is_read).length;
  const lines = msgs.slice(0, 6).map((m: any) => {
    const from = m.sender_id === parentAuthId ? "You" : (senderName.get(m.sender_id) ?? "School staff");
    return `${from} (${m.created_at?.slice(0, 10)}): ${m.message?.slice(0, 140)}`;
  });

  return `COMMUNICATION (${unreadCount} unread):\n${lines.join("\n")}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message, history, mode } = await req.json();
    const responseMode: "text" | "video" = mode === "video" ? "video" : "text";

    const keys = getGeminiKeys();
    if (keys.length === 0) {
      return new Response(JSON.stringify({ error: "No AI API keys configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Video mode: only routes to a video when the message is truly a
    // "help me understand a topic" question - anything about the child's
    // own records falls straight through to the normal text flow below,
    // since a video can never answer those. Checked before the (fairly
    // expensive) per-child context build, since it doesn't need it.
    if (responseMode === "video" && typeof message === "string" && message.trim()) {
      const { isTopic, query, topicWords } = await classifyTopicIntent(message, keys);
      if (isTopic && query) {
        const videos = await searchYouTube(query, topicWords);
        return new Response(JSON.stringify({
          type: "video",
          text: "Here's a video that should help explain this:",
          videos,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Not a topic question - fall through to the normal text answer.
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );

    // SECURITY: the parent's identity comes ONLY from their verified auth
    // token - never from anything the client sends in the request body.
    // Every child lookup below is derived from this id, so a parent can
    // never pull another parent's child's data even if the client were
    // compromised or tampered with.
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ type: "message", text: "Your session has expired - please sign in again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const parentAuthId = authData.user.id;

    const { data: links } = await supabase.from("parent_students").select("student_id").eq("parent_id", parentAuthId);
    const childProfileIds = [...new Set((links || []).map((l: any) => l.student_id))];

    if (childProfileIds.length === 0) {
      return new Response(JSON.stringify({
        type: "message",
        text: "I don't see any children linked to your account yet - please contact the school office to get your child linked to your profile.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const [{ data: childProfiles }, { data: childStudentRows }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, class_grade, section, school_id").in("id", childProfileIds),
      supabase.from("students").select("id, full_name, class, section, school_id, profile_id").in("profile_id", childProfileIds),
    ]);

    const studentRowByProfileId = new Map((childStudentRows || []).map((s: any) => [s.profile_id, s]));
    const children: ChildRecord[] = (childProfiles || [])
      .map((p: any) => {
        const sRow = studentRowByProfileId.get(p.id);
        if (!sRow) return null; // no students row yet - skip rather than guess
        return {
          profileId: p.id,
          studentRowId: sRow.id,
          fullName: p.full_name || sRow.full_name || "Child",
          className: sRow.class || p.class_grade || "",
          section: sRow.section || p.section || "",
          schoolId: sRow.school_id || p.school_id,
        } as ChildRecord;
      })
      .filter((c: ChildRecord | null): c is ChildRecord => !!c);

    if (children.length === 0) {
      return new Response(JSON.stringify({
        type: "message",
        text: "I found your account but couldn't find a matching student record yet - please contact the school office.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const nameByProfileId = new Map(children.map((c) => [c.profileId, c.fullName]));
    const nameByStudentRowId = new Map(children.map((c) => [c.studentRowId, c.fullName]));
    const schoolIds = [...new Set(children.map((c) => c.schoolId))];
    const studentRowIds = children.map((c) => c.studentRowId);

    const { data: classRows } = await supabase.from("class_students").select("class_id").in("student_id", studentRowIds);
    const classIds = [...new Set((classRows || []).map((r: any) => r.class_id))];

    // Per-child sections (transport, fees, report card, attendance, hall tickets)
    const perChildBlocks = await Promise.all(children.map(async (child) => {
      const [transport, fees, reportCard, attendance, hallTicket] = await Promise.all([
        buildTransportContext(supabase, child.profileId),
        buildFeesContext(supabase, child.profileId),
        buildReportCardContext(supabase, child),
        buildAttendanceContext(supabase, child),
        buildHallTicketContext(supabase, child),
      ]);
      return `=== ${child.fullName} (Class ${child.className}${child.section ? `-${child.section}` : ""}) ===\n${transport}\n\n${fees}\n\n${reportCard}\n\n${attendance}\n\n${hallTicket}`;
    }));

    // Account-level sections (span all children at once)
    const [appointments, calendar, surveys, safeguarding, communication] = await Promise.all([
      buildAppointmentsContext(supabase, parentAuthId, nameByProfileId),
      buildCalendarContext(supabase, schoolIds),
      buildSurveysContext(supabase, parentAuthId, schoolIds, classIds),
      buildSafeguardingContext(supabase, studentRowIds, nameByStudentRowId),
      buildCommunicationContext(supabase, parentAuthId),
    ]);
    const homeworkContext = buildHomeworkAssessmentsPlaceholder();

    const context = [
      ...perChildBlocks,
      "=== Shared / account-level ===",
      appointments,
      calendar,
      surveys,
      safeguarding,
      communication,
      homeworkContext,
    ].join("\n\n");

    const childNames = children.map((c) => c.fullName).join(", ");
    const multiChild = children.length > 1;

    const systemPrompt = `You are a warm, friendly assistant helping a parent keep track of ${multiChild ? `their children (${childNames})'` : `their child (${childNames})'s`} school life - transport, fees, report cards, attendance, appointments, the academic calendar, hall tickets/exam seating, surveys, safeguarding updates, and messages from school staff. You can also help the parent understand an academic topic/concept (e.g. "explain photosynthesis", "how does long division work") so they can support their child's learning - for that you may use your own general subject-matter knowledge, kept accurate and simple. Talk like a helpful person, not a script - vary your phrasing naturally and respond directly to what the parent actually asked, using the conversation so far for context.

If the parent just greets you (e.g. "hello", "hi") without asking anything specific, greet them back warmly and briefly ask how you can help - do NOT dump details unprompted. Only bring up specific info once they actually ask about it.

${multiChild ? `This parent has MULTIPLE children: ${childNames}. If their question doesn't make clear which child they mean and the answer would differ per child, ask which child they mean, or briefly cover all of them if that's more natural. If they name a child, use only that child's section.` : ""}

SECURITY: you have information ONLY about this parent's own child(ren) listed in the data below (${childNames}). If asked about any other student, class-wide data, or anything not tied to these specific children, say you don't have access to that information rather than guessing or inventing it.

For questions about their child's own records/logistics: answer ONLY using the data given below - never invent dates, amounts, scores, contact details, or seat numbers that aren't present. If something isn't available, say so plainly rather than guessing. For topic/concept explanations, you may use general knowledge, but keep it accurate and easy for a parent to relay to their child. Keep answers to 1-4 short, natural sentences.${
      responseMode === "video"
        ? `\n- NOTE: The parent is currently in "video" answer mode, but this message isn't a topic question a video could answer (it's about their child's records, or it's small talk) - answer normally in text, and mention they can switch back to video mode for "explain a topic" style questions if relevant.`
        : ""
    }

CURRENT DATA:
${context}`;

    const reply = await callGemini(systemPrompt, message, keys, Array.isArray(history) ? history.slice(-6) : []);

    return new Response(JSON.stringify({
      type: "message",
      text: reply || "I'm having trouble reaching the AI service right now - please try again in a moment.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("parent-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});