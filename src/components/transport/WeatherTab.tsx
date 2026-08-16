import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Cloud, CloudRain, CloudFog, CloudSnow, Zap, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface WeatherTabProps {
  schoolId: string;
}

interface RouteWithStop {
  id: string;
  route_name: string;
  status: string;
  route_stops: { latitude: number | null; longitude: number | null; sequence_number: number }[];
}

interface WeatherSnapshot {
  id: string;
  route_id: string;
  captured_at: string;
  temp_c: number | null;
  condition: string | null;
  precipitation_mm: number | null;
  visibility_m: number | null;
  wind_speed_kmh: number | null;
  severity: string;
  raw_alerts: { event?: string }[] | null;
}

interface RouteImpact {
  routeId: string;
  routeName: string;
  severity: string;
  condition: string | null;
  historicalAvgMinutes: number | null;
  weatherAdjustedMinutes: number | null;
  scheduleDelayMinutes: number | null;
  historicalDelayMinutes: number | null;
}

const SEVERITY_MULTIPLIER: Record<string, number> = {
  none: 1.0,
  minor: 1.1,
  moderate: 1.25,
  severe: 1.5,
};

const SEVERITY_COLOR: Record<string, string> = {
  none: "bg-emerald-100 text-emerald-700",
  minor: "bg-yellow-100 text-yellow-700",
  moderate: "bg-orange-100 text-orange-700",
  severe: "bg-red-100 text-red-700",
};

function conditionIcon(condition: string | null) {
  switch (condition) {
    case "rain":
      return <CloudRain className="h-4 w-4" />;
    case "storm":
      return <Zap className="h-4 w-4" />;
    case "fog":
      return <CloudFog className="h-4 w-4" />;
    case "snow":
      return <CloudSnow className="h-4 w-4" />;
    default:
      return <Cloud className="h-4 w-4" />;
  }
}

