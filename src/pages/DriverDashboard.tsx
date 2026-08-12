import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Bus, MapPin, Loader2, CheckCircle2, Navigation, AlertTriangle, FileWarning, Fuel } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog as IncidentDialog, DialogContent as IncidentDialogContent, DialogHeader as IncidentDialogHeader,
  DialogTitle as IncidentDialogTitle, DialogFooter as IncidentDialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select as IncidentSelect, SelectContent as IncidentSelectContent, SelectItem as IncidentSelectItem,
  SelectTrigger as IncidentSelectTrigger, SelectValue as IncidentSelectValue,
} from "@/components/ui/select";

// Fire-and-forget parent push alert on boarding/drop confirmation.
// Never blocks or fails the driver's UI flow.
async function sendTransportAlert(params: {
  student_id: string;
  direction: "pickup" | "drop";
  stop_name?: string;
  route_name?: string;
}) {
  try {
    await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "transport_alert", payload: params }),
      }
    );
  } catch {
    // Non-critical — swallow errors, don't surface to driver.
  }
}

// Fire-and-forget parent push alert when a student_incident is logged.
// Never blocks or fails the driver's UI flow.
async function sendIncidentAlert(params: {
  incident_id: string;
  student_id: string;
  incident_type: string;
  severity: string;
  description: string;
  route_name?: string;
}) {
  try {
    await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "student_incident_alert", payload: params }),
      }
    );
  } catch {
    // Non-critical — swallow errors, don't surface to driver.
  }
}

interface DriverRow {
  id: string;
  name: string;
  license_document_url: string | null;
  background_verification_document_url: string | null;
  medical_certificate_document_url: string | null;
}
interface GeofenceZoneRow {
  id: string;
  zone_type: "school" | "depot" | "restricted";
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
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
  latitude: number | null;
  longitude: number | null;
  radius_meters: number;
}
interface TransportAssignment {
  id: string;
  student_id: string;
  pickup_stop_id: string | null;
  drop_stop_id: string | null;
  students: { full_name: string } | null;
}

