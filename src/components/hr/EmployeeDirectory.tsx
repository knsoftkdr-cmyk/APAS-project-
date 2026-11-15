// Employee Directory (ERP > People). Search + filter by department / designation / status; add, edit, set salary.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IndianRupee, MoreHorizontal, Pencil, Plus, Search, Upload, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmployeeDialog } from "@/components/hr/EmployeeDialog";
import { SalaryStructureDialog } from "@/components/hr/SalaryStructureDialog";
import { inr, listCurrentStructures, type Employee } from "@/lib/hr";

const SELECT = "h-10 rounded-md border border-input bg-background px-3 text-sm";
const TYPE_LABEL: Record<string, string> = { permanent: "Permanent", contract: "Contract", part_time: "Part-time", probation: "Probation" };

interface Props { orgId: string; userId: string | null; employees: Employee[]; onReload: () => void; onImportClick: () => void }

export function EmployeeDirectory({ orgId, userId, employees, onReload, onImportClick }: Props) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [desig, setDesig] = useState("");
  const [status, setStatus] = useState<"" | "active" | "inactive">("active");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [salaryFor, setSalaryFor] = useState<Employee | null>(null);

  const structures = useQuery({ queryKey: ["hr-current-structures", orgId], queryFn: () => listCurrentStructures(orgId), staleTime: 30_000 });

  const departments = useMemo(() => [...new Set(employees.map((e) => e.department).filter(Boolean) as string[])].sort(), [employees]);
  const designations = useMemo(() => [...new Set(employees.map((e) => e.designation).filter(Boolean) as string[])].sort(), [employees]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return employees.filter((e) =>
      (!status || e.status === status) && (!dept || e.department === dept) && (!desig || e.designation === desig) &&
      (!s || [e.full_name, e.employee_code, e.email, e.phone, e.designation, e.department].some((v) => (v ?? "").toLowerCase().includes(s))));
  }, [employees, q, dept, desig, status]);

  const active = employees.filter((e) => e.status === "active");
  const noSalary = active.filter((e) => !structures.data?.has(e.id)).length;

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (e: Employee) => { setEditing(e); setDialogOpen(true); };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Employees", employees.length], ["Active", active.length], ["Inactive", employees.length - active.length], ["Salary not set", noSalary]].map(([label, v], i) => (
          <div key={label as string} className={`rounded-xl border bg-white p-3 ${i === 3 && noSalary > 0 ? "border-amber-300 bg-amber-50/50" : ""}`}>
            <p className="text-[11px] text-muted-foreground">{label}</p><p className="text-xl font-semibold text-blue-950">{v}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID, phone, email..." className="ps-9" aria-label="Search employees" />
        </div>
        <select className={SELECT} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{departments.map((d) => <option key={d}>{d}</option>)}</select>
        <select className={SELECT} value={desig} onChange={(e) => setDesig(e.target.value)} aria-label="Designation"><option value="">All designations</option>{designations.map((d) => <option key={d}>{d}</option>)}</select>
        <select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <Button onClick={openAdd} className="rounded-full bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 px-5 text-white hover:opacity-90"><Plus className="me-1 h-4 w-4" />Add</Button>
        <Button variant="outline" size="icon" className="rounded-lg" onClick={onImportClick} aria-label="Import employees from CSV" title="Import from CSV"><MoreHorizontal className="h-4 w-4" /></Button>
      </div>

      {employees.length === 0 ? (
        <div className="mx-auto max-w-md py-10 text-center">
          <div className="mx-auto mb-5 flex h-32 w-32 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-emerald-50"><UserRound className="h-14 w-14 text-blue-400" /></div>
          <h2 className="mb-2 text-xl font-bold text-slate-900">Get your employees onboard</h2>
          <p className="mb-5 text-sm text-slate-500">Add staff, set their salary structure, mark attendance and run payroll, all in one place.</p>
          <div className="flex justify-center gap-3"><Button onClick={openAdd} className="rounded-full bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 px-6 text-white">Add employee</Button>
            <Button variant="outline" className="rounded-full px-6" onClick={onImportClick}><Upload className="me-1.5 h-4 w-4" />Import</Button></div>
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">No employees match these filters.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Employee</TableHead><TableHead className="hidden sm:table-cell">Designation</TableHead><TableHead className="hidden md:table-cell">Department</TableHead>
              <TableHead className="hidden lg:table-cell">Contact</TableHead><TableHead className="hidden md:table-cell">Joined</TableHead><TableHead>Monthly basic</TableHead><TableHead>Status</TableHead><TableHead className="w-24" />
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((e) => {
                const s = structures.data?.get(e.id);
                return (
                  <TableRow key={e.id}>
                    <TableCell><button type="button" onClick={() => openEdit(e)} className="text-start">
                      <span className="block font-medium text-slate-900 hover:underline">{e.full_name}</span>
                      <span className="block text-[11px] text-muted-foreground">{e.employee_code ?? "No ID"} · {TYPE_LABEL[e.employment_type] ?? e.employment_type}</span></button></TableCell>
                    <TableCell className="hidden text-slate-600 sm:table-cell">{e.designation || "—"}</TableCell>
                    <TableCell className="hidden text-slate-600 md:table-cell">{e.department || "—"}</TableCell>
                    <TableCell className="hidden text-xs text-slate-600 lg:table-cell">{e.phone || "—"}<br />{e.email || ""}</TableCell>
                    <TableCell className="hidden text-slate-600 md:table-cell">{e.date_joined}</TableCell>
                    <TableCell>{structures.isLoading ? <Skeleton className="h-4 w-16" /> : s ? <span className="font-medium">{inr(s.basic)}</span> : <button type="button" onClick={() => setSalaryFor(e)} className="text-xs font-medium text-amber-700 underline">Set salary</button>}</TableCell>
                    <TableCell><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${e.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{e.status}</span></TableCell>
                    <TableCell><div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Edit ${e.full_name}`} onClick={() => openEdit(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Salary of ${e.full_name}`} onClick={() => setSalaryFor(e)}><IndianRupee className="h-3.5 w-3.5" /></Button>
                    </div></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <EmployeeDialog open={dialogOpen} onOpenChange={setDialogOpen} orgId={orgId} userId={userId} employee={editing} employees={employees} departments={departments} onSaved={onReload} />
      <SalaryStructureDialog open={!!salaryFor} onOpenChange={(o) => !o && setSalaryFor(null)} orgId={orgId} userId={userId} employee={salaryFor} onSaved={() => { structures.refetch(); }} />
    </div>
  );
}
