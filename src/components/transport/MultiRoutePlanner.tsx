import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Wand2, Loader2, Bus, MapPin, ArrowRight, CheckCircle2 } from "lucide-react";

// ============================================================
// Types
// ============================================================
interface RouteOption {
  id: string;
  route_name: string;
  route_number: string | null;
  vehicle_id: string | null;
  vehicle_registration: string | null;
}
interface PoolStop {
  id: string;
  stop_name: string;
  latitude: number;
  longitude: number;
  radius_meters: number | null;
  pickup_time: string | null;
  drop_time: string | null;
  originalRouteId: string;
}
interface ClusterPlan {
  routeId: string;
  routeName: string;
  vehicleRegistration: string | null;
  stops: PoolStop[];
  totalKm: number;
}

// ============================================================
// Geometry / clustering helpers
// ============================================================
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// k-means-style clustering (haversine distance), seeded via farthest-point
// sampling for determinism, followed by a balancing pass so no vehicle ends
// up with wildly more/fewer stops than the others.
function clusterStops(stops: PoolStop[], k: number): PoolStop[][] {
  if (stops.length === 0 || k <= 0) return [];
  k = Math.min(k, stops.length);

  const centroids: [number, number][] = [[stops[0].latitude, stops[0].longitude]];
  while (centroids.length < k) {
    let bestIdx = 0;
    let bestDist = -1;
    for (let i = 0; i < stops.length; i++) {
      const minD = Math.min(
        ...centroids.map((c) => haversineMeters(stops[i].latitude, stops[i].longitude, c[0], c[1]))
      );
      if (minD > bestDist) {
        bestDist = minD;
        bestIdx = i;
      }
    }
    centroids.push([stops[bestIdx].latitude, stops[bestIdx].longitude]);
  }

  let assignment = new Array(stops.length).fill(0);
  let workingCentroids = centroids;
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < stops.length; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < workingCentroids.length; c++) {
        const d = haversineMeters(
          stops[i].latitude,
          stops[i].longitude,
          workingCentroids[c][0],
          workingCentroids[c][1]
        );
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      assignment[i] = best;
    }
    const sums = workingCentroids.map(() => ({ lat: 0, lng: 0, count: 0 }));
    for (let i = 0; i < stops.length; i++) {
      const c = assignment[i];
      sums[c].lat += stops[i].latitude;
      sums[c].lng += stops[i].longitude;
      sums[c].count += 1;
    }
    workingCentroids = sums.map((s, idx) => (s.count > 0 ? [s.lat / s.count, s.lng / s.count] : workingCentroids[idx]));
  }

  const clusters: PoolStop[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < stops.length; i++) clusters[assignment[i]].push(stops[i]);

  // Balance pass: move the worst-fitting stop from the biggest cluster to
  // the smallest, until they're within one stop of each other.
  for (let pass = 0; pass < 30; pass++) {
    clusters.sort((a, b) => b.length - a.length);
    const biggest = clusters[0];
    const smallest = clusters[clusters.length - 1];
    if (biggest.length - smallest.length <= 1 || biggest.length < 2) break;

    const cLat = smallest.length
      ? smallest.reduce((s, p) => s + p.latitude, 0) / smallest.length
      : biggest.reduce((s, p) => s + p.latitude, 0) / biggest.length;
    const cLng = smallest.length
      ? smallest.reduce((s, p) => s + p.longitude, 0) / smallest.length
      : biggest.reduce((s, p) => s + p.longitude, 0) / biggest.length;

    let bestIdx = 0;
    let bestDist = Infinity;
    biggest.forEach((s, idx) => {
      const d = haversineMeters(s.latitude, s.longitude, cLat, cLng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    const [moved] = biggest.splice(bestIdx, 1);
    smallest.push(moved);
  }

  return clusters;
}

// ============================================================
// Single-route ordering (nearest-neighbor + 2-opt), same approach as the
// per-route optimizer elsewhere in Transport, duplicated here to keep this
// file self-contained.
// ============================================================
function nearestNeighborOrder(matrix: number[][], start: number): number[] {
  const n = matrix.length;
  const visited = new Array(n).fill(false);
  const order = [start];
  visited[start] = true;
  for (let step = 1; step < n; step++) {
    const last = order[order.length - 1];
    let best = -1;
    let bestCost = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && matrix[last][j] < bestCost) {
        bestCost = matrix[last][j];
        best = j;
      }
    }
    order.push(best);
    visited[best] = true;
  }
  return order;
}

