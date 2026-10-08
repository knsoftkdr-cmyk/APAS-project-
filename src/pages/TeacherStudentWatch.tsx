/**
 * TeacherStudentWatch.tsx — one place for the three "who needs attention" views a teacher uses:
 *   Early Warning · At-Risk Students
 *
 * The tab buttons are real routes (/early-warning, /teacher-at-risk), so the sidebar
 * links, browser back button and bookmarks all open the matching tab, and clicking a tab updates the URL.
 */
import { lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, Siren } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { cn } from "@/lib/utils";

const EarlyWarningDashboard = lazy(() => import("./EarlyWarningDashboard"));
const TeacherAtRiskStudents = lazy(() => import("./TeacherAtRiskStudents"));

const TABS = [
  { key: "early-warning", label: "Early Warning", path: "/early-warning", icon: Siren },
  { key: "at-risk", label: "At-Risk Students", path: "/teacher-at-risk", icon: AlertTriangle },
] as const;

export default function TeacherStudentWatch() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = TABS.find((t) => pathname.startsWith(t.path)) ?? TABS[0];

  return (
    <AppLayout>
      <div className="container mx-auto px-4 pt-6">
        <div role="tablist" aria-label="Student watch" className="inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1">
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
        {active.key === "early-warning" && <EarlyWarningDashboard embedded />}
        {active.key === "at-risk" && <TeacherAtRiskStudents embedded />}
      </Suspense>
    </AppLayout>
  );
}
