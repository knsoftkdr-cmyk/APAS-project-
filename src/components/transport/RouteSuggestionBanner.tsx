import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup } from "react-leaflet";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Navigation, Loader2, X, Check } from "lucide-react";
import { toast } from "sonner";

interface SuggestionRow {
  id: string;
  route_id: string;
  dest_stop_name: string | null;
  dest_lat: number;
  dest_lng: number;
  origin_lat: number;
  origin_lng: number;
  live_seconds: number | null;
  baseline_live_seconds: number | null;
  geometry: [number, number][] | null;
  status: string;
}

// Polls for a pending admin-suggested alternate route for this driver.
// On accept, renders a simple road-path map (separate from BusTrackingMap,
// which is built around the fixed multi-stop route, not an ad-hoc alternate
// path to a single destination).
export function RouteSuggestionBanner({ driverId }: { driverId: string }) {
  const [suggestion, setSuggestion] = useState<SuggestionRow | null>(null);
  const [responding, setResponding] = useState(false);
  const [accepted, setAccepted] = useState<SuggestionRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const { data, error } = await supabase
        .from("transport_route_suggestions")
        .select(
          "id, route_id, dest_stop_name, dest_lat, dest_lng, origin_lat, origin_lng, live_seconds, baseline_live_seconds, geometry, status"
        )
        .eq("driver_id", driverId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && !error) setSuggestion(data as SuggestionRow | null);
    }
    poll();
    const interval = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [driverId]);

  async function respond(status: "accepted" | "declined") {
    if (!suggestion) return;
    setResponding(true);
    try {
      const { error } = await supabase
        .from("transport_route_suggestions")
        .update({ status, responded_at: new Date().toISOString() })
        .eq("id", suggestion.id);
      if (error) throw error;
      if (status === "accepted") {
        setAccepted(suggestion);
        toast.success("Alternate route accepted — follow the path below");
      } else {
        toast("Suggestion declined");
      }
      setSuggestion(null);
    } catch (e: any) {
      toast.error(e.message || "Failed to respond to suggestion");
    } finally {
      setResponding(false);
    }
  }

  if (!suggestion && !accepted) return null;

  const savedMinutes =
    suggestion?.baseline_live_seconds != null && suggestion?.live_seconds != null
      ? Math.round((suggestion.baseline_live_seconds - suggestion.live_seconds) / 60)
      : null;

  return (
    <div className="space-y-3">
      {suggestion && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-blue-900">
              <Navigation className="h-4 w-4" /> Dispatch Suggests an Alternate Route
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-blue-900">
              To {suggestion.dest_stop_name || "your next stop"}
              {savedMinutes != null && savedMinutes > 0 ? ` — saves ~${savedMinutes} min` : ""}.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => respond("accepted")} disabled={responding} className="gap-1.5">
                {responding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => respond("declined")}
                disabled={responding}
                className="gap-1.5"
              >
                <X className="h-4 w-4" /> Decline
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {accepted && accepted.geometry && accepted.geometry.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Navigation className="h-4 w-4" /> Following Alternate Route
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 rounded-lg overflow-hidden border">
              <MapContainer
                center={accepted.geometry[Math.floor(accepted.geometry.length / 2)]}
                zoom={13}
                style={{ height: "100%", width: "100%" }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap contributors'
                />
                <Polyline positions={accepted.geometry} pathOptions={{ color: "#2563eb", weight: 4 }} />
                <Marker position={[accepted.origin_lat, accepted.origin_lng]}>
                  <Popup>Start</Popup>
                </Marker>
                <Marker position={[accepted.dest_lat, accepted.dest_lng]}>
                  <Popup>{accepted.dest_stop_name || "Destination"}</Popup>
                </Marker>
              </MapContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
