/**
 * ExecutiveDashboardTab.tsx
 * Top-level "Executive Dashboard" tab — four computed sections in one
 * screen, no AI involved (pure aggregation over existing tables):
 *
 * 1. Fleet Utilization — vehicle/driver counts, avg capacity fill %, trips (30d)
 * 2. Transport Costs — fuel + service + AMC costs (30d, AMC = active contracts)
 * 3. Safety KPIs — incidents, SOS alerts, speed violations, on-time % (30d)
 * 4. Compliance Status — vehicles/drivers with expired or soon-expiring documents
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  Bus, Users, Gauge, Timer, Fuel, Wrench, ShieldCheck, AlertTriangle,
  Siren, TrendingUp, FileWarning, CheckCircle2,
} from "lucide-react";
import { format, subDays } from "date-fns";

interface Props {
  schoolId: string;
}

const THIRTY_DAYS = 30;
const EXPIRY_WARNING_DAYS = 30;
const ON_TIME_THRESHOLD_MINUTES = 5;

function KpiCard({ icon: Icon, label, value, valueColor, sub }: {
  icon: any; label: string; value: string | number; valueColor?: string; sub?: string;
}) {
  return (
    <Card className="p-4 rounded-2xl border-slate-200/70">
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className={`text-2xl font-bold ${valueColor || "text-slate-800"}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </Card>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}

export default function ExecutiveDashboardTab({ schoolId }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);

  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [serviceHistory, setServiceHistory] = useState<any[]>([]);
  const [amcContracts, setAmcContracts] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [sosAlerts, setSosAlerts] = useState<any[]>([]);
  const [speedViolations, setSpeedViolations] = useState<any[]>([]);

  const startDateStr = useMemo(() => format(subDays(new Date(), THIRTY_DAYS - 1), "yyyy-MM-dd"), []);
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const startDateTimeStr = useMemo(() => subDays(new Date(), THIRTY_DAYS).toISOString(), []);

  const fetchData = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [
        vehiclesRes, driversRes, assignmentsRes, routesRes, tripsRes,
        fuelRes, serviceRes, amcRes, incidentsRes, sosRes, speedRes,
      ] = await Promise.all([
        supabase.from("vehicles").select("id, registration_number, capacity, status, insurance_expiry, fitness_expiry, permit_expiry, puc_expiry").eq("school_id", schoolId),
        supabase.from("drivers").select("id, name, status, license_expiry, medical_certificate_expiry").eq("school_id", schoolId),
        supabase.from("transport_assignments").select("route_id, status").eq("school_id", schoolId).eq("status", "active"),
        supabase.from("transport_routes").select("id, vehicle_id").eq("school_id", schoolId),
        supabase.from("trips").select("status, started_at, scheduled_start_time, trip_date").eq("school_id", schoolId).gte("trip_date", startDateStr).lte("trip_date", todayStr),
        supabase.from("vehicle_fuel_logs").select("cost, fuel_quantity_liters").eq("school_id", schoolId).gte("fill_date", startDateStr).lte("fill_date", todayStr),
        supabase.from("vehicle_service_history").select("cost").eq("school_id", schoolId).gte("service_date", startDateStr).lte("service_date", todayStr),
        supabase.from("vehicle_amc_contracts").select("cost").eq("school_id", schoolId).eq("status", "active"),
        supabase.from("transport_incidents").select("severity, status, occurred_at").eq("school_id", schoolId).gte("occurred_at", startDateTimeStr),
        supabase.from("sos_alerts").select("status, created_at").eq("school_id", schoolId).gte("created_at", startDateTimeStr),
        supabase.from("governance_notifications").select("id, created_at").eq("event_type", "vehicle_overspeed").gte("created_at", startDateTimeStr),
      ]);

      setVehicles(vehiclesRes.data || []);
      setDrivers(driversRes.data || []);
      setAssignments(assignmentsRes.data || []);
      setRoutes(routesRes.data || []);
      setTrips(tripsRes.data || []);
      setFuelLogs(fuelRes.data || []);
      setServiceHistory(serviceRes.data || []);
      setAmcContracts(amcRes.data || []);
      setIncidents(incidentsRes.data || []);
      setSosAlerts(sosRes.data || []);
      setSpeedViolations(speedRes.data || []);
    } catch (e: any) {
      toast({ title: "Error loading executive dashboard", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [schoolId, startDateStr, todayStr, startDateTimeStr, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Fleet Utilization ────────────────────────────────────────────────────────
  const fleet = useMemo(() => {
    const activeVehicles = vehicles.filter(v => v.status === "active").length;
    const activeDrivers = drivers.filter(d => d.status === "active").length;

    const routeIdToVehicle = new Map(routes.map(r => [r.id, r.vehicle_id]));
    const vehicleCapacity = new Map(vehicles.map(v => [v.id, v.capacity || 0]));
    const assignedByVehicle = new Map<string, number>();
    for (const a of assignments) {
      const vehicleId = a.route_id ? routeIdToVehicle.get(a.route_id) : null;
      if (!vehicleId) continue;
      assignedByVehicle.set(vehicleId, (assignedByVehicle.get(vehicleId) || 0) + 1);
    }
    const fillPcts: number[] = [];
    for (const [vehicleId, count] of assignedByVehicle.entries()) {
      const cap = vehicleCapacity.get(vehicleId);
      if (cap) fillPcts.push((count / cap) * 100);
    }
    const avgFillPct = fillPcts.length > 0 ? Math.round(fillPcts.reduce((s, v) => s + v, 0) / fillPcts.length) : null;

    return {
      totalVehicles: vehicles.length,
      activeVehicles,
      totalDrivers: drivers.length,
      activeDrivers,
      avgFillPct,
      tripsLast30d: trips.length,
    };
  }, [vehicles, drivers, routes, assignments, trips]);

  // ── Transport Costs ──────────────────────────────────────────────────────────
  const costs = useMemo(() => {
    const fuelCost = fuelLogs.reduce((s, f) => s + (Number(f.cost) || 0), 0);
    const fuelLiters = fuelLogs.reduce((s, f) => s + (Number(f.fuel_quantity_liters) || 0), 0);
    const serviceCost = serviceHistory.reduce((s, r) => s + (Number(r.cost) || 0), 0);
    const amcCost = amcContracts.reduce((s, c) => s + (Number(c.cost) || 0), 0);
    return {
      fuelCost, fuelLiters, serviceCost, amcCost,
      totalOperatingCost: fuelCost + serviceCost,
    };
  }, [fuelLogs, serviceHistory, amcContracts]);

  // ── Safety KPIs ───────────────────────────────────────────────────────────────
  function delayMinutes(tripDate: string, scheduledStartTime: string, startedAtIso: string): number {
    const scheduled = new Date(`${tripDate}T${scheduledStartTime}`);
    const actual = new Date(startedAtIso);
    return Math.round((actual.getTime() - scheduled.getTime()) / 60000);
  }
  const safety = useMemo(() => {
    const highSeverityIncidents = incidents.filter(i => i.severity === "high" || i.severity === "critical").length;
    const unresolvedSos = sosAlerts.filter(s => !s.status || s.status !== "resolved").length;

    const completedWithSchedule = trips.filter(
      (t: any) => t.status === "completed" && t.started_at && t.scheduled_start_time
    );
    const onTimeCount = completedWithSchedule.filter((t: any) => {
      const delay = delayMinutes(t.trip_date, t.scheduled_start_time, t.started_at);
      return delay <= ON_TIME_THRESHOLD_MINUTES;
    }).length;
    const onTimePct = completedWithSchedule.length > 0
      ? Math.round((onTimeCount / completedWithSchedule.length) * 100)
      : null;

    return {
      incidentCount: incidents.length,
      highSeverityIncidents,
      sosCount: sosAlerts.length,
      unresolvedSos,
      speedViolationCount: speedViolations.length,
      onTimePct,
    };
  }, [incidents, sosAlerts, speedViolations, trips]);

  // ── Compliance Status ────────────────────────────────────────────────────────
  const compliance = useMemo(() => {
    const today = new Date();
    const warningDate = subDays(new Date(Date.now() + EXPIRY_WARNING_DAYS * 86400000), 0);

    function status(dateStr: string | null): "expired" | "expiring" | "ok" | "missing" {
      if (!dateStr) return "missing";
      const d = new Date(dateStr);
      if (d < today) return "expired";
      if (d <= warningDate) return "expiring";
      return "ok";
    }

    const vehicleIssues: { label: string; issues: string[] }[] = [];
    for (const v of vehicles) {
      const checks: [string, string | null][] = [
        ["Insurance", v.insurance_expiry], ["Fitness", v.fitness_expiry],
        ["Permit", v.permit_expiry], ["PUC", v.puc_expiry],
      ];
      const issues: string[] = [];
      for (const [label, date] of checks) {
        const s = status(date);
        if (s === "expired") issues.push(`${label} expired`);
        else if (s === "expiring") issues.push(`${label} expiring soon`);
      }
      if (issues.length > 0) vehicleIssues.push({ label: v.registration_number, issues });
    }

    const driverIssues: { label: string; issues: string[] }[] = [];
    for (const d of drivers) {
      const checks: [string, string | null][] = [
        ["License", d.license_expiry], ["Medical cert.", d.medical_certificate_expiry],
      ];
      const issues: string[] = [];
      for (const [label, date] of checks) {
        const s = status(date);
        if (s === "expired") issues.push(`${label} expired`);
        else if (s === "expiring") issues.push(`${label} expiring soon`);
      }
      if (issues.length > 0) driverIssues.push({ label: d.name, issues });
    }

    return {
      vehicleIssues,
      driverIssues,
      compliantVehicles: vehicles.length - vehicleIssues.length,
      compliantDrivers: drivers.length - driverIssues.length,
    };
  }, [vehicles, drivers]);

  if (loading) {
    return <div className="flex justify-center py-16"><LoadingSpinner /></div>;
  }

  return (
    <div className="space-y-8">
      {/* Fleet Utilization */}
      <div>
        <SectionHeader title="Fleet Utilization" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Bus} label="Active Vehicles" value={`${fleet.activeVehicles}/${fleet.totalVehicles}`} />
          <KpiCard icon={Users} label="Active Drivers" value={`${fleet.activeDrivers}/${fleet.totalDrivers}`} />
          <KpiCard icon={Gauge} label="Avg Capacity Fill" value={fleet.avgFillPct === null ? "—" : `${fleet.avgFillPct}%`} />
          <KpiCard icon={Timer} label={`Trips (${THIRTY_DAYS}d)`} value={fleet.tripsLast30d} />
        </div>
      </div>

      {/* Transport Costs */}
      <div>
        <SectionHeader title="Transport Costs" subtitle={`Last ${THIRTY_DAYS} days · AMC shown for active contracts`} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Fuel} label="Fuel Cost" value={`₹${costs.fuelCost.toLocaleString("en-IN")}`} sub={`${costs.fuelLiters.toFixed(0)} L`} />
          <KpiCard icon={Wrench} label="Service Cost" value={`₹${costs.serviceCost.toLocaleString("en-IN")}`} />
          <KpiCard icon={ShieldCheck} label="Active AMC Cost" value={`₹${costs.amcCost.toLocaleString("en-IN")}`} />
          <KpiCard icon={TrendingUp} label="Total Operating Cost" value={`₹${costs.totalOperatingCost.toLocaleString("en-IN")}`} valueColor="text-blue-600" />
        </div>
      </div>

      {/* Safety KPIs */}
      <div>
        <SectionHeader title="Safety KPIs" subtitle={`Last ${THIRTY_DAYS} days`} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            icon={AlertTriangle} label="Incidents" value={safety.incidentCount}
            valueColor={safety.highSeverityIncidents > 0 ? "text-red-600" : undefined}
            sub={safety.highSeverityIncidents > 0 ? `${safety.highSeverityIncidents} high severity` : undefined}
          />
          <KpiCard
            icon={Siren} label="SOS Alerts" value={safety.sosCount}
            valueColor={safety.unresolvedSos > 0 ? "text-red-600" : undefined}
            sub={safety.unresolvedSos > 0 ? `${safety.unresolvedSos} unresolved` : undefined}
          />
          <KpiCard icon={Gauge} label="Speed Violations" value={safety.speedViolationCount} valueColor={safety.speedViolationCount > 0 ? "text-amber-600" : undefined} />
          <KpiCard icon={CheckCircle2} label="On-Time %" value={safety.onTimePct === null ? "—" : `${safety.onTimePct}%`} valueColor="text-emerald-600" />
        </div>
      </div>

      {/* Compliance Status */}
      <div>
        <SectionHeader title="Compliance Status" subtitle={`Flags documents expired or expiring within ${EXPIRY_WARNING_DAYS} days`} />
        <div className="grid grid-cols-2 gap-3 mb-4">
          <KpiCard
            icon={CheckCircle2} label="Compliant Vehicles" value={`${compliance.compliantVehicles}/${vehicles.length}`}
            valueColor={compliance.vehicleIssues.length > 0 ? "text-amber-600" : "text-emerald-600"}
          />
          <KpiCard
            icon={CheckCircle2} label="Compliant Drivers" value={`${compliance.compliantDrivers}/${drivers.length}`}
            valueColor={compliance.driverIssues.length > 0 ? "text-amber-600" : "text-emerald-600"}
          />
        </div>

        {(compliance.vehicleIssues.length > 0 || compliance.driverIssues.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {compliance.vehicleIssues.length > 0 && (
              <Card className="rounded-2xl border-slate-200/70 overflow-hidden">
                <div className="p-3 border-b border-slate-100 flex items-center gap-2">
                  <FileWarning className="h-4 w-4 text-amber-500" />
                  <p className="text-sm font-semibold text-slate-800">Vehicles Needing Attention</p>
                </div>
                <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                  {compliance.vehicleIssues.map(v => (
                    <div key={v.label} className="p-3">
                      <p className="text-sm font-medium text-slate-800">{v.label}</p>
                      <p className="text-xs text-amber-600">{v.issues.join(", ")}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {compliance.driverIssues.length > 0 && (
              <Card className="rounded-2xl border-slate-200/70 overflow-hidden">
                <div className="p-3 border-b border-slate-100 flex items-center gap-2">
                  <FileWarning className="h-4 w-4 text-amber-500" />
                  <p className="text-sm font-semibold text-slate-800">Drivers Needing Attention</p>
                </div>
                <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                  {compliance.driverIssues.map(d => (
                    <div key={d.label} className="p-3">
                      <p className="text-sm font-medium text-slate-800">{d.label}</p>
                      <p className="text-xs text-amber-600">{d.issues.join(", ")}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
