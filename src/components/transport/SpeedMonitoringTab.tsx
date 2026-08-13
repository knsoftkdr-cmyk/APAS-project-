import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gauge, Bell, Loader2, Car } from "lucide-react";

type SubView = "live" | "alerts";

export function SpeedMonitoringTab({ schoolId }: { schoolId?: string }) {
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
          <Gauge className="h-3.5 w-3.5" /> Live Speed
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
          <Bell className="h-3.5 w-3.5" /> Speed Limit Alerts
        </button>
      </div>

      {subView === "live" && <LiveSpeedView schoolId={schoolId} />}
      {subView === "alerts" && <SpeedAlertsView />}
    </div>
  );
}

// ============================================================
// LIVE SPEED
// ============================================================
interface VehicleWithSpeed {
  id: string;
  registration_number: string;
  speed_limit_kmph: number | null;
  vehicle_locations: { speed_kmh: number | null; updated_at: string }[] | { speed_kmh: number | null; updated_at: string } | null;
}

function LiveSpeedView({ schoolId }: { schoolId?: string }) {
  const { data: vehicles, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["live-speed", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, registration_number, speed_limit_kmph, vehicle_locations(speed_kmh, updated_at)")
        .eq("school_id", schoolId)
        .order("registration_number");
      if (error) throw error;
      return data as any as VehicleWithSpeed[];
    },
    enabled: !!schoolId,
    refetchInterval: 12000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="flex items-center gap-2"><Gauge className="h-5 w-5" /> Live Speed</CardTitle>
        <p className="text-xs text-muted-foreground">
          Auto-refreshes every 12s{dataUpdatedAt ? ` · last updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
        ) : !vehicles || vehicles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No vehicles found.</p>
        ) : (
          vehicles.map((v) => {
            const loc = Array.isArray(v.vehicle_locations) ? v.vehicle_locations[0] : v.vehicle_locations;
            const speed = loc?.speed_kmh ?? null;
            const limit = v.speed_limit_kmph;
            const isOver = speed != null && limit != null && speed > limit;
            const isStale = loc?.updated_at ? Date.now() - new Date(loc.updated_at).getTime() > 5 * 60 * 1000 : true;

            return (
              <div key={v.id} className="flex items-center justify-between rounded-lg border p-3 flex-wrap gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-full bg-muted p-2 shrink-0"><Car className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{v.registration_number}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {limit != null ? `Limit ${limit} km/h` : "No speed limit set"}
                      {loc?.updated_at && ` · updated ${new Date(loc.updated_at).toLocaleTimeString()}`}
                    </p>
                  </div>
                </div>
                <div className="shrink-0">
                  {speed == null || isStale ? (
                    <Badge variant="outline" className="bg-slate-100 text-slate-500 border-slate-200">
                      {isStale && speed != null ? "Stale" : "No data"}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className={isOver ? "bg-red-50 text-red-600 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}
                    >
                      {Math.round(speed)} km/h
                    </Badge>
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
// SPEED LIMIT ALERTS (personal notification history — same pattern as
// restricted_zone_alert; governance_notifications RLS only allows a user
// to see their own rows, so this is "alerts I've received", not a
// school-wide audit log)
// ============================================================
interface AlertRow {
  id: string;
  title: string;
  message: string;
  created_at: string;
  is_read: boolean;
}

function SpeedAlertsView() {
  const { data: alerts, isLoading } = useQuery({
    queryKey: ["speed-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("governance_notifications")
        .select("id, title, message, created_at, is_read")
        .eq("event_type", "vehicle_overspeed")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as AlertRow[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> Speed Limit Alerts</CardTitle>
        <p className="text-xs text-muted-foreground">
          Overspeed alerts sent to you. Each staff member sees their own alert history.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
        ) : !alerts || alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No overspeed alerts yet.</p>
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
