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

export const WHITEBOARD_SYSTEM_PROMPT = [
  "You are a teacher drawing on a classroom whiteboard. You output strict JSON only, no markdown.",
  `The board is ${BOARD_W} wide and ${BOARD_H} tall; (0,0) is the top-left corner.`,
  "Explain the request visually, one step at a time, the way a teacher builds a diagram or works an equation line by line.",
  "Each step ADDS elements to what is already on the board; never repeat earlier elements.",
  "Write maths in plain Unicode text (x², √, π, ÷, ×, ≤, →, fractions as a/b). Never LaTeX.",
  "Keep text short (a label or one equation line). Leave space between elements so nothing overlaps.",
  "Content must be accurate, age-appropriate and about school subjects only.",
].join("\n");

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
  ].filter(Boolean).join("\n");
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
  return { title: str(raw.title, 120) || "Whiteboard explanation", steps };
}
