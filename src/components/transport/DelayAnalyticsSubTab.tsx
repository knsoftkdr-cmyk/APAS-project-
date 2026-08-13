/**
 * DelayAnalyticsSubTab.tsx
 * Sub-tab of AnalyticsDashboardTab — delay trend over time, plus
 * breakdowns by route and by driver, all driven by one query over
 * completed trips in the selected date range.
 *
 * Delay (minutes) = started_at - (trip_date + scheduled_start_time).
 * Positive = late, negative = early. Trips missing either timestamp are
 * excluded from every aggregate here (can't compute a delay for them).
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { format, subDays } from "date-fns";

interface Props {
  schoolId: string;
}

interface TripRow {
  id: string;
  trip_date: string;
  started_at: string;
  scheduled_start_time: string;
  route_id: string | null;
  driver_id: string | null;
  transport_routes: { route_name: string; route_number: string } | null;
  drivers: { name: string } | null;
}

type RangeOption = 7 | 30;

function computeDelayMinutes(trip: TripRow): number {
  const scheduled = new Date(`${trip.trip_date}T${trip.scheduled_start_time}`);
  const actual = new Date(trip.started_at);
  return Math.round((actual.getTime() - scheduled.getTime()) / 60000);
}

export default function DelayAnalyticsSubTab({ schoolId }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeOption>(7);
  const [trips, setTrips] = useState<TripRow[]>([]);

  const startDateStr = useMemo(
    () => format(subDays(new Date(), range - 1), "yyyy-MM-dd"),
    [range]
  );
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const fetchData = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("trips")
        .select(
          "id, trip_date, started_at, scheduled_start_time, route_id, driver_id, transport_routes(route_name, route_number), drivers(name)"
        )
        .eq("school_id", schoolId)
        .eq("status", "completed")
        .not("started_at", "is", null)
        .not("scheduled_start_time", "is", null)
        .gte("trip_date", startDateStr)
        .lte("trip_date", todayStr);
      if (error) throw error;
      setTrips((data || []) as unknown as TripRow[]);
    } catch (e: any) {
      toast({ title: "Error loading delay analytics", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [schoolId, startDateStr, todayStr, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Trend: avg delay per day ────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const byDay = new Map<string, number[]>();
    for (const t of trips) {
      const delay = computeDelayMinutes(t);
      if (!byDay.has(t.trip_date)) byDay.set(t.trip_date, []);
      byDay.get(t.trip_date)!.push(delay);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, delays]) => ({
        date: format(new Date(date), "MMM d"),
        avgDelay: Math.round(delays.reduce((s, d) => s + d, 0) / delays.length),
        trips: delays.length,
      }));
  }, [trips]);

  // ── Breakdown by route ──────────────────────────────────────────────────────
  const byRoute = useMemo(() => {
    const map = new Map<string, { label: string; delays: number[] }>();
    for (const t of trips) {
      const key = t.route_id || "no-route";
      const label = t.transport_routes
        ? `Route ${t.transport_routes.route_number || t.transport_routes.route_name}`
        : "No Route";
      if (!map.has(key)) map.set(key, { label, delays: [] });
      map.get(key)!.delays.push(computeDelayMinutes(t));
    }
    return [...map.values()]
      .map(r => ({
        label: r.label,
        avgDelay: Math.round(r.delays.reduce((s, d) => s + d, 0) / r.delays.length),
        trips: r.delays.length,
      }))
      .sort((a, b) => b.avgDelay - a.avgDelay);
  }, [trips]);

  // ── Breakdown by driver ──────────────────────────────────────────────────────
  const byDriver = useMemo(() => {
    const map = new Map<string, { label: string; delays: number[] }>();
    for (const t of trips) {
      const key = t.driver_id || "no-driver";
      const label = t.drivers?.name || "Unassigned Driver";
      if (!map.has(key)) map.set(key, { label, delays: [] });
      map.get(key)!.delays.push(computeDelayMinutes(t));
    }
    return [...map.values()]
      .map(d => ({
        label: d.label,
        avgDelay: Math.round(d.delays.reduce((s, x) => s + x, 0) / d.delays.length),
        trips: d.delays.length,
      }))
      .sort((a, b) => b.avgDelay - a.avgDelay);
  }, [trips]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Based on {trips.length} completed trip{trips.length === 1 ? "" : "s"} with a schedule, over the last {range} days.
        </p>
        <div className="flex items-center gap-1.5 bg-slate-100 rounded-full p-1">
          <Button
            size="sm"
            variant="ghost"
            className={`h-7 px-3 rounded-full text-xs ${range === 7 ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}
            onClick={() => setRange(7)}
          >
            Last 7 days
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={`h-7 px-3 rounded-full text-xs ${range === 30 ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}
            onClick={() => setRange(30)}
          >
            Last 30 days
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : trips.length === 0 ? (
        <Card className="p-10 text-center rounded-2xl border-slate-200/70">
          <p className="text-sm text-muted-foreground">No completed trips with schedule data in this range.</p>
        </Card>
      ) : (
        <>
          {/* Trend chart */}
          <Card className="p-4 rounded-2xl border-slate-200/70">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Average Delay Per Day</h3>
            <p className="text-xs text-muted-foreground mb-3">Minutes late (positive) or early (negative)</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number, name: string) => [name === "avgDelay" ? `${value} min` : value, name === "avgDelay" ? "Avg delay" : "Trips"]}
                  />
                  <ReferenceLine y={0} stroke="#cbd5e1" />
                  <Bar dataKey="avgDelay" radius={[4, 4, 0, 0]}>
                    {trendData.map((entry, i) => (
                      <Cell key={i} fill={entry.avgDelay > 5 ? "#f59e0b" : entry.avgDelay < 0 ? "#10b981" : "#3b82f6"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* By Route */}
            <Card className="rounded-2xl border-slate-200/70 overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-800">By Route</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Worst average delay first</p>
              </div>
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {byRoute.map(r => (
                  <div key={r.label} className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{r.label}</p>
                      <p className="text-xs text-muted-foreground">{r.trips} trip{r.trips === 1 ? "" : "s"}</p>
                    </div>
                    <span className={`text-sm font-semibold ${r.avgDelay > 5 ? "text-amber-600" : r.avgDelay < 0 ? "text-emerald-600" : "text-slate-600"}`}>
                      {r.avgDelay > 0 ? "+" : ""}{r.avgDelay} min
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* By Driver */}
            <Card className="rounded-2xl border-slate-200/70 overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-800">By Driver</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Worst average delay first</p>
              </div>
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {byDriver.map(d => (
                  <div key={d.label} className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{d.label}</p>
                      <p className="text-xs text-muted-foreground">{d.trips} trip{d.trips === 1 ? "" : "s"}</p>
                    </div>
                    <span className={`text-sm font-semibold ${d.avgDelay > 5 ? "text-amber-600" : d.avgDelay < 0 ? "text-emerald-600" : "text-slate-600"}`}>
                      {d.avgDelay > 0 ? "+" : ""}{d.avgDelay} min
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
