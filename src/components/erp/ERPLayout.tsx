import { ReactNode, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Home, Users, Wallet, Bus, Search, Bell, Settings, LogOut, ChevronDown, GraduationCap, Package, BookOpen, Menu, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPTransportAssistantWidget } from "@/components/erp-transport/ERPTransportAssistantWidget";

type NavItem = { label: string; icon: React.ElementType; path: string };

export const ERP_NAV_ITEMS: NavItem[] = [
  { label: "Home", icon: Home, path: "/erp/dashboard" },
  { label: "People", icon: Users, path: "/erp/people" },
  { label: "Admissions", icon: GraduationCap, path: "/erp/admissions" },
  { label: "Fee Management", icon: Wallet, path: "/erp/fees" },
  { label: "Library", icon: BookOpen, path: "/erp/library" },
  { label: "Transport", icon: Bus, path: "/erp/transport" },
  { label: "Inventory", icon: Package, path: "/erp/inventory" },
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
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [schoolId, setSchoolId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const loadSchoolId = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return;
      const { data: profileData } = await supabase
        .from("profiles")
        .select("school_id")
        .eq("id", sessionData.session.user.id)
        .single();
      setSchoolId((profileData as any)?.school_id ?? undefined);
    };
    loadSchoolId();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const goTo = (path: string) => {
    setMobileNavOpen(false);
    navigate(path);
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Desktop sidebar — unchanged, hidden on mobile */}
      <aside className="hidden md:flex md:w-20 lg:w-24 bg-[#12203a] flex-col items-center py-6 gap-1">
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

      {/* Mobile nav drawer */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative w-64 max-w-[80vw] bg-[#12203a] flex flex-col py-5 px-3 gap-1 h-full overflow-y-auto animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between px-2 pb-4">
              <div className="flex items-center gap-2 font-bold text-white">
                <div className="h-7 w-7 rounded bg-gradient-to-br from-blue-500 to-emerald-400" />
                ERP
              </div>
              <button onClick={() => setMobileNavOpen(false)} className="text-slate-300 p-1">
                <X className="h-5 w-5" />
              </button>
            </div>
            {ERP_NAV_ITEMS.map(({ label, icon: Icon, path }) => {
              const active = path === activePath;
              return (
                <button
                  key={label}
                  onClick={() => goTo(path)}
                  className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition ${
                    active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {label}
                </button>
              );
            })}
            <button
              onClick={handleSignOut}
              className="mt-auto flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-slate-300 hover:bg-white/5"
            >
              <LogOut className="h-5 w-5 shrink-0" />
              Sign Out
            </button>
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-3 sm:px-4 md:px-6 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden shrink-0 p-2 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 font-bold text-base md:text-lg text-slate-900 truncate">
              <div className="h-7 w-7 shrink-0 rounded bg-gradient-to-br from-blue-600 to-emerald-500" />
              <span className="hidden xs:inline">ERP</span>
            </div>
          </div>

          <div className="flex-1 max-w-md mx-8 relative hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              placeholder="Search..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-2 md:gap-4 relative shrink-0">
            <button
              onClick={() => setOrgMenuOpen((v) => !v)}
              className="flex items-center gap-1 text-xs md:text-sm font-medium text-slate-700 hover:text-slate-900 max-w-[110px] sm:max-w-none"
            >
              <span className="truncate">{orgName}</span>
              <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
            </button>
            {orgMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setOrgMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-52 rounded-lg border border-slate-200 bg-white shadow-lg z-20 overflow-hidden">
                  <button
                    onClick={() => {
                      setOrgMenuOpen(false);
                      navigate("/erp/settings");
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                  >
                    <Settings className="h-4 w-4 text-slate-400" />
                    Organization Settings
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 text-left border-t border-slate-100"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Sub tabs */}
        <div className="min-h-11 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 md:px-6 py-2 md:py-0 md:h-11">
          <span className="text-sm font-semibold text-slate-900 border-b-2 border-blue-600 pb-1 md:pb-3 md:-mb-px">
            {tabLabel}
          </span>
          {headerActions && (
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              {headerActions}
            </div>
          )}
        </div>

        {/* Content */}
        <main className="flex-1 flex flex-col px-3 sm:px-4 md:px-6 py-4 md:py-6 pb-20 md:pb-6 overflow-x-hidden">
          {children}
        </main>
        <ERPTransportAssistantWidget
          schoolId={schoolId}
          onNavigate={(tab) => navigate(`/erp/transport?tab=${tab}`)}
          isTransportTab={activePath === "/erp/transport"}
        />
      </div>
    </div>
  );
};

export default ERPLayout;