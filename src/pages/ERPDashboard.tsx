import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Wallet, Bus, GraduationCap, ArrowRight, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ERPLayout from "@/components/erp/ERPLayout";

const ERPDashboard = () => {
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [employeeCount, setEmployeeCount] = useState<number>(0);
  const [vehicleCount, setVehicleCount] = useState<number>(0);
  const [openIntakeCount, setOpenIntakeCount] = useState<number>(0);

  useEffect(() => {
    const loadOrg = async () => {
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

      const schoolId = (profileData as any).school_id as string;
      const school = (profileData as any).schools;
      setOrgName(school?.name ?? "Your Organization");

      const { count } = await supabase
        .from("employees" as any)
        .select("*", { count: "exact", head: true })
        .eq("organization_id", schoolId);

      setEmployeeCount(count ?? 0);

      const { count: vehiclesCountResult } = await supabase
        .from("vehicles" as any)
        .select("*", { count: "exact", head: true })
        .eq("school_id", schoolId);

      setVehicleCount(vehiclesCountResult ?? 0);

      const { count: intakesCountResult } = await supabase
        .from("admission_intakes" as any)
        .select("*", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .eq("is_open", true);

      setOpenIntakeCount(intakesCountResult ?? 0);
      setLoading(false);
    };

    loadOrg();
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Loading your workspace...</p>
      </div>
    );
  }

  return (
    <ERPLayout orgName={orgName} activePath="/erp/dashboard" tabLabel="Overview">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-1">Welcome to {orgName}</h2>
        <p className="text-slate-500 text-sm">
          This is your ERP workspace. Modules like People, Items, and Inventory will appear here
          as they're set up.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <button
          onClick={() => navigate("/erp/people")}
          className="text-left rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-lg hover:-translate-y-0.5 hover:border-blue-200 transition-all group"
        >
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-600 to-emerald-500 flex items-center justify-center mb-4">
            <Users className="h-6 w-6 text-white" />
          </div>
          <div className="flex items-center gap-1 font-bold text-slate-900 mb-1">
            People
            <ArrowRight className="h-4 w-4 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </div>
          <p className="text-sm text-slate-500">
            {employeeCount > 0
              ? `${employeeCount} employee${employeeCount === 1 ? "" : "s"} onboarded`
              : "No employees onboarded yet"}
          </p>
        </button>

        <button
          onClick={() => navigate("/erp/admissions")}
          className="text-left rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-lg hover:-translate-y-0.5 hover:border-blue-200 transition-all group"
        >
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-600 to-emerald-500 flex items-center justify-center mb-4">
            <GraduationCap className="h-6 w-6 text-white" />
          </div>
          <div className="flex items-center gap-1 font-bold text-slate-900 mb-1">
            Admissions
            <ArrowRight className="h-4 w-4 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </div>
          <p className="text-sm text-slate-500">
            {openIntakeCount > 0
              ? `${openIntakeCount} open intake${openIntakeCount === 1 ? "" : "s"}`
              : "Log applicants & track seats"}
          </p>
        </button>

        <button
  onClick={() => navigate("/erp/fees")}
  className="text-left rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-lg hover:-translate-y-0.5 hover:border-blue-200 transition-all group"
>
  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-600 to-emerald-500 flex items-center justify-center mb-4">
    <Wallet className="h-6 w-6 text-white" />
  </div>
  <div className="flex items-center gap-1 font-bold text-slate-900 mb-1">
    Fee Management
    <ArrowRight className="h-4 w-4 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
  </div>
  <p className="text-sm text-slate-500">Track student fee payments</p>
</button>

        <button
  onClick={() => navigate("/erp/library")}
  className="text-left rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-lg hover:-translate-y-0.5 hover:border-blue-200 transition-all group"
>
  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-600 to-emerald-500 flex items-center justify-center mb-4">
    <BookOpen className="h-6 w-6 text-white" />
  </div>
  <div className="flex items-center gap-1 font-bold text-slate-900 mb-1">
    Library Management
    <ArrowRight className="h-4 w-4 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
  </div>
  <p className="text-sm text-slate-500">Catalog, circulation & digital library</p>
</button>

        <button
          onClick={() => navigate("/erp/transport")}
          className="text-left rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-lg hover:-translate-y-0.5 hover:border-blue-200 transition-all group"
        >
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-600 to-emerald-500 flex items-center justify-center mb-4">
            <Bus className="h-6 w-6 text-white" />
          </div>
          <div className="flex items-center gap-1 font-bold text-slate-900 mb-1">
            Transport
            <ArrowRight className="h-4 w-4 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </div>
          <p className="text-sm text-slate-500">
            {vehicleCount > 0
              ? `${vehicleCount} vehicle${vehicleCount === 1 ? "" : "s"} in fleet`
              : "Manage fleet, drivers & routes"}
          </p>
        </button>

        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 opacity-60">
          <div className="h-12 w-12 rounded-xl bg-slate-200 flex items-center justify-center mb-4">
            <Users className="h-6 w-6 text-slate-400" />
          </div>
          <div className="font-bold text-slate-500 mb-1">Inventory</div>
          <p className="text-sm text-slate-400">Coming soon</p>
        </div>
      </div>
    </ERPLayout>
  );
};

export default ERPDashboard;
