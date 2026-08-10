import { useEffect, useState, useRef, Fragment } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const stopIcon = new L.DivIcon({
  html: `<div style="width:10px;height:10px;border-radius:50%;background:#64748b;border:2px solid white;box-shadow:0 0 0 1px #64748b;"></div>`,
  className: "",
  iconSize: [10, 10],
});

function highlightIcon(label: string, color: string, arrived?: boolean) {
  return new L.DivIcon({
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">
             <div style="background:${color};color:white;font-size:10px;font-weight:600;padding:2px 6px;border-radius:6px;white-space:nowrap;margin-bottom:2px;">${label}${arrived ? " ✓" : ""}</div>
             <div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;${arrived ? "box-shadow:0 0 0 5px rgba(16,185,129,0.35);" : ""}"></div>
           </div>`,
    className: "",
    iconSize: [0, 0],
  });
}

const busMarkerIcon = new L.DivIcon({
  html: `<div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#f97316;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);font-size:16px;transform:translate(-50%,-50%);">🚌</div>`,
  className: "",
  iconSize: [0, 0],
});

interface StopRow {
  id: string;
  stop_name: string;
  sequence_number: number;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  pickup_time: string | null;
  drop_time: string | null;
}

interface BusTrackingMapProps {
  routeId?: string | null;
  vehicleId?: string | null;
  pickupStopId?: string | null;
  dropStopId?: string | null;
  busNumber?: string;
  routeName?: string;
  driverName?: string | null;
  driverPhone?: string | null;
  attendantName?: string | null;
  attendantPhone?: string | null;
  pickupTime?: string | null;
}

interface BusPosition {
  latitude: number;
  longitude: number;
  updated_at: string;
}

// Uses OSRM's free public routing server to fetch a road-following path
// between stops. Note: router.project-osrm.org is a shared demo instance,
// rate-limited and not intended for production load — fine for now, but
// swap for a paid provider or self-hosted OSRM before real-world scale.
async function fetchRoadPath(stops: StopRow[]): Promise<[number, number][] | null> {
  if (stops.length < 2) return null;
  const coordsParam = stops.map((s) => `${s.longitude},${s.latitude}`).join(";");
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length === 0) return null;
    // OSRM returns [lng, lat] — Leaflet wants [lat, lng]
    return coords.map((c: [number, number]) => [c[1], c[0]]);
  } catch {
    return null;
  }
}

