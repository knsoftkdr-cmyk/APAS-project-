/**
 * AnalyticsDashboardTab.tsx
 * Transport Analytics Dashboard — v1 scope: KPI cards + a live status list
 * of vehicles currently on trip. Map view and Delay Analytics / Utilization
 * Reports sub-views come in later passes.
 *
 * "On trip now" is derived from trips.started_at IS NOT NULL AND
 * trips.ended_at IS NULL for today's trip_date — NOT from trips.status,
 * since status is only ever set to a terminal value ('completed' /
 * 'cancelled') once a trip finishes; there's no 'in_progress' status value.
 *
 * On-time % is computed only over today's completed trips, comparing
 * started_at against (trip_date + scheduled_start_time). A trip is "on
 * time" if it started at or before 5 minutes past its scheduled time.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Bus, CheckCircle2, XCircle, Timer, Gauge, Clock,
} from "lucide-react";
import { format } from "date-fns";
import DelayAnalyticsSubTab from "./DelayAnalyticsSubTab";

interface Props {
  schoolId: string;
}

interface TripRow {
  id: string;
  vehicle_id: string;
  driver_id: string;
  started_at: string | null;
  ended_at: string | null;
  scheduled_start_time: string | null;
  status: string | null;
  vehicles: { registration_number: string } | null;
  drivers: { name: string } | null;
  transport_routes: { route_name: string; route_number: string } | null;
}

interface LocationRow {
  vehicle_id: string;
  speed_kmh: number | null;
  updated_at: string;
}

const ON_TIME_THRESHOLD_MINUTES = 5;

// ── Delay helper ────────────────────────────────────────────────────────────
// Positive = late (minutes), negative = early. Null when either timestamp is
// missing (can't compute).
function computeDelayMinutes(trip: TripRow, todayStr: string): number | null {
  if (!trip.started_at || !trip.scheduled_start_time) return null;
  const scheduled = new Date(`${todayStr}T${trip.scheduled_start_time}`);
  const actual = new Date(trip.started_at);
  return Math.round((actual.getTime() - scheduled.getTime()) / 60000);
}

export default function AnalyticsDashboardTab({ schoolId }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [locations, setLocations] = useState<Map<string, LocationRow>>(new Map());

  const todayStr = format(new Date(), "yyyy-MM-dd");

  const fetchData = useCallback(async () => {
    if (!schoolId) return;
    try {
      const { data: tripRows, error } = await supabase
        .from("trips")
        .select(
          "id, vehicle_id, driver_id, started_at, ended_at, scheduled_start_time, status, vehicles(registration_number), drivers(name), transport_routes(route_name, route_number)"
        )
        .eq("school_id", schoolId)
        .eq("trip_date", todayStr);
      if (error) throw error;
      setTrips((tripRows || []) as unknown as TripRow[]);

      const onTripVehicleIds = (tripRows || [])
        .filter((t: any) => t.started_at && !t.ended_at)
        .map((t: any) => t.vehicle_id);

      if (onTripVehicleIds.length > 0) {
        const { data: locRows } = await supabase
          .from("vehicle_locations")
          .select("vehicle_id, speed_kmh, updated_at")
          .in("vehicle_id", onTripVehicleIds);
        setLocations(new Map((locRows || []).map((l: any) => [l.vehicle_id, l])));
      } else {
        setLocations(new Map());
      }
    } catch (e: any) {
      toast({ title: "Error loading analytics", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [schoolId, todayStr, toast]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // 15s refresh, matches live-data expectations
    return () => clearInterval(interval);
  }, [fetchData]);

  const kpis = useMemo(() => {
    const totalToday = trips.length;
    const onTripNow = trips.filter(t => t.started_at && !t.ended_at).length;
    const completed = trips.filter(t => t.status === "completed").length;
    const cancelled = trips.filter(t => t.status === "cancelled").length;

    const completedWithSchedule = trips.filter(
      t => t.status === "completed" && t.started_at && t.scheduled_start_time
    );
    const onTimeCount = completedWithSchedule.filter(t => {
      const delay = computeDelayMinutes(t, todayStr);
      return delay !== null && delay <= ON_TIME_THRESHOLD_MINUTES;
    }).length;
    const onTimePct = completedWithSchedule.length > 0
      ? Math.round((onTimeCount / completedWithSchedule.length) * 100)
      : null;

    return { totalToday, onTripNow, completed, cancelled, onTimePct };
  }, [trips, todayStr]);

  const onTripList = useMemo(
    () => trips.filter(t => t.started_at && !t.ended_at),
    [trips]
  );

  if (loading) {
    return <div className="flex justify-center py-16"><LoadingSpinner /></div>;
  }

  return (
    <Tabs defaultValue="livefleet">
      <TabsList className="rounded-full bg-slate-100 p-1 h-9 mb-4">
        <TabsTrigger value="livefleet" className="text-xs rounded-full data-[state=active]:bg-blue-600 data-[state=active]:text-white">
          Live Fleet
        </TabsTrigger>
        <TabsTrigger value="delay" className="text-xs rounded-full data-[state=active]:bg-blue-600 data-[state=active]:text-white">
          Delay Analytics
        </TabsTrigger>
      </TabsList>

      <TabsContent value="livefleet">
        <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-4 rounded-2xl border-slate-200/70">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Bus className="h-3.5 w-3.5" /> Trips Today
          </div>
          <p className="text-2xl font-bold text-slate-800">{kpis.totalToday}</p>
        </Card>
        <Card className="p-4 rounded-2xl border-slate-200/70">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Gauge className="h-3.5 w-3.5" /> On Trip Now
          </div>
          <p className="text-2xl font-bold text-emerald-600">{kpis.onTripNow}</p>
        </Card>
        <Card className="p-4 rounded-2xl border-slate-200/70">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Completed
          </div>
          <p className="text-2xl font-bold text-slate-800">{kpis.completed}</p>
        </Card>
        <Card className="p-4 rounded-2xl border-slate-200/70">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <XCircle className="h-3.5 w-3.5" /> Cancelled
          </div>
          <p className="text-2xl font-bold text-red-600">{kpis.cancelled}</p>
        </Card>
        <Card className="p-4 rounded-2xl border-slate-200/70">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Timer className="h-3.5 w-3.5" /> On-Time %
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {kpis.onTimePct === null ? "—" : `${kpis.onTimePct}%`}
          </p>
        </Card>
      </div>

      {/* Live status list */}
      <Card className="rounded-2xl border-slate-200/70 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Vehicles On Trip Now</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Refreshes every 15 seconds</p>
        </div>
        {onTripList.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-10">No vehicles currently on trip.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {onTripList.map(t => {
              const loc = locations.get(t.vehicle_id);
              const delay = computeDelayMinutes(t, todayStr);
              return (
                <div key={t.id} className="p-3.5 flex items-center gap-4 flex-wrap">
                  <div className="min-w-[140px]">
                    <p className="text-sm font-semibold text-slate-800">
                      {t.vehicles?.registration_number || "Unknown Vehicle"}
                    </p>
                    <p className="text-xs text-muted-foreground">{t.drivers?.name || "Unassigned Driver"}</p>
                  </div>
                  <div className="text-xs text-muted-foreground min-w-[140px]">
                    {t.transport_routes
                      ? `Route ${t.transport_routes.route_number || t.transport_routes.route_name}`
                      : "No route"}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs min-w-[90px]">
                    <Gauge className="h-3.5 w-3.5 text-slate-400" />
                    {loc?.speed_kmh != null ? `${Math.round(loc.speed_kmh)} km/h` : "—"}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs min-w-[110px]">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    {delay === null ? "—" : delay <= ON_TIME_THRESHOLD_MINUTES
                      ? <span className="text-emerald-600 font-medium">On time</span>
                      : <span className="text-amber-600 font-medium">+{delay} min</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
        </div>
      </TabsContent>

      <TabsContent value="delay">
        <DelayAnalyticsSubTab schoolId={schoolId} />
      </TabsContent>
    </Tabs>
  );
}
