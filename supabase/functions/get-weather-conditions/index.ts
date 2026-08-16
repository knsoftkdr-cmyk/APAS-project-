// supabase/functions/get-weather-conditions/index.ts
// Deploy via Supabase dashboard editor only (per project convention)
// No secret required — Open-Meteo is free, no API key, no subscription.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WeatherRequest {
  route_id: string;
  school_id: string;
  route_name?: string;
  lat: number;
  lon: number;
}

// WMO weather codes -> our condition labels (clear | clouds | rain | storm | fog | snow | extreme)
function classifyCondition(code: number): string {
  if (code === 0) return "clear";
  if (code >= 1 && code <= 3) return "clouds";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 85 && code <= 86) return "snow";
  if (code >= 95 && code <= 99) return "storm";
  return "clear";
}

function describeCondition(code: number): string {
  const map: Record<number, string> = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
  };
  return map[code] ?? "Adverse weather";
}

// No official govt alerts on Open-Meteo — severity is threshold-based on raw conditions,
// with storm/extreme weather codes treated as an automatic "severe" signal.
function classifySeverity(code: number, precipMm: number, windKmh: number, visibilityM: number): string {
  if (code >= 95 && code <= 99) return "severe"; // thunderstorm
  if (precipMm > 15 || windKmh > 50 || visibilityM < 1000) return "moderate";
  if (precipMm > 2 || windKmh > 30) return "minor";
  return "none";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { route_id, school_id, route_name, lat, lon }: WeatherRequest = await req.json();

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,visibility&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);
    const json = await res.json();
    const current = json.current;
    if (!current) throw new Error("Open-Meteo returned no current data");

    const weatherCode: number = current.weather_code ?? 0;
    const condition = classifyCondition(weatherCode);
    const precipMm = (current.precipitation ?? 0) + (current.rain ?? 0) + (current.showers ?? 0);
    const windKmh = current.wind_speed_10m ?? 0; // Open-Meteo default unit is already km/h
    const visibilityM = current.visibility ?? 10000;
    const severity = classifySeverity(weatherCode, precipMm, windKmh, visibilityM);

    const alertMessage = severity !== "none" ? describeCondition(weatherCode) : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data, error } = await supabase
      .from("transport_weather_snapshots")
      .insert({
        school_id,
        route_id,
        temp_c: current.temperature_2m,
        condition,
        precipitation_mm: precipMm,
        visibility_m: visibilityM,
        wind_speed_kmh: windKmh,
        severity,
        raw_alerts: alertMessage ? [{ event: alertMessage }] : [],
        source: "open-meteo",
      })
      .select()
      .single();

    if (error) throw error;

    // Fire-and-forget staff push alert if severity is moderate or worse.
    // Matches the pattern used by DriverDashboard.tsx for overspeed/route-deviation
    // alerts: plain fetch to the function URL with { type, payload }, non-blocking.
    if (severity === "moderate" || severity === "severe") {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "weather_alert",
            payload: {
              school_id,
              route_id,
              route_name,
              severity,
              condition,
              alert_message: alertMessage,
            },
          }),
        });
      } catch (_err) {
        // Non-critical — don't fail the main weather response over a push failure.
      }
    }

    return new Response(JSON.stringify({ snapshot: data, severity }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
