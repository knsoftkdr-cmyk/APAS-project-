import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import ERPLayout from "@/components/erp/ERPLayout";
import { AdmissionDashboard } from "@/components/admission/AdmissionDashboard";

const ERPAdmissions = () => {
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState<string>("");
  const [loading, setLoading] = useState(true);

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

      const school = (profileData as any).schools;
      setOrgName(school?.name ?? "Your Organization");
      setLoading(false);
    };

    init();
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Loading your workspace...</p>
      </div>
    );
  }

  return (
    <ERPLayout orgName={orgName} activePath="/erp/admissions" tabLabel="Admissions">
      <AdmissionDashboard />
    </ERPLayout>
  );
};

export default ERPAdmissions;
