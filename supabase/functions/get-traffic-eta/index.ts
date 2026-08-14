/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />
// Calls TomTom's Routing API with traffic=true, server-side, so the API key
// never reaches the browser. Returns the live-traffic travel time and the
// no-traffic baseline for the primary route (same shape as before, so
// existing callers are unaffected), plus an optional set of alternate
// routes, a derived congestion label, and (only when includeGeometry is
// requested) a road-following point path for turn-by-turn rendering.
// Geometry is opt-in because it's the bulk of the payload and most callers
// (the 30s Traffic Intelligence poll) don't need it.
const TOMTOM_API_KEY = Deno.env.get("TOMTOM_API_KEY")!;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Every response — not just the OPTIONS preflight — needs these headers, or
// the browser blocks the client from reading the response body even though
// the request succeeded server-side.
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

// Ratio of traffic delay to no-traffic time. Thresholds are a starting
// point, not tuned against real data yet.
function congestionLabel(delaySeconds: number, noTrafficSeconds: number): "low" | "moderate" | "heavy" {
  if (noTrafficSeconds <= 0) return "low";
  const ratio = delaySeconds / noTrafficSeconds;
  if (ratio >= 0.5) return "heavy";
  if (ratio >= 0.2) return "moderate";
  return "low";
}

interface RouteSummary {
  liveSeconds: number;
  noTrafficSeconds: number;
  delaySeconds: number;
  distanceMeters: number;
  geometry?: [number, number][];
}

function extractGeometry(route: any): [number, number][] {
  const legs = route.legs ?? [];
  const pts: [number, number][] = [];
  for (const leg of legs) {
    for (const p of leg.points ?? []) {
      if (p.latitude != null && p.longitude != null) pts.push([p.latitude, p.longitude]);
    }
  }
  return pts;
}

function summarizeRoute(route: any, includeGeometry: boolean): RouteSummary {
  const summary = route.summary;
  const liveSeconds: number = summary.travelTimeInSeconds;
  const noTrafficSeconds: number = summary.noTrafficTravelTimeInSeconds ?? liveSeconds;
  const distanceMeters: number = summary.lengthInMeters;
  const delaySeconds = Math.max(0, liveSeconds - noTrafficSeconds);
  const result: RouteSummary = { liveSeconds, noTrafficSeconds, delaySeconds, distanceMeters };
  if (includeGeometry) result.geometry = extractGeometry(route);
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  try {
    const body = await req.json();
    const { originLat, originLng, destLat, destLng, maxAlternatives, includeGeometry } = body;
    if (originLat == null || originLng == null || destLat == null || destLng == null) {
      return json(
        { success: false, message: "originLat, originLng, destLat, destLng are required" },
        400
      );
    }
    // Clamp: TomTom supports up to a handful of alternatives, we only need up to 2.
    const altCount = Math.max(0, Math.min(2, Number(maxAlternatives) || 0));
    const wantGeometry = includeGeometry === true;
    const url =
      `https://api.tomtom.com/routing/1/calculateRoute/` +
      `${originLat},${originLng}:${destLat},${destLng}/json` +
      `?key=${TOMTOM_API_KEY}&traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all` +
      (altCount > 0 ? `&maxAlternatives=${altCount}` : "");
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      return json({ success: false, message: `TomTom API error: ${res.status} ${errText}` }, 502);
    }
    const data = await res.json();
    const routes = data?.routes ?? [];
    if (routes.length === 0) {
      return json({ success: false, message: "No route found" }, 404);
    }

    const primary = summarizeRoute(routes[0], wantGeometry);
    const alternates = routes.slice(1).map((r: any) => summarizeRoute(r, wantGeometry));

    return json({
      success: true,
      // Same flat fields as before — existing get-traffic-eta callers keep working unchanged.
      liveSeconds: primary.liveSeconds,
      noTrafficSeconds: primary.noTrafficSeconds,
      delaySeconds: primary.delaySeconds,
      distanceMeters: primary.distanceMeters,
      // Additive fields.
      congestionLevel: congestionLabel(primary.delaySeconds, primary.noTrafficSeconds),
      alternates,
      ...(wantGeometry ? { geometry: primary.geometry } : {}),
    });
  } catch (error) {
    return json({ success: false, message: String(error) }, 500);
  }
});