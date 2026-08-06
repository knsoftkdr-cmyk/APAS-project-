import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import ERPLayout from "@/components/erp/ERPLayout";
import InventoryModule from "@/components/erp/inventory/InventoryModule";

const ERPInventory = () => {
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState<string>("");
  const [schoolId, setSchoolId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);

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

      const schoolIdValue = (profileData as any).school_id as string;
      const school = (profileData as any).schools;
      setOrgName(school?.name ?? "Your Organization");
      setSchoolId(schoolIdValue);
      setUserId(sessionData.session.user.id);
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
    <ERPLayout orgName={orgName} activePath="/erp/inventory" tabLabel="Inventory">
      <InventoryModule schoolId={schoolId} userId={userId} />
    </ERPLayout>
  );
};

export default ERPInventory;
