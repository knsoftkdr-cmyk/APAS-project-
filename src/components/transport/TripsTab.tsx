import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CalendarPlus, Loader2, Play, Pause, MapPinned, Bus } from "lucide-react";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const busMarkerIcon = new L.DivIcon({
  html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#f97316;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);font-size:15px;transform:translate(-50%,-50%);">🚌</div>`,
  className: "",
  iconSize: [0, 0],
});

type TripStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
type TripType = "recurring" | "special";

interface TripRow {
  id: string;
  route_id: string | null;
  vehicle_id: string;
  driver_id: string;
  trip_type: TripType;
  direction: string | null;
  trip_date: string;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  started_at: string | null;
  ended_at: string | null;
  status: TripStatus;
  purpose: string | null;
  transport_routes: { route_name: string } | null;
  vehicles: { registration_number: string } | null;
  drivers: { name: string } | null;
}
interface VehicleOption {
  id: string;
  registration_number: string;
}
interface DriverOption {
  id: string;
  name: string;
}

const STATUS_COLORS: Record<TripStatus, string> = {
  scheduled: "bg-blue-50 text-blue-700 border-blue-200",
  in_progress: "bg-emerald-50 text-emerald-700 border-emerald-200",
  completed: "bg-slate-100 text-slate-600 border-slate-200",
  cancelled: "bg-red-50 text-red-600 border-red-200",
};

