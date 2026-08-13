/**
 * UtilizationReportsSubTab.tsx
 * Sub-tab of AnalyticsDashboardTab — three utilization views in one screen:
 *
 * 1. Vehicle Utilization: active assigned students (via transport_assignments
 *    -> transport_routes.vehicle_id) as a % of vehicle capacity, plus trip
 *    count in the selected range.
 * 2. Route Utilization: same fill % but grouped by route directly.
 * 3. Driver Utilization: trip counts (total/completed/cancelled) and total
 *    driving hours in the selected range.
 *
 * Capacity fill % is a point-in-time metric (current active assignments,
 * not date-ranged) — the range toggle only affects trip counts and hours.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { format, subDays } from "date-fns";

interface Props {
  schoolId: string;
}

type RangeOption = 7 | 30;

interface VehicleRow {
  id: string;
  registration_number: string;
  capacity: number | null;
}

interface RouteRow {
  id: string;
  route_name: string;
  route_number: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
}

interface AssignmentRow {
  route_id: string | null;
  status: string | null;
}

interface DriverRow {
  id: string;
  name: string;
}

interface TripRow {
  id: string;
  route_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
}

function fillColor(pct: number): string {
  if (pct >= 90) return "text-red-600";
  if (pct >= 70) return "text-amber-600";
  return "text-emerald-600";
}

export default function UtilizationReportsSubTab({ schoolId }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeOption>(7);

  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
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
      const [vehiclesRes, routesRes, assignmentsRes, driversRes, tripsRes] = await Promise.all([
        supabase.from("vehicles").select("id, registration_number, capacity").eq("school_id", schoolId),
        supabase.from("transport_routes").select("id, route_name, route_number, vehicle_id, driver_id").eq("school_id", schoolId),
        supabase.from("transport_assignments").select("route_id, status").eq("school_id", schoolId).eq("status", "active"),
        supabase.from("drivers").select("id, name").eq("school_id", schoolId),
        supabase.from("trips").select("id, route_id, vehicle_id, driver_id, status, started_at, ended_at")
          .eq("school_id", schoolId).gte("trip_date", startDateStr).lte("trip_date", todayStr),
      ]);
      if (vehiclesRes.error) throw vehiclesRes.error;
      if (routesRes.error) throw routesRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;
      if (driversRes.error) throw driversRes.error;
      if (tripsRes.error) throw tripsRes.error;

      setVehicles((vehiclesRes.data || []) as VehicleRow[]);
      setRoutes((routesRes.data || []) as RouteRow[]);
      setAssignments((assignmentsRes.data || []) as AssignmentRow[]);
      setDrivers((driversRes.data || []) as DriverRow[]);
      setTrips((tripsRes.data || []) as TripRow[]);
    } catch (e: any) {
      toast({ title: "Error loading utilization data", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [schoolId, startDateStr, todayStr, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Route Utilization ────────────────────────────────────────────────────────
  const routeUtilization = useMemo(() => {
    const assignedByRoute = new Map<string, number>();
    for (const a of assignments) {
      if (!a.route_id) continue;
      assignedByRoute.set(a.route_id, (assignedByRoute.get(a.route_id) || 0) + 1);
    }
    const tripsByRoute = new Map<string, number>();
    for (const t of trips) {
      if (!t.route_id) continue;
      tripsByRoute.set(t.route_id, (tripsByRoute.get(t.route_id) || 0) + 1);
    }
    const vehicleById = new Map(vehicles.map(v => [v.id, v]));

    return routes
      .map(r => {
        const vehicle = r.vehicle_id ? vehicleById.get(r.vehicle_id) : undefined;
        const capacity = vehicle?.capacity ?? null;
        const assigned = assignedByRoute.get(r.id) || 0;
        const fillPct = capacity ? Math.round((assigned / capacity) * 100) : null;
        return {
          label: `Route ${r.route_number || r.route_name}`,
          assigned,
          capacity,
          fillPct,
          trips: tripsByRoute.get(r.id) || 0,
        };
      })
      .sort((a, b) => (b.fillPct ?? -1) - (a.fillPct ?? -1));
  }, [routes, assignments, trips, vehicles]);

  // ── Vehicle Utilization ──────────────────────────────────────────────────────
  const vehicleUtilization = useMemo(() => {
    const routeByVehicle = new Map<string, string[]>();
    for (const r of routes) {
      if (!r.vehicle_id) continue;
      if (!routeByVehicle.has(r.vehicle_id)) routeByVehicle.set(r.vehicle_id, []);
      routeByVehicle.get(r.vehicle_id)!.push(r.id);
    }
    const assignedByRoute = new Map<string, number>();
    for (const a of assignments) {
      if (!a.route_id) continue;
      assignedByRoute.set(a.route_id, (assignedByRoute.get(a.route_id) || 0) + 1);
    }
    const tripsByVehicle = new Map<string, number>();
    for (const t of trips) {
      if (!t.vehicle_id) continue;
      tripsByVehicle.set(t.vehicle_id, (tripsByVehicle.get(t.vehicle_id) || 0) + 1);
    }

    return vehicles
      .map(v => {
        const routeIds = routeByVehicle.get(v.id) || [];
        const assigned = routeIds.reduce((sum, rid) => sum + (assignedByRoute.get(rid) || 0), 0);
        const fillPct = v.capacity ? Math.round((assigned / v.capacity) * 100) : null;
        return {
          label: v.registration_number,
          assigned,
          capacity: v.capacity,
          fillPct,
          trips: tripsByVehicle.get(v.id) || 0,
        };
      })
      .sort((a, b) => (b.fillPct ?? -1) - (a.fillPct ?? -1));
  }, [vehicles, routes, assignments, trips]);

  // ── Driver Utilization ───────────────────────────────────────────────────────
  const driverUtilization = useMemo(() => {
    const byDriver = new Map<string, { total: number; completed: number; cancelled: number; hours: number }>();
    for (const t of trips) {
      if (!t.driver_id) continue;
      if (!byDriver.has(t.driver_id)) byDriver.set(t.driver_id, { total: 0, completed: 0, cancelled: 0, hours: 0 });
      const entry = byDriver.get(t.driver_id)!;
      entry.total += 1;
      if (t.status === "completed") {
        entry.completed += 1;
        if (t.started_at && t.ended_at) {
          entry.hours += (new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()) / 3600000;
        }
      } else if (t.status === "cancelled") {
        entry.cancelled += 1;
      }
    }
    const driverById = new Map(drivers.map(d => [d.id, d.name]));
    return [...byDriver.entries()]
      .map(([driverId, stats]) => ({
        label: driverById.get(driverId) || "Unknown Driver",
        ...stats,
        hours: Math.round(stats.hours * 10) / 10,
      }))
      .sort((a, b) => b.total - a.total);
  }, [trips, drivers]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Capacity fill reflects current active assignments; trip counts and hours cover the last {range} days.
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
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Vehicle Utilization */}
          <Card className="rounded-2xl border-slate-200/70 overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-800">Vehicle Utilization</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Assigned students vs. capacity</p>
            </div>
            {vehicleUtilization.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-10">No vehicles found.</p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {vehicleUtilization.map(v => (
                  <div key={v.label} className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{v.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {v.assigned}/{v.capacity ?? "—"} seats · {v.trips} trip{v.trips === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold ${v.fillPct === null ? "text-slate-400" : fillColor(v.fillPct)}`}>
                      {v.fillPct === null ? "—" : `${v.fillPct}%`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Route Utilization */}
          <Card className="rounded-2xl border-slate-200/70 overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-800">Route Utilization</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Assigned students vs. vehicle capacity</p>
            </div>
            {routeUtilization.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-10">No routes found.</p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {routeUtilization.map(r => (
                  <div key={r.label} className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{r.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.assigned}/{r.capacity ?? "—"} seats · {r.trips} trip{r.trips === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold ${r.fillPct === null ? "text-slate-400" : fillColor(r.fillPct)}`}>
                      {r.fillPct === null ? "—" : `${r.fillPct}%`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Driver Utilization */}
          <Card className="rounded-2xl border-slate-200/70 overflow-hidden md:col-span-2">
            <div className="p-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-800">Driver Utilization</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Trip counts and driving hours, last {range} days</p>
            </div>
            {driverUtilization.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-10">No trips in this range.</p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {driverUtilization.map(d => (
                  <div key={d.label} className="p-3 flex items-center justify-between flex-wrap gap-2">
                    <p className="text-sm font-medium text-slate-800 min-w-[140px]">{d.label}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{d.total} trip{d.total === 1 ? "" : "s"}</span>
                      <span className="text-emerald-600">{d.completed} completed</span>
                      {d.cancelled > 0 && <span className="text-red-600">{d.cancelled} cancelled</span>}
                      <span>{d.hours}h driving</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
