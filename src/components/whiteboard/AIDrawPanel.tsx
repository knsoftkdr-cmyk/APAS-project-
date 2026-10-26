// src/components/whiteboard/AIDrawPanel.tsx
// AI Whiteboard (sheet row 27): the teacher describes what to explain, the AI returns a step-by-step drawing
// (shapes, arrows, labels, equation lines) and this panel draws it onto the live Excalidraw board one step at
// a time - like a teacher building a diagram. Elements land on the shared board, so students see them live
// through the existing realtime sync, and "Save to Lesson" snapshots them like any hand drawing.
// Data: ai-teacher-assistant { action: "whiteboard_draw" } - see supabase/functions/_shared/handlers/aiWhiteboard.ts.
import { useState } from "react";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ChevronRight, FastForward, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { invokeFn } from "@/hooks/useExamIntelligence";

type BoardColor = "black" | "blue" | "red" | "green" | "orange" | "purple";
type BoardElement =
  | { type: "text"; x: number; y: number; text: string; size: "s" | "m" | "l"; color: BoardColor }
  | { type: "rectangle" | "ellipse" | "diamond"; x: number; y: number; w: number; h: number; label: string | null; color: BoardColor; fill: boolean }
  | { type: "arrow" | "line"; x1: number; y1: number; x2: number; y2: number; label: string | null; color: BoardColor };
interface Drawing { title: string; steps: Array<{ caption: string; elements: BoardElement[] }> }

const STROKE: Record<BoardColor, string> = { black: "#1e1e1e", blue: "#1971c2", red: "#e03131", green: "#2f9e44", orange: "#f08c00", purple: "#9c36b5" };
const FILL: Record<BoardColor, string> = { black: "#e9ecef", blue: "#a5d8ff", red: "#ffc9c9", green: "#b2f2bb", orange: "#ffec99", purple: "#eebefa" };
const FONT = { s: 16, m: 22, l: 30 } as const;
const EXAMPLES = ["Water cycle with labelled arrows", "Solve 2x + 3 = 11 step by step", "Parts of a plant cell", "Pythagoras theorem with a right triangle"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSkeleton(el: BoardElement, ox: number, oy: number): any[] {
  const strokeColor = STROKE[el.color];
  switch (el.type) {
    case "text":
      return [{ type: "text", x: el.x + ox, y: el.y + oy, text: el.text, fontSize: FONT[el.size], strokeColor }];
    case "rectangle": case "ellipse": case "diamond":
      return [{
        type: el.type, x: el.x + ox, y: el.y + oy, width: el.w, height: el.h, strokeColor,
        backgroundColor: el.fill ? FILL[el.color] : "transparent", fillStyle: "solid",
        ...(el.label ? { label: { text: el.label, fontSize: 18, strokeColor } } : {}),
      }];
    case "arrow": case "line": {
      const base = { type: el.type, x: el.x1 + ox, y: el.y1 + oy, points: [[0, 0], [el.x2 - el.x1, el.y2 - el.y1]], strokeColor };
      if (!el.label) return [base];
      if (el.type === "arrow") return [{ ...base, label: { text: el.label, fontSize: 16, strokeColor } }];
      return [base, { type: "text", x: (el.x1 + el.x2) / 2 + ox + 6, y: (el.y1 + el.y2) / 2 + oy - 22, text: el.label, fontSize: 16, strokeColor }];
    }
  }
}

export function AIDrawPanel({ api, open, onOpenChange }: { api: ExcalidrawImperativeAPI | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [prompt, setPrompt] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [loading, setLoading] = useState(false);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [nextStep, setNextStep] = useState(0);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  async function generate() {
    if (!api || prompt.trim().length < 3) return;
    setLoading(true);
    try {
      const res = await invokeFn<Drawing>("ai-teacher-assistant", {
        action: "whiteboard_draw", prompt: prompt.trim(), subject: subject.trim() || undefined, grade: grade.trim() || undefined,
      });
      // Place the new drawing to the right of whatever is already on the board.
      const existing = api.getSceneElements().filter((e) => !e.isDeleted);
      const maxX = existing.reduce((m, e) => Math.max(m, e.x + e.width), Number.NEGATIVE_INFINITY);
      const minY = existing.reduce((m, e) => Math.min(m, e.y), Number.POSITIVE_INFINITY);
      const o = existing.length ? { x: Math.round(maxX + 150), y: Math.round(minY) } : { x: 0, y: 0 };
      setOrigin(o);
      setDrawing(res);
      setNextStep(0);
      onOpenChange(false);
      // Title first, so the board says what is being explained.
      addElements([{ type: "text", x: o.x, y: o.y - 50, text: res.title, fontSize: 28, strokeColor: STROKE.black }]);
    } catch (e) {
      toast({ title: "AI drawing failed", description: e instanceof Error ? e.message : "Please try again", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function addElements(skeletons: any[]) {
    if (!api || !skeletons.length) return;
    const fresh = convertToExcalidrawElements(skeletons, { regenerateIds: true });
    api.updateScene({ elements: [...api.getSceneElements(), ...fresh] });
    api.scrollToContent(fresh, { fitToViewport: true, viewportZoomFactor: 0.8, animate: true });
  }

  function drawSteps(count: number) {
    if (!drawing) return;
    const upto = Math.min(drawing.steps.length, nextStep + count);
    const skeletons = drawing.steps.slice(nextStep, upto).flatMap((s) => s.elements.flatMap((el) => toSkeleton(el, origin.x, origin.y)));
    addElements(skeletons);
    setNextStep(upto);
  }

  const done = drawing && nextStep >= drawing.steps.length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-indigo-600" /> AI Draw</DialogTitle>
            <DialogDescription>Describe a diagram, process or equation. The AI draws it on this board step by step.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea rows={3} maxLength={600} placeholder="e.g. Explain photosynthesis with a labelled diagram" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <Button key={ex} type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPrompt(ex)}>{ex}</Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Subject (optional)</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Science" /></div>
              <div><Label className="text-xs">Class (optional)</Label><Input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Class 7" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={generate} disabled={loading || prompt.trim().length < 3 || !api} className="gap-1.5">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? "Drawing…" : "Generate drawing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {drawing && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 w-[min(560px,calc(100%-24px))] rounded-xl border bg-background/95 shadow-lg backdrop-blur p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{drawing.title} · step {Math.min(nextStep, drawing.steps.length)} of {drawing.steps.length}</p>
              <p className="text-sm font-medium mt-0.5">
                {nextStep === 0 ? "Ready - tap Next step to start drawing." : drawing.steps[nextStep - 1].caption}
              </p>
              {!done && nextStep > 0 && <p className="text-xs text-muted-foreground mt-0.5">Next: {drawing.steps[nextStep].caption}</p>}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setDrawing(null)} aria-label="Close AI drawing"><X className="h-4 w-4" /></Button>
          </div>
          <div className="flex gap-2 mt-2">
            <Button size="sm" onClick={() => drawSteps(1)} disabled={!!done} className="gap-1"><ChevronRight className="h-4 w-4" /> Next step</Button>
            <Button size="sm" variant="outline" onClick={() => drawSteps(drawing.steps.length)} disabled={!!done} className="gap-1"><FastForward className="h-4 w-4" /> Draw all</Button>
            {done && <span className="text-xs text-emerald-700 self-center">Done - use “Save to Lesson” to keep it.</span>}
          </div>
        </div>
      )}
    </>
  );
}
