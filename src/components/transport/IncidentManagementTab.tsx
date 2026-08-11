import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Wrench, Car, Paperclip, ExternalLink } from "lucide-react";

type IncidentType = "accident" | "breakdown" | "student_incident";
type IncidentSeverity = "low" | "medium" | "high";
type IncidentStatus = "reported" | "acknowledged" | "resolved";

interface IncidentRow {
  id: string;
  incident_type: IncidentType;
  route_id: string | null;
  trip_id: string | null;
  driver_id: string;
  student_id: string | null;
  severity: IncidentSeverity;
  description: string;
  status: IncidentStatus;
  occurred_at: string;
  transport_routes: { route_name: string } | null;
  drivers: { name: string } | null;
  student_name?: string;
}

interface AttachmentRow {
  id: string;
  incident_id: string;
  file_path: string;
}

const TYPE_LABELS: Record<IncidentType, string> = {
  accident: "Accident",
  breakdown: "Breakdown",
  student_incident: "Student Incident",
};

const TYPE_ICONS: Record<IncidentType, typeof Car> = {
  accident: Car,
  breakdown: Wrench,
  student_incident: AlertTriangle,
};

const SEVERITY_COLORS: Record<IncidentSeverity, string> = {
  low: "bg-slate-100 text-slate-600 border-slate-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-red-50 text-red-600 border-red-200",
};

