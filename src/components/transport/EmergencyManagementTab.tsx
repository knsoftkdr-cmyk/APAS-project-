import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2, Siren, MapPin, History, PhoneCall, Trash2, Plus, CheckCircle2,
} from "lucide-react";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const busMarkerIcon = new L.DivIcon({
  html: `<div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#f97316;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);font-size:16px;transform:translate(-50%,-50%);">🚌</div>`,
  className: "",
  iconSize: [0, 0],
});

interface SosAlertRow {
  id: string;
  driver_id: string;
  vehicle_id: string;
  route_id: string;
  latitude: number | null;
  longitude: number | null;
  message: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  drivers: { name: string } | null;
  vehicles: { registration_number: string } | null;
  transport_routes: { route_name: string } | null;
}

interface StudentContactRow {
  id: string;
  full_name: string;
  class: string | null;
  section: string | null;
}

interface EmergencyContactRow {
  id: string;
  student_id: string;
  full_name: string;
  relation: string;
  phone: string;
  alternate_phone: string | null;
  address: string | null;
  priority_order: number;
  pickup_authorized: boolean;
}

interface SchoolContactRow {
  id: string;
  category: string;
  name: string;
  phone: string;
  notes: string | null;
}

interface VehicleRow {
  id: string;
  registration_number: string;
}

interface VehiclePosition {
  latitude: number;
  longitude: number;
  updated_at: string;
}

const CONTACT_CATEGORIES = ["Police", "Hospital", "Fire", "Ambulance", "Other"];

