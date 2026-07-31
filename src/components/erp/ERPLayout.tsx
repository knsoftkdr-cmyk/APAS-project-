import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Home, Users, Wallet, Search, Bell, Settings, LogOut, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type NavItem = { label: string; icon: React.ElementType; path: string };

export const ERP_NAV_ITEMS: NavItem[] = [
  { label: "Home", icon: Home, path: "/erp/dashboard" },
  { label: "People", icon: Users, path: "/erp/people" },
  { label: "Fee Management", icon: Wallet, path: "/erp/fees" },
];

interface ERPLayoutProps {
  orgName: string;
  activePath: string;
  tabLabel: string;
  children: ReactNode;
  headerActions?: ReactNode;
}

const ERPLayout = ({ orgName, activePath, tabLabel, children, headerActions }: ERPLayoutProps) => {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-20 lg:w-24 bg-[#12203a] flex flex-col items-center py-6 gap-1">
        {ERP_NAV_ITEMS.map(({ label, icon: Icon, path }) => {
          const active = path === activePath;
          return (
            <button
              key={label}
              onClick={() => navigate(path)}
              className={`w-16 lg:w-20 flex flex-col items-center gap-1 py-3 rounded-xl text-[11px] font-medium transition ${
                active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-white/5"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-center leading-tight px-1">{label}</span>
            </button>
          );
        })}
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
        <div className="h-11 border-b border-slate-200 bg-white flex items-center justify-between px-6">
          <span className="text-sm font-semibold text-slate-900 border-b-2 border-blue-600 pb-3 -mb-px">
            {tabLabel}
          </span>
          {headerActions && <div className="flex items-center gap-2">{headerActions}</div>}
        </div>

        {/* Content */}
        <main className="flex-1 flex flex-col px-6 py-6">{children}</main>
      </div>
    </div>
  );
};

export default ERPLayout;