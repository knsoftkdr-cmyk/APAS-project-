import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Gauge, Timer, TrendingDown, TrendingUp, Loader2, Info,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface VehicleOption {
  id: string;
  registration_number: string;
}

interface LocationPing {
  latitude: number;
  longitude: number;
  recorded_at: string;
}

interface SpeedPoint {
  time: string;
  timestamp: number;
  speedKmh: number;
  gapSeconds: number;
  distanceKm: number;
}

// ── Tunable thresholds — all approximate, since these are derived from
// ~15s-apart GPS pings, not true accelerometer/telematics data ──
const IDLE_SPEED_THRESHOLD_KMH = 3; // below this = considered stationary
const IDLE_MIN_DURATION_SECONDS = 120; // must be idle for at least 2 min to count as an episode
const SUDDEN_DECEL_THRESHOLD_KMH = 15; // speed drop between consecutive pings
const SUDDEN_ACCEL_THRESHOLD_KMH = 15; // speed rise between consecutive pings
const MAX_GAP_SECONDS_FOR_EVENT = 30; // ignore deltas across gaps bigger than this (data too sparse to mean anything)
const GPS_NOISE_MAX_SPEED_KMH = 150; // treat anything above this as a GPS glitch, not real movement
const GPS_NOISE_FLOOR_METERS = 20; // distance below this between consecutive pings is GPS jitter, not real movement — treated as stationary (0 km/h, 0 distance)

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function DriverBehaviourAnalyticsTab({ schoolId }: { schoolId?: string }) {
  const [vehicleId, setVehicleId] = useState<string>("");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const { data: vehicles } = useQuery({
    queryKey: ["behaviour-vehicles", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, registration_number")
        .eq("school_id", schoolId)
        .order("registration_number");
      if (error) throw error;
      return data as VehicleOption[];
    },
    enabled: !!schoolId,
  });

  const { data: pings, isLoading } = useQuery({
    queryKey: ["behaviour-pings", vehicleId, date],
    queryFn: async () => {
      const start = `${date}T00:00:00.000Z`;
      const end = `${date}T23:59:59.999Z`;
      const { data, error } = await supabase
        .from("vehicle_location_history")
        .select("latitude, longitude, recorded_at")
        .eq("vehicle_id", vehicleId)
        .gte("recorded_at", start)
        .lte("recorded_at", end)
        .order("recorded_at", { ascending: true });
      if (error) throw error;
      return data as LocationPing[];
    },
    enabled: !!vehicleId && !!date,
  });

  const analysis = useMemo(() => {
    if (!pings || pings.length < 2) return null;

    const speedPoints: SpeedPoint[] = [];
    for (let i = 1; i < pings.length; i++) {
      const prev = pings[i - 1];
      const curr = pings[i];
      const gapSeconds = (new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000;
      if (gapSeconds <= 0) continue;
      let distanceKm = haversineKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      // GPS jitter floor: a stationary phone still drifts a few meters between
      // readings due to normal GPS signal noise. Below GPS_NOISE_FLOOR_METERS,
      // treat this as no real movement rather than computing a "phantom speed".
      if (distanceKm * 1000 < GPS_NOISE_FLOOR_METERS) {
        distanceKm = 0;
      }
      const speedKmh = distanceKm / (gapSeconds / 3600);
      if (speedKmh > GPS_NOISE_MAX_SPEED_KMH) continue; // discard GPS glitches
      speedPoints.push({
        time: new Date(curr.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        timestamp: new Date(curr.recorded_at).getTime(),
        speedKmh,
        gapSeconds,
        distanceKm,
      });
    }

    if (speedPoints.length === 0) return null;

    const maxSpeed = Math.max(...speedPoints.map((p) => p.speedKmh));
    const avgSpeed = speedPoints.reduce((sum, p) => sum + p.speedKmh, 0) / speedPoints.length;
    const totalDistance = speedPoints.reduce((sum, p) => sum + p.distanceKm, 0);

    // Idle episodes: consecutive low-speed points whose combined duration crosses the minimum
    const idleEpisodes: { start: string; durationSeconds: number }[] = [];
    let idleRunStart: number | null = null;
    let idleRunSeconds = 0;
    for (const p of speedPoints) {
      if (p.speedKmh <= IDLE_SPEED_THRESHOLD_KMH && p.gapSeconds <= MAX_GAP_SECONDS_FOR_EVENT * 3) {
        if (idleRunStart === null) idleRunStart = p.timestamp - p.gapSeconds * 1000;
        idleRunSeconds += p.gapSeconds;
      } else {
        if (idleRunStart !== null && idleRunSeconds >= IDLE_MIN_DURATION_SECONDS) {
          idleEpisodes.push({
            start: new Date(idleRunStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            durationSeconds: idleRunSeconds,
          });
        }
        idleRunStart = null;
        idleRunSeconds = 0;
      }
    }
    if (idleRunStart !== null && idleRunSeconds >= IDLE_MIN_DURATION_SECONDS) {
      idleEpisodes.push({
        start: new Date(idleRunStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        durationSeconds: idleRunSeconds,
      });
    }
    const totalIdleSeconds = idleEpisodes.reduce((sum, e) => sum + e.durationSeconds, 0);

    // Sudden deceleration/acceleration: big speed change between two close-together pings
    const decelEvents: { time: string; from: number; to: number }[] = [];
    const accelEvents: { time: string; from: number; to: number }[] = [];
    for (let i = 1; i < speedPoints.length; i++) {
      const prev = speedPoints[i - 1];
      const curr = speedPoints[i];
      if (curr.gapSeconds > MAX_GAP_SECONDS_FOR_EVENT) continue;
      const delta = curr.speedKmh - prev.speedKmh;
      if (delta <= -SUDDEN_DECEL_THRESHOLD_KMH) {
        decelEvents.push({ time: curr.time, from: prev.speedKmh, to: curr.speedKmh });
      } else if (delta >= SUDDEN_ACCEL_THRESHOLD_KMH) {
        accelEvents.push({ time: curr.time, from: prev.speedKmh, to: curr.speedKmh });
      }
    }

    return {
      speedPoints,
      maxSpeed,
      avgSpeed,
      totalDistance,
      idleEpisodes,
      totalIdleSeconds,
      decelEvents,
      accelEvents,
    };
  }, [pings]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gauge className="h-5 w-5" /> Driver Behaviour Analytics</CardTitle>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5 mt-1">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Estimated from GPS location pings (~15s apart), not a dedicated telematics device — treat "sudden deceleration/acceleration" as a rough signal, not precise harsh-braking sensor data. Movement under 20m between pings is treated as stationary (filters out normal GPS drift when parked).
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <Label className="text-xs">Vehicle</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                <SelectContent>
                  {(vehicles ?? []).map((v) => (<SelectItem key={v.id} value={v.id}>{v.registration_number}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[160px]" />
            </div>
          </div>
        </CardContent>
      </Card>

      {!vehicleId ? (
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Select a vehicle and date to view behaviour analytics.</p>
        </CardContent></Card>
      ) : isLoading ? (
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading GPS data...</p>
        </CardContent></Card>
      ) : !analysis ? (
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">No GPS data recorded for this vehicle on this date.</p>
        </CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card><CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Max Speed</p>
              <p className="text-2xl font-semibold">{analysis.maxSpeed.toFixed(0)} km/h</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Avg Speed</p>
              <p className="text-2xl font-semibold">{analysis.avgSpeed.toFixed(0)} km/h</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Distance Covered</p>
              <p className="text-2xl font-semibold">{analysis.totalDistance.toFixed(1)} km</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Total Idle Time</p>
              <p className="text-2xl font-semibold">{Math.round(analysis.totalIdleSeconds / 60)} min</p>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Speed Over Time</CardTitle></CardHeader>
            <CardContent>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={analysis.speedPoints}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={30} />
                    <YAxis tick={{ fontSize: 12 }} unit=" km/h" />
                    <Tooltip formatter={(value: number) => [`${value.toFixed(0)} km/h`, "Speed"]} />
                    <Line type="monotone" dataKey="speedKmh" stroke="#2563eb" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Timer className="h-4 w-4" /> Idle Episodes</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {analysis.idleEpisodes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No idle episodes ≥2 min detected.</p>
                ) : (
                  analysis.idleEpisodes.map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span>{e.start}</span>
                      <Badge variant="outline">{Math.round(e.durationSeconds / 60)} min</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingDown className="h-4 w-4" /> Sudden Deceleration</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {analysis.decelEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None detected.</p>
                ) : (
                  analysis.decelEvents.map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span>{e.time}</span>
                      <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200">
                        {e.from.toFixed(0)}→{e.to.toFixed(0)} km/h
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Sudden Acceleration</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {analysis.accelEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None detected.</p>
                ) : (
                  analysis.accelEvents.map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span>{e.time}</span>
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                        {e.from.toFixed(0)}→{e.to.toFixed(0)} km/h
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
