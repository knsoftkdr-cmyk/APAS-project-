import { useMemo, useState } from "react";
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
import { toast } from "sonner";
import {
  Fuel, BarChart3, Plus, Loader2, ExternalLink,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from "recharts";

interface VehicleOption {
  id: string;
  registration_number: string;
}

type SubView = "logs" | "analytics";

function useVehicleOptions(schoolId?: string) {
  return useQuery({
    queryKey: ["fuel-vehicles", schoolId],
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

export function FuelManagementTab({ schoolId }: { schoolId?: string }) {
  const [subView, setSubView] = useState<SubView>("logs");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 bg-slate-100/70 p-1.5 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setSubView("logs")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 ${
            subView === "logs"
              ? "bg-blue-600 text-white border-blue-600 shadow-sm"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-800"
          }`}
        >
          <Fuel className="h-3.5 w-3.5" /> Fuel Logs
        </button>
        <button
          type="button"
          onClick={() => setSubView("analytics")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all duration-200 ${
            subView === "analytics"
              ? "bg-blue-600 text-white border-blue-600 shadow-sm"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-800"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" /> Fuel Consumption Analytics
        </button>
      </div>

      {subView === "logs" && <FuelLogsView schoolId={schoolId} />}
      {subView === "analytics" && <FuelAnalyticsView schoolId={schoolId} />}
    </div>
  );
}

// ============================================================
// FUEL LOGS
// ============================================================
interface FuelLogRow {
  id: string;
  vehicle_id: string;
  driver_id: string | null;
  fill_date: string;
  odometer_reading: number;
  fuel_quantity_liters: number;
  cost: number | null;
  fuel_station: string | null;
  notes: string | null;
  receipt_document_url: string | null;
  vehicles: { registration_number: string } | null;
  drivers: { name: string } | null;
}

function FuelLogsView({ schoolId }: { schoolId?: string }) {
  const queryClient = useQueryClient();
  const { data: vehicles } = useVehicleOptions(schoolId);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    vehicleId: "", fillDate: new Date().toISOString().slice(0, 10), odometer: "", liters: "", cost: "", station: "", notes: "",
  });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const { data: logs, isLoading } = useQuery({
    queryKey: ["fuel-logs", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_fuel_logs")
        .select("*, vehicles(registration_number), drivers(name)")
        .eq("school_id", schoolId)
        .order("fill_date", { ascending: false });
      if (error) throw error;
      return data as any as FuelLogRow[];
    },
    enabled: !!schoolId,
  });

  // Mileage per log: needs the PREVIOUS log (by odometer) for the same
  // vehicle to compute km/l. Assumes full-tank fill-ups.
  const mileageById = useMemo(() => {
    if (!logs) return new Map<string, number | null>();
    const byVehicle = new Map<string, FuelLogRow[]>();
    for (const log of logs) {
      const arr = byVehicle.get(log.vehicle_id) ?? [];
      arr.push(log);
      byVehicle.set(log.vehicle_id, arr);
    }
    const result = new Map<string, number | null>();
    for (const [, vehicleLogs] of byVehicle) {
      const sorted = [...vehicleLogs].sort((a, b) => a.odometer_reading - b.odometer_reading);
      for (let i = 0; i < sorted.length; i++) {
        if (i === 0) {
          result.set(sorted[i].id, null);
        } else {
          const distance = sorted[i].odometer_reading - sorted[i - 1].odometer_reading;
          const mileage = sorted[i].fuel_quantity_liters > 0 ? distance / sorted[i].fuel_quantity_liters : null;
          result.set(sorted[i].id, mileage);
        }
      }
    }
    return result;
  }, [logs]);

  const resetForm = () => {
    setOpen(false);
    setForm({ vehicleId: "", fillDate: new Date().toISOString().slice(0, 10), odometer: "", liters: "", cost: "", station: "", notes: "" });
    setReceiptFile(null);
  };

  const submit = async () => {
    if (!form.vehicleId || !form.fillDate || !form.odometer || !form.liters) {
      toast.error("Vehicle, date, odometer, and liters are required.");
      return;
    }
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();

    const { data: row, error } = await supabase
      .from("vehicle_fuel_logs")
      .insert({
        school_id: schoolId,
        vehicle_id: form.vehicleId,
        logged_by: user?.id,
        fill_date: form.fillDate,
        odometer_reading: Number(form.odometer),
        fuel_quantity_liters: Number(form.liters),
        cost: form.cost ? Number(form.cost) : null,
        fuel_station: form.station.trim() || null,
        notes: form.notes.trim() || null,
      })
      .select("id")
      .single();

    if (error || !row) {
      setSaving(false);
      toast.error("Failed to save: " + (error?.message ?? "unknown error"));
      return;
    }

    if (receiptFile) {
      const filePath = `fuel-receipts/${form.vehicleId}/${row.id}_${Date.now()}_${receiptFile.name}`;
      const { error: uploadError } = await supabase.storage.from("transport-documents").upload(filePath, receiptFile);
      if (uploadError) {
        toast.error("Log saved, but receipt upload failed: " + uploadError.message);
      } else {
        await supabase.from("vehicle_fuel_logs").update({ receipt_document_url: filePath }).eq("id", row.id);
      }
    }

    setSaving(false);
    toast.success("Fuel log added.");
    queryClient.invalidateQueries({ queryKey: ["fuel-logs"] });
    resetForm();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="flex items-center gap-2"><Fuel className="h-5 w-5" /> Fuel Logs</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" /> Log Fuel</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
        ) : !logs || logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fuel logs yet.</p>
        ) : (
          logs.map((log) => {
            const mileage = mileageById.get(log.id);
            return (
              <div key={log.id} className="flex items-center justify-between rounded-lg border p-3 flex-wrap gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {log.vehicles?.registration_number || "—"} · {log.fuel_quantity_liters} L
                    {log.cost != null && ` · ₹${log.cost}`}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {new Date(log.fill_date).toLocaleDateString()} · {log.odometer_reading} km
                    {log.drivers?.name && ` · ${log.drivers.name}`}
                    {log.fuel_station && ` · ${log.fuel_station}`}
                    {mileage != null && ` · ${mileage.toFixed(1)} km/l`}
                  </p>
                </div>
                {log.receipt_document_url && <ReceiptLink path={log.receipt_document_url} />}
              </div>
            );
          })
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && resetForm()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Log Fuel</DialogTitle></DialogHeader>
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
              <Label className="text-xs">Fill Date</Label>
              <Input type="date" value={form.fillDate} onChange={(e) => setForm({ ...form, fillDate: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Odometer (km)</Label>
                <Input type="number" value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Liters</Label>
                <Input type="number" value={form.liters} onChange={(e) => setForm({ ...form, liters: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Cost (₹)</Label>
                <Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Fuel Station</Label>
                <Input value={form.station} onChange={(e) => setForm({ ...form, station: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Receipt (optional)</Label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
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

function ReceiptLink({ path }: { path: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="gap-1 text-blue-600 shrink-0"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        const { data } = await supabase.storage.from("transport-documents").createSignedUrl(path, 3600);
        setLoading(false);
        if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noreferrer");
        else toast.error("Failed to load receipt.");
      }}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} Receipt
    </Button>
  );
}

// ============================================================
// ANALYTICS
// ============================================================
function FuelAnalyticsView({ schoolId }: { schoolId?: string }) {
  const { data: vehicles } = useVehicleOptions(schoolId);
  const [selectedVehicle, setSelectedVehicle] = useState<string>("all");

  const { data: logs, isLoading } = useQuery({
    queryKey: ["fuel-logs-analytics", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_fuel_logs")
        .select("id, vehicle_id, fill_date, odometer_reading, fuel_quantity_liters, cost, vehicles(registration_number)")
        .eq("school_id", schoolId)
        .order("odometer_reading", { ascending: true });
      if (error) throw error;
      return data as any as (FuelLogRow & { vehicles: { registration_number: string } | null })[];
    },
    enabled: !!schoolId,
  });

  // Fleet-wide cost per vehicle
  const fleetCostData = useMemo(() => {
    if (!logs) return [];
    const totals = new Map<string, { name: string; cost: number; liters: number }>();
    for (const log of logs) {
      const key = log.vehicle_id;
      const name = log.vehicles?.registration_number || "Unknown";
      const existing = totals.get(key) ?? { name, cost: 0, liters: 0 };
      existing.cost += log.cost ?? 0;
      existing.liters += log.fuel_quantity_liters;
      totals.set(key, existing);
    }
    return Array.from(totals.values());
  }, [logs]);

  // Per-vehicle mileage trend (only when a specific vehicle is selected)
  const mileageTrend = useMemo(() => {
    if (!logs || selectedVehicle === "all") return [];
    const vehicleLogs = logs.filter((l) => l.vehicle_id === selectedVehicle).sort((a, b) => a.odometer_reading - b.odometer_reading);
    const points: { date: string; mileage: number }[] = [];
    for (let i = 1; i < vehicleLogs.length; i++) {
      const distance = vehicleLogs[i].odometer_reading - vehicleLogs[i - 1].odometer_reading;
      const mileage = vehicleLogs[i].fuel_quantity_liters > 0 ? distance / vehicleLogs[i].fuel_quantity_liters : 0;
      points.push({ date: new Date(vehicleLogs[i].fill_date).toLocaleDateString(), mileage: Number(mileage.toFixed(2)) });
    }
    return points;
  }, [logs, selectedVehicle]);

  const totalSpend = fleetCostData.reduce((sum, v) => sum + v.cost, 0);
  const totalLiters = fleetCostData.reduce((sum, v) => sum + v.liters, 0);
  const avgCostPerLiter = totalLiters > 0 ? totalSpend / totalLiters : 0;

  if (isLoading) {
    return (
      <Card><CardContent className="pt-6">
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading analytics...</p>
      </CardContent></Card>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <Card><CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">No fuel data yet — analytics will appear once fuel logs are added.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">Total Fuel Spend</p>
          <p className="text-2xl font-semibold">₹{totalSpend.toLocaleString()}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">Total Liters</p>
          <p className="text-2xl font-semibold">{totalLiters.toFixed(0)} L</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">Avg Cost / Liter</p>
          <p className="text-2xl font-semibold">₹{avgCostPerLiter.toFixed(2)}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Fleet Fuel Cost by Vehicle</CardTitle></CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={fleetCostData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: number) => [`₹${value.toLocaleString()}`, "Cost"]} />
                <Bar dataKey="cost" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Mileage Trend</CardTitle>
          <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Select a vehicle</SelectItem>
              {(vehicles ?? []).map((v) => (<SelectItem key={v.id} value={v.id}>{v.registration_number}</SelectItem>))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {selectedVehicle === "all" ? (
            <p className="text-sm text-muted-foreground">Select a vehicle above to see its mileage trend over time.</p>
          ) : mileageTrend.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not enough fuel logs for this vehicle yet — mileage needs at least two fill-ups.</p>
          ) : (
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={mileageTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} unit=" km/l" />
                  <Tooltip formatter={(value: number) => [`${value} km/l`, "Mileage"]} />
                  <Line type="monotone" dataKey="mileage" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
