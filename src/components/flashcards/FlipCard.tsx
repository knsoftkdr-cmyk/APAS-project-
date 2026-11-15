import { useState } from "react";
import { Lightbulb, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD_TYPE_LABELS, type StudyCard } from "@/lib/flashcards";
import { CARD_THEME } from "./cardTheme";


interface FlipCardProps {
  card: Pick<StudyCard, "card_type" | "question" | "answer" | "hint" | "topic_name" | "chapter_name" | "source_pages" | "grounding">;
  flipped: boolean;
  onFlip: () => void;
}

/** Two-sided card. Question on the front, answer on the back; tap / Enter / Space flips it. */
export function FlipCard({ card, flipped, onFlip }: FlipCardProps) {
  const theme = CARD_THEME[card.card_type];
  const [hintOpen, setHintOpen] = useState(false);
  const where = [card.chapter_name, card.topic_name].filter(Boolean).join(" · ");
  const source = card.grounding === "textbook" && card.source_pages.length
    ? `From your textbook, page${card.source_pages.length > 1 ? "s" : ""} ${card.source_pages.slice(0, 3).join(", ")}`
    : card.grounding === "syllabus" ? "From your syllabus" : "From your textbook";

  return (
    <div className={cn("apas-flip w-full", flipped && "is-flipped")} data-testid="flip-card" data-flipped={flipped}>
      <div className="apas-flip__inner">
        {/* FRONT */}
        <div
          className={cn(
            "apas-flip__face apas-flip__face--front rounded-3xl border-2 bg-gradient-to-br p-5 sm:p-8 shadow-lg min-h-[18rem] sm:min-h-[20rem] flex flex-col",
            theme.front,
          )}
          aria-hidden={flipped}
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className={cn("rounded-full px-3 py-1 font-semibold", theme.chip)}>
              <span aria-hidden>{theme.emoji}</span> {CARD_TYPE_LABELS[card.card_type]}
            </span>
            {where && <span className="truncate text-muted-foreground max-w-[55%]">{where}</span>}
          </div>

          <button
            type="button"
            onClick={onFlip}
            tabIndex={flipped ? -1 : 0}
            aria-label="Show the answer"
            className="flex-1 flex items-center justify-center text-center py-6 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 rounded-2xl"
          >
            <span className="text-xl sm:text-2xl font-bold leading-snug text-slate-800 break-words">{card.question}</span>
          </button>

          <div className="flex items-center justify-between gap-2 min-h-[2.25rem]">
            {card.hint ? (
              hintOpen ? (
                <p className="text-sm text-slate-600 flex items-center gap-1.5"><Lightbulb className="h-4 w-4 text-amber-500 shrink-0" />{card.hint}</p>
              ) : (
                <button type="button" onClick={() => setHintOpen(true)} tabIndex={flipped ? -1 : 0}
                  className="text-sm font-medium text-amber-700 hover:text-amber-800 inline-flex items-center gap-1.5 min-h-[44px]">
                  <Lightbulb className="h-4 w-4" /> Need a hint?
                </button>
              )
            ) : <span />}
            <span className="text-xs text-slate-500 inline-flex items-center gap-1"><RotateCw className="h-3.5 w-3.5" /> Tap to flip</span>
          </div>
        </div>

        {/* BACK */}
        <div
          className={cn(
            "apas-flip__face apas-flip__face--back rounded-3xl bg-gradient-to-br p-5 sm:p-8 shadow-lg min-h-[18rem] sm:min-h-[20rem] flex flex-col text-white",
            theme.back,
          )}
          aria-hidden={!flipped}
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="rounded-full bg-white/25 px-3 py-1 font-semibold">✅ Answer</span>
            <span className="truncate text-white/80 max-w-[55%]">{where}</span>
          </div>
          <button
            type="button"
            onClick={onFlip}
            tabIndex={flipped ? 0 : -1}
            aria-label="Show the question again"
            className="flex-1 flex items-center justify-center text-center py-6 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/60 rounded-2xl"
          >
            <span className="text-lg sm:text-2xl font-semibold leading-snug break-words" data-testid="card-answer">{card.answer}</span>
          </button>
          <p className="text-xs text-white/85 text-center">📖 {source}</p>
        </div>
      </div>
    </div>
  );
}
