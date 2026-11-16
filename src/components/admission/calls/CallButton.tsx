import { useState } from "react";
import { Phone, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useSaveMyPhone, useTelephonySettings } from "@/hooks/useTelephony";
import { formatPhone, normalizePhone } from "@/lib/telephony";

interface Props {
  applicantName: string; parentPhone: string; disabled?: boolean;
  starting: boolean; onStart: (opts: { record: boolean; consent: boolean }) => Promise<boolean>;
}

/** Renders nothing unless this school has calling switched on and this user may call. */
export function CallButton({ applicantName, parentPhone, disabled, starting, onStart }: Props) {
  const { data } = useTelephonySettings();
  const savePhone = useSaveMyPhone();
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState(false);
  const [consent, setConsent] = useState(false);
  const [myPhone, setMyPhone] = useState("");
  if (!data?.canCall || !data.settings?.enabled) return null;

  const parent = normalizePhone(parentPhone);
  const needPhone = !data.myPhone;
  const canRecord = data.settings.recording_enabled;
  const go = async () => {
    if (needPhone) {
      const p = normalizePhone(myPhone);
      if (!p.ok) return toast.error(p.error);
      try { await savePhone.mutateAsync(p.e164); } catch (e) { return toast.error((e as Error).message); }
    }
    if (record && !consent) return toast.error("Confirm that the parent has agreed to the recording.");
    if (await onStart({ record: canRecord && record, consent })) setOpen(false);
  };

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 px-2 gap-1" disabled={disabled || !parent.ok} onClick={() => setOpen(true)}
        title={parent.ok ? `Call ${applicantName}'s parent` : "This lead has no valid parent phone number"}>
        <Phone className="h-3.5 w-3.5" />Call
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PhoneCall className="h-4 w-4" />Call parent of {applicantName}</DialogTitle>
            <DialogDescription>
              The system rings <b>your phone first</b>{data.myPhone ? ` (${formatPhone(data.myPhone)})` : ""}; when you answer, it connects you to {parent.ok ? formatPhone(parent.e164) : "the parent"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {needPhone && (
              <div className="space-y-1.5">
                <Label htmlFor="tel-my-phone">Your phone number (saved for future calls)</Label>
                <Input id="tel-my-phone" inputMode="tel" placeholder="98765 43210" value={myPhone} onChange={(e) => setMyPhone(e.target.value)} />
              </div>
            )}
            {canRecord ? (
              <div className="rounded-md border p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={record} onCheckedChange={(v) => { setRecord(!!v); if (!v) setConsent(false); }} />Record this call</label>
                {record && (
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Checkbox checked={consent} onCheckedChange={(v) => setConsent(!!v)} className="mt-0.5" />
                    I will tell the parent the call is recorded and have their consent before recording starts.
                  </label>
                )}
              </div>
            ) : <p className="text-xs text-muted-foreground">Call recording is off for this school. It is never enabled automatically.</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={go} disabled={starting || savePhone.isPending}>{starting ? "Starting…" : "Start call"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
