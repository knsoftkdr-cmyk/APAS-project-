// Staff attendance (ERP > People > Attendance): mark a day (Present / Absent / Half-day / Leave) and see the month summary.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { clearAttendance, downloadCsv, listAttendance, listStatutory, monthLabel, monthRange, setAttendance, type AttStatus, type Employee } from "@/lib/hr";
import { resolveConfig, summarizeAttendance, lastDayOfMonth } from "../../../supabase/functions/_shared/payrollModel";

const STATUSES: { v: AttStatus; short: string; label: string; on: string }[] = [
  { v: "present", short: "P", label: "Present", on: "bg-emerald-600 text-white border-emerald-600" },
  { v: "absent", short: "A", label: "Absent", on: "bg-red-600 text-white border-red-600" },
  { v: "half_day", short: "H", label: "Half-day", on: "bg-amber-500 text-white border-amber-500" },
  { v: "leave", short: "L", label: "Leave", on: "bg-blue-600 text-white border-blue-600" },
];
const iso = (d: Date) => d.toISOString().slice(0, 10);

interface Props { orgId: string; userId: string | null; employees: Employee[] }

export function StaffAttendance({ orgId, userId, employees }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const now = new Date();
  const [view, setView] = useState<"day" | "month">("day");
  const [date, setDate] = useState(iso(now));
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });

  const staff = useMemo(() => employees.filter((e) => e.status === "active"), [employees]);
  const r = view === "day" ? monthRange(Number(date.slice(0, 4)), Number(date.slice(5, 7))) : monthRange(ym.year, ym.month);
  const key = ["hr-attendance", orgId, r.from, r.to];

  const att = useQuery({ queryKey: key, queryFn: () => listAttendance(orgId, r.from, r.to), staleTime: 15_000 });
  const stat = useQuery({ queryKey: ["hr-statutory", orgId], queryFn: () => listStatutory(orgId), staleTime: 60_000 });
  const rules = useMemo(() => { try { return stat.data ? resolveConfig(stat.data as any, orgId, lastDayOfMonth(Number(r.from.slice(0, 4)), Number(r.from.slice(5, 7)))).attendance : null; } catch { return null; } }, [stat.data, orgId, r.from]);

  const byEmpDate = useMemo(() => { const m = new Map<string, AttStatus>(); for (const a of att.data ?? []) m.set(`${a.employee_id}|${a.att_date}`, a.status); return m; }, [att.data]);

  const mark = useMutation({
    mutationFn: async (rows: { employee_id: string; status: AttStatus | null }[]) => {
      const set = rows.filter((x) => x.status).map((x) => ({ employee_id: x.employee_id, att_date: date, status: x.status as AttStatus }));
      await setAttendance(orgId, userId, set);
      for (const x of rows.filter((y) => !y.status)) await clearAttendance(x.employee_id, date);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast({ title: e instanceof Error ? e.message : "Couldn't save attendance", variant: "destructive" }),
  });

  const dayCounts = STATUSES.map((s) => ({ ...s, n: staff.filter((e) => byEmpDate.get(`${e.id}|${date}`) === s.v).length }));
  const unmarkedToday = staff.filter((e) => !byEmpDate.has(`${e.id}|${date}`) && e.date_joined <= date);

  const monthRows = useMemo(() => {
    if (!rules) return [];
    return staff.map((e) => {
      const recs = (att.data ?? []).filter((a) => a.employee_id === e.id).map((a) => ({ att_date: a.att_date, status: a.status }));
      const s = summarizeAttendance(recs, ym.year, ym.month, rules, { from: e.date_joined, to: e.last_working_date });
      return { e, s };
    });
  }, [staff, att.data, rules, ym]);

  const shiftMonth = (d: number) => setYm((v) => { const m = v.month + d; return m < 1 ? { year: v.year - 1, month: 12 } : m > 12 ? { year: v.year + 1, month: 1 } : { year: v.year, month: m }; });

  const exportMonth = () => downloadCsv([
    ["Employee ID", "Name", "Department", "Working days", "Present", "Half-day", "Leave", "Absent", "Not marked", "Loss-of-pay days", "Paid days"],
    ...monthRows.map(({ e, s }) => [e.employee_code, e.full_name, e.department, s.working_days, s.present, s.half_day, s.leave, s.absent, s.unmarked, s.lop_days, s.paid_days]),
  ], `staff-attendance-${ym.year}-${String(ym.month).padStart(2, "0")}.csv`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border bg-white p-0.5 text-sm">
          {(["day", "month"] as const).map((v) => <button key={v} type="button" onClick={() => setView(v)} className={cn("rounded-full px-4 py-1.5", view === v ? "bg-blue-600 text-white" : "text-slate-600")}>{v === "day" ? "Mark a day" : "Monthly summary"}</button>)}
        </div>
        {view === "day" ? (
          <Input type="date" value={date} max={iso(new Date(Date.now() + 86400000))} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" aria-label="Attendance date" />
        ) : (
          <div className="flex items-center gap-1"><Button size="icon" variant="outline" onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthLabel(ym.year, ym.month)}</span>
            <Button size="icon" variant="outline" onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button></div>
        )}
        {view === "day" ? (
          <Button variant="outline" className="rounded-full" disabled={mark.isPending || unmarkedToday.length === 0} onClick={() => mark.mutate(unmarkedToday.map((e) => ({ employee_id: e.id, status: "present" })))}>
            {mark.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <CheckCheck className="me-1.5 h-4 w-4" />}Mark {unmarkedToday.length} unmarked as present</Button>
        ) : <Button variant="outline" className="rounded-full" onClick={exportMonth} disabled={!monthRows.length}><Download className="me-1.5 h-4 w-4" />Download CSV</Button>}
      </div>

      {att.isLoading || stat.isLoading ? <Skeleton className="h-48 w-full" /> : att.isError ? <p className="text-sm text-red-600">{(att.error as Error).message}</p> : staff.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">Add active employees in the Directory first.</p>
      ) : view === "day" ? (
        <>
          <div className="flex flex-wrap gap-2 text-xs">{dayCounts.map((s) => <span key={s.v} className="rounded-full border bg-white px-3 py-1">{s.label}: <b>{s.n}</b></span>)}<span className="rounded-full border bg-white px-3 py-1">Not marked: <b>{unmarkedToday.length}</b></span></div>
          <div className="divide-y rounded-xl border bg-white">
            {staff.map((e) => {
              const cur = byEmpDate.get(`${e.id}|${date}`);
              const notYet = e.date_joined > date || (e.last_working_date && e.last_working_date < date);
              return (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{e.full_name}</p><p className="text-[11px] text-muted-foreground">{e.employee_code ?? ""}{e.department ? ` · ${e.department}` : ""}{notYet ? " · not employed on this date" : ""}</p></div>
                  <div className="flex gap-1.5" role="group" aria-label={`Attendance for ${e.full_name}`}>
                    {STATUSES.map((s) => (
                      <button key={s.v} type="button" disabled={mark.isPending || !!notYet} title={s.label} aria-pressed={cur === s.v}
                        onClick={() => mark.mutate([{ employee_id: e.id, status: cur === s.v ? null : s.v }])}
                        className={cn("h-9 w-9 rounded-full border text-sm font-semibold transition disabled:opacity-40", cur === s.v ? s.on : "bg-white text-slate-600 hover:bg-slate-50")}>{s.short}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">Tap a status again to clear it. P present · A absent (loss of pay) · H half-day · L leave. Unmarked working days are counted using your Statutory settings &gt; Attendance rule.</p>
        </>
      ) : !rules ? <p className="text-sm text-red-600">Attendance rules are missing. Add them under Payroll &gt; Statutory settings.</p> : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-slate-50 text-xs text-muted-foreground"><tr>{["Employee", "Working days", "Present", "Half-day", "Leave", "Absent", "Not marked", "Paid days"].map((h, i) => <th key={h} className={cn("px-3 py-2 font-medium", i ? "text-center" : "text-start")}>{h}</th>)}</tr></thead>
            <tbody>{monthRows.map(({ e, s }) => (
              <tr key={e.id} className="border-t"><td className="px-3 py-2"><span className="font-medium">{e.full_name}</span><span className="block text-[11px] text-muted-foreground">{e.employee_code}</span></td>
                <td className="px-3 py-2 text-center">{s.working_days}</td><td className="px-3 py-2 text-center text-emerald-700">{s.present}</td><td className="px-3 py-2 text-center text-amber-600">{s.half_day}</td>
                <td className="px-3 py-2 text-center text-blue-700">{s.leave}</td><td className="px-3 py-2 text-center text-red-600">{s.absent}</td>
                <td className="px-3 py-2 text-center text-slate-500">{s.unmarked}</td><td className="px-3 py-2 text-center font-semibold">{s.paid_days}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
