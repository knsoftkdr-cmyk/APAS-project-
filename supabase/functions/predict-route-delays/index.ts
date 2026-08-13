// supabase/functions/predict-route-delays/index.ts
//
// AI Insights — Delay Prediction.
// Aggregates the last 30 days of completed trips (with a valid schedule) per
// route — average delay, trip count, and a simple week-over-week trend —
// then asks an LLM to forecast which routes are at highest risk of future
// delays, with reasoning and a recommendation per flagged route.
// Result is cached (upserted) into route_delay_predictions, one row per school.
//
// Invoke: POST { school_id: string }
// Returns: { forecast: {...} }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Delay (minutes) = started_at - (trip_date + scheduled_start_time).
// scheduled_start_time is a naive local-time column (no timezone) written
// as-typed from the scheduling form — the school's wall-clock time, NOT
// UTC. started_at is a real UTC instant. This matches the exact convention
// already established and verified working in DelayAnalyticsSubTab.tsx:
// parse trip_date + scheduled_start_time as a literal (unzoned) Date and
// compare directly against started_at.
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

    const { data: trips, error: tripsErr } = await supabase
      .from("trips")
      .select("trip_date, started_at, scheduled_start_time, route_id, transport_routes(route_name, route_number)")
      .eq("school_id", school_id)
      .eq("status", "completed")
      .not("started_at", "is", null)
      .not("scheduled_start_time", "is", null)
      .gte("trip_date", thirtyDaysAgo)
      .lte("trip_date", today);
    if (tripsErr) throw tripsErr;

    if (!trips || trips.length === 0) {
      return new Response(
        JSON.stringify({ error: "Not enough trip history with schedule data to forecast delays yet." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delay per trip: uses the module-level delayMinutes() helper, which
    // matches the exact convention already established and verified in
    // DelayAnalyticsSubTab.tsx (see comment on that function above).
    const byRoute = new Map<string, { label: string; delays: { date: string; delay: number }[] }>();
    for (const t of trips as any[]) {
      if (!t.route_id) continue;
      const label = t.transport_routes
        ? `Route ${t.transport_routes.route_number || t.transport_routes.route_name}`
        : "Unknown Route";
      if (!byRoute.has(t.route_id)) byRoute.set(t.route_id, { label, delays: [] });
      byRoute.get(t.route_id)!.delays.push({
        date: t.trip_date,
        delay: delayMinutes(t.trip_date, t.scheduled_start_time, t.started_at),
      });
    }

    // Per-route stats: overall avg, trip count, and a first-half vs
    // second-half average split (simple trend signal for the LLM).
    const routeStats = [...byRoute.entries()].map(([routeId, r]) => {
      const sorted = [...r.delays].sort((a, b) => a.date.localeCompare(b.date));
      const mid = Math.floor(sorted.length / 2);
      const firstHalf = sorted.slice(0, mid);
      const secondHalf = sorted.slice(mid);
      const avg = (arr: typeof sorted) => arr.length ? Math.round(arr.reduce((s, d) => s + d.delay, 0) / arr.length) : null;
      return {
        routeId,
        label: r.label,
        tripCount: sorted.length,
        avgDelay: avg(sorted),
        earlierAvg: avg(firstHalf),
        laterAvg: avg(secondHalf),
      };
    }).sort((a, b) => (b.avgDelay ?? -999) - (a.avgDelay ?? -999));

    const systemPrompt = `You are a transport operations analyst for a school. Based on each route's recent delay history (average delay in minutes, trip count, and an earlier-period vs later-period average showing trend direction), forecast which routes are at highest risk of running late going forward.

Return ONLY valid JSON in this exact structure (no markdown, no code fences):
{
  "overall_summary": "2-3 sentence overview of the fleet's delay picture across all routes",
  "route_forecasts": [
    {
      "route_label": "the route label as given",
      "risk_level": "low" | "medium" | "high",
      "forecast": "1-2 sentence forward-looking prediction for this route",
      "reasoning": "1 sentence citing the specific numbers that support this",
      "recommendation": "1 short actionable suggestion"
    }
  ]
}

Rules:
- Base every forecast ONLY on the numbers provided — do not invent causes (traffic, weather, etc.) not present in the data
- A route with very few trips should be flagged as low-confidence in its reasoning rather than given a strong risk rating
- A worsening trend (laterAvg notably higher than earlierAvg) should raise risk_level even if the overall average looks moderate
- Include a forecast for every route provided, ordered highest risk first
- Be concise and practical, written for a transport administrator`;

    const userPrompt = `Today's date: ${today}
Delay history covers the last 30 days. Positive delay = late (minutes), negative = early.

${routeStats.map(r =>
  `${r.label}: ${r.tripCount} trip(s), overall avg delay ${r.avgDelay ?? "n/a"} min` +
  (r.earlierAvg !== null && r.laterAvg !== null ? `, earlier-period avg ${r.earlierAvg} min vs later-period avg ${r.laterAvg} min` : "")
).join("\n")}

Forecast delay risk for each route.`;

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

    let forecast;
    try {
      forecast = JSON.parse(content);
    } catch (e) {
      console.error("Parse error:", e, content);
      throw new Error("AI returned invalid JSON");
    }

    const { error: upsertErr } = await supabase
      .from("route_delay_predictions")
      .upsert(
        {
          school_id,
          overall_summary: forecast.overall_summary,
          route_forecasts: forecast.route_forecasts || [],
          generated_at: new Date().toISOString(),
        },
        { onConflict: "school_id" }
      );
    if (upsertErr) throw upsertErr;

    return new Response(JSON.stringify({ forecast }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("predict-route-delays error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
