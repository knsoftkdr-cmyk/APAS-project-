import { useEffect, useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { TOUR_STEPS } from "./tourSteps";

interface Props {
  open: boolean;
  onFinish: () => void;
  onSkip: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;

export function GuidedTour({ open, onFinish, onSkip }: Props) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = TOUR_STEPS[idx];

  useLayoutEffect(() => {
    if (!open) return;
    const compute = () => {
      const el = document.querySelector(`[data-tour-id="${step.tourId}"]`) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const r = el.getBoundingClientRect();
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    };
    compute();
    const t = setTimeout(compute, 250);
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, step]);

  useEffect(() => {
    if (!open) setIdx(0);
  }, [open]);

  if (!open) return null;

  // Tooltip placement: to the right of the highlighted item if room, else below
  const tooltipStyle: React.CSSProperties = (() => {
    if (!rect) return { top: 80, left: "50%", transform: "translateX(-50%)" };
    const tipW = 320;
    const right = rect.left + rect.width + 16;
    if (right + tipW < window.innerWidth - 16) {
      return { top: Math.max(16, rect.top), left: right };
    }
    return { top: rect.top + rect.height + 12, left: Math.max(16, rect.left) };
  })();

  const isLast = idx === TOUR_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Spotlight overlay using clip-path */}
      <div
        className="absolute inset-0 bg-foreground/60 transition-all duration-300"
        style={
          rect
            ? {
                clipPath: `polygon(
                  0 0, 100% 0, 100% 100%, 0 100%, 0 0,
                  ${rect.left}px ${rect.top}px,
                  ${rect.left}px ${rect.top + rect.height}px,
                  ${rect.left + rect.width}px ${rect.top + rect.height}px,
                  ${rect.left + rect.width}px ${rect.top}px,
                  ${rect.left}px ${rect.top}px
                )`,
              }
            : undefined
        }
      />

      {/* Highlight ring */}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background transition-all duration-300"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="absolute w-[320px] rounded-xl border border-border bg-card p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        style={tooltipStyle}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Step {idx + 1} of {TOUR_STEPS.length}
          </span>
          <button
            onClick={onSkip}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Skip tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={idx === 0}
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
            >
              <ArrowLeft className="mr-1 h-3 w-3" /> Back
            </Button>
            {isLast ? (
              <Button size="sm" onClick={onFinish}>
                Finish
              </Button>
            ) : (
              <Button size="sm" onClick={() => setIdx((i) => Math.min(TOUR_STEPS.length - 1, i + 1))}>
                Next <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
