/**
 * StudentReviewFlashcards.tsx - Daily Review and Flashcards in one place for students.
 *
 * Same pattern as StudentMasteryReadiness (My Mastery / Exam Readiness): the tab buttons are real routes
 * (/daily-review, /flashcards), so the sidebar link, the browser back button and bookmarks open the matching tab.
 */
import { lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { RotateCw, StickyNote } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useFlashcardOverview } from "@/hooks/useFlashcards";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const DailyReview = lazy(() => import("./DailyReview"));
const Flashcards = lazy(() => import("./Flashcards"));

const TABS = [
  { key: "review", label: "Daily Review", path: "/daily-review", icon: RotateCw },
  { key: "flashcards", label: "Flashcards", path: "/flashcards", icon: StickyNote },
] as const;

export default function StudentReviewFlashcards() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isStudent = profile?.role === "student";
  // Admins who open Daily Review only see its scoring rules - flashcards are for students.
  const active = (isStudent ? TABS.find((t) => pathname.startsWith(t.path)) : undefined) ?? TABS[0];
  const overview = useFlashcardOverview(isStudent);
  const due = overview.data ? overview.data.stats.due_now : 0;

  return (
    <AppLayout>
      {isStudent && <div className="max-w-5xl mx-auto px-4 md:px-6 pt-4 md:pt-6">
        <div role="tablist" aria-label="Daily review and flashcards" className="inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1">
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
                {t.key === "flashcards" && due > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground" aria-label={`${due} cards due`}>{due}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>}

      <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center"><LoadingSpinner size="lg" /></div>}>
        {active.key === "review" && <DailyReview embedded />}
        {active.key === "flashcards" && <Flashcards embedded />}
      </Suspense>
    </AppLayout>
  );
}
