// supabase/functions/analyze-travel-patterns/index.ts
//
// AI Insights — Student Travel Pattern Analysis.
// Stop-level: for each stop, actual arrival times (stop_arrivals) vs the
// stop's scheduled pickup_time (route_stops), over the last 30 days —
// flags stops that consistently run late.
// Student-level: for each student with an active transport assignment,
// their actual boarding times (boarding_confirmations, pickup direction)
// vs their stop's scheduled pickup_time — flags students with a high
// average delay or high variability (irregular boarding pattern).
// Result cached (upserted) into student_travel_pattern_insights, one row
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

// Same convention as DelayAnalyticsSubTab.tsx / predict-route-delays:
// scheduled *_time columns are naive local-time (school wall-clock, no
// timezone); arrived_at/boarded_at are real UTC instants. Parse the
// scheduled time literally against the given calendar date and compare
// directly.
function delayMinutes(dateStr: string, scheduledTime: string, actualIso: string): number {
  const scheduled = new Date(`${dateStr}T${scheduledTime}`);
  const actual = new Date(actualIso);
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
      .select("student_id, route_id, pickup_stop_id")
      .eq("school_id", school_id)
      .eq("status", "active")
      .not("pickup_stop_id", "is", null);
    if (aErr) throw aErr;

    if (!assignments || assignments.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active transport assignments with a pickup stop found — nothing to analyze yet." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stopIds = [...new Set(assignments.map(a => a.pickup_stop_id).filter(Boolean))];
    const assignedStudentIds = [...new Set(assignments.map(a => a.student_id))];

    const [stopsRes, arrivalsRes, boardingRes, studentsRes] = await Promise.all([
      supabase.from("route_stops").select("id, stop_name, pickup_time").in("id", stopIds),
      supabase.from("stop_arrivals").select("stop_id, arrival_date, arrived_at")
        .eq("school_id", school_id).in("stop_id", stopIds)
        .gte("arrival_date", thirtyDaysAgo).lte("arrival_date", today),
      supabase.from("boarding_confirmations").select("student_id, stop_id, trip_date, boarded_at")
        .eq("school_id", school_id).eq("direction", "pickup").in("stop_id", stopIds)
        .gte("trip_date", thirtyDaysAgo).lte("trip_date", today),
      supabase.from("students").select("id, full_name").in("id", assignedStudentIds),
    ]);
    if (stopsRes.error) throw stopsRes.error;
    if (arrivalsRes.error) throw arrivalsRes.error;
    if (boardingRes.error) throw boardingRes.error;
    if (studentsRes.error) throw studentsRes.error;

    const stopInfo = new Map((stopsRes.data || []).map((s: any) => [s.id, s]));
    const studentName = new Map((studentsRes.data || []).map((s: any) => [s.id, s.full_name || "Unnamed Student"]));
    const stopIdByStudent = new Map(assignments.map(a => [a.student_id, a.pickup_stop_id]));

    // Stop-level: actual vehicle arrival vs scheduled pickup_time
    const delaysByStop = new Map<string, number[]>();
    for (const arr of (arrivalsRes.data || []) as any[]) {
      const stop = stopInfo.get(arr.stop_id);
      if (!stop?.pickup_time || !arr.arrived_at) continue;
      if (!delaysByStop.has(arr.stop_id)) delaysByStop.set(arr.stop_id, []);
      delaysByStop.get(arr.stop_id)!.push(delayMinutes(arr.arrival_date, stop.pickup_time, arr.arrived_at));
    }
    const stopStats = [...delaysByStop.entries()].map(([stopId, delays]) => ({
      label: stopInfo.get(stopId)?.stop_name || "Unknown Stop",
      arrivalCount: delays.length,
      avgDelay: Math.round(delays.reduce((s, d) => s + d, 0) / delays.length),
    })).sort((a, b) => b.avgDelay - a.avgDelay);

    // Student-level: actual boarding time vs their stop's scheduled pickup_time
    const boardingByStudent = new Map<string, number[]>();
    for (const b of (boardingRes.data || []) as any[]) {
      const stop = stopInfo.get(b.stop_id);
      if (!stop?.pickup_time || !b.boarded_at) continue;
      if (!boardingByStudent.has(b.student_id)) boardingByStudent.set(b.student_id, []);
      boardingByStudent.get(b.student_id)!.push(delayMinutes(b.trip_date, stop.pickup_time, b.boarded_at));
    }
    const studentStats = [...boardingByStudent.entries()]
      .map(([studentId, delays]) => {
        const avg = delays.reduce((s, d) => s + d, 0) / delays.length;
        const range = Math.max(...delays) - Math.min(...delays);
        return {
          name: studentName.get(studentId) || "Unknown Student",
          boardingCount: delays.length,
          avgDelay: Math.round(avg),
          rangeMinutes: Math.round(range),
        };
      })
      .filter(s => s.boardingCount >= 3) // need a few data points to call something a "pattern"
      .sort((a, b) => (b.avgDelay + b.rangeMinutes) - (a.avgDelay + a.rangeMinutes))
      .slice(0, 20);

    const systemPrompt = `You are a school transport operations analyst. You're given two datasets covering the last 30 days:
1. Stop-level: for each pickup stop, how many vehicle arrivals were logged and the average delay (minutes) vs the stop's scheduled pickup time.
2. Student-level: for students with at least 3 logged boardings, their average boarding delay (minutes) and the range (max-min) of their boarding delays — a large range means irregular/inconsistent boarding, not necessarily always late.

Identify which stops are consistently inefficient (route optimization angle) and which students have notably irregular or consistently late boarding patterns worth a closer look.

Return ONLY valid JSON in this exact structure (no markdown, no code fences):
{
  "overall_summary": "2-3 sentence overview of stop efficiency and student boarding consistency across the fleet",
  "stop_insights": [
    { "stop_label": "as given", "efficiency": "good" | "needs_attention" | "poor", "insight": "1-2 sentences citing the specific numbers" }
  ],
  "student_patterns": [
    { "student_name": "as given", "pattern": "1 sentence describing the pattern (e.g. consistently late, highly irregular)", "recommendation": "1 short actionable next step" }
  ]
}

Rules:
- Positive delay = late, negative = early
- A large range (e.g. 15+ minutes) with a low average delay means irregular, not late — describe it that way, don't conflate the two
- Only include a stop_insight for stops with at least 3 arrivals logged; skip low-data stops
- Only include a student_pattern for students whose numbers are genuinely notable (avg delay 5+ min, or range 15+ min) — omit the rest rather than padding the list
- Be concise and practical, written for a school transport administrator`;

    const userPrompt = `Today's date: ${today}. Data covers the last 30 days.

STOP-LEVEL DATA:
${stopStats.map(s => `${s.label}: ${s.arrivalCount} arrival(s), avg delay ${s.avgDelay} min`).join("\n") || "(no stop arrival data)"}

STUDENT-LEVEL DATA (students with 3+ logged boardings):
${studentStats.map(s => `${s.name}: ${s.boardingCount} boarding(s), avg delay ${s.avgDelay} min, range ${s.rangeMinutes} min`).join("\n") || "(no students with enough boarding data)"}

Identify notable stop efficiency issues and student boarding patterns.`;

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
      .from("student_travel_pattern_insights")
      .upsert(
        {
          school_id,
          overall_summary: analysis.overall_summary,
          stop_insights: analysis.stop_insights || [],
          student_patterns: analysis.student_patterns || [],
          generated_at: new Date().toISOString(),
        },
        { onConflict: "school_id" }
      );
    if (upsertErr) throw upsertErr;

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-travel-patterns error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
