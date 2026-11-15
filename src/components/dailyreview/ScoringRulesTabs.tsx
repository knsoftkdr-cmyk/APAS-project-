/**
 * ScoringRulesTabs - the principal's one place for the marking rules (negative marking) of Adaptive Test and Daily Review.
 *
 * Same pattern as AssessmentHub (Item Bank / Builder / Mock Exams): the tab buttons are real routes (/adaptive-test, /daily-review),
 * so the sidebar link, the browser back button and bookmarks open the matching tab, and clicking a tab updates the URL.
 * Rendered by those two pages when the signed-in user is the principal; students never see it.
 */
import { useNavigate } from "react-router-dom";
import { RotateCw, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdaptiveTestScoringSettings, ScoringSettings } from "./ScoringSettings";

const TABS = [
  { key: "adaptive", label: "Adaptive Test", path: "/adaptive-test", icon: Zap },
  { key: "daily", label: "Daily Review", path: "/daily-review", icon: RotateCw },
] as const;

export type ScoringRulesTab = (typeof TABS)[number]["key"];

export function ScoringRulesTabs({ active }: { active: ScoringRulesTab }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-4" data-testid="scoring-rules-tabs">
      <div role="tablist" aria-label="Marking rules" className="flex w-full gap-1 rounded-xl bg-muted p-1 sm:inline-flex sm:w-auto">
        {TABS.map((t) => {
          const selected = t.key === active;
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
            </button>
          );
        })}
      </div>
      {active === "adaptive" ? <AdaptiveTestScoringSettings /> : <ScoringSettings />}
    </div>
  );
}
