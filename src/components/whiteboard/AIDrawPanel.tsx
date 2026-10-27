// src/components/whiteboard/AIDrawPanel.tsx
// AI Whiteboard (sheet row 27): the teacher describes what to explain, the AI returns a step-by-step drawing
// (shapes, arrows, labels, equation lines) and this panel draws it onto the live Excalidraw board one step at
// a time - like a teacher building a diagram. Elements land on the shared board, so students see them live
// through the existing realtime sync, and "Save to Lesson" snapshots them like any hand drawing.
// Data: ai-teacher-assistant { action: "whiteboard_draw" } - see supabase/functions/_shared/handlers/aiWhiteboard.ts.
// The server already lays the drawing out (wrapping, label room, arrows snapped to shapes); here it is rendered
// with clean strokes and a clear font so it reads like a neat board, not a sketch.
// The prompt is a card inside the board rather than a dialog: dialogs portal to <body>, which is hidden
// while the board is in full screen.
// Two styles: "Picture" (default) is a textbook-style SVG illustration revealed step by step by swapping the
// image on the board; "Editable shapes" draws Excalidraw shapes the teacher can move and edit.
import { useRef, useState } from "react";
import { convertToExcalidrawElements, FONT_FAMILY, ROUNDNESS, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, BinaryFileData } from "@excalidraw/excalidraw/types";
import type { ExcalidrawImageElement } from "@excalidraw/excalidraw/element/types";
import { ChevronRight, FastForward, Image as ImageIcon, Loader2, Shapes, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { invokeFn } from "@/hooks/useExamIntelligence";

type BoardColor = "black" | "blue" | "red" | "green" | "orange" | "purple";
type BoardElement =
  | { type: "text"; x: number; y: number; text: string; size: "s" | "m" | "l"; color: BoardColor }
  | { type: "rectangle" | "ellipse" | "diamond"; x: number; y: number; w: number; h: number; label: string | null; color: BoardColor; fill: boolean }
  | { type: "arrow" | "line"; x1: number; y1: number; x2: number; y2: number; label: string | null; color: BoardColor };
type Drawing =
  | { kind: "board"; title: string; steps: Array<{ caption: string; elements: BoardElement[] }> }
  | { kind: "illustration"; title: string; steps: Array<{ caption: string }>; svg: string };
type DrawStyle = "illustration" | "board";

const STROKE: Record<BoardColor, string> = { black: "#1e1e1e", blue: "#1971c2", red: "#e03131", green: "#2f9e44", orange: "#e8590c", purple: "#9c36b5" };
const FILL: Record<BoardColor, string> = { black: "#e9ecef", blue: "#d0ebff", red: "#ffe3e3", green: "#d3f9d8", orange: "#fff4e6", purple: "#f3d9fa" };
// Must match TEXT_PX / LABEL_PX in supabase/functions/_shared/whiteboardModel.ts - the server lays out with them.
const FONT = { s: 16, m: 22, l: 30 } as const;
const LABEL = 18;
// Clean, legible board style: no hand-drawn wobble, solid strokes, rounded boxes, a clear sans font.
const NEAT = { roughness: 0, strokeWidth: 2, strokeStyle: "solid", fontFamily: FONT_FAMILY.Nunito } as const;
const EXAMPLES = ["Water cycle with labelled arrows", "Solve 2x + 3 = 11 step by step", "Parts of a plant cell", "Pythagoras theorem with a right triangle"];
// Must match SVG_W / SVG_H in whiteboardModel.ts.
const PIC_W = 1000;
const PIC_H = 700;

/** Mirrors svgAtStep in whiteboardModel.ts: hide the step groups not reached yet. */
function svgAtStep(svg: string, step: number, total: number): string {
  if (step >= total) return svg;
  const shown = Array.from({ length: step }, (_, i) => `[data-step="${i + 1}"]`).join(",");
  const css = `<style>[data-step]{display:none}${shown ? `${shown}{display:inline}` : ""}</style>`;
  return svg.replace(/^(<svg\b[^>]*>)/i, `$1${css}`);
}

function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSkeleton(el: BoardElement, ox: number, oy: number): any[] {
  const strokeColor = STROKE[el.color];
  const label = (text: string, fontSize: number) => ({ text, fontSize, strokeColor, fontFamily: NEAT.fontFamily });
  switch (el.type) {
    case "text":
      return [{ ...NEAT, type: "text", x: el.x + ox, y: el.y + oy, text: el.text, fontSize: FONT[el.size], strokeColor }];
    case "rectangle": case "ellipse": case "diamond":
      return [{
        ...NEAT, type: el.type, x: el.x + ox, y: el.y + oy, width: el.w, height: el.h, strokeColor,
        backgroundColor: el.fill ? FILL[el.color] : "transparent", fillStyle: "solid",
        ...(el.type === "rectangle" ? { roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS } } : {}),
        ...(el.label ? { label: label(el.label, LABEL) } : {}),
      }];
    case "arrow": case "line": {
      const base = {
        ...NEAT, type: el.type, x: el.x1 + ox, y: el.y1 + oy, points: [[0, 0], [el.x2 - el.x1, el.y2 - el.y1]], strokeColor,
        ...(el.type === "arrow" ? { endArrowhead: "triangle" } : {}),
      };
      if (!el.label) return [base];
      if (el.type === "arrow") return [{ ...base, label: label(el.label, 16) }];
      return [base, { ...NEAT, type: "text", x: (el.x1 + el.x2) / 2 + ox + 6, y: (el.y1 + el.y2) / 2 + oy - 22, text: el.label, fontSize: 16, strokeColor }];
    }
  }
}

