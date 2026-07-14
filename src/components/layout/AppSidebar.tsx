import {
  CalendarDays,
  TrendingUp,
  UserCheck,
  LayoutDashboard,
  Video,
  Brain,
  BookOpen,
  BarChart3,
  Building2,
  Ticket,
  Users,
  Users2,
  Settings,
  LogOut,
  ChevronLeft,
  GraduationCap,
  AlertCircle,
  Trophy,
  MessageSquare,
  ClipboardList,
  ClipboardCheck,
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
  CreditCard,
  UserCircle,
  Sparkles,
  Compass,
  Award,
  CalendarCheck,
  ArrowRightLeft,
  IdCard,
  History,
  RotateCw,
  ShieldAlert,
  Accessibility,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import apasLogo from "@/assets/APAS-logo.png";

const navItems: Array<{
  title: string;
  icon: any;
  path: string;
  roles?: string[];
  studentTitle?: string;
  tourId?: string;
  module?: string;
  subItem?: { title: string; path: string; icon: any };
}> = [
  { title: "Home", icon: LayoutDashboard, path: "/dashboard", roles: ["teacher", "admin", "principal", "hod", "school_admin"], tourId: "nav-home", module: "Home" },
  { title: "Rotation Schedules", icon: RotateCw, path: "/rotation-schedules", roles: ["admin", "principal", "school_admin"], module: "Rotation Schedules" },
  { title: "Special Education (SEN)", icon: Accessibility, path: "/sen-management", roles: ["admin", "principal", "school_admin"], module: "SEN Management" },
  { title: "My SEN Students", icon: Accessibility, path: "/my-sen-students", roles: ["teacher", "hod"], module: "SEN Management" },
  { title: "My Accommodations", icon: Accessibility, path: "/my-accommodations", roles: ["student"], module: "My Accommodations" },
  { title: "Electives", icon: GraduationCap, path: "/admin/electives", roles: ["admin", "principal", "school_admin", "knsoft_admin"] },
  { title: "Dashboard", icon: LayoutDashboard, path: "/teacher-workspace", roles: ["teacher"], tourId: "nav-home", module: "Home" },
  { title: "Home", icon: LineChart, path: "/student-dashboard", roles: ["student"], tourId: "nav-dashboard", module: "Home" },
  { title: "Home", icon: LayoutDashboard, path: "/parent-dashboard", roles: ["parent"], module: "Home" },
  { title: "Student Profile", icon: UserCircle, path: "/student-profile", roles: ["student", "parent"], tourId: "nav-profile", module: "Student Profile" },
  { title: "Reports", icon: Users, path: "/teacher", roles: ["teacher", "admin", "principal", "hod", "student", "parent"], module: "Reports" },
  { title: "Assessments", icon: Brain, path: "/diagnostic", studentTitle: "Assessments", roles: ["student"], tourId: "nav-assessments", module: "Assessments" },
  { title: "Worksheets", icon: FileText, path: "/worksheets", roles: ["student"], tourId: "nav-worksheets" },
  { title: "Electives", icon: BookOpen, path: "/electives", roles: ["student"] },
  { title: "Courses", icon: BookOpen, path: "/student/courses", roles: ["student"], module: "Courses" },
  { title: "Credentials", icon: Award, path: "/student/credentials", roles: ["student"], module: "Credentials" },
  { title: "Lesson Plan Generator", icon: BookOpen, path: "/curative", roles: ["teacher"], module: "Lesson Plans" },
  { title: "Entry Ticket", icon: ClipboardList, path: "/entry-ticket", roles: ["teacher"], module: "Lesson Plans" },
  { title: "Worksheet Submissions", icon: ClipboardCheck, path: "/submissions", roles: ["teacher"], module: "Lesson Plans" },
  { title: "Assessment Evaluation", icon: Sparkles, path: "/assessment-evaluation", roles: ["teacher"], module: "Lesson Plans" },
  { title: "My Electives", icon: Users2, path: "/teacher-electives", roles: ["teacher"] },
  { title: "Analytics", icon: BarChart3, path: "/analytics", roles: ["teacher"], module: "Analytics" },
  { title: "At-Risk Students", icon: AlertTriangle, path: "/teacher-at-risk", roles: ["teacher"] },
  { title: "Behaviour", icon: Bell, path: "/teacher-behaviour", roles: ["teacher"] },
  { title: "Communication", icon: MessageSquare, path: "/teacher-communication", roles: ["teacher"] },
  { title: "Communication", icon: MessageSquare, path: "/parent-communication", roles: ["parent"], module: "Communication" },
  { title: "Communication", icon: MessageSquare, path: "/student-communication", roles: ["student"] },
  { title: "Communication", icon: MessageSquare, path: "/admin-communication", roles: ["admin", "principal", "hod", "school_admin"] },

  { title: "Professional Development", icon: Award, path: "/teacher-professional-development", roles: ["teacher"] },
  { title: "Appointments", icon: CalendarCheck, path: "/teacher/appointments", roles: ["teacher"] },
  { title: "Virtual Classroom", icon: Video, path: "/virtual-classrooms", roles: ["teacher"] },
  { title: "Virtual Classroom", icon: Video, path: "/virtual-classroom", roles: ["student"], module: "Virtual Classroom" },
  { title: "Group Projects", icon: Users2, path: "/teacher/group-projects", roles: ["teacher"] },
  { title: "Safeguarding", icon: ShieldAlert, path: "/teacher/safeguarding-report", roles: ["teacher"], module: "Safeguarding & Child Protection" },
  { title: "Safeguarding", icon: ShieldAlert, path: "/safeguarding", roles: ["admin", "principal", "hod"], module: "Safeguarding & Child Protection" },
  { title: "Safeguarding", icon: ShieldAlert, path: "/parent/safeguarding", roles: ["parent"], module: "Safeguarding & Child Protection" },
  { title: "Group Projects", icon: Users2, path: "/student/group-projects", roles: ["student"] },
  { title: "Appointments", icon: CalendarCheck, path: "/appointments", roles: ["parent"], module: "Appointments" },
  { title: "Requests", icon: Send, path: "/requests", roles: ["teacher", "admin", "principal", "hod", "student", "parent"], module: "Requests" },
  { title: "Alerts", icon: AlertCircle, path: "/alerts", roles: ["admin", "principal", "hod", "teacher", "student", "parent"], module: "Alerts" },
  { title: "Admin Panel", icon: Shield, path: "/admin", roles: ["admin", "principal", "hod", "teacher", "student", "parent"], module: "Admin Panel" },
  { title: "Academic Tests", icon: ClipboardList, path: "/academic-tests", roles: ["student", "admin", "principal", "hod", "teacher", "parent"], tourId: "nav-academic-tests", module: "Academic Tests" },
  { title: "Homework", icon: LayoutDashboard, path: "/dashboard", roles: ["student", "admin", "principal", "hod", "teacher", "parent"], tourId: "nav-home", module: "Homework" },
  { title: "Gamification", icon: Trophy, path: "/gamification", roles: ["student", "admin", "principal", "hod", "teacher", "parent"], tourId: "nav-gamification", module: "Gamification" },
  { title: "Leaderboard", icon: Trophy, path: "/leaderboard", roles: ["student", "admin", "principal", "hod", "teacher", "parent"], module: "Leaderboard" },
  { title: "Predictions", icon: Brain, path: "/predictions", roles: ["student", "admin", "principal", "hod", "teacher", "parent"], tourId: "nav-predictions", module: "Risk Prediction" },
  { title: "AI Tutor", icon: Bot, path: "/ai-tutor", roles: ["student", "admin", "principal", "hod", "teacher", "parent"], tourId: "nav-ai-tutor", module: "AI Tutor", subItem: { title: "AI Career Coach", path: "/ai-tutor?mode=career", icon: Compass } },
  { title: "AI Knowledge Hub", icon: Brain, path: "/ai-knowledge", roles: ["knsoft_admin"] },
  { title: "School Intelligence", icon: LineChart, path: "/school-analytics", roles: ["admin", "principal", "hod", "teacher", "student", "parent"], module: "School Intelligence" },
  { title: "Automation", icon: Zap, path: "/automation", roles: ["knsoft_admin"] },
  { title: "Security Center", icon: Lock, path: "/security", roles: ["admin", "principal", "hod", "teacher", "student", "parent"], module: "Security Center" },
  { title: "Billing", icon: CreditCard, path: "/billing", roles: ["admin", "principal", "hod", "teacher", "student", "parent"], module: "Billing" },
  { title: "School Admin", icon: Shield, path: "/super-admin", roles: ["school_admin"] },
  { title: "HOD Dashboard", icon: UserCheck, path: "/hod-dashboard", roles: ["hod"], module: "Home" },
{ title: "Analytics", icon: BarChart3, path: "/executive-reporting", roles: ["school_admin"] },
{ title: "Surveys", icon: ClipboardList, path: "/surveys", roles: ["teacher", "admin", "principal", "school_admin", "hod", "student", "parent"] },
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
  { title: "Academic Calendar", icon: CalendarDays, path: "/academic-calendar", roles: ["admin", "principal", "school_admin", "teacher", "student", "parent", "hod"], module: "Academic Calendar" },
  { title: "Semester Engine", icon: GraduationCap, path: "/semester-engine", roles: ["admin", "principal", "school_admin", "teacher", "student"], module: "Semester Engine" },
  { title: "Report Cards", icon: FileText, path: "/report-cards", roles: ["admin", "principal", "school_admin", "teacher", "student", "parent"], module: "Report Cards" },
  { title: "Alumni", icon: Users, path: "/alumni", roles: ["school_admin"] },
  { title: "Exam Seating", icon: Building2, path: "/exam-seating", roles: ["admin", "principal", "school_admin"], module: "Exam Seating" },
  { title: "Hall Tickets", icon: Ticket, path: "/hall-tickets", roles: ["admin", "principal", "school_admin", "student", "parent"], module: "Hall Tickets" },
  { title: "Invigilation", icon: UserCheck, path: "/invigilation", roles: ["admin", "principal", "school_admin", "teacher"], module: "Invigilation" },
  { title: "Houses", icon: Trophy, path: "/houses", roles: ["admin", "principal", "school_admin", "teacher", "student", "parent", "hod"], module: "Houses" },
  { title: "Student Transfers", icon: ArrowRightLeft, path: "/student-transfers", roles: ["school_admin"], module: "Student Transfers" },
  { title: "ID Cards", icon: IdCard, path: "/id-cards", roles: ["school_admin"], module: "ID Cards" },
  { title: "Lifecycle Timeline", icon: History, path: "/lifecycle-timeline", roles: ["school_admin"], module: "Lifecycle Timeline" },
  { title: "Timetable", icon: CalendarDays, path: "/timetable", roles: ["principal", "admin", "student", "teacher", "hod"], module: "Home" },
  { title: "Attendance", icon: UserCheck, path: "/attendance", roles: ["teacher", "principal", "admin", "student", "parent"], module: "Attendance" },
  { title: "Syllabus Coverage", icon: TrendingUp, path: "/syllabus-overview", roles: ["principal", "admin", "hod", "school_admin"], module: "Home" },
  { title: "Settings", icon: Settings, path: "/settings", tourId: "nav-settings" },
];

const getMobileNavItems = (role?: string) => {
  if (role === "student") {
    return [
      { title: "Home", icon: LineChart, path: "/student-dashboard" },
      { title: "Assessments", icon: Brain, path: "/diagnostic" },
      { title: "Homework", icon: LayoutDashboard, path: "/dashboard" },
      { title: "Settings", icon: Settings, path: "/settings" },
    ];
  }
  if (role === "teacher") {
    return [
      { title: "Home", icon: LayoutDashboard, path: "/dashboard" },
      { title: "Lesson Plan", icon: BookOpen, path: "/curative" },
      { title: "Analytics", icon: BarChart3, path: "/analytics" },
      { title: "Settings", icon: Settings, path: "/settings" },
    ];
  }
  if (role === "admin" || role === "principal") {
    return [
      { title: "Home", icon: LayoutDashboard, path: "/dashboard" },
      { title: "Reports", icon: Users, path: "/teacher" },
      { title: "Alerts", icon: AlertCircle, path: "/alerts" },
      { title: "Settings", icon: Settings, path: "/settings" },
    ];
  }
  if (role === "hod") {
    return [
      { title: "Home", icon: UserCheck, path: "/hod-dashboard" },
      { title: "Reports", icon: Users, path: "/teacher" },
      { title: "Settings", icon: Settings, path: "/settings" },
    ];
  }
  if (role === "school_admin") {
    return [
      { title: "School Admin", icon: Shield, path: "/super-admin" },
      { title: "Settings", icon: Settings, path: "/settings" },
    ];
  }
  if (role === "parent") {
    return [
      { title: "Home", icon: LayoutDashboard, path: "/parent-dashboard" },
      { title: "Settings", icon: Settings, path: "/settings" },
    ];
  }
  if (role === "knsoft_admin") {
    return [
      { title: "Platform", icon: Shield, path: "/knsoft-admin" },
      { title: "Billing", icon: CreditCard, path: "/billing-dashboard" },
      { title: "Security", icon: Lock, path: "/security-dashboard" },
      { title: "Settings", icon: Settings, path: "/settings" },
    ];
  }
  return [];
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
  const getItemLabel = (item: (typeof navItems)[number]) => {
    return isStudent && item.studentTitle ? item.studentTitle : item.title;
  };
  const mobileNavItems =
    profile?.role === "parent"
      ? []
      : getMobileNavItems(profile?.role);

  const BYPASS_ROLES = ["knsoft_admin", "school_admin"];
  const STUDENT_ROLES = ["student", "parent"];
  const needsPermCheck = profile?.role && !BYPASS_ROLES.includes(profile.role) && !STUDENT_ROLES.includes(profile.role);

  const visibleItems = (needsPermCheck && permsLoading) ? [] : navItems
    .filter((item) => {
      if (item.roles && (!profile?.role || !item.roles.includes(profile.role))) return false;
      if (profile?.role === "student" || profile?.role === "parent") {
        if (!(item as any).module) return true; // items with no module (Settings etc) always show
        const studentModules = ["Home", "Assessments", "Academic Tests", "Homework", "Gamification", "Leaderboard", "Predictions", "AI Tutor", "Academic Calendar", "Semester Engine", "Report Cards", "Houses", "Student Profile", "Hall Tickets", "Attendance", "Virtual Classroom", "Group Projects", "Courses", "Credentials", "My Accommodations"];
        const parentModules = ["Home", "Student Profile", "Academic Calendar", "Report Cards", "Appointments", "Hall Tickets", "Attendance", "Communication", "Safeguarding & Child Protection"];
        const allowed = profile?.role === "student" ? studentModules : parentModules;
        return allowed.includes((item as any).module);
      }
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
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-foreground/30 backdrop-blur-sm md:hidden"
          onClick={onMobileClose}
        />
      )}

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

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {visibleItems.map((item) => {
            const isActive = location.pathname === item.path;
            const isSubActive =
              item.subItem &&
              location.pathname === "/ai-tutor" &&
              new URLSearchParams(location.search).get("mode") === "career";
            return (
              <div key={item.path}>
                <NavLink
                  to={item.path}
                  data-tour-id={item.tourId}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-button px-3 py-2.5 text-sm font-medium transition-all duration-300 ease-out",
                    isActive && !isSubActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md scale-[1.02]"
                      : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-accent-foreground hover:translate-x-1 hover:shadow-sm"
                  )}
                >
                  {isActive && !isSubActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3/5 bg-sidebar-primary-foreground rounded-r-full animate-[scale-in_0.2s_ease-out]" />
                  )}
                  <item.icon className={cn("h-5 w-5 shrink-0 transition-transform duration-300", isActive && !isSubActive ? "scale-110" : "group-hover:scale-110 group-hover:rotate-3")} />
                  {!collapsed && (
                    <span className="transition-all duration-200">{getItemLabel(item)}</span>
                  )}
                </NavLink>
                {item.subItem && !collapsed && isActive && (
                  <NavLink
                    to={item.subItem.path}
                    className={cn(
                      "group relative flex items-center gap-2 rounded-button py-2 pl-10 pr-3 text-xs font-medium transition-all duration-300 ease-out",
                      isSubActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-hover hover:text-sidebar-accent-foreground hover:translate-x-1"
                    )}
                  >
                    <item.subItem.icon className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-300", isSubActive ? "scale-110" : "group-hover:scale-110")} />
                    <span>{item.subItem.title}</span>
                  </NavLink>
                )}
              </div>
            );
          })}
        </nav>

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
                    {profile.role === "admin" || profile.role === "principal" ? "Principal" : profile.role === "school_admin" ? "School Admin" : profile.role === "knsoft_admin" ? "KNSoft Admin" : profile.role === "hod" ? "Head of Dept" : profile.role === "parent" ? "Parent" : profile.role}
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
            const isSubActive =
              item.subItem &&
              location.pathname === "/ai-tutor" &&
              new URLSearchParams(location.search).get("mode") === "career";
            return (
              <div key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={onMobileClose}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-button px-3 py-2.5 text-sm font-medium transition-all duration-300 ease-out",
                    isActive && !isSubActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md scale-[1.02]"
                      : "text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-accent-foreground hover:translate-x-1"
                  )}
                >
                  {isActive && !isSubActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3/5 bg-sidebar-primary-foreground rounded-r-full" />
                  )}
                  <item.icon className={cn("h-5 w-5 shrink-0 transition-transform duration-300", isActive && !isSubActive ? "scale-110" : "group-hover:scale-110 group-hover:rotate-3")} />
                  <span>{getItemLabel(item)}</span>
                </NavLink>
                {item.subItem && isActive && (
                  <NavLink
                    to={item.subItem.path}
                    onClick={onMobileClose}
                    className={cn(
                      "group relative flex items-center gap-2 rounded-button py-2 pl-10 pr-3 text-xs font-medium transition-all duration-300 ease-out",
                      isSubActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-hover hover:text-sidebar-accent-foreground hover:translate-x-1"
                    )}
                  >
                    <item.subItem.icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{item.subItem.title}</span>
                  </NavLink>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {profile?.role !== "parent" && (
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
      )}
    </>
  );
}
