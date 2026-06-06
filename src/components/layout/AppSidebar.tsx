import {
  UserCheck,
  LayoutDashboard,
  Brain,
  BookOpen,
  BarChart3,
  Building2,
  Users,
  Settings,
  LogOut,
  ChevronLeft,
  GraduationCap,
  AlertCircle,
  Trophy,
  ClipboardList,
  Shield,
  Send,
  Bot,
  Database,
  FileText,
  Bell,
  AlertTriangle,
  Network,
  LineChart,
  Zap,
  Lock,
  CreditCard
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
// Add this import at the top with other imports
import apasLogo from "@/assets/APAS-logo.png";

const navItems: Array<{
  title: string;
  icon: any;
  path: string;
  roles?: string[];
  studentTitle?: string;
  tourId?: string;
}> = [
  { title: "Home", icon: LayoutDashboard, path: "/dashboard", roles: ["teacher", "admin", "principal", "hod", "school_admin"], tourId: "nav-home" },
  { title: "Home", icon: LineChart, path: "/student-dashboard", roles: ["student"], tourId: "nav-dashboard" },
  { title: "Reports", icon: Users, path: "/teacher", roles: ["teacher", "admin"], module: "Reports" },
  { title: "Assessments", icon: Brain, path: "/diagnostic", studentTitle: "Assessments", roles: ["student"], tourId: "nav-assessments", module: "Assessments" },
  { title: "Lesson Plan Generator", icon: BookOpen, path: "/curative", roles: ["teacher"], module: "Lesson Plans" },
  { title: "Analytics", icon: BarChart3, path: "/analytics", roles: ["teacher"], module: "Analytics" },
  { title: "Requests", icon: Send, path: "/requests", roles: ["teacher"] },
  { title: "Alerts", icon: AlertCircle, path: "/alerts", roles: ["admin"] },
  { title: "Admin Panel", icon: Shield, path: "/admin", roles: ["admin"] },
  { title: "Academic Tests", icon: ClipboardList, path: "/academic-tests", roles: ["student"], tourId: "nav-academic-tests" },
  { title: "Homework", icon: LayoutDashboard, path: "/dashboard", roles: ["student"], tourId: "nav-home" },
  { title: "Gamification", icon: Trophy, path: "/gamification", roles: ["student"], tourId: "nav-gamification", module: "Gamification" },
  { title: "Leaderboard", icon: Trophy, path: "/leaderboard", roles: ["student"] },
  { title: "Predictions", icon: Brain, path: "/predictions", roles: ["student"], tourId: "nav-predictions", module: "Risk Prediction" },
  { title: "AI Tutor", icon: Bot, path: "/ai-tutor", roles: ["student", "admin"], tourId: "nav-ai-tutor", module: "AI Tutor" },
  { title: "AI Knowledge Hub", icon: Brain, path: "/ai-knowledge", roles: ["admin"] },
  { title: "School Intelligence", icon: LineChart, path: "/school-analytics", roles: ["admin"] },
  { title: "Automation", icon: Zap, path: "/automation", roles: ["admin"] },
  { title: "Security Center", icon: Lock, path: "/security", roles: ["admin"] },
  { title: "Billing", icon: CreditCard, path: "/billing", roles: ["admin"] },
  { title: "School Admin", icon: Shield, path: "/super-admin", roles: ["school_admin"] },
  { title: "Home", icon: LayoutDashboard, path: "/parent-dashboard", roles: ["parent"] },
  { title: "HOD Dashboard", icon: UserCheck, path: "/hod-dashboard", roles: ["hod"] },
  { title: "Reports", icon: Users, path: "/teacher", roles: ["principal", "hod"] },
  { title: "Assessments", icon: Brain, path: "/diagnostic", roles: ["principal", "hod"] },
  { title: "Analytics", icon: BarChart3, path: "/analytics", roles: ["principal", "hod"] },

  { title: "Platform Admin", icon: Shield, path: "/knsoft-admin", roles: ["knsoft_admin"] },
  { title: "Billing", icon: CreditCard, path: "/billing-dashboard", roles: ["knsoft_admin"] },
  { title: "Security", icon: Lock, path: "/security-dashboard", roles: ["knsoft_admin"] },
  { title: "AI Cost Monitor", icon: Bot, path: "/ai-cost-monitoring", roles: ["knsoft_admin"] },
  { title: "Cache Management", icon: Database, path: "/cache-management", roles: ["knsoft_admin"] },
  { title: "OCR Processing", icon: FileText, path: "/ocr-processing", roles: ["knsoft_admin"] },
  { title: "Notifications", icon: Bell, path: "/notification-dashboard", roles: ["knsoft_admin"] },
  { title: "Risk Predictions", icon: AlertTriangle, path: "/risk-prediction", roles: ["knsoft_admin"] },
  { title: "Knowledge Graph", icon: Network, path: "/knowledge-graph", roles: ["knsoft_admin"] },
  { title: "School Intelligence", icon: BarChart3, path: "/school-intelligence", roles: ["knsoft_admin"] },
  { title: "Automations", icon: Zap, path: "/automation-dashboard", roles: ["knsoft_admin"] },
  { title: "Multi-Tenant", icon: Building2, path: "/multi-tenant", roles: ["knsoft_admin"] },
  { title: "Settings", icon: Settings, path: "/settings", tourId: "nav-settings" },
];

// Bottom nav items for mobile (max 5) — built dynamically based on role
const getMobileNavItems = (role?: string) => {
  const isStudent = role === "student";
  const items = [
    { title: "Home", icon: LineChart, path: "/student-dashboard" },
    { title: isStudent ? "Assessments" : "Diagnostic", icon: Brain, path: "/diagnostic" },
    ...(!isStudent ? [{ title: "Lesson Plan", icon: BookOpen, path: "/curative" }] : []),
    ...(!isStudent ? [{ title: "Analytics", icon: BarChart3, path: "/analytics" }] : []),
    ...(!isStudent ? [{ title: "Alerts", icon: AlertCircle, path: "/alerts" }] : []),
    { title: "Settings", icon: Settings, path: "/settings" },
  ];
  return items.slice(0, 5);
};

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function AppSidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: AppSidebarProps) {
  const { profile, signOut } = useAuth();
  const { can, loading: permsLoading } = usePermissions();
  const location = useLocation();

  const isStudent = profile?.role === "student";
  const mobileNavItems = getMobileNavItems(profile?.role);

  const BYPASS_ROLES = ["knsoft_admin", "admin", "school_admin"];
  const needsPermCheck = profile?.role && !BYPASS_ROLES.includes(profile.role);

  const visibleItems = navItems
    .filter((item) => {
      if (item.roles && (!profile?.role || !item.roles.includes(profile.role))) return false;
      if (needsPermCheck && (item as any).module && !permsLoading) {
        return can((item as any).module);
      }
      return true;
    });

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-foreground/30 backdrop-blur-sm md:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* Desktop / tablet sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 hidden h-screen flex-col bg-sidebar transition-all duration-300 md:flex",
          collapsed ? "w-[var(--sidebar-collapsed)]" : "w-[var(--sidebar-width)]"
        )}
      >
        <div className="flex h-[var(--header-height)] items-center justify-center border-b border-sidebar-border px-4">
  {collapsed ? (
    <img src={apasLogo} alt="APAS" className="h-12 w-12 object-contain" />
  ) : (
    <img src={apasLogo} alt="APAS" className="h-20 w-auto object-contain" />
  )}
