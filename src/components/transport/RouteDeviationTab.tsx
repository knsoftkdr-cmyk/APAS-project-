import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Route, Bell, Loader2, Car, Info, TrafficCone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type SubView = "live" | "alerts";

export function RouteDeviationTab({ schoolId }: { schoolId?: string }) {
  const [subView, setSubView] = useState<SubView>("live");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 bg-slate-100/70 p-1.5 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setSubView("live")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 ${
            subView === "live"
              ? "bg-blue-600 text-white border-blue-600 shadow-sm"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-800"
          }`}
        >
          <Route className="h-3.5 w-3.5" /> Live Route Status
        </button>
        <button
          type="button"
          onClick={() => setSubView("alerts")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 ${
            subView === "alerts"
              ? "bg-blue-600 text-white border-blue-600 shadow-sm"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-800"
          }`}
        >
          <Bell className="h-3.5 w-3.5" /> Route Exception Alerts
        </button>
        <button
          type="button"
          onClick={() => setSubView("traffic")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 ${
            subView === "traffic"
              ? "bg-blue-600 text-white border-blue-600 shadow-sm"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-800"
          }`}
        >
          <TrafficCone className="h-3.5 w-3.5" /> Traffic Intelligence
        </button>
      </div>

      {subView === "live" && <LiveRouteStatusView schoolId={schoolId} />}
      {subView === "alerts" && <RouteAlertsView />}
      {subView === "traffic" && <TrafficIntelligenceView schoolId={schoolId} />}
    </div>
  );
}

// ============================================================
// LIVE ROUTE STATUS
// ============================================================
interface LocationStatus {
  is_off_route: boolean | null;
  is_unauthorized_stop: boolean | null;
  updated_at: string;
}
interface RouteWithStatus {
  id: string;
  route_name: string;
  status: string;
  vehicle_id: string | null;
  vehicles: {
    registration_number: string;
    vehicle_locations: LocationStatus[] | LocationStatus | null;
  } | null;
}

function LiveRouteStatusView({ schoolId }: { schoolId?: string }) {
  const { data: routes, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["live-route-status", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_routes")
        .select("id, route_name, status, vehicle_id, vehicles(registration_number, vehicle_locations(is_off_route, is_unauthorized_stop, updated_at))")
        .eq("school_id", schoolId)
        .eq("status", "active")
        .order("route_name");
      if (error) throw error;
      return data as any as RouteWithStatus[];
    },
    enabled: !!schoolId,
    refetchInterval: 12000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="flex items-center gap-2"><Route className="h-5 w-5" /> Live Route Status</CardTitle>
        <p className="text-xs text-muted-foreground">
          Auto-refreshes every 12s{dataUpdatedAt ? ` · last updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground flex items-start gap-1.5 mb-2">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Approximated from GPS pings against a straight-line stop-to-stop corridor (500m buffer) — not a road-following route path.
        </p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
        ) : !routes || routes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active routes found.</p>
        ) : (
          routes.map((r) => {
            const loc = Array.isArray(r.vehicles?.vehicle_locations) ? r.vehicles?.vehicle_locations[0] : r.vehicles?.vehicle_locations;
            const isStale = loc?.updated_at ? Date.now() - new Date(loc.updated_at).getTime() > 5 * 60 * 1000 : true;
            const hasData = !!loc && !isStale;

            return (
              <div key={r.id} className="flex items-center justify-between rounded-lg border p-3 flex-wrap gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-full bg-muted p-2 shrink-0"><Car className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.route_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {r.vehicles?.registration_number || "No vehicle assigned"}
                      {loc?.updated_at && ` · updated ${new Date(loc.updated_at).toLocaleTimeString()}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!hasData ? (
                    <Badge variant="outline" className="bg-slate-100 text-slate-500 border-slate-200">
                      {loc ? "Stale" : "No data"}
                    </Badge>
                  ) : (
                    <>
                      <Badge
                        variant="outline"
                        className={loc.is_off_route ? "bg-red-50 text-red-600 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}
                      >
                        {loc.is_off_route ? "Off Route" : "On Route"}
                      </Badge>
                      {loc.is_unauthorized_stop && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                          Unauthorized Stop
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// ROUTE EXCEPTION ALERTS (personal notification history — same pattern as
// Speed Limit Alerts; governance_notifications RLS only allows a user to
// see their own rows, so this is "alerts I've received")
// ============================================================
interface AlertRow {
  id: string;
  title: string;
  message: string;
  created_at: string;
  is_read: boolean;
}

function RouteAlertsView() {
  const { data: alerts, isLoading } = useQuery({
    queryKey: ["route-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("governance_notifications")
        .select("id, title, message, created_at, is_read")
        .in("event_type", ["route_deviation", "unauthorized_stop"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as AlertRow[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> Route Exception Alerts</CardTitle>
        <p className="text-xs text-muted-foreground">
          Route deviation and unauthorized stop alerts sent to you. Each staff member sees their own alert history.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
        ) : !alerts || alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No route exception alerts yet.</p>
        ) : (
          alerts.map((a) => (
            <div key={a.id} className="flex items-start justify-between rounded-lg border p-3 flex-wrap gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{a.title}</p>
                <p className="text-xs text-muted-foreground">{a.message}</p>
                <p className="text-xs text-muted-foreground mt-1">{new Date(a.created_at).toLocaleString()}</p>
              </div>
              {!a.is_read && (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 shrink-0">New</Badge>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// TRAFFIC INTELLIGENCE
// Live traffic (TomTom Flow via get-traffic-eta), alternate routes,
// and delay prediction vs both schedule and historical average.
// ============================================================
interface RouteStopCoord {
  id: string;
  stop_name: string;
  sequence_number: number;
  latitude: number;
  longitude: number;
}
interface TrafficLocation {
  latitude: number;
  longitude: number;
  updated_at: string;
}
interface TrafficRoute {
  id: string;
  route_name: string;
  status: string;
  vehicle_id: string | null;
  vehicles: {
    registration_number: string;
    vehicle_locations: TrafficLocation[] | TrafficLocation | null;
  } | null;
  route_stops: RouteStopCoord[];
}
interface TrafficResult {
  routeId: string;
  routeName: string;
  registrationNumber: string;
  nextStopName?: string;
  congestionLevel: "low" | "moderate" | "heavy" | "unknown";
  liveMinutes: number;
  delayMinutes: number;
  scheduleDelayMinutes: number | null;
  historicalDelayMinutes: number | null;
  alternates: { liveMinutes: number; delayMinutes: number }[];
  error?: string;
  driverId: string | null;
  vehicleIdForSuggestion: string | null;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
}

// Straight-line distance — same approximation tier as the existing
// pointToSegmentDistanceMeters() corridor check, not a road-following path.
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchTrafficIntelligence(schoolId: string): Promise<TrafficResult[]> {
  const { data: routes, error } = await supabase
    .from("transport_routes")
    .select(
      "id, route_name, status, vehicle_id, driver_id, vehicles(registration_number, vehicle_locations(latitude, longitude, updated_at)), route_stops(id, stop_name, sequence_number, latitude, longitude)"
    )
    .eq("school_id", schoolId)
    .eq("status", "active")
    .order("route_name");
  if (error) throw error;

  const today = new Date().toISOString().slice(0, 10);

  // Historical baseline: completed trips, grouped by route+direction.
  const { data: historicalTrips } = await supabase
    .from("trips")
    .select("route_id, direction, started_at, ended_at")
    .eq("school_id", schoolId)
    .eq("status", "completed")
    .not("started_at", "is", null)
    .not("ended_at", "is", null)
    .order("trip_date", { ascending: false })
    .limit(500);

  // Today's in-progress trips, for the schedule baseline.
  const { data: todaysTrips } = await supabase
    .from("trips")
    .select("route_id, direction, scheduled_start_time, scheduled_end_time, status")
    .eq("school_id", schoolId)
    .eq("trip_date", today);

  const grouped = new Map<string, number[]>();
  (historicalTrips || []).forEach((t: any) => {
    if (!t.started_at || !t.ended_at) return;
    const durationSec = (new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()) / 1000;
    if (durationSec <= 0 || durationSec > 4 * 3600) return; // discard bad/incomplete rows
    const key = `${t.route_id}:${t.direction}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(durationSec);
  });
  const historicalAvgByKey = new Map<string, number>();
  grouped.forEach((arr, key) => {
    historicalAvgByKey.set(key, arr.reduce((a, b) => a + b, 0) / arr.length);
  });

  const results: TrafficResult[] = [];

  for (const r of (routes || []) as unknown as TrafficRoute[]) {
    const loc = Array.isArray(r.vehicles?.vehicle_locations)
      ? r.vehicles?.vehicle_locations[0]
      : r.vehicles?.vehicle_locations;
    const stops = (r.route_stops || []).filter((s) => s.latitude != null && s.longitude != null);
    if (!loc || loc.latitude == null || loc.longitude == null || stops.length === 0) continue;

    const isStale = Date.now() - new Date(loc.updated_at).getTime() > 5 * 60 * 1000;
    if (isStale) continue;

    // Next stop approximated as nearest stop to current GPS position.
    let nextStop = stops[0];
    let minDist = Infinity;
    for (const s of stops) {
      const d = haversineMeters(loc.latitude, loc.longitude, s.latitude, s.longitude);
      if (d < minDist) {
        minDist = d;
        nextStop = s;
      }
    }

    try {
      const { data: ttData, error: ttError } = await supabase.functions.invoke("get-traffic-eta", {
        body: {
          originLat: loc.latitude,
          originLng: loc.longitude,
          destLat: nextStop.latitude,
          destLng: nextStop.longitude,
          maxAlternatives: 2,
        },
      });

      if (ttError || !ttData?.success) {
        results.push({
          routeId: r.id,
          routeName: r.route_name,
          registrationNumber: r.vehicles?.registration_number || "—",
          congestionLevel: "unknown",
          liveMinutes: 0,
          delayMinutes: 0,
          scheduleDelayMinutes: null,
          historicalDelayMinutes: null,
          alternates: [],
          error: ttData?.message || ttError?.message || "Traffic data unavailable",
          driverId: (r as any).driver_id ?? null,
          vehicleIdForSuggestion: r.vehicle_id,
          originLat: loc.latitude,
          originLng: loc.longitude,
          destLat: nextStop.latitude,
          destLng: nextStop.longitude,
        });
        continue;
      }

      const trip = (todaysTrips || []).find(
        (t: any) => t.route_id === r.id && t.status !== "completed" && t.status !== "cancelled"
      );

      let scheduleDelayMinutes: number | null = null;
      if (trip?.scheduled_end_time) {
        const [h, m] = trip.scheduled_end_time.split(":").map(Number);
        const scheduledEnd = new Date();
        scheduledEnd.setHours(h, m, 0, 0);
        const projectedArrival = new Date(Date.now() + ttData.liveSeconds * 1000);
        scheduleDelayMinutes = Math.round((projectedArrival.getTime() - scheduledEnd.getTime()) / 60000);
      }

      let historicalDelayMinutes: number | null = null;
      if (trip?.direction) {
        const histAvg = historicalAvgByKey.get(`${r.id}:${trip.direction}`);
        if (histAvg != null) {
          historicalDelayMinutes = Math.round((ttData.liveSeconds - histAvg) / 60);
        }
      }

      results.push({
        routeId: r.id,
        routeName: r.route_name,
        registrationNumber: r.vehicles?.registration_number || "—",
        nextStopName: nextStop.stop_name,
        congestionLevel: ttData.congestionLevel || "unknown",
        liveMinutes: Math.round(ttData.liveSeconds / 60),
        delayMinutes: Math.round(ttData.delaySeconds / 60),
        scheduleDelayMinutes,
        historicalDelayMinutes,
        alternates: (ttData.alternates || []).map((a: any) => ({
          liveMinutes: Math.round(a.liveSeconds / 60),
          delayMinutes: Math.round(a.delaySeconds / 60),
        })),
        driverId: (r as any).driver_id ?? null,
        vehicleIdForSuggestion: r.vehicle_id,
        originLat: loc.latitude,
        originLng: loc.longitude,
        destLat: nextStop.latitude,
        destLng: nextStop.longitude,
      });

      // Fire-and-forget trend snapshot; a failure here shouldn't block the UI.
      void supabase.from("transport_traffic_snapshots").insert({
        school_id: schoolId,
        route_id: r.id,
        vehicle_id: r.vehicle_id,
        congestion_level: ttData.congestionLevel || "unknown",
        live_seconds: ttData.liveSeconds,
        no_traffic_seconds: ttData.noTrafficSeconds,
        schedule_delay_seconds: scheduleDelayMinutes != null ? scheduleDelayMinutes * 60 : null,
        historical_delay_seconds: historicalDelayMinutes != null ? historicalDelayMinutes * 60 : null,
        alt_routes: ttData.alternates || [],
      });
    } catch (e: any) {
      results.push({
        routeId: r.id,
        routeName: r.route_name,
        registrationNumber: r.vehicles?.registration_number || "—",
        congestionLevel: "unknown",
        liveMinutes: 0,
        delayMinutes: 0,
        scheduleDelayMinutes: null,
        historicalDelayMinutes: null,
        alternates: [],
        error: String(e),
        driverId: (r as any).driver_id ?? null,
        vehicleIdForSuggestion: r.vehicle_id,
        originLat: loc.latitude,
        originLng: loc.longitude,
        destLat: nextStop.latitude,
        destLng: nextStop.longitude,
      });
    }
  }

  return results;
}

async function suggestRouteToDriver(schoolId: string, result: TrafficResult, altIndex: number) {
  if (!result.driverId) {
    toast.error("No driver assigned to this route");
    return;
  }
  try {
    // Re-fetch with geometry for the specific alternate — the periodic poll
    // deliberately skips geometry to keep payloads small.
    const { data: ttData, error: ttError } = await supabase.functions.invoke("get-traffic-eta", {
      body: {
        originLat: result.originLat,
        originLng: result.originLng,
        destLat: result.destLat,
        destLng: result.destLng,
        maxAlternatives: 2,
        includeGeometry: true,
      },
    });
    if (ttError || !ttData?.success) {
      toast.error(ttData?.message || ttError?.message || "Could not fetch route geometry");
      return;
    }
    const chosen = ttData.alternates?.[altIndex];
    if (!chosen) {
      toast.error("Alternate route not available anymore");
      return;
    }

    const { data: driverRow } = await supabase
      .from("drivers")
      .select("profile_id")
      .eq("id", result.driverId)
      .maybeSingle();

    const { data: inserted, error: insertError } = await supabase
      .from("transport_route_suggestions")
      .insert({
        school_id: schoolId,
        route_id: result.routeId,
        vehicle_id: result.vehicleIdForSuggestion,
        driver_id: result.driverId,
        origin_lat: result.originLat,
        origin_lng: result.originLng,
        dest_lat: result.destLat,
        dest_lng: result.destLng,
        dest_stop_name: result.nextStopName,
        live_seconds: chosen.liveSeconds,
        delay_seconds: chosen.delaySeconds,
        baseline_live_seconds: ttData.liveSeconds,
        geometry: chosen.geometry || [],
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    if (driverRow?.profile_id) {
      const minutesSaved = Math.round((ttData.liveSeconds - chosen.liveSeconds) / 60);
      void supabase.functions.invoke("send-push-notification", {
        body: {
          type: "route_suggestion_alert",
          payload: {
            driver_profile_id: driverRow.profile_id,
            route_name: result.routeName,
            dest_stop_name: result.nextStopName,
            minutes_saved: minutesSaved,
            suggestion_id: inserted?.id,
          },
        },
      });
    }

    toast.success("Route suggestion sent to driver");
  } catch (e: any) {
    toast.error(e.message || "Failed to suggest route");
  }
}

const CONGESTION_STYLES: Record<string, string> = {
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
  moderate: "bg-amber-50 text-amber-700 border-amber-200",
  heavy: "bg-red-50 text-red-600 border-red-200",
  unknown: "bg-slate-100 text-slate-500 border-slate-200",
};

function TrafficIntelligenceView({ schoolId }: { schoolId?: string }) {
  const { data: results, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["traffic-intelligence", schoolId],
    queryFn: () => fetchTrafficIntelligence(schoolId!),
    enabled: !!schoolId,
    // Slower than the 12s GPS poll — each refresh fires one TomTom call per
    // active route, so this interval is deliberately lighter on API usage.
    refetchInterval: 30000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="flex items-center gap-2">
          <TrafficCone className="h-5 w-5" /> Traffic Intelligence
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Auto-refreshes every 30s{dataUpdatedAt ? ` · last updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground flex items-start gap-1.5 mb-2">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Next stop is approximated as the nearest stop to the vehicle's current GPS position, not a
          confirmed boarding sequence. Delay figures compare live TomTom traffic ETA against today's
          schedule and the route's historical average.
        </p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </p>
        ) : !results || results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No routes with live position data right now.</p>
        ) : (
          results.map((r) => (
            <div key={r.routeId} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-full bg-muted p-2 shrink-0">
                    <Car className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.routeName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {r.registrationNumber}
                      {r.nextStopName ? ` · next: ${r.nextStopName}` : ""}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className={CONGESTION_STYLES[r.congestionLevel]}>
                  {r.congestionLevel === "unknown" ? "No data" : `${r.congestionLevel} traffic`}
                </Badge>
              </div>
              {r.error ? (
                <p className="text-xs text-red-500 pl-11">{r.error}</p>
              ) : (
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pl-11">
                  <span>
                    ETA: {r.liveMinutes} min{r.delayMinutes > 0 ? ` (+${r.delayMinutes} min traffic)` : ""}
                  </span>
                  {r.scheduleDelayMinutes != null && (
                    <span className={r.scheduleDelayMinutes > 0 ? "text-amber-600" : "text-emerald-600"}>
                      {r.scheduleDelayMinutes > 0 ? `+${r.scheduleDelayMinutes}` : r.scheduleDelayMinutes} min vs
                      schedule
                    </span>
                  )}
                  {r.historicalDelayMinutes != null && (
                    <span className={r.historicalDelayMinutes > 0 ? "text-amber-600" : "text-emerald-600"}>
                      {r.historicalDelayMinutes > 0 ? `+${r.historicalDelayMinutes}` : r.historicalDelayMinutes} min vs
                      usual
                    </span>
                  )}
                  {r.alternates.length > 0 && (
                    <span>
                      {r.alternates.length} alternate route{r.alternates.length > 1 ? "s" : ""} available (
                      {r.alternates.map((a) => `${a.liveMinutes}min`).join(", ")})
                    </span>
                  )}
                </div>
              )}
              {!r.error && r.alternates.length > 0 && (
                <div className="pl-11 flex flex-wrap gap-2">
                  {r.alternates.map((a, idx) => (
                    <Button
                      key={idx}
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => suggestRouteToDriver(schoolId!, r, idx)}
                    >
                      Suggest {a.liveMinutes}min route to driver
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