// Haversine distance in meters between two lat/lng points.
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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
  const [arrivedStopIds, setArrivedStopIds] = useState<Set<string>>(new Set());
  const [sosOpen, setSosOpen] = useState(false);
  const [sosSending, setSosSending] = useState(false);
  const [tripDirection, setTripDirection] = useState<"pickup" | "drop">("pickup");
  const [zones, setZones] = useState<GeofenceZoneRow[]>([]);
  const insideZoneIdsRef = useRef<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<TransportAssignment[]>([]);
  const [boardedStudentIds, setBoardedStudentIds] = useState<Set<string>>(new Set());
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);

  // Incident reporting state
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentSubmitting, setIncidentSubmitting] = useState(false);
  const [incidentType, setIncidentType] = useState<"accident" | "breakdown" | "student_incident">("accident");
  const [incidentSeverity, setIncidentSeverity] = useState<"low" | "medium" | "high">("low");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [incidentStudentId, setIncidentStudentId] = useState<string>("");
  const [incidentPhoto, setIncidentPhoto] = useState<File | null>(null);

  // Fuel logging state
  const [fuelOpen, setFuelOpen] = useState(false);
  const [fuelSubmitting, setFuelSubmitting] = useState(false);
  const [fuelOdometer, setFuelOdometer] = useState("");
  const [fuelLiters, setFuelLiters] = useState("");
  const [fuelCost, setFuelCost] = useState("");
  const [fuelStation, setFuelStation] = useState("");
  const [fuelNotes, setFuelNotes] = useState("");
  const [fuelReceipt, setFuelReceipt] = useState<File | null>(null);

  const arrivedStopIdsRef = useRef<Set<string>>(new Set());
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

      const { data: zoneRows } = await supabase
        .from("geofence_zones")
        .select("id, zone_type, name, latitude, longitude, radius_meters")
        .eq("school_id", profile.school_id)
        .eq("is_active", true);
      setZones((zoneRows as GeofenceZoneRow[]) ?? []);

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
          .select("id, stop_name, sequence_number, pickup_time, drop_time, latitude, longitude, radius_meters")
          .eq("route_id", routeRow.id)
          .order("sequence_number");
        setStops((stopRows as RouteStop[]) ?? []);

        const today = new Date().toISOString().slice(0, 10);
        const { data: arrivalRows } = await supabase
          .from("stop_arrivals")
          .select("stop_id")
          .eq("route_id", routeRow.id)
          .eq("arrival_date", today);
        const arrivedSet = new Set((arrivalRows ?? []).map((a: any) => a.stop_id as string));
        arrivedStopIdsRef.current = arrivedSet;
        setArrivedStopIds(arrivedSet);

        const { data: assignmentRows } = await supabase
          .from("transport_assignments")
          .select("id, student_id, pickup_stop_id, drop_stop_id, students(full_name)")
          .eq("route_id", routeRow.id);
        setAssignments((assignmentRows as any as TransportAssignment[]) ?? []);

        const today2 = new Date().toISOString().slice(0, 10);
        const { data: boardingRows } = await supabase
          .from("boarding_confirmations")
          .select("student_id, direction")
          .eq("route_id", routeRow.id)
          .eq("trip_date", today2);
        setBoardedStudentIds(
          new Set((boardingRows ?? []).map((b: any) => `${b.student_id}-${b.direction}`))
        );
      }

      setLoading(false);
    };
    load();
  }, [profile?.id]);

  const checkArrivals = async (lat: number, lng: number, vehicleId: string, driverId: string) => {
    if (!route) return;
    for (const stop of stops) {
      if (arrivedStopIdsRef.current.has(stop.id)) continue;
      if (stop.latitude == null || stop.longitude == null) continue;
      const dist = distanceMeters(lat, lng, stop.latitude, stop.longitude);
      if (dist <= (stop.radius_meters ?? 200)) {
        arrivedStopIdsRef.current.add(stop.id);
        setArrivedStopIds(new Set(arrivedStopIdsRef.current));
        const { error } = await supabase.from("stop_arrivals").upsert(
          {
            route_id: route.id,
            stop_id: stop.id,
            vehicle_id: vehicleId,
            driver_id: driverId,
            school_id: profile?.school_id,
            latitude: lat,
            longitude: lng,
          },
          { onConflict: "stop_id,arrival_date" }
        );
        if (!error) {
          toast.success(`Arrived at ${stop.stop_name}`);
        }
      }
    }
  };

  const checkGeofences = async (lat: number, lng: number, vehicleId: string, driverId: string) => {
    for (const zone of zones) {
      const dist = distanceMeters(lat, lng, zone.latitude, zone.longitude);
      const isInside = dist <= zone.radius_meters;
      const wasInside = insideZoneIdsRef.current.has(zone.id);

      if (isInside && !wasInside) {
        insideZoneIdsRef.current.add(zone.id);
        await supabase.from("geofence_events").insert({
          zone_id: zone.id,
          vehicle_id: vehicleId,
          driver_id: driverId,
          school_id: profile?.school_id,
          event_type: "enter",
          latitude: lat,
          longitude: lng,
        });
        if (zone.zone_type === "restricted") {
          toast.error(`Entered restricted area: ${zone.name}`);
          fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "restricted_zone_alert",
                payload: {
                  school_id: profile?.school_id,
                  zone_name: zone.name,
                  driver_name: driverRow?.name,
                  vehicle_id: vehicleId,
                },
              }),
            }
          ).catch(() => {
            // Non-critical — the geofence_events row is already the source of truth.
          });
        } else {
          toast.success(`Entered ${zone.name}`);
        }
      } else if (!isInside && wasInside) {
        insideZoneIdsRef.current.delete(zone.id);
        await supabase.from("geofence_events").insert({
          zone_id: zone.id,
          vehicle_id: vehicleId,
          driver_id: driverId,
          school_id: profile?.school_id,
          event_type: "exit",
          latitude: lat,
          longitude: lng,
        });
      }
    }
  };

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

    // Append-only breadcrumb log, separate from the single "current position"
    // row above — this is what powers the vehicle trail on the parent map.
    // Best-effort: a logging failure shouldn't interrupt live tracking.
    supabase.from("vehicle_location_history").insert({
      vehicle_id: vehicleId,
      driver_id: driverId,
      school_id: profile?.school_id,
      latitude: lat,
      longitude: lng,
    }).then(({ error: histError }) => {
      if (histError) console.warn("[VEHICLE TRAIL] failed to log location history", histError);
    });

    await checkArrivals(lat, lng, vehicleId, driverId);
    await checkGeofences(lat, lng, vehicleId, driverId);
  };

  const currentTripIdRef = useRef<string | null>(null);

  const getCurrentPositionSafe = (): Promise<{ lat: number | null; lng: number | null }> => {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        resolve({ lat: null, lng: null });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve({ lat: null, lng: null }),
        { timeout: 5000 }
      );
    });
  };

  const submitIncident = async () => {
    if (!driverRow) {
      toast.error("Driver profile not found.");
      return;
    }
    if (!incidentDescription.trim()) {
      toast.error("Please describe what happened.");
      return;
    }
    if (incidentType === "student_incident" && !incidentStudentId) {
      toast.error("Please select the student involved.");
      return;
    }

    setIncidentSubmitting(true);

    const { lat, lng } = await getCurrentPositionSafe();

    const { data: incidentRow, error: insertError } = await supabase
      .from("transport_incidents")
      .insert({
        school_id: profile?.school_id,
        incident_type: incidentType,
        route_id: route?.id ?? null,
        trip_id: currentTripIdRef.current,
        driver_id: driverRow.id,
        student_id: incidentType === "student_incident" ? incidentStudentId : null,
        severity: incidentSeverity,
        description: incidentDescription.trim(),
        location_lat: lat,
        location_lng: lng,
      })
      .select("id")
      .single();

    if (insertError || !incidentRow) {
      setIncidentSubmitting(false);
      toast.error("Failed to submit report: " + (insertError?.message ?? "unknown error"));
      return;
    }

    // Optional photo upload — best-effort, doesn't block the report itself
    if (incidentPhoto) {
      const filePath = `incidents/${incidentRow.id}/${Date.now()}_${incidentPhoto.name}`;
      const { error: uploadError } = await supabase.storage
        .from("transport-documents")
        .upload(filePath, incidentPhoto);

      if (uploadError) {
        console.warn("[INCIDENT] photo upload failed", uploadError);
        toast.error("Report saved, but photo upload failed: " + uploadError.message);
      } else {
        const { error: attError } = await supabase.from("transport_incident_attachments").insert({
          incident_id: incidentRow.id,
          file_path: filePath,
          uploaded_by: profile?.id,
        });
        if (attError) console.warn("[INCIDENT] attachment row insert failed", attError);
      }
    }

    // Notify parent for student incidents — fire-and-forget
    if (incidentType === "student_incident") {
      sendIncidentAlert({
        incident_id: incidentRow.id,
        student_id: incidentStudentId,
        incident_type: incidentType,
        severity: incidentSeverity,
        description: incidentDescription.trim(),
        route_name: route?.route_name,
      });
    }

    setIncidentSubmitting(false);
    setIncidentOpen(false);
    setIncidentType("accident");
    setIncidentSeverity("low");
    setIncidentDescription("");
    setIncidentStudentId("");
    setIncidentPhoto(null);
    toast.success("Incident reported.");
  };

  const submitFuelLog = async () => {
    if (!route?.vehicle_id || !driverRow) {
      toast.error("No active vehicle assigned to you yet.");
      return;
    }
    if (!fuelOdometer || !fuelLiters) {
      toast.error("Odometer and liters are required.");
      return;
    }

    setFuelSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();

    const { data: row, error: insertError } = await supabase
      .from("vehicle_fuel_logs")
      .insert({
        school_id: profile?.school_id,
        vehicle_id: route.vehicle_id,
        driver_id: driverRow.id,
        logged_by: user?.id,
        fill_date: new Date().toISOString().slice(0, 10),
        odometer_reading: Number(fuelOdometer),
        fuel_quantity_liters: Number(fuelLiters),
        cost: fuelCost ? Number(fuelCost) : null,
        fuel_station: fuelStation.trim() || null,
        notes: fuelNotes.trim() || null,
      })
      .select("id")
      .single();

    if (insertError || !row) {
      setFuelSubmitting(false);
      toast.error("Failed to save fuel log: " + (insertError?.message ?? "unknown error"));
      return;
    }

    if (fuelReceipt) {
      const filePath = `fuel-receipts/${route.vehicle_id}/${row.id}_${Date.now()}_${fuelReceipt.name}`;
      const { error: uploadError } = await supabase.storage.from("transport-documents").upload(filePath, fuelReceipt);
      if (uploadError) {
        console.warn("[FUEL] receipt upload failed", uploadError);
        toast.error("Log saved, but receipt upload failed: " + uploadError.message);
      } else {
        const { error: updateError } = await supabase
          .from("vehicle_fuel_logs")
          .update({ receipt_document_url: filePath })
          .eq("id", row.id);
        if (updateError) console.warn("[FUEL] receipt path update failed", updateError);
      }
    }

    setFuelSubmitting(false);
    setFuelOpen(false);
    setFuelOdometer("");
    setFuelLiters("");
    setFuelCost("");
    setFuelStation("");
    setFuelNotes("");
    setFuelReceipt(null);
    toast.success("Fuel log saved.");
  };

  const startTrip = async () => {
    if (!route?.vehicle_id || !driverRow) {
      toast.error("No active route/vehicle assigned to you yet.");
      return;
    }
    if (!("geolocation" in navigator)) {
      toast.error("Location isn't available on this device/browser.");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: tripRow, error: tripError } = await supabase
      .from("trips")
      .upsert(
        {
          school_id: profile?.school_id,
          route_id: route.id,
          vehicle_id: route.vehicle_id,
          driver_id: driverRow.id,
          trip_type: "recurring",
          direction: tripDirection,
          trip_date: today,
          status: "in_progress",
          started_at: new Date().toISOString(),
        },
        { onConflict: "route_id,trip_date,direction" }
      )
      .select("id")
      .single();
    if (tripError) {
      console.warn("[TRIP] failed to create/update trip record", tripError);
    } else {
      currentTripIdRef.current = tripRow?.id ?? null;
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

  const stopTrip = async () => {
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

    if (currentTripIdRef.current) {
      const { error } = await supabase
        .from("trips")
        .update({ status: "completed", ended_at: new Date().toISOString() })
        .eq("id", currentTripIdRef.current);
      if (error) console.warn("[TRIP] failed to mark trip completed", error);
      currentTripIdRef.current = null;
    }

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

  const navigateToStop = (stop: RouteStop) => {
    if (stop.latitude == null || stop.longitude == null) {
      toast.error("This stop doesn't have coordinates set yet — ask your school admin to add one.");
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${stop.latitude},${stop.longitude}&travelmode=driving`;
    window.open(url, "_blank");
  };

  const nextStop = stops.find((s) => !arrivedStopIds.has(s.id));

  const navigateFullRoute = () => {
    const remaining = stops.filter((s) => !arrivedStopIds.has(s.id));
    const targets = remaining.length > 0 ? remaining : stops;
    const withCoords = targets.filter((s) => s.latitude != null && s.longitude != null);
    if (withCoords.length === 0) {
      toast.error("None of the stops have coordinates set yet — ask your school admin to add them.");
      return;
    }
    const destination = withCoords[withCoords.length - 1];
    const waypoints = withCoords.slice(0, -1);
    let url = `https://www.google.com/maps/dir/?api=1&destination=${destination.latitude},${destination.longitude}&travelmode=driving`;
    if (waypoints.length > 0) {
      url += `&waypoints=${waypoints.map((s) => `${s.latitude},${s.longitude}`).join("|")}`;
    }
    window.open(url, "_blank");
  };

  const sendSOS = () => {
    if (!driverRow) return;
    setSosSending(true);

    const submit = (lat: number | null, lng: number | null) => {
      supabase.from("sos_alerts").insert({
        school_id: profile?.school_id,
        driver_id: driverRow.id,
        vehicle_id: route?.vehicle_id || null,
        route_id: route?.id || null,
        latitude: lat,
        longitude: lng,
      }).then(({ error }) => {
        setSosSending(false);
        setSosOpen(false);
        if (error) {
          toast.error("Failed to send SOS: " + error.message);
        } else {
          toast.success("SOS sent — school staff have been alerted.");
        }
      });
    };

    if (!("geolocation" in navigator)) {
      submit(null, null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => submit(pos.coords.latitude, pos.coords.longitude),
      // Location failing shouldn't block the alert itself — send it anyway.
      () => submit(null, null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
    );
  };

  const confirmBoarding = async (assignment: TransportAssignment, stopId: string) => {
    if (!route?.id || !driverRow) return;
    const key = `${assignment.student_id}-${tripDirection}`;
    setConfirmingKey(key);
    const { error } = await supabase.from("boarding_confirmations").insert({
      school_id: profile?.school_id,
      assignment_id: assignment.id,
      student_id: assignment.student_id,
      route_id: route.id,
      stop_id: stopId,
      direction: tripDirection,
      confirmed_by: driverRow.id,
    });
    setConfirmingKey(null);
    if (error) {
      if (!error.message.toLowerCase().includes("duplicate")) {
        toast.error("Failed to confirm boarding: " + error.message);
      }
      return;
    }
    setBoardedStudentIds((prev) => new Set(prev).add(`${assignment.student_id}-${tripDirection}`));
    const targetStop = stops.find((s) => s.id === stopId);
    const stopName = targetStop?.stop_name;
    sendTransportAlert({
      student_id: assignment.student_id,
      direction: tripDirection,
      stop_name: stopName,
      route_name: route?.route_name,
    });

    // Unauthorized-boarding check: was the bus actually near this stop
    // when the confirmation happened? A confirmation logged while the bus
    // is far away is a meaningful anomaly worth flagging to staff.
    if (targetStop?.latitude != null && targetStop?.longitude != null && route.vehicle_id) {
      const { data: posRow } = await supabase
        .from("vehicle_locations")
        .select("latitude, longitude")
        .eq("vehicle_id", route.vehicle_id)
        .maybeSingle();
      if (posRow) {
        const dist = distanceMeters(posRow.latitude, posRow.longitude, targetStop.latitude, targetStop.longitude);
        const threshold = Math.max((targetStop.radius_meters ?? 200) * 2, 500);
        if (dist > threshold) {
          fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "unauthorized_boarding_alert",
                payload: {
                  school_id: profile?.school_id,
                  student_name: assignment.students?.full_name,
                  stop_name: stopName,
                  direction: tripDirection,
                  distance_meters: dist,
                  vehicle_id: route.vehicle_id,
                },
              }),
            }
          ).catch(() => {
            // Non-critical — never block the driver's UI on push failures.
          });
        }
      }
    }
  };

  const markAllBoarded = async (stopId: string) => {
    if (!route?.id || !driverRow) return;
    const toConfirm = assignments.filter(
      (a) =>
        (tripDirection === "pickup" ? a.pickup_stop_id : a.drop_stop_id) === stopId &&
        !boardedStudentIds.has(`${a.student_id}-${tripDirection}`)
    );
    if (toConfirm.length === 0) return;
    setConfirmingKey(`stop-${stopId}`);
    const rows = toConfirm.map((a) => ({
      school_id: profile?.school_id,
      assignment_id: a.id,
      student_id: a.student_id,
      route_id: route.id,
      stop_id: stopId,
      direction: tripDirection,
      confirmed_by: driverRow.id,
    }));
    const { error } = await supabase.from("boarding_confirmations").insert(rows);
    setConfirmingKey(null);
    if (error) {
      toast.error(`Failed to mark all ${tripDirection === "drop" ? "dropped" : "boarded"}: ` + error.message);
      return;
    }
    const stopName = stops.find((s) => s.id === stopId)?.stop_name;
    toConfirm.forEach((a) =>
      sendTransportAlert({
        student_id: a.student_id,
        direction: tripDirection,
        stop_name: stopName,
        route_name: route?.route_name,
      })
    );
    setBoardedStudentIds((prev) => {
      const next = new Set(prev);
      toConfirm.forEach((a) => next.add(`${a.student_id}-${tripDirection}`));
      return next;
    });
    toast.success(`All students marked ${tripDirection === "drop" ? "dropped" : "boarded"}.`);
  };

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

        {driverRow && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              size="lg"
              className="flex-1 gap-2 text-base font-semibold h-14 min-w-[140px]"
              onClick={() => setSosOpen(true)}
            >
              <AlertTriangle className="h-5 w-5" /> SOS — Emergency Alert
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="flex-1 gap-2 text-base font-semibold h-14 min-w-[140px]"
              onClick={() => setIncidentOpen(true)}
            >
              <FileWarning className="h-5 w-5" /> Report Incident
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="flex-1 gap-2 text-base font-semibold h-14 min-w-[140px]"
              onClick={() => setFuelOpen(true)}
            >
              <Fuel className="h-5 w-5" /> Log Fuel
            </Button>
          </div>
        )}

        <Dialog open={sosOpen} onOpenChange={setSosOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" /> Send Emergency Alert?
              </DialogTitle>
              <DialogDescription>
                This immediately notifies your school's transport staff with your current location. Only use this for a genuine emergency.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setSosOpen(false)} disabled={sosSending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={sendSOS} disabled={sosSending}>
                {sosSending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Send SOS
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <IncidentDialog open={incidentOpen} onOpenChange={setIncidentOpen}>
          <IncidentDialogContent className="max-w-sm">
            <IncidentDialogHeader>
              <IncidentDialogTitle className="flex items-center gap-2">
                <FileWarning className="h-5 w-5" /> Report Incident
              </IncidentDialogTitle>
            </IncidentDialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Type</Label>
                <IncidentSelect value={incidentType} onValueChange={(v: any) => setIncidentType(v)}>
                  <IncidentSelectTrigger><IncidentSelectValue /></IncidentSelectTrigger>
                  <IncidentSelectContent>
                    <IncidentSelectItem value="accident">Accident</IncidentSelectItem>
                    <IncidentSelectItem value="breakdown">Breakdown</IncidentSelectItem>
                    <IncidentSelectItem value="student_incident">Student Incident</IncidentSelectItem>
                  </IncidentSelectContent>
                </IncidentSelect>
              </div>

              {incidentType === "student_incident" && (
                <div>
                  <Label className="text-xs">Student</Label>
                  <IncidentSelect value={incidentStudentId} onValueChange={setIncidentStudentId}>
                    <IncidentSelectTrigger><IncidentSelectValue placeholder="Select student" /></IncidentSelectTrigger>
                    <IncidentSelectContent>
                      {assignments.map((a) => (
                        <IncidentSelectItem key={a.student_id} value={a.student_id}>
                          {a.students?.full_name || "Student"}
                        </IncidentSelectItem>
                      ))}
                    </IncidentSelectContent>
                  </IncidentSelect>
                </div>
              )}

              <div>
                <Label className="text-xs">Severity</Label>
                <IncidentSelect value={incidentSeverity} onValueChange={(v: any) => setIncidentSeverity(v)}>
                  <IncidentSelectTrigger><IncidentSelectValue /></IncidentSelectTrigger>
                  <IncidentSelectContent>
                    <IncidentSelectItem value="low">Low</IncidentSelectItem>
                    <IncidentSelectItem value="medium">Medium</IncidentSelectItem>
                    <IncidentSelectItem value="high">High</IncidentSelectItem>
                  </IncidentSelectContent>
                </IncidentSelect>
              </div>

              <div>
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={incidentDescription}
                  onChange={(e) => setIncidentDescription(e.target.value)}
                  placeholder="What happened?"
                  rows={3}
                />
              </div>

              <div>
                <Label className="text-xs">Photo (optional)</Label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setIncidentPhoto(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-muted file:text-foreground"
                />
              </div>
            </div>
            <IncidentDialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setIncidentOpen(false)} disabled={incidentSubmitting}>
                Cancel
              </Button>
              <Button onClick={submitIncident} disabled={incidentSubmitting}>
                {incidentSubmitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Submit Report
              </Button>
            </IncidentDialogFooter>
          </IncidentDialogContent>
        </IncidentDialog>

        <IncidentDialog open={fuelOpen} onOpenChange={setFuelOpen}>
          <IncidentDialogContent className="max-w-sm">
            <IncidentDialogHeader>
              <IncidentDialogTitle className="flex items-center gap-2">
                <Fuel className="h-5 w-5" /> Log Fuel
              </IncidentDialogTitle>
            </IncidentDialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Odometer (km)</Label>
                <input
                  type="number"
                  value={fuelOdometer}
                  onChange={(e) => setFuelOdometer(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Liters</Label>
                <input
                  type="number"
                  value={fuelLiters}
                  onChange={(e) => setFuelLiters(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Cost (₹, optional)</Label>
                <input
                  type="number"
                  value={fuelCost}
                  onChange={(e) => setFuelCost(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Fuel Station (optional)</Label>
                <input
                  type="text"
                  value={fuelStation}
                  onChange={(e) => setFuelStation(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea rows={2} value={fuelNotes} onChange={(e) => setFuelNotes(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Receipt (optional)</Label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFuelReceipt(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-muted file:text-foreground"
                />
              </div>
            </div>
            <IncidentDialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setFuelOpen(false)} disabled={fuelSubmitting}>
                Cancel
              </Button>
              <Button onClick={submitFuelLog} disabled={fuelSubmitting}>
                {fuelSubmitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Save
              </Button>
            </IncidentDialogFooter>
          </IncidentDialogContent>
        </IncidentDialog>

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

                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Direction:</span>
                  <div className="inline-flex rounded-md border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setTripDirection("pickup")}
                      className={`px-3 py-1 text-xs font-medium ${tripDirection === "pickup" ? "bg-emerald-600 text-white" : "bg-background text-muted-foreground"}`}
                    >
                      Pickup
                    </button>
                    <button
                      type="button"
                      onClick={() => setTripDirection("drop")}
                      className={`px-3 py-1 text-xs font-medium ${tripDirection === "drop" ? "bg-emerald-600 text-white" : "bg-background text-muted-foreground"}`}
                    >
                      Drop
                    </button>
                  </div>
                </div>
                {stops.length > 0 && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Stops</p>
                    {stops.map((s, idx) => {
                      const stopStudents = assignments.filter(
                        (a) => (tripDirection === "pickup" ? a.pickup_stop_id : a.drop_stop_id) === s.id
                      );
                      const boardedCount = stopStudents.filter((a) => boardedStudentIds.has(`${a.student_id}-${tripDirection}`)).length;
                      const isExpanded = expandedStopId === s.id;
                      return (
                        <div key={s.id} className="border-b last:border-b-0 pb-2 last:pb-0">
                          <div className="flex items-center justify-between text-sm">
                            <button
                              type="button"
                              onClick={() => setExpandedStopId(isExpanded ? null : s.id)}
                              className="flex items-center text-left"
                            >
                              <span className="text-muted-foreground mr-1.5">{idx + 1}.</span>
                              {s.stop_name}
                              {arrivedStopIds.has(s.id) && (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 ml-1.5" />
                              )}
                              {stopStudents.length > 0 && (
                                <span className="ml-1.5 text-xs text-muted-foreground">
                                  ({boardedCount}/{stopStudents.length})
                                </span>
                              )}
                            </button>
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                              {s.pickup_time && `Pickup ${s.pickup_time}`}
                              {s.pickup_time && s.drop_time && " · "}
                              {s.drop_time && `Drop ${s.drop_time}`}
                              <button
                                type="button"
                                onClick={() => navigateToStop(s)}
                                className="text-blue-600 hover:text-blue-700"
                                title={`Navigate to ${s.stop_name}`}
                              >
                                <Navigation className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          </div>
                          {isExpanded && stopStudents.length > 0 && (
                            <div className="mt-2 ml-4 space-y-1.5 border-l pl-3">
                              {stopStudents.map((a) => {
                                const boarded = boardedStudentIds.has(`${a.student_id}-${tripDirection}`);
                                const key = `${a.student_id}-${tripDirection}`;
                                return (
                                  <label key={a.id} className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={boarded}
                                      disabled={boarded || confirmingKey === key}
                                      onChange={() => confirmBoarding(a, s.id)}
                                      className="h-4 w-4 rounded border-gray-300"
                                    />
                                    <span className={boarded ? "text-muted-foreground line-through" : ""}>
                                      {a.students?.full_name || "Student"}
                                    </span>
                                  </label>
                                );
                              })}
                              {boardedCount < stopStudents.length && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="mt-1 h-7 text-xs"
                                  onClick={() => markAllBoarded(s.id)}
                                  disabled={confirmingKey === `stop-${s.id}`}
                                >
                                  {tripDirection === "drop" ? "Mark all dropped" : "Mark all boarded"}
                                </Button>
                              )}
                            </div>
                          )}
                          {isExpanded && stopStudents.length === 0 && (
                            <p className="mt-2 ml-4 text-xs text-muted-foreground">
                              No students assigned to this stop for {tripDirection}.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {stops.length > 0 && (
                  <Button variant="outline" onClick={navigateFullRoute} className="gap-2">
                    <Navigation className="h-4 w-4" /> Navigate Full Route
                  </Button>
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
