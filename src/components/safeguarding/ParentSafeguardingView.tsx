import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Clock, Loader2 } from "lucide-react";
import type { SafeguardingIncident, IncidentSeverity, IncidentStatus } from "@/types/safeguarding";

const SEVERITY_STYLES = {
  low: { badge: "bg-slate-50 text-slate-600 border-slate-200", accent: "border-l-slate-300", dot: "bg-slate-400" },
  medium: { badge: "bg-amber-50 text-amber-700 border-amber-200", accent: "border-l-amber-400", dot: "bg-amber-500" },
  high: { badge: "bg-orange-50 text-orange-700 border-orange-200", accent: "border-l-orange-500", dot: "bg-orange-500" },
  critical: { badge: "bg-red-50 text-red-700 border-red-200", accent: "border-l-red-500", dot: "bg-red-600" },
} satisfies Record<IncidentSeverity, { badge: string; accent: string; dot: string }>;

const STATUS_LABELS = {
  reported: "Reported",
  under_review: "Under Review",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
} satisfies Record<IncidentStatus, string>;

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
    <div className="min-h-screen relative overflow-x-hidden">
      <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-indigo-300 opacity-[0.10] blur-3xl" />
      <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-violet-300 opacity-[0.08] blur-3xl" />
      <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-indigo-200 opacity-[0.08] blur-3xl" />

      <div className="relative z-10 p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
        {/* Header */}
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <ShieldCheck className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Safeguarding Reports</h1>
              <p className="text-indigo-100 text-xs md:text-sm mt-0.5">
                Reports filed about your child are shown here. For any concerns, please contact the school directly.
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-500" /> Loading reports...
          </div>
        ) : incidents.length === 0 ? (
          <Card className="border-2 border-dashed border-indigo-100 bg-indigo-50/20">
            <CardContent className="py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-3">
                <ShieldCheck className="h-7 w-7 text-indigo-400" />
              </div>
              <p className="font-medium text-slate-800">No reports on file</p>
              <p className="text-sm text-muted-foreground mt-1">
                Nothing has been filed about your child.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {incidents.map((incident) => {
              const styles = SEVERITY_STYLES[incident.severity];
              return (
                <Card key={incident.id} className={"overflow-hidden border-l-4 " + styles.accent + " border-indigo-100 shadow-sm hover:shadow-md transition-shadow"}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base capitalize truncate">
                        {incident.category.replace("_", " ")}
                      </CardTitle>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={styles.badge + " gap-1.5 font-medium"}>
                          <span className={"h-1.5 w-1.5 rounded-full " + styles.dot} />
                          {incident.severity}
                        </Badge>
                        <Badge variant="secondary" className="font-normal">
                          {STATUS_LABELS[incident.status]}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {incident.description}
                    </p>
                    <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Filed {new Date(incident.created_at).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ParentSafeguardingView;