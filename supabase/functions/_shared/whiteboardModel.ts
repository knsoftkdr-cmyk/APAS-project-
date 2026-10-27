// supabase/functions/_shared/whiteboardModel.ts
//
// AI Whiteboard (sheet row 27): pure helpers shared by the handler and its tests. The model is asked for a
// step-by-step drawing in a small, fixed vocabulary on a 1000 x 700 board; everything it returns is validated
// and clamped here before it reaches the browser, which turns each element into an Excalidraw skeleton.

export const BOARD_W = 1000;
export const BOARD_H = 700;
export const MAX_STEPS = 10;
export const MAX_ELEMENTS_PER_STEP = 24;
export const COLORS = ["black", "blue", "red", "green", "orange", "purple"] as const;
export type BoardColor = typeof COLORS[number];

export type BoardElement =
  | { type: "text"; x: number; y: number; text: string; size: "s" | "m" | "l"; color: BoardColor }
  | { type: "rectangle" | "ellipse" | "diamond"; x: number; y: number; w: number; h: number; label: string | null; color: BoardColor; fill: boolean }
  | { type: "arrow" | "line"; x1: number; y1: number; x2: number; y2: number; label: string | null; color: BoardColor };

export interface BoardStep { caption: string; elements: BoardElement[] }
export interface BoardDrawing { title: string; steps: BoardStep[] }

// Font sizes in board pixels; the client renders text at exactly these sizes, so the layout pass below can
// estimate how much room each label needs.
export const TEXT_PX = { s: 16, m: 22, l: 30 } as const;
export const LABEL_PX = 18;
const CHAR_W = 0.56; // average glyph width / font size for the board font (Nunito)
const LINE_H = 1.3;
const WRAP_CHARS = 42;

export const WHITEBOARD_SYSTEM_PROMPT = [
  "You are an expert teacher drawing on a classroom whiteboard. You output strict JSON only, no markdown.",
  `The board is ${BOARD_W} wide and ${BOARD_H} tall; (0,0) is the top-left corner. Keep a 40px margin on every side.`,
  "Explain the request visually, one step at a time, the way a teacher builds a diagram or works an equation line by line.",
  "Each step ADDS elements to what is already on the board; never repeat earlier elements.",
  "Do not draw the title or a heading: the board writes the title above your drawing automatically.",
  "",
  "ACCURACY: every fact, label, number and equation step must be correct for the stated class. Check each line of working.",
  "Write maths in plain Unicode text (x², √, π, ÷, ×, ≤, →, fractions as a/b). Never LaTeX.",
  "",
  "NEAT LAYOUT RULES:",
  "- Plan the whole layout first, then emit it. Align elements on a grid (x and y in multiples of 20).",
  `- Text width ≈ characters × ${CHAR_W} × font size (s=${TEXT_PX.s}, m=${TEXT_PX.m}, l=${TEXT_PX.l}); height ≈ ${LINE_H} × font size. Reserve that space.`,
  "- Leave at least 40px between any two elements. Nothing may overlap except a label placed inside its own shape.",
  "- Put a node's name in the shape's \"label\" (it is centred automatically) instead of a separate text element.",
  "- Shapes holding a label: w ≥ 10 × label characters + 40, h ≥ 60. Keep labels ≤ 24 characters.",
  "- Arrows connect shapes: start the arrow on the edge of the source shape and end it on the edge of the target shape.",
  "- Labelled diagrams: draw the object in the centre, put label texts in a column on the left or right, and point an arrow from each label to the part.",
  "- Processes / flowcharts: boxes left-to-right (or top-to-bottom), evenly spaced, arrows between neighbours.",
  "- Cycles: place 3-6 nodes evenly around a circle and connect them with arrows in order.",
  "- Equations / working: one line per step, left-aligned at the same x, 60px apart vertically, final answer in green.",
  "- Use at most 3 colours; black for structure, one colour per idea that changes. Use size \"l\" only for the title-level heading.",
  "",
  "Content must be accurate, age-appropriate and about school subjects only.",
].join("\n");

const EXAMPLE = JSON.stringify({
  title: "Solving 2x + 3 = 11",
  steps: [
    { caption: "Write the equation.", elements: [{ type: "text", x: 80, y: 80, text: "2x + 3 = 11", size: "l", color: "black" }] },
    { caption: "Subtract 3 from both sides.", elements: [{ type: "text", x: 80, y: 160, text: "2x = 11 − 3 = 8", size: "m", color: "blue" }] },
    { caption: "Divide both sides by 2.", elements: [{ type: "text", x: 80, y: 220, text: "x = 8 ÷ 2 = 4", size: "m", color: "green" }] },
  ],
});

