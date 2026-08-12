import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { SosAlertBanner } from "@/components/transport/SosAlertBanner";
import { GeofenceZonesTab } from "@/components/transport/GeofenceZonesTab";
import { MultiRoutePlanner } from "@/components/transport/MultiRoutePlanner";
import { TripsTab } from "@/components/transport/TripsTab";
import { IncidentManagementTab } from "@/components/transport/IncidentManagementTab";
import { VehicleMaintenanceTab } from "@/components/transport/VehicleMaintenanceTab";
import { FuelManagementTab } from "@/components/transport/FuelManagementTab";
import { BoardingDropManagementTab } from "@/components/transport/BoardingDropManagementTab";
import { EmergencyManagementTab } from "@/components/transport/EmergencyManagementTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Bus,
  UserRound,
  UserCheck,
  Route as RouteIcon,
  Users,
  Plus,
  Pencil,
  Trash2,
  MapPin,
  ArrowUp,
  ArrowDown,
  Loader2,
  Upload,
  ExternalLink,
  LayoutTemplate,
  BookmarkPlus,
  Copy,
  History,
  Wand2,
  MapPinned,
  Siren,
  ClipboardList
} from "lucide-react";
import { toast } from "sonner";

// ============================================================
// TYPES
// ============================================================
interface Vehicle {
  id: string;
  school_id: string;
  registration_number: string;
  vehicle_type: string;
  capacity: number | null;
  insurance_expiry: string | null;
  fitness_expiry: string | null;
  permit_expiry: string | null;
  status: string;
  fuel_type: string | null;
  mileage_kmpl: number | null;
  chassis_number: string | null;
  engine_number: string | null;
  gps_device_id: string | null;
  insurance_number: string | null;
  insurance_document_url: string | null;
  fitness_certificate_number: string | null;
  fitness_document_url: string | null;
  puc_number: string | null;
  puc_expiry: string | null;
  puc_document_url: string | null;
  rc_owner_name: string | null;
  rc_registration_date: string | null;
  rc_document_url: string | null;
}

interface Driver {
  id: string;
  school_id: string;
  name: string;
  phone: string | null;
  license_number: string | null;
  license_expiry: string | null;
  address: string | null;
  status: string;
  profile_id: string | null;
  photo_url: string | null;
  license_document_url: string | null;
  license_verification_status: string | null;
  background_verification_status: string | null;
  background_verification_document_url: string | null;
  medical_certificate_number: string | null;
  medical_certificate_expiry: string | null;
  medical_certificate_document_url: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
}

interface Attendant {
  id: string;
  school_id: string;
  name: string;
  phone: string | null;
  certificate_number: string | null;
  certificate_expiry: string | null;
  certificate_document_url: string | null;
  status: string;
}

interface RouteStop {
  id?: string;
  route_id?: string;
  stop_name: string;
  sequence_number: number;
  pickup_time: string | null;
  drop_time: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radius_meters?: number;
}

function useDebouncedAddressSearch(query: string) {
  const [results, setResults] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`
        );
        const data = await res.json();
        setResults(data || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [query]);

  return { results, loading };
}

function StopAddressSearch({
  onSelect,
  hasCoords,
}: {
  onSelect: (lat: number, lng: number, address: string) => void;
  hasCoords: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const { results, loading } = useDebouncedAddressSearch(query);

  return (
    <div className="relative w-48 shrink-0">
      <Input
        placeholder={hasCoords ? "Location set" : "Search address..."}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
        onFocus={() => setShowResults(true)}
        className={hasCoords ? "border-emerald-400 pr-7" : ""}
      />
      {loading && (
        <Loader2 className="absolute right-2 top-2.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}
      {showResults && results.length > 0 && (
        <div className="absolute z-20 w-72 mt-1 rounded-lg border bg-popover shadow-md max-h-48 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-muted text-xs"
              onClick={() => {
                onSelect(parseFloat(r.lat), parseFloat(r.lon), r.display_name);
                setQuery(r.display_name.split(",")[0]);
                setShowResults(false);
              }}
            >
              {r.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface TransportRoute {
  id: string;
  school_id: string;
  route_name: string;
  route_number: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  attendant_id: string | null;
  status: string;
  days_of_week: number[];
  route_stops: RouteStop[];
}

interface RouteTemplateStop {
  id?: string;
  stop_name: string;
  sequence_number: number;
  pickup_time: string | null;
  drop_time: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface RouteTemplate {
  id: string;
  school_id: string;
  template_name: string;
  description: string | null;
  route_template_stops: RouteTemplateStop[];
}

interface RouteVersion {
  id: string;
  route_id: string;
  version_number: number;
  route_name: string;
  route_number: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  attendant_id: string | null;
  status: string | null;
  days_of_week: number[];
  stops_snapshot: RouteTemplateStop[];
  changed_by: string | null;
  changed_by_name: string | null;
  created_at: string;
}

interface StudentLite {
  id: string;
  full_name: string;
  class: string | null;
}

interface Assignment {
  id: string;
  school_id: string;
  student_id: string;
  route_id: string | null;
  pickup_stop_id: string | null;
  drop_stop_id: string | null;
  transport_fee: number | null;
  fee_status: string | null;
  status: string | null;
  seat_number: number | null;
  students?: StudentLite;
}

const EMPTY_VEHICLE = {
  registration_number: "", vehicle_type: "bus", capacity: "",
  insurance_expiry: "", fitness_expiry: "", permit_expiry: "", status: "active",
  fuel_type: "diesel", mileage_kmpl: "", chassis_number: "", engine_number: "", gps_device_id: "",
  insurance_number: "", insurance_document_url: "",
  fitness_certificate_number: "", fitness_document_url: "",
  puc_number: "", puc_expiry: "", puc_document_url: "",
  rc_owner_name: "", rc_registration_date: "", rc_document_url: "",
};

const EMPTY_DRIVER = {
  name: "", phone: "", license_number: "", license_expiry: "", address: "", status: "active",
  email: "", password: "",
  photo_url: "", license_document_url: "",
  license_verification_status: "pending", background_verification_status: "pending",
  background_verification_document_url: "",
  medical_certificate_number: "", medical_certificate_expiry: "", medical_certificate_document_url: "",
  emergency_contact_name: "", emergency_contact_phone: "", emergency_contact_relation: "",
};
const EMPTY_ATTENDANT = {
  name: "", phone: "", certificate_number: "", certificate_expiry: "",
  certificate_document_url: "", status: "active",
};

// ============================================================
// MAIN PAGE
// ============================================================
export default function TransportManagement() {
  const { profile } = useAuth();
  const schoolId = profile?.school_id as string | undefined;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Hero banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-700 p-8">
          <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <div className="rounded-xl bg-white/15 p-3">
              <Bus className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Transport Management</h1>
              <p className="text-emerald-50/90 mt-1">
                Manage your fleet, drivers, routes, and student transport assignments.
              </p>
            </div>
          </div>
        </div>

        <SosAlertBanner />

        <Tabs defaultValue="vehicles" className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1.5 bg-slate-100/70 p-1.5 rounded-xl">
            <TabsTrigger value="vehicles" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              <Bus className="h-4 w-4" /> Vehicles
            </TabsTrigger>
            <TabsTrigger value="drivers" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              <UserRound className="h-4 w-4" /> Driver & Attendant
            </TabsTrigger>
            <TabsTrigger value="routes" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              <RouteIcon className="h-4 w-4" /> Routes & Stops
            </TabsTrigger>
            <TabsTrigger value="assignments" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              <Users className="h-4 w-4" /> Student Assignment
            </TabsTrigger>
            <TabsTrigger value="geofencing" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              <MapPin className="h-4 w-4" /> Geofencing
            </TabsTrigger>
            <TabsTrigger value="multiroute" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              <Wand2 className="h-4 w-4" /> Multi-Route
            </TabsTrigger>
            <TabsTrigger value="trips" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              <MapPinned className="h-4 w-4" /> Trips
            </TabsTrigger>
            <TabsTrigger value="boardinglogs" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              <ClipboardList className="h-4 w-4" /> Boarding & Drop
            </TabsTrigger>
            <TabsTrigger value="incidents" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              Incidents
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              Maintenance
            </TabsTrigger>
            <TabsTrigger value="fuel" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              Fuel
            </TabsTrigger>
            <TabsTrigger value="emergency" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              <Siren className="h-4 w-4" /> Emergency
            </TabsTrigger>
          </TabsList>
          <TabsContent value="vehicles">
            <VehiclesTab schoolId={schoolId} />
          </TabsContent>
          <TabsContent value="drivers" className="space-y-6">
            <DriversTab schoolId={schoolId} />
            <AttendantsTab schoolId={schoolId} />
          </TabsContent>
          <TabsContent value="routes">
            <RoutesTab schoolId={schoolId} />
          </TabsContent>
          <TabsContent value="assignments">
            <AssignmentsTab schoolId={schoolId} />
          </TabsContent>
          <TabsContent value="multiroute">
            <MultiRoutePlanner schoolId={schoolId} />
          </TabsContent>
          <TabsContent value="trips">
            <TripsTab schoolId={schoolId} />
          </TabsContent>
          <TabsContent value="boardinglogs">
            <BoardingDropManagementTab schoolId={schoolId} />
          </TabsContent>
          <TabsContent value="emergency">
            <EmergencyManagementTab schoolId={schoolId} />
          </TabsContent>
          <TabsContent value="incidents">
            <IncidentManagementTab schoolId={schoolId} />
          </TabsContent>
          <TabsContent value="maintenance">
            <VehicleMaintenanceTab schoolId={schoolId} />
          </TabsContent>
          <TabsContent value="fuel">
            <FuelManagementTab schoolId={schoolId} />
          </TabsContent>
          <TabsContent value="geofencing">
            <GeofenceZonesTab schoolId={schoolId} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

// ============================================================
// GLOW CARD WRAPPER (design system)
// ============================================================
function GlowCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <Card className={`border-2 border-emerald-200 rounded-2xl bg-gradient-to-br from-emerald-50/60 via-white to-white hover:shadow-md transition-all ${className}`}>
      {children}
    </Card>
  );
}

// ============================================================
// DOCUMENT UPLOAD FIELD (private storage, signed URL on view)
// ============================================================
function DocumentUploadField({
  label, bucket, folder, value, onChange, table, recordId, column,
}: {
  label: string;
  bucket: string;
  folder: string;
  value: string;
  onChange: (path: string) => void;
  table: "vehicles" | "drivers";
  recordId?: string;
  column: string;
}) {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const slug = label.replace(/\s+/g, "_").toLowerCase();
      const path = `${folder}/${slug}-${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
      if (error) throw error;
      onChange(path);
      toast.success(`${label} uploaded`);
    } catch (err: any) {
      toast.error(err.message || `Failed to upload ${label}`);
    } finally {
      setUploading(false);
    }
  };

  const handleView = async () => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(value, 60);
    if (error || !data?.signedUrl) {
      toast.error("Failed to open document");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const handleDelete = async () => {
    if (!value) return;
    const { error } = await supabase.storage.from(bucket).remove([value]);
    if (error) {
      toast.error("Failed to delete document");
      return;
    }
    if (recordId) {
      const { error: dbError } = await supabase.from(table).update({ [column]: null }).eq("id", recordId);
      if (dbError) {
        toast.error("Removed file but failed to update the saved record — please click Save to sync.");
      }
    }
    onChange("");
    toast.success(`${label} removed`);
  };

  return (
    <div>
      <Label className="flex items-center gap-1"><Upload className="h-3 w-3" /> {label}</Label>
      {value && !uploading ? (
        <div className="flex items-center gap-2 mt-1 border rounded-md px-2 py-1.5 bg-emerald-50/50">
          <span className="text-xs text-emerald-700 flex-1 truncate">Document uploaded</span>
          <button
            type="button"
            onClick={handleView}
            className="text-xs text-emerald-600 hover:underline inline-flex items-center gap-1 shrink-0"
          >
            <ExternalLink className="h-3 w-3" /> View
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="text-xs text-red-500 hover:underline inline-flex items-center gap-1 shrink-0"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-1">
          <Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFile} disabled={uploading} className="text-xs" />
          {uploading && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
        </div>
      )}
    </div>
  );
}