export function TripsTab({ schoolId }: { schoolId?: string }) {
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | TripStatus>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | TripType>("all");
  const [dateFilter, setDateFilter] = useState<string>("");

  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    vehicleId: "",
    driverId: "",
    tripDate: "",
    startTime: "",
    endTime: "",
    purpose: "",
  });

  const [replayTrip, setReplayTrip] = useState<TripRow | null>(null);

  const fetchTrips = async () => {
    if (!schoolId) return;
    setLoading(true);
    let query = supabase
      .from("trips")
      .select("*, transport_routes(route_name), vehicles(registration_number), drivers(name)")
      .eq("school_id", schoolId)
      .order("trip_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (typeFilter !== "all") query = query.eq("trip_type", typeFilter);
    if (dateFilter) query = query.eq("trip_date", dateFilter);
    const { data, error } = await query;
    if (!error) setTrips((data as any as TripRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchTrips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, statusFilter, typeFilter, dateFilter]);

  useEffect(() => {
    if (!schoolId) return;
    (async () => {
      const [{ data: v }, { data: d }] = await Promise.all([
        supabase.from("vehicles").select("id, registration_number").eq("school_id", schoolId).order("registration_number"),
        supabase.from("drivers").select("id, name").eq("school_id", schoolId).order("name"),
      ]);
      setVehicles((v as VehicleOption[]) ?? []);
      setDrivers((d as DriverOption[]) ?? []);
    })();
  }, [schoolId]);

  const resetForm = () => {
    setShowForm(false);
    setForm({ vehicleId: "", driverId: "", tripDate: "", startTime: "", endTime: "", purpose: "" });
  };

  const scheduleTrip = async () => {
    if (!schoolId || !form.vehicleId || !form.driverId || !form.tripDate || !form.purpose.trim()) {
      toast.error("Vehicle, driver, date, and purpose are all required.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("trips").insert({
      school_id: schoolId,
      route_id: null,
      vehicle_id: form.vehicleId,
      driver_id: form.driverId,
      trip_type: "special",
      direction: "special",
      trip_date: form.tripDate,
      scheduled_start_time: form.startTime || null,
      scheduled_end_time: form.endTime || null,
      status: "scheduled",
      purpose: form.purpose.trim(),
    });
    setSaving(false);
    if (error) {
      toast.error("Failed to schedule trip: " + error.message);
      return;
    }
    toast.success("Special trip scheduled.");
    resetForm();
    fetchTrips();
  };

  const cancelTrip = async (id: string) => {
    const { error } = await supabase.from("trips").update({ status: "cancelled" }).eq("id", id);
    if (error) {
      toast.error("Failed to cancel trip: " + error.message);
      return;
    }
    toast.success("Trip cancelled.");
    fetchTrips();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <MapPinned className="h-5 w-5" /> Trips
          </CardTitle>
          <Button size="sm" onClick={() => (showForm ? resetForm() : setShowForm(true))} className="gap-1.5">
            <CalendarPlus className="h-4 w-4" /> {showForm ? "Cancel" : "Schedule Special Trip"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {showForm && (
            <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Vehicle</Label>
                  <Select value={form.vehicleId} onValueChange={(v) => setForm({ ...form, vehicleId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                    <SelectContent>
                      {vehicles.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.registration_number}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Driver</Label>
                  <Select value={form.driverId} onValueChange={(v) => setForm({ ...form, driverId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select driver" /></SelectTrigger>
                    <SelectContent>
                      {drivers.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Date</Label>
                  <Input type="date" value={form.tripDate} onChange={(e) => setForm({ ...form, tripDate: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Start time</Label>
                    <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">End time</Label>
                    <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Purpose</Label>
                  <Input
                    value={form.purpose}
                    onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                    placeholder="e.g. Field trip to science museum"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={resetForm} disabled={saving}>Cancel</Button>
                <Button size="sm" onClick={scheduleTrip} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  Schedule Trip
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="recurring">Recurring</SelectItem>
                  <SelectItem value="special">Special</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-[160px]" />
            </div>
            {dateFilter && (
              <Button variant="ghost" size="sm" onClick={() => setDateFilter("")}>Clear date</Button>
            )}
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading trips...
            </p>
          ) : trips.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trips match these filters.</p>
          ) : (
            <div className="space-y-2">
              {trips.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg border p-3 flex-wrap gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="rounded-full bg-muted p-2 shrink-0">
                      <Bus className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {t.trip_type === "special"
                          ? t.purpose || "Special trip"
                          : t.transport_routes?.route_name || "Route"}
                        {t.direction && t.direction !== "special" && (
                          <span className="text-xs font-normal text-muted-foreground ml-1">({t.direction})</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {t.trip_date} · {t.vehicles?.registration_number || "—"} · {t.drivers?.name || "—"}
                        {t.started_at && (
                          <> · started {new Date(t.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>
                        )}
                        {t.ended_at && (
                          <> – {new Date(t.ended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={STATUS_COLORS[t.status]}>
                      {t.status.replace("_", " ")}
                    </Badge>
                    {t.status === "completed" && t.started_at && t.ended_at && (
                      <Button size="sm" variant="outline" onClick={() => setReplayTrip(t)} className="gap-1">
                        <Play className="h-3.5 w-3.5" /> Replay
                      </Button>
                    )}
                    {t.status === "scheduled" && (
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => cancelTrip(t.id)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {replayTrip && (
        <TripReplayDialog trip={replayTrip} onClose={() => setReplayTrip(null)} />
      )}
    </div>
  );
}

// ============================================================
// Trip Replay
// ============================================================
interface BreadcrumbPoint {
  latitude: number;
  longitude: number;
  recorded_at: string;
}

function TripReplayDialog({ trip, onClose }: { trip: TripRow; onClose: () => void }) {
  const [points, setPoints] = useState<BreadcrumbPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("vehicle_location_history")
        .select("latitude, longitude, recorded_at")
        .eq("vehicle_id", trip.vehicle_id)
        .gte("recorded_at", trip.started_at as string)
        .lte("recorded_at", trip.ended_at as string)
        .order("recorded_at", { ascending: true });
      if (!cancelled) {
        setPoints((data as BreadcrumbPoint[]) ?? []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trip.vehicle_id, trip.started_at, trip.ended_at]);

  useEffect(() => {
    if (playing && points.length > 0) {
      intervalRef.current = window.setInterval(() => {
        setIndex((prev) => {
          if (prev >= points.length - 1) {
            setPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 250);
    }
    return () => {
      if (intervalRef.current != null) window.clearInterval(intervalRef.current);
    };
  }, [playing, points.length]);

  const path: [number, number][] = useMemo(
    () => points.map((p) => [p.latitude, p.longitude] as [number, number]),
    [points]
  );
  const current = points[index];
  const center: [number, number] = current ? [current.latitude, current.longitude] : path[0] ?? [17.385, 78.4867];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Trip Replay — {trip.trip_date}
            {trip.transport_routes?.route_name ? ` · ${trip.transport_routes.route_name}` : ""}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading GPS trail...
          </p>
        ) : points.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No GPS breadcrumbs were recorded for this trip.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg overflow-hidden border relative z-0" style={{ height: "360px" }}>
              <MapContainer center={center} zoom={14} style={{ height: "100%", width: "100%" }}>
                <TileLayer
                  attribution='&copy; OpenStreetMap contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {path.length >= 2 && (
                  <Polyline positions={path} pathOptions={{ color: "#f97316", weight: 3, opacity: 0.7 }} />
                )}
                {current && <Marker position={[current.latitude, current.longitude]} icon={busMarkerIcon} />}
              </MapContainer>
            </div>
            <div className="flex items-center gap-3">
              <Button size="icon" variant="outline" onClick={() => setPlaying((p) => !p)}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <input
                type="range"
                min={0}
                max={points.length - 1}
                value={index}
                onChange={(e) => {
                  setPlaying(false);
                  setIndex(Number(e.target.value));
                }}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-16 text-right shrink-0">
                {index + 1}/{points.length}
              </span>
            </div>
            {current && (
              <p className="text-xs text-muted-foreground text-center">
                {new Date(current.recorded_at).toLocaleTimeString()}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
