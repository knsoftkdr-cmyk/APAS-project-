import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  formatBytes, getRecordingSettings, getRecordingUsage, purgeRecordingsNow, retentionPreview, saveRecordingSettings, usagePercent,
  type GoogleConnection, type RecordingSettings, type UsageReport,
} from "@/lib/liveRecordings";

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </div>
  );
}

function NumberField({ label, hint, value, onChange, disabled }: { label: string; hint: string; value: number; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold text-slate-600">{label}</Label>
      <Input type="number" inputMode="numeric" value={Number.isNaN(value) ? "" : value} onChange={(e) => onChange(e.target.value.trim() === "" ? NaN : Number(e.target.value))} disabled={disabled} className="border-slate-200" />
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Admin settings for live-class recordings: permissions, storage mode, retention, quota and usage. */
export function LiveRecordingSettingsCard() {
  const { toast } = useToast();
  const [saved, setSaved] = useState<RecordingSettings | null>(null);
  const [draft, setDraft] = useState<RecordingSettings | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [google, setGoogle] = useState<GoogleConnection | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [expiring, setExpiring] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadUsage = () => getRecordingUsage().then(setUsage).catch(() => undefined);

  useEffect(() => {
    let alive = true;
    getRecordingSettings()
      .then((r) => { if (!alive) return; setSaved(r.settings); setDraft({ ...r.settings }); setCanEdit(r.can_edit); setGoogle(r.google); void loadUsage(); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // how many existing recordings a shorter retention period would remove: shown BEFORE saving
  useEffect(() => {
    if (!saved || !draft || !canEdit || draft.retention_days === saved.retention_days || !Number.isInteger(draft.retention_days)) { setExpiring(null); return; }
    const t = setTimeout(() => { retentionPreview(draft.retention_days).then((r) => setExpiring(r.would_expire)).catch(() => setExpiring(null)); }, 400);
    return () => clearTimeout(t);
  }, [draft?.retention_days, saved?.retention_days, canEdit]);

  if (failed) {
    return <Card><CardContent className="p-3 text-xs text-muted-foreground">Recording settings are not available yet (the database update has not been applied).</CardContent></Card>;
  }
  if (!saved || !draft) return null;

  const set = <K extends keyof RecordingSettings>(k: K, v: RecordingSettings[K]) => setDraft({ ...draft, [k]: v });
  const changed = (Object.keys(draft) as (keyof RecordingSettings)[]).some((k) => draft[k] !== saved[k]);
  const invalid = [draft.retention_days, draft.storage_quota_gb, draft.max_upload_mb].some((n) => !Number.isInteger(n))
    || draft.retention_days < 0 || draft.retention_days > 3650 || draft.storage_quota_gb < 1 || draft.max_upload_mb < 10 || draft.max_upload_mb > 5120;
  const pct = usage ? usagePercent(usage.used_bytes, usage.quota_bytes) : 0;

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await saveRecordingSettings(draft);
      setSaved(r.settings); setDraft({ ...r.settings });
      toast({ title: "Recording settings saved", description: r.retention_reapplied ? `New retention applied to ${r.retention_reapplied} recordings.` : undefined });
      void loadUsage();
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function purge() {
    setPurging(true);
    try {
      const r = await purgeRecordingsNow();
      toast({ title: "Cleanup finished", description: `${r.expired} expired, ${r.purged} files removed.` });
      void loadUsage();
    } catch (e) {
      toast({ title: "Cleanup failed", description: (e as Error).message, variant: "destructive" });
    } finally { setPurging(false); }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Live class recordings</CardTitle>
        <p className="text-xs text-muted-foreground">
          Classes are recorded by Google Meet and saved to a private store. Teachers manage them from the session's Recordings button; students watch them in Virtual Classroom.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Toggle label="Recording enabled" hint="Nothing is recorded until this is on." checked={draft.enabled} onChange={(v) => set("enabled", v)} disabled={!canEdit} />

        {draft.enabled && google && !google.configured && (
          <p className="text-xs text-amber-800 rounded-lg bg-amber-50 border border-amber-200 p-2">
            Recording is switched on, but classes will <b>not</b> be recorded automatically until the Google connection below is configured. Until then teachers can add recordings by hand (upload a video or paste a link).
          </p>
        )}

        {canEdit && google && (
          <div className={`rounded-xl border p-3 space-y-1 text-xs ${google.configured ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <p className="font-medium text-slate-800">{google.configured ? "Google connection is configured on the server" : "Google connection is not configured"}</p>
            {google.configured ? (
              <>
                <p className="text-slate-700">In the Google Workspace Admin console go to Security, API controls, Domain-wide delegation, and authorise this client ID with the scopes below:</p>
                <p className="font-mono break-all text-slate-800">Client ID: {google.client_id ?? "(see the service account in Google Cloud)"}</p>
                <p className="font-mono break-all text-slate-600">{google.scopes.join(", ")}</p>
                <p className="text-slate-600">Recording also needs a Google Workspace edition that includes it (for example Education Plus or the Teaching and Learning Upgrade), and teachers must create their Meet links from their own school accounts.</p>
              </>
            ) : (
              <p className="text-slate-700">A developer must add the service account key as the server secret GOOGLE_MEET_SA_JSON. Until then teachers can still attach recordings by hand.</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Toggle label="Record new classes by default" hint="Teachers can switch a class off or on." checked={draft.auto_record} onChange={(v) => set("auto_record", v)} disabled={!canEdit} />
          <div className="space-y-1 rounded-xl border border-slate-100 p-3">
            <Label className="text-sm font-medium">Where recordings are kept</Label>
            <Select value={draft.storage_mode} onValueChange={(v) => set("storage_mode", v as RecordingSettings["storage_mode"])} disabled={!canEdit}>
              <SelectTrigger className="border-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="supabase_copy">Copy into APAS private storage</SelectItem>
                <SelectItem value="drive_link">Keep in Google Drive (link only)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Copying lets APAS control access and delete on schedule. Drive-link recordings stay in the teacher's Drive: APAS only hides the link.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Toggle label="Teachers can turn recording on/off" checked={draft.teachers_can_toggle} onChange={(v) => set("teachers_can_toggle", v)} disabled={!canEdit} />
          <Toggle label="Teachers can edit and link recordings" hint="Rename, hide, link to course/lesson, keep." checked={draft.teachers_can_manage} onChange={(v) => set("teachers_can_manage", v)} disabled={!canEdit} />
          <Toggle label="Teachers can add recordings by hand" hint="Upload a video or paste a link." checked={draft.teachers_can_upload} onChange={(v) => set("teachers_can_upload", v)} disabled={!canEdit} />
          <Toggle label="Teachers can delete recordings" checked={draft.teachers_can_delete} onChange={(v) => set("teachers_can_delete", v)} disabled={!canEdit} />
          <Toggle label="Students can watch recordings" checked={draft.student_access} onChange={(v) => set("student_access", v)} disabled={!canEdit} />
          <Toggle label="Show a download button to students" hint="Deters saving; it cannot fully prevent it." checked={draft.student_download} onChange={(v) => set("student_download", v)} disabled={!canEdit} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumberField label="Keep recordings for (days)" hint="0 keeps them until deleted." value={draft.retention_days} onChange={(n) => set("retention_days", n)} disabled={!canEdit} />
          <NumberField label="Storage quota (GB)" hint="Over quota, new recordings stay as Drive links." value={draft.storage_quota_gb} onChange={(n) => set("storage_quota_gb", n)} disabled={!canEdit} />
          <NumberField label="Largest upload (MB)" hint="For videos added by hand." value={draft.max_upload_mb} onChange={(n) => set("max_upload_mb", n)} disabled={!canEdit} />
        </div>
        {expiring != null && expiring > 0 && (
          <p className="text-xs text-amber-700 rounded-lg bg-amber-50 border border-amber-100 p-2">
            Saving this retention period will remove {expiring} existing recording{expiring === 1 ? "" : "s"} at the next cleanup (recordings marked Keep are exempt).
          </p>
        )}

        {usage && (
          <div className="rounded-xl bg-slate-50 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700">Storage used</span>
              <span className="tabular-nums text-slate-600">{formatBytes(usage.used_bytes)} of {formatBytes(usage.quota_bytes)} ({pct}%)</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-teal-500"}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-slate-600">
              {usage.total_recordings} recordings · {usage.expiring_30_days} expire within 30 days · {usage.kept_as_drive_link} kept as Drive links
              {usage.failed > 0 ? ` · ${usage.failed} need attention` : ""}
            </p>
            {usage.by_class.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {[["By class", usage.by_class], ["By subject", usage.by_subject]].map(([title, list]) => (
                  <div key={title as string} className="space-y-0.5">
                    <p className="text-[11px] font-semibold text-slate-600">{title as string}</p>
                    {(list as UsageReport["by_class"]).slice(0, 6).map((x) => (
                      <p key={x.name} className="text-xs text-slate-600 flex justify-between gap-2"><span className="truncate">{x.name}</span><span className="tabular-nums shrink-0">{formatBytes(x.bytes)}</span></p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving || invalid || !changed} className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white">
              {saving ? "Saving..." : "Save settings"}
            </Button>
            <Button variant="outline" onClick={purge} disabled={purging}>{purging ? "Cleaning..." : "Run cleanup now"}</Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Only a school administrator can change these settings.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default LiveRecordingSettingsCard;