export function AIDrawPanel({ api, open, onOpenChange, onExplanation }: {
  api: ExcalidrawImperativeAPI | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Called with each new drawing's title and step captions, so exports can include the explanation. */
  onExplanation?: (note: { title: string; steps: string[] }) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [style, setStyle] = useState<DrawStyle>("illustration");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [nextStep, setNextStep] = useState(0);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const drawnIds = useRef<Set<string>>(new Set());
  const pictureId = useRef<string | null>(null); // the board image element an illustration is drawn into

  async function generate() {
    if (!api || prompt.trim().length < 3) return;
    setLoading(true);
    setError(null);
    try {
      const res = await invokeFn<Drawing>("ai-teacher-assistant", {
        action: "whiteboard_draw", prompt: prompt.trim(), subject: subject.trim() || undefined, grade: grade.trim() || undefined, style,
      });
      // Place the new drawing below whatever is already on the board, left-aligned with it, so the
      // board reads top-to-bottom like a notebook instead of drifting off to the right.
      const existing = api.getSceneElements().filter((e) => !e.isDeleted);
      const minX = existing.reduce((m, e) => Math.min(m, e.x), Number.POSITIVE_INFINITY);
      const maxY = existing.reduce((m, e) => Math.max(m, e.y + e.height), Number.NEGATIVE_INFINITY);
      const o = existing.length ? { x: Math.round(minX), y: Math.round(maxY + 140) } : { x: 0, y: 0 };
      setOrigin(o);
      setDrawing(res);
      setNextStep(0);
      drawnIds.current = new Set();
      pictureId.current = null;
      onExplanation?.({ title: res.title, steps: res.steps.map((s) => s.caption) });
      onOpenChange(false);
      // Title first, so the board says what is being explained (an illustration draws its own title).
      if (res.kind !== "illustration") {
        addElements([{ ...NEAT, type: "text", x: o.x + 40, y: o.y - 20, text: res.title, fontSize: 32, strokeColor: STROKE.black }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI drawing failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function addElements(skeletons: any[]) {
    if (!api || !skeletons.length) return;
    const fresh = convertToExcalidrawElements(skeletons, { regenerateIds: true });
    fresh.forEach((e) => drawnIds.current.add(e.id));
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...fresh] });
    // Keep the whole drawing so far in view (not just the newest step) so the layout doesn't jump around.
    const all = api.getSceneElements().filter((e) => drawnIds.current.has(e.id));
    api.scrollToContent(all, { fitToViewport: true, viewportZoomFactor: 0.85, animate: true });
  }

  // Each step swaps the picture's file for one with the next group revealed, so students watch it build up.
  function showPicture(svg: string, step: number, total: number) {
    if (!api) return;
    const fileId = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` as BinaryFileData["id"];
    api.addFiles([{ id: fileId, dataURL: svgDataUrl(svgAtStep(svg, step, total)) as BinaryFileData["dataURL"], mimeType: "image/svg+xml", created: Date.now() }]);
    const current = pictureId.current && api.getSceneElements().find((e) => e.id === pictureId.current);
    if (current && current.type === "image") {
      api.updateScene({
        elements: api.getSceneElementsIncludingDeleted().map((e) => (e.id === current.id ? newElementWith(e as ExcalidrawImageElement, { fileId }) : e)),
      });
      return;
    }
    const [img] = convertToExcalidrawElements([{ type: "image", x: origin.x, y: origin.y, width: PIC_W, height: PIC_H, fileId, status: "saved" }], { regenerateIds: true });
    pictureId.current = img.id;
    drawnIds.current.add(img.id);
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), img] });
    api.scrollToContent([img], { fitToViewport: true, viewportZoomFactor: 0.9, animate: true });
  }

  function drawSteps(count: number) {
    if (!drawing) return;
    const upto = Math.min(drawing.steps.length, nextStep + count);
    if (drawing.kind === "illustration") {
      showPicture(drawing.svg, upto, drawing.steps.length);
      setNextStep(upto);
      return;
    }
    const skeletons = drawing.steps.slice(nextStep, upto).flatMap((s) => s.elements.flatMap((el) => toSkeleton(el, origin.x, origin.y)));
    addElements(skeletons);
    setNextStep(upto);
  }

  const done = drawing && nextStep >= drawing.steps.length;

  return (
    <>
      {open && (
        <div
          className="absolute inset-0 z-30 flex items-start sm:items-center justify-center bg-black/30 p-3 overflow-y-auto"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !loading) onOpenChange(false); }}
          onKeyDown={(e) => { if (e.key === "Escape" && !loading) { e.stopPropagation(); onOpenChange(false); } }}
        >
          <div role="dialog" aria-label="AI Draw" className="w-full max-w-lg rounded-xl border bg-background p-4 shadow-xl space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-indigo-600" /> AI Draw</h3>
                <p className="text-sm text-muted-foreground">Describe a diagram, process or equation. The AI draws it on this board step by step.</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onOpenChange(false)} disabled={loading} aria-label="Close"><X className="h-4 w-4" /></Button>
            </div>
            <Textarea
              autoFocus rows={3} maxLength={600} placeholder="e.g. Explain photosynthesis with a labelled diagram" value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void generate(); }}
            />
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Drawing style">
              {([
                ["illustration", ImageIcon, "Picture", "Textbook-style labelled diagram"],
                ["board", Shapes, "Editable shapes", "Boxes and text you can move - good for equations"],
              ] as const).map(([value, Icon, name, hint]) => (
                <button
                  key={value} type="button" role="radio" aria-checked={style === value} onClick={() => setStyle(value)}
                  className={`rounded-lg border p-2 text-left transition-colors ${style === value ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-muted"}`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium"><Icon className="h-4 w-4 text-indigo-600" /> {name}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <Button key={ex} type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPrompt(ex)}>{ex}</Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Subject (optional)</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Science" /></div>
              <div><Label className="text-xs">Class (optional)</Label><Input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Class 7" /></div>
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end">
              <Button onClick={generate} disabled={loading || prompt.trim().length < 3 || !api} className="gap-1.5">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {loading ? (style === "illustration" ? "Drawing picture… (up to a minute)" : "Drawing…") : "Generate drawing"}
              </Button>
            </div>
          </div>
        </div>
      )}

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
