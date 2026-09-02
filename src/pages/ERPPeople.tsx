import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, MoreHorizontal, Plus, UserRound, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import ERPLayout from "@/components/erp/ERPLayout";

type Employee = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  department: string | null;
  status: string;
  date_joined: string;
};

const emptyForm = { full_name: "", email: "", phone: "", designation: "", department: "" };

const ERPPeople = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [schoolId, setSchoolId] = useState<string>("");
  const [orgName, setOrgName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const loadEmployees = async (sid: string) => {
    const { data, error } = await supabase
      .from("employees" as any)
      .select("*")
      .eq("organization_id", sid)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setEmployees(data as unknown as Employee[]);
    }
  };

  useEffect(() => {
    const init = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        navigate("/login");
        return;
      }

      const { data: profileData, error } = await supabase
        .from("profiles")
        .select("erp_access, school_id, schools(name)")
        .eq("id", sessionData.session.user.id)
        .single();

      if (error || !profileData || profileData.erp_access !== true) {
        navigate("/dashboard");
        return;
      }

      const sid = (profileData as any).school_id as string;
      const school = (profileData as any).schools;
      setSchoolId(sid);
      setOrgName(school?.name ?? "Your Organization");

      await loadEmployees(sid);
      setLoading(false);
    };

    init();
  }, [navigate]);

  const handleAddEmployee = async () => {
    if (!form.full_name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { data: sessionData } = await supabase.auth.getSession();

    const { error } = await supabase.from("employees" as any).insert({
      organization_id: schoolId,
      full_name: form.full_name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      designation: form.designation.trim() || null,
      department: form.department.trim() || null,
      created_by: sessionData.session?.user.id,
    });

    setSaving(false);

    if (error) {
      toast({ title: "Couldn't add employee", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Employee added" });
    setForm(emptyForm);
    setAddOpen(false);
    await loadEmployees(schoolId);
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const text = await file.text();
    const rows = text
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter(Boolean);

    if (rows.length < 2) {
      toast({
        title: "Nothing to import",
        description: "Add a header row (name,email,phone,designation,department) plus at least one row.",
        variant: "destructive",
      });
      return;
    }

    const header = rows[0].split(",").map((h) => h.trim().toLowerCase());
    const nameIdx = header.indexOf("name") !== -1 ? header.indexOf("name") : header.indexOf("full_name");
    if (nameIdx === -1) {
      toast({
        title: "Missing 'name' column",
        description: "The first column of your CSV header should be 'name' or 'full_name'.",
        variant: "destructive",
      });
      return;
    }
    const emailIdx = header.indexOf("email");
    const phoneIdx = header.indexOf("phone");
    const designationIdx = header.indexOf("designation");
    const departmentIdx = header.indexOf("department");

    const { data: sessionData } = await supabase.auth.getSession();

    const records = rows.slice(1).map((row) => {
      const cols = row.split(",").map((c) => c.trim());
      return {
        organization_id: schoolId,
        full_name: cols[nameIdx] ?? "",
        email: emailIdx !== -1 ? cols[emailIdx] || null : null,
        phone: phoneIdx !== -1 ? cols[phoneIdx] || null : null,
        designation: designationIdx !== -1 ? cols[designationIdx] || null : null,
        department: departmentIdx !== -1 ? cols[departmentIdx] || null : null,
        created_by: sessionData.session?.user.id,
      };
    }).filter((r) => r.full_name);

    if (records.length === 0) {
      toast({ title: "No valid rows found in that file", variant: "destructive" });
      return;
    }

    const { error } = await supabase.from("employees" as any).insert(records);

    if (error) {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: `Imported ${records.length} employee${records.length === 1 ? "" : "s"}` });
    await loadEmployees(schoolId);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Loading your workspace...</p>
      </div>
    );
  }

  return (
    <ERPLayout orgName={orgName} activePath="/erp/people" tabLabel="Employees">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* Section header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 md:mb-6">
        <div className="flex items-center gap-1 text-lg font-bold text-slate-900">
          Active Employees
          <ChevronDown className="h-5 w-5 text-slate-400" />
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => setAddOpen(true)}
            className="bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 hover:opacity-90 text-white rounded-full px-5"
          >
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
          <Button variant="outline" size="icon" className="rounded-lg" onClick={handleImportClick}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {employees.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="max-w-md text-center">
            <div className="h-40 w-40 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-50 to-emerald-50 flex items-center justify-center">
              <UserRound className="h-16 w-16 text-blue-400" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Get your employees onboard</h2>
            <p className="text-slate-500 text-sm mb-6">
              Capture all necessary details about your employees and manage their salary,
              allowances and reimbursement details in this module.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button
                onClick={() => setAddOpen(true)}
                className="bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 hover:opacity-90 text-white rounded-full px-6"
              >
                Add Employee
              </Button>
              <Button variant="outline" className="rounded-full px-6" onClick={handleImportClick}>
                <Upload className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">Import Employees</span>
                <span className="sm:hidden">Import</span>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Designation</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead className="hidden sm:table-cell">Phone</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell className="font-medium text-slate-900">{emp.full_name}</TableCell>
                  <TableCell className="hidden sm:table-cell text-slate-600">{emp.designation || "—"}</TableCell>
                  <TableCell className="hidden md:table-cell text-slate-600">{emp.department || "—"}</TableCell>
                  <TableCell className="hidden md:table-cell text-slate-600">{emp.email || "—"}</TableCell>
                  <TableCell className="hidden sm:table-cell text-slate-600">{emp.phone || "—"}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        emp.status === "active"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {emp.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Employee dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Employee</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="full_name">Full name</Label>
              <Input
                id="full_name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Jane Doe"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="jane@company.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+1 555 000 0000"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="designation">Designation</Label>
                <Input
                  id="designation"
                  value={form.designation}
                  onChange={(e) => setForm({ ...form, designation: e.target.value })}
                  placeholder="Accountant"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="department">Department</Label>
                <Input
                  id="department"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  placeholder="Finance"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddEmployee}
              disabled={saving}
              className="bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 hover:opacity-90 text-white"
            >
              {saving ? "Saving..." : "Add Employee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
};

export default ERPPeople;