import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { DEFAULT_SETTINGS, useSaveMyPhone, useSaveTelephonySettings, useTelephonySettings, type TelephonySettings } from "@/hooks/useTelephony";
import { normalizePhone } from "@/lib/telephony";

/** Admin-only. Provider credentials are NOT entered here - they live in server secrets. */
export function CallSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data } = useTelephonySettings();
  const save = useSaveTelephonySettings(); const savePhone = useSaveMyPhone();
  const [s, setS] = useState<TelephonySettings>(DEFAULT_SETTINGS); const [myPhone, setMyPhone] = useState("");
  useEffect(() => { if (open) { setS({ ...DEFAULT_SETTINGS, ...(data?.settings ?? {}), call_window_start: (data?.settings?.call_window_start ?? "09:00").slice(0, 5), call_window_end: (data?.settings?.call_window_end ?? "21:00").slice(0, 5) }); setMyPhone(data?.myPhone ?? ""); } }, [open, data]);
  const up = <K extends keyof TelephonySettings>(k: K, v: TelephonySettings[K]) => setS((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    try {
      if (myPhone.trim() && myPhone !== data?.myPhone) { const p = normalizePhone(myPhone); if (!p.ok) return toast.error(p.error); await savePhone.mutateAsync(p.e164); }
      await save.mutateAsync({ ...s, caller_id: s.caller_id?.trim() || null });
      toast.success("Calling settings saved"); onOpenChange(false);
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 className="h-4 w-4" />Calling settings</DialogTitle><DialogDescription>Click-to-call for admission leads.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Alert><AlertDescription className="text-xs">Provider API keys are never entered in the browser. They are stored as server secrets (see the setup guide). Calling only works once those are set.</AlertDescription></Alert>
          <div className="flex items-center justify-between"><Label htmlFor="tel-en">Enable calling for this school</Label><Switch id="tel-en" checked={s.enabled} onCheckedChange={(v) => up("enabled", v)} /></div>
          <div className="space-y-1.5"><Label>Provider</Label>
            <Select value={s.provider} onValueChange={(v) => up("provider", v as TelephonySettings["provider"])}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="exotel">Exotel</SelectItem><SelectItem value="airtel_iq">Airtel IQ (not integrated yet)</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="tel-cid">School caller ID (your ExoPhone)</Label><Input id="tel-cid" inputMode="tel" placeholder="+91 11 4000 0000" value={s.caller_id ?? ""} onChange={(e) => up("caller_id", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Calls allowed from</Label><Input type="time" value={s.call_window_start} onChange={(e) => up("call_window_start", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>until</Label><Input type="time" value={s.call_window_end} onChange={(e) => up("call_window_end", e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>School time zone</Label><Input value={s.timezone} onChange={(e) => up("timezone", e.target.value)} placeholder="Asia/Kolkata" /></div>
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between"><Label htmlFor="tel-rec">Allow call recording</Label><Switch id="tel-rec" checked={s.recording_enabled} onCheckedChange={(v) => up("recording_enabled", v)} /></div>
            <p className="text-xs text-muted-foreground">Off by default. Even when on, staff must opt in per call and confirm parent consent.</p>
            {s.recording_enabled && <div className="space-y-1.5"><Label>Keep recordings for (days)</Label><Input type="number" min={1} max={3650} value={s.recording_retention_days} onChange={(e) => up("recording_retention_days", Number(e.target.value) || 90)} /></div>}
          </div>
          <div className="space-y-1.5"><Label htmlFor="tel-mine">Your own phone (rung first on each call)</Label><Input id="tel-mine" inputMode="tel" value={myPhone} onChange={(e) => setMyPhone(e.target.value)} placeholder="98765 43210" /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={save.isPending}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
