import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
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

function highlightIcon(label: string, color: string) {
  return new L.DivIcon({
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">
             <div style="background:${color};color:white;font-size:10px;font-weight:600;padding:2px 6px;border-radius:6px;white-space:nowrap;margin-bottom:2px;">${label}</div>
             <div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;"></div>
           </div>`,
    className: "",
    iconSize: [0, 0],
  });
}

interface StopRow {
  id: string;
  stop_name: string;
  sequence_number: number;
  latitude: number | null;
  longitude: number | null;
}

interface BusTrackingMapProps {
  routeId?: string | null;
  pickupStopId?: string | null;
  dropStopId?: string | null;
  busNumber?: string;
  routeName?: string;
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

export function BusTrackingMap({ routeId, pickupStopId, dropStopId, busNumber = "Bus", routeName = "Route" }: BusTrackingMapProps) {
  const [stops, setStops] = useState<StopRow[] | null>(null);
  const [roadPath, setRoadPath] = useState<[number, number][] | null>(null);
  const [loading, setLoading] = useState(true);

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
        .select("id, stop_name, sequence_number, latitude, longitude")
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

  const geocodedStops = (stops || []).filter((s) => s.latitude != null && s.longitude != null);
  const straightPath: [number, number][] = geocodedStops.map((s) => [s.latitude as number, s.longitude as number]);
  const displayPath = roadPath ?? straightPath;
  const hasPath = geocodedStops.length >= 2;
  const center: [number, number] | null = geocodedStops.length > 0 ? straightPath[0] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🚌 Bus Route
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 text-sm text-muted-foreground">
          {busNumber} · {routeName}
        </div>
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
            <MapContainer center={center as [number, number]} zoom={13} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {hasPath && (
                <Polyline positions={displayPath} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.6 }} />
              )}

              {geocodedStops.map((s) => {
                const isPickup = s.id === pickupStopId;
                const isDrop = s.id === dropStopId;
                if (isPickup || isDrop) {
                  return (
                    <Marker
                      key={s.id}
                      position={[s.latitude as number, s.longitude as number]}
                      icon={highlightIcon(isPickup ? "Pickup" : "Drop", isPickup ? "#059669" : "#dc2626")}
                    >
                      <Popup>{s.stop_name} — {isPickup ? "Your child's pickup stop" : "Your child's drop stop"}</Popup>
                    </Marker>
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
