import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client"; // adjust path if your client lives elsewhere
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Trash2 } from "lucide-react";
import type {
  SafeguardingIncident,
  IncidentCategory,
  IncidentSeverity,
} from "@/types/safeguarding";

const CATEGORY_OPTIONS: { value: IncidentCategory; label: string }[] = [
  { value: "physical", label: "Physical" },
  { value: "emotional", label: "Emotional" },
  { value: "neglect", label: "Neglect" },
  { value: "online", label: "Online / Cyber" },
  { value: "bullying", label: "Bullying" },
  { value: "other", label: "Other" },
];

const SEVERITY_OPTIONS: { value: IncidentSeverity; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export function MyIncidentReports() {
  const { toast } = useToast();
  const [incidents, setIncidents] = useState<SafeguardingIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SafeguardingIncident | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SafeguardingIncident | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchMine();
  }, []);

  async function fetchMine() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    // RLS also restricts this to "own reports" already, but filtering
    // explicitly here keeps the query intent clear.
    const { data, error } = await supabase
      .from("safeguarding_incidents")
      .select("*")
      .eq("reported_by", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load your reports:", error);
      setIncidents([]);
    } else {
      setIncidents(data ?? []);
    }
    setLoading(false);
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("safeguarding_incidents")
        .update({
          category: editing.category,
          severity: editing.severity,
          description: editing.description,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editing.id);

      if (error) throw error;

      toast({ title: "Report updated" });
      setEditing(null);
      await fetchMine();
    } catch (err) {
      console.error("Edit failed:", err);
      toast({
        title: "Could not update report",
        description: "It may have already moved past 'reported' status.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase
        .from("safeguarding_incidents")
        .delete()
        .eq("id", deleteTarget.id);

      if (error) throw error;

      toast({ title: "Report deleted" });
      setDeleteTarget(null);
      await fetchMine();
    } catch (err) {
      console.error("Delete failed:", err);
      toast({
        title: "Could not delete report",
        description: "It may have already moved past 'reported' status.",
        variant: "destructive",
      });
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading your reports...</p>;
  if (incidents.length === 0) return null;

  return (
    <div className="space-y-3 mt-8">
      <h3 className="text-lg font-semibold">My Submitted Reports</h3>
      {incidents.map((incident) => {
        const canModify = incident.status === "reported";
        return (
          <Card key={incident.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base capitalize">
                  {incident.category.replace("_", " ")}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{incident.status.replace("_", " ")}</Badge>
                  {canModify && (
                    <>
                      <Button size="icon" variant="ghost" onClick={() => setEditing(incident)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(incident)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{incident.description}</p>
              {!canModify && (
                <p className="text-xs text-muted-foreground mt-2">
                  This report is already being reviewed and can no longer be edited or deleted.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Report</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Select
                  value={editing.category}
                  onValueChange={(v) => setEditing({ ...editing, category: v as IncidentCategory })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={editing.severity}
                  onValueChange={(v) => setEditing({ ...editing, severity: v as IncidentSeverity })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Textarea
                rows={5}
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />

              <Button onClick={handleSaveEdit} disabled={saving} className="w-full">
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this report?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. The report will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}