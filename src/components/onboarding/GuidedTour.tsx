import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { isNavSelector, type TourStep } from "./tourSteps";

interface Props {
  open: boolean;
  steps: TourStep[];
  onFinish: () => void;
  onSkip: () => void;
  /** Phones: the sidebar is a drawer. The tour asks for it to be opened for sidebar steps and closed otherwise. */
  onNeedSidebar?: (open: boolean) => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const GAP = 12;
const EDGE = 12;
const MOBILE_BREAKPOINT = 768; // matches Tailwind's md, where the sidebar becomes a permanent rail

/** First match that is actually laid out (the desktop and the mobile sidebar both carry the same data attribute). */
function findVisible(selector: string): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return els.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) ?? null;
}

export function GuidedTour({ open, steps, onFinish, onSkip, onNeedSidebar }: Props) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [tipH, setTipH] = useState(220);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const tipRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const step = steps[idx];
  const total = steps.length;
  const isLast = idx === total - 1;
  const isMobile = vp.w < MOBILE_BREAKPOINT;

  // Restart from the first step whenever the tour is (re)opened.
  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  // Phones: open the drawer for sidebar steps, close it for everything else.
  useEffect(() => {
    if (!open || !step) return;
    onNeedSidebar?.(window.innerWidth < MOBILE_BREAKPOINT && isNavSelector(step.target));
  }, [open, step, onNeedSidebar]);

  // Measure the target. It can move while the drawer slides in or the page scrolls, so re-measure for a short
  // while after each step change and on every scroll / resize.
  const measure = useCallback(() => {
    setVp({ w: window.innerWidth, h: window.innerHeight });
    if (!step?.target) {
      setRect(null);
      return;
    }
    const el = findVisible(step.target);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [step]);

  useLayoutEffect(() => {
    if (!open || !step) return;

    if (step.target) {
      const el = findVisible(step.target);
      // Bring sidebar rows to the middle of their scroll area; "nearest" is a no-op for anything already in view.
      el?.scrollIntoView?.({ block: isNavSelector(step.target) ? "center" : "nearest", inline: "nearest" });
    }
    measure();

    let frames = 0;
    let raf = 0;
    const settle = () => {
      measure();
      if (++frames < 45) raf = requestAnimationFrame(settle); // ~750ms covers the drawer transition
    };
    raf = requestAnimationFrame(settle);

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step, measure]);

  // Measure the card so it can be kept on screen.
  useLayoutEffect(() => {
    if (open && tipRef.current) setTipH(tipRef.current.offsetHeight);
  }, [open, idx, vp.w]);

  const goNext = useCallback(() => setIdx((i) => Math.min(total - 1, i + 1)), [total]);
  const goBack = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

  // Keyboard: arrows move, Escape skips.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
      else if (e.key === "ArrowRight") (isLast ? onFinish : goNext)();
      else if (e.key === "ArrowLeft") goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isLast, goNext, goBack, onFinish, onSkip]);

  useEffect(() => {
    if (open) nextRef.current?.focus({ preventScroll: true });
  }, [open, idx]);

  if (!open || !step) return null;

  // ── Card placement ──────────────────────────────────────────────────────────────
  const cardW = Math.min(340, vp.w - EDGE * 2);
  const style: React.CSSProperties = (() => {
    if (!rect) {
      // centered step (or a target that is not on screen right now)
      return { top: Math.max(EDGE, (vp.h - tipH) / 2), left: (vp.w - cardW) / 2, width: cardW };
    }
    if (isMobile) {
      // bottom sheet, flipped to the top when the highlighted element sits in the lower half
      const targetMid = rect.top + rect.height / 2;
      const top = targetMid > vp.h / 2 ? EDGE : vp.h - tipH - EDGE;
      return { top, left: (vp.w - cardW) / 2, width: cardW };
    }
    const clampTop = (t: number) => Math.min(Math.max(EDGE, t), vp.h - tipH - EDGE);
    const clampLeft = (l: number) => Math.min(Math.max(EDGE, l), vp.w - cardW - EDGE);
    const right = rect.left + rect.width + GAP;
    if (right + cardW <= vp.w - EDGE) return { top: clampTop(rect.top), left: right, width: cardW };
    const below = rect.top + rect.height + GAP;
    if (below + tipH <= vp.h - EDGE) return { top: below, left: clampLeft(rect.left), width: cardW };
    return { top: clampTop(rect.top - tipH - GAP), left: clampLeft(rect.left), width: cardW };
  })();

  const hole = rect
    ? `polygon(
        0 0, 100% 0, 100% 100%, 0 100%, 0 0,
        ${rect.left}px ${rect.top}px,
        ${rect.left}px ${rect.top + rect.height}px,
        ${rect.left + rect.width}px ${rect.top + rect.height}px,
        ${rect.left + rect.width}px ${rect.top}px,
        ${rect.left}px ${rect.top}px
      )`
    : undefined;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-desc">
      {/* Dimmed backdrop with a cut-out around the target */}
      <div className="absolute inset-0 bg-foreground/60 transition-all duration-300" style={hole ? { clipPath: hole } : undefined} />

      {/* The cut-out would let clicks through to the real button; swallow them so the tour cannot be left by accident */}
      {rect && (
        <div
          className="absolute rounded-lg"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {rect && (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background transition-all duration-300"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}

      <div
        ref={tipRef}
        className="absolute rounded-xl border border-border bg-card p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        style={style}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground" aria-live="polite">
            Step {idx + 1} of {total}
          </span>
          <button
            onClick={onSkip}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Skip tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <Progress value={((idx + 1) / total) * 100} className="mb-3 h-1.5" />

        <h3 id="tour-title" className="text-base font-semibold text-foreground">{step.title}</h3>
        <p id="tour-desc" className="mt-1 text-sm text-muted-foreground">{step.description}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          {isLast ? (
            <span />
          ) : (
            <Button variant="ghost" size="sm" onClick={onSkip}>
              Skip
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={idx === 0} onClick={goBack}>
              <ArrowLeft className="mr-1 h-3 w-3" /> Back
            </Button>
            {isLast ? (
              <Button ref={nextRef} size="sm" onClick={onFinish}>
                Finish
              </Button>
            ) : (
              <Button ref={nextRef} size="sm" onClick={goNext}>
                Next <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
