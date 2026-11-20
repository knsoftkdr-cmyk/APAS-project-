// src/lib/explainerScene.ts
//
// Animated "explainer" scenes for the Content Studio video (src/lib/lessonVideo.ts).
// Instead of bullet points, a scene places pictures on a stage (sun, plant, cloud, water drops,
// bubbles, any emoji...) and animates them in step with the narration: things pop in, grow,
// move, particles flow along a path (water up the stem, CO2 into the leaf), light rays shine,
// arrows draw themselves, labels appear and the camera zooms.
//
// The AI writes the scene as JSON (ExplainerScene); timing is by narration SENTENCE: `at: 2`
// means "when the third sentence starts", `at: 2.5` is halfway through it. Everything is a pure
// function of time, so any frame can be drawn independently.

export interface ExplainerElement {
  id: string;
  /** A built-in picture (see PROPS) or any emoji. */
  pic: string;
  /** Position on a 100 x 100 stage (x: left -> right, y: top -> bottom). Plants/trees: base point on the ground. */
  x: number;
  y: number;
  /** Size in % of the video height (defaults per picture). */
  size?: number;
  /** Text inside bubbles / boxes / sugar, or the text of a "text" element. */
  text?: string;
  /** Name tag shown under the picture. */
  label?: string;
  /** Colour for bubble / box / text (CSS colour). */
  color?: string;
}

export type Ref = string | [number, number];

export type ExplainerAction =
  | { type: "appear" | "grow" | "fade_out" | "pulse" | "highlight"; target: string; at: number }
  | { type: "move"; target: string; to: Ref; at: number; duration?: number }
  | { type: "flow"; from: Ref; to: Ref; via?: Ref[]; pic: string; text?: string; count?: number; at: number; until?: number; size?: number; color?: string }
  | { type: "rays"; from: Ref; to: Ref; at: number; until?: number }
  | { type: "arrow"; from: Ref; to: Ref; label?: string; at: number; color?: string }
  | { type: "label"; target: string; text: string; at: number; side?: "top" | "bottom" | "left" | "right" }
  | { type: "zoom"; target: Ref; scale?: number; at: number }
  | { type: "zoom_out"; at: number };

export interface ExplainerScene {
  background?: "outdoor" | "plain" | "space" | "water" | "night";
  elements: ExplainerElement[];
  actions: ExplainerAction[];
}

export interface ExplainerTheme {
  accent: string;
  text: string;
  bg: string;
}

