/**
 * AssessmentHub.tsx — one place for the assessment tools staff use together:
 *   Item Bank (author + review questions) · Builder (hand-pick questions, preview, assign) · Mock Exams (build papers from them) · Exam Reviews (confirm AI marks on written answers)
 *
 * The tab buttons are real routes (/item-bank, /mock-exams, /exam-reviews), so the sidebar link, the
 * browser back button and bookmarks all open the matching tab, and clicking a tab updates the URL.
 */
import { lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ClipboardCheck, ClipboardList, Layers, Timer } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { cn } from "@/lib/utils";
import { useExamReviewAttempts } from "@/hooks/useExamReviews";

const ItemBankReview = lazy(() => import("./ItemBankReview"));
const MockExamBuilder = lazy(() => import("./MockExamBuilder"));
const ExamReviews = lazy(() => import("./ExamReviews"));
const AssessmentBuilder = lazy(() => import("./AssessmentBuilder"));

const TABS = [
  { key: "item-bank", label: "Item Bank", path: "/item-bank", icon: Layers },
  { key: "builder", label: "Builder", path: "/assessment-builder", icon: ClipboardList },
  { key: "mock-exams", label: "Mock Exams", path: "/mock-exams", icon: Timer },
  { key: "exam-reviews", label: "Exam Reviews", path: "/exam-reviews", icon: ClipboardCheck },
] as const;

export default function AssessmentHub() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Written answers waiting for the teacher - shown as a count on the Exam Reviews tab.
  const { data: pendingReviews } = useExamReviewAttempts("pending");
  const pendingCount = pendingReviews?.length ?? 0;
  const active = TABS.find((t) => pathname.startsWith(t.path)) ?? TABS[0];

  return (
    <AppLayout>
      {/* Same width as the pages below, so the tabs line up with the content on a laptop */}
      <div className="max-w-5xl mx-auto px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 md:pt-6">
        <div role="tablist" aria-label="Assessments" className="flex w-full gap-1 rounded-xl bg-muted p-1 sm:inline-flex sm:w-auto">
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
                  "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 sm:py-2 text-sm font-medium transition-colors sm:flex-none",
                  selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
                {t.key === "exam-reviews" && pendingCount > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold leading-4 text-white">{pendingCount > 99 ? "99+" : pendingCount}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center"><LoadingSpinner size="lg" /></div>}>
        {active.key === "item-bank" && <ItemBankReview embedded />}
        {active.key === "builder" && <AssessmentBuilder embedded />}
        {active.key === "mock-exams" && <MockExamBuilder embedded />}
        {active.key === "exam-reviews" && <ExamReviews embedded />}
      </Suspense>
    </AppLayout>
  );
}
