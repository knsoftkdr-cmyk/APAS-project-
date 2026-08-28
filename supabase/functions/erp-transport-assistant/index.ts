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

const VALID_TABS = [
  "vehicles", "drivers", "routes", "assignments", "geofencing", "multiroute",
  "trips", "boardinglogs", "incidents", "maintenance", "fuel", "behaviour",
  "speedmonitoring", "routedeviation", "weather", "occupancy", "analytics",
  "aiinsights", "executive", "emergency",
];

const TRANSPORT_TOOL = {
  functionDeclarations: [
    {
      name: "handle_transport_query",
      description: "Classify what a school transport administrator wants and extract relevant details.",
      parameters: {
        type: "OBJECT",
        properties: {
          intent: {
            type: "STRING",
            description:
              "One of: fleet_status, driver_status, route_info, student_lookup, delay_forecast, navigate, vehicle_status_update, chat",
          },
          route_name: { type: "STRING", description: "Route name or number mentioned, if any." },
          student_name: { type: "STRING", description: "Student name mentioned, if any." },
          vehicle_registration: { type: "STRING", description: "Vehicle registration number mentioned, if any." },
          new_status: { type: "STRING", description: "For vehicle_status_update only: active, inactive, or maintenance." },
          target_tab: {
            type: "STRING",
            description: `For navigate only. One of: ${VALID_TABS.join(", ")}`,
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
              tools: [TRANSPORT_TOOL],
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

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message, school_id } = await req.json();
    if (!school_id) {
      return new Response(JSON.stringify({ type: "message", text: "I need to know which school this is for." }), {
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

    const systemPrompt = `You are APAS Transport AI Assistant, helping a school transport administrator.
Available navigation tabs: ${VALID_TABS.join(", ")}.
Classify the message and call handle_transport_query with the right intent:
- fleet_status: asking about vehicles overall, fleet health, documents expiring
- driver_status: asking about drivers overall, license/medical expiry, verification
- route_info: asking about a specific route or route seat availability (extract route_name if given)
- student_lookup: asking about a specific student's transport/bus/route/pickup (extract student_name)
- delay_forecast: asking about delays, which routes run late, punctuality
- navigate: asking to go to/open/show a specific screen (extract target_tab from the list above)
- vehicle_status_update: asking to change a vehicle's status, e.g. mark a bus as under maintenance (extract vehicle_registration and new_status)
- chat: greetings, small talk, or anything else - reply briefly and naturally in chat_reply`;

    const candidate = await callGemini(systemPrompt, message, keys);
    const parts = candidate?.content?.parts || [];
    const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;

    if (!fnCall) {
      return new Response(JSON.stringify({
        type: "message",
        text: parts.find((p: any) => p.text)?.text?.trim() || "I can help with fleet status, driver status, routes, student transport lookups, delay forecasts, or navigating the transport module.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const args = fnCall.args || {};

    switch (args.intent) {
      case "navigate": {
        const tab = VALID_TABS.includes(args.target_tab) ? args.target_tab : null;
        if (!tab) {
          return new Response(JSON.stringify({ type: "message", text: "I couldn't tell which screen you meant  -  could you name it, e.g. 'drivers' or 'fuel'?" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ type: "navigate", target_tab: tab, text: `Opening ${tab}...` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "fleet_status": {
        const { data: vehicles } = await supabase
          .from("vehicles").select("registration_number, status, insurance_expiry, fitness_expiry, permit_expiry, puc_expiry")
          .eq("school_id", school_id);
        const list = vehicles || [];
        const byStatus: Record<string, number> = {};
        list.forEach((v: any) => { byStatus[v.status] = (byStatus[v.status] || 0) + 1; });
        const expiringSoon = list.filter((v: any) =>
          [v.insurance_expiry, v.fitness_expiry, v.permit_expiry, v.puc_expiry].some((d) => {
            const days = daysUntil(d);
            return days !== null && days >= 0 && days <= 30;
          })
        );
        const vehicleWord = list.length === 1 ? "vehicle" : "vehicles";
        const statusPhrase = Object.entries(byStatus).map(([s, c]) => `${c} ${s}`).join(", ");
        let text = `You have ${list.length} ${vehicleWord} in the fleet: ${statusPhrase}.`;
        if (expiringSoon.length > 0) {
          const docWord = expiringSoon.length === 1 ? "vehicle has" : "vehicles have";
          text += ` ${expiringSoon.length} ${docWord} a document expiring within 30 days: ${expiringSoon.map((v: any) => v.registration_number).join(", ")}.`;
        } else {
          text += " No documents are expiring in the next 30 days.";
        }
        return new Response(JSON.stringify({ type: "message", text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "driver_status": {
        const { data: drivers } = await supabase
          .from("drivers").select("name, status, license_expiry, medical_certificate_expiry, license_verification_status, background_verification_status")
          .eq("school_id", school_id);
        const list = drivers || [];
        const expiringSoon = list.filter((d: any) => {
          const l = daysUntil(d.license_expiry);
          const m = daysUntil(d.medical_certificate_expiry);
          return (l !== null && l >= 0 && l <= 30) || (m !== null && m >= 0 && m <= 30);
        });
        const pendingVerification = list.filter((d: any) =>
          d.license_verification_status === "pending" || d.background_verification_status === "pending"
        );
        const driverWord = list.length === 1 ? "driver" : "drivers";
        let text = `You have ${list.length} ${driverWord} total.`;
        if (expiringSoon.length > 0) text += ` ${expiringSoon.length} with a license or medical certificate expiring within 30 days: ${expiringSoon.map((d: any) => d.name).join(", ")}.`;
        if (pendingVerification.length > 0) text += ` ${pendingVerification.length} with pending verification: ${pendingVerification.map((d: any) => d.name).join(", ")}.`;
        if (expiringSoon.length === 0 && pendingVerification.length === 0) text += " All clear on expiry and verification.";
        return new Response(JSON.stringify({ type: "message", text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "route_info": {
        const { data: routes } = await supabase
          .from("transport_routes")
          .select("id, route_name, route_number, status, vehicles(capacity)")
          .eq("school_id", school_id);
        const list = (routes || []) as any[];
        const matched = args.route_name
          ? list.filter((r) =>
              r.route_name?.toLowerCase().includes(String(args.route_name).toLowerCase()) ||
              r.route_number?.toLowerCase() === String(args.route_name).toLowerCase()
            )
          : list;

        if (matched.length === 0) {
          return new Response(JSON.stringify({ type: "message", text: `I couldn't find a route matching "${args.route_name}".` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { data: assignments } = await supabase
          .from("transport_assignments").select("route_id").eq("school_id", school_id).eq("status", "active");
        const filledByRoute = new Map<string, number>();
        (assignments || []).forEach((a: any) => filledByRoute.set(a.route_id, (filledByRoute.get(a.route_id) || 0) + 1));

        const lines = matched.slice(0, 8).map((r) => {
          const cap = r.vehicles?.capacity;
          const filled = filledByRoute.get(r.id) || 0;
          return `${r.route_name}${r.route_number ? ` (${r.route_number})` : ""}: ${r.status}, ${filled}${cap != null ? `/${cap}` : ""} seats filled`;
        });
        return new Response(JSON.stringify({ type: "message", text: lines.join(". ") }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "student_lookup": {
        if (!args.student_name) {
          return new Response(JSON.stringify({ type: "message", text: "Which student would you like me to look up?" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const { data: students } = await supabase
          .from("students").select("id, full_name, class").eq("school_id", school_id)
          .ilike("full_name", `%${args.student_name}%`).limit(3);
        if (!students || students.length === 0) {
          return new Response(JSON.stringify({ type: "message", text: `No student found matching "${args.student_name}".` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const student = students[0];
        const { data: assignment } = await supabase
          .from("transport_assignments")
          .select("seat_number, fee_status, route_id, pickup_stop_id")
          .eq("student_id", student.id).eq("status", "active").maybeSingle();
        if (!assignment) {
          return new Response(JSON.stringify({ type: "message", text: `${student.full_name} (${student.class || "class n/a"}) has no active transport assignment.` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const [{ data: route }, { data: stop }] = await Promise.all([
          assignment.route_id
            ? supabase.from("transport_routes").select("route_name, route_number").eq("id", assignment.route_id).maybeSingle()
            : Promise.resolve({ data: null }),
          assignment.pickup_stop_id
            ? supabase.from("route_stops").select("stop_name, pickup_time").eq("id", assignment.pickup_stop_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        const text = `${student.full_name} (${student.class || "class n/a"}): route ${route?.route_name || " - "}${route?.route_number ? ` (${route.route_number})` : ""}, seat ${assignment.seat_number ?? "unassigned"}, pickup at ${stop?.stop_name || " - "}${stop?.pickup_time ? ` (${stop.pickup_time})` : ""}. Fee status: ${assignment.fee_status || " - "}.`;
        return new Response(JSON.stringify({ type: "message", text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "delay_forecast": {
        const { data: cached } = await supabase
          .from("route_delay_predictions").select("overall_summary, route_forecasts, generated_at")
          .eq("school_id", school_id).maybeSingle();
        if (!cached) {
          return new Response(JSON.stringify({ type: "message", text: "No delay forecast has been generated yet  -  run it from the AI Insights tab first, then ask me again." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const forecasts = (cached.route_forecasts || []) as any[];
        const high = forecasts.filter((f) => f.risk_level === "high").map((f) => f.route_label);
        let text = cached.overall_summary || "";
        if (high.length > 0) text += ` Highest risk right now: ${high.join(", ")}.`;
        return new Response(JSON.stringify({ type: "message", text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "vehicle_status_update": {
        if (!args.vehicle_registration || !args.new_status) {
          return new Response(JSON.stringify({ type: "message", text: "Tell me the vehicle registration number and the status you want (active, inactive, or maintenance)." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const validStatuses = ["active", "inactive", "maintenance"];
        if (!validStatuses.includes(args.new_status)) {
          return new Response(JSON.stringify({ type: "message", text: `"${args.new_status}" isn't a valid status  -  use active, inactive, or maintenance.` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const { data: vehicle } = await supabase
          .from("vehicles").select("id, registration_number").eq("school_id", school_id)
          .ilike("registration_number", `%${args.vehicle_registration}%`).maybeSingle();
        if (!vehicle) {
          return new Response(JSON.stringify({ type: "message", text: `No vehicle found matching "${args.vehicle_registration}".` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          type: "action_confirm",
          action: "update_vehicle_status",
          vehicle_id: vehicle.id,
          vehicle_registration: vehicle.registration_number,
          new_status: args.new_status,
          text: `Mark ${vehicle.registration_number} as ${args.new_status}?`,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      default:
        return new Response(JSON.stringify({ type: "message", text: args.chat_reply || "I can help with fleet status, driver status, routes, student lookups, delay forecasts, or navigating the transport module." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (e) {
    console.error("erp-transport-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});