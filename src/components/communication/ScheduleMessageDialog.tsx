/**
 * ScheduleMessageDialog.tsx
 * Compose-time dialog for scheduling a message (and editing a scheduled one) inside the existing Communication
 * Centers. Presentation + validation only: the caller supplies the candidate recipients and performs the save.
 * Recipients can be un-ticked here (removed from the send); adding new ones means scheduling a new message.
 */
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarClock, FileText, Users, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  MAX_MESSAGE_LENGTH, fromLocalInputValue, schedulePresets, timeUntil, toLocalInputValue, validateSchedule,
  type RecipientRef,
} from "@/lib/scheduledMessagesModel";

export interface ScheduleCandidate {
  id: string;
  role: string;
  name: string;
  subtitle?: string;
}

export interface ScheduleSubmit {
  message: string;
  when: Date;
  recipients: RecipientRef[];
  removeAttachment: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** Everyone this message could go to (all ticked by default). */
  candidates: ScheduleCandidate[];
  /** Who is ticked when the dialog opens (edit mode: the message's current recipients). Defaults to everyone. */
  initialSelectedIds?: string[];
  initialMessage?: string;
  initialWhen?: Date | null;
  /** Name of an attachment that goes with the message (new file from the composer, or the saved one when editing). */
  attachmentName?: string | null;
  audienceLabel?: string | null;
  /** Resolves to an error message to show, or null on success (the caller closes the dialog). */
  onSubmit: (values: ScheduleSubmit) => Promise<string | null>;
}

export function ScheduleMessageDialog({
  open, onOpenChange, mode, candidates, initialSelectedIds, initialMessage = "", initialWhen = null,
  attachmentName = null, audienceLabel = null, onSubmit,
}: Props) {
  const [message, setMessage] = useState(initialMessage);
  const [localValue, setLocalValue] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [showRecipients, setShowRecipients] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Reset every time the dialog opens
  useEffect(() => {
    if (!open) return;
    setMessage(initialMessage);
    setLocalValue(initialWhen ? toLocalInputValue(initialWhen) : "");
    setSelected(new Set(initialSelectedIds ?? candidates.map((c) => c.id)));
    setRemoveAttachment(false);
    setShowRecipients(false);
    setServerError(null);
    setTouched(false);
    setNow(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = useMemo(() => candidates.filter((c) => selected.has(c.id)), [candidates, selected]);
  const hasAttachment = !!attachmentName && !removeAttachment;
  const validation = validateSchedule({ text: message, hasAttachment, localValue, recipientCount: chosen.length }, now);
  const presets = useMemo(() => schedulePresets(now), [now, open]);
  const tz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } }, []);
  const minValue = toLocalInputValue(new Date(now.getTime() + 60_000));

  const submit = async () => {
    setTouched(true);
    const fresh = new Date();
    setNow(fresh);
    const v = validateSchedule({ text: message, hasAttachment, localValue, recipientCount: chosen.length }, fresh);
    if (!v.ok || !v.when) return;
    setSubmitting(true);
    setServerError(null);
    const err = await onSubmit({
      message: message.trim(),
      when: v.when,
      recipients: chosen.map((c) => ({ id: c.id, role: c.role })),
      removeAttachment,
    });
    setSubmitting(false);
    if (err) setServerError(err);
  };

  const toggle = (id: string) =>
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const parsedWhen = fromLocalInputValue(localValue);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-green-600" />
            {mode === "edit" ? "Edit scheduled message" : "Schedule message"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Changes apply only while the message has not been sent."
              : "It will be delivered automatically at the time you choose, through the normal Communication Center."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="sched-message">Message</label>
            <Textarea
              id="sched-message" rows={4} value={message} maxLength={MAX_MESSAGE_LENGTH + 100}
              onChange={(e) => setMessage(e.target.value)} placeholder="Write your message…" className="resize-y"
            />
            <div className="flex justify-between text-xs">
              <span className="text-destructive">{touched ? validation.errors.message : ""}</span>
              <span className="text-muted-foreground">{message.length}/{MAX_MESSAGE_LENGTH}</span>
            </div>
            {attachmentName && (
              <div className="inline-flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 text-xs">
                <FileText className="h-3.5 w-3.5" />
                <span className={removeAttachment ? "line-through opacity-60" : ""}>{attachmentName}</span>
                {mode === "edit" && (
                  <button type="button" onClick={() => setRemoveAttachment((v) => !v)} className="underline">
                    {removeAttachment ? "Keep" : "Remove"}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="sched-when">Send on</label>
            <Input id="sched-when" type="datetime-local" value={localValue} min={minValue} onChange={(e) => setLocalValue(e.target.value)} />
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.id} type="button" onClick={() => setLocalValue(toLocalInputValue(p.at))}
                  className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:bg-green-50 hover:border-green-300"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-destructive">{touched ? validation.errors.when : ""}</span>
              <span className="text-muted-foreground">
                {parsedWhen ? `${format(parsedWhen, "EEE d MMM yyyy, h:mm a")} (${timeUntil(parsedWhen, now)})` : ""}
              </span>
            </div>
            {tz && <p className="text-[11px] text-muted-foreground">Times are in your local time zone ({tz}).</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <Users className="h-4 w-4" /> To {audienceLabel ? <b>{audienceLabel}</b> : null}
                <span className="text-muted-foreground font-normal">({chosen.length} of {candidates.length})</span>
              </span>
              {candidates.length > 1 && (
                <button type="button" className="text-xs text-green-700 underline" onClick={() => setShowRecipients((v) => !v)}>
                  {showRecipients ? "Hide" : "Review recipients"}
                </button>
              )}
            </div>
            {showRecipients && (
              <div className="border rounded-lg max-h-48 overflow-y-auto divide-y">
                <div className="flex gap-3 px-3 py-1.5 text-xs bg-slate-50 sticky top-0">
                  <button type="button" className="underline" onClick={() => setSelected(new Set(candidates.map((c) => c.id)))}>Select all</button>
                  <button type="button" className="underline" onClick={() => setSelected(new Set())}>Clear</button>
                </div>
                {candidates.map((c) => (
                  <label key={c.id} className="flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                    <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <span className="truncate">{c.name}</span>
                    {c.subtitle && <span className="text-xs text-muted-foreground truncate">{c.subtitle}</span>}
                  </label>
                ))}
              </div>
            )}
            {candidates.length === 1 && <p className="text-xs text-muted-foreground">{candidates[0].name}{candidates[0].subtitle ? ` · ${candidates[0].subtitle}` : ""}</p>}
            {touched && validation.errors.recipients && <p className="text-xs text-destructive">{validation.errors.recipients}</p>}
          </div>

          {serverError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <X className="h-4 w-4 mt-0.5 shrink-0" /> {serverError}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Close</Button>
          <Button onClick={submit} disabled={submitting} className="bg-green-600 hover:bg-green-700 gap-1.5">
            {submitting ? <LoadingSpinner size="sm" /> : <CalendarClock className="h-4 w-4" />}
            {mode === "edit" ? "Save changes" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
