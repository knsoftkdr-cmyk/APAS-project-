import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useFlashcardOverview } from "@/hooks/useFlashcards";

/**
 * Daily Review entry point for flashcards. Shows nothing until the student has a deck (and if flashcards aren't set up
 * yet or fail to load), so the existing Daily Review screen is never disturbed.
 */
export function FlashcardsDueCard() {
  const { data } = useFlashcardOverview();
  if (!data || data.stats.total === 0) return null;
  const due = data.stats.due_now;
  const fresh = Math.min(data.stats.new, data.new_per_session);
  const ready = due + fresh;
  return (
    <Link to="/flashcards" className="block" data-testid="flashcards-due-card">
      <Card className="border-2 border-primary/20 hover:border-primary/50 transition-colors">
        <CardContent className="p-4 flex items-center gap-3">
          <span className="text-3xl" aria-hidden>🃏</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold">{ready > 0 ? `${ready} flashcard${ready === 1 ? "" : "s"} ready` : "Flashcards are up to date"}</p>
            <p className="text-xs text-muted-foreground">
              {due > 0 ? `${due} due for review${fresh ? ` · ${fresh} new` : ""}` : fresh > 0 ? `${fresh} new to learn` : "Nothing due right now"}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}
