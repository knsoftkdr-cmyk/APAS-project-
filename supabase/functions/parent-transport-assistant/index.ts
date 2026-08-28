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

// Parent-facing: NEVER accepts a free-text student name or vehicle
// registration. Every query is hard-scoped server-side to the single
// student_id (profiles.id) passed in — resolved to that child's own
// active transport_assignments row and nothing else. There is no
// navigate or vehicle_status_update intent here on purpose.
const PARENT_TRANSPORT_TOOL = {
  functionDeclarations: [
    {
      name: "handle_parent_transport_query",
      description: "Classify what a parent wants to know about their child's school bus.",
      parameters: {
        type: "OBJECT",
        properties: {
          intent: {
            type: "STRING",
            description:
              "One of: bus_location, driver_info, route_info, chat",
          },
          chat_reply: { type: "STRING", description: "For chat intent: a short natural reply to greetings or general questions." },
        },
        required: ["intent"],
      },
    },
  ],
};

async function callGemini(systemPrompt: string, userPrompt: string, keys: string[]): Promise<any | null> {
  const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
  for (const key of keys) {
    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              tools: [PARENT_TRANSPORT_TOOL],
              generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
            }),
          },
        );
        if (response.status === 429 || response.status === 503) continue;
        if (!response.ok) continue;
        const data = await response.json();
        const candidate = data?.candidates?.[0];
        if (!candidate) continue;
        return candidate;
      } catch (_e) {
        // try next key/model
      }
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message, school_id, student_id } = await req.json();
    if (!school_id || !student_id) {
      return new Response(JSON.stringify({ type: "message", text: "I need to know which student this is for." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const keys = getGeminiKeys();
    if (keys.length === 0) {
      return new Response(JSON.stringify({ error: "No AI API keys configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // student_id here is profiles.id (matches ParentDashboard's selectedChild) —
    // resolve the real students.id first, same as fetchTransport does client-side.
    const { data: studentRow } = await supabase
      .from("students")
      .select("id, full_name")
      .eq("profile_id", student_id)
      .eq("school_id", school_id)
      .maybeSingle();

    if (!studentRow) {
      return new Response(JSON.stringify({ type: "message", text: "I couldn't find transport details for this student." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: assignment } = await supabase
      .from("transport_assignments")
      .select("route_id, pickup_stop_id, drop_stop_id, transport_routes(route_name, route_number, vehicle_id, drivers(name, phone), bus_attendants(name, phone))")
      .eq("student_id", studentRow.id)
      .eq("status", "active")
      .maybeSingle();

    if (!assignment) {
      return new Response(JSON.stringify({ type: "message", text: `${studentRow.full_name || "Your child"} doesn't have an active bus assignment right now.` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const route: any = (assignment as any).transport_routes ?? null;
    const driver: any = route?.drivers ?? null;
    const attendant: any = route?.bus_attendants ?? null;

    const systemPrompt = `You are the APAS Parent Transport Assistant, helping a parent with their child's school bus.
Classify the message and call handle_parent_transport_query with the right intent:
- bus_location: asking where the bus is, if it's on time, running late, or its live status
- driver_info: asking about the driver or attendant, name, phone number
- route_info: asking about the route, pickup time, pickup/drop stop
- chat: greetings, small talk, or anything else - reply briefly and naturally in chat_reply`;

    const candidate = await callGemini(systemPrompt, message, keys);
    const parts = candidate?.content?.parts || [];
    const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;
    const intent = fnCall?.args?.intent;

    switch (intent) {
      case "bus_location": {
        if (!route?.vehicle_id) {
          return new Response(JSON.stringify({ type: "message", text: "No vehicle is assigned to this route yet." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const { data: position } = await supabase
          .from("vehicle_locations")
          .select("updated_at")
          .eq("vehicle_id", route.vehicle_id)
          .maybeSingle();
        if (!position) {
          return new Response(JSON.stringify({ type: "message", text: "The driver hasn't started sharing live location yet today." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const staleMinutes = Math.round((Date.now() - new Date(position.updated_at).getTime()) / 60000);
        const text = staleMinutes > 2
          ? `The bus's location was last updated ${staleMinutes} minute(s) ago, so it may be out of date. Check the map for the last known spot.`
          : `The bus is live — its location was updated ${staleMinutes} minute(s) ago.`;
        return new Response(JSON.stringify({ type: "message", text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "driver_info": {
        const text = driver
          ? `Driver: ${driver.name}${driver.phone ? `, phone ${driver.phone}` : ""}.` +
            (attendant ? ` Attendant: ${attendant.name}${attendant.phone ? `, phone ${attendant.phone}` : ""}.` : "")
          : "No driver has been assigned to this route yet.";
        return new Response(JSON.stringify({ type: "message", text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "route_info": {
        let pickupTime: string | null = null;
        if (assignment.pickup_stop_id) {
          const { data: stopRow } = await supabase
            .from("route_stops").select("stop_name, pickup_time").eq("id", assignment.pickup_stop_id).maybeSingle();
          pickupTime = stopRow?.pickup_time ?? null;
        }
        const text = route
          ? `Route: ${route.route_name}${route.route_number ? ` (${route.route_number})` : ""}.${pickupTime ? ` Pickup time: ${pickupTime}.` : ""}`
          : "No route has been assigned yet.";
        return new Response(JSON.stringify({ type: "message", text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      default:
        return new Response(JSON.stringify({ type: "message", text: fnCall?.args?.chat_reply || parts.find((p: any) => p.text)?.text?.trim() || "I can help with the bus's live location, the driver or attendant's contact info, or the route and pickup time." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (e) {
    console.error("parent-transport-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});