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
  const [childProfileId, setChildProfileId] = useState<string | null>(null);
  const [childName, setChildName] = useState<string | null>(null);

  // Assistant now covers transport, homework, assessments, and fees for the
  // parent's (first linked) child — all of those key off profiles.id, so we
  // just need that one id + the child's name. Transport-specific lookups
  // (real students.id) happen inside the edge function itself, same way
  // get_parent_fee_details() already resolves it internally.
  useEffect(() => {
    if (profile?.role !== "parent" || !user) {
      setChildProfileId(null);
      setChildName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: links } = await supabase
        .from("parent_students")
        .select("student_id, profiles:student_id(full_name)")
        .eq("parent_id", user.id)
        .limit(1);
      if (!links || links.length === 0 || cancelled) return;
      const link = links[0] as any;
      setChildProfileId(link.student_id);
      setChildName(link.profiles?.full_name ?? null);
    })();
    return () => { cancelled = true; };
  }, [profile?.role, user]);

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
      {childProfileId && <ParentBusAssistantWidget studentId={childProfileId} studentName={childName} />}
    </div>
  );
}