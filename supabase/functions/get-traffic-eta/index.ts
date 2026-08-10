/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

// Calls TomTom's Routing API with traffic=true, server-side, so the API key
// never reaches the browser. Returns both the live-traffic travel time and
// the no-traffic baseline, so the client can show "X min (+Y min traffic)".

const TOMTOM_API_KEY = Deno.env.get("TOMTOM_API_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Every response — not just the OPTIONS preflight — needs these headers, or
// the browser blocks the client from reading the response body even though
// the request succeeded server-side.
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { originLat, originLng, destLat, destLng } = body;

    if (originLat == null || originLng == null || destLat == null || destLng == null) {
      return json(
        { success: false, message: "originLat, originLng, destLat, destLng are required" },
        400
      );
    }

    const url =
      `https://api.tomtom.com/routing/1/calculateRoute/` +
      `${originLat},${originLng}:${destLat},${destLng}/json` +
      `?key=${TOMTOM_API_KEY}&traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all`;

    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      return json({ success: false, message: `TomTom API error: ${res.status} ${errText}` }, 502);
    }

    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) {
      return json({ success: false, message: "No route found" }, 404);
    }

    const summary = route.summary;
    const liveSeconds: number = summary.travelTimeInSeconds;
    const noTrafficSeconds: number = summary.noTrafficTravelTimeInSeconds ?? liveSeconds;
    const distanceMeters: number = summary.lengthInMeters;
    const delaySeconds = Math.max(0, liveSeconds - noTrafficSeconds);

    return json({
      success: true,
      liveSeconds,
      noTrafficSeconds,
      delaySeconds,
      distanceMeters,
    });
  } catch (error) {
    return json({ success: false, message: String(error) }, 500);
  }
});
