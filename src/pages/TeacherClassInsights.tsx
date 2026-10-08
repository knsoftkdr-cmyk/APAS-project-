/**
 * TeacherClassInsights.tsx — Class Mastery and Class Velocity side by side for teachers.
 *
 * The tab buttons are real routes (/class-mastery, /class-velocity), so the sidebar links, the browser back
 * button and bookmarks open the matching tab, and clicking a tab updates the URL.
 */
import { lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Gauge, Target } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { cn } from "@/lib/utils";

const ClassMasteryDashboard = lazy(() => import("./ClassMasteryDashboard"));
const ClassVelocityDashboard = lazy(() => import("./ClassVelocityDashboard"));

const TABS = [
  { key: "mastery", label: "Class Mastery", path: "/class-mastery", icon: Target },
  { key: "velocity", label: "Class Velocity", path: "/class-velocity", icon: Gauge },
] as const;

export default function TeacherClassInsights() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = TABS.find((t) => pathname.startsWith(t.path)) ?? TABS[0];

  return (
    <AppLayout>
      <div className="container mx-auto px-4 pt-6">
        <div role="tablist" aria-label="Class insights" className="inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1">
          {TABS.map((t) => {
            const selected = t.key === active.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => !selected && navigate(t.path)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center"><LoadingSpinner size="lg" /></div>}>
        {active.key === "mastery" && <ClassMasteryDashboard embedded />}
        {active.key === "velocity" && <ClassVelocityDashboard embedded />}
      </Suspense>
    </AppLayout>
  );
}
