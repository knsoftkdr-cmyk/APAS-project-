import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchErpProfile } from "@/lib/erpProfile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import ERPLayout from "@/components/erp/ERPLayout";
import { EmployeeDirectory } from "@/components/hr/EmployeeDirectory";
import { StaffAttendance } from "@/components/hr/StaffAttendance";
import { PayrollTab } from "@/components/hr/PayrollTab";
import { PayrollReports } from "@/components/hr/PayrollReports";
import { listEmployees, type Employee } from "@/lib/hr";

// ERP > People. One page, four tabs: Employees (directory), Attendance, Payroll, Reports.
// HR data is school-scoped by RLS (is_hr_staff); salary data and payroll runs are never readable by other schools.
const ERPPeople = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [schoolId, setSchoolId] = useState<string>("");
  const [userId, setUserId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tab, setTab] = useState("employees");

  const loadEmployees = useCallback(async (sid: string) => {
    try {
      setEmployees(await listEmployees(sid));
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Couldn't load employees", variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    const init = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        navigate("/login");
        return;
      }

      const { data: profileData, error } = await fetchErpProfile(sessionData.session.user.id);

      if (error || !profileData || (profileData as any).erp_access !== true) {
        navigate("/dashboard");
        return;
      }

      const sid = (profileData as any).school_id as string;
      const school = (profileData as any).schools;
      setSchoolId(sid);
      setUserId(sessionData.session.user.id);
      setOrgName(school?.name ?? "Your Organization");

      await loadEmployees(sid);
      setLoading(false);
    };

    init();
  }, [navigate, loadEmployees]);

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
    <ERPLayout orgName={orgName} activePath="/erp/people" tabLabel="People">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv,text/plain,text/comma-separated-values,application/vnd.ms-excel,application/csv"
        className="hidden"
        onChange={handleImportFile}
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="mb-4 overflow-x-auto">
          <TabsList className="h-auto w-max rounded-full bg-white border p-1">
            {[["employees", "Employees"], ["attendance", "Attendance"], ["payroll", "Payroll"], ["reports", "Reports"]].map(([v, label]) => (
              <TabsTrigger key={v} value={v} className="rounded-full px-5 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">{label}</TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="employees" className="mt-0">
          <EmployeeDirectory orgId={schoolId} userId={userId} employees={employees} onReload={() => loadEmployees(schoolId)} onImportClick={handleImportClick} />
        </TabsContent>
        <TabsContent value="attendance" className="mt-0">
          {tab === "attendance" && <StaffAttendance orgId={schoolId} userId={userId} employees={employees} />}
        </TabsContent>
        <TabsContent value="payroll" className="mt-0">
          {tab === "payroll" && <PayrollTab orgId={schoolId} userId={userId} orgName={orgName} employees={employees} />}
        </TabsContent>
        <TabsContent value="reports" className="mt-0">
          {tab === "reports" && <PayrollReports orgId={schoolId} orgName={orgName} employees={employees} />}
        </TabsContent>
      </Tabs>
    </ERPLayout>
  );
};

export default ERPPeople;
