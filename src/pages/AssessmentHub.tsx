/**
 * AssessmentHub.tsx — one place for the two assessment tools staff use together:
 *   Item Bank (author + review questions) · Mock Exams (build papers from them)
 *
 * The tab buttons are real routes (/item-bank, /mock-exams), so the sidebar link, the
 * browser back button and bookmarks all open the matching tab, and clicking a tab updates the URL.
 */
import { lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Layers, Timer } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { cn } from "@/lib/utils";

const ItemBankReview = lazy(() => import("./ItemBankReview"));
const MockExamBuilder = lazy(() => import("./MockExamBuilder"));

const TABS = [
  { key: "item-bank", label: "Item Bank", path: "/item-bank", icon: Layers },
  { key: "mock-exams", label: "Mock Exams", path: "/mock-exams", icon: Timer },
] as const;

export default function AssessmentHub() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = TABS.find((t) => pathname.startsWith(t.path)) ?? TABS[0];

  return (
    <AppLayout>
      <div className="container mx-auto px-4 pt-6">
        <div role="tablist" aria-label="Assessments" className="inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1">
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
        {active.key === "item-bank" && <ItemBankReview embedded />}
        {active.key === "mock-exams" && <MockExamBuilder embedded />}
      </Suspense>
    </AppLayout>
  );
}
