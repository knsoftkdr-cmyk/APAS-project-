import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Route, Bell, Loader2, Car, Info } from "lucide-react";

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
      </div>

      {subView === "live" && <LiveRouteStatusView schoolId={schoolId} />}
      {subView === "alerts" && <RouteAlertsView />}
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