export function BusTrackingMap({
  routeId,
  vehicleId,
  pickupStopId,
  dropStopId,
  busNumber = "Bus",
  routeName = "Route",
  driverName,
  driverPhone,
  attendantName,
  attendantPhone,
  pickupTime,
}: BusTrackingMapProps) {
  const [stops, setStops] = useState<StopRow[] | null>(null);
  const [roadPath, setRoadPath] = useState<[number, number][] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busPosition, setBusPosition] = useState<BusPosition | null>(null);
  const [arrivals, setArrivals] = useState<Record<string, string>>({});
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [eta, setEta] = useState<{ minutes: number; distanceKm: number; delayMinutes: number } | null>(null);
  const [delayPrediction, setDelayPrediction] = useState<{ avgMinutes: number; sampleSize: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!routeId) {
        setStops(null);
        setRoadPath(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data, error } = await supabase
        .from("route_stops")
        .select("id, stop_name, sequence_number, latitude, longitude, radius_meters, pickup_time, drop_time")
        .eq("route_id", routeId)
        .order("sequence_number");

      if (cancelled) return;

      if (error) {
        setStops(null);
        setRoadPath(null);
        setLoading(false);
        return;
      }

      const stopRows = (data as StopRow[]) || [];
      setStops(stopRows);

      const geocoded = stopRows.filter((s) => s.latitude != null && s.longitude != null);
      if (geocoded.length >= 2) {
        const path = await fetchRoadPath(geocoded);
        if (!cancelled) setRoadPath(path);
      } else {
        setRoadPath(null);
      }

      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [routeId]);

  useEffect(() => {
    if (!vehicleId) {
      setBusPosition(null);
      return;
    }

    let cancelled = false;

    async function loadInitialPosition() {
      const { data } = await supabase
        .from("vehicle_locations")
        .select("latitude, longitude, updated_at")
        .eq("vehicle_id", vehicleId)
        .maybeSingle();
      if (!cancelled && data) {
        setBusPosition(data as BusPosition);
      }
    }
    loadInitialPosition();

    const channel = supabase
      .channel(`vehicle-location-${vehicleId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "vehicle_locations",
          filter: `vehicle_id=eq.${vehicleId}`,
        },
        (payload) => {
          const row = payload.new as BusPosition | undefined;
          if (row) setBusPosition(row);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [vehicleId]);

  useEffect(() => {
    if (!routeId) {
      setArrivals({});
      return;
    }

    let cancelled = false;

    async function loadArrivals() {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("stop_arrivals")
        .select("stop_id, arrived_at")
        .eq("route_id", routeId)
        .eq("arrival_date", today);
      if (!cancelled) {
        const map: Record<string, string> = {};
        (data || []).forEach((a: any) => { map[a.stop_id] = a.arrived_at; });
        setArrivals(map);
      }
    }
    loadArrivals();

    const channel = supabase
      .channel(`stop-arrivals-${routeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "stop_arrivals", filter: `route_id=eq.${routeId}` },
        (payload) => {
          const row = payload.new as any;
          setArrivals((prev) => ({ ...prev, [row.stop_id]: row.arrived_at }));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [routeId]);

  useEffect(() => {
    if (!vehicleId) {
      setTrail([]);
      return;
    }

    let cancelled = false;

    async function loadTrail() {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from("vehicle_location_history")
        .select("latitude, longitude, recorded_at")
        .eq("vehicle_id", vehicleId)
        .gte("recorded_at", startOfToday.toISOString())
        .order("recorded_at", { ascending: true });
      if (!cancelled) {
        setTrail((data || []).map((p: any) => [p.latitude, p.longitude] as [number, number]));
      }
    }
    loadTrail();

    const channel = supabase
      .channel(`vehicle-trail-${vehicleId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "vehicle_location_history",
          filter: `vehicle_id=eq.${vehicleId}`,
        },
        (payload) => {
          const row = payload.new as { latitude: number; longitude: number } | undefined;
          if (row) setTrail((prev) => [...prev, [row.latitude, row.longitude]]);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [vehicleId]);

  const busIsStale = busPosition
    ? Date.now() - new Date(busPosition.updated_at).getTime() > 2 * 60 * 1000
    : false;

  const geocodedStops = (stops || []).filter((s) => s.latitude != null && s.longitude != null);

  // ETA: target whichever of pickup/drop the bus hasn't reached yet today.
  const etaTargetStop =
    pickupStopId && !arrivals[pickupStopId]
      ? geocodedStops.find((s) => s.id === pickupStopId) ?? null
      : dropStopId && !arrivals[dropStopId]
      ? geocodedStops.find((s) => s.id === dropStopId) ?? null
      : null;

  const busPositionRef = useRef<BusPosition | null>(null);
  useEffect(() => { busPositionRef.current = busPosition; }, [busPosition]);

  const etaTargetStopRef = useRef(etaTargetStop);
  useEffect(() => { etaTargetStopRef.current = etaTargetStop; }, [etaTargetStop]);

  useEffect(() => {
    if (!vehicleId) {
      setEta(null);
      return;
    }
    let cancelled = false;

    async function computeEta() {
      const pos = busPositionRef.current;
      const stop = etaTargetStopRef.current;
      if (!pos || !stop || stop.latitude == null || stop.longitude == null) {
        if (!cancelled) setEta(null);
        return;
      }
      // Skip if GPS is stale — an ETA from a 10-minute-old position is misleading.
      if (Date.now() - new Date(pos.updated_at).getTime() > 5 * 60 * 1000) {
        if (!cancelled) setEta(null);
        return;
      }
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-traffic-eta`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              originLat: pos.latitude,
              originLng: pos.longitude,
              destLat: stop.latitude,
              destLng: stop.longitude,
            }),
          }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data?.success || cancelled) return;
        setEta({
          minutes: Math.max(1, Math.round(data.liveSeconds / 60)),
          distanceKm: Math.round((data.distanceMeters / 1000) * 10) / 10,
          delayMinutes: Math.round(data.delaySeconds / 60),
        });
      } catch {
        // ETA is a nice-to-have — never surface an error for it.
      }
    }

    computeEta();
    const interval = setInterval(computeEta, 45000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [vehicleId, etaTargetStop?.id]);

  // Delay Prediction: how this stop has historically run vs its scheduled
  // time. stop_arrivals only keeps one row per stop per day (upserted on
  // stop_id+arrival_date), so AM/PM isn't distinguishable in history —
  // each row is compared against whichever of pickup_time/drop_time is
  // closer to its actual time-of-day.
  useEffect(() => {
    if (!routeId || !etaTargetStop?.id) {
      setDelayPrediction(null);
      return;
    }
    let cancelled = false;

    function timeStringToMinutes(t: string): number {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    }
    function isoToLocalMinutes(iso: string): number {
      const d = new Date(iso);
      return d.getHours() * 60 + d.getMinutes();
    }

    async function loadDelayHistory() {
      const { data } = await supabase
        .from("stop_arrivals")
        .select("arrived_at")
        .eq("route_id", routeId)
        .eq("stop_id", etaTargetStop!.id)
        .order("arrival_date", { ascending: false })
        .limit(30);
      if (cancelled || !data || data.length === 0) {
        if (!cancelled) setDelayPrediction(null);
        return;
      }

      const pickupMin = etaTargetStop!.pickup_time ? timeStringToMinutes(etaTargetStop!.pickup_time) : null;
      const dropMin = etaTargetStop!.drop_time ? timeStringToMinutes(etaTargetStop!.drop_time) : null;
      if (pickupMin == null && dropMin == null) {
        setDelayPrediction(null);
        return;
      }

      const deltas: number[] = [];
      for (const row of data as { arrived_at: string }[]) {
        const actualMin = isoToLocalMinutes(row.arrived_at);
        let scheduledMin: number;
        if (pickupMin != null && dropMin != null) {
          scheduledMin =
            Math.abs(actualMin - pickupMin) <= Math.abs(actualMin - dropMin) ? pickupMin : dropMin;
        } else {
          scheduledMin = (pickupMin ?? dropMin) as number;
        }
        deltas.push(actualMin - scheduledMin);
      }

      if (deltas.length < 3) {
        setDelayPrediction(null);
        return;
      }

      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      if (!cancelled) setDelayPrediction({ avgMinutes: Math.round(avg), sampleSize: deltas.length });
    }

    loadDelayHistory();
    return () => {
      cancelled = true;
    };
  }, [routeId, etaTargetStop?.id, etaTargetStop?.pickup_time, etaTargetStop?.drop_time]);
  const straightPath: [number, number][] = geocodedStops.map((s) => [s.latitude as number, s.longitude as number]);
  const displayPath = roadPath ?? straightPath;
  const hasPath = geocodedStops.length >= 2;
  const focusStop =
    geocodedStops.find((s) => s.id === pickupStopId) ||
    geocodedStops.find((s) => s.id === dropStopId) ||
    null;
  const center: [number, number] | null = focusStop
    ? [focusStop.latitude as number, focusStop.longitude as number]
    : geocodedStops.length > 0
    ? straightPath[0]
    : null;
  const initialZoom = focusStop ? 16 : 13;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🚌 Bus Route
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-1 text-sm text-muted-foreground">
          {busNumber} · {routeName}
        </div>
        {(driverName || pickupTime) && (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {driverName && (
              <span>Driver: <span className="font-medium text-foreground">{driverName}</span></span>
            )}
            {driverPhone && (
              <span>Phone: <span className="font-medium text-foreground">{driverPhone}</span></span>
            )}
            {attendantName && (
              <span>Attendant: <span className="font-medium text-foreground">{attendantName}</span></span>
            )}
            {attendantPhone && (
              <span>Attendant Phone: <span className="font-medium text-foreground">{attendantPhone}</span></span>
            )}
            {pickupTime && (
              <span>Pickup time: <span className="font-medium text-foreground">{pickupTime}</span></span>
            )}
          </div>
        )}
        {(pickupStopId && arrivals[pickupStopId]) || (dropStopId && arrivals[dropStopId]) ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {pickupStopId && arrivals[pickupStopId] && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700">
                ✅ Bus reached pickup stop at{" "}
                {new Date(arrivals[pickupStopId]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {dropStopId && arrivals[dropStopId] && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700">
                ✅ Bus reached drop stop at{" "}
                {new Date(arrivals[dropStopId]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        ) : null}
        {vehicleId && (
          <div className="mb-2 text-xs flex flex-wrap items-center gap-2">
            {busPosition ? (
              <span className={busIsStale ? "text-amber-600" : "text-emerald-600"}>
                {busIsStale ? "⚠ Bus location may be out of date" : "● Live"} — last updated{" "}
                {new Date(busPosition.updated_at).toLocaleTimeString()}
              </span>
            ) : (
              <span className="text-muted-foreground">Waiting for driver to start sharing location...</span>
            )}
            {eta && !busIsStale && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 font-medium text-blue-700">
                🕒 ~{eta.minutes} min away ({eta.distanceKm} km)
                {eta.delayMinutes >= 2 && (
                  <span className="text-amber-600">· +{eta.delayMinutes} min traffic</span>
                )}
              </span>
            )}
            {delayPrediction && Math.abs(delayPrediction.avgMinutes) >= 2 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5 font-medium text-slate-600">
                📊 Typically {delayPrediction.avgMinutes > 0 ? "~" + delayPrediction.avgMinutes + " min late" : "~" + Math.abs(delayPrediction.avgMinutes) + " min early"} here
              </span>
            )}
          </div>
        )}
        {loading ? (
          <div className="h-[400px] flex items-center justify-center text-sm text-muted-foreground">
            Loading route...
          </div>
        ) : !routeId || geocodedStops.length === 0 ? (
          <div className="h-[400px] flex items-center justify-center text-sm text-muted-foreground text-center px-6">
            No stop locations set for this route yet. Ask your school admin to add stop addresses.
          </div>
        ) : (
          <div className="rounded-lg overflow-hidden border" style={{ height: "400px" }}>
            <MapContainer center={center as [number, number]} zoom={initialZoom} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {trail.length >= 2 && (
                <Polyline
                  positions={trail}
                  pathOptions={{ color: "#f97316", weight: 3, opacity: 0.85, dashArray: "1 8", lineCap: "round" }}
                />
              )}
              {hasPath && (
                <Polyline positions={displayPath} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.6 }} />
              )}

              {busPosition && (
                <Marker
                  position={[busPosition.latitude, busPosition.longitude]}
                  icon={busMarkerIcon}
                >
                  <Popup>
                    {busNumber} — last updated {new Date(busPosition.updated_at).toLocaleTimeString()}
                    {busIsStale && (
                      <>
                        <br />
                        <span style={{ color: "#dc2626" }}>Location may be out of date</span>
                      </>
                    )}
                  </Popup>
                </Marker>
              )}

              {geocodedStops.map((s) => {
                const isPickup = s.id === pickupStopId;
                const isDrop = s.id === dropStopId;
                const arrivedAt = arrivals[s.id];
                if (isPickup || isDrop) {
                  const color = isPickup ? "#059669" : "#dc2626";
                  return (
                    <Fragment key={s.id}>
                      <Circle
                        center={[s.latitude as number, s.longitude as number]}
                        radius={s.radius_meters ?? 200}
                        pathOptions={{
                          color,
                          fillColor: color,
                          fillOpacity: arrivedAt ? 0.22 : 0.08,
                          weight: arrivedAt ? 2 : 1,
                          dashArray: arrivedAt ? undefined : "4 4",
                        }}
                      />
                      <Marker
                        position={[s.latitude as number, s.longitude as number]}
                        icon={highlightIcon(isPickup ? "Pickup" : "Drop", color, !!arrivedAt)}
                      >
                        <Popup>
                          {s.stop_name} — {isPickup ? "Your child's pickup stop" : "Your child's drop stop"}
                          {arrivedAt && (
                            <>
                              <br />
                              <span style={{ color: "#059669" }}>
                                ✅ Bus arrived at{" "}
                                {new Date(arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </>
                          )}
                        </Popup>
                      </Marker>
                    </Fragment>
                  );
                }
                return (
                  <Marker key={s.id} position={[s.latitude as number, s.longitude as number]} icon={stopIcon}>
                    <Popup>{s.stop_name}</Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>
        )}
        {!loading && geocodedStops.length > 0 && !pickupStopId && !dropStopId && (
          <p className="text-xs text-muted-foreground mt-2">
            Pickup and drop stops haven't been assigned for this student yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