const STATUS_COLORS: Record<IncidentStatus, string> = {
  reported: "bg-blue-50 text-blue-700 border-blue-200",
  acknowledged: "bg-amber-50 text-amber-700 border-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export function IncidentManagementTab({ schoolId }: { schoolId?: string }) {
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | IncidentType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | IncidentStatus>("all");
  const [detailIncident, setDetailIncident] = useState<IncidentRow | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const fetchIncidents = async () => {
    if (!schoolId) return;
    setLoading(true);
    let query = supabase
      .from("transport_incidents")
      .select("*, transport_routes(route_name), drivers(name)")
      .eq("school_id", schoolId)
      .order("occurred_at", { ascending: false })
      .limit(100);
    if (typeFilter !== "all") query = query.eq("incident_type", typeFilter);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);

    const { data, error } = await query;
    if (error) {
      toast.error("Failed to load incidents: " + error.message);
      setLoading(false);
      return;
    }

    const rows = (data as any as IncidentRow[]) ?? [];

    // student_id references transport_assignments.student_id (= students.id),
    // not a recognized FK to `students`, so Postgrest can't embed it.
    // Batch-fetch names separately and merge client-side.
    const studentIds = [...new Set(rows.filter((r) => r.student_id).map((r) => r.student_id as string))];
    if (studentIds.length > 0) {
      const { data: studentRows } = await supabase
        .from("students")
        .select("id, full_name")
        .in("id", studentIds);
      const nameMap = new Map((studentRows ?? []).map((s: any) => [s.id, s.full_name]));
      rows.forEach((r) => {
        if (r.student_id) r.student_name = nameMap.get(r.student_id) ?? "Unknown student";
      });
    }

    setIncidents(rows);
    setLoading(false);
  };

  useEffect(() => {
    fetchIncidents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, typeFilter, statusFilter]);

  const openDetail = async (incident: IncidentRow) => {
    setDetailIncident(incident);
    setAttachments([]);
    setAttachmentUrls({});
    setLoadingAttachments(true);

    const { data: attRows, error } = await supabase
      .from("transport_incident_attachments")
      .select("id, incident_id, file_path")
      .eq("incident_id", incident.id);

    if (error) {
      toast.error("Failed to load attachments: " + error.message);
      setLoadingAttachments(false);
      return;
    }

    const rows = (attRows as AttachmentRow[]) ?? [];
    setAttachments(rows);

    const urlMap: Record<string, string> = {};
    for (const a of rows) {
      const { data: signed } = await supabase.storage
        .from("transport-documents")
        .createSignedUrl(a.file_path, 3600);
      if (signed?.signedUrl) urlMap[a.id] = signed.signedUrl;
    }
    setAttachmentUrls(urlMap);
    setLoadingAttachments(false);
  };

  const updateStatus = async (status: IncidentStatus) => {
    if (!detailIncident) return;
    setUpdatingStatus(true);
    const { error } = await supabase
      .from("transport_incidents")
      .update({ status })
      .eq("id", detailIncident.id);
    setUpdatingStatus(false);
    if (error) {
      toast.error("Failed to update status: " + error.message);
      return;
    }
    toast.success(`Marked as ${status.replace("_", " ")}.`);
    setDetailIncident({ ...detailIncident, status });
    fetchIncidents();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> Incident Management
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
                <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="accident">Accident</SelectItem>
                  <SelectItem value="breakdown">Breakdown</SelectItem>
                  <SelectItem value="student_incident">Student Incident</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="reported">Reported</SelectItem>
                  <SelectItem value="acknowledged">Acknowledged</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading incidents...
            </p>
          ) : incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No incidents match these filters.</p>
          ) : (
            <div className="space-y-2">
              {incidents.map((inc) => {
                const Icon = TYPE_ICONS[inc.incident_type];
                return (
                  <button
                    key={inc.id}
                    type="button"
                    onClick={() => openDetail(inc)}
                    className="w-full flex items-center justify-between rounded-lg border p-3 flex-wrap gap-2 text-left hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="rounded-full bg-muted p-2 shrink-0">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {TYPE_LABELS[inc.incident_type]}
                          {inc.student_name && (
                            <span className="text-xs font-normal text-muted-foreground ml-1.5">
                              — {inc.student_name}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {new Date(inc.occurred_at).toLocaleString()} · {inc.transport_routes?.route_name || "—"} · {inc.drivers?.name || "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={SEVERITY_COLORS[inc.severity]}>
                        {inc.severity}
                      </Badge>
                      <Badge variant="outline" className={STATUS_COLORS[inc.status]}>
                        {inc.status}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailIncident} onOpenChange={(open) => !open && setDetailIncident(null)}>
        <DialogContent className="max-w-lg">
          {detailIncident && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {TYPE_LABELS[detailIncident.incident_type]}
                  <Badge variant="outline" className={STATUS_COLORS[detailIncident.status]}>
                    {detailIncident.status}
                  </Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Reported:</span> {new Date(detailIncident.occurred_at).toLocaleString()}</p>
                  <p><span className="text-muted-foreground">Route:</span> {detailIncident.transport_routes?.route_name || "—"}</p>
                  <p><span className="text-muted-foreground">Driver:</span> {detailIncident.drivers?.name || "—"}</p>
                  {detailIncident.student_name && (
                    <p><span className="text-muted-foreground">Student:</span> {detailIncident.student_name}</p>
                  )}
                  <p><span className="text-muted-foreground">Severity:</span> {detailIncident.severity}</p>
                </div>
                <div>
                  <Label className="text-xs">Description</Label>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{detailIncident.description}</p>
                </div>

                <div>
                  <Label className="text-xs flex items-center gap-1"><Paperclip className="h-3 w-3" /> Attachments</Label>
                  {loadingAttachments ? (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading...
                    </p>
                  ) : attachments.length === 0 ? (
                    <p className="text-xs text-muted-foreground mt-1">No attachments.</p>
                  ) : (
                    <div className="mt-1 space-y-1">
                      {attachments.map((a) => (
                        <a
                          key={a.id}
                          href={attachmentUrls[a.id] || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" /> {a.file_path.split("/").pop()}
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t">
                  {detailIncident.status !== "acknowledged" && detailIncident.status !== "resolved" && (
                    <Button size="sm" variant="outline" onClick={() => updateStatus("acknowledged")} disabled={updatingStatus}>
                      {updatingStatus && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                      Acknowledge
                    </Button>
                  )}
                  {detailIncident.status !== "resolved" && (
                    <Button size="sm" onClick={() => updateStatus("resolved")} disabled={updatingStatus}>
                      {updatingStatus && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                      Mark Resolved
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
