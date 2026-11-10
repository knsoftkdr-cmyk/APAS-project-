import { useEffect, useMemo, useState } from "react";
import { Lock, Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addDays, formatDate, formatINR, fromCents, splitEvenly, todayIST, toCents, validateSchedule, type ScheduleRow } from "@/lib/instalments";

export interface EditorRow { key: string; id?: string; amount: string; due_date: string; removable: boolean; minAmount: number; note?: string }
export interface LockedRow { seq: number; amount: number; due_date: string; paid: number }

let k = 0;
export const newKey = () => `r${++k}`;
export const rowsFromSchedule = (rows: ScheduleRow[]): EditorRow[] => rows.map((r) => ({ key: newKey(), id: r.id, amount: String(r.amount), due_date: r.due_date, removable: true, minAmount: 0 }));

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  /** What the editable instalments must add up to. */
  total: number;
  initialRows: EditorRow[];
  /** Paid instalments - shown read-only so the history is visible but can never be touched. */
  lockedRows?: LockedRow[];
  minCount?: number;
  minAmount?: number | null;
  maxAmount?: number | null;
  submitLabel: string;
  onSubmit: (rows: ScheduleRow[]) => Promise<void>;
}

export function ScheduleEditorDialog({ open, onOpenChange, title, description, total, initialRows, lockedRows = [], minCount = 1, minAmount, maxAmount, submitLabel, onSubmit }: Props) {
  const [rows, setRows] = useState<EditorRow[]>(initialRows);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setRows(initialRows); setErr(null); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const parsed: ScheduleRow[] = useMemo(() => rows.map((r) => ({ id: r.id, amount: Number(r.amount) || 0, due_date: r.due_date })), [rows]);
  const existing = useMemo(() => new Set(rows.filter((r) => r.id).map((r) => r.id as string)), [rows]);
  const errors = useMemo(() => {
    const e = validateSchedule(parsed, total, { minCount, minAmount, maxAmount, existingIds: existing });
    rows.forEach((r, i) => { if (r.id && Number(r.amount) < r.minAmount) e.push(`Instalment ${i + 1}: ${formatINR(r.minAmount)} is already paid, so it cannot go lower.`); });
    return e;
  }, [parsed, rows, total, minCount, minAmount, maxAmount, existing]);
  const allocated = fromCents(parsed.reduce((s, r) => s + toCents(r.amount), 0));
  const remainder = fromCents(toCents(total) - toCents(allocated));

  const update = (key: string, patch: Partial<EditorRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => {
    const last = rs[rs.length - 1]?.due_date;
    return [...rs, { key: newKey(), amount: remainder > 0 ? String(remainder) : "", due_date: last ? addDays(last, 30) : addDays(todayIST(), 30), removable: true, minAmount: 0 }];
  });
  const spreadEvenly = () => setRows((rs) => {
    const locked = rs.filter((r) => r.minAmount > 0);   // part-paid rows keep their floor; spread whatever is left over the rest
    const free = rs.filter((r) => r.minAmount === 0);
    if (free.length === 0) return rs;
    const floors = locked.reduce((s, r) => s + toCents(Math.max(r.minAmount, Number(r.amount) || 0)), 0);
    const parts = splitEvenly(fromCents(toCents(total) - floors), free.length);
    let i = 0;
    return rs.map((r) => (r.minAmount === 0 ? { ...r, amount: String(parts[i++]) } : r));
  });
  const putRemainderOnLast = () => setRows((rs) => rs.length === 0 ? rs : rs.map((r, i) => (i === rs.length - 1 ? { ...r, amount: String(fromCents(toCents(Number(r.amount) || 0) + toCents(remainder))) } : r)));

  const submit = async () => {
    setSaving(true); setErr(null);
    try { await onSubmit(parsed); onOpenChange(false); }
    catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#12203a]">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {lockedRows.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1"><Lock className="h-3 w-3" /> Already paid - cannot be changed</p>
            {lockedRows.map((l) => (
              <div key={l.seq} className="flex justify-between text-sm text-slate-600"><span>Instalment {l.seq} · {formatDate(l.due_date)}</span><span className="font-medium">{formatINR(l.paid)} paid</span></div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[2rem_1fr_1fr_2.5rem] gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide px-1"><span>#</span><span>Amount (₹)</span><span>Due date</span><span /></div>
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[2rem_1fr_2.5rem] sm:grid-cols-[2rem_1fr_1fr_2.5rem] gap-2 items-center rounded-lg border border-slate-200 p-2 sm:border-0 sm:p-0">
              <span className="text-sm font-semibold text-[#12203a]">{lockedRows.length + i + 1}</span>
              <div>
                <Label className="sm:sr-only text-xs">Amount</Label>
                <Input type="number" inputMode="decimal" min={0} step="0.01" value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} aria-label={`Instalment ${i + 1} amount`} />
              </div>
              <Button type="button" variant="ghost" size="icon" disabled={!r.removable || rows.length <= minCount} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove instalment ${i + 1}`} className="sm:order-last"><Trash2 className="h-4 w-4 text-red-500" /></Button>
              <div className="col-span-3 sm:col-span-1">
                <Label className="sm:sr-only text-xs">Due date</Label>
                <Input type="date" value={r.due_date} onChange={(e) => update(r.key, { due_date: e.target.value })} aria-label={`Instalment ${i + 1} due date`} />
              </div>
              {r.minAmount > 0 && <p className="col-span-3 sm:col-span-4 text-xs text-slate-500 -mt-1 ps-8">{formatINR(r.minAmount)} already paid on this instalment.</p>}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4 me-1" /> Add instalment</Button>
          <Button type="button" variant="outline" size="sm" onClick={spreadEvenly} disabled={rows.length === 0}><Wand2 className="h-4 w-4 me-1" /> Split evenly</Button>
          {remainder !== 0 && rows.length > 0 && <Button type="button" variant="outline" size="sm" onClick={putRemainderOnLast}>Put {remainder > 0 ? formatINR(remainder) : `-${formatINR(-remainder)}`} on last</Button>}
        </div>

        <div className={`rounded-lg px-3 py-2 text-sm flex flex-wrap justify-between gap-1 ${remainder === 0 ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-amber-50 text-amber-900 border border-amber-300"}`} role="status">
          <span>Allocated <strong>{formatINR(allocated)}</strong> of <strong>{formatINR(total)}</strong></span>
          <span>{remainder === 0 ? "Totals match exactly" : remainder > 0 ? `${formatINR(remainder)} still to allocate` : `${formatINR(-remainder)} over`}</span>
        </div>

        {errors.length > 0 && <ul className="text-xs text-red-700 space-y-0.5 list-disc ps-5">{errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>}
        {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2" role="alert">{err}</p>}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || errors.length > 0} className="bg-[#12203a] hover:bg-[#1b2f55] text-white">{saving ? "Saving…" : submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