function useSosAlerts(schoolId?: string, onlyActive?: boolean) {
  const [alerts, setAlerts] = useState<SosAlertRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = async () => {
    if (!schoolId) return;
    setLoading(true);
    let query = supabase
      .from("sos_alerts")
      .select(
        "id, driver_id, vehicle_id, route_id, latitude, longitude, message, status, created_at, resolved_at, drivers(name), vehicles(registration_number), transport_routes(route_name)"
      )
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (onlyActive) query = query.eq("status", "active");
    const { data, error } = await query;
    if (!error) setAlerts((data as any as SosAlertRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchAlerts();
    const channel = supabase
      .channel(`sos-alerts-${onlyActive ? "active" : "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts", filter: `school_id=eq.${schoolId}` }, () => fetchAlerts())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, onlyActive]);

  return { alerts, loading, refetch: fetchAlerts };
}

function useFleetLocations(schoolId?: string) {
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [positions, setPositions] = useState<Record<string, VehiclePosition>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data: vehicleRows, error: vehicleError } = await supabase
        .from("vehicles")
        .select("id, registration_number")
        .eq("school_id", schoolId);

      if (cancelled) return;
      if (vehicleError || !vehicleRows) {
        setVehicles([]);
        setPositions({});
        setLoading(false);
        return;
      }
      setVehicles(vehicleRows as VehicleRow[]);

      const ids = (vehicleRows as VehicleRow[]).map((v) => v.id);
      if (ids.length === 0) {
        setPositions({});
        setLoading(false);
        return;
      }

      const { data: locRows, error: locError } = await supabase
        .from("vehicle_locations")
        .select("vehicle_id, latitude, longitude, updated_at")
        .in("vehicle_id", ids);

      if (cancelled) return;
      if (!locError && locRows) {
        const map: Record<string, VehiclePosition> = {};
        (locRows as any[]).forEach((r) => {
          map[r.vehicle_id] = { latitude: r.latitude, longitude: r.longitude, updated_at: r.updated_at };
        });
        setPositions(map);
      }
      setLoading(false);
    }
    load();

    const channel = supabase
      .channel(`fleet-locations-${schoolId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicle_locations" },
        (payload) => {
          const row = payload.new as any;
          if (!row?.vehicle_id) return;
          setPositions((prev) => ({
            ...prev,
            [row.vehicle_id]: { latitude: row.latitude, longitude: row.longitude, updated_at: row.updated_at },
          }));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  return { vehicles, positions, loading };
}

function ActiveAlertsList({ schoolId }: { schoolId?: string }) {
  const { alerts, loading, refetch } = useSosAlerts(schoolId, true);

  const markResolved = async (id: string) => {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("sos_alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: userData.user?.id })
      .eq("id", id);
    if (error) {
      toast.error("Could not resolve alert");
    } else {
      toast.success("Alert marked resolved");
      refetch();
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>;
  }
  if (alerts.length === 0) {
    return <p className="text-sm text-muted-foreground">No active SOS/panic alerts.</p>;
  }
  return (
    <div className="space-y-1.5">
      {alerts.map((a) => (
        <div key={a.id} className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Siren className="h-4 w-4 text-red-600 shrink-0 animate-pulse" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{a.drivers?.name || "Driver"} · {a.vehicles?.registration_number || "Vehicle"}</p>
              <p className="text-xs text-muted-foreground truncate">
                {a.transport_routes?.route_name || "Route"} · {new Date(a.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {a.latitude && a.longitude && (
                  <> · <a className="underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`}>view location</a></>
                )}
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => markResolved(a.id)}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark Resolved
          </Button>
        </div>
      ))}
    </div>
  );
}

function LiveFleetMap({ schoolId }: { schoolId?: string }) {
  const { vehicles, positions, loading } = useFleetLocations(schoolId);
  const { alerts } = useSosAlerts(schoolId, true);
  const alertPositions = alerts.filter((a) => a.latitude != null && a.longitude != null);

  const busPositions = vehicles
    .map((v) => ({ vehicle: v, pos: positions[v.id] }))
    .filter((x): x is { vehicle: VehicleRow; pos: VehiclePosition } => !!x.pos);

  const center: [number, number] = busPositions.length > 0
    ? [busPositions[0].pos.latitude, busPositions[0].pos.longitude]
    : alertPositions.length > 0
    ? [alertPositions[0].latitude as number, alertPositions[0].longitude as number]
    : [17.385, 78.4867];

  if (loading) {
    return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>;
  }

  return (
    <div className="space-y-2">
      {busPositions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No buses are currently sharing live location.</p>
      ) : null}
      <div className="rounded-lg overflow-hidden border" style={{ height: 400 }}>
        <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors'
          />
          {busPositions.map(({ vehicle, pos }) => {
            const isStale = Date.now() - new Date(pos.updated_at).getTime() > 2 * 60 * 1000;
            return (
              <Marker key={vehicle.id} position={[pos.latitude, pos.longitude]} icon={busMarkerIcon}>
                <Popup>
                  <div className="text-sm">
                    <p className="font-medium">🚌 {vehicle.registration_number}</p>
                    <p className={`text-xs ${isStale ? "text-amber-600" : "text-muted-foreground"}`}>
                      {isStale ? "May be out of date" : "Live"} — {new Date(pos.updated_at).toLocaleTimeString()}
                    </p>
                  </div>
                </Popup>
              </Marker>
            );
          })}
          {alertPositions.map((a) => (
            <Marker key={a.id} position={[a.latitude as number, a.longitude as number]}>
              <Popup>
                <div className="text-sm">
                  <p className="font-medium text-red-600">🚨 SOS: {a.drivers?.name || "Driver"}</p>
                  <p>{a.vehicles?.registration_number || "Vehicle"}</p>
                  <p className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

function IncidentLog({ schoolId }: { schoolId?: string }) {
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "resolved">("all");
  const { alerts, loading } = useSosAlerts(schoolId, false);
  const filtered = statusFilter === "all" ? alerts : alerts.filter((a) => a.status === statusFilter);

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Status</Label>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No incidents match this filter.</p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border p-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <Siren className={`h-4 w-4 shrink-0 ${a.status === "active" ? "text-red-600" : "text-muted-foreground"}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{a.drivers?.name || "Driver"} · {a.vehicles?.registration_number || "Vehicle"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {a.transport_routes?.route_name || "Route"} · reported {new Date(a.created_at).toLocaleString()}
                    {a.resolved_at && <> · resolved {new Date(a.resolved_at).toLocaleString()}</>}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className={a.status === "active" ? "text-red-700 border-red-200 bg-red-50 shrink-0" : "text-emerald-700 border-emerald-200 bg-emerald-50 shrink-0"}>
                {a.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SchoolContactsSection({ schoolId }: { schoolId?: string }) {
  const [contacts, setContacts] = useState<SchoolContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState(CONTACT_CATEGORIES[0]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchContacts = async () => {
    if (!schoolId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("school_emergency_contacts")
      .select("id, category, name, phone, notes")
      .eq("school_id", schoolId)
      .order("category", { ascending: true });
    if (!error) setContacts((data as any as SchoolContactRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const addContact = async () => {
    if (!schoolId || !name.trim() || !phone.trim()) {
      toast.error("Name and phone are required");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("school_emergency_contacts").insert({
      school_id: schoolId, category, name: name.trim(), phone: phone.trim(), notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error("Could not add contact");
    } else {
      toast.success("Contact added");
      setName(""); setPhone(""); setNotes("");
      fetchContacts();
    }
  };

  const deleteContact = async (id: string) => {
    const { error } = await supabase.from("school_emergency_contacts").delete().eq("id", id);
    if (error) {
      toast.error("Could not delete contact");
    } else {
      fetchContacts();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <Label className="text-xs">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONTACT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nearest Police Station" className="w-[200px]" />
        </div>
        <div>
          <Label className="text-xs">Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" className="w-[160px]" />
        </div>
        <div>
          <Label className="text-xs">Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="w-[180px]" />
        </div>
        <Button size="sm" className="gap-1.5" disabled={saving} onClick={addContact}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No school emergency contacts added yet.</p>
      ) : (
        <div className="space-y-1.5">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border p-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{c.name} <span className="text-xs text-muted-foreground">({c.category})</span></p>
                <p className="text-xs text-muted-foreground truncate">{c.phone}{c.notes ? ` · ${c.notes}` : ""}</p>
              </div>
              <Button size="icon" variant="ghost" className="shrink-0" onClick={() => deleteContact(c.id)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StudentContactsSection({ schoolId }: { schoolId?: string }) {
  const [students, setStudents] = useState<StudentContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [contacts, setContacts] = useState<EmergencyContactRow[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;

    async function loadStudents() {
      setLoading(true);
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, class, section")
        .eq("school_id", schoolId)
        .order("class", { ascending: true })
        .order("section", { ascending: true })
        .order("full_name", { ascending: true });
      if (!cancelled) {
        if (!error) setStudents((data as any as StudentContactRow[]) ?? []);
        setLoading(false);
      }
    }
    loadStudents();
    return () => { cancelled = true; };
  }, [schoolId]);

  useEffect(() => {
    if (!selectedId) {
      setContacts([]);
      return;
    }
    let cancelled = false;

    async function loadContacts() {
      setContactsLoading(true);
      const { data, error } = await supabase
        .from("emergency_contacts")
        .select("*")
        .eq("student_id", selectedId)
        .order("priority_order", { ascending: true });
      if (!cancelled) {
        if (!error) setContacts((data as any as EmergencyContactRow[]) ?? []);
        setContactsLoading(false);
      }
    }
    loadContacts();
    return () => { cancelled = true; };
  }, [selectedId]);

  const classes = Array.from(new Set(students.map((s) => s.class).filter((c): c is string => !!c)));

  const sections = Array.from(
    new Set(
      students
        .filter((s) => !selectedClass || s.class === selectedClass)
        .map((s) => s.section)
        .filter((sec): sec is string => !!sec)
    )
  );

  const filteredStudents = students.filter(
    (s) => (!selectedClass || s.class === selectedClass) && (!selectedSection || s.section === selectedSection)
  );

  const selectedStudent = students.find((s) => s.id === selectedId) || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <Label className="text-xs">Class</Label>
          <Select
            value={selectedClass}
            onValueChange={(v) => { setSelectedClass(v); setSelectedSection(""); setSelectedId(""); }}
          >
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="All classes" /></SelectTrigger>
            <SelectContent>
              {classes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Section</Label>
          <Select
            value={selectedSection}
            onValueChange={(v) => { setSelectedSection(v); setSelectedId(""); }}
          >
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="All sections" /></SelectTrigger>
            <SelectContent>
              {sections.map((sec) => <SelectItem key={sec} value={sec}>{sec}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Student</Label>
          {loading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
          ) : (
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Choose a student" /></SelectTrigger>
              <SelectContent>
                {filteredStudents.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {selectedStudent ? (
        contactsLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading contacts...</p>
        ) : contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No emergency contacts added for {selectedStudent.full_name} yet.</p>
        ) : (
          <div className="space-y-1.5">
            {contacts.map((c) => (
              <div key={c.id} className="rounded-lg border p-2.5">
                <p className="text-sm font-medium">
                  {c.full_name} <span className="text-xs text-muted-foreground capitalize">({c.relation})</span>
                  {c.pickup_authorized && (
                    <Badge variant="outline" className="ml-2 text-emerald-700 border-emerald-200 bg-emerald-50">Pickup authorized</Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Phone: {c.phone}
                  {c.alternate_phone && <> · Alt: {c.alternate_phone}</>}
                  {c.address && <><br />{c.address}</>}
                </p>
              </div>
            ))}
          </div>
        )
      ) : !loading && students.length === 0 ? (
        <p className="text-sm text-muted-foreground">No students found.</p>
      ) : !loading ? (
        <p className="text-sm text-muted-foreground">Select a student to view their emergency contact details.</p>
      ) : null}
    </div>
  );
}

function EmergencyContacts({ schoolId }: { schoolId?: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-2">School Emergency Contacts</h3>
        <SchoolContactsSection schoolId={schoolId} />
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">Student Emergency Contacts</h3>
        <StudentContactsSection schoolId={schoolId} />
      </div>
    </div>
  );
}

export function EmergencyManagementTab({ schoolId }: { schoolId?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Siren className="h-5 w-5" /> Emergency Management
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="alerts" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 max-w-2xl">
            <TabsTrigger value="alerts" className="gap-1.5"><Siren className="h-4 w-4" /> Active Alerts</TabsTrigger>
            <TabsTrigger value="map" className="gap-1.5"><MapPin className="h-4 w-4" /> Live Map</TabsTrigger>
            <TabsTrigger value="log" className="gap-1.5"><History className="h-4 w-4" /> Incident Log</TabsTrigger>
            <TabsTrigger value="contacts" className="gap-1.5"><PhoneCall className="h-4 w-4" /> Contacts</TabsTrigger>
          </TabsList>
          <TabsContent value="alerts"><ActiveAlertsList schoolId={schoolId} /></TabsContent>
          <TabsContent value="map"><LiveFleetMap schoolId={schoolId} /></TabsContent>
          <TabsContent value="log"><IncidentLog schoolId={schoolId} /></TabsContent>
          <TabsContent value="contacts"><EmergencyContacts schoolId={schoolId} /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
