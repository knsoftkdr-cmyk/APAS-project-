import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Home, Search, Bell, Settings, Plus, LogOut, ChevronDown, Package,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type NavItem = { label: string; icon: React.ElementType; active?: boolean };

const NAV_ITEMS: NavItem[] = [
  { label: "Home", icon: Home, active: true },
];

const ERPDashboard = () => {
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadOrg = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        navigate("/erp/login");
        return;
      }

      const { data: erpUser, error } = await supabase
        .from("erp_users")
        .select("organization_id, erp_organizations(org_name)")
        .eq("id", sessionData.session.user.id)
        .single();

      if (error || !erpUser) {
        await supabase.auth.signOut();
        navigate("/erp/login");
        return;
      }

      const org = (erpUser as any).erp_organizations;
      setOrgName(org?.org_name ?? "Your Organization");
      setLoading(false);
    };

    loadOrg();
  }, [navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/erp/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Loading your workspace...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-20 lg:w-24 bg-[#12203a] flex flex-col items-center py-6 gap-1">
        {NAV_ITEMS.map(({ label, icon: Icon, active }) => (
          <button
            key={label}
            className={`w-16 lg:w-20 flex flex-col items-center gap-1 py-3 rounded-xl text-[11px] font-medium transition ${
              active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-white/5"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span className="text-center leading-tight px-1">{label}</span>
          </button>
        ))}
        <div className="mt-auto">
          <button
            onClick={handleSignOut}
            className="w-16 lg:w-20 flex flex-col items-center gap-1 py-3 rounded-xl text-[11px] font-medium text-slate-300 hover:bg-white/5"
          >
            <LogOut className="h-5 w-5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6">
          <div className="flex items-center gap-2 font-bold text-lg text-slate-900">
            <div className="h-7 w-7 rounded bg-gradient-to-br from-blue-600 to-emerald-500" />
            ERP
          </div>

          <div className="flex-1 max-w-md mx-8 relative hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              placeholder="Search..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-4">
            <span className="text-xs text-amber-600 font-medium hidden sm:inline">Trial Mode</span>
            <Bell className="h-5 w-5 text-slate-400" />
            <Settings className="h-5 w-5 text-slate-400" />
            <div className="flex items-center gap-1 text-sm font-medium text-slate-700">
              {orgName}
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </div>
          </div>
        </header>

        {/* Sub tabs */}
        <div className="h-11 border-b border-slate-200 bg-white flex items-center px-6 gap-6">
          <span className="text-sm font-semibold text-slate-900 border-b-2 border-blue-600 pb-3 -mb-px">
            Overview
          </span>
        </div>

        {/* Content */}
        <main className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="max-w-md text-center">
            <div className="h-40 w-40 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-50 to-emerald-50 flex items-center justify-center">
              <Package className="h-16 w-16 text-blue-400" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Welcome to {orgName}</h2>
            <p className="text-slate-500 text-sm mb-6">
              This is your ERP workspace. Modules like People, Items, and Inventory will appear here
              as they're set up.
            </p>
            <Button className="bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 hover:opacity-90 text-white rounded-full px-6">
              <Plus className="h-4 w-4 mr-1" /> Get Started
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
};

export default ERPDashboard;
