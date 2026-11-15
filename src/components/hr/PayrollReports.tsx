// Payroll reports (ERP > People > Reports): monthly salary, department-wise summary, employee-wise history, statutory register.
// Everything is read from finalized / draft payroll runs; downloads are CSV or Excel, salary slips are PDF.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  downloadCsv, downloadSalarySlip, downloadXlsx, inr, listEmployeeHistory, listRunItems, listRuns, monthLabel, type Employee, type PayrollItem,
} from "@/lib/hr";
import { groupBy, round2 } from "../../../supabase/functions/_shared/payrollModel";

const SELECT = "h-10 rounded-md border border-input bg-background px-3 text-sm";
type Tab = "monthly" | "department" | "employee" | "statutory";
const TABS: { v: Tab; label: string }[] = [{ v: "monthly", label: "Monthly salary" }, { v: "department", label: "Department-wise" }, { v: "employee", label: "Employee history" }, { v: "statutory", label: "EPF / ESI / TDS" }];

interface Props { orgId: string; orgName: string; employees: Employee[] }

export function PayrollReports({ orgId, orgName, employees }: Props) {
  const [tab, setTab] = useState<Tab>("monthly");
  const [runId, setRunId] = useState("");
  const [empId, setEmpId] = useState("");

  const runs = useQuery({ queryKey: ["hr-runs", orgId], queryFn: () => listRuns(orgId), staleTime: 15_000 });
  useEffect(() => { if (!runId && runs.data?.length) setRunId((runs.data.find((r) => r.status === "finalized") ?? runs.data[0]).id); }, [runs.data, runId]);
  const run = runs.data?.find((r) => r.id === runId);
  const items = useQuery({ queryKey: ["hr-run-items", runId], queryFn: () => listRunItems(runId), enabled: !!runId && tab !== "employee" });
  const hist = useQuery({ queryKey: ["hr-history", orgId, empId], queryFn: () => listEmployeeHistory(orgId, empId), enabled: tab === "employee" && !!empId });
  const list = items.data ?? [];
  const file = (name: string) => `${name}-${run ? `${run.year}-${String(run.month).padStart(2, "0")}` : ""}`;

  const dept = useMemo(() => [...groupBy(list, (i) => i.department ?? "").entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, rows]) => ({
    name, employees: rows.length, gross: round2(rows.reduce((s, r) => s + r.gross, 0)), deductions: round2(rows.reduce((s, r) => s + r.total_deductions, 0)),
    net: round2(rows.reduce((s, r) => s + r.net_pay, 0)), employer: round2(rows.reduce((s, r) => s + r.employer_total, 0)),
  })), [list]);

  const monthlyRows = (rows: PayrollItem[]) => [
    ["Employee ID", "Name", "Designation", "Department", "Paid days", "Gross", "EPF (employee)", "ESI (employee)", "TDS", "Other deductions", "Total deductions", "Net pay", "Employer contributions", "Payment status", "Paid on"],
    ...rows.map((i) => [i.employee_code, i.employee_name, i.designation, i.department, i.attendance.paid_days, i.gross, i.epf_employee, i.esi_employee, i.tds, i.other_deductions, i.total_deductions, i.net_pay, i.employer_total, i.payment_status, i.paid_on]),
  ];
  const deptRows = () => [["Department", "Employees", "Gross", "Deductions", "Net pay", "Employer contributions", "Cost to school"], ...dept.map((d) => [d.name, d.employees, d.gross, d.deductions, d.net, d.employer, round2(d.gross + d.employer)])];
  const statRows = (rows: PayrollItem[]) => [
    ["Employee ID", "Name", "UAN", "PAN", "PF wages", "EPF (employee)", "EPF (employer)", "EPS (employer)", "EDLI", "EPF admin", "ESI wages", "ESI (employee)", "ESI (employer)", "TDS"],
    ...rows.map((i) => [i.employee_code, i.employee_name, i.uan, i.pan, i.details.pf_wage ?? 0, i.epf_employee, i.employer.epf, i.employer.eps, i.employer.edli, i.employer.admin, i.details.esi_wage ?? 0, i.esi_employee, i.employer.esi, i.tds]),
  ];

  const Head = ({ cols }: { cols: string[] }) => <thead className="bg-slate-50 text-xs text-muted-foreground"><tr>{cols.map((c, i) => <th key={c} className={cn("px-3 py-2 font-medium", i === 0 ? "text-start" : "text-end")}>{c}</th>)}</tr></thead>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">{TABS.map((t) => <button key={t.v} type="button" onClick={() => setTab(t.v)} className={cn("rounded-full border px-3 py-1.5 text-sm", tab === t.v ? "border-blue-600 bg-blue-600 text-white" : "bg-white text-slate-600")}>{t.label}</button>)}</div>
        {tab !== "employee" ? (
          <select className={cn(SELECT, "ms-auto")} value={runId} onChange={(e) => setRunId(e.target.value)} aria-label="Payroll month">
            {(runs.data ?? []).map((r) => <option key={r.id} value={r.id}>{monthLabel(r.year, r.month)}{r.status === "draft" ? " (draft)" : ""}</option>)}
          </select>
        ) : (
          <select className={cn(SELECT, "ms-auto")} value={empId} onChange={(e) => setEmpId(e.target.value)} aria-label="Employee"><option value="">Choose an employee</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.employee_code ? ` (${e.employee_code})` : ""}</option>)}</select>
        )}
      </div>

      {runs.isLoading ? <Skeleton className="h-40 w-full" /> : !(runs.data?.length) ? (
        <p className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">No payroll has been generated yet. Reports appear here after you generate a month under Payroll.</p>
      ) : tab === "employee" ? (
        !empId ? <p className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">Choose an employee to see their salary history.</p> : hist.isLoading ? <Skeleton className="h-32 w-full" /> : hist.isError ? <p className="text-sm text-red-600">{(hist.error as Error).message}</p> : (
          <>
            <div className="flex justify-end"><Button variant="outline" className="rounded-full" disabled={!hist.data?.length} onClick={() => downloadCsv([["Month", "Status", "Paid days", "Gross", "Total deductions", "Net pay", "Payment"], ...hist.data!.map((h) => [monthLabel(h.year, h.month), h.status, h.attendance.paid_days, h.gross, h.total_deductions, h.net_pay, h.payment_status])], `salary-history-${employees.find((e) => e.id === empId)?.employee_code ?? "employee"}.csv`)}><Download className="me-1.5 h-4 w-4" />CSV</Button></div>
            {!hist.data?.length ? <p className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">No salary has been generated for this employee yet.</p> : (
              <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[36rem] text-sm"><Head cols={["Month", "Paid days", "Gross", "Deductions", "Net pay", "Payment", ""]} />
                <tbody>{hist.data.map((h) => (
                  <tr key={h.id} className="border-t"><td className="px-3 py-2">{monthLabel(h.year, h.month)} {h.status === "draft" && <Badge variant="outline" className="ms-1 text-[10px]">draft</Badge>}</td>
                    <td className="px-3 py-2 text-end">{h.attendance.paid_days}</td><td className="px-3 py-2 text-end">{inr(h.gross)}</td><td className="px-3 py-2 text-end">{inr(h.total_deductions)}</td><td className="px-3 py-2 text-end font-semibold">{inr(h.net_pay)}</td>
                    <td className="px-3 py-2 text-end">{h.payment_status}</td>
                    <td className="px-2 text-end"><Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Download salary slip" onClick={() => downloadSalarySlip(h, { year: h.year, month: h.month, status: h.status as "draft" | "finalized" }, orgName)}><Download className="h-3.5 w-3.5" /></Button></td></tr>))}</tbody></table></div>
            )}
          </>)
      ) : items.isLoading ? <Skeleton className="h-40 w-full" /> : items.isError ? <p className="text-sm text-red-600">{(items.error as Error).message}</p> : (
        <>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" className="rounded-full" disabled={!list.length} onClick={() => downloadCsv(tab === "monthly" ? monthlyRows(list) : tab === "department" ? deptRows() : statRows(list), `${file(tab === "monthly" ? "salary-report" : tab === "department" ? "department-payroll" : "statutory-register")}.csv`)}><Download className="me-1.5 h-4 w-4" />CSV</Button>
            <Button variant="outline" className="rounded-full" disabled={!list.length} onClick={() => downloadXlsx(tab === "monthly" ? [{ name: "Salary", rows: monthlyRows(list) }] : tab === "department" ? [{ name: "Departments", rows: deptRows() }] : [{ name: "Statutory", rows: statRows(list) }], `${file(tab === "monthly" ? "salary-report" : tab === "department" ? "department-payroll" : "statutory-register")}.xlsx`)}><FileSpreadsheet className="me-1.5 h-4 w-4" />Excel</Button>
          </div>
          {run?.status === "draft" && <p className="text-xs text-amber-700">This month is still a draft: figures may change until it is finalized.</p>}
          {!list.length ? <p className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">This payroll has no salary slips.</p> : tab === "monthly" ? (
            <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[44rem] text-sm"><Head cols={["Employee", "Gross", "EPF", "ESI", "TDS", "Other", "Net pay", "Employer cost"]} />
              <tbody>{list.map((i) => <tr key={i.id} className="border-t"><td className="px-3 py-2"><span className="font-medium">{i.employee_name}</span><span className="block text-[11px] text-muted-foreground">{i.employee_code}{i.department ? ` · ${i.department}` : ""}</span></td>
                <td className="px-3 py-2 text-end">{inr(i.gross)}</td><td className="px-3 py-2 text-end">{inr(i.epf_employee)}</td><td className="px-3 py-2 text-end">{inr(i.esi_employee)}</td><td className="px-3 py-2 text-end">{inr(i.tds)}</td><td className="px-3 py-2 text-end">{inr(i.other_deductions)}</td><td className="px-3 py-2 text-end font-semibold">{inr(i.net_pay)}</td><td className="px-3 py-2 text-end">{inr(i.employer_total)}</td></tr>)}
                <tr className="border-t-2 bg-slate-50 font-semibold"><td className="px-3 py-2">Total ({list.length})</td>{[list.reduce((s, i) => s + i.gross, 0), list.reduce((s, i) => s + i.epf_employee, 0), list.reduce((s, i) => s + i.esi_employee, 0), list.reduce((s, i) => s + i.tds, 0), list.reduce((s, i) => s + i.other_deductions, 0), list.reduce((s, i) => s + i.net_pay, 0), list.reduce((s, i) => s + i.employer_total, 0)].map((v, k) => <td key={k} className="px-3 py-2 text-end">{inr(round2(v))}</td>)}</tr></tbody></table></div>
          ) : tab === "department" ? (
            <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[36rem] text-sm"><Head cols={["Department", "Employees", "Gross", "Deductions", "Net pay", "Cost to school"]} />
              <tbody>{dept.map((d) => <tr key={d.name} className="border-t"><td className="px-3 py-2 font-medium">{d.name}</td><td className="px-3 py-2 text-end">{d.employees}</td><td className="px-3 py-2 text-end">{inr(d.gross)}</td><td className="px-3 py-2 text-end">{inr(d.deductions)}</td><td className="px-3 py-2 text-end">{inr(d.net)}</td><td className="px-3 py-2 text-end font-semibold">{inr(round2(d.gross + d.employer))}</td></tr>)}</tbody></table></div>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[52rem] text-sm"><Head cols={["Employee", "PF wages", "EPF (employee)", "EPF (employer)", "EPS", "EDLI + admin", "ESI wages", "ESI (employee)", "ESI (employer)", "TDS"]} />
              <tbody>{list.map((i) => <tr key={i.id} className="border-t"><td className="px-3 py-2"><span className="font-medium">{i.employee_name}</span><span className="block text-[11px] text-muted-foreground">UAN {i.uan ?? "—"}</span></td>
                <td className="px-3 py-2 text-end">{inr(i.details.pf_wage ?? 0)}</td><td className="px-3 py-2 text-end">{inr(i.epf_employee)}</td><td className="px-3 py-2 text-end">{inr(i.employer.epf)}</td><td className="px-3 py-2 text-end">{inr(i.employer.eps)}</td><td className="px-3 py-2 text-end">{inr(i.employer.edli + i.employer.admin)}</td>
                <td className="px-3 py-2 text-end">{inr(i.details.esi_wage ?? 0)}</td><td className="px-3 py-2 text-end">{inr(i.esi_employee)}</td><td className="px-3 py-2 text-end">{inr(i.employer.esi)}</td><td className="px-3 py-2 text-end">{inr(i.tds)}</td></tr>)}</tbody></table></div>
          )}
        </>
      )}
    </div>
  );
}
