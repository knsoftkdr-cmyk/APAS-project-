import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { MIN_REASON, reasonOk } from "@/lib/approvalWorkflow";

interface Props {
  open: boolean; onOpenChange: (o: boolean) => void;
  title: string; description?: string; label?: string; confirmLabel: string; destructive?: boolean;
  /** when false the text is optional (e.g. approving with a note) */
  required?: boolean; busy?: boolean;
  onConfirm: (text: string) => void;
}

/** Confirmation with a written reason. Reject / request changes / reopen / direct publish all require a real reason. */
export function ReasonDialog({ open, onOpenChange, title, description, label = "Reason", confirmLabel, destructive, required = true, busy, onConfirm }: Props) {
  const [text, setText] = useState("");
  useEffect(() => { if (open) setText(""); }, [open]);
  const valid = required ? reasonOk(text) : true;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="wf-reason">{label}{required ? "" : " (optional)"}</Label>
          <Textarea id="wf-reason" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1000}
            placeholder={required ? "Explain what needs to happen…" : "Add a note for the teacher…"} />
          {required && !valid && text.length > 0 && <p className="text-xs text-muted-foreground">Please write at least {MIN_REASON} characters.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={!valid || busy} onClick={() => onConfirm(text.trim())}>
            {busy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}{confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