// ============================================================
// VEHICLES TAB
// ============================================================
export function VehiclesTab({ schoolId }: { schoolId?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState(EMPTY_VEHICLE);
  const [draftId] = useState(() => crypto.randomUUID());
  const folderId = editing?.id || draftId;

  const { data: vehicles, isLoading } = useQuery({
    queryKey: ["transport-vehicles", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("school_id", schoolId)
        .order("registration_number");
      if (error) throw error;
      return data as Vehicle[];
    },
    enabled: !!schoolId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        school_id: schoolId,
        registration_number: form.registration_number,
        vehicle_type: form.vehicle_type,
        capacity: form.capacity ? Number(form.capacity) : null,
        insurance_expiry: form.insurance_expiry || null,
        fitness_expiry: form.fitness_expiry || null,
        permit_expiry: form.permit_expiry || null,
        status: form.status,
        fuel_type: form.fuel_type || null,
        mileage_kmpl: form.mileage_kmpl ? Number(form.mileage_kmpl) : null,
        chassis_number: form.chassis_number || null,
        engine_number: form.engine_number || null,
        gps_device_id: form.gps_device_id || null,
        insurance_number: form.insurance_number || null,
        insurance_document_url: form.insurance_document_url || null,
        fitness_certificate_number: form.fitness_certificate_number || null,
        fitness_document_url: form.fitness_document_url || null,
        puc_number: form.puc_number || null,
        puc_expiry: form.puc_expiry || null,
        puc_document_url: form.puc_document_url || null,
        rc_owner_name: form.rc_owner_name || null,
        rc_registration_date: form.rc_registration_date || null,
        rc_document_url: form.rc_document_url || null,
      };
      if (editing) {
        const { data, error } = await supabase.from("vehicles").update(payload).eq("id", editing.id).select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Update matched 0 rows — check RLS/session (are you logged in as principal/admin/school_admin for this school?)");
      } else {
        const { error } = await supabase.from("vehicles").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Vehicle updated" : "Vehicle added");
      queryClient.invalidateQueries({ queryKey: ["transport-vehicles"] });
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_VEHICLE);
    },
    onError: (e: any) => toast.error(e.message || "Failed to save vehicle"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("vehicles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Vehicle deleted");
      queryClient.invalidateQueries({ queryKey: ["transport-vehicles"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete — vehicle may be linked to a route"),
  });

  const openEdit = (v: Vehicle) => {
    setEditing(v);
    setForm({
      registration_number: v.registration_number,
      vehicle_type: v.vehicle_type,
      capacity: v.capacity?.toString() || "",
      insurance_expiry: v.insurance_expiry || "",
      fitness_expiry: v.fitness_expiry || "",
      permit_expiry: v.permit_expiry || "",
      status: v.status,
      fuel_type: v.fuel_type || "diesel",
      mileage_kmpl: v.mileage_kmpl?.toString() || "",
      chassis_number: v.chassis_number || "",
      engine_number: v.engine_number || "",
      gps_device_id: v.gps_device_id || "",
      insurance_number: v.insurance_number || "",
      insurance_document_url: v.insurance_document_url || "",
      fitness_certificate_number: v.fitness_certificate_number || "",
      fitness_document_url: v.fitness_document_url || "",
      puc_number: v.puc_number || "",
      puc_expiry: v.puc_expiry || "",
      puc_document_url: v.puc_document_url || "",
      rc_owner_name: v.rc_owner_name || "",
      rc_registration_date: v.rc_registration_date || "",
      rc_document_url: v.rc_document_url || "",
    });
    setOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_VEHICLE);
    setOpen(true);
  };

  return (
    <GlowCard>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 p-2">
            <Bus className="h-4 w-4 text-white" />
          </div>
          Fleet Vehicles
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add Vehicle
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Vehicle" : "Add Vehicle"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Registration Number</Label>
                <Input value={form.registration_number}
                  onChange={(e) => setForm({ ...form, registration_number: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <Select value={form.vehicle_type} onValueChange={(v) => setForm({ ...form, vehicle_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bus">Bus</SelectItem>
                      <SelectItem value="van">Van</SelectItem>
                      <SelectItem value="car">Car</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Capacity</Label>
                  <Input type="number" value={form.capacity}
                    onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Insurance Expiry</Label>
                  <Input type="date" value={form.insurance_expiry}
                    onChange={(e) => setForm({ ...form, insurance_expiry: e.target.value })} />
                </div>
                <div>
                  <Label>Fitness Expiry</Label>
                  <Input type="date" value={form.fitness_expiry}
                    onChange={(e) => setForm({ ...form, fitness_expiry: e.target.value })} />
                </div>
                <div>
                  <Label>Permit Expiry</Label>
                  <Input type="date" value={form.permit_expiry}
                    onChange={(e) => setForm({ ...form, permit_expiry: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">RC & Identification</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Fuel Type</Label>
                    <Select value={form.fuel_type} onValueChange={(v) => setForm({ ...form, fuel_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="diesel">Diesel</SelectItem>
                        <SelectItem value="petrol">Petrol</SelectItem>
                        <SelectItem value="cng">CNG</SelectItem>
                        <SelectItem value="electric">Electric</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Mileage (km/l)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={form.mileage_kmpl}
                      onChange={(e) => setForm({ ...form, mileage_kmpl: e.target.value })}
                      placeholder="e.g. 8.5"
                    />
                  </div>
                  <div>
                    <Label>GPS Device ID</Label>
                    <Input value={form.gps_device_id}
                      onChange={(e) => setForm({ ...form, gps_device_id: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <Label>Chassis Number</Label>
                    <Input value={form.chassis_number}
                      onChange={(e) => setForm({ ...form, chassis_number: e.target.value })} />
                  </div>
                  <div>
                    <Label>Engine Number</Label>
                    <Input value={form.engine_number}
                      onChange={(e) => setForm({ ...form, engine_number: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <Label>RC Owner Name</Label>
                    <Input value={form.rc_owner_name}
                      onChange={(e) => setForm({ ...form, rc_owner_name: e.target.value })} />
                  </div>
                  <div>
                    <Label>RC Registration Date</Label>
                    <Input type="date" value={form.rc_registration_date}
                      onChange={(e) => setForm({ ...form, rc_registration_date: e.target.value })} />
                  </div>
                </div>
                <div className="mt-3">
                  <DocumentUploadField
                    label="RC Document"
                    bucket="transport-documents"
                    folder={`${schoolId}/vehicles/${folderId}`}
                    value={form.rc_document_url}
                    onChange={(path) => setForm({ ...form, rc_document_url: path })}
                    table="vehicles"
                    recordId={editing?.id}
                    column="rc_document_url"
                  />
                </div>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Insurance</p>
                <div>
                  <Label>Insurance Number</Label>
                  <Input value={form.insurance_number}
                    onChange={(e) => setForm({ ...form, insurance_number: e.target.value })} />
                </div>
                <DocumentUploadField
                  label="Insurance Document"
                  bucket="transport-documents"
                  folder={`${schoolId}/vehicles/${folderId}`}
                  value={form.insurance_document_url}
                  onChange={(path) => setForm({ ...form, insurance_document_url: path })}
                  table="vehicles"
                  recordId={editing?.id}
                  column="insurance_document_url"
                />
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Fitness Certificate</p>
                <div>
                  <Label>Fitness Certificate Number</Label>
                  <Input value={form.fitness_certificate_number}
                    onChange={(e) => setForm({ ...form, fitness_certificate_number: e.target.value })} />
                </div>
                <DocumentUploadField
                  label="Fitness Document"
                  bucket="transport-documents"
                  folder={`${schoolId}/vehicles/${folderId}`}
                  value={form.fitness_document_url}
                  onChange={(path) => setForm({ ...form, fitness_document_url: path })}
                  table="vehicles"
                  recordId={editing?.id}
                  column="fitness_document_url"
                />
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Pollution Certificate (PUC)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>PUC Number</Label>
                    <Input value={form.puc_number}
                      onChange={(e) => setForm({ ...form, puc_number: e.target.value })} />
                  </div>
                  <div>
                    <Label>PUC Expiry</Label>
                    <Input type="date" value={form.puc_expiry}
                      onChange={(e) => setForm({ ...form, puc_expiry: e.target.value })} />
                  </div>
                </div>
                <div className="mt-3">
                  <DocumentUploadField
                    label="PUC Document"
                    bucket="transport-documents"
                    folder={`${schoolId}/vehicles/${folderId}`}
                    value={form.puc_document_url}
                    onChange={(path) => setForm({ ...form, puc_document_url: path })}
                    table="vehicles"
                    recordId={editing?.id}
                    column="puc_document_url"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.registration_number || saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Registration</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Insurance Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles?.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.registration_number}</TableCell>
                  <TableCell className="capitalize">{v.vehicle_type}</TableCell>
                  <TableCell>{v.capacity ?? "—"}</TableCell>
                  <TableCell>{v.insurance_expiry || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={v.status === "active" ? "default" : "secondary"} className="capitalize">
                      {v.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(v)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(v.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {vehicles?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No vehicles added yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </GlowCard>
  );
}

// ============================================================
// DRIVERS TAB
// ============================================================
export function DriversTab({ schoolId }: { schoolId?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [form, setForm] = useState(EMPTY_DRIVER);
  const [draftId] = useState(() => crypto.randomUUID());
  const folderId = editing?.id || draftId;

  const { data: drivers, isLoading } = useQuery({
    queryKey: ["transport-drivers", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers").select("*").eq("school_id", schoolId).order("name");
      if (error) throw error;
      return data as Driver[];
    },
    enabled: !!schoolId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { email, password, ...driverFields } = form;
      const payload = {
        school_id: schoolId,
        ...driverFields,
        license_expiry: form.license_expiry || null,
        medical_certificate_expiry: form.medical_certificate_expiry || null,
      };
      if (editing) {
        const { data, error } = await supabase.from("drivers").update(payload).eq("id", editing.id).select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Update matched 0 rows — check RLS/session (are you logged in as principal/admin/school_admin for this school?)");
      } else {
        let profileId: string | null = null;
        if (email && password) {
          const { data: fnData, error: fnError } = await supabase.functions.invoke("register-driver", {
            body: { email, password, full_name: form.name },
          });
          if (fnError) throw new Error(fnError.message || "Failed to create driver login");
          if ((fnData as any)?.error) throw new Error((fnData as any).error);
          profileId = (fnData as any)?.user_id ?? null;
        }
        const { error } = await supabase.from("drivers").insert({ ...payload, profile_id: profileId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Driver updated" : "Driver added");
      queryClient.invalidateQueries({ queryKey: ["transport-drivers"] });
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_DRIVER);
    },
    onError: (e: any) => toast.error(e.message || "Failed to save driver"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("drivers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Driver deleted");
      queryClient.invalidateQueries({ queryKey: ["transport-drivers"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete — driver may be linked to a route"),
  });

  const openEdit = (d: Driver) => {
    setEditing(d);
    setForm({
      name: d.name, phone: d.phone || "", license_number: d.license_number || "",
      license_expiry: d.license_expiry || "", address: d.address || "", status: d.status,
      email: "", password: "",
      photo_url: d.photo_url || "", license_document_url: d.license_document_url || "",
      license_verification_status: d.license_verification_status || "pending",
      background_verification_status: d.background_verification_status || "pending",
      background_verification_document_url: d.background_verification_document_url || "",
      medical_certificate_number: d.medical_certificate_number || "",
      medical_certificate_expiry: d.medical_certificate_expiry || "",
      medical_certificate_document_url: d.medical_certificate_document_url || "",
      emergency_contact_name: d.emergency_contact_name || "",
      emergency_contact_phone: d.emergency_contact_phone || "",
      emergency_contact_relation: d.emergency_contact_relation || "",
    });
    setOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_DRIVER);
    setOpen(true);
  };

  return (
    <GlowCard>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 p-2">
            <UserRound className="h-4 w-4 text-white" />
          </div>
          Drivers
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add Driver
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Driver" : "Add Driver"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div>
                  <Label>License Number</Label>
                  <Input value={form.license_number}
                    onChange={(e) => setForm({ ...form, license_number: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>License Expiry</Label>
                  <Input type="date" value={form.license_expiry}
                    onChange={(e) => setForm({ ...form, license_expiry: e.target.value })} />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Address</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Verification</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>License Verification Status</Label>
                    <Select value={form.license_verification_status}
                      onValueChange={(v) => setForm({ ...form, license_verification_status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="verified">Verified</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Background Verification Status</Label>
                    <Select value={form.background_verification_status}
                      onValueChange={(v) => setForm({ ...form, background_verification_status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="verified">Verified</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <DocumentUploadField
                    label="License Document"
                    bucket="transport-documents"
                    folder={`${schoolId}/drivers/${folderId}`}
                    value={form.license_document_url}
                    onChange={(path) => setForm({ ...form, license_document_url: path })}
                    table="drivers"
                    recordId={editing?.id}
                    column="license_document_url"
                  />
                  <DocumentUploadField
                    label="Background Verification Document"
                    bucket="transport-documents"
                    folder={`${schoolId}/drivers/${folderId}`}
                    value={form.background_verification_document_url}
                    onChange={(path) => setForm({ ...form, background_verification_document_url: path })}
                    table="drivers"
                    recordId={editing?.id}
                    column="background_verification_document_url"
                  />
                </div>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Medical Certificate</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Certificate Number</Label>
                    <Input value={form.medical_certificate_number}
                      onChange={(e) => setForm({ ...form, medical_certificate_number: e.target.value })} />
                  </div>
                  <div>
                    <Label>Expiry Date</Label>
                    <Input type="date" value={form.medical_certificate_expiry}
                      onChange={(e) => setForm({ ...form, medical_certificate_expiry: e.target.value })} />
                  </div>
                </div>
                <div className="mt-3">
                  <DocumentUploadField
                    label="Medical Certificate Document"
                    bucket="transport-documents"
                    folder={`${schoolId}/drivers/${folderId}`}
                    value={form.medical_certificate_document_url}
                    onChange={(path) => setForm({ ...form, medical_certificate_document_url: path })}
                    table="drivers"
                    recordId={editing?.id}
                    column="medical_certificate_document_url"
                  />
                </div>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Emergency Contact</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Name</Label>
                    <Input value={form.emergency_contact_name}
                      onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input value={form.emergency_contact_phone}
                      onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })} />
                  </div>
                  <div>
                    <Label>Relation</Label>
                    <Input value={form.emergency_contact_relation}
                      onChange={(e) => setForm({ ...form, emergency_contact_relation: e.target.value })} />
                  </div>
                </div>
              </div>
              {!editing && (
                <div className="border-t pt-3 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    App Login (optional — enables live GPS tracking for this driver)
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Email</Label>
                      <Input type="email" value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </div>
                    <div>
                      <Label>Password</Label>
                      <Input type="password" value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>License No.</TableHead>
                <TableHead>License Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead>App Login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drivers?.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>{d.phone || "—"}</TableCell>
                  <TableCell>{d.license_number || "—"}</TableCell>
                  <TableCell>{d.license_expiry || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={d.status === "active" ? "default" : "secondary"} className="capitalize">
                      {d.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge
                        variant={d.license_verification_status === "verified" ? "default" : "secondary"}
                        className={`capitalize text-[10px] ${d.license_verification_status === "verified" ? "bg-emerald-600" : ""}`}
                      >
                        License: {d.license_verification_status || "pending"}
                      </Badge>
                      <Badge
                        variant={d.background_verification_status === "verified" ? "default" : "secondary"}
                        className={`capitalize text-[10px] ${d.background_verification_status === "verified" ? "bg-emerald-600" : ""}`}
                      >
                        BGV: {d.background_verification_status || "pending"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    {d.profile_id ? (
                      <Badge variant="default" className="bg-emerald-600">Enabled</Badge>
                    ) : (
                      <Badge variant="secondary">Not set up</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(d)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(d.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {drivers?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No drivers added yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </GlowCard>
  );
}

// ============================================================
// BUS ATTENDANTS TAB
// ============================================================
export function AttendantsTab({ schoolId }: { schoolId?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Attendant | null>(null);
  const [form, setForm] = useState(EMPTY_ATTENDANT);
  const [draftId] = useState(() => crypto.randomUUID());
  const folderId = editing?.id || draftId;

  const { data: attendants, isLoading } = useQuery({
    queryKey: ["transport-attendants", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bus_attendants").select("*").eq("school_id", schoolId).order("name");
      if (error) throw error;
      return data as Attendant[];
    },
    enabled: !!schoolId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        school_id: schoolId,
        ...form,
        certificate_expiry: form.certificate_expiry || null,
      };
      if (editing) {
        const { data, error } = await supabase.from("bus_attendants").update(payload).eq("id", editing.id).select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Update matched 0 rows — check RLS/session (are you logged in as principal/admin/school_admin for this school?)");
      } else {
        const { error } = await supabase.from("bus_attendants").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Attendant updated" : "Attendant added");
      queryClient.invalidateQueries({ queryKey: ["transport-attendants"] });
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_ATTENDANT);
    },
    onError: (e: any) => toast.error(e.message || "Failed to save attendant"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bus_attendants").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Attendant deleted");
      queryClient.invalidateQueries({ queryKey: ["transport-attendants"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete — attendant may be linked to a route"),
  });

  const openEdit = (a: Attendant) => {
    setEditing(a);
    setForm({
      name: a.name, phone: a.phone || "",
      certificate_number: a.certificate_number || "",
      certificate_expiry: a.certificate_expiry || "",
      certificate_document_url: a.certificate_document_url || "",
      status: a.status,
    });
    setOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_ATTENDANT);
    setOpen(true);
  };

  return (
    <GlowCard>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-br from-teal-500 to-cyan-500 p-2">
            <UserCheck className="h-4 w-4 text-white" />
          </div>
          Bus Attendants
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add Attendant
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Attendant" : "Add Attendant"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Certification</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Certificate Number</Label>
                    <Input value={form.certificate_number}
                      onChange={(e) => setForm({ ...form, certificate_number: e.target.value })} />
                  </div>
                  <div>
                    <Label>Expiry Date</Label>
                    <Input type="date" value={form.certificate_expiry}
                      onChange={(e) => setForm({ ...form, certificate_expiry: e.target.value })} />
                  </div>
                </div>
                <div className="mt-3">
                  <DocumentUploadField
                    label="Certificate Document"
                    bucket="transport-documents"
                    folder={`${schoolId}/attendants/${folderId}`}
                    value={form.certificate_document_url}
                    onChange={(path) => setForm({ ...form, certificate_document_url: path })}
                    table="bus_attendants"
                    recordId={editing?.id}
                    column="certificate_document_url"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Certificate No.</TableHead>
                <TableHead>Certificate Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attendants?.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>{a.phone || "—"}</TableCell>
                  <TableCell>{a.certificate_number || "—"}</TableCell>
                  <TableCell>{a.certificate_expiry || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === "active" ? "default" : "secondary"} className="capitalize">
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(a)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(a.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {attendants?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No attendants added yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </GlowCard>
  );
}

// ============================================================
// ROUTES & STOPS TAB
// ============================================================
const DAY_LABELS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

// Nearest-neighbor TSP heuristic, keeping index 0 fixed as the start stop.
function nearestNeighborOrder(durations: number[][], startIdx: number): number[] {
  const n = durations.length;
  const visited = new Array(n).fill(false);
  visited[startIdx] = true;
  const order = [startIdx];
  let current = startIdx;
  for (let step = 1; step < n; step++) {
    let best = -1;
    let bestDur = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && durations[current][j] < bestDur) {
        bestDur = durations[current][j];
        best = j;
      }
    }
    visited[best] = true;
    order.push(best);
    current = best;
  }
  return order;
}

function totalRouteDuration(order: number[], durations: number[][]): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) total += durations[order[i]][order[i + 1]];
  return total;
}

// 2-opt improvement pass. Index 0 (the start) is never moved since i starts at 1.
function twoOptImprove(order: number[], durations: number[][]): number[] {
  let best = [...order];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        if (totalRouteDuration(candidate, durations) < totalRouteDuration(best, durations)) {
          best = candidate;
          improved = true;
        }
      }
    }
  }
  return best;
}

export function RoutesTab({ schoolId }: { schoolId?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TransportRoute | null>(null);
  const [routeName, setRouteName] = useState("");
  const [routeNumber, setRouteNumber] = useState("");
  const [vehicleId, setVehicleId] = useState<string>("");
  const [driverId, setDriverId] = useState<string>("");
  const [attendantId, setAttendantId] = useState<string>("");
  const [status, setStatus] = useState("active");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [originalStopIds, setOriginalStopIds] = useState<string[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateSourceRoute, setTemplateSourceRoute] = useState<TransportRoute | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRoute, setHistoryRoute] = useState<TransportRoute | null>(null);

  const { data: routes, isLoading } = useQuery({
    queryKey: ["transport-routes", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_routes")
        .select("*, route_stops(*)")
        .eq("school_id", schoolId)
        .order("route_name");
      if (error) throw error;
      return (data as any[]).map((r) => ({
        ...r,
        route_stops: (r.route_stops || []).sort(
          (a: RouteStop, b: RouteStop) => a.sequence_number - b.sequence_number
        ),
      })) as TransportRoute[];
    },
    enabled: !!schoolId,
  });

  const { data: vehicles } = useQuery({
    queryKey: ["transport-vehicles", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, registration_number").eq("school_id", schoolId);
      if (error) throw error;
      return data as { id: string; registration_number: string }[];
    },
    enabled: !!schoolId,
  });

  const { data: drivers } = useQuery({
    queryKey: ["transport-drivers", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("id, name").eq("school_id", schoolId);
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
    enabled: !!schoolId,
  });

  const { data: attendants } = useQuery({
    queryKey: ["transport-attendants", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from("bus_attendants").select("id, name").eq("school_id", schoolId);
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
    enabled: !!schoolId,
  });

  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ["route-templates", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("route_templates")
        .select("*, route_template_stops(*)")
        .eq("school_id", schoolId)
        .order("template_name");
      if (error) throw error;
      return (data as any[]).map((t) => ({
        ...t,
        route_template_stops: (t.route_template_stops || []).sort(
          (a: RouteTemplateStop, b: RouteTemplateStop) => a.sequence_number - b.sequence_number
        ),
      })) as RouteTemplate[];
    },
    enabled: !!schoolId,
  });

  const { data: todayHolidays } = useQuery({
    queryKey: ["today-holidays", schoolId],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("academic_calendar_events")
        .select("id")
        .eq("school_id", schoolId)
        .eq("event_type", "holiday")
        .lte("start_date", today)
        .gte("end_date", today);
      if (error) throw error;
      return data;
    },
    enabled: !!schoolId,
  });

  const isHolidayToday = (todayHolidays?.length || 0) > 0;

  const getTodayIso = () => {
    const day = new Date().getDay(); // 0=Sun .. 6=Sat
    return day === 0 ? 7 : day;
  };

  const isRouteRunningToday = (r: TransportRoute): { running: boolean; reason: string } => {
    if (r.status !== "active") return { running: false, reason: "Inactive" };
    const todayIso = getTodayIso();
    if (!r.days_of_week?.includes(todayIso)) return { running: false, reason: "Not scheduled today" };
    if (isHolidayToday) return { running: false, reason: "Holiday" };
    return { running: true, reason: "" };
  };

  const { data: versions, isLoading: versionsLoading } = useQuery({
    queryKey: ["route-versions", historyRoute?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("route_versions")
        .select("*")
        .eq("route_id", historyRoute!.id)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return data as RouteVersion[];
    },
    enabled: !!historyRoute,
  });

  const describeVersionChange = (curr: RouteVersion, prev?: RouteVersion) => {
    if (!prev) return "Route created";
    const changes: string[] = [];
    if (curr.route_name !== prev.route_name) changes.push("name changed");
    if (curr.route_number !== prev.route_number) changes.push("number changed");
    if (curr.vehicle_id !== prev.vehicle_id) changes.push("vehicle changed");
    if (curr.driver_id !== prev.driver_id) changes.push("driver changed");
    if (curr.attendant_id !== prev.attendant_id) changes.push("attendant changed");
    if (curr.status !== prev.status) changes.push("status changed");
    if (JSON.stringify(curr.stops_snapshot) !== JSON.stringify(prev.stops_snapshot)) changes.push("stops changed");
    return changes.length > 0 ? changes.join(", ") : "No changes detected";
  };

  const resetForm = () => {
    setRouteName(""); setRouteNumber(""); setVehicleId(""); setDriverId(""); setAttendantId("");
    setStatus("active"); setDaysOfWeek([1, 2, 3, 4, 5, 6]); setStops([]); setOriginalStopIds([]);
    setFuelStats(null);
  };

  const openNew = () => { setEditing(null); resetForm(); setOpen(true); };

  const openEdit = (r: TransportRoute) => {
    setEditing(r);
    setRouteName(r.route_name);
    setRouteNumber(r.route_number || "");
    setVehicleId(r.vehicle_id || "");
    setDriverId(r.driver_id || "");
    setAttendantId(r.attendant_id || "");
    setStatus(r.status);
    setDaysOfWeek(r.days_of_week && r.days_of_week.length > 0 ? r.days_of_week : [1, 2, 3, 4, 5, 6]);
    setStops(r.route_stops.map((s) => ({ ...s })));
    setOriginalStopIds(r.route_stops.map((s) => s.id!).filter(Boolean));
    setOpen(true);
  };

  const addStop = () => {
    setStops([...stops, {
      stop_name: "", sequence_number: stops.length + 1, pickup_time: null, drop_time: null,
      latitude: null, longitude: null, radius_meters: 200,
    }]);
  };

  const updateStop = (idx: number, patch: Partial<RouteStop>) => {
    setStops(stops.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const removeStop = (idx: number) => {
    setStops(stops.filter((_, i) => i !== idx).map((s, i) => ({ ...s, sequence_number: i + 1 })));
  };

  const moveStop = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= stops.length) return;
    const next = [...stops];
    [next[idx], next[target]] = [next[target], next[idx]];
    setStops(next.map((s, i) => ({ ...s, sequence_number: i + 1 })));
  };

  const [fuelStats, setFuelStats] = useState<{ originalKm: number; optimizedKm: number; savedKm: number } | null>(null);

  const { data: fuelInputs } = useQuery({
    queryKey: ["fuel-inputs", vehicleId, schoolId],
    queryFn: async () => {
      const [{ data: vehicleRow }, { data: settingsRow }] = await Promise.all([
        supabase.from("vehicles").select("mileage_kmpl").eq("id", vehicleId).maybeSingle(),
        supabase.from("transport_settings").select("fuel_price_per_liter").eq("school_id", schoolId).maybeSingle(),
      ]);
      return {
        mileageKmpl: (vehicleRow as any)?.mileage_kmpl ?? null,
        fuelPricePerLiter: (settingsRow as any)?.fuel_price_per_liter ?? 100,
      };
    },
    enabled: !!vehicleId && !!schoolId,
  });

  const optimizeMutation = useMutation({
    mutationFn: async () => {
      if (stops.length < 3) throw new Error("Add at least 3 stops to optimize the order");
      if (stops.some((s) => s.latitude == null || s.longitude == null)) {
        throw new Error("Every stop needs coordinates (use the address search) before optimizing");
      }
      const coordStr = stops.map((s) => `${s.longitude},${s.latitude}`).join(";");
      const res = await fetch(
        `https://router.project-osrm.org/table/v1/driving/${coordStr}?annotations=duration,distance`
      );
      if (!res.ok) throw new Error("Route optimization service is unavailable right now — try again shortly");
      const data = await res.json();
      if (data.code !== "Ok") throw new Error(data.message || "Could not compute an optimized route");
      const durations: number[][] = data.durations;
      const distances: number[][] = data.distances;

      const sumConsecutive = (indices: number[]) => {
        let total = 0;
        for (let i = 0; i < indices.length - 1; i++) {
          total += distances[indices[i]][indices[i + 1]];
        }
        return total;
      };
      const originalOrder = stops.map((_, i) => i);
      const originalMeters = sumConsecutive(originalOrder);

      let order = nearestNeighborOrder(durations, 0);
      order = twoOptImprove(order, durations);
      const optimizedMeters = sumConsecutive(order);

      return {
        reordered: order.map((idx, i) => ({ ...stops[idx], sequence_number: i + 1 })),
        originalKm: originalMeters / 1000,
        optimizedKm: optimizedMeters / 1000,
      };
    },
    onSuccess: ({ reordered, originalKm, optimizedKm }) => {
      setStops(reordered);
      const savedKm = Math.max(0, originalKm - optimizedKm);
      setFuelStats({ originalKm, optimizedKm, savedKm });

      const mileage = fuelInputs?.mileageKmpl;
      if (mileage && savedKm > 0.05) {
        const savedLiters = savedKm / mileage;
        const savedCost = savedLiters * (fuelInputs?.fuelPricePerLiter ?? 100);
        toast.success(
          `Optimized: ${optimizedKm.toFixed(1)} km (was ${originalKm.toFixed(1)} km) — saves ~${savedKm.toFixed(1)} km, ≈ ₹${savedCost.toFixed(0)}/day in fuel`
        );
      } else {
        toast.success(`Stop order optimized — ${optimizedKm.toFixed(1)} km total driving distance`);
      }
    },
    onError: (e: any) => toast.error(e.message || "Failed to optimize route"),
  });

  const recordVersion = async (routeId: string, stopsData: RouteStop[]) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: lastVersion } = await supabase
        .from("route_versions")
        .select("version_number")
        .eq("route_id", routeId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersion = (lastVersion?.version_number || 0) + 1;
      await supabase.from("route_versions").insert({
        route_id: routeId,
        school_id: schoolId,
        version_number: nextVersion,
        route_name: routeName,
        route_number: routeNumber || null,
        vehicle_id: vehicleId || null,
        driver_id: driverId || null,
        attendant_id: attendantId || null,
        status,
        days_of_week: daysOfWeek,
        stops_snapshot: stopsData.map((s) => ({
          stop_name: s.stop_name,
          sequence_number: s.sequence_number,
          pickup_time: s.pickup_time,
          drop_time: s.drop_time,
          latitude: s.latitude,
          longitude: s.longitude,
        })),
        changed_by: userData.user?.id || null,
        changed_by_name: userData.user?.email || null,
      });
    } catch (e) {
      console.warn("[ROUTE VERSION] failed to record version snapshot", e);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        school_id: schoolId,
        route_name: routeName,
        route_number: routeNumber || null,
        vehicle_id: vehicleId || null,
        driver_id: driverId || null,
        attendant_id: attendantId || null,
        status,
        days_of_week: daysOfWeek,
      };
      let routeId = editing?.id;

      if (vehicleId) {
        const { data: conflictRoutes, error: conflictErr } = await supabase
          .from("transport_routes")
          .select("id, route_name")
          .eq("school_id", schoolId)
          .eq("vehicle_id", vehicleId);
        if (conflictErr) throw conflictErr;
        const conflict = (conflictRoutes || []).find((r) => r.id !== routeId);
        if (conflict) {
          throw new Error(
            `This vehicle is already assigned to route "${conflict.route_name}". A vehicle can only run one route at a time.`
          );
        }
      }
      if (editing) {
        const { data: updateData, error } = await supabase.from("transport_routes").update(payload).eq("id", editing.id).select();
        console.log("[ROUTE UPDATE DEBUG] payload sent:", payload);
        console.log("[ROUTE UPDATE DEBUG] rows returned:", updateData);
        if (error) {
          console.log("[ROUTE UPDATE DEBUG] error:", error);
          throw error;
        }
        if (!updateData || updateData.length === 0) {
          console.log("[ROUTE UPDATE DEBUG] WARNING: 0 rows matched/updated — likely RLS silently filtering");
        }

        // Diff stops instead of delete-all/insert-all, so stop IDs that
        // existing transport_assignments rows point to (pickup_stop_id /
        // drop_stop_id) survive an edit unless the user actually removed them.
        const currentIds = stops.map((s) => s.id).filter(Boolean) as string[];
        const removedIds = originalStopIds.filter((id) => !currentIds.includes(id));

        if (removedIds.length > 0) {
          const { error: delErr } = await supabase.from("route_stops").delete().in("id", removedIds);
          if (delErr) throw delErr;
        }

        const toUpdate = stops.filter((s) => s.id);
        // route_stops has a UNIQUE(route_id, sequence_number) constraint.
        // Writing each row's new sequence_number in place can collide with
        // another existing row that still holds that number (e.g. moving
        // stop 4 -> position 1 collides with whatever row is still "1").
        // Two-pass fix: push everything to unique negative placeholders
        // first, then set final values once no row holds a "real" number.
        for (const s of toUpdate) {
          const { error: tempErr } = await supabase.from("route_stops").update({
            sequence_number: -(s.sequence_number) - 1000,
          }).eq("id", s.id!);
          if (tempErr) throw tempErr;
        }
        for (const s of toUpdate) {
          const { error: updErr } = await supabase.from("route_stops").update({
            stop_name: s.stop_name,
            sequence_number: s.sequence_number,
            pickup_time: s.pickup_time || null,
            drop_time: s.drop_time || null,
            latitude: s.latitude ?? null,
            longitude: s.longitude ?? null,
            radius_meters: s.radius_meters ?? 200,
          }).eq("id", s.id!);
          if (updErr) throw updErr;
        }

        const toInsert = stops.filter((s) => !s.id);
        if (toInsert.length > 0) {
          const insertPayload = toInsert.map((s) => ({
            route_id: routeId,
            stop_name: s.stop_name,
            sequence_number: s.sequence_number,
            pickup_time: s.pickup_time || null,
            drop_time: s.drop_time || null,
            latitude: s.latitude ?? null,
            longitude: s.longitude ?? null,
            radius_meters: s.radius_meters ?? 200,
          }));
          const { error: insErr } = await supabase.from("route_stops").insert(insertPayload);
          if (insErr) throw insErr;
        }
      } else {
        const { data, error } = await supabase.from("transport_routes").insert(payload).select("id").single();
        if (error) throw error;
        routeId = data.id;

        if (stops.length > 0) {
          const stopsPayload = stops.map((s) => ({
            route_id: routeId,
            stop_name: s.stop_name,
            sequence_number: s.sequence_number,
            pickup_time: s.pickup_time || null,
            drop_time: s.drop_time || null,
            latitude: s.latitude ?? null,
            longitude: s.longitude ?? null,
            radius_meters: s.radius_meters ?? 200,
          }));
          const { error: stopErr } = await supabase.from("route_stops").insert(stopsPayload);
          if (stopErr) throw stopErr;
        }
      }

      await recordVersion(routeId!, stops);
    },
    onSuccess: () => {
      toast.success(editing ? "Route updated" : "Route added");
      queryClient.invalidateQueries({ queryKey: ["transport-routes"] });
      queryClient.invalidateQueries({ queryKey: ["transport-routes-with-capacity"] });
      setOpen(false);
      resetForm();
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message || "Failed to save route"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("transport_routes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Route deleted");
      queryClient.invalidateQueries({ queryKey: ["transport-routes"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete — route may have student assignments"),
  });

  const saveAsTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!templateSourceRoute) return;
      const { data: tpl, error } = await supabase.from("route_templates").insert({
        school_id: schoolId,
        template_name: templateName,
        description: templateDescription || null,
        source_route_id: templateSourceRoute.id,
      }).select("id").single();
      if (error) throw error;

      if (templateSourceRoute.route_stops.length > 0) {
        const stopsPayload = templateSourceRoute.route_stops.map((s) => ({
          template_id: tpl.id,
          stop_name: s.stop_name,
          sequence_number: s.sequence_number,
          pickup_time: s.pickup_time || null,
          drop_time: s.drop_time || null,
          latitude: s.latitude ?? null,
          longitude: s.longitude ?? null,
        }));
        const { error: stopErr } = await supabase.from("route_template_stops").insert(stopsPayload);
        if (stopErr) throw stopErr;
      }
    },
    onSuccess: () => {
      toast.success("Template saved");
      queryClient.invalidateQueries({ queryKey: ["route-templates"] });
      setSaveTemplateOpen(false);
      setTemplateSourceRoute(null);
      setTemplateName("");
      setTemplateDescription("");
    },
    onError: (e: any) => toast.error(e.message || "Failed to save template"),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("route_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Template deleted");
      queryClient.invalidateQueries({ queryKey: ["route-templates"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete template"),
  });

  const openSaveAsTemplate = (r: TransportRoute) => {
    setTemplateSourceRoute(r);
    setTemplateName(r.route_name);
    setTemplateDescription("");
    setSaveTemplateOpen(true);
  };

  const useTemplate = (t: RouteTemplate) => {
    setEditing(null);
    setRouteName(t.template_name);
    setRouteNumber("");
    setVehicleId("");
    setDriverId("");
    setAttendantId("");
    setStatus("active");
    setDaysOfWeek([1, 2, 3, 4, 5, 6]);
    setStops(t.route_template_stops.map((s) => ({
      stop_name: s.stop_name,
      sequence_number: s.sequence_number,
      pickup_time: s.pickup_time,
      drop_time: s.drop_time,
      latitude: s.latitude,
      longitude: s.longitude,
    })));
    setOriginalStopIds([]);
    setTemplatesOpen(false);
    setOpen(true);
  };

  return (
    <GlowCard>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 p-2">
            <RouteIcon className="h-4 w-4 text-white" />
          </div>
          Routes & Stops
        </CardTitle>
        <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => setTemplatesOpen(true)} className="gap-1.5">
          <LayoutTemplate className="h-4 w-4" /> Templates
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add Route
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Route" : "Add Route"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Route Name</Label>
                  <Input value={routeName} onChange={(e) => setRouteName(e.target.value)} />
                </div>
                <div>
                  <Label>Route Number</Label>
                  <Input value={routeNumber} onChange={(e) => setRouteNumber(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Vehicle</Label>
                  <Select value={vehicleId} onValueChange={setVehicleId}>
                    <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                    <SelectContent>
                      {vehicles?.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.registration_number}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Driver</Label>
                  <Select value={driverId} onValueChange={setDriverId}>
                    <SelectTrigger><SelectValue placeholder="Select driver" /></SelectTrigger>
                    <SelectContent>
                      {drivers?.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Attendant</Label>
                  <Select value={attendantId} onValueChange={setAttendantId}>
                    <SelectTrigger><SelectValue placeholder="Select attendant" /></SelectTrigger>
                    <SelectContent>
                      {attendants?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Runs on Days</Label>
                  <div className="flex gap-1 mt-1">
                    {DAY_LABELS.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() =>
                          setDaysOfWeek(
                            daysOfWeek.includes(d.value)
                              ? daysOfWeek.filter((x) => x !== d.value)
                              : [...daysOfWeek, d.value].sort((a, b) => a - b)
                          )
                        }
                        className={`h-8 w-8 rounded-full text-xs font-medium border transition-colors ${
                          daysOfWeek.includes(d.value)
                            ? "bg-emerald-500 text-white border-emerald-500"
                            : "bg-muted text-muted-foreground border-transparent"
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Route also auto-skips school holidays from the Academic Calendar.
                  </p>
                </div>
              </div>

              <div className="border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" /> Stops
                  </Label>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => optimizeMutation.mutate()}
                      disabled={stops.length < 3 || optimizeMutation.isPending}
                      className="gap-1"
                    >
                      {optimizeMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Wand2 className="h-3.5 w-3.5" />
                      )}
                      Optimize Order
                    </Button>
                    <Button size="sm" variant="outline" onClick={addStop} className="gap-1">
                      <Plus className="h-3.5 w-3.5" /> Add Stop
                    </Button>
                  </div>
                </div>
                {fuelStats && (
                  <p className="text-xs text-muted-foreground -mt-1">
                    {fuelStats.optimizedKm.toFixed(1)} km total
                    {fuelStats.savedKm > 0.05 && (
                      <>
                        {" "}(was {fuelStats.originalKm.toFixed(1)} km — saved {fuelStats.savedKm.toFixed(1)} km
                        {fuelInputs?.mileageKmpl
                          ? `, ≈ ₹${((fuelStats.savedKm / fuelInputs.mileageKmpl) * (fuelInputs?.fuelPricePerLiter ?? 100)).toFixed(0)}/day in fuel`
                          : ""}
                        )
                      </>
                    )}
                  </p>
                )}
                <div className="space-y-2">
                  {stops.map((stop, idx) => (
                    <div key={idx} className="flex items-center gap-2 rounded-lg border p-2 bg-muted/30 flex-wrap">
                      <span className="text-xs font-medium text-muted-foreground w-5">{idx + 1}</span>
                      <Input
                        placeholder="Stop name"
                        className="flex-1 min-w-[140px]"
                        value={stop.stop_name}
                        onChange={(e) => updateStop(idx, { stop_name: e.target.value })}
                      />
                      <StopAddressSearch
                        hasCoords={stop.latitude != null && stop.longitude != null}
                        onSelect={(lat, lng, address) =>
                          updateStop(idx, {
                            latitude: lat,
                            longitude: lng,
                            stop_name: stop.stop_name || address.split(",")[0],
                          })
                        }
                      />
                      {stop.latitude != null && stop.longitude != null && (
                        <MapPin className="h-4 w-4 text-emerald-500 shrink-0" />
                      )}
                      <Input
                        type="time"
                        className="w-28"
                        value={stop.pickup_time || ""}
                        onChange={(e) => updateStop(idx, { pickup_time: e.target.value })}
                      />
                      <Input
                        type="time"
                        className="w-28"
                        value={stop.drop_time || ""}
                        onChange={(e) => updateStop(idx, { drop_time: e.target.value })}
                      />
                      <div className="relative w-24">
                        <Input
                          type="number"
                          className="pr-6"
                          min={25}
                          step={25}
                          title="Safe zone radius in meters — how close the bus must get to count as arrived"
                          placeholder="Radius"
                          value={stop.radius_meters ?? 200}
                          onChange={(e) => updateStop(idx, { radius_meters: Number(e.target.value) || 200 })}
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          m
                        </span>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => moveStop(idx, -1)} disabled={idx === 0}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => moveStop(idx, 1)} disabled={idx === stops.length - 1}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => removeStop(idx)}>
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  ))}
                  {stops.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-3">No stops added yet.</p>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => saveMutation.mutate()} disabled={!routeName || saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Save Route
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </CardHeader>

      <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Route Templates</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {templatesLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : templates?.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No templates yet. Save a route as a template to reuse its stops later.
              </p>
            ) : (
              templates?.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="font-medium text-sm">{t.template_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.route_template_stops.length} stop{t.route_template_stops.length !== 1 ? "s" : ""}
                      {t.description && ` · ${t.description}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => useTemplate(t)} className="gap-1">
                      <Copy className="h-3.5 w-3.5" /> Use
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteTemplateMutation.mutate(t.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Template Name</Label>
              <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input value={templateDescription} onChange={(e) => setTemplateDescription(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              This saves the {templateSourceRoute?.route_stops.length || 0} stop{(templateSourceRoute?.route_stops.length || 0) !== 1 ? "s" : ""} from "{templateSourceRoute?.route_name}" as a reusable template. Vehicle/driver/attendant assignments are not included.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => saveAsTemplateMutation.mutate()} disabled={!templateName || saveAsTemplateMutation.isPending}>
              {saveAsTemplateMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Route History{historyRoute && ` — ${historyRoute.route_name}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {versionsLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : versions?.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No version history yet — history is recorded starting from the next save.
              </p>
            ) : (
              versions?.map((v, idx) => (
                <details key={v.id} className="rounded-lg border p-3">
                  <summary className="cursor-pointer flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      v{v.version_number} — {describeVersionChange(v, versions[idx + 1])}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(v.created_at).toLocaleString()}
                      {v.changed_by_name && ` · ${v.changed_by_name}`}
                    </span>
                  </summary>
                  <div className="mt-2 pt-2 border-t text-xs space-y-1.5">
                    <p><span className="text-muted-foreground">Name:</span> {v.route_name}{v.route_number && ` (${v.route_number})`}</p>
                    <p><span className="text-muted-foreground">Status:</span> {v.status}</p>
                    <p className="text-muted-foreground">Stops:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {v.stops_snapshot.map((s: any, i: number) => (
                        <span key={i} className="bg-muted rounded-full px-2 py-0.5">
                          {i + 1}. {s.stop_name}{s.pickup_time && ` · ${s.pickup_time}`}
                        </span>
                      ))}
                    </div>
                  </div>
                </details>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-3">
            {routes?.map((r) => (
              <div key={r.id} className="rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{r.route_name} {r.route_number && <span className="text-muted-foreground text-sm">({r.route_number})</span>}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.route_stops.length} stop{r.route_stops.length !== 1 ? "s" : ""}
                      {vehicles?.find((v) => v.id === r.vehicle_id) && ` · ${vehicles.find((v) => v.id === r.vehicle_id)?.registration_number}`}
                      {drivers?.find((d) => d.id === r.driver_id) && ` · ${drivers.find((d) => d.id === r.driver_id)?.name}`}
                      {attendants?.find((a) => a.id === r.attendant_id) && ` · ${attendants.find((a) => a.id === r.attendant_id)?.name} (Attendant)`}
                      {r.days_of_week && r.days_of_week.length > 0 && r.days_of_week.length < 7 &&
                        ` · ${r.days_of_week.map((d) => DAY_LABELS.find((l) => l.value === d)?.label).join(", ")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={r.status === "active" ? "default" : "secondary"} className="capitalize">{r.status}</Badge>
                    {(() => {
                      const runToday = isRouteRunningToday(r);
                      return (
                        <Badge
                          variant={runToday.running ? "default" : "outline"}
                          className={runToday.running ? "bg-emerald-500 hover:bg-emerald-500" : "text-muted-foreground"}
                        >
                          {runToday.running ? "Running Today" : runToday.reason}
                        </Badge>
                      );
                    })()}
                    <Button size="icon" variant="ghost" onClick={() => openSaveAsTemplate(r)} title="Save as Template">
                      <BookmarkPlus className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => { setHistoryRoute(r); setHistoryOpen(true); }} title="Version History">
                      <History className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => openEdit(r)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(r.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
                {r.route_stops.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {r.route_stops.map((s, i) => (
                      <span key={s.id || i} className="text-xs bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                        {i + 1}. {s.stop_name} {s.pickup_time && `· ${s.pickup_time}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {routes?.length === 0 && (
              <p className="text-center text-muted-foreground py-8">No routes added yet.</p>
            )}
          </div>
        )}
      </CardContent>
    </GlowCard>
  );
}

// ============================================================
// STUDENT ASSIGNMENT TAB
// ============================================================
export function AssignmentsTab({ schoolId }: { schoolId?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<StudentLite | null>(null);
  const [selectedClassName, setSelectedClassName] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [routeId, setRouteId] = useState("");
  const [pickupStopId, setPickupStopId] = useState("");
  const [dropStopId, setDropStopId] = useState("");
  const [fee, setFee] = useState("");
  const [feeStatus, setFeeStatus] = useState("pending");
  const [seatNumber, setSeatNumber] = useState("");

  const { data: assignments, isLoading } = useQuery({
    queryKey: ["transport-assignments", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_assignments")
        .select("*, students(id, full_name, class)")
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Assignment[];
    },
    enabled: !!schoolId,
  });

  const { data: routes } = useQuery({
    queryKey: ["transport-routes-with-capacity", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_routes")
        .select("*, route_stops(*), vehicles(capacity)")
        .eq("school_id", schoolId);
      if (error) throw error;
      return data as (TransportRoute & { vehicles: { capacity: number | null } | null })[];
    },
    enabled: !!schoolId,
  });

  // Fee Management is the source of truth for transport fee amounts —
  // pull each student's latest fee_payments.transport_amount so the
  // Student Assignment table reflects what Fee Management has on record.
  const { data: feePayments } = useQuery({
    queryKey: ["transport-fee-payments", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fee_payments" as any)
        .select("student_id, transport_amount, status, due_date, created_at")
        .eq("school_id", schoolId)
        .gt("transport_amount", 0)
        .order("due_date", { ascending: false });
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!schoolId,
  });

  const transportFeeByStudent = new Map<string, number>();
  const transportFeeStatusByStudent = new Map<string, string>();
  (feePayments || []).forEach((f: any) => {
    if (f.student_id && !transportFeeByStudent.has(f.student_id)) {
      transportFeeByStudent.set(f.student_id, f.transport_amount);
      transportFeeStatusByStudent.set(f.student_id, f.status);
    }
  });

  const { data: classesData } = useQuery({
    queryKey: ["transport-classes", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section")
        .eq("school_id", schoolId)
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string; section: string }[];
    },
    enabled: !!schoolId,
  });

  const uniqueClassNames = Array.from(new Set((classesData || []).map((c) => c.name)));
  const sectionsForSelectedClass = (classesData || [])
    .filter((c) => c.name === selectedClassName)
    .map((c) => c.section);

  const { data: studentResults } = useQuery({
    queryKey: ["transport-student-search", selectedClassName, selectedSection, schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, class")
        .eq("school_id", schoolId)
        .ilike("class", selectedClassName)
        .ilike("section", selectedSection)
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data as StudentLite[];
    },
    enabled: !!schoolId && !!selectedClassName && !!selectedSection,
  });

  const selectedRoute = routes?.find((r) => r.id === routeId);
  const routeCapacity = selectedRoute?.vehicles?.capacity ?? null;
  const takenSeats = new Set(
    (assignments || [])
      .filter((a) => a.route_id === routeId && a.status === "active" && a.id !== editing?.id)
      .map((a) => a.seat_number)
      .filter((n): n is number => n != null)
  );
  const seatsFilledCount = takenSeats.size;
  const availableSeats = routeCapacity != null
    ? Array.from({ length: routeCapacity }, (_, i) => i + 1).filter((n) => !takenSeats.has(n))
    : [];

  const suggestSeatForRoute = (newRouteId: string, excludeAssignmentId?: string) => {
    const route = routes?.find((r) => r.id === newRouteId);
    const capacity = route?.vehicles?.capacity ?? null;
    if (capacity == null) return "";
    const taken = new Set(
      (assignments || [])
        .filter((a) => a.route_id === newRouteId && a.status === "active" && a.id !== excludeAssignmentId)
        .map((a) => a.seat_number)
        .filter((n): n is number => n != null)
    );
    for (let i = 1; i <= capacity; i++) {
      if (!taken.has(i)) return String(i);
    }
    return "";
  };

  const resetForm = () => {
    setSelectedStudent(null); setRouteId(""); setPickupStopId(""); setDropStopId("");
    setFee(""); setFeeStatus("pending"); setSelectedClassName(""); setSelectedSection("");
    setSeatNumber(""); setEditing(null);
  };

  const openEdit = (a: Assignment) => {
    setEditing(a);
    setSelectedStudent(a.students ? { id: a.students.id, full_name: a.students.full_name, class: a.students.class } : null);
    setRouteId(a.route_id || "");
    setPickupStopId(a.pickup_stop_id || "");
    setDropStopId(a.drop_stop_id || "");
    setFee(a.transport_fee != null ? String(a.transport_fee) : "");
    setFeeStatus(a.fee_status || "pending");
    setSeatNumber(a.seat_number != null ? String(a.seat_number) : "");
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedStudent) throw new Error("Select a student first");
      const route = routes?.find((r) => r.id === routeId);
      const capacity = route?.vehicles?.capacity ?? null;
      if (routeId && capacity != null && !seatNumber) {
        throw new Error(`Bus is full (${seatsFilledCount}/${capacity} seats occupied)`);
      }
      const payload = {
        student_id: selectedStudent.id,
        route_id: routeId || null,
        pickup_stop_id: pickupStopId || null,
        drop_stop_id: dropStopId || null,
        route_name: route?.route_name || null,
        transport_fee: fee ? Number(fee) : null,
        fee_status: feeStatus,
        seat_number: seatNumber ? Number(seatNumber) : null,
      };
      if (editing) {
        const { error } = await supabase.from("transport_assignments")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("transport_assignments").insert({
          school_id: schoolId,
          status: "active",
          ...payload,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Assignment updated" : "Student assigned to route");
      queryClient.invalidateQueries({ queryKey: ["transport-assignments"] });
      setOpen(false);
      resetForm();
    },
    onError: (e: any) => toast.error(e.message || "Failed to save assignment"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("transport_assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Assignment removed");
      queryClient.invalidateQueries({ queryKey: ["transport-assignments"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to remove assignment"),
  });

  return (
    <GlowCard>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 p-2">
            <Users className="h-4 w-4 text-white" />
          </div>
          Student Transport Assignment
        </CardTitle>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="gap-1.5" onClick={() => { setEditing(null); }}><Plus className="h-4 w-4" /> Assign Student</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "Edit Assignment" : "Assign Student to Route"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Class & Section</Label>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <Select
                    value={selectedClassName}
                    onValueChange={(v) => { setSelectedClassName(v); setSelectedSection(""); setSelectedStudent(null); }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                    <SelectContent>
                      {uniqueClassNames.map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={selectedSection}
                    onValueChange={(v) => { setSelectedSection(v); setSelectedStudent(null); }}
                    disabled={!selectedClassName}
                  >
                    <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                    <SelectContent>
                      {sectionsForSelectedClass.map((sec) => (
                        <SelectItem key={sec} value={sec}>{sec}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Student</Label>
                {selectedStudent ? (
                  <div className="flex items-center justify-between rounded-lg border p-2 mt-1">
                    <span>{selectedStudent.full_name} {selectedStudent.class && `· ${selectedStudent.class}`}</span>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedStudent(null)}>Change</Button>
                  </div>
                ) : (
                  <Select
                    value=""
                    onValueChange={(v) => {
                      const s = studentResults?.find((r) => r.id === v);
                      if (s) setSelectedStudent(s);
                    }}
                    disabled={!selectedClassName || !selectedSection}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder={selectedClassName && selectedSection ? "Select student" : "Pick class & section first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {studentResults?.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Label>Route</Label>
                <Select
                  value={routeId}
                  onValueChange={(v) => {
                    setRouteId(v);
                    setPickupStopId("");
                    setDropStopId("");
                    setSeatNumber(suggestSeatForRoute(v, editing?.id));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select route" /></SelectTrigger>
                  <SelectContent>
                    {routes?.map((r) => <SelectItem key={r.id} value={r.id}>{r.route_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {routeId && (
                <div>
                  <div className="flex items-center justify-between">
                    <Label>Seat Number</Label>
                    {routeCapacity != null && (
                      <span className={`text-xs font-medium ${seatsFilledCount >= routeCapacity ? "text-red-600" : "text-muted-foreground"}`}>
                        {seatsFilledCount}/{routeCapacity} seats filled
                      </span>
                    )}
                  </div>
                  {routeCapacity == null ? (
                    <Input
                      type="number"
                      className="mt-1"
                      placeholder="Seat number (no capacity set for this bus)"
                      value={seatNumber}
                      onChange={(e) => setSeatNumber(e.target.value)}
                    />
                  ) : availableSeats.length === 0 && !editing ? (
                    <p className="text-xs text-red-600 mt-1.5">
                      Bus is full ({seatsFilledCount}/{routeCapacity}) — no seats available on this route.
                    </p>
                  ) : (
                    <Select value={seatNumber} onValueChange={setSeatNumber}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select seat" /></SelectTrigger>
                      <SelectContent>
                        {editing?.seat_number != null && !availableSeats.includes(editing.seat_number) && (
                          <SelectItem value={String(editing.seat_number)}>Seat {editing.seat_number} (current)</SelectItem>
                        )}
                        {availableSeats.map((n) => (
                          <SelectItem key={n} value={String(n)}>Seat {n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
              {selectedRoute && selectedRoute.route_stops.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Pickup Stop</Label>
                    <Select value={pickupStopId} onValueChange={setPickupStopId}>
                      <SelectTrigger><SelectValue placeholder="Select stop" /></SelectTrigger>
                      <SelectContent>
                        {selectedRoute.route_stops.map((s) => (
                          <SelectItem key={s.id} value={s.id!}>{s.stop_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Drop Stop</Label>
                    <Select value={dropStopId} onValueChange={setDropStopId}>
                      <SelectTrigger><SelectValue placeholder="Select stop" /></SelectTrigger>
                      <SelectContent>
                        {selectedRoute.route_stops.map((s) => (
                          <SelectItem key={s.id} value={s.id!}>{s.stop_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Transport Fee</Label>
                  <Input type="number" value={fee} onChange={(e) => setFee(e.target.value)} />
                </div>
                <div>
                  <Label>Fee Status</Label>
                  <Select value={feeStatus} onValueChange={setFeeStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="overdue">Overdue</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => saveMutation.mutate()} disabled={!selectedStudent || saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                {editing ? "Save Changes" : "Assign"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Seat</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Fee Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments?.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.students?.full_name || "—"}</TableCell>
                  <TableCell>{a.students?.class || "—"}</TableCell>
                  <TableCell>{routes?.find((r) => r.id === a.route_id)?.route_name || "—"}</TableCell>
                  <TableCell>{a.seat_number ?? "—"}</TableCell>
                  <TableCell>
                    {(() => {
                      const feeMgmtAmount = a.student_id ? transportFeeByStudent.get(a.student_id) : undefined;
                      if (feeMgmtAmount != null) {
                        return <span>₹{feeMgmtAmount} <span className="text-xs text-muted-foreground">(Fee Mgmt)</span></span>;
                      }
                      return a.transport_fee != null ? `₹${a.transport_fee}` : "—";
                    })()}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const feeMgmtStatus = a.student_id ? transportFeeStatusByStudent.get(a.student_id) : undefined;
                      const displayStatus = feeMgmtStatus || a.fee_status;
                      return (
                        <Badge variant={displayStatus === "paid" ? "default" : "secondary"} className="capitalize">
                          {displayStatus || "—"}
                          {feeMgmtStatus && <span className="ml-1 text-[10px] opacity-70 font-normal">(Fee Mgmt)</span>}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(a)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(a.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {assignments?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No students assigned yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </GlowCard>
  );
}
