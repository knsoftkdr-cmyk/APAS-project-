import {
  LayoutDashboard,
  Brain,
  BookOpen,
  BarChart3,
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
  LineChart,
  Zap,
  Lock,
  CreditCard,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const navItems: Array<{
  title: string;
  icon: any;
  path: string;
  roles?: string[];
  studentTitle?: string;
  tourId?: string;
}> = [
  { title: "Home", icon: LayoutDashboard, path: "/dashboard", tourId: "nav-home" },
  { title: "Dashboard", icon: LineChart, path: "/student-dashboard", roles: ["student"], tourId: "nav-dashboard" },
  { title: "Reports", icon: Users, path: "/teacher", roles: ["teacher", "admin", "school_admin"] },
  { title: "Assessments", icon: Brain, path: "/diagnostic", studentTitle: "Assessments", roles: ["student"], tourId: "nav-assessments" },
  { title: "Lesson Plan Generator", icon: BookOpen, path: "/curative", roles: ["teacher"] },
  { title: "Analytics", icon: BarChart3, path: "/analytics", roles: ["teacher", "school_admin"] },
  { title: "Requests", icon: Send, path: "/requests", roles: ["teacher"] },
  { title: "Alerts", icon: AlertCircle, path: "/alerts", roles: ["admin"] },
  { title: "Admin Panel", icon: Shield, path: "/admin", roles: ["admin", "school_admin"] },
  { title: "Academic Tests", icon: ClipboardList, path: "/academic-tests", roles: ["student"], tourId: "nav-academic-tests" },
  { title: "Gamification", icon: Trophy, path: "/gamification", roles: ["student"], tourId: "nav-gamification" },
  { title: "AI Tutor", icon: Bot, path: "/ai-tutor", roles: ["admin"] },
  { title: "AI Knowledge Hub", icon: Brain, path: "/ai-knowledge", roles: ["admin"] },
  { title: "School Intelligence", icon: LineChart, path: "/school-analytics", roles: ["admin", "school_admin"] },
  { title: "Automation", icon: Zap, path: "/automation", roles: ["admin", "school_admin"] },
  { title: "Security Center", icon: Lock, path: "/security", roles: ["admin"] },
  { title: "Billing", icon: CreditCard, path: "/billing", roles: ["admin", "school_admin"] },
  { title: "Settings", icon: Settings, path: "/settings", tourId: "nav-settings" },
];

// Bottom nav items for mobile (max 5) — built dynamically based on role
const getMobileNavItems = (role?: string) => {
  const isStudent = role === "student";
  const items = [
    { title: "Home", icon: LayoutDashboard, path: "/dashboard" },
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
  const location = useLocation();

  const isStudent = profile?.role === "student";
  const mobileNavItems = getMobileNavItems(profile?.role);

  const visibleItems = navItems.filter(
    (item) => !item.roles || (profile?.role && item.roles.includes(profile.role))
  );

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
        {/* Logo */}
        <div className="flex h-[var(--header-height)] items-center gap-3 border-b border-sidebar-border px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-button bg-sidebar-primary">
            <GraduationCap className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="truncate text-base font-bold text-sidebar-primary-foreground">APAS</span>
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
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
                {(profile.full_name || "U").charAt(0).toUpperCase()}
              </div>
              {!collapsed && (
                <div className="overflow-hidden">
                  <p className="truncate text-sm font-medium text-sidebar-accent-foreground">
                    {profile.full_name || "User"}
                  </p>
                  <p className="truncate text-[11px] capitalize text-sidebar-foreground">
                    {profile.role === "admin" ? "Master Admin" : profile.role === "school_admin" ? "Admin" : profile.role}
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
        <div className="flex h-[var(--header-height)] items-center gap-3 border-b border-sidebar-border px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-button bg-sidebar-primary">
            <GraduationCap className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          <span className="truncate text-base font-bold text-sidebar-primary-foreground">APAS</span>
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
