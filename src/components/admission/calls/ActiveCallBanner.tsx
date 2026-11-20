import { useEffect, useState } from "react";
import { AlertTriangle, PhoneCall, PhoneOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CALL_STATUS_LABEL, formatDuration, isTerminal, type CallStatus } from "@/lib/telephony";

interface Props {
  name: string;
  call: { id: string; status: string; duration_seconds: number | null; failure_reason: string | null } | null;
  error: { message: string; code?: string } | null;
  onDismiss: () => void; onOpenLead?: () => void;
}

const HINT: Record<string, string> = {
  initiating: "Contacting the phone provider…", ringing: "Ringing your phone first - answer it to be connected to the parent.",
  connected: "Connected.",
};

/** Live status of the call just started. Shows the real provider state - never a pretend "connected". */
export function ActiveCallBanner({ name, call, error, onDismiss, onOpenLead }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [since] = useState(() => Date.now());
  useEffect(() => { if (!call || isTerminal(call.status)) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [call]);
  if (!call && !error) return null;

  if (error) return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive" />
      <div className="flex-1"><b>Call could not be started.</b> {error.message}</div>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onDismiss} aria-label="Dismiss"><X className="h-4 w-4" /></Button>
    </div>
  );
  const c = call!; const done = isTerminal(c.status); const bad = ["failed", "busy", "missed", "cancelled"].includes(c.status);
  return (
    <div role="status" className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${bad ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}`}>
      {done ? <PhoneOff className="h-4 w-4 mt-0.5" /> : <PhoneCall className="h-4 w-4 mt-0.5 animate-pulse" />}
      <div className="flex-1">
        <div><b>{name}</b> · {CALL_STATUS_LABEL[c.status as CallStatus] ?? c.status}
          {!done && <span className="text-muted-foreground"> · {formatDuration(Math.floor((now - since) / 1000))}</span>}
          {done && c.duration_seconds != null && <span className="text-muted-foreground"> · {formatDuration(c.duration_seconds)}</span>}</div>
        <div className="text-xs text-muted-foreground">{done ? (c.failure_reason ?? (c.status === "completed" ? "Call ended. Add a note or schedule a follow-up." : "")) : HINT[c.status]}</div>
        {done && onOpenLead && <Button variant="link" className="h-auto p-0 text-xs" onClick={onOpenLead}>Add note / follow-up</Button>}
      </div>
      {done && <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onDismiss} aria-label="Dismiss"><X className="h-4 w-4" /></Button>}
    </div>
  );
}
