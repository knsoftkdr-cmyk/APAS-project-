/**
 * StudentMasteryReadiness.tsx — My Mastery and Exam Readiness in one place for students.
 *
 * Same pattern as the teacher's Early Warning / At-Risk page (TeacherStudentWatch): the tab buttons are
 * real routes (/my-mastery, /exam-readiness), so the sidebar link, the browser back button and bookmarks
 * open the matching tab, and clicking a tab updates the URL.
 */
import { lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Gauge, Target } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { cn } from "@/lib/utils";

const StudentMasteryEngine = lazy(() => import("./StudentMasteryEngine"));
const ExamReadiness = lazy(() => import("./ExamReadiness"));

const TABS = [
  { key: "mastery", label: "My Mastery", path: "/my-mastery", icon: Target },
  { key: "readiness", label: "Exam Readiness", path: "/exam-readiness", icon: Gauge },
] as const;

export default function StudentMasteryReadiness() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = TABS.find((t) => pathname.startsWith(t.path)) ?? TABS[0];

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 md:px-6 pt-4 md:pt-6">
        <div role="tablist" aria-label="Mastery and readiness" className="inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1">
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
        {active.key === "mastery" && <StudentMasteryEngine embedded />}
        {active.key === "readiness" && <ExamReadiness embedded />}
      </Suspense>
    </AppLayout>
  );
}
