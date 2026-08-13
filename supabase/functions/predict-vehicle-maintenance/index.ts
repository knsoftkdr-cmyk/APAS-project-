// supabase/functions/predict-vehicle-maintenance/index.ts
//
// AI Predictive Maintenance — single-vehicle analysis.
// Feeds the vehicle's profile (type, mileage, expiry dates), recent service
// history, upcoming/overdue maintenance schedules, and active AMC contract
// to an LLM, and asks for a structured risk assessment + recommendations.
// Result is cached (upserted) into vehicle_maintenance_predictions.
//
// Invoke: POST { vehicle_id: string }
// Returns: { prediction: {...} }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { vehicle_id } = await req.json();
    if (!vehicle_id) {
      return new Response(
        JSON.stringify({ error: "vehicle_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: vehicle, error: vErr } = await supabase
      .from("vehicles")
      .select(
        "id, school_id, registration_number, vehicle_type, capacity, mileage_kmpl, fuel_type, insurance_expiry, fitness_expiry, permit_expiry, puc_expiry, status"
      )
      .eq("id", vehicle_id)
      .maybeSingle();
    if (vErr) throw vErr;
    if (!vehicle) {
      return new Response(
        JSON.stringify({ error: "Vehicle not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [serviceHistoryRes, schedulesRes, amcRes] = await Promise.all([
      supabase
        .from("vehicle_service_history")
        .select("service_date, service_type, vendor_name, cost, odometer_reading, notes")
        .eq("vehicle_id", vehicle_id)
        .order("service_date", { ascending: false })
        .limit(10),
      supabase
        .from("vehicle_maintenance_schedules")
        .select("maintenance_type, scheduled_date, status, notes")
        .eq("vehicle_id", vehicle_id)
        .order("scheduled_date", { ascending: false })
        .limit(10),
      supabase
        .from("vehicle_amc_contracts")
        .select("vendor_name, contract_number, start_date, end_date, coverage_details, status")
        .eq("vehicle_id", vehicle_id)
        .eq("status", "active")
        .maybeSingle(),
    ]);

    const serviceHistory = serviceHistoryRes.data || [];
    const schedules = schedulesRes.data || [];
    const amc = amcRes.data || null;

    const systemPrompt = `You are a fleet maintenance analyst for a school transport department. Based on a vehicle's profile, service history, maintenance schedule, and AMC coverage, assess its failure risk and recommend next steps.

Return ONLY valid JSON in this exact structure (no markdown, no code fences):
{
  "risk_level": "low" | "medium" | "high",
  "summary": "2-3 sentence overall assessment of this vehicle's condition and risk",
  "predicted_issues": [
    { "issue": "short description of a likely upcoming problem", "reasoning": "1 sentence on what in the data suggests this" }
  ],
  "recommended_actions": [
    { "action": "specific recommended action", "urgency": "immediate" | "soon" | "routine" }
  ],
  "next_service_estimate": "a short estimate of when the next service should happen, e.g. 'Within 2 weeks' or 'No urgent service needed'"
}

Rules:
- Base the assessment ONLY on the data provided — don't invent specific facts not given
- If service history is sparse, say so in the summary and lower your confidence rather than fabricating detail
- Give 1-4 predicted issues and 2-5 recommended actions
- Consider document expiry dates (insurance/fitness/permit/PUC) as real risk factors if they're near or past due
- Be concrete and practical, written for a school transport administrator, not a mechanic`;

    const today = new Date().toISOString().slice(0, 10);
    const userPrompt = `Today's date: ${today}

Vehicle: ${vehicle.registration_number} (${vehicle.vehicle_type || "type unknown"})
Status: ${vehicle.status || "unknown"}
Fuel type: ${vehicle.fuel_type || "unknown"}
Mileage: ${vehicle.mileage_kmpl != null ? `${vehicle.mileage_kmpl} km/l` : "not recorded"}
Insurance expiry: ${vehicle.insurance_expiry || "not recorded"}
Fitness certificate expiry: ${vehicle.fitness_expiry || "not recorded"}
Permit expiry: ${vehicle.permit_expiry || "not recorded"}
PUC expiry: ${vehicle.puc_expiry || "not recorded"}

Active AMC contract: ${amc ? `${amc.vendor_name}, covers ${amc.start_date} to ${amc.end_date}. Coverage: ${amc.coverage_details || "not specified"}` : "None on file"}

Recent service history (most recent first):
${serviceHistory.length > 0
  ? serviceHistory.map((s: any) => `- ${s.service_date}: ${s.service_type} by ${s.vendor_name || "unknown vendor"}${s.odometer_reading ? `, odometer ${s.odometer_reading}` : ""}${s.notes ? ` — ${s.notes}` : ""}`).join("\n")
  : "No service history on file."}

Maintenance schedule (most recent first):
${schedules.length > 0
  ? schedules.map((s: any) => `- ${s.scheduled_date}: ${s.maintenance_type} (${s.status})${s.notes ? ` — ${s.notes}` : ""}`).join("\n")
  : "No maintenance schedule entries on file."}

Assess this vehicle's failure risk and recommend next steps.`;

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
            { "HTTP-Referer": "https://lovable.dev", "X-Title": "APAS Predictive Maintenance" }
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

    let prediction;
    try {
      prediction = JSON.parse(content);
    } catch (e) {
      console.error("Parse error:", e, content);
      throw new Error("AI returned invalid JSON");
    }

    const { error: upsertErr } = await supabase
      .from("vehicle_maintenance_predictions")
      .upsert(
        {
          school_id: vehicle.school_id,
          vehicle_id: vehicle.id,
          risk_level: prediction.risk_level,
          summary: prediction.summary,
          predicted_issues: prediction.predicted_issues || [],
          recommended_actions: prediction.recommended_actions || [],
          next_service_estimate: prediction.next_service_estimate || null,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "vehicle_id" }
      );
    if (upsertErr) throw upsertErr;

    return new Response(JSON.stringify({ prediction }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("predict-vehicle-maintenance error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