export function buildWhiteboardPrompt(input: { prompt: string; grade?: string | null; subject?: string | null; maxSteps: number }): string {
  return [
    `REQUEST: ${input.prompt}`,
    input.subject ? `SUBJECT: ${input.subject}` : "",
    input.grade ? `CLASS / GRADE: ${input.grade} (match vocabulary and depth to this level)` : "",
    `Use between 2 and ${input.maxSteps} steps.`,
    "Return JSON exactly in this shape:",
    "{",
    '  "title": "short title",',
    '  "steps": [ { "caption": "what this step shows, one sentence", "elements": [ ELEMENT, ... ] } ]',
    "}",
    "ELEMENT is one of:",
    '  { "type": "text", "x": n, "y": n, "text": "...", "size": "s"|"m"|"l", "color": COLOR }',
    '  { "type": "rectangle"|"ellipse"|"diamond", "x": n, "y": n, "w": n, "h": n, "label": "optional text inside", "color": COLOR, "fill": true|false }',
    '  { "type": "arrow"|"line", "x1": n, "y1": n, "x2": n, "y2": n, "label": "optional", "color": COLOR }',
    `COLOR is one of ${COLORS.join(", ")}. Use colour to highlight what changed in each step.`,
    "EXAMPLE of the expected style (equation working):",
    EXAMPLE,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- layout pass
// The model's coordinates are a good plan but rarely pixel-perfect. This pass makes the result neat:
// long text wraps, labelled shapes grow to fit their label, arrows that stop short of (or run into) a shape
// are snapped to its edge, and text that collides with earlier text is pushed down into free space.

interface Box { x: number; y: number; w: number; h: number }
type Shape = Extract<BoardElement, { w: number }>;
type Linear = Extract<BoardElement, { x1: number }>;

export function wrapText(text: string, max = WRAP_CHARS): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && (line + " " + word).length > max) { lines.push(line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

export function textBox(el: Extract<BoardElement, { type: "text" }>): Box {
  const px = TEXT_PX[el.size];
  const lines = el.text.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  return { x: el.x, y: el.y, w: Math.ceil(longest * px * CHAR_W), h: Math.ceil(lines.length * px * LINE_H) };
}

const overlaps = (a: Box, b: Box, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const inside = (p: { x: number; y: number }, b: Box, pad = 0) =>
  p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;

/** Point where the ray from the shape's centre towards (tx, ty) leaves the shape, plus a small gap. */
export function edgePoint(s: Shape, tx: number, ty: number, gap = 6): { x: number; y: number } {
  const hw = s.w / 2, hh = s.h / 2, cx = s.x + hw, cy = s.y + hh;
  const dx = tx - cx, dy = ty - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { x: Math.round(cx), y: Math.round(cy) };
  const ux = dx / len, uy = dy / len;
  let t: number;
  if (s.type === "ellipse") t = 1 / Math.hypot(ux / hw, uy / hh);
  else if (s.type === "diamond") t = 1 / (Math.abs(ux) / hw + Math.abs(uy) / hh);
  else t = Math.min(Math.abs(ux) > 1e-9 ? hw / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? hh / Math.abs(uy) : Infinity);
  return { x: Math.round(cx + ux * (t + gap)), y: Math.round(cy + uy * (t + gap)) };
}

const SNAP = 30;

/** The shape an arrow end belongs to: a labelled shape it sits in, or any shape whose edge it stops near. */
function anchorFor(p: { x: number; y: number }, shapes: Shape[]): Shape | null {
  let best: Shape | null = null;
  for (const s of shapes) {
    const isIn = inside(p, s);
    const near = !isIn && inside(p, s, SNAP);
    // Inside an unlabelled shape is deliberate (pointing at a part of a diagram) - leave it alone.
    if (!(near || (isIn && s.label))) continue;
    if (!best || s.w * s.h < best.w * best.h) best = s;
  }
  return best;
}

function snapLinear(el: Linear, shapes: Shape[]): Linear {
  const a = anchorFor({ x: el.x1, y: el.y1 }, shapes);
  const b = anchorFor({ x: el.x2, y: el.y2 }, shapes);
  if (a && a === b) return el; // both ends on one shape: an internal line, keep as drawn
  const centre = (s: Shape) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
  const targetA = b ? centre(b) : { x: el.x2, y: el.y2 };
  const targetB = a ? centre(a) : { x: el.x1, y: el.y1 };
  const p1 = a ? edgePoint(a, targetA.x, targetA.y) : { x: el.x1, y: el.y1 };
  const p2 = b ? edgePoint(b, targetB.x, targetB.y) : { x: el.x2, y: el.y2 };
  if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 10) return el; // shapes touching: snapping would erase the arrow
  return { ...el, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

export function layoutDrawing(d: BoardDrawing): BoardDrawing {
  const shapes: Shape[] = [];
  const taken: Box[] = []; // text and labelled shapes placed so far, across all steps
  const steps = d.steps.map((step) => {
    const els = step.elements.map((el) => {
      if (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") {
        const s = { ...el };
        if (s.label) {
          const longest = Math.max(...wrapText(s.label, 24).split("\n").map((l) => l.length));
          const lines = wrapText(s.label, 24).split("\n").length;
          // Ellipses and diamonds only use the middle of their box for text, so they need extra room.
          const k = s.type === "rectangle" ? 1 : 1.45;
          const needW = Math.ceil((longest * LABEL_PX * CHAR_W + 32) * k);
          const needH = Math.ceil((lines * LABEL_PX * LINE_H + 24) * k);
          if (s.w < needW) { s.x = Math.max(0, Math.round(s.x - (needW - s.w) / 2)); s.w = needW; }
          if (s.h < needH) { s.y = Math.max(0, Math.round(s.y - (needH - s.h) / 2)); s.h = needH; }
          s.x = Math.min(s.x, Math.max(0, BOARD_W - s.w));
          taken.push({ x: s.x, y: s.y, w: s.w, h: s.h });
        }
        shapes.push(s);
        return s;
      }
      return el;
    });
    // Second pass so arrows can snap to shapes declared later in the same step.
    return {
      ...step,
      elements: els.map((el) => {
        if (el.type === "arrow" || el.type === "line") return snapLinear(el, shapes);
        if (el.type !== "text") return el;
        const t = { ...el, text: wrapText(el.text) };
        const box = textBox(t);
        t.x = Math.max(0, Math.min(t.x, BOARD_W - box.w));
        box.x = t.x;
        for (let i = 0; i < 12 && taken.some((o) => overlaps(box, o, 4)); i++) {
          const hit = taken.filter((o) => overlaps(box, o, 4));
          box.y = Math.max(...hit.map((o) => o.y + o.h)) + 10;
        }
        t.y = box.y;
        taken.push(box);
        return t;
      }),
    };
  });
  return { ...d, steps };
}

const clamp = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const color = (v: unknown): BoardColor => (COLORS as readonly string[]).includes(String(v)) ? (v as BoardColor) : "black";

function sanitiseElement(raw: unknown): BoardElement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case "text": {
      const text = str(r.text, 160);
      if (!text) return null;
      const size = r.size === "s" || r.size === "l" ? r.size : "m";
      return { type: "text", x: clamp(r.x, 0, BOARD_W - 20, 20), y: clamp(r.y, 0, BOARD_H - 20, 20), text, size, color: color(r.color) };
    }
    case "rectangle": case "ellipse": case "diamond": {
      const x = clamp(r.x, 0, BOARD_W - 20, 20), y = clamp(r.y, 0, BOARD_H - 20, 20);
      return {
        type: r.type, x, y, w: clamp(r.w, 20, BOARD_W - x, 120), h: clamp(r.h, 20, BOARD_H - y, 80),
        label: str(r.label, 80) || null, color: color(r.color), fill: r.fill === true,
      };
    }
    case "arrow": case "line": {
      const el = {
        type: r.type, x1: clamp(r.x1, 0, BOARD_W, 0), y1: clamp(r.y1, 0, BOARD_H, 0),
        x2: clamp(r.x2, 0, BOARD_W, 0), y2: clamp(r.y2, 0, BOARD_H, 0), label: str(r.label, 60) || null, color: color(r.color),
      } as BoardElement & { x1: number; y1: number; x2: number; y2: number };
      return el.x1 === el.x2 && el.y1 === el.y2 ? null : el; // zero-length lines draw nothing
    }
    default:
      return null;
  }
}

/** Validates model output. Returns null when there is not a single drawable step. */
export function sanitiseDrawing(raw: Record<string, unknown> | null, maxSteps = MAX_STEPS): BoardDrawing | null {
  if (!raw) return null;
  const steps: BoardStep[] = [];
  for (const s of Array.isArray(raw.steps) ? raw.steps : []) {
    if (steps.length >= Math.min(maxSteps, MAX_STEPS)) break;
    if (!s || typeof s !== "object") continue;
    const rs = s as Record<string, unknown>;
    const elements = (Array.isArray(rs.elements) ? rs.elements : [])
      .map(sanitiseElement).filter((e): e is BoardElement => e !== null).slice(0, MAX_ELEMENTS_PER_STEP);
    if (!elements.length) continue;
    steps.push({ caption: str(rs.caption, 200) || `Step ${steps.length + 1}`, elements });
  }
  if (!steps.length) return null;
  return layoutDrawing({ title: str(raw.title, 120) || "Whiteboard explanation", steps });
}

// ---------------------------------------------------------------- illustrated mode
// Boxes and arrows can't draw a convincing plant cell or water cycle. In illustrated mode the model draws a
// textbook-style SVG picture instead: smooth shapes, soft fills, labels in side columns with leader lines to
// each part. Every part sits in a <g data-step="N"> group, so the board can still reveal it step by step
// (svgAtStep hides groups above the current step). The picture lands on the board as an image the teacher
// can annotate over; "board" mode (above) still gives editable shapes for equation working.

export const SVG_W = 1000;
export const SVG_H = 700;
const MAX_SVG_CHARS = 150_000;

export interface Illustration { title: string; steps: Array<{ caption: string }>; svg: string }

export const ILLUSTRATION_SYSTEM_PROMPT = [
  "You are an expert textbook illustrator and teacher. You output strict JSON only, no markdown.",
  "You draw clear, accurate, attractive educational diagrams as SVG, in the style of a modern school textbook.",
  "",
  `CANVAS: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}">.`,
  "- First a white background rect, then the title: centred at x=500, y=48, font-size 30, font-weight bold, fill #1e293b.",
  "- Background and title are NOT inside a step group. Everything else is.",
  "",
  "DRAWING STYLE:",
  "- Realistic, recognisable shapes with correct proportions and positions, drawn with smooth curves (path with C/Q commands), not just plain circles and boxes.",
  "- Flat soft fills with a slightly darker outline (stroke-width 2). Gentle linear/radial gradients in <defs> are welcome. Use a harmonious palette (greens for plants, blues for water, etc.).",
  "- Show the internal detail that makes each part recognisable (e.g. grana stacks inside chloroplasts, folded inner membrane in mitochondria, nucleolus inside the nucleus).",
  "- Keep the main drawing in the centre (x 270-730, y 90-670).",
  "",
  "LABELS (very important for neatness):",
  "- Put labels in a left column (text-anchor=\"end\", x≈230) and a right column (text-anchor=\"start\", x≈770), never on top of the drawing.",
  "- font-family=\"Arial, Helvetica, sans-serif\", font-size 20, fill #1e293b. At least 40px vertical gap between labels in a column. Balance labels between the two columns.",
  "- Each label has a thin leader line (stroke #475569, stroke-width 1.5) from the label to the part, ending in a small dot (circle r=4) placed ON the part it names. Leader lines must not cross each other.",
  "- Spell every label fully and correctly. No abbreviations, no words split across lines.",
  "",
  "PROCESSES / CYCLES: draw the scene, then curved arrows (path with marker-end; define the arrowhead <marker> in <defs>) with a short label beside each arrow.",
  "EQUATIONS / MATHS: write each line of working as text (font-size 28) left-aligned at x=140, 70px apart, and highlight the final answer in green inside a rounded rect.",
  "",
  "STEPS: wrap content in groups <g data-step=\"1\">, <g data-step=\"2\"> ... in teaching order. Step 1 is the main outline; each later step adds one part (or one stage) together with its label and leader line.",
  "",
  "ALLOWED ELEMENTS ONLY: svg, g, defs, linearGradient, radialGradient, stop, marker, path, rect, circle, ellipse, line, polyline, polygon, text, tspan. No <image>, <script>, <style>, <foreignObject>, links, animation or external references.",
  "Content must be scientifically / mathematically accurate, age-appropriate and about school subjects only.",
].join("\n");

export function buildIllustrationPrompt(input: { prompt: string; grade?: string | null; subject?: string | null; maxSteps: number }): string {
  return [
    `REQUEST: ${input.prompt}`,
    input.subject ? `SUBJECT: ${input.subject}` : "",
    input.grade ? `CLASS / GRADE: ${input.grade} (match vocabulary and level of detail to this level)` : "",
    `Use between 3 and ${Math.min(8, input.maxSteps)} steps.`,
    "Return JSON exactly in this shape:",
    "{",
    '  "title": "short title (same text as drawn on the picture)",',
    '  "steps": [ { "caption": "one or two sentences a teacher would say while this step appears" } ],',
    '  "svg": "<svg ...>...</svg>"',
    "}",
    'steps[i] describes <g data-step="i+1">; the number of captions must equal the number of step groups.',
  ].filter(Boolean).join("\n");
}

const STRIP_BLOCK = /<(script|style|foreignObject|iframe|object|embed|audio|video|animate\w*|set)\b[\s\S]*?<\/\1\s*>/gi;
const STRIP_TAG = /<\/?(script|style|foreignObject|iframe|object|embed|audio|video|animate\w*|set|image|use|a)\b[^>]*>/gi;

/**
 * Validates and defangs a model-written SVG. The picture is only ever shown as an image (no script runs
 * there), but anything that could be active or fetch from outside is still stripped.
 */
export function sanitiseSvg(raw: string): string | null {
  const start = raw.indexOf("<svg");
  const end = raw.lastIndexOf("</svg>");
  if (start < 0 || end < start) return null;
  let svg = raw.slice(start, end + 6);
  if (svg.length > MAX_SVG_CHARS) return null;

  svg = svg
    .replace(/<!DOCTYPE[^>]*>|<!ENTITY[^>]*>|<\?[^>]*\?>/gi, "")
    .replace(STRIP_BLOCK, "")
    .replace(STRIP_TAG, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // Keep in-document references (#id, url(#id)); drop anything pointing elsewhere.
    .replace(/\s+(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "")
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, "none")
    .replace(/javascript:/gi, "");

  // Normalise the root so it always renders at the board size.
  const open = svg.match(/^<svg\b[^>]*>/i);
  if (!open) return null;
  const attrs = open[0]
    .slice(4)
    .replace(/\s(width|height|viewBox|xmlns)\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s*\/?>$/, "");
  const root = `<svg${attrs} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}">`;
  svg = root + svg.slice(open[0].length);
  if (!/<(path|rect|circle|ellipse|polygon|polyline|line|text)\b/i.test(svg)) return null; // nothing visible
  return svg;
}

/** Highest data-step number used in the picture. */
export function svgStepCount(svg: string): number {
  let max = 0;
  for (const m of svg.matchAll(/data-step\s*=\s*["']?(\d+)/gi)) max = Math.max(max, Number(m[1]));
  return max;
}

export function sanitiseIllustration(raw: Record<string, unknown> | null, maxSteps = MAX_STEPS): Illustration | null {
  if (!raw || typeof raw.svg !== "string") return null;
  const svg = sanitiseSvg(raw.svg);
  if (!svg) return null;
  const captions = (Array.isArray(raw.steps) ? raw.steps : [])
    .map((s) => str((s as Record<string, unknown> | null)?.caption, 240));
  // One step per group (groups past the cap appear with the last step); a picture without groups is one step.
  const n = Math.max(1, Math.min(svgStepCount(svg), maxSteps, MAX_STEPS));
  const steps = Array.from({ length: n }, (_, i) => ({ caption: captions[i] || `Step ${i + 1}` }));
  return { title: str(raw.title, 120) || "Whiteboard explanation", steps, svg };
}

/** The picture as it looks after `step` of `total` steps: later groups are hidden; the last step shows everything. */
export function svgAtStep(svg: string, step: number, total: number): string {
  if (step >= total) return svg;
  const shown = Array.from({ length: step }, (_, i) => `[data-step="${i + 1}"]`).join(",");
  const css = `<style>[data-step]{display:none}${shown ? `${shown}{display:inline}` : ""}</style>`;
  return svg.replace(/^(<svg\b[^>]*>)/i, `$1${css}`);
}
