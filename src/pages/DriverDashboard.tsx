import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bus, MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface DriverRow {
  id: string;
  name: string;
  license_document_url: string | null;
  background_verification_document_url: string | null;
  medical_certificate_document_url: string | null;
}

interface AssignedRoute {
  id: string;
  route_name: string;
  vehicle_id: string | null;
  vehicles: {
    registration_number: string;
    insurance_document_url: string | null;
    fitness_document_url: string | null;
    puc_document_url: string | null;
    rc_document_url: string | null;
  } | null;
}

interface RouteStop {
  id: string;
  stop_name: string;
  sequence_number: number;
  pickup_time: string | null;
  drop_time: string | null;
}

export default function DriverDashboard() {
  const { profile } = useAuth();
  const [driverRow, setDriverRow] = useState<DriverRow | null>(null);
  const [route, setRoute] = useState<AssignedRoute | null>(null);
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("");

  const watchIdRef = useRef<number | null>(null);
  const intervalIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<number>(0);

  useEffect(() => {
    const load = async () => {
      if (!profile?.id) return;
      const { data: driver } = await supabase
        .from("drivers")
        .select("id, name, license_document_url, background_verification_document_url, medical_certificate_document_url")
        .eq("profile_id", profile.id)
        .maybeSingle();

      if (!driver) {
        setLoading(false);
        return;
      }
      setDriverRow(driver as DriverRow);

      const { data: routeRow } = await supabase
        .from("transport_routes")
        .select("id, route_name, vehicle_id, vehicles(registration_number, insurance_document_url, fitness_document_url, puc_document_url, rc_document_url)")
        .eq("driver_id", driver.id)
        .eq("status", "active")
        .maybeSingle();

      setRoute((routeRow as any) ?? null);

      if (routeRow?.id) {
        const { data: stopRows } = await supabase
          .from("route_stops")
          .select("id, stop_name, sequence_number, pickup_time, drop_time")
          .eq("route_id", routeRow.id)
          .order("sequence_number");
        setStops((stopRows as RouteStop[]) ?? []);
      }

      setLoading(false);
    };
    load();
  }, [profile?.id]);

  const sendLocation = async (lat: number, lng: number, vehicleId: string, driverId: string) => {
    const { error } = await supabase.from("vehicle_locations").upsert({
      vehicle_id: vehicleId,
      driver_id: driverId,
      latitude: lat,
      longitude: lng,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      setStatusMsg(`Error sending location: ${error.message}`);
    } else {
      setLastUpdate(new Date());
      setStatusMsg("Sharing live location...");
    }
  };

  const startTrip = () => {
    if (!route?.vehicle_id || !driverRow) {
      toast.error("No active route/vehicle assigned to you yet.");
      return;
    }
    if (!("geolocation" in navigator)) {
      toast.error("Location isn't available on this device/browser.");
      return;
    }

    setStatusMsg("Requesting location permission...");

    // Fast path: fires on real movement
    const id = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastSentRef.current < 5000) return;
        lastSentRef.current = now;
        await sendLocation(pos.coords.latitude, pos.coords.longitude, route.vehicle_id!, driverRow.id);
      },
      (err) => {
        setStatusMsg(`Location error: ${err.message}`);
        toast.error("Couldn't get your location — check permissions.");
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 10000 }
    );
    watchIdRef.current = id;

    // Fallback: forces a fresh fix every 15s even if the device
    // hasn't "moved" enough to trigger watchPosition on its own
    console.log(`[LOC DEBUG] interval registered at ${new Date().toISOString()}`);
    const intervalId = window.setInterval(() => {
      console.log(`[LOC DEBUG] interval FIRED at ${new Date().toISOString()}`);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          console.log(`[LOC DEBUG] getCurrentPosition SUCCESS at ${new Date().toISOString()}`);
          lastSentRef.current = Date.now();
          await sendLocation(pos.coords.latitude, pos.coords.longitude, route.vehicle_id!, driverRow.id);
        },
        (err) => {
          console.log(`[LOC DEBUG] getCurrentPosition ERROR at ${new Date().toISOString()}: ${err.message} (code ${err.code})`);
          setStatusMsg(`Location error: ${err.message}`);
        },
        { enableHighAccuracy: false, maximumAge: 25000, timeout: 15000 }
      );
    }, 15000);
    intervalIdRef.current = intervalId;

    setSharing(true);
    toast.success("Trip started — sharing live location");
  };

  const stopTrip = () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (intervalIdRef.current != null) {
      window.clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
    setSharing(false);
    setStatusMsg("Stopped sharing location.");
    toast.success("Trip stopped");
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (intervalIdRef.current != null) {
        window.clearInterval(intervalIdRef.current);
      }
    };
  }, []);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-700 p-8">
          <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <div className="rounded-xl bg-white/15 p-3">
              <Bus className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">
                Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}
              </h1>
              <p className="text-emerald-50/90 mt-1">Driver tracking dashboard</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" /> Live Location Sharing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your assignment...
              </p>
            ) : !route ? (
              <p className="text-sm text-muted-foreground">
                You don't have an active route assigned yet. Ask your school admin to assign you to a route.
              </p>
            ) : (
              <>
                <div className="text-sm text-muted-foreground">
                  Route: <span className="font-medium text-foreground">{route.route_name}</span>
                  {route.vehicles?.registration_number && (
                    <> · Vehicle: <span className="font-medium text-foreground">{route.vehicles.registration_number}</span></>
                  )}
                </div>

                {stops.length > 0 && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Stops</p>
                    {stops.map((s, idx) => (
                      <div key={s.id} className="flex items-center justify-between text-sm border-b last:border-b-0 pb-2 last:pb-0">
                        <span>
                          <span className="text-muted-foreground mr-1.5">{idx + 1}.</span>
                          {s.stop_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {s.pickup_time && `Pickup ${s.pickup_time}`}
                          {s.pickup_time && s.drop_time && " · "}
                          {s.drop_time && `Drop ${s.drop_time}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {!sharing ? (
                  <Button onClick={startTrip} className="gap-2">
                    <MapPin className="h-4 w-4" /> Start Trip
                  </Button>
                ) : (
                  <Button onClick={stopTrip} variant="destructive" className="gap-2">
                    Stop Trip
                  </Button>
                )}

                {statusMsg && (
                  <p className="text-xs text-muted-foreground">
                    {statusMsg}
                    {lastUpdate && ` (last sent ${lastUpdate.toLocaleTimeString()})`}
                  </p>
                )}

                <p className="text-xs text-muted-foreground border-t pt-3">
                  Keep this page open and your screen unlocked while driving — location sharing pauses if the browser tab is backgrounded or the phone is locked.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
