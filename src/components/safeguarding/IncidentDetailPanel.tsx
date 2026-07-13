import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client"; // adjust path if your client lives elsewhere
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type {
  SafeguardingIncident,
  SafeguardingIncidentUpdate,
  IncidentStatus,
} from "@/types/safeguarding";

const STATUS_OPTIONS: IncidentStatus[] = [
  "reported",
  "under_review",
  "escalated",
  "resolved",
  "closed",
];

export function IncidentDetailPanel({
  incident,
  onClose,
  onUpdated,
}: {
  incident: SafeguardingIncident;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [updates, setUpdates] = useState<SafeguardingIncidentUpdate[]>([]);
  const [note, setNote] = useState("");
  const [newStatus, setNewStatus] = useState<IncidentStatus>(incident.status);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchUpdates();
  }, [incident.id]);

  async function fetchUpdates() {
    const { data, error } = await supabase
      .from("safeguarding_incident_updates")
      .select("*")
      .eq("incident_id", incident.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to load updates:", error);
      return;
    }
    setUpdates(data ?? []);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const statusChanged = newStatus !== incident.status;

      // Write the timeline entry
      const { error: updateError } = await supabase
        .from("safeguarding_incident_updates")
        .insert({
          incident_id: incident.id,
          note: note.trim() || (statusChanged ? `Status changed to ${newStatus}` : ""),
          status_change: statusChanged ? `${incident.status} -> ${newStatus}` : null,
          updated_by: user.id,
        });

      if (updateError) throw updateError;

      // Update the incident's status if it changed
      if (statusChanged) {
        const { error: statusError } = await supabase
          .from("safeguarding_incidents")
          .update({
            status: newStatus,
            updated_at: new Date().toISOString(),
            resolved_at: newStatus === "resolved" ? new Date().toISOString() : null,
          })
          .eq("id", incident.id);

        if (statusError) throw statusError;
      }

      setNote("");
      await fetchUpdates();
      onUpdated();
    } catch (err) {
      console.error("Failed to save update:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {incident.student_name ?? "General concern"}
            <Badge variant="outline">{incident.category}</Badge>
          </DialogTitle>
          <DialogDescription>{incident.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="max-h-48 overflow-y-auto space-y-2 border rounded-md p-3">
            {updates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No updates yet.</p>
            ) : (
              updates.map((u) => (
                <div key={u.id} className="text-sm border-b last:border-0 pb-2">
                  {u.status_change && (
                    <p className="font-medium text-xs text-primary">{u.status_change}</p>
                  )}
                  {u.note && <p>{u.note}</p>}
                  <p className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="space-y-2">
            <Select value={newStatus} onValueChange={(v) => setNewStatus(v as IncidentStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Textarea
              placeholder="Add a note (required unless only changing status)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? "Saving..." : "Save Update"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}