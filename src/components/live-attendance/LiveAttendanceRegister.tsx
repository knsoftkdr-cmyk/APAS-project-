import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  RESULT_META,
  fetchDayRegister,
  fetchRules,
  formatClock,
  formatDuration,
  endStay,
  overrideAttendance,
  presenceState,
  revertAttendanceOverride,
  utcToday,
  type AttendanceResult,
  type DayRegisterRow,
  type LiveAttendanceRules,
} from "@/lib/liveAttendance";

interface Props {
  session: { id: string; class_id: string };
  /** session_date (UTC calendar day), the convention the live-class screens already use. */
  date: string;
}

const REFRESH_MS = 60_000;
const RESULT_ORDER: AttendanceResult[] = ["present", "partial", "absent", "excused"];

export function LiveAttendanceRegister({ session, date }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<DayRegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [legacy, setLegacy] = useState(false);
  const [rules, setRules] = useState<LiveAttendanceRules | null>(null);
  const [pending, setPending] = useState<{ row: DayRegisterRow; result: AttendanceResult } | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (silent: boolean) => {
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const res = await fetchDayRegister({ id: session.id, class_id: session.class_id }, date);
        if (id !== requestId.current) return; // a newer request (another date / session) wins
        setRows(res.rows);
        setLegacy(res.legacy);
      } catch (e) {
        if (!silent) toast({ title: "Failed to load attendance", description: (e as Error).message, variant: "destructive" });
      } finally {
        if (id === requestId.current && !silent) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.id, session.class_id, date],
  );

  useEffect(() => { void load(false); }, [load]);

  // The class may be running: refresh quietly so joins and leaves show up without reopening the dialog.
  useEffect(() => {
    if (date !== utcToday()) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") void load(true); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [date, load]);

  useEffect(() => {
    let alive = true;
    fetchRules().then((r) => { if (alive) setRules(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const counts = useMemo(() => {
    const c: Record<AttendanceResult, number> = { present: 0, partial: 0, absent: 0, excused: 0 };
    rows.forEach((r) => { c[r.result] += 1; });
    return c;
  }, [rows]);
  const inClassNow = rows.filter((r) => presenceState(r) === "in_class").length;
  const awayNow = rows.filter((r) => presenceState(r) === "away").length;
  const anyProvisional = rows.some((r) => r.join_count > 0 && !r.is_final);

  async function commit(row: DayRegisterRow, result: AttendanceResult, why?: string) {
    setSaving(true);
    // optimistic: the dropdown reflects the choice immediately, the reload below confirms it
    setRows((prev) => prev.map((r) => (r.student_id === row.student_id ? { ...r, result } : r)));
    try {
      await overrideAttendance({ sessionId: session.id, studentId: row.student_id, date, result, reason: why, legacy });
      await load(true);
    } catch (e) {
      toast({ title: "Failed to update attendance", description: (e as Error).message, variant: "destructive" });
      await load(true);
    } finally {
      setSaving(false);
      setPending(null);
      setReason("");
    }
  }

  function requestChange(row: DayRegisterRow, result: AttendanceResult) {
    if (result === row.result) return;
    // Changing something the system measured: ask for an (optional) reason so the correction is explainable later.
    if (row.auto_result && !legacy) {
      setReason("");
      setPending({ row, result });
      return;
    }
    void commit(row, result);
  }

  async function markLeft(row: DayRegisterRow) {
    setSaving(true);
    try {
      await endStay(session.id, row.student_id, date);
      toast({ title: "Marked as left", description: row.full_name });
      await load(true);
    } catch (e) {
      toast({ title: "Could not end the stay", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function revert(row: DayRegisterRow) {
    setSaving(true);
    try {
      await revertAttendanceOverride(session.id, row.student_id, date);
      toast({ title: "Back to automatic attendance", description: row.full_name });
      await load(true);
    } catch (e) {
      toast({ title: "Could not revert", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
        <span className="w-4 h-4 rounded-full border-2 border-teal-300 border-t-teal-600 animate-spin" /> Loading roster...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {RESULT_ORDER.map((k) => (
            <Badge key={k} className={`${RESULT_META[k].badge} hover:opacity-90`}>
              {RESULT_META[k].label}: {counts[k]}
            </Badge>
          ))}
          {inClassNow > 0 && <Badge className="bg-emerald-600 text-white hover:opacity-90">In class now: {inClassNow}</Badge>}
          {awayNow > 0 && <Badge className="bg-amber-500 text-white hover:opacity-90">Away: {awayNow}</Badge>}
        </div>
        {legacy ? (
          <p className="text-xs text-muted-foreground">
            Automatic tracking is not enabled in the database yet, so only manual attendance is shown.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Recorded automatically when students join
            {rules ? ` · Present ≥ ${rules.present_min_percent}% of the class · Partial ≥ ${rules.partial_min_percent}%` : ""}
            {anyProvisional ? " · totals for a running class are provisional" : ""}.
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No students are assigned to this class.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const tracked = r.join_count > 0;
            const corrected = r.result_source === "teacher" && !!r.auto_result;
            const presence = presenceState(r);
            return (
              <div key={r.student_id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-slate-800 truncate">{r.full_name}</p>
                    <p className="text-xs text-muted-foreground">Roll: {r.roll_number ?? "-"}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
                    {presence === "in_class" && <Badge className="bg-emerald-600 text-white hover:opacity-90">In class</Badge>}
                    {presence === "away" && <Badge className="bg-amber-500 text-white hover:opacity-90">Away</Badge>}
                    <Badge className={`${RESULT_META[r.result].badge} hover:opacity-90`}>{RESULT_META[r.result].label}</Badge>
                  </div>
                </div>

                {r.first_joined_at && (
                  <p className="text-xs text-slate-600">
                    Joined {formatClock(r.first_joined_at)}
                    {tracked && (presence === "in_class" ? " · in class now" : presence === "away" ? ` · last seen ${formatClock(r.last_seen_at)}` : ` · Left ${formatClock(r.last_left_at)}`)}
                    {tracked && ` · ${formatDuration(r.total_seconds)}`}
                    {tracked && r.attended_percent != null && ` (${r.attended_percent}%)`}
                  </p>
                )}

                {(r.is_late || r.join_count > 1 || (tracked && !r.is_final) || corrected) && (
                  <div className="flex flex-wrap gap-1.5">
                    {r.is_late && <Badge variant="outline" className="border-amber-300 text-amber-700">Late join</Badge>}
                    {r.join_count > 1 && <Badge variant="outline">Rejoined {r.join_count - 1}×</Badge>}
                    {tracked && !r.is_final && <Badge variant="outline" className="border-slate-300 text-slate-600">Provisional</Badge>}
                    {corrected && (
                      <Badge variant="outline" className="border-sky-300 text-sky-700" title={r.correction_reason ?? undefined}>
                        Corrected by teacher{r.auto_result ? ` (tracked: ${RESULT_META[r.auto_result].label})` : ""}
                      </Badge>
                    )}
                  </div>
                )}
                {corrected && r.correction_reason && <p className="text-xs text-slate-500">Reason: {r.correction_reason}</p>}

                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={r.result} onValueChange={(v) => requestChange(r, v as AttendanceResult)} disabled={saving}>
                    <SelectTrigger className="w-full sm:w-36 h-9 border-slate-200" aria-label={`Attendance for ${r.full_name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESULT_ORDER.filter((k) => !(legacy && k === "partial")).map((k) => (
                        <SelectItem key={k} value={k}>{RESULT_META[k].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {r.in_class && (
                    <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => markLeft(r)} disabled={saving}>
                      Mark as left
                    </Button>
                  )}
                  {corrected && (
                    <Button size="sm" variant="ghost" className="h-9 text-xs text-sky-700" onClick={() => revert(r)} disabled={saving}>
                      Revert to automatic
                    </Button>
                  )}
                </div>

                {r.intervals.length > 0 && (
                  <details className="text-xs text-slate-600">
                    <summary className="cursor-pointer select-none text-teal-700">
                      {r.intervals.length === 1 ? "1 stay" : `${r.intervals.length} stays`}
                    </summary>
                    <ul className="mt-1 space-y-0.5 ps-4 list-disc">
                      {r.intervals.map((iv, i) => (
                        <li key={i}>
                          {formatClock(iv.joined_at)} → {iv.open ? "open" : formatClock(iv.left_at)}
                          {iv.reason && !iv.open && (
                            <span className="text-muted-foreground">
                              {" "}({iv.reason === "manual" ? "left" : iv.reason === "session_ended" ? "class ended" : "connection lost"})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!pending} onOpenChange={(open) => { if (!open && !saving) { setPending(null); setReason(""); } }}>
        <DialogContent className="max-w-sm w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle className="text-base">Correct attendance</DialogTitle>
          </DialogHeader>
          {pending && (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                <span className="font-medium">{pending.row.full_name}</span> was recorded as{" "}
                <span className="font-medium">{RESULT_META[pending.row.result].label}</span>
                {" "}({formatDuration(pending.row.total_seconds)}
                {pending.row.attended_percent != null ? `, ${pending.row.attended_percent}%` : ""}). Change to{" "}
                <span className="font-medium">{RESULT_META[pending.result].label}</span>?
              </p>
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-600">Reason (optional)</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 200))}
                  rows={2}
                  placeholder="e.g. Network dropped, was in the class the whole time"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setPending(null); setReason(""); }} disabled={saving}>Cancel</Button>
            <Button
              className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white"
              onClick={() => pending && commit(pending.row, pending.result, reason)}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default LiveAttendanceRegister;