export default function WeatherTab({ schoolId }: WeatherTabProps) {
  const [subView, setSubView] = useState<"live" | "alerts" | "impact">("live");
  const [routes, setRoutes] = useState<RouteWithStop[]>([]);
  const [snapshots, setSnapshots] = useState<Map<string, WeatherSnapshot>>(new Map());
  const [impacts, setImpacts] = useState<RouteImpact[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshingRouteId, setRefreshingRouteId] = useState<string | null>(null);

  const fetchRoutesAndLatestSnapshots = useCallback(async () => {
    setLoading(true);
    try {
      const { data: routeData, error: routeError } = await supabase
        .from("transport_routes")
        .select("id, route_name, status, route_stops(latitude, longitude, sequence_number)")
        .eq("school_id", schoolId)
        .eq("status", "active")
        .order("route_name");
      if (routeError) throw routeError;
      setRoutes((routeData || []) as unknown as RouteWithStop[]);

      const routeIds = (routeData || []).map((r: any) => r.id);
      if (routeIds.length === 0) {
        setSnapshots(new Map());
        return;
      }

      const { data: snapData, error: snapError } = await supabase
        .from("transport_weather_snapshots")
        .select("*")
        .in("route_id", routeIds)
        .order("captured_at", { ascending: false });
      if (snapError) throw snapError;

      const latestByRoute = new Map<string, WeatherSnapshot>();
      (snapData || []).forEach((s: WeatherSnapshot) => {
        if (!latestByRoute.has(s.route_id)) latestByRoute.set(s.route_id, s);
      });
      setSnapshots(latestByRoute);
    } catch (e: any) {
      toast.error(e.message || "Failed to load weather data");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  const refreshRouteWeather = useCallback(
    async (route: RouteWithStop) => {
      const firstStop = (route.route_stops || [])
        .filter((s) => s.latitude != null && s.longitude != null)
        .sort((a, b) => a.sequence_number - b.sequence_number)[0];
      if (!firstStop) {
        toast.error(`${route.route_name} has no stop coordinates`);
        return;
      }
      setRefreshingRouteId(route.id);
      try {
        const { data, error } = await supabase.functions.invoke("get-weather-conditions", {
          body: {
            route_id: route.id,
            school_id: schoolId,
            route_name: route.route_name,
            lat: firstStop.latitude,
            lon: firstStop.longitude,
          },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message);
        setSnapshots((prev) => {
          const next = new Map(prev);
          next.set(route.id, data.snapshot);
          return next;
        });
      } catch (e: any) {
        toast.error(`${route.route_name}: ${e.message || "Weather fetch failed"}`);
      } finally {
        setRefreshingRouteId(null);
      }
    },
    [schoolId]
  );

  const refreshAllRoutes = useCallback(async () => {
    for (const route of routes) {
      await refreshRouteWeather(route);
    }
  }, [routes, refreshRouteWeather]);

  const computeRouteImpact = useCallback(async () => {
    setLoading(true);
    try {
      const { data: historicalTrips } = await supabase
        .from("trips")
        .select("route_id, direction, started_at, ended_at")
        .eq("school_id", schoolId)
        .eq("status", "completed")
        .not("started_at", "is", null)
        .not("ended_at", "is", null)
        .order("trip_date", { ascending: false })
        .limit(500);

      const today = new Date().toISOString().slice(0, 10);
      const { data: todaysTrips } = await supabase
        .from("trips")
        .select("route_id, direction, scheduled_end_time, status")
        .eq("school_id", schoolId)
        .eq("trip_date", today);

      const grouped = new Map<string, number[]>();
      (historicalTrips || []).forEach((t: any) => {
        if (!t.started_at || !t.ended_at) return;
        const durationSec = (new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()) / 1000;
        if (durationSec <= 0 || durationSec > 4 * 3600) return;
        const key = `${t.route_id}:${t.direction}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(durationSec);
      });
      const historicalAvgByKey = new Map<string, number>();
      grouped.forEach((arr, key) => {
        historicalAvgByKey.set(key, arr.reduce((a, b) => a + b, 0) / arr.length);
      });

      const results: RouteImpact[] = routes.map((r) => {
        const snap = snapshots.get(r.id);
        const severity = snap?.severity || "none";
        const trip = (todaysTrips || []).find(
          (t: any) => t.route_id === r.id && t.status !== "completed" && t.status !== "cancelled"
        );

        const histAvgSec = trip?.direction ? historicalAvgByKey.get(`${r.id}:${trip.direction}`) : undefined;
        const historicalAvgMinutes = histAvgSec != null ? Math.round(histAvgSec / 60) : null;

        const multiplier = SEVERITY_MULTIPLIER[severity] ?? 1.0;
        const weatherAdjustedSec = histAvgSec != null ? histAvgSec * multiplier : null;
        const weatherAdjustedMinutes = weatherAdjustedSec != null ? Math.round(weatherAdjustedSec / 60) : null;

        const historicalDelayMinutes =
          histAvgSec != null && weatherAdjustedSec != null
            ? Math.round((weatherAdjustedSec - histAvgSec) / 60)
            : null;

        let scheduleDelayMinutes: number | null = null;
        if (trip?.scheduled_end_time && weatherAdjustedSec != null) {
          const [h, m] = trip.scheduled_end_time.split(":").map(Number);
          const scheduledEnd = new Date();
          scheduledEnd.setHours(h, m, 0, 0);
          const projectedArrival = new Date(Date.now() + weatherAdjustedSec * 1000);
          scheduleDelayMinutes = Math.round((projectedArrival.getTime() - scheduledEnd.getTime()) / 60000);
        }

        return {
          routeId: r.id,
          routeName: r.route_name,
          severity,
          condition: snap?.condition ?? null,
          historicalAvgMinutes,
          weatherAdjustedMinutes,
          scheduleDelayMinutes,
          historicalDelayMinutes,
        };
      });

      setImpacts(results);
    } catch (e: any) {
      toast.error(e.message || "Failed to compute route impact");
    } finally {
      setLoading(false);
    }
  }, [schoolId, routes, snapshots]);

  useEffect(() => {
    fetchRoutesAndLatestSnapshots();
  }, [fetchRoutesAndLatestSnapshots]);

  useEffect(() => {
    if (subView === "impact" && routes.length > 0) {
      computeRouteImpact();
    }
  }, [subView, routes, computeRouteImpact]);

  // Poll every 30s while Live Conditions is open — matches the traffic-intel poll
  // interval since this also fires an external API call per refresh.
  useEffect(() => {
    if (subView !== "live") return;
    const interval = setInterval(() => {
      refreshAllRoutes();
    }, 30000);
    return () => clearInterval(interval);
  }, [subView, refreshAllRoutes]);

  const alertSnapshots = Array.from(snapshots.values())
    .filter((s) => s.severity === "moderate" || s.severity === "severe")
    .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={subView === "live" ? "default" : "outline"}
          onClick={() => setSubView("live")}
        >
          Live Conditions
        </Button>
        <Button
          size="sm"
          variant={subView === "alerts" ? "default" : "outline"}
          onClick={() => setSubView("alerts")}
        >
          Weather Alerts
          {alertSnapshots.length > 0 && (
            <Badge className="ml-2 bg-red-500 text-white">{alertSnapshots.length}</Badge>
          )}
        </Button>
        <Button
          size="sm"
          variant={subView === "impact" ? "default" : "outline"}
          onClick={() => setSubView("impact")}
        >
          Route Impact Analysis
        </Button>
      </div>

      {subView === "live" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Live Conditions by Route</CardTitle>
            <Button size="sm" variant="ghost" onClick={refreshAllRoutes} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Refresh All
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {routes.length === 0 && <p className="text-sm text-muted-foreground">No active routes.</p>}
            {routes.map((route) => {
              const snap = snapshots.get(route.id);
              return (
                <div
                  key={route.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    {conditionIcon(snap?.condition ?? null)}
                    <div>
                      <p className="font-medium text-sm">{route.route_name}</p>
                      {snap ? (
                        <p className="text-xs text-muted-foreground">
                          {snap.temp_c != null ? `${snap.temp_c.toFixed(1)}°C` : "—"} ·{" "}
                          {snap.wind_speed_kmh != null ? `${snap.wind_speed_kmh.toFixed(0)} km/h wind` : "—"} ·{" "}
                          {snap.precipitation_mm != null ? `${snap.precipitation_mm.toFixed(1)}mm precip` : "—"}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">No data yet</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {snap && (
                      <Badge className={SEVERITY_COLOR[snap.severity] ?? ""}>{snap.severity}</Badge>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => refreshRouteWeather(route)}
                      disabled={refreshingRouteId === route.id}
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${refreshingRouteId === route.id ? "animate-spin" : ""}`}
                      />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {subView === "alerts" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active Weather Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alertSnapshots.length === 0 && (
              <p className="text-sm text-muted-foreground">No moderate or severe weather alerts right now.</p>
            )}
            {alertSnapshots.map((snap) => {
              const route = routes.find((r) => r.id === snap.route_id);
              return (
                <div
                  key={snap.id}
                  className="flex items-start gap-3 rounded-lg border p-3 border-l-4 border-l-red-400"
                >
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{route?.route_name ?? "Unknown route"}</p>
                    <p className="text-xs text-muted-foreground">
                      {snap.raw_alerts?.[0]?.event ?? snap.condition ?? "Adverse weather"} — captured{" "}
                      {new Date(snap.captured_at).toLocaleTimeString()}
                    </p>
                  </div>
                  <Badge className={SEVERITY_COLOR[snap.severity] ?? ""}>{snap.severity}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {subView === "impact" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Route Impact Analysis</CardTitle>
            <Button size="sm" variant="ghost" onClick={computeRouteImpact} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Recalculate
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {impacts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No impact data yet — this needs completed trip history and today's schedule.
              </p>
            )}
            {impacts.map((imp) => (
              <div key={imp.routeId} className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{imp.routeName}</p>
                  <Badge className={SEVERITY_COLOR[imp.severity] ?? ""}>{imp.severity}</Badge>
                </div>
                {imp.historicalAvgMinutes != null ? (
                  <p className="text-xs text-muted-foreground">
                    Usual trip: {imp.historicalAvgMinutes} min → Weather-adjusted est.:{" "}
                    {imp.weatherAdjustedMinutes} min
                    {imp.historicalDelayMinutes != null && imp.historicalDelayMinutes > 0 && (
                      <span className="text-amber-600"> (+{imp.historicalDelayMinutes} min)</span>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">No trip history for this route/direction yet.</p>
                )}
                {imp.scheduleDelayMinutes != null && (
                  <p className="text-xs">
                    {imp.scheduleDelayMinutes > 0 ? (
                      <span className="text-red-600">
                        Projected {imp.scheduleDelayMinutes} min late vs scheduled arrival
                      </span>
                    ) : (
                      <span className="text-emerald-600">On schedule</span>
                    )}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