const FONT = `"Inter", "Segoe UI", "Noto Sans Arabic", "Noto Sans Telugu", "Noto Sans Devanagari", Arial, sans-serif`;
const EMOJI_FONT = `"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
const GROUND_Y = 68; // outdoor ground line, in stage %

const DEFAULT_SIZE: Record<string, number> = {
  sun: 20, cloud: 14, plant: 46, tree: 52, leaf: 40, drop: 6, bubble: 9, sugar: 12, earth: 30, moon: 16,
  star: 6, box: 14, text: 7, rain: 14, flower: 30, heart: 14, cell: 30, magnet: 16, bulb: 16, battery: 14,
};
export const PROPS = Object.keys(DEFAULT_SIZE);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
const easeInOut = (x: number) => { const t = clamp(x, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
/** Overshoot pop: 0 -> 1.12 -> 1. */
const easeBack = (x: number) => { const t = clamp(x, 0, 1); const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

/** Validate / clean AI output so a bad field never breaks the video. */
export function cleanExplainerScene(raw: unknown): ExplainerScene | null {
  // deno-lint-ignore no-explicit-any
  const r = raw as any;
  if (!r || !Array.isArray(r.elements) || r.elements.length === 0) return null;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const elements: ExplainerElement[] = r.elements.slice(0, 14).map((e: any, i: number) => ({
    id: String(e?.id ?? `e${i}`),
    pic: String(e?.pic ?? "box").slice(0, 16),
    x: clamp(num(e?.x, 50), 4, 96),
    y: clamp(num(e?.y, 50), 6, 94),
    size: e?.size == null ? undefined : clamp(num(e.size, 10), 3, 70),
    text: e?.text == null ? undefined : String(e.text).slice(0, 60),
    label: e?.label == null ? undefined : String(e.label).slice(0, 40),
    color: typeof e?.color === "string" ? e.color.slice(0, 20) : undefined,
  }));
  const ids = new Set(elements.map((e) => e.id));
  const okRef = (v: unknown) => (typeof v === "string" && ids.has(v.split(".")[0])) || (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number"));
  const actions = (Array.isArray(r.actions) ? r.actions : []).slice(0, 40).filter((a: any) => {
    if (!a || typeof a.type !== "string") return false;
    a.at = clamp(num(a.at, 0), 0, 40);
    switch (a.type) {
      case "appear": case "grow": case "fade_out": case "pulse": case "highlight": return ids.has(a.target);
      case "move": return ids.has(a.target) && okRef(a.to);
      case "flow": return okRef(a.from) && okRef(a.to) && typeof a.pic === "string";
      case "rays": case "arrow": return okRef(a.from) && okRef(a.to);
      case "label": return ids.has(a.target) && typeof a.text === "string";
      case "zoom": return okRef(a.target);
      case "zoom_out": return true;
      default: return false;
    }
  }) as ExplainerAction[];
  const bg = ["outdoor", "plain", "space", "water", "night"].includes(r.background) ? r.background : "plain";
  return { background: bg, elements, actions };
}

/** Draws one explainer scene at a time inside the scene. */
export class ExplainerPainter {
  private els = new Map<string, ExplainerElement>();

  constructor(
    private ctx: CanvasRenderingContext2D,
    private scene: ExplainerScene,
    private W: number,
    private H: number,
    private theme: ExplainerTheme,
    private rtl: boolean,
    /** Start time (s, inside the scene) of each narration sentence, plus the end of the last one. */
    private sentenceTimes: number[],
  ) {
    for (const e of scene.elements) this.els.set(e.id, e);
  }

  /** Narration-sentence position -> seconds in the scene. */
  private time(at: number) {
    const st = this.sentenceTimes;
    if (st.length < 2) return at * 2;
    const i = Math.floor(at);
    if (i >= st.length - 1) return st[st.length - 1];
    return st[i] + (st[i + 1] - st[i]) * (at - i);
  }

  private px(x: number) { return ((this.rtl ? 100 - x : x) / 100) * this.W; }
  private py(y: number) { return (y / 100) * this.H; }
  private sz(e: ExplainerElement) { return ((e.size ?? DEFAULT_SIZE[e.pic] ?? 12) / 100) * this.H; }

  // ---------- element state over time ----------

  private actionsFor(id: string) {
    return this.scene.actions.filter((a) => "target" in a && a.target === id);
  }

  /** 0..1 visibility scale and alpha for an element at time t. */
  private presence(e: ExplainerElement, t: number): { scale: number; alpha: number; grow: number } {
    const acts = this.actionsFor(e.id);
    const intro = acts.find((a) => a.type === "appear" || a.type === "grow");
    let scale = 1, alpha = 1, grow = 1;
    if (intro) {
      const t0 = this.time(intro.at);
      if (intro.type === "appear") {
        const p = (t - t0) / 0.55;
        scale = p <= 0 ? 0 : easeBack(p);
        alpha = clamp(p * 2, 0, 1);
      } else {
        grow = easeOut((t - t0) / 1.8);
        alpha = t < t0 ? 0 : 1;
      }
    }
    const out = acts.find((a) => a.type === "fade_out");
    if (out) alpha *= 1 - clamp((t - this.time(out.at)) / 0.6, 0, 1);
    return { scale, alpha, grow };
  }

  private position(e: ExplainerElement, t: number): [number, number] {
    let x = e.x, y = e.y;
    for (const a of this.actionsFor(e.id)) {
      if (a.type !== "move") continue;
      const t0 = this.time(a.at);
      if (t < t0) break;
      const [tx, ty] = this.refStage(a.to, t0);
      const p = easeInOut((t - t0) / (a.duration ?? 1.4));
      x += (tx - x) * p;
      y += (ty - y) * p;
    }
    return [x, y];
  }

  /** A reference ("sun", "plant.leaf", [x, y]) as stage % coordinates. */
  private refStage(ref: Ref, t: number): [number, number] {
    if (Array.isArray(ref)) return ref;
    const [id, part] = ref.split(".");
    const e = this.els.get(id);
    if (!e) return [50, 50];
    const [x, y] = this.position(e, t);
    const s = e.size ?? DEFAULT_SIZE[e.pic] ?? 12; // % of height
    const wx = s * (this.H / this.W); // same size as % of width
    if (e.pic === "plant" || e.pic === "tree" || e.pic === "flower") {
      if (part === "roots") return [x, y + s * 0.2];
      if (part === "leaf" || part === "leaves") return [x + wx * 0.28, y - s * 0.68];
      if (part === "top") return [x, y - s];
      return [x, y - s * 0.5];
    }
    if (part === "top") return [x, y - s * 0.5];
    if (part === "bottom") return [x, y + s * 0.5];
    if (part === "left") return [x - wx * 0.5, y];
    if (part === "right") return [x + wx * 0.5, y];
    return [x, y];
  }

  private refPx(ref: Ref, t: number): [number, number] {
    const [x, y] = this.refStage(ref, t);
    return [this.px(x), this.py(y)];
  }

  // ---------- frame ----------

  draw(t: number) {
    const { ctx } = this;
    this.background(t);

    // Camera.
    const cam = this.camera(t);
    ctx.save();
    ctx.translate(this.W / 2, this.H / 2);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-cam.x, -cam.y);

    if (this.scene.background === "outdoor") this.ground(t);
    // Rays and flows behind the pictures they travel to; arrows and labels on top.
    for (const a of this.scene.actions) if (a.type === "rays") this.rays(a, t);
    for (const e of this.scene.elements) this.element(e, t);
    for (const a of this.scene.actions) if (a.type === "flow") this.flow(a, t);
    for (const a of this.scene.actions) {
      if (a.type === "arrow") this.arrow(a, t);
      else if (a.type === "highlight" || a.type === "pulse") this.ring(a, t);
    }
    for (const e of this.scene.elements) this.nameTag(e, t);
    for (const a of this.scene.actions) if (a.type === "label") this.callout(a, t);
    ctx.restore();
  }

  private camera(t: number) {
    let cx = this.W / 2, cy = this.H / 2, scale = 1;
    for (const a of this.scene.actions) {
      if (a.type !== "zoom" && a.type !== "zoom_out") continue;
      const t0 = this.time(a.at);
      if (t < t0) continue;
      const [tx, ty] = a.type === "zoom" ? this.refPx(a.target, t0) : [this.W / 2, this.H / 2];
      const ts = a.type === "zoom" ? clamp(a.scale ?? 1.7, 1, 3) : 1;
      const p = easeInOut((t - t0) / 1.4);
      cx += (tx - cx) * p;
      cy += (ty - cy) * p;
      scale += (ts - scale) * p;
    }
    // Keep the zoomed view inside the stage.
    const halfW = this.W / 2 / scale, halfH = this.H / 2 / scale;
    return { x: clamp(cx, halfW, this.W - halfW), y: clamp(cy, halfH, this.H - halfH), scale };
  }

  private background(t: number) {
    const { ctx, W, H } = this;
    const bg = this.scene.background ?? "plain";
    let g: CanvasGradient;
    if (bg === "outdoor") {
      g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#BFE6FF");
      g.addColorStop(0.65, "#EAF7FF");
    } else if (bg === "space" || bg === "night") {
      g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, bg === "space" ? "#050A1F" : "#0B1638");
      g.addColorStop(1, bg === "space" ? "#121A3D" : "#24345F");
    } else if (bg === "water") {
      g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#7DD3FC");
      g.addColorStop(1, "#0369A1");
    } else {
      g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#F8FAFC");
      g.addColorStop(1, "#EEF2FF");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (bg === "space" || bg === "night") {
      for (let i = 0; i < 70; i++) {
        const x = (i * 197.3) % W, y = (i * 113.7) % (H * 0.9);
        ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.35 * Math.sin(t * 2 + i)})`;
        ctx.fillRect(x, y, i % 5 === 0 ? 3 : 2, i % 5 === 0 ? 3 : 2);
      }
    } else if (bg === "water") {
      for (let i = 0; i < 14; i++) {
        const x = ((i * 89) % W) + Math.sin(t + i) * 10;
        const y = H - (((t * 40 + i * 61) % (H + 40)));
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4 + (i % 4) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (bg === "plain") {
      ctx.fillStyle = hexA(this.theme.accent, 0.07);
      ctx.beginPath();
      ctx.arc(this.px(92), this.py(12), H * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(this.px(6), this.py(92), H * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private ground(t: number) {
    const { ctx, W, H } = this;
    const gy = this.py(GROUND_Y);
    // Soil.
    const soil = ctx.createLinearGradient(0, gy, 0, H);
    soil.addColorStop(0, "#A16207");
    soil.addColorStop(1, "#713F12");
    ctx.fillStyle = soil;
    ctx.fillRect(0, gy, W, H - gy);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.arc((i * 151) % W, gy + 20 + ((i * 67) % (H - gy - 20)), 3 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    // Grass strip with blades.
    ctx.fillStyle = "#65A30D";
    ctx.fillRect(0, gy - 6, W, 16);
    ctx.fillStyle = "#4D7C0F";
    for (let x = 0; x < W; x += 14) {
      const sway = Math.sin(t * 2 + x * 0.05) * 2;
      ctx.beginPath();
      ctx.moveTo(x, gy + 4);
      ctx.lineTo(x + 5 + sway, gy - 14 - (x % 3) * 3);
      ctx.lineTo(x + 9, gy + 4);
      ctx.fill();
    }
  }

  // ---------- pictures ----------

  private element(e: ExplainerElement, t: number) {
    const { ctx } = this;
    const { scale, alpha, grow } = this.presence(e, t);
    if (alpha <= 0.01 || scale <= 0.01 || grow <= 0) return;
    const [sx, sy] = this.position(e, t);
    const x = this.px(sx), y = this.py(sy), s = this.sz(e);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    switch (e.pic) {
      case "sun": drawSun(ctx, s, t); break;
      case "cloud": drawCloud(ctx, s, t); break;
      case "rain": drawCloud(ctx, s, t, true); break;
      case "plant": drawPlant(ctx, s, t, grow); break;
      case "flower": drawPlant(ctx, s, t, grow, true); break;
      case "tree": drawTree(ctx, s, t, grow); break;
      case "leaf": drawLeaf(ctx, s, t); break;
      case "drop": drawDrop(ctx, s); break;
      case "bubble": drawBubble(ctx, s, e.text ?? "", e.color ?? "#38BDF8"); break;
      case "sugar": drawSugar(ctx, s, e.text ?? "Glucose"); break;
      case "earth": drawEarth(ctx, s, t); break;
      case "moon": drawMoon(ctx, s); break;
      case "star": drawStar(ctx, s, t); break;
      case "heart": drawHeart(ctx, s, t); break;
      case "cell": drawCell(ctx, s, t); break;
      case "bulb": drawBulb(ctx, s, t); break;
      case "battery": drawBattery(ctx, s); break;
      case "magnet": drawMagnet(ctx, s); break;
      case "box": drawBox(ctx, s, e.text ?? "", e.color ?? this.theme.accent, this.rtl); break;
      case "text": drawText(ctx, s, e.text ?? "", e.color ?? this.theme.text); break;
      default: drawEmoji(ctx, s, e.pic, t);
    }
    ctx.restore();
  }

  private nameTag(e: ExplainerElement, t: number) {
    if (!e.label) return;
    const { alpha, scale, grow } = this.presence(e, t);
    if (alpha <= 0.01 || scale <= 0.01 || grow < 0.9) return;
    const [sx, sy] = this.position(e, t);
    const s = this.sz(e);
    const ground = e.pic === "plant" || e.pic === "tree" || e.pic === "flower";
    const y = ground ? this.py(sy) + s * 0.3 + 26 : this.py(sy) + s * 0.5 + 24;
    pill(this.ctx, this.px(sx), y, e.label, 22, "#FFFFFF", this.theme.text, alpha * clamp(scale, 0, 1));
  }

  // ---------- actions ----------

  private rays(a: Extract<ExplainerAction, { type: "rays" }>, t: number) {
    const t0 = this.time(a.at);
    if (t < t0 || (a.until != null && t > this.time(a.until) + 0.5)) return;
    const fade = a.until != null ? 1 - clamp((t - this.time(a.until)) / 0.5, 0, 1) : 1;
    const { ctx } = this;
    const [x1, y1] = this.refPx(a.from, t);
    const [x2, y2] = this.refPx(a.to, t);
    const reach = easeOut((t - t0) / 0.9);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const len = Math.hypot(x2 - x1, y2 - y1) * reach;
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(ang);
    ctx.globalAlpha = fade;
    // Soft beam.
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, "rgba(253, 224, 71, 0.55)");
    g.addColorStop(1, "rgba(253, 224, 71, 0.15)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(len, -46);
    ctx.lineTo(len, 46);
    ctx.lineTo(0, 18);
    ctx.fill();
    // Moving dashes.
    ctx.strokeStyle = "#FACC15";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.setLineDash([18, 16]);
    ctx.lineDashOffset = -t * 70;
    for (const k of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(10, k * 12);
      ctx.lineTo(len, k * 34);
      ctx.stroke();
    }
    ctx.restore();
  }

  private flow(a: Extract<ExplainerAction, { type: "flow" }>, t: number) {
    const t0 = this.time(a.at);
    if (t < t0) return;
    const tEnd = a.until != null ? this.time(a.until) : Infinity;
    const pts = [a.from, ...(a.via ?? []), a.to].map((r) => this.refPx(r, t));
    // Path length for even speed.
    const segs: number[] = [];
    for (let i = 1; i < pts.length; i++) segs.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = segs.reduce((n, v) => n + v, 0) || 1;
    const at = (f: number): [number, number] => {
      let d = f * total;
      for (let i = 0; i < segs.length; i++) {
        if (d <= segs[i] || i === segs.length - 1) {
          const k = segs[i] ? clamp(d / segs[i], 0, 1) : 0;
          return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
        }
        d -= segs[i];
      }
      return pts[pts.length - 1];
    };
    const count = clamp(a.count ?? 5, 1, 12);
    const travel = clamp(total / 220, 1.6, 4); // seconds per trip
    const s = ((a.size ?? (a.pic === "bubble" ? 6 : a.pic === "drop" ? 4.5 : 6)) / 100) * this.H;
    const { ctx } = this;
    for (let i = 0; i < count; i++) {
      const start = t0 + (i * travel) / count;
      if (t < start) continue;
      const trip = Math.floor((t - start) / travel);
      const born = start + trip * travel;
      if (born > tEnd) continue; // no new trips after "until"
      const f = (t - born) / travel;
      const [x, y] = at(f);
      const alpha = Math.min(1, f * 6, (1 - f) * 6);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      if (a.pic === "drop") drawDrop(ctx, s);
      else if (a.pic === "bubble") drawBubble(ctx, s, a.text ?? "", a.color ?? "#38BDF8");
      else if (a.pic === "sugar") drawSugar(ctx, s, a.text ?? "");
      else if (a.pic === "star") drawStar(ctx, s, t);
      else if (a.pic === "heart") drawHeart(ctx, s, t);
      else if (a.pic === "dot") { ctx.fillStyle = a.color ?? this.theme.accent; ctx.beginPath(); ctx.arc(0, 0, s / 3, 0, Math.PI * 2); ctx.fill(); }
      else drawEmoji(ctx, s, a.pic, 0);
      ctx.restore();
    }
  }

  private arrow(a: Extract<ExplainerAction, { type: "arrow" }>, t: number) {
    const t0 = this.time(a.at);
    if (t < t0) return;
    const { ctx } = this;
    let [x1, y1] = this.refPx(a.from, t);
    let [x2, y2] = this.refPx(a.to, t);
    // Stop short of the pictures at both ends.
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const gap = Math.min(60, Math.hypot(x2 - x1, y2 - y1) * 0.18);
    x1 += Math.cos(ang) * gap; y1 += Math.sin(ang) * gap;
    x2 -= Math.cos(ang) * gap; y2 -= Math.sin(ang) * gap;
    const p = easeOut((t - t0) / 0.8);
    // Slight curve.
    const mx = (x1 + x2) / 2 - Math.sin(ang) * 30, my = (y1 + y2) / 2 + Math.cos(ang) * -30;
    const color = a.color ?? this.theme.accent;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    const steps = 30;
    let ex = x1, ey = y1, px = x1, py = y1;
    ctx.moveTo(x1, y1);
    for (let i = 1; i <= steps * p; i++) {
      const u = i / steps;
      px = ex; py = ey;
      ex = (1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * mx + u * u * x2;
      ey = (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * my + u * u * y2;
      ctx.lineTo(ex, ey);
    }
    ctx.stroke();
    if (p > 0.05) {
      const ha = Math.atan2(ey - py, ex - px);
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(ha) * 14, ey + Math.sin(ha) * 14);
      ctx.lineTo(ex + Math.cos(ha + 2.4) * 22, ey + Math.sin(ha + 2.4) * 22);
      ctx.lineTo(ex + Math.cos(ha - 2.4) * 22, ey + Math.sin(ha - 2.4) * 22);
      ctx.fill();
    }
    ctx.restore();
    if (a.label && p > 0.7) pill(ctx, mx, my - 6, a.label, 22, color, "#FFFFFF", easeOut((p - 0.7) / 0.3));
  }

  private ring(a: { target: string; at: number }, t: number) {
    const t0 = this.time(a.at);
    if (t < t0 || t > t0 + 3) return;
    const e = this.els.get(a.target);
    if (!e) return;
    const [x, y] = this.refPx(a.target, t);
    const ground = e.pic === "plant" || e.pic === "tree" || e.pic === "flower";
    const r = this.sz(e) * (ground ? 0.55 : 0.62);
    const cy = ground ? y : y;
    const { ctx } = this;
    const k = (t - t0) % 1;
    ctx.save();
    ctx.strokeStyle = "#F59E0B";
    ctx.lineWidth = 6;
    ctx.globalAlpha = (1 - k) * (1 - clamp((t - t0 - 2.4) / 0.6, 0, 1));
    ctx.beginPath();
    ctx.arc(x, cy, r * (1 + k * 0.35), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private callout(a: Extract<ExplainerAction, { type: "label" }>, t: number) {
    const t0 = this.time(a.at);
    if (t < t0) return;
    const e = this.els.get(a.target);
    if (!e || this.presence(e, t).alpha < 0.05) return;
    const [x, y] = this.refPx(a.target, t);
    const s = this.sz(e) * 0.5;
    const side = a.side ?? "top";
    const d = s + 46;
    const { ctx } = this;
    // Keep the whole tag inside the frame (the AI may place things near the edges).
    ctx.font = `700 26px ${FONT}`;
    const half = (ctx.measureText(a.text).width + 26 * 1.2) / 2 + 16;
    const lx = clamp(side === "left" ? x - d * 1.4 : side === "right" ? x + d * 1.4 : x, half, this.W - half);
    const ly = clamp(side === "top" ? y - d : side === "bottom" ? y + d : y - s * 0.4, 110, this.H - 130);
    const p = easeBack((t - t0) / 0.5);
    ctx.save();
    ctx.strokeStyle = this.theme.text;
    ctx.globalAlpha = clamp((t - t0) / 0.3, 0, 1);
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(x + (lx - x) * 0.35, y + (ly - y) * 0.35);
    ctx.lineTo(lx, ly);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.translate(lx, ly);
    ctx.scale(p, p);
    pill(ctx, 0, 0, a.text, 26, this.theme.accent, "#FFFFFF", clamp((t - t0) / 0.3, 0, 1));
    ctx.restore();
  }
}

// ---------- drawing helpers (all centred on 0,0; s = size in px) ----------

function hexA(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{3,6}$/i.test(h)) return `rgba(59,130,246,${alpha})`;
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size: number, bg: string, fg: string, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + size * 1.2;
  const h = size * 1.7;
  ctx.shadowColor = "rgba(15,23,42,0.18)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = bg;
  rr(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = fg;
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSun(ctx: CanvasRenderingContext2D, s: number, t: number) {
  const r = s / 2;
  const glow = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.9);
  glow.addColorStop(0, "rgba(253, 224, 71, 0.55)");
  glow.addColorStop(1, "rgba(253, 224, 71, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.rotate(t * 0.35);
  ctx.fillStyle = "#FBBF24";
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath();
    ctx.moveTo(-r * 0.16, -r * 1.08);
    ctx.lineTo(0, -r * (1.45 + 0.06 * Math.sin(t * 3 + i)));
    ctx.lineTo(r * 0.16, -r * 1.08);
    ctx.fill();
  }
  ctx.restore();
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, "#FEF08A");
  g.addColorStop(1, "#F59E0B");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawCloud(ctx: CanvasRenderingContext2D, s: number, t: number, rain = false) {
  const dx = Math.sin(t * 0.5) * s * 0.08;
  ctx.save();
  ctx.translate(dx, 0);
  if (rain) {
    ctx.strokeStyle = "#3B82F6";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 0; i < 7; i++) {
      const x = -s * 0.6 + i * s * 0.2;
      const y = s * 0.25 + ((t * s * 1.2 + i * 37) % (s * 0.9));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 14);
      ctx.stroke();
    }
  }
  ctx.fillStyle = rain ? "#CBD5E1" : "#FFFFFF";
  ctx.shadowColor = "rgba(30, 64, 175, 0.15)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  // One path for all puffs so the shadow is drawn once, under the whole cloud.
  ctx.beginPath();
  for (const [cx, cy, r] of [[-0.48, 0.1, 0.3], [-0.12, -0.12, 0.42], [0.32, -0.04, 0.36], [0.66, 0.12, 0.26], [0.1, 0.16, 0.34]]) {
    ctx.moveTo((cx + r) * s, cy * s);
    ctx.arc(cx * s, cy * s, r * s, 0, Math.PI * 2);
  }
  ctx.fill("nonzero");
  ctx.restore();
}

function leafPath(ctx: CanvasRenderingContext2D, len: number, wid: number) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.45, -wid, len, 0);
  ctx.quadraticCurveTo(len * 0.45, wid, 0, 0);
  ctx.closePath();
}

function drawLeafShape(ctx: CanvasRenderingContext2D, len: number, light = "#4ADE80", dark = "#15803D") {
  const g = ctx.createLinearGradient(0, -len * 0.3, len, len * 0.3);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  leafPath(ctx, len, len * 0.42);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = Math.max(1.5, len * 0.03);
  ctx.beginPath();
  ctx.moveTo(len * 0.05, 0);
  ctx.lineTo(len * 0.92, 0);
  ctx.stroke();
}

/** Plant: (0,0) is the base on the ground; grow 0..1 draws it growing up. */
function drawPlant(ctx: CanvasRenderingContext2D, s: number, t: number, grow: number, flower = false) {
  const h = s * grow;
  const sway = Math.sin(t * 1.3) * s * 0.025 * grow;
  // Roots.
  ctx.strokeStyle = "#78350F";
  ctx.lineCap = "round";
  const rootLen = s * 0.2 * grow;
  for (const [dx, w] of [[-0.6, 4], [-0.25, 5], [0.05, 6], [0.35, 5], [0.65, 4]] as const) {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(dx * rootLen * 0.5, rootLen * 0.6, dx * rootLen, rootLen);
    ctx.stroke();
  }
  // Stem.
  ctx.strokeStyle = "#16A34A";
  ctx.lineWidth = Math.max(5, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(sway * 0.5, -h * 0.5, sway, -h);
  ctx.stroke();
  // Leaves along the stem (appear as the stem passes them).
  const leaves: [number, number, number][] = [[0.3, 1, 0.42], [0.45, -1, 0.4], [0.62, 1, 0.36], [0.78, -1, 0.3]];
  for (const [at, side, len] of leaves) {
    if (grow < at + 0.05) continue;
    const k = easeOut((grow - at - 0.05) / 0.25);
    const y = -s * at;
    const x = sway * at;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(side > 0 ? -0.45 + Math.sin(t * 1.6 + at * 9) * 0.06 : Math.PI + 0.45 + Math.sin(t * 1.6 + at * 9) * 0.06);
    ctx.scale(k, k);
    drawLeafShape(ctx, s * len);
    ctx.restore();
  }
  // Top: bud or flower.
  if (grow > 0.9) {
    const k = easeOut((grow - 0.9) / 0.1);
    ctx.save();
    ctx.translate(sway, -h);
    ctx.scale(k, k);
    if (flower) {
      ctx.fillStyle = "#F472B6";
      for (let i = 0; i < 6; i++) {
        ctx.rotate(Math.PI / 3);
        ctx.beginPath();
        ctx.ellipse(0, -s * 0.07, s * 0.05, s * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#FDE047";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.045, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.rotate(-Math.PI / 2 - 0.25);
      drawLeafShape(ctx, s * 0.2);
      ctx.rotate(0.5);
      drawLeafShape(ctx, s * 0.18);
    }
    ctx.restore();
  }
}

function drawTree(ctx: CanvasRenderingContext2D, s: number, t: number, grow: number) {
  const h = s * grow;
  ctx.fillStyle = "#92400E";
  ctx.beginPath();
  ctx.moveTo(-s * 0.06, 0);
  ctx.lineTo(-s * 0.04, -h * 0.55);
  ctx.lineTo(s * 0.04, -h * 0.55);
  ctx.lineTo(s * 0.06, 0);
  ctx.fill();
  if (grow < 0.4) return;
  const k = easeOut((grow - 0.4) / 0.6);
  const sway = Math.sin(t * 1.1) * s * 0.01;
  ctx.save();
  ctx.translate(sway, -h * 0.72);
  ctx.scale(k, k);
  const g = ctx.createRadialGradient(-s * 0.1, -s * 0.15, s * 0.05, 0, 0, s * 0.42);
  g.addColorStop(0, "#4ADE80");
  g.addColorStop(1, "#15803D");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, -s * 0.06, s * 0.26, 0, Math.PI * 2);
  ctx.arc(-s * 0.2, s * 0.06, s * 0.2, 0, Math.PI * 2);
  ctx.arc(s * 0.2, s * 0.06, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLeaf(ctx: CanvasRenderingContext2D, s: number, t: number) {
  ctx.save();
  ctx.rotate(-0.35 + Math.sin(t * 1.2) * 0.03);
  ctx.translate(-s * 0.55, 0);
  drawLeafShape(ctx, s * 1.1);
  // Side veins.
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = Math.max(1.5, s * 0.015);
  for (let i = 1; i <= 5; i++) {
    const x = s * 1.1 * (i / 6.5);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + s * 0.12, side * s * 0.16 * Math.sin((i / 6) * Math.PI));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawDrop(ctx: CanvasRenderingContext2D, s: number) {
  const g = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.4);
  g.addColorStop(0, "#7DD3FC");
  g.addColorStop(1, "#0284C7");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.6);
  ctx.bezierCurveTo(s * 0.18, -s * 0.3, s * 0.42, -s * 0.05, s * 0.42, s * 0.12);
  ctx.arc(0, s * 0.12, s * 0.42, 0, Math.PI);
  ctx.bezierCurveTo(-s * 0.42, -s * 0.05, -s * 0.18, -s * 0.3, 0, -s * 0.6);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.ellipse(-s * 0.14, s * 0.06, s * 0.07, s * 0.13, 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawBubble(ctx: CanvasRenderingContext2D, s: number, text: string, color: string) {
  const r = s / 2;
  ctx.fillStyle = hexA(color.startsWith("#") ? color : "#38BDF8", 0.22);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, r * 0.1);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.beginPath();
  ctx.arc(-r * 0.4, -r * 0.4, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  if (text) {
    ctx.fillStyle = "#0F172A";
    ctx.font = `800 ${Math.max(12, r * (text.length > 3 ? 0.62 : 0.8))}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 1);
  }
}

function drawSugar(ctx: CanvasRenderingContext2D, s: number, text: string) {
  const r = s / 2;
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, "#FCD34D");
  g.addColorStop(1, "#F59E0B");
  ctx.fillStyle = g;
  ctx.strokeStyle = "#B45309";
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (text) {
    ctx.fillStyle = "#451A03";
    ctx.font = `800 ${Math.max(11, r * (text.length > 5 ? 0.34 : 0.5))}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 1);
  }
}

function drawEarth(ctx: CanvasRenderingContext2D, s: number, t: number) {
  const r = s / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, "#60A5FA");
  g.addColorStop(1, "#1D4ED8");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = "#22C55E";
  const shift = ((t * r * 0.15) % (r * 4)) - r * 2;
  for (const [x, y, w, h] of [[-0.4, -0.3, 0.35, 0.25], [0.3, 0.1, 0.3, 0.4], [-0.2, 0.45, 0.25, 0.15], [0.9, -0.4, 0.3, 0.2], [-1.2, 0.2, 0.3, 0.3]]) {
    for (const k of [0, r * 4]) {
      ctx.beginPath();
      ctx.ellipse(x * r + shift + k - r * 2, y * r, w * r, h * r, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawMoon(ctx: CanvasRenderingContext2D, s: number) {
  const r = s / 2;
  ctx.fillStyle = "#E5E7EB";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#CBD5E1";
  for (const [x, y, k] of [[-0.3, -0.2, 0.2], [0.3, 0.25, 0.15], [0.1, -0.45, 0.1]]) {
    ctx.beginPath();
    ctx.arc(x * r, y * r, k * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStar(ctx: CanvasRenderingContext2D, s: number, t: number) {
  const r = (s / 2) * (1 + 0.08 * Math.sin(t * 4));
  ctx.fillStyle = "#FACC15";
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 ? r * 0.45 : r;
    ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

function drawHeart(ctx: CanvasRenderingContext2D, s: number, t: number) {
  const k = 1 + 0.06 * Math.max(0, Math.sin(t * 6));
  ctx.save();
  ctx.scale(k, k);
  ctx.fillStyle = "#EF4444";
  ctx.beginPath();
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(-s * 0.6, -s * 0.05, -s * 0.3, -s * 0.5, 0, -s * 0.2);
  ctx.bezierCurveTo(s * 0.3, -s * 0.5, s * 0.6, -s * 0.05, 0, s * 0.35);
  ctx.fill();
  ctx.restore();
}

function drawCell(ctx: CanvasRenderingContext2D, s: number, t: number) {
  const r = s / 2;
  ctx.fillStyle = "rgba(134, 239, 172, 0.5)";
  ctx.strokeStyle = "#16A34A";
  ctx.lineWidth = Math.max(3, r * 0.05);
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const rad = r * (1 + 0.04 * Math.sin(a * 5 + t));
    ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * rad * 1.2, Math.sin(a) * rad * 0.85);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#7C3AED";
  ctx.beginPath();
  ctx.arc(r * 0.1, -r * 0.05, r * 0.25, 0, Math.PI * 2);
  ctx.fill();
}

function drawBulb(ctx: CanvasRenderingContext2D, s: number, t: number) {
  const r = s * 0.32;
  const on = 0.6 + 0.4 * Math.sin(t * 3);
  const glow = ctx.createRadialGradient(0, -r * 0.3, r * 0.2, 0, -r * 0.3, r * 2.2);
  glow.addColorStop(0, `rgba(253,224,71,${0.5 * on})`);
  glow.addColorStop(1, "rgba(253,224,71,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, -r * 0.3, r * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#FDE047";
  ctx.beginPath();
  ctx.arc(0, -r * 0.3, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#64748B";
  ctx.fillRect(-r * 0.45, r * 0.55, r * 0.9, r * 0.6);
}

function drawBattery(ctx: CanvasRenderingContext2D, s: number) {
  ctx.fillStyle = "#334155";
  rr(ctx, -s * 0.5, -s * 0.25, s, s * 0.5, s * 0.06);
  ctx.fill();
  ctx.fillRect(s * 0.5, -s * 0.1, s * 0.08, s * 0.2);
  ctx.fillStyle = "#22C55E";
  rr(ctx, -s * 0.44, -s * 0.19, s * 0.6, s * 0.38, s * 0.04);
  ctx.fill();
}

function drawMagnet(ctx: CanvasRenderingContext2D, s: number) {
  ctx.lineWidth = s * 0.22;
  ctx.strokeStyle = "#DC2626";
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.35, Math.PI, 0, false);
  ctx.stroke();
  ctx.fillStyle = "#94A3B8";
  ctx.fillRect(-s * 0.46, 0, s * 0.22, s * 0.18);
  ctx.fillRect(s * 0.24, 0, s * 0.22, s * 0.18);
}

function drawBox(ctx: CanvasRenderingContext2D, s: number, text: string, color: string, rtl: boolean) {
  ctx.font = `700 ${Math.max(18, s * 0.28)}px ${FONT}`;
  ctx.direction = rtl ? "rtl" : "ltr";
  const w = Math.max(s * 1.4, ctx.measureText(text).width + s * 0.5);
  const h = s * 0.62;
  ctx.shadowColor = "rgba(15,23,42,0.15)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = "#FFFFFF";
  rr(ctx, -w / 2, -h / 2, w, h, 16);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#0F172A";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 1);
}

function drawText(ctx: CanvasRenderingContext2D, s: number, text: string, color: string) {
  ctx.font = `800 ${s}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
}

function drawEmoji(ctx: CanvasRenderingContext2D, s: number, emoji: string, t: number) {
  ctx.save();
  ctx.translate(0, Math.sin(t * 2) * s * 0.03);
  ctx.font = `${s}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 0, s * 0.05);
  ctx.restore();
}
