import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Wrench, CalendarClock, FileText, ShieldCheck, Plus, Loader2, Car, ExternalLink,
  Sparkles, AlertTriangle,
} from "lucide-react";

// ============================================================
// Shared types & helpers
// ============================================================
interface VehicleOption {
  id: string;
  registration_number: string;
}

type SubView = "schedule" | "service" | "amc" | "breakdown" | "ai";

const SUB_VIEWS: { id: SubView; label: string; icon: typeof Wrench }[] = [
  { id: "schedule", label: "Maintenance Schedule", icon: CalendarClock },
  { id: "service", label: "Service History", icon: Wrench },
  { id: "amc", label: "AMC Management", icon: ShieldCheck },
  { id: "breakdown", label: "Breakdown Tracking", icon: FileText },
  { id: "ai", label: "AI Predictive Maintenance", icon: Sparkles },
];

function useVehicleOptions(schoolId?: string) {
  return useQuery({
    queryKey: ["maintenance-vehicles", schoolId],
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
}

// ============================================================
// MAIN TAB
// ============================================================
export function VehicleMaintenanceTab({ schoolId }: { schoolId?: string }) {
  const [subView, setSubView] = useState<SubView>("schedule");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 bg-slate-100/70 p-1.5 rounded-xl w-fit">
        {SUB_VIEWS.map((v) => {
          const Icon = v.icon;
          const active = subView === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setSubView(v.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 ${
                active
                  ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-800"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {v.label}
            </button>
          );
        })}
      </div>

      {subView === "schedule" && <MaintenanceScheduleView schoolId={schoolId} />}
      {subView === "service" && <ServiceHistoryView schoolId={schoolId} />}
      {subView === "amc" && <AmcManagementView schoolId={schoolId} />}
      {subView === "breakdown" && <BreakdownTrackingView schoolId={schoolId} />}
      {subView === "ai" && <AiPredictiveMaintenanceView schoolId={schoolId} />}
    </div>
  );
}

// ============================================================
// MAINTENANCE SCHEDULE
// ============================================================
interface ScheduleRow {
  id: string;
  vehicle_id: string;
  maintenance_type: string;
  scheduled_date: string;
  status: "upcoming" | "completed" | "overdue" | "cancelled";
  notes: string | null;
  vehicles: { registration_number: string } | null;
}

const SCHEDULE_STATUS_COLORS: Record<string, string> = {
  upcoming: "bg-blue-50 text-blue-700 border-blue-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  overdue: "bg-red-50 text-red-600 border-red-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

function MaintenanceScheduleView({ schoolId }: { schoolId?: string }) {
  const queryClient = useQueryClient();
  const { data: vehicles } = useVehicleOptions(schoolId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ vehicleId: "", maintenanceType: "", scheduledDate: "", notes: "" });

  const { data: schedules, isLoading } = useQuery({
    queryKey: ["maintenance-schedules", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_maintenance_schedules")
        .select("*, vehicles(registration_number)")
        .eq("school_id", schoolId)
        .order("scheduled_date", { ascending: true });
      if (error) throw error;
      return data as any as ScheduleRow[];
    },
    enabled: !!schoolId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("vehicle_maintenance_schedules").insert({
        school_id: schoolId,
        vehicle_id: form.vehicleId,
        maintenance_type: form.maintenanceType.trim(),
        scheduled_date: form.scheduledDate,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Maintenance scheduled.");
      queryClient.invalidateQueries({ queryKey: ["maintenance-schedules"] });
      setOpen(false);
      setForm({ vehicleId: "", maintenanceType: "", scheduledDate: "", notes: "" });
    },
    onError: (e: any) => toast.error(e.message || "Failed to schedule maintenance"),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("vehicle_maintenance_schedules").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status updated.");
      queryClient.invalidateQueries({ queryKey: ["maintenance-schedules"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to update status"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5" /> Maintenance Schedule
        </CardTitle>
        <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Schedule Maintenance
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </p>
        ) : !schedules || schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No maintenance scheduled yet.</p>
        ) : (
          schedules.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border p-3 flex-wrap gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="rounded-full bg-muted p-2 shrink-0"><Car className="h-4 w-4" /></div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {s.maintenance_type} — {s.vehicles?.registration_number || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    Due {new Date(s.scheduled_date).toLocaleDateString()}
                    {s.notes && ` · ${s.notes}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className={SCHEDULE_STATUS_COLORS[s.status]}>{s.status}</Badge>
                {s.status === "upcoming" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: s.id, status: "completed" })}>
                      Mark Completed
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => statusMutation.mutate({ id: s.id, status: "cancelled" })}>
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Schedule Maintenance</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Vehicle</Label>
              <Select value={form.vehicleId} onValueChange={(v) => setForm({ ...form, vehicleId: v })}>
                <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                <SelectContent>
                  {(vehicles ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.registration_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Maintenance Type</Label>
              <Input
                value={form.maintenanceType}
                onChange={(e) => setForm({ ...form, maintenanceType: e.target.value })}
                placeholder="e.g. Oil change, Tire rotation"
              />
            </div>
            <div>
              <Label className="text-xs">Scheduled Date</Label>
              <Input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saveMutation.isPending}>Cancel</Button>
            <Button
              onClick={() => {
                if (!form.vehicleId || !form.maintenanceType.trim() || !form.scheduledDate) {
                  toast.error("Vehicle, maintenance type, and date are required.");
                  return;
                }
                saveMutation.mutate();
              }}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================
// SERVICE HISTORY
// ============================================================
interface ServiceRow {
  id: string;
  vehicle_id: string;
  service_date: string;
  service_type: string;
  vendor_name: string | null;
  cost: number | null;
  odometer_reading: number | null;
  notes: string | null;
  invoice_document_url: string | null;
  vehicles: { registration_number: string } | null;
}

function ServiceHistoryView({ schoolId }: { schoolId?: string }) {
  const queryClient = useQueryClient();
  const { data: vehicles } = useVehicleOptions(schoolId);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    vehicleId: "", serviceDate: "", serviceType: "", vendorName: "", cost: "", odometer: "", notes: "",
  });
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);

  const { data: records, isLoading } = useQuery({
    queryKey: ["service-history", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_service_history")
        .select("*, vehicles(registration_number)")
        .eq("school_id", schoolId)
        .order("service_date", { ascending: false });
      if (error) throw error;
      return data as any as ServiceRow[];
    },
    enabled: !!schoolId,
  });

  const resetForm = () => {
    setOpen(false);
    setForm({ vehicleId: "", serviceDate: "", serviceType: "", vendorName: "", cost: "", odometer: "", notes: "" });
    setInvoiceFile(null);
  };

  const submit = async () => {
    if (!form.vehicleId || !form.serviceDate || !form.serviceType.trim()) {
      toast.error("Vehicle, service date, and service type are required.");
      return;
    }
    setSaving(true);

    const { data: row, error } = await supabase
      .from("vehicle_service_history")
      .insert({
        school_id: schoolId,
        vehicle_id: form.vehicleId,
        service_date: form.serviceDate,
        service_type: form.serviceType.trim(),
        vendor_name: form.vendorName.trim() || null,
        cost: form.cost ? Number(form.cost) : null,
        odometer_reading: form.odometer ? Number(form.odometer) : null,
        notes: form.notes.trim() || null,
      })
      .select("id")
      .single();

    if (error || !row) {
      setSaving(false);
      toast.error("Failed to save: " + (error?.message ?? "unknown error"));
      return;
    }

    if (invoiceFile) {
      const filePath = `maintenance/${form.vehicleId}/service_${row.id}_${Date.now()}_${invoiceFile.name}`;
      const { error: uploadError } = await supabase.storage.from("transport-documents").upload(filePath, invoiceFile);
      if (uploadError) {
        toast.error("Record saved, but invoice upload failed: " + uploadError.message);
      } else {
        await supabase.from("vehicle_service_history").update({ invoice_document_url: filePath }).eq("id", row.id);
      }
    }

    setSaving(false);
    toast.success("Service record added.");
    queryClient.invalidateQueries({ queryKey: ["service-history"] });
    resetForm();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" /> Service History</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" /> Log Service</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
        ) : !records || records.length === 0 ? (
          <p className="text-sm text-muted-foreground">No service records yet.</p>
        ) : (
          records.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border p-3 flex-wrap gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{r.service_type} — {r.vehicles?.registration_number || "—"}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {new Date(r.service_date).toLocaleDateString()}
                  {r.vendor_name && ` · ${r.vendor_name}`}
                  {r.cost != null && ` · ₹${r.cost}`}
                  {r.odometer_reading != null && ` · ${r.odometer_reading} km`}
                </p>
              </div>
              {r.invoice_document_url && (
                <InvoiceLink path={r.invoice_document_url} />
              )}
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && resetForm()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Log Service</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Vehicle</Label>
              <Select value={form.vehicleId} onValueChange={(v) => setForm({ ...form, vehicleId: v })}>
                <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                <SelectContent>
                  {(vehicles ?? []).map((v) => (<SelectItem key={v.id} value={v.id}>{v.registration_number}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Service Date</Label>
              <Input type="date" value={form.serviceDate} onChange={(e) => setForm({ ...form, serviceDate: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Service Type</Label>
              <Input value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} placeholder="e.g. General service, Brake repair" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Vendor</Label>
                <Input value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Cost (₹)</Label>
                <Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Odometer Reading (km)</Label>
              <Input type="number" value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Invoice (optional)</Label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-muted file:text-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function InvoiceLink({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchUrl = async () => {
    if (url) return url;
    setLoading(true);
    const { data } = await supabase.storage.from("transport-documents").createSignedUrl(path, 3600);
    setLoading(false);
    if (data?.signedUrl) {
      setUrl(data.signedUrl);
      return data.signedUrl;
    }
    return null;
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      className="gap-1 text-blue-600 shrink-0"
      disabled={loading}
      onClick={async () => {
        const u = await fetchUrl();
        if (u) window.open(u, "_blank", "noreferrer");
        else toast.error("Failed to load invoice.");
      }}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} Invoice
    </Button>
  );
}

// ============================================================
// AMC MANAGEMENT
// ============================================================
interface AmcRow {
  id: string;
  vehicle_id: string;
  vendor_name: string;
  contract_number: string | null;
  start_date: string;
  end_date: string;
  coverage_details: string | null;
  cost: number | null;
  contract_document_url: string | null;
  status: "active" | "expired" | "cancelled";
  vehicles: { registration_number: string } | null;
}

const AMC_STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expired: "bg-red-50 text-red-600 border-red-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

function AmcManagementView({ schoolId }: { schoolId?: string }) {
  const queryClient = useQueryClient();
  const { data: vehicles } = useVehicleOptions(schoolId);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    vehicleId: "", vendorName: "", contractNumber: "", startDate: "", endDate: "", coverage: "", cost: "",
  });
  const [contractFile, setContractFile] = useState<File | null>(null);

  const { data: contracts, isLoading } = useQuery({
    queryKey: ["amc-contracts", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_amc_contracts")
        .select("*, vehicles(registration_number)")
        .eq("school_id", schoolId)
        .order("end_date", { ascending: true });
      if (error) throw error;
      return data as any as AmcRow[];
    },
    enabled: !!schoolId,
  });

  const resetForm = () => {
    setOpen(false);
    setForm({ vehicleId: "", vendorName: "", contractNumber: "", startDate: "", endDate: "", coverage: "", cost: "" });
    setContractFile(null);
  };

  const submit = async () => {
    if (!form.vehicleId || !form.vendorName.trim() || !form.startDate || !form.endDate) {
      toast.error("Vehicle, vendor, start date, and end date are required.");
      return;
    }
    if (form.endDate < form.startDate) {
      toast.error("End date must be after start date.");
      return;
    }
    setSaving(true);

    const { data: row, error } = await supabase
      .from("vehicle_amc_contracts")
      .insert({
        school_id: schoolId,
        vehicle_id: form.vehicleId,
        vendor_name: form.vendorName.trim(),
        contract_number: form.contractNumber.trim() || null,
        start_date: form.startDate,
        end_date: form.endDate,
        coverage_details: form.coverage.trim() || null,
        cost: form.cost ? Number(form.cost) : null,
      })
      .select("id")
      .single();

    if (error || !row) {
      setSaving(false);
      toast.error("Failed to save: " + (error?.message ?? "unknown error"));
      return;
    }

    if (contractFile) {
      const filePath = `maintenance/${form.vehicleId}/amc_${row.id}_${Date.now()}_${contractFile.name}`;
      const { error: uploadError } = await supabase.storage.from("transport-documents").upload(filePath, contractFile);
      if (uploadError) {
        toast.error("Contract saved, but document upload failed: " + uploadError.message);
      } else {
        await supabase.from("vehicle_amc_contracts").update({ contract_document_url: filePath }).eq("id", row.id);
      }
    }

    setSaving(false);
    toast.success("AMC contract added.");
    queryClient.invalidateQueries({ queryKey: ["amc-contracts"] });
    resetForm();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> AMC Management</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" /> Add Contract</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
        ) : !contracts || contracts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AMC contracts yet.</p>
        ) : (
          contracts.map((c) => {
            const isExpired = new Date(c.end_date) < new Date() && c.status === "active";
            const displayStatus = isExpired ? "expired" : c.status;
            return (
              <div key={c.id} className="flex items-center justify-between rounded-lg border p-3 flex-wrap gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{c.vendor_name} — {c.vehicles?.registration_number || "—"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {new Date(c.start_date).toLocaleDateString()} – {new Date(c.end_date).toLocaleDateString()}
                    {c.contract_number && ` · ${c.contract_number}`}
                    {c.cost != null && ` · ₹${c.cost}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={AMC_STATUS_COLORS[displayStatus]}>{displayStatus}</Badge>
                  {c.contract_document_url && <InvoiceLink path={c.contract_document_url} />}
                </div>
              </div>
            );
          })
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && resetForm()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add AMC Contract</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Vehicle</Label>
              <Select value={form.vehicleId} onValueChange={(v) => setForm({ ...form, vehicleId: v })}>
                <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                <SelectContent>
                  {(vehicles ?? []).map((v) => (<SelectItem key={v.id} value={v.id}>{v.registration_number}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Vendor Name</Label>
              <Input value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Contract Number (optional)</Label>
              <Input value={form.contractNumber} onChange={(e) => setForm({ ...form, contractNumber: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Start Date</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">End Date</Label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Cost (₹, optional)</Label>
              <Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Coverage Details</Label>
              <Textarea rows={2} value={form.coverage} onChange={(e) => setForm({ ...form, coverage: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Contract Document (optional)</Label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setContractFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-muted file:text-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================
// BREAKDOWN TRACKING (read-only view of transport_incidents, breakdown type)
// ============================================================
interface BreakdownRow {
  id: string;
  severity: string;
  description: string;
  status: string;
  occurred_at: string;
  transport_routes: { route_name: string } | null;
  drivers: { name: string } | null;
}

const BD_STATUS_COLORS: Record<string, string> = {
  reported: "bg-blue-50 text-blue-700 border-blue-200",
  acknowledged: "bg-amber-50 text-amber-700 border-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function BreakdownTrackingView({ schoolId }: { schoolId?: string }) {
  const { data: records, isLoading } = useQuery({
    queryKey: ["breakdown-tracking", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_incidents")
        .select("id, severity, description, status, occurred_at, transport_routes(route_name), drivers(name)")
        .eq("school_id", schoolId)
        .eq("incident_type", "breakdown")
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return data as any as BreakdownRow[];
    },
    enabled: !!schoolId,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Breakdown Tracking</CardTitle>
        <p className="text-xs text-muted-foreground">
          Sourced from driver-reported incidents. Manage status from the Incidents tab.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
        ) : !records || records.length === 0 ? (
          <p className="text-sm text-muted-foreground">No breakdowns reported.</p>
        ) : (
          records.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border p-3 flex-wrap gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{r.transport_routes?.route_name || "Route"} · {r.drivers?.name || "—"}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {new Date(r.occurred_at).toLocaleString()} · {r.description}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline">{r.severity}</Badge>
                <Badge variant="outline" className={BD_STATUS_COLORS[r.status]}>{r.status}</Badge>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// AI PREDICTIVE MAINTENANCE
// ============================================================
interface PredictionRow {
  vehicle_id: string;
  risk_level: "low" | "medium" | "high";
  summary: string;
  predicted_issues: { issue: string; reasoning: string }[];
  recommended_actions: { action: string; urgency: "immediate" | "soon" | "routine" }[];
  next_service_estimate: string | null;
  generated_at: string;
}

const RISK_COLORS: Record<string, string> = {
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-red-50 text-red-600 border-red-200",
};

const URGENCY_COLORS: Record<string, string> = {
  immediate: "bg-red-50 text-red-600 border-red-200",
  soon: "bg-amber-50 text-amber-700 border-amber-200",
  routine: "bg-slate-100 text-slate-600 border-slate-200",
};

function AiPredictiveMaintenanceView({ schoolId }: { schoolId?: string }) {
  const queryClient = useQueryClient();
  const { data: vehicles } = useVehicleOptions(schoolId);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");

  const { data: prediction, isLoading: loadingPrediction } = useQuery({
    queryKey: ["maintenance-prediction", selectedVehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_maintenance_predictions")
        .select("*")
        .eq("vehicle_id", selectedVehicleId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as PredictionRow | null;
    },
    enabled: !!selectedVehicleId,
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("predict-vehicle-maintenance", {
        body: { vehicle_id: selectedVehicleId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.prediction;
    },
    onSuccess: () => {
      toast.success("Analysis complete.");
      queryClient.invalidateQueries({ queryKey: ["maintenance-prediction", selectedVehicleId] });
    },
    onError: (e: any) => toast.error(e.message || "Analysis failed"),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-500" /> AI Predictive Maintenance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px]">
              <Label className="text-xs">Vehicle</Label>
              <Select value={selectedVehicleId} onValueChange={setSelectedVehicleId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a vehicle" />
                </SelectTrigger>
                <SelectContent>
                  {(vehicles || []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.registration_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => analyzeMutation.mutate()}
              disabled={!selectedVehicleId || analyzeMutation.isPending}
            >
              {analyzeMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Analyzing...</>
              ) : prediction ? (
                <><Sparkles className="h-4 w-4 mr-1.5" /> Re-analyze</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-1.5" /> Analyze</>
              )}
            </Button>
          </div>

          {!selectedVehicleId ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Select a vehicle to view or run an AI maintenance analysis.
            </p>
          ) : loadingPrediction ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !prediction && !analyzeMutation.isPending ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No analysis yet for this vehicle. Click Analyze to generate one.
            </p>
          ) : prediction ? (
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <Badge variant="outline" className={`text-xs ${RISK_COLORS[prediction.risk_level]}`}>
                  {prediction.risk_level.toUpperCase()} RISK
                </Badge>
                <p className="text-xs text-muted-foreground">
                  Last analyzed {new Date(prediction.generated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" })}
                </p>
              </div>

              <p className="text-sm text-slate-700">{prediction.summary}</p>

              {prediction.next_service_estimate && (
                <div className="flex items-center gap-2 text-sm bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                  <CalendarClock className="h-4 w-4 text-blue-500 shrink-0" />
                  <span className="font-medium text-blue-800">Next service:</span>
                  <span className="text-blue-700">{prediction.next_service_estimate}</span>
                </div>
              )}

              {prediction.predicted_issues?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1.5">Predicted Issues</p>
                  <div className="space-y-1.5">
                    {prediction.predicted_issues.map((issue, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-slate-800">{issue.issue}</p>
                          <p className="text-xs text-muted-foreground">{issue.reasoning}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {prediction.recommended_actions?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1.5">Recommended Actions</p>
                  <div className="space-y-1.5">
                    {prediction.recommended_actions.map((rec, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2">
                        <span className="text-slate-800">{rec.action}</span>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${URGENCY_COLORS[rec.urgency]}`}>
                          {rec.urgency}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
