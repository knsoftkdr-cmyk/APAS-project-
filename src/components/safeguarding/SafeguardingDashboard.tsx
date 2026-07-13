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
import type { SafeguardingIncident, IncidentStatus, IncidentSeverity } from "@/types/safeguarding";

const SEVERITY_COLORS: Record<IncidentSeverity, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Safeguarding Dashboard</h2>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as IncidentStatus | "all")}>
          <SelectTrigger className="w-48">
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

      {loading ? (
        <p className="text-muted-foreground">Loading incidents...</p>
      ) : incidents.length === 0 ? (
        <p className="text-muted-foreground">No incidents match this filter.</p>
      ) : (
        <div className="grid gap-3">
          {incidents.map((incident) => (
            <Card
              key={incident.id}
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => setSelectedIncident(incident)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {incident.student_name ?? "General concern"}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Badge className={SEVERITY_COLORS[incident.severity]}>
                      {incident.severity}
                    </Badge>
                    <Badge variant="outline">{STATUS_LABELS[incident.status]}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {incident.description}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
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