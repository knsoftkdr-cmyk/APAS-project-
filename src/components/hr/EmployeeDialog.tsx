// Add / edit an employee: profile (directory fields) + HR-only statutory and bank details.
// The statutory section lives in its own table (employee_hr_private) that only HR staff of the school can read.
import { useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getEmployeePrivate, nextEmployeeCode, saveEmployee, saveEmployeePrivate, type Employee, type EmployeePrivate } from "@/lib/hr";

const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/, IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

interface Props {
  open: boolean; onOpenChange: (o: boolean) => void; orgId: string; userId: string | null;
  employee: Employee | null; employees: Employee[]; departments: string[]; onSaved: () => void;
}

const blank = (employees: Employee[]) => ({
  employee_code: nextEmployeeCode(employees), full_name: "", email: "", phone: "", designation: "", department: "", status: "active" as "active" | "inactive",
  date_joined: new Date().toISOString().slice(0, 10), date_of_birth: "", gender: "" as "" | "male" | "female" | "other", address: "", emergency_contact: "",
  employment_type: "permanent" as Employee["employment_type"], last_working_date: "",
});
const blankPrivate = (): Partial<EmployeePrivate> => ({ tax_regime: "new", pf_mode: "auto", esi_mode: "auto", pf_on_actual_wage: false, eps_member: true, is_disabled: false, declared_deductions_annual: 0 });

export function EmployeeDialog({ open, onOpenChange, orgId, userId, employee, employees, departments, onSaved }: Props) {
  const { toast } = useToast();
  const [f, setF] = useState(blank(employees));
  const [p, setP] = useState<Partial<EmployeePrivate>>(blankPrivate());
  const [loadingPrivate, setLoadingPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!employee) { setF(blank(employees)); setP(blankPrivate()); return; }
    setF({
      employee_code: employee.employee_code ?? "", full_name: employee.full_name, email: employee.email ?? "", phone: employee.phone ?? "", designation: employee.designation ?? "",
      department: employee.department ?? "", status: employee.status, date_joined: employee.date_joined, date_of_birth: employee.date_of_birth ?? "", gender: employee.gender ?? "",
      address: employee.address ?? "", emergency_contact: employee.emergency_contact ?? "", employment_type: employee.employment_type, last_working_date: employee.last_working_date ?? "",
    });
    setLoadingPrivate(true);
    getEmployeePrivate(employee.id).then((r) => setP(r ?? blankPrivate())).catch((e) => toast({ title: "Couldn't load statutory details", description: e.message, variant: "destructive" })).finally(() => setLoadingPrivate(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.id]);

  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const upP = (patch: Partial<EmployeePrivate>) => setP((s) => ({ ...s, ...patch }));

  const validate = (): string | null => {
    if (!f.full_name.trim()) return "Name is required";
    if (!f.date_joined) return "Joining date is required";
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "Enter a valid email address";
    if (f.phone.trim() && !/^[0-9+\-\s()]{7,15}$/.test(f.phone.trim())) return "Enter a valid phone number";
    if (f.date_of_birth && f.date_of_birth > new Date().toISOString().slice(0, 10)) return "Date of birth cannot be in the future";
    if (f.last_working_date && f.last_working_date < f.date_joined) return "Last working day cannot be before the joining date";
    if (p.pan && !PAN_RE.test(p.pan.trim().toUpperCase())) return "PAN must look like ABCDE1234F";
    if (p.uan && !/^[0-9]{12}$/.test(p.uan.trim())) return "UAN must be 12 digits";
    if (p.ifsc && !IFSC_RE.test(p.ifsc.trim().toUpperCase())) return "IFSC must look like HDFC0001234";
    if (p.bank_account_number && !/^[0-9]{6,20}$/.test(p.bank_account_number.trim())) return "Account number must be 6 to 20 digits";
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) { toast({ title: err, variant: "destructive" }); return; }
    setSaving(true);
    try {
      const id = await saveEmployee(orgId, userId, { ...f, gender: f.gender || null, status: f.status }, employee?.id);
      const hasPrivate = !!(p.pan || p.uan || p.esic_ip_number || p.bank_name || p.bank_account_number || p.ifsc) || !!employee || p.tax_regime === "old" || p.pf_mode !== "auto" || p.esi_mode !== "auto" || p.is_disabled;
      if (hasPrivate) await saveEmployeePrivate(orgId, userId, id, p);
      toast({ title: employee ? "Employee updated" : "Employee added" });
      onSaved(); onOpenChange(false);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Couldn't save", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <div className="space-y-1.5"><label className="text-sm font-medium text-slate-700">{label}</label>{node}{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{employee ? "Edit employee" : "Add employee"}</DialogTitle>
          <DialogDescription>Profile details are visible to everyone with ERP access. Statutory and bank details are visible to HR staff only.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {field("Employee ID", <Input value={f.employee_code} onChange={(e) => up("employee_code", e.target.value)} maxLength={30} />)}
          {field("Full name *", <Input value={f.full_name} onChange={(e) => up("full_name", e.target.value)} maxLength={120} />)}
          {field("Designation", <Input value={f.designation} onChange={(e) => up("designation", e.target.value)} maxLength={80} />)}
          {field("Department", <><Input value={f.department} onChange={(e) => up("department", e.target.value)} maxLength={80} list="hr-departments" /><datalist id="hr-departments">{departments.map((d) => <option key={d} value={d} />)}</datalist></>)}
          {field("Email", <Input type="email" value={f.email} onChange={(e) => up("email", e.target.value)} maxLength={120} />)}
          {field("Phone", <Input value={f.phone} onChange={(e) => up("phone", e.target.value)} maxLength={20} inputMode="tel" />)}
          {field("Joining date *", <Input type="date" value={f.date_joined} onChange={(e) => up("date_joined", e.target.value)} />)}
          {field("Employment type", <select className={SELECT} value={f.employment_type} onChange={(e) => up("employment_type", e.target.value as Employee["employment_type"])}><option value="permanent">Permanent</option><option value="probation">Probation</option><option value="contract">Contract</option><option value="part_time">Part-time</option></select>)}
          {field("Date of birth", <Input type="date" value={f.date_of_birth} onChange={(e) => up("date_of_birth", e.target.value)} />)}
          {field("Gender", <select className={SELECT} value={f.gender} onChange={(e) => up("gender", e.target.value as typeof f.gender)}><option value="">Not specified</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select>)}
          {field("Status", <select className={SELECT} value={f.status} onChange={(e) => up("status", e.target.value as "active" | "inactive")}><option value="active">Active</option><option value="inactive">Inactive</option></select>)}
          {field("Last working day", <Input type="date" value={f.last_working_date} onChange={(e) => up("last_working_date", e.target.value)} />, "Only when the employee is leaving: salary stops after this day.")}
          <div className="sm:col-span-2">{field("Address", <Textarea rows={2} value={f.address} onChange={(e) => up("address", e.target.value)} maxLength={300} />)}</div>
          {field("Emergency contact", <Input value={f.emergency_contact} onChange={(e) => up("emergency_contact", e.target.value)} maxLength={120} placeholder="Name and phone" />)}
        </div>

        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-900"><Lock className="h-4 w-4" />Statutory & bank details (HR only){loadingPrivate && <Loader2 className="h-3.5 w-3.5 animate-spin" />}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("PAN", <Input value={p.pan ?? ""} onChange={(e) => upP({ pan: e.target.value.toUpperCase() })} maxLength={10} placeholder="ABCDE1234F" />)}
            {field("UAN (EPF)", <Input value={p.uan ?? ""} onChange={(e) => upP({ uan: e.target.value.replace(/\D/g, "") })} maxLength={12} inputMode="numeric" />)}
            {field("ESIC IP number", <Input value={p.esic_ip_number ?? ""} onChange={(e) => upP({ esic_ip_number: e.target.value.replace(/\D/g, "") })} maxLength={17} inputMode="numeric" />)}
            {field("Income-tax regime", <select className={SELECT} value={p.tax_regime ?? "new"} onChange={(e) => upP({ tax_regime: e.target.value as "new" | "old" })}><option value="new">New regime (default)</option><option value="old">Old regime</option></select>)}
            {p.tax_regime === "old" && field("Declared deductions per year (₹)", <Input type="number" min={0} value={p.declared_deductions_annual ?? 0} onChange={(e) => upP({ declared_deductions_annual: Number(e.target.value) })} />, "80C, 80D etc. as verified by HR. Used only for TDS.")}
            {field("Provident fund", <select className={SELECT} value={p.pf_mode ?? "auto"} onChange={(e) => upP({ pf_mode: e.target.value as EmployeePrivate["pf_mode"] })}><option value="auto">Automatic (enrol if wages are within the ceiling)</option><option value="enrolled">Enrolled</option><option value="exempt">Not applicable</option></select>)}
            {field("ESI", <select className={SELECT} value={p.esi_mode ?? "auto"} onChange={(e) => upP({ esi_mode: e.target.value as EmployeePrivate["esi_mode"] })}><option value="auto">Automatic (if wages are within the ceiling)</option><option value="enrolled">Enrolled</option><option value="exempt">Not applicable</option></select>)}
            {field("Bank name", <Input value={p.bank_name ?? ""} onChange={(e) => upP({ bank_name: e.target.value })} maxLength={80} />)}
            {field("Account number", <Input value={p.bank_account_number ?? ""} onChange={(e) => upP({ bank_account_number: e.target.value.replace(/\D/g, "") })} maxLength={20} inputMode="numeric" autoComplete="off" />)}
            {field("IFSC", <Input value={p.ifsc ?? ""} onChange={(e) => upP({ ifsc: e.target.value.toUpperCase() })} maxLength={11} placeholder="HDFC0001234" />)}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 text-sm">
            <label className="flex items-center gap-2"><Switch checked={p.pf_on_actual_wage === true} onCheckedChange={(v) => upP({ pf_on_actual_wage: v })} />PF on full wages</label>
            <label className="flex items-center gap-2"><Switch checked={p.eps_member !== false} onCheckedChange={(v) => upP({ eps_member: v })} />Pension (EPS) member</label>
            <label className="flex items-center gap-2"><Switch checked={p.is_disabled === true} onCheckedChange={(v) => upP({ is_disabled: v })} />Person with disability</label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 text-white hover:opacity-90">
            {saving && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}{saving ? "Saving..." : employee ? "Save changes" : "Add employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
