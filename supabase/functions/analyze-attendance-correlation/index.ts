// supabase/functions/analyze-attendance-correlation/index.ts
//
// AI Insights — Attendance Correlation.
// Route-level: for each route, delay + missed-boarding stats alongside the
// absence rate of students assigned to that route (last 30 days).
// Student-level: students with at least one missed pickup, alongside their
// absence count in the same period.
// Feeds both to an LLM and asks it to assess plausible correlation at each
// level, explicitly avoiding causal overclaiming from small samples.
// Result cached (upserted) into attendance_correlation_insights, one row
// per school.
//
// Invoke: POST { school_id: string }
// Returns: { analysis: {...} }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Delay convention matches DelayAnalyticsSubTab.tsx / predict-route-delays:
// scheduled_start_time is a naive local-time column (school wall-clock, no
// timezone), started_at is a real UTC instant. Parse both as literal
// (unzoned) and compare directly.
function delayMinutes(tripDate: string, scheduledStartTime: string, startedAtIso: string): number {
  const scheduled = new Date(`${tripDate}T${scheduledStartTime}`);
  const actual = new Date(startedAtIso);
  return Math.round((actual.getTime() - scheduled.getTime()) / 60000);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { school_id } = await req.json();
    if (!school_id) {
      return new Response(
        JSON.stringify({ error: "school_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const { data: assignments, error: aErr } = await supabase
      .from("transport_assignments")
      .select("student_id, route_id")
      .eq("school_id", school_id)
      .eq("status", "active");
    if (aErr) throw aErr;

    if (!assignments || assignments.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active transport assignments found — nothing to correlate yet." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const assignedStudentIds = [...new Set(assignments.map(a => a.student_id))];
    const routeIds = [...new Set(assignments.map(a => a.route_id).filter(Boolean))];

    const [routesRes, tripsRes, missedRes, attendanceRes, studentsRes] = await Promise.all([
      supabase.from("transport_routes").select("id, route_name, route_number").in("id", routeIds),
      supabase.from("trips").select("route_id, trip_date, started_at, scheduled_start_time, status")
        .eq("school_id", school_id).eq("status", "completed")
        .not("started_at", "is", null).not("scheduled_start_time", "is", null)
        .gte("trip_date", thirtyDaysAgo).lte("trip_date", today).in("route_id", routeIds),
      supabase.from("missed_boarding_alerts").select("student_id, route_id, trip_date")
        .eq("school_id", school_id).gte("trip_date", thirtyDaysAgo).lte("trip_date", today),
      supabase.from("attendance_records").select("student_id, date, status")
        .in("student_id", assignedStudentIds).gte("date", thirtyDaysAgo).lte("date", today),
      supabase.from("students").select("id, full_name").in("id", assignedStudentIds),
    ]);
    if (routesRes.error) throw routesRes.error;
    if (tripsRes.error) throw tripsRes.error;
    if (missedRes.error) throw missedRes.error;
    if (attendanceRes.error) throw attendanceRes.error;
    if (studentsRes.error) throw studentsRes.error;

    const routeLabel = new Map(
      (routesRes.data || []).map((r: any) => [r.id, `Route ${r.route_number || r.route_name}`])
    );
    const studentName = new Map((studentsRes.data || []).map((s: any) => [s.id, s.full_name || "Unnamed Student"]));

    const studentsByRoute = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (!a.route_id) continue;
      if (!studentsByRoute.has(a.route_id)) studentsByRoute.set(a.route_id, new Set());
      studentsByRoute.get(a.route_id)!.add(a.student_id);
    }

    // Attendance lookup: student_id -> { present, absent, total }
    const attendanceByStudent = new Map<string, { absent: number; total: number }>();
    for (const rec of (attendanceRes.data || []) as any[]) {
      if (!attendanceByStudent.has(rec.student_id)) attendanceByStudent.set(rec.student_id, { absent: 0, total: 0 });
      const entry = attendanceByStudent.get(rec.student_id)!;
      entry.total += 1;
      if (rec.status === "absent") entry.absent += 1;
    }

    // Missed boarding counts, both per-route and per-student
    const missedByRoute = new Map<string, number>();
    const missedByStudent = new Map<string, number>();
    for (const m of (missedRes.data || []) as any[]) {
      if (m.route_id) missedByRoute.set(m.route_id, (missedByRoute.get(m.route_id) || 0) + 1);
      missedByStudent.set(m.student_id, (missedByStudent.get(m.student_id) || 0) + 1);
    }

    // Delay per route (reusing the trend-less overall average — same
    // convention as predict-route-delays)
    const delaysByRoute = new Map<string, number[]>();
    for (const t of (tripsRes.data || []) as any[]) {
      if (!t.route_id) continue;
      if (!delaysByRoute.has(t.route_id)) delaysByRoute.set(t.route_id, []);
      delaysByRoute.get(t.route_id)!.push(delayMinutes(t.trip_date, t.scheduled_start_time, t.started_at));
    }

    // Route-level dataset
    const routeStats = routeIds.map(routeId => {
      const studentSet = studentsByRoute.get(routeId) || new Set();
      let totalAbsent = 0, totalRecords = 0;
      for (const sid of studentSet) {
        const entry = attendanceByStudent.get(sid);
        if (entry) { totalAbsent += entry.absent; totalRecords += entry.total; }
      }
      const delays = delaysByRoute.get(routeId) || [];
      return {
        label: routeLabel.get(routeId) || "Unknown Route",
        assignedStudents: studentSet.size,
        avgDelay: delays.length ? Math.round(delays.reduce((s, d) => s + d, 0) / delays.length) : null,
        missedBoardingCount: missedByRoute.get(routeId) || 0,
        absenceRatePct: totalRecords > 0 ? Math.round((totalAbsent / totalRecords) * 100) : null,
        attendanceRecordCount: totalRecords,
      };
    });

    // Student-level dataset: only students with at least one missed
    // pickup, to keep the prompt focused and bounded in size.
    const studentCandidates = [...missedByStudent.entries()]
      .map(([studentId, missedCount]) => {
        const att = attendanceByStudent.get(studentId);
        return {
          name: studentName.get(studentId) || "Unknown Student",
          missedBoardingCount: missedCount,
          absenceCount: att?.absent || 0,
          attendanceRecordCount: att?.total || 0,
        };
      })
      .sort((a, b) => b.missedBoardingCount - a.missedBoardingCount)
      .slice(0, 20);

    const systemPrompt = `You are a student wellbeing and transport operations analyst for a school. You're given two datasets covering the last 30 days:
1. Per-route stats: average trip delay, missed-boarding count, and the absence rate of students assigned to that route.
2. Individual students who had at least one missed pickup, alongside their absence count in the same period.

Assess whether there's a plausible correlation between transport issues (delay, missed boarding) and student attendance, at both the route level and the individual student level.

Return ONLY valid JSON in this exact structure (no markdown, no code fences):
{
  "overall_summary": "2-3 sentence overview of whether transport issues appear linked to attendance in this data",
  "route_insights": [
    { "route_label": "as given", "correlation_strength": "none" | "weak" | "moderate" | "strong", "insight": "1-2 sentences citing the specific numbers" }
  ],
  "student_flags": [
    { "student_name": "as given", "insight": "1 sentence on the pattern for this student", "recommendation": "1 short actionable next step, e.g. contact parent, check pickup point" }
  ]
}

Rules:
- Correlation is not causation — never claim a missed pickup CAUSED an absence, only that a pattern co-occurs
- Small sample sizes (few attendance records, 1-2 missed pickups) must be flagged as "none" or "weak" correlation strength, not overstated
- Include a route_insight for every route with at least 1 attendance record; skip routes with zero data
- Include a student_flag only for students where the pattern is worth a human looking at (e.g. 2+ missed pickups AND 2+ absences) — omit low-signal cases rather than padding the list
- Be concise and practical, written for a school administrator, not a statistician`;

    const userPrompt = `Today's date: ${today}. Data covers the last 30 days.

ROUTE-LEVEL DATA:
${routeStats.map(r =>
  `${r.label}: ${r.assignedStudents} assigned student(s), avg delay ${r.avgDelay ?? "n/a"} min, ${r.missedBoardingCount} missed boarding(s), absence rate ${r.absenceRatePct ?? "n/a"}% (from ${r.attendanceRecordCount} attendance records)`
).join("\n") || "(no route data)"}

STUDENT-LEVEL DATA (students with at least 1 missed pickup):
${studentCandidates.map(s =>
  `${s.name}: ${s.missedBoardingCount} missed pickup(s), ${s.absenceCount} absence(s) out of ${s.attendanceRecordCount} attendance record(s)`
).join("\n") || "(no students with missed pickups)"}

Assess correlation at both levels.`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    async function callOpenAICompatible(url: string, key: string, model: string, extraHeaders: Record<string, string> = {}) {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: JSON.stringify({ model, messages, temperature: 0.4 }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`${url} ${r.status}: ${t.slice(0, 300)}`);
      }
      const j = await r.json();
      return j.choices?.[0]?.message?.content || "";
    }

    async function callGemini(key: string) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
          }),
        }
      );
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`gemini ${r.status}: ${t.slice(0, 300)}`);
      }
      const j = await r.json();
      return j.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    const GROK_API_KEY = Deno.env.get("GROK_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY") || Deno.env.get("GEMINI_ADVANCED_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPEN_AI_KEY");
    if (!OPENROUTER_API_KEY && !GROK_API_KEY && !GEMINI_API_KEY && !OPENAI_API_KEY) {
      throw new Error("No AI provider API key configured");
    }

    const providers: Array<() => Promise<string>> = [];
    if (OPENROUTER_API_KEY) {
      const orModels = [
        "meta-llama/llama-3.3-70b-instruct:free",
        "google/gemini-flash-1.5",
        "openai/gpt-4o-mini",
      ];
      for (const m of orModels) {
        providers.push(() =>
          callOpenAICompatible(
            "https://openrouter.ai/api/v1/chat/completions",
            OPENROUTER_API_KEY,
            m,
            { "HTTP-Referer": "https://lovable.dev", "X-Title": "APAS AI Insights" }
          )
        );
      }
    }
    if (GEMINI_API_KEY) providers.push(() => callGemini(GEMINI_API_KEY));
    if (OPENAI_API_KEY) {
      providers.push(() =>
        callOpenAICompatible("https://api.openai.com/v1/chat/completions", OPENAI_API_KEY, "gpt-4o-mini")
      );
    }
    if (GROK_API_KEY) {
      providers.push(() =>
        callOpenAICompatible("https://api.x.ai/v1/chat/completions", GROK_API_KEY, "grok-beta")
      );
    }

    let content = "";
    const errors: string[] = [];
    for (const p of providers) {
      try {
        content = await p();
        if (content) break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("Provider failed:", msg);
        errors.push(msg);
      }
    }

    if (!content) {
      return new Response(
        JSON.stringify({ error: "All AI providers failed", details: errors }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch (e) {
      console.error("Parse error:", e, content);
      throw new Error("AI returned invalid JSON");
    }

    const { error: upsertErr } = await supabase
      .from("attendance_correlation_insights")
      .upsert(
        {
          school_id,
          overall_summary: analysis.overall_summary,
          route_insights: analysis.route_insights || [],
          student_flags: analysis.student_flags || [],
          generated_at: new Date().toISOString(),
        },
        { onConflict: "school_id" }
      );
    if (upsertErr) throw upsertErr;

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-attendance-correlation error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