function routeCost(order: number[], matrix: number[][]): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) total += matrix[order[i]][order[i + 1]];
  return total;
}

function twoOptImprove(order: number[], matrix: number[][]): number[] {
  let best = [...order];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 2; i++) {
      for (let j = i + 1; j < best.length - 1; j++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        if (routeCost(candidate, matrix) < routeCost(best, matrix)) {
          best = candidate;
          improved = true;
        }
      }
    }
  }
  return best;
}

async function fetchDistanceMatrix(
  stops: PoolStop[]
): Promise<{ durations: number[][]; distances: number[][] } | null> {
  if (stops.length < 2) return null;
  const coordStr = stops.map((s) => `${s.longitude},${s.latitude}`).join(";");
  try {
    const res = await fetch(
      `https://router.project-osrm.org/table/v1/driving/${coordStr}?annotations=duration,distance`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== "Ok") return null;
    return { durations: data.durations, distances: data.distances };
  } catch {
    return null;
  }
}

// ============================================================
// Component
// ============================================================
export function MultiRoutePlanner({ schoolId }: { schoolId?: string }) {
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [plans, setPlans] = useState<ClusterPlan[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const { data: routes, isLoading } = useQuery({
    queryKey: ["multi-route-planner-routes", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_routes")
        .select("id, route_name, route_number, vehicle_id, vehicles(registration_number)")
        .eq("school_id", schoolId)
        .eq("status", "active")
        .order("route_name");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        route_name: r.route_name,
        route_number: r.route_number,
        vehicle_id: r.vehicle_id,
        vehicle_registration: r.vehicles?.registration_number ?? null,
      })) as RouteOption[];
    },
    enabled: !!schoolId,
  });

  const toggleRoute = (id: string) => {
    setPlans(null);
    setSelectedRouteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generatePlan = async () => {
    if (!routes || selectedRouteIds.size < 2) {
      toast.error("Select at least 2 routes to rebalance stops across.");
      return;
    }
    setGenerating(true);
    try {
      const selectedRoutes = routes.filter((r) => selectedRouteIds.has(r.id));
      const { data: stopRows, error } = await supabase
        .from("route_stops")
        .select("id, stop_name, latitude, longitude, radius_meters, pickup_time, drop_time, route_id")
        .in("route_id", Array.from(selectedRouteIds));
      if (error) throw error;

      const pooled: PoolStop[] = (stopRows ?? [])
        .filter((s: any) => s.latitude != null && s.longitude != null)
        .map((s: any) => ({
          id: s.id,
          stop_name: s.stop_name,
          latitude: s.latitude,
          longitude: s.longitude,
          radius_meters: s.radius_meters,
          pickup_time: s.pickup_time,
          drop_time: s.drop_time,
          originalRouteId: s.route_id,
        }));

      if (pooled.length < selectedRoutes.length) {
        toast.error("Not enough geocoded stops to fill every selected vehicle.");
        setGenerating(false);
        return;
      }

      const clusters = clusterStops(pooled, selectedRoutes.length);

      // Match clusters to routes by nearest original centroid, so a route
      // roughly keeps "its" area rather than being randomly renamed.
      const routeCentroids = selectedRoutes.map((r) => {
        const owned = pooled.filter((s) => s.originalRouteId === r.id);
        if (owned.length === 0) return null;
        return [
          owned.reduce((s, p) => s + p.latitude, 0) / owned.length,
          owned.reduce((s, p) => s + p.longitude, 0) / owned.length,
        ] as [number, number];
      });
      const clusterCentroids = clusters.map((c) => {
        if (c.length === 0) return null;
        return [
          c.reduce((s, p) => s + p.latitude, 0) / c.length,
          c.reduce((s, p) => s + p.longitude, 0) / c.length,
        ] as [number, number];
      });

      const usedRouteIdx = new Set<number>();
      const clusterToRoute: number[] = new Array(clusters.length).fill(-1);
      const clusterOrderByBiggest = clusters
        .map((_, i) => i)
        .sort((a, b) => clusters[b].length - clusters[a].length);

      for (const ci of clusterOrderByBiggest) {
        const cc = clusterCentroids[ci];
        let bestR = -1;
        let bestDist = Infinity;
        for (let ri = 0; ri < selectedRoutes.length; ri++) {
          if (usedRouteIdx.has(ri)) continue;
          const rc = routeCentroids[ri] ?? cc;
          const d = cc && rc ? haversineMeters(cc[0], cc[1], rc[0], rc[1]) : 0;
          if (d < bestDist) {
            bestDist = d;
            bestR = ri;
          }
        }
        if (bestR === -1) bestR = selectedRoutes.findIndex((_, ri) => !usedRouteIdx.has(ri));
        usedRouteIdx.add(bestR);
        clusterToRoute[ci] = bestR;
      }

      const newPlans: ClusterPlan[] = [];
      for (let ci = 0; ci < clusters.length; ci++) {
        const stops = clusters[ci];
        const route = selectedRoutes[clusterToRoute[ci]];
        if (stops.length <= 1) {
          newPlans.push({
            routeId: route.id,
            routeName: route.route_name,
            vehicleRegistration: route.vehicle_registration,
            stops,
            totalKm: 0,
          });
          continue;
        }
        const matrix = await fetchDistanceMatrix(stops);
        if (!matrix) {
          newPlans.push({
            routeId: route.id,
            routeName: route.route_name,
            vehicleRegistration: route.vehicle_registration,
            stops,
            totalKm: 0,
          });
          continue;
        }
        let order = nearestNeighborOrder(matrix.durations, 0);
        order = twoOptImprove(order, matrix.durations);
        const orderedStops = order.map((idx) => stops[idx]);
        let totalMeters = 0;
        for (let i = 0; i < order.length - 1; i++) totalMeters += matrix.distances[order[i]][order[i + 1]];
        newPlans.push({
          routeId: route.id,
          routeName: route.route_name,
          vehicleRegistration: route.vehicle_registration,
          stops: orderedStops,
          totalKm: totalMeters / 1000,
        });
      }

      setPlans(newPlans);
      toast.success("Plan generated — review below before applying.");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate plan");
    } finally {
      setGenerating(false);
    }
  };

  const applyPlan = async () => {
    if (!plans) return;
    setApplying(true);
    try {
      // Phase 1: push every touched stop to a high temp sequence range so
      // the (route_id, sequence_number) unique constraint can't collide
      // while we reassign routes below.
      let tempSeq = 100000;
      const allStops = plans.flatMap((p) => p.stops);
      for (const stop of allStops) {
        const { error } = await supabase
          .from("route_stops")
          .update({ sequence_number: tempSeq++ })
          .eq("id", stop.id);
        if (error) throw error;
      }

      // Phase 2: write final route_id + sequence_number per plan.
      for (const plan of plans) {
        for (let i = 0; i < plan.stops.length; i++) {
          const { error } = await supabase
            .from("route_stops")
            .update({ route_id: plan.routeId, sequence_number: i + 1 })
            .eq("id", plan.stops[i].id);
          if (error) throw error;
        }
      }

      // Phase 3: keep transport_assignments.route_id consistent with the
      // stop's new route, so driver/parent views stay correct.
      const stopIdToNewRoute = new Map<string, string>();
      plans.forEach((p) => p.stops.forEach((s) => stopIdToNewRoute.set(s.id, p.routeId)));
      const stopIds = Array.from(stopIdToNewRoute.keys());

      if (stopIds.length > 0) {
        const { data: assignments, error: fetchErr } = await supabase
          .from("transport_assignments")
          .select("id, pickup_stop_id, drop_stop_id")
          .or(`pickup_stop_id.in.(${stopIds.join(",")}),drop_stop_id.in.(${stopIds.join(",")})`);
        if (fetchErr) throw fetchErr;

        for (const a of assignments ?? []) {
          const newRoute =
            (a.pickup_stop_id && stopIdToNewRoute.get(a.pickup_stop_id)) ||
            (a.drop_stop_id && stopIdToNewRoute.get(a.drop_stop_id));
          if (newRoute) {
            const { error: updErr } = await supabase
              .from("transport_assignments")
              .update({ route_id: newRoute })
              .eq("id", a.id);
            if (updErr) throw updErr;
          }
        }
      }

      toast.success("Multi-route plan applied. Reload the Routes & Stops tab to see the update.");
      setConfirmOpen(false);
      setPlans(null);
      setSelectedRouteIds(new Set());
    } catch (e: any) {
      toast.error(e.message || "Failed to apply plan — some stops may be partially updated, please review.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" /> Multi-Route Planner
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Select two or more vehicles to redistribute their stops geographically and re-optimize each
            resulting route. This is a real change — review the plan carefully before applying.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading routes...
            </p>
          ) : !routes || routes.length < 2 ? (
            <p className="text-sm text-muted-foreground">
              You need at least 2 active routes with vehicles assigned to use the multi-route planner.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {routes.map((r) => {
                  const selected = selectedRouteIds.has(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleRoute(r.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                        selected
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-background text-muted-foreground border-input"
                      }`}
                    >
                      <Bus className="h-3.5 w-3.5" />
                      {r.route_name}
                      {r.vehicle_registration && (
                        <span className="opacity-75">· {r.vehicle_registration}</span>
                      )}
                      {selected && <CheckCircle2 className="h-3.5 w-3.5 ml-0.5" />}
                    </button>
                  );
                })}
              </div>

              <Button onClick={generatePlan} disabled={selectedRouteIds.size < 2 || generating} className="gap-1.5">
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Generate Plan
              </Button>
            </>
          )}

          {plans && (
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Proposed plan</p>
                <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={applying}>
                  Apply Plan
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {plans.map((plan) => (
                  <div key={plan.routeId} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold flex items-center gap-1.5">
                        <Bus className="h-4 w-4" /> {plan.routeName}
                        {plan.vehicleRegistration && (
                          <span className="text-xs font-normal text-muted-foreground">
                            · {plan.vehicleRegistration}
                          </span>
                        )}
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {plan.stops.length} stops{plan.totalKm > 0 ? ` · ${plan.totalKm.toFixed(1)} km` : ""}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {plan.stops.map((s, i) => (
                        <div key={s.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="w-4 shrink-0 text-right">{i + 1}.</span>
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="text-foreground">{s.stop_name}</span>
                          {s.originalRouteId !== plan.routeId && (
                            <span className="inline-flex items-center gap-0.5 text-amber-600">
                              <ArrowRight className="h-3 w-3" /> moved
                            </span>
                          )}
                        </div>
                      ))}
                      {plan.stops.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">No stops assigned</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply this multi-route plan?</DialogTitle>
            <DialogDescription>
              This moves stops between routes and updates every affected student's transport assignment.
              This can't be automatically undone — you'd need to manually re-edit routes to revert.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={applying}>
              Cancel
            </Button>
            <Button onClick={applyPlan} disabled={applying} className="gap-1.5">
              {applying && <Loader2 className="h-4 w-4 animate-spin" />}
              Yes, apply plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
