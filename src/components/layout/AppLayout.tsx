import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";

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
    </div>
  );
}
