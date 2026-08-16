import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Users, RefreshCw, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface BusOccupancyTabProps {
  schoolId: string;
}

interface RouteWithVehicle {
  id: string;
  route_name: string;
  status: string;
  vehicle_id: string | null;
  vehicles: { capacity: number | null; registration_number: string } | null;
}

interface OccupancyDisplay {
  routeId: string;
  routeName: string;
  registrationNumber: string;
  capacity: number | null;
  count: number;
  source: "auto" | "manual";
  manualLogId: string | null;
  recordedAt: string | null;
}

export default function BusOccupancyTab({ schoolId }: BusOccupancyTabProps) {
  const [routes, setRoutes] = useState<RouteWithVehicle[]>([]);
  const [occupancy, setOccupancy] = useState<Map<string, OccupancyDisplay>>(new Map());
  const [loading, setLoading] = useState(false);
  const [overrideRoute, setOverrideRoute] = useState<RouteWithVehicle | null>(null);
  const [overrideValue, setOverrideValue] = useState("");
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const fetchOccupancy = useCallback(async () => {
    setLoading(true);
    try {
      const { data: routeData, error: routeError } = await supabase
        .from("transport_routes")
        .select("id, route_name, status, vehicle_id, vehicles(capacity, registration_number)")
        .eq("school_id", schoolId)
        .eq("status", "active")
        .order("route_name");
      if (routeError) throw routeError;
      const routeList = (routeData || []) as unknown as RouteWithVehicle[];
      setRoutes(routeList);

      if (routeList.length === 0) {
        setOccupancy(new Map());
        return;
      }
      const routeIds = routeList.map((r) => r.id);

      // Auto count: today's confirmed pickups minus confirmed drops, per route.
      const { data: confirmations, error: confError } = await supabase
        .from("boarding_confirmations")
        .select("route_id, direction")
        .in("route_id", routeIds)
        .eq("trip_date", today);
      if (confError) throw confError;

      const autoCountByRoute = new Map<string, number>();
      (confirmations || []).forEach((c: { route_id: string; direction: string }) => {
        const delta = c.direction === "pickup" ? 1 : c.direction === "drop" ? -1 : 0;
        autoCountByRoute.set(c.route_id, (autoCountByRoute.get(c.route_id) || 0) + delta);
      });

      // Manual overrides: latest manual log per route for today, if any.
      const { data: manualLogs, error: logError } = await supabase
        .from("transport_occupancy_logs")
        .select("id, route_id, occupancy_count, recorded_at, source")
        .in("route_id", routeIds)
        .eq("trip_date", today)
        .eq("source", "manual")
        .order("recorded_at", { ascending: false });
      if (logError) throw logError;

      const manualByRoute = new Map<string, { id: string; count: number; recordedAt: string }>();
      (manualLogs || []).forEach((l: any) => {
        if (!manualByRoute.has(l.route_id)) {
          manualByRoute.set(l.route_id, { id: l.id, count: l.occupancy_count, recordedAt: l.recorded_at });
        }
      });

      const next = new Map<string, OccupancyDisplay>();
      routeList.forEach((r) => {
        const manual = manualByRoute.get(r.id);
        const autoCount = Math.max(0, autoCountByRoute.get(r.id) || 0);
        next.set(r.id, {
          routeId: r.id,
          routeName: r.route_name,
          registrationNumber: r.vehicles?.registration_number || "—",
          capacity: r.vehicles?.capacity ?? null,
          count: manual ? manual.count : autoCount,
          source: manual ? "manual" : "auto",
          manualLogId: manual?.id ?? null,
          recordedAt: manual?.recordedAt ?? null,
        });
      });
      setOccupancy(next);
    } catch (e: any) {
      toast.error(e.message || "Failed to load occupancy data");
    } finally {
      setLoading(false);
    }
  }, [schoolId, today]);

  useEffect(() => {
    fetchOccupancy();
  }, [fetchOccupancy]);

  // Poll every 12s — matches the GPS-only tabs' interval since this reads
  // existing boarding data locally, no external API call per refresh.
  useEffect(() => {
    const interval = setInterval(fetchOccupancy, 12000);
    return () => clearInterval(interval);
  }, [fetchOccupancy]);

  const openOverrideDialog = (route: RouteWithVehicle) => {
    const current = occupancy.get(route.id);
    setOverrideValue(current ? String(current.count) : "");
    setOverrideRoute(route);
  };

  const saveOverride = async () => {
    if (!overrideRoute) return;
    const count = parseInt(overrideValue, 10);
    if (isNaN(count) || count < 0) {
      toast.error("Enter a valid headcount");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("transport_occupancy_logs").insert({
        school_id: schoolId,
        route_id: overrideRoute.id,
        vehicle_id: overrideRoute.vehicle_id,
        trip_date: today,
        occupancy_count: count,
        capacity_at_time: overrideRoute.vehicles?.capacity ?? null,
        source: "manual",
      });
      if (error) throw error;
      toast.success(`${overrideRoute.route_name} headcount updated`);
      setOverrideRoute(null);
      fetchOccupancy();
    } catch (e: any) {
      toast.error(e.message || "Failed to save headcount");
    } finally {
      setSaving(false);
    }
  };

  const clearOverride = async (routeId: string, manualLogId: string) => {
    try {
      const { error } = await supabase.from("transport_occupancy_logs").delete().eq("id", manualLogId);
      if (error) throw error;
      toast.success("Reverted to auto count");
      fetchOccupancy();
    } catch (e: any) {
      toast.error(e.message || "Failed to clear override");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Live Occupancy & Seat Availability</CardTitle>
          <Button size="sm" variant="ghost" onClick={fetchOccupancy} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {routes.length === 0 && <p className="text-sm text-muted-foreground">No active routes.</p>}
          {routes.map((route) => {
            const occ = occupancy.get(route.id);
            const capacity = occ?.capacity ?? null;
            const count = occ?.count ?? 0;
            const available = capacity != null ? Math.max(0, capacity - count) : null;
            const pctFull = capacity ? Math.min(100, Math.round((count / capacity) * 100)) : 0;
            const overCapacity = capacity != null && count > capacity;

            return (
              <div key={route.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">{route.route_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {occ?.registrationNumber ?? "—"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={occ?.source === "manual" ? "secondary" : "outline"}>
                      {occ?.source === "manual" ? "Manual" : "Auto"}
                    </Badge>
                    {overCapacity && <Badge className="bg-red-100 text-red-700">Over capacity</Badge>}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${overCapacity ? "bg-red-500" : "bg-blue-500"}`}
                      style={{ width: `${pctFull}%` }}
                    />
                  </div>
                  <p className="text-xs whitespace-nowrap text-muted-foreground">
                    {count}
                    {capacity != null ? ` / ${capacity}` : ""} onboard
                    {available != null && ` · ${available} seats free`}
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  {occ?.source === "manual" && occ.recordedAt && (
                    <p className="text-xs text-muted-foreground">
                      Set manually at {new Date(occ.recordedAt).toLocaleTimeString()}
                    </p>
                  )}
                  <div className="flex gap-2 ml-auto">
                    {occ?.source === "manual" && occ.manualLogId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => clearOverride(route.id, occ.manualLogId!)}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Revert to auto
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openOverrideDialog(route)}>
                      <Pencil className="h-3 w-3 mr-1" />
                      Override headcount
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={!!overrideRoute} onOpenChange={(open) => !open && setOverrideRoute(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Headcount — {overrideRoute?.route_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              type="number"
              min={0}
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
              placeholder="Number of students onboard"
            />
            {overrideRoute?.vehicles?.capacity != null && (
              <p className="text-xs text-muted-foreground">
                Vehicle capacity: {overrideRoute.vehicles.capacity}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideRoute(null)}>
              Cancel
            </Button>
            <Button onClick={saveOverride} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