</div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {visibleItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                data-tour-id={item.tourId}
                className={cn(
                  "group relative flex items-center gap-3 rounded-button px-3 py-2.5 text-sm font-medium transition-all duration-300 ease-out",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md scale-[1.02]"
                    : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-accent-foreground hover:translate-x-1 hover:shadow-sm"
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3/5 bg-sidebar-primary-foreground rounded-r-full animate-[scale-in_0.2s_ease-out]" />
                )}
                <item.icon className={cn("h-5 w-5 shrink-0 transition-transform duration-300", isActive ? "scale-110" : "group-hover:scale-110 group-hover:rotate-3")} />
                {!collapsed && (
                  <span className="transition-all duration-200">{isStudent && item.studentTitle ? item.studentTitle : item.title}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* User info + Logout */}
        <div className="border-t border-sidebar-border p-3 space-y-2">
          {profile && (
            <div className="flex items-center gap-3 px-2 py-1">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.full_name || "User"} className="h-8 w-8 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
                  {(profile.full_name || "U").charAt(0).toUpperCase()}
                </div>
              )}
              {!collapsed && (
                <div className="overflow-hidden">
                  <p className="truncate text-sm font-medium text-sidebar-accent-foreground">
                    {profile.full_name || "User"}
                  </p>
                  <p className="truncate text-[11px] capitalize text-sidebar-foreground">
                    {profile.role === "admin" ? "Master Admin" : profile.role === "school_admin" ? "School Admin" : profile.role === "knsoft_admin" ? "KNSoft Admin" : profile.role === "hod" ? "Head of Dept" : profile.role === "parent" ? "Parent" : profile.role}
                  </p>
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-button px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-hover hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Logout</span>}
          </button>

          <button
            onClick={onToggle}
            className="flex w-full items-center justify-center rounded-button p-2 text-sidebar-foreground transition-colors hover:bg-sidebar-hover"
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </button>
        </div>
      </aside>

      {/* Mobile slide-out sidebar (for full nav) */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-screen w-[var(--sidebar-width)] flex-col bg-sidebar transition-transform duration-300 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-[var(--header-height)] items-center justify-center border-b border-sidebar-border px-4">
  <img src={apasLogo} alt="APAS" className="h-10 w-auto object-contain" />
</div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {visibleItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onMobileClose}
                className={cn(
                  "group relative flex items-center gap-3 rounded-button px-3 py-2.5 text-sm font-medium transition-all duration-300 ease-out",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md scale-[1.02]"
                    : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-accent-foreground hover:translate-x-1"
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3/5 bg-sidebar-primary-foreground rounded-r-full" />
                )}
                <item.icon className={cn("h-5 w-5 shrink-0 transition-transform duration-300", isActive ? "scale-110" : "group-hover:scale-110 group-hover:rotate-3")} />
                <span>{isStudent && item.studentTitle ? item.studentTitle : item.title}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>

      {/* Mobile bottom navigation bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-border bg-card py-1.5 md:hidden">
        {mobileNavItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                "relative flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-medium transition-all duration-300",
                isActive ? "text-accent scale-110" : "text-muted-foreground hover:text-accent/70 active:scale-95"
              )}
            >
              {isActive && (
                <span className="absolute -top-1 w-6 h-[3px] bg-accent rounded-b-full" />
              )}
              <item.icon className={cn("h-5 w-5 transition-transform duration-300", isActive && "animate-[fade-in_0.3s_ease-out]")} />
              <span>{item.title}</span>
            </NavLink>
          );
        })}
      </nav>
    </>
  );
}
