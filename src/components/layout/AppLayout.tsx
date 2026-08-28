
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { AILessonAssistantWidget } from "@/components/ai-assistant/AILessonAssistantWidget";
import { ParentBusAssistantWidget } from "@/components/parent-transport/ParentBusAssistantWidget";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const pageTitles: Record<string, string> = {
  "/dashboard": "Homework — APAS",
  "/student-dashboard": "Home — APAS",
  "/diagnostic": "Assessments — APAS",
  "/curative": "Curative Phase — APAS",
  "/analytics": "Learning Analytics & Insights — APAS",
  "/teacher": "Teacher Panel — APAS",
  "/settings": "Settings — APAS",
  "/alerts": "Alerts — APAS",
};

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user, profile } = useAuth();
  const [busStudentId, setBusStudentId] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.role !== "parent" || !user) {
      setBusStudentId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: links } = await supabase
        .from("parent_students")
        .select("student_id")
        .eq("parent_id", user.id);
      if (!links || links.length === 0 || cancelled) return;

      for (const link of links) {
        const { data: studentRow } = await supabase
          .from("students")
          .select("id")
          .eq("profile_id", link.student_id)
          .maybeSingle();
        if (!studentRow) continue;
        const { data: assignment } = await supabase
          .from("transport_assignments")
          .select("student_id")
          .eq("student_id", studentRow.id)
          .eq("status", "active")
          .maybeSingle();
        if (assignment && !cancelled) {
          setBusStudentId(assignment.student_id);
          return;
        }
      }
      if (!cancelled) setBusStudentId(null);
    })();
    return () => { cancelled = true; };
  }, [profile?.role, user]);

  // Set document title based on route
  useEffect(() => {
    document.title = pageTitles[location.pathname] || "APAS — Adaptive Pedagogy & Analytics System";
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div
        className={`flex flex-1 flex-col transition-all duration-300 ${
          collapsed ? "md:ml-[var(--sidebar-collapsed)]" : "md:ml-[var(--sidebar-width)]"
        }`}
      >
        <AppHeader onToggleSidebar={() => setMobileOpen(!mobileOpen)} />
        <main className="flex-1 overflow-auto p-4 pb-20 md:p-6 md:pb-6 animate-fade-in" key={location.pathname}>
          {children}
        </main>
      </div>
      <OnboardingFlow />
      <AILessonAssistantWidget />
      {busStudentId && <ParentBusAssistantWidget studentId={busStudentId} />}
    </div>
  );
}
