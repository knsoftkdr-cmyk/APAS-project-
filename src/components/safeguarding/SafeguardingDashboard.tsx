import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client"; // adjust path if your client lives elsewhere
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IncidentDetailPanel } from "./IncidentDetailPanel";
import { ShieldAlert } from "lucide-react";
import type { SafeguardingIncident, IncidentStatus, IncidentSeverity } from "@/types/safeguarding";

const SEVERITY_COLORS: Record<IncidentSeverity, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

const SEVERITY_DOT: Record<IncidentSeverity, string> = {
  low: "bg-slate-300",
  medium: "bg-amber-400",
  high: "bg-orange-500",
  critical: "bg-red-500",
};

const STATUS_LABELS: Record<IncidentStatus, string> = {
  reported: "Reported",
  under_review: "Under Review",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

export function SafeguardingDashboard() {
  const [incidents, setIncidents] = useState<SafeguardingIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | "all">("all");
  const [selectedIncident, setSelectedIncident] = useState<SafeguardingIncident | null>(null);

  useEffect(() => {
    fetchIncidents();
  }, [statusFilter]);

  async function fetchIncidents() {
    setLoading(true);
    let query = supabase
      .from("safeguarding_incidents")
      .select("*, students:student_id (profiles:profile_id (full_name))")
      .order("created_at", { ascending: false });

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Failed to load incidents:", error);
      setIncidents([]);
    } else {
      setIncidents(
        (data ?? []).map((row: any) => ({
          ...row,
          student_name: row.students?.profiles?.full_name ?? null,
        }))
      );
    }
    setLoading(false);
  }

  return (
    <div className="space-y-5">
      <div
        className="rounded-2xl p-5 md:p-6 relative overflow-hidden shadow-lg"
        style={{ background: "linear-gradient(120deg, #1e3a5f 0%, #2c5282 100%)" }}
      >
        <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
        <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
        <div className="relative flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/15 rounded-xl flex items-center justify-center shrink-0">
              <ShieldAlert className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-bold text-white">Safeguarding Dashboard</h2>
              <p className="text-blue-100 text-xs md:text-sm mt-0.5">Review and manage all reported safeguarding incidents</p>
            </div>
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as IncidentStatus | "all")}>
            <SelectTrigger className="w-full sm:w-48 h-11 rounded-xl bg-white/95 border-white/20">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-12">Loading incidents...</p>
      ) : incidents.length === 0 ? (
        <Card className="border-2 border-dashed border-slate-200 bg-slate-50/40 rounded-2xl">
          <CardContent className="py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1e3a5f] to-[#2c5282] flex items-center justify-center mx-auto mb-3 shadow-md">
              <ShieldAlert className="h-7 w-7 text-white" />
            </div>
            <p className="font-medium text-slate-800">No incidents match this filter</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {incidents.map((incident) => (
            <Card
              key={incident.id}
              className="cursor-pointer rounded-xl border-slate-200 shadow-sm hover:shadow-md hover:border-[#2c5282]/40 transition-all"
              onClick={() => setSelectedIncident(incident)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${SEVERITY_DOT[incident.severity]}`} />
                    <CardTitle className="text-base truncate">
                      {incident.student_name ?? "General concern"}
                    </CardTitle>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Badge className={`${SEVERITY_COLORS[incident.severity]} hover:opacity-90 capitalize`}>
                      {incident.severity}
                    </Badge>
                    <Badge variant="outline" className="border-slate-200">{STATUS_LABELS[incident.status]}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {incident.description}
                </p>
                <p className="text-xs text-muted-foreground mt-2 capitalize">
                  {new Date(incident.created_at).toLocaleString()} · {incident.category}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedIncident && (
        <IncidentDetailPanel
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
          onUpdated={fetchIncidents}
        />
      )}
    </div>
  );
}
