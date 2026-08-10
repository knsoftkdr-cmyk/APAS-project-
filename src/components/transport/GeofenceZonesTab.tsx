import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from "react-leaflet";
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
import { toast } from "sonner";
import { MapPin, Trash2, Loader2, ShieldAlert, Building2, School as SchoolIcon, Search } from "lucide-react";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

type ZoneType = "school" | "depot" | "restricted";

interface GeofenceZone {
  id: string;
  zone_type: ZoneType;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
}

const ZONE_TYPE_CONFIG: Record<ZoneType, { label: string; color: string; icon: typeof SchoolIcon }> = {
  school: { label: "School Geofence", color: "#059669", icon: SchoolIcon },
  depot: { label: "Depot Geofence", color: "#2563eb", icon: Building2 },
  restricted: { label: "Restricted Area", color: "#dc2626", icon: ShieldAlert },
};

// Fires onPick whenever the map is clicked, so the parent can drop a marker there.
function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Smoothly pans/zooms the map whenever `center` changes (e.g. after an address search).
function RecenterMap({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.[0], center?.[1]]);
  return null;
}

// Uses OpenStreetMap's free Nominatim geocoder to turn a typed address into
// coordinates. Same "free public OSM tooling" pattern already used for OSRM
// routing elsewhere in this app — fine for admin-driven, low-volume lookups.
async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

export function GeofenceZonesTab({ schoolId }: { schoolId?: string }) {
  const [zones, setZones] = useState<GeofenceZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [zoneType, setZoneType] = useState<ZoneType>("school");
  const [name, setName] = useState("");
  const [radius, setRadius] = useState("300");
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const [addressQuery, setAddressQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const fetchZones = async () => {
    if (!schoolId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("geofence_zones")
      .select("id, zone_type, name, latitude, longitude, radius_meters, is_active")
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false });
    if (!error) setZones((data as GeofenceZone[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const resetForm = () => {
    setShowForm(false);
    setZoneType("school");
    setName("");
    setRadius("300");
    setPicked(null);
    setAddressQuery("");
  };

  const handleAddressSearch = async () => {
    if (!addressQuery.trim()) return;
    setSearching(true);
    const result = await geocodeAddress(addressQuery.trim());
    setSearching(false);
    if (!result) {
      toast.error("Address not found. Try a more specific search, or click the map directly.");
      return;
    }
    setPicked({ lat: result.lat, lng: result.lng });
  };

  const handleSave = async () => {
    if (!schoolId || !picked || !name.trim()) {
      toast.error("Pick a location on the map and enter a name.");
      return;
    }
    const radiusNum = parseInt(radius, 10);
    if (!radiusNum || radiusNum <= 0) {
      toast.error("Enter a valid radius in meters.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("geofence_zones").insert({
      school_id: schoolId,
      zone_type: zoneType,
      name: name.trim(),
      latitude: picked.lat,
      longitude: picked.lng,
      radius_meters: radiusNum,
    });
    setSaving(false);
    if (error) {
      toast.error("Failed to save zone: " + error.message);
      return;
    }
    toast.success("Geofence zone created.");
    resetForm();
    fetchZones();
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    const { error } = await supabase.from("geofence_zones").delete().eq("id", id);
    setDeletingId(null);
    if (error) {
      toast.error("Failed to delete zone: " + error.message);
      return;
    }
    setZones((prev) => prev.filter((z) => z.id !== id));
    toast.success("Zone deleted.");
  };

  const defaultCenter: [number, number] = picked
    ? [picked.lat, picked.lng]
    : zones.length > 0
    ? [zones[0].latitude, zones[0].longitude]
    : [17.385, 78.4867]; // fallback center (Hyderabad)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" /> Geofence Zones
          </CardTitle>
          <Button size="sm" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
            {showForm ? "Cancel" : "+ Add Zone"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {showForm && (
            <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Zone Type</Label>
                  <Select value={zoneType} onValueChange={(v: ZoneType) => setZoneType(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="school">School Geofence</SelectItem>
                      <SelectItem value="depot">Depot Geofence</SelectItem>
                      <SelectItem value="restricted">Restricted Area</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Campus" />
                </div>
                <div>
                  <Label className="text-xs">Radius (meters)</Label>
                  <Input type="number" value={radius} onChange={(e) => setRadius(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  value={addressQuery}
                  onChange={(e) => setAddressQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddressSearch();
                    }
                  }}
                  placeholder="Search an address, e.g. Kukatpally, Hyderabad"
                />
                <Button type="button" variant="outline" onClick={handleAddressSearch} disabled={searching}>
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Search an address above, or click on the map below to set the exact center point.
                {picked && (
                  <span className="ml-1 font-medium text-foreground">
                    Picked: {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)}
                  </span>
                )}
              </p>
              <div className="relative z-0 rounded-lg overflow-hidden border" style={{ height: "320px" }}>
                <MapContainer center={defaultCenter} zoom={13} style={{ height: "100%", width: "100%" }}>
                  <TileLayer
                    attribution='&copy; OpenStreetMap contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <ClickToPlace onPick={(lat, lng) => setPicked({ lat, lng })} />
                  <RecenterMap center={picked ? [picked.lat, picked.lng] : null} />
                  {picked && (
                    <>
                      <Marker position={[picked.lat, picked.lng]} />
                      <Circle
                        center={[picked.lat, picked.lng]}
                        radius={parseInt(radius, 10) || 0}
                        pathOptions={{ color: ZONE_TYPE_CONFIG[zoneType].color, fillOpacity: 0.15 }}
                      />
                    </>
                  )}
                </MapContainer>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={resetForm} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  Save Zone
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading zones...
            </p>
          ) : zones.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No geofence zones set up yet. Add a School, Depot, or Restricted Area zone above.
            </p>
          ) : (
            <div className="space-y-2">
              {zones.map((z) => {
                const config = ZONE_TYPE_CONFIG[z.zone_type];
                const Icon = config.icon;
                return (
                  <div key={z.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="rounded-full p-2"
                        style={{ backgroundColor: `${config.color}1a`, color: config.color }}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{z.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {config.label} · {z.radius_meters}m radius
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(z.id)}
                      disabled={deletingId === z.id}
                    >
                      {deletingId === z.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 text-red-500" />
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
