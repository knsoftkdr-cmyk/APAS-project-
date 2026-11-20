import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { saveCounsellor, saveSlaConfig } from "@/hooks/useAdmissionAssignment";
import { RESPONSE_EVENT_OPTIONS, WEEKDAYS, type EligibleStaff, type SlaConfig } from "@/lib/admissionAssignment";

const hhmm = (t: string) => t.slice(0, 5);
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

/** Add a counsellor (person = null) or change one's availability / capacity. Mounted by the parent only while open. */
export function CounsellorDialog({ schoolId, person, staff, onClose, onSaved }: {
  schoolId: string; person: EligibleStaff | null; staff: EligibleStaff[]; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [profileId, setProfileId] = useState(""); const [active, setActive] = useState(true); const [available, setAvailable] = useState(true);
  const [until, setUntil] = useState(""); const [maxOpen, setMaxOpen] = useState(""); const [redistribute, setRedistribute] = useState(false); const [saving, setSaving] = useState(false);
  const adding = !person?.is_counsellor;
  useEffect(() => {
    setProfileId(person?.profile_id ?? ""); setActive(person?.is_counsellor ? person.is_active : true); setAvailable(person?.is_counsellor ? person.is_available : true);
    setUntil(toLocalInput(person?.unavailable_until ?? null)); setMaxOpen(person?.max_open_leads ? String(person.max_open_leads) : ""); setRedistribute(false);
  }, [person]);
  const cap = maxOpen.trim() === "" ? null : Number(maxOpen);
  const capBad = cap !== null && (!Number.isInteger(cap) || cap < 1);
  const leaving = !active || !available;
  const save = async () => {
    if (!profileId || capBad) return;
    setSaving(true);
    const { error, result } = await saveCounsellor({ schoolId, profileId, active, available, unavailableUntil: !available && until ? new Date(until).toISOString() : null, maxOpen: cap, redistribute: redistribute && leaving });
    setSaving(false);
    if (error) { toast({ title: "Could not save", description: error, variant: "destructive" }); return; }
    const extra = [result.redistributed ? `${result.redistributed} open lead(s) moved to other counsellors` : "", result.waiting_assigned ? `${result.waiting_assigned} waiting lead(s) assigned` : ""].filter(Boolean).join(" · ");
    toast({ title: "Counsellor saved", description: extra || undefined }); onSaved(); onClose();
  };
  const candidates = staff.filter((s) => !s.is_counsellor);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{adding ? "Add counsellor" : person?.name}</DialogTitle>
          <DialogDescription>{adding ? "Counsellors receive new leads in rotation." : "Control whether this person receives new leads."}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {adding && (
            <div><Label htmlFor="cs-person">Staff member</Label>
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger id="cs-person"><SelectValue placeholder="Choose staff" /></SelectTrigger>
                <SelectContent>{candidates.map((s) => <SelectItem key={s.profile_id} value={s.profile_id}>{s.name} · {s.role}</SelectItem>)}</SelectContent>
              </Select>
              {candidates.length === 0 && <p className="text-xs text-muted-foreground mt-1">Everyone with Admissions access is already a counsellor.</p>}</div>)}
          <div className="flex items-center justify-between"><Label htmlFor="cs-active">Active (in rotation)</Label><Switch id="cs-active" checked={active} onCheckedChange={setActive} /></div>
          <div className="flex items-center justify-between"><Label htmlFor="cs-avail">Available now</Label><Switch id="cs-avail" checked={available} onCheckedChange={setAvailable} /></div>
          {!available && (
            <div><Label htmlFor="cs-until">Back on (optional)</Label><Input id="cs-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">They return to the rotation automatically at this time.</p></div>)}
          <div><Label htmlFor="cs-max">Maximum open leads (optional)</Label>
            <Input id="cs-max" inputMode="numeric" value={maxOpen} onChange={(e) => setMaxOpen(e.target.value)} placeholder="No limit" />
            {capBad && <p className="text-xs text-red-600 mt-1">Enter a whole number of 1 or more.</p>}</div>
          {leaving && !adding && (
            <label className="flex items-start gap-2 text-sm"><Checkbox checked={redistribute} onCheckedChange={(v) => setRedistribute(v === true)} className="mt-0.5" />
              <span>Move their open leads to the other counsellors now</span></label>)}
        </div>
        <DialogFooter className="gap-2 sm:gap-0"><Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !profileId || capBad}>{saving && <Loader2 className="h-4 w-4 animate-spin me-1.5" />}Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

/** SLA targets, working hours, working days and which interactions count as a genuine first response. */
export function SlaSettingsCard({ schoolId, config, onSaved }: { schoolId: string; config: SlaConfig; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ fr: "", fu: "", grace: "", soonFr: "", soonFu: "", start: "", end: "", tz: "" });
  const [days, setDays] = useState<number[]>([]); const [events, setEvents] = useState<string[]>([]);
  const [wh, setWh] = useState(true); const [auto, setAuto] = useState(true); const [saving, setSaving] = useState(false);
  useEffect(() => {
    setF({ fr: String(config.first_response_minutes), fu: String(config.follow_up_interval_minutes / 60), grace: String(config.follow_up_grace_minutes),
      soonFr: String(config.due_soon_first_minutes), soonFu: String(config.due_soon_follow_minutes), start: hhmm(config.work_start), end: hhmm(config.work_end), tz: config.timezone });
    setDays(config.work_days); setEvents(config.first_response_events); setWh(config.working_hours_enabled); setAuto(config.auto_assign_enabled);
  }, [config]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const problems: string[] = [];
  const fr = num(f.fr), fuH = num(f.fu), grace = num(f.grace), sF = num(f.soonFr), sU = num(f.soonFu);
  if (!(fr >= 1 && fr <= 10080)) problems.push("First response target must be 1–10080 minutes.");
  if (!(fuH * 60 >= 15 && fuH * 60 <= 43200)) problems.push("Follow-up interval must be between 15 minutes and 30 days.");
  if (!(grace >= 0 && grace <= 1440)) problems.push("Grace period must be 0–1440 minutes.");
  if (!(sF >= 0 && sU >= 0)) problems.push("Due-soon warnings cannot be negative.");
  if (wh && !(f.end > f.start)) problems.push("Working hours must end after they start.");
  if (days.length === 0) problems.push("Choose at least one working day.");
  if (events.length === 0) problems.push("Choose at least one interaction that counts as a first response.");
  const save = async () => {
    if (problems.length) return;
    setSaving(true);
    const { error } = await saveSlaConfig(schoolId, {
      first_response_minutes: Math.round(fr), follow_up_interval_minutes: Math.round(fuH * 60), follow_up_grace_minutes: Math.round(grace),
      due_soon_first_minutes: Math.round(sF), due_soon_follow_minutes: Math.round(sU), working_hours_enabled: wh, work_start: f.start, work_end: f.end,
      work_days: [...days].sort(), timezone: f.tz.trim() || config.timezone, first_response_events: events, auto_assign_enabled: auto });
    setSaving(false);
    if (error) { toast({ title: "Could not save settings", description: error, variant: "destructive" }); return; }
    toast({ title: "SLA settings saved", description: "New targets apply to clocks that start from now on." }); onSaved();
  };
  return (
    <Card className="border-slate-200 shadow-sm"><CardContent className="p-4 space-y-4">
      <div><h3 className="font-semibold text-slate-800">SLA targets &amp; working hours</h3>
        <p className="text-xs text-muted-foreground">Deadlines skip nights, non-working days and school holidays from the Academic Calendar.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div><Label htmlFor="sla-fr">First response (minutes)</Label><Input id="sla-fr" inputMode="numeric" value={f.fr} onChange={set("fr")} /></div>
        <div><Label htmlFor="sla-fu">Follow-up interval (hours)</Label><Input id="sla-fu" inputMode="decimal" value={f.fu} onChange={set("fu")} /></div>
        <div><Label htmlFor="sla-grace">Follow-up grace (minutes)</Label><Input id="sla-grace" inputMode="numeric" value={f.grace} onChange={set("grace")} /></div>
        <div><Label htmlFor="sla-soon1">“Due soon” before first response (min)</Label><Input id="sla-soon1" inputMode="numeric" value={f.soonFr} onChange={set("soonFr")} /></div>
        <div><Label htmlFor="sla-soon2">“Due soon” before follow-up (min)</Label><Input id="sla-soon2" inputMode="numeric" value={f.soonFu} onChange={set("soonFu")} /></div>
        <div><Label htmlFor="sla-tz">Time zone</Label><Input id="sla-tz" value={f.tz} onChange={set("tz")} /></div>
      </div>
      <div className="flex items-center justify-between rounded-lg border p-3"><div><Label htmlFor="sla-wh">Count working hours only</Label><p className="text-xs text-muted-foreground">Off = plain elapsed time, day and night.</p></div><Switch id="sla-wh" checked={wh} onCheckedChange={setWh} /></div>
      {wh && (<>
        <div className="grid gap-3 grid-cols-2 sm:max-w-sm">
          <div><Label htmlFor="sla-start">Opens</Label><Input id="sla-start" type="time" value={f.start} onChange={set("start")} /></div>
          <div><Label htmlFor="sla-end">Closes</Label><Input id="sla-end" type="time" value={f.end} onChange={set("end")} /></div></div>
        <div role="group" aria-label="Working days" className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <button key={d.n} type="button" aria-pressed={days.includes(d.n)} onClick={() => setDays((x) => toggle(x, d.n))}
              className={`px-3 py-1.5 rounded-lg text-sm border ${days.includes(d.n) ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200"}`}>{d.label}</button>))}</div>
      </>)}
      <fieldset className="space-y-1.5"><legend className="text-sm font-medium">What counts as the first genuine contact?</legend>
        {RESPONSE_EVENT_OPTIONS.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm"><Checkbox checked={events.includes(o.value)} onCheckedChange={() => setEvents((x) => toggle(x, o.value))} />{o.label}</label>))}
        <p className="text-xs text-muted-foreground">A missed call never counts.</p></fieldset>
      <div className="flex items-center justify-between rounded-lg border p-3"><div><Label htmlFor="sla-auto">Assign new leads automatically</Label><p className="text-xs text-muted-foreground">Off = new leads wait in the Unassigned queue for you.</p></div><Switch id="sla-auto" checked={auto} onCheckedChange={setAuto} /></div>
      {problems.length > 0 && <ul role="alert" className="text-xs text-red-600 list-disc ps-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <Button onClick={save} disabled={saving || problems.length > 0}>{saving && <Loader2 className="h-4 w-4 animate-spin me-1.5" />}Save SLA settings</Button>
    </CardContent></Card>
  );
}
