import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client"; // adjust path if your client lives elsewhere
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SafeguardingIncident, IncidentSeverity, IncidentStatus } from "@/types/safeguarding";

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

export function ParentSafeguardingView() {
  const [incidents, setIncidents] = useState<SafeguardingIncident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchIncidents() {
      // RLS restricts this to incidents involving the parent's own child(ren) —
      // no manual filtering needed here, the database enforces it.
      const { data, error } = await supabase
        .from("safeguarding_incidents")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to load incidents:", error);
        setIncidents([]);
      } else {
        setIncidents(data ?? []);
      }
      setLoading(false);
    }
    fetchIncidents();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Safeguarding Reports</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Reports filed about your child are shown here. For any concerns, please
          contact the school directly.
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : incidents.length === 0 ? (
        <p className="text-muted-foreground">No reports on file.</p>
      ) : (
        <div className="grid gap-3">
          {incidents.map((incident) => (
            <Card key={incident.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base capitalize">
                    {incident.category.replace("_", " ")}
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
                <p className="text-sm text-muted-foreground">{incident.description}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Filed {new Date(incident.created_at).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}