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

function timeStringToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function isoToLocalMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message, student_id, history } = await req.json();
    if (!student_id) {
      return new Response(JSON.stringify({ type: "message", text: "I don't know which child this is for yet." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const keys = getGeminiKeys();
    if (keys.length === 0) {
      return new Response(JSON.stringify({ error: "No AI API keys configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Runs as the calling parent (their JWT is forwarded), so RLS applies
    // exactly as it does on their own dashboard - this can only ever see
    // transport data for children this parent is actually linked to.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );

    const { data: assignment } = await supabase
      .from("transport_assignments")
      .select("route_id, pickup_stop_id, drop_stop_id, transport_routes(route_name, route_number, vehicle_id, drivers(name, phone), bus_attendants(name, phone))")
      .eq("student_id", student_id)
      .eq("status", "active")
      .maybeSingle();

    if (!assignment) {
      return new Response(JSON.stringify({ type: "message", text: "I don't see an active bus route set up for your child yet." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const route: any = (assignment as any).transport_routes;
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
      const { data: history } = await supabase
        .from("stop_arrivals").select("arrived_at").eq("route_id", routeId).eq("stop_id", targetStop.id)
        .order("arrival_date", { ascending: false }).limit(30);
      const pickupMin = targetStop.pickup_time ? timeStringToMinutes(targetStop.pickup_time) : null;
      const dropMin = targetStop.drop_time ? timeStringToMinutes(targetStop.drop_time) : null;
      if (history && history.length >= 3 && (pickupMin != null || dropMin != null)) {
        const deltas = history.map((row: any) => {
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

    const context = `
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

    const systemPrompt = `You are a warm, friendly assistant helping a parent track their child's school bus. Talk like a helpful person, not a script - vary your phrasing naturally and respond directly to what the parent actually asked or said, using the conversation so far for context.

If the parent just greets you (e.g. "hello", "hi") without asking anything specific, greet them back warmly and briefly ask how you can help - do NOT dump bus details unprompted. Only bring up location, driver, or route info once they actually ask about it.

Answer ONLY using the data given below - never invent GPS coordinates, times, or contact details that aren't present. If something isn't available, say so plainly (e.g. "the bus hasn't started sharing its location yet") rather than guessing. Keep answers to 1-3 short, natural sentences.

CURRENT DATA:
${context}`;

    const reply = await callGemini(systemPrompt, message, keys, Array.isArray(history) ? history.slice(-6) : []);

    return new Response(JSON.stringify({
      type: "message",
      text: reply || "I'm having trouble reaching the AI service right now - please try again in a moment.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("parent-bus-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});