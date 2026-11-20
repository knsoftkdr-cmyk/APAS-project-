// supabase/functions/_shared/kidsFlowchart.ts
//
// Content Studio "kids poster" flow charts: the AI returns a small JSON description and this module
// draws a colourful, printable SVG (rounded pastel boxes, emoji pictures, Yes/No paths).
// Pure module (no Deno APIs) so it can be tested in Node.
//
// Two kinds:
//  - "decision": a chain of yes/no questions. Yes goes down to the next question, No goes right to
//    the "no" outcome; answering yes to every question reaches the "yes" outcome. ("Is it living?")
//  - "steps": an ordered process with an optional final result. ("How plants make food")

export interface KidsOutcome {
  text: string;
  emojis: string[];
}

export interface KidsFlowchart {
  kind: "decision" | "steps";
  title: string;
  intro: string;
  nodes: { text: string; emoji: string }[];
  yes_label: string;
  no_label: string;
  end_yes: KidsOutcome | null;
  end_no: KidsOutcome | null;
}

export const KIDS_FLOWCHART_PROMPT = `"flowchart": {
    "kind": "decision" if the topic is naturally a set of yes/no questions that sort something into two groups, otherwise "steps",
    "title": "short catchy poster title (max 6 words)",
    "intro": "optional short lead-in shown above the boxes, e.g. 'Does it...' (or empty string)",
    "nodes": [ { "text": "very short box text (max 8 words)", "emoji": "one emoji that pictures it" } ],  // 4-8 nodes
    "yes_label": "the word for Yes in the content language", "no_label": "the word for No in the content language",
    "end_yes": { "text": "result when every answer is yes / the final result of the steps", "emojis": ["2-3 example emojis"] },
    "end_no": { "text": "result for any 'no' answer (decision only, else null)", "emojis": ["2-3 example emojis"] }
  }`;

export const PICTO = /\p{Extended_Pictographic}/u;
export const cleanEmoji = (v: unknown) => {
  const s = String(v ?? "").trim();
  return PICTO.test(s) ? Array.from(s).slice(0, 4).join("") : "";
};
const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function cleanOutcome(v: any): KidsOutcome | null {
  if (!v || typeof v !== "object") return null;
  const text = cleanText(v.text, 80);
  if (!text) return null;
  const emojis = (Array.isArray(v.emojis) ? v.emojis : []).map(cleanEmoji).filter(Boolean).slice(0, 3);
  return { text, emojis };
}

/** Validate the AI's JSON; returns null when it cannot be drawn. */
export function parseKidsFlowchart(raw: any): KidsFlowchart | null {
  if (!raw || typeof raw !== "object") return null;
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .map((n: any) => ({ text: cleanText(n?.text, 70), emoji: cleanEmoji(n?.emoji) }))
    .filter((n: { text: string }) => n.text)
    .slice(0, 9);
  if (nodes.length < 2) return null;
  const kind = raw.kind === "decision" ? "decision" : "steps";
  return {
    kind,
    title: cleanText(raw.title, 60) || "Flow chart",
    intro: cleanText(raw.intro, 60),
    nodes,
    yes_label: cleanText(raw.yes_label, 10) || "Yes",
    no_label: cleanText(raw.no_label, 10) || "No",
    end_yes: cleanOutcome(raw.end_yes),
    end_no: kind === "decision" ? cleanOutcome(raw.end_no) : null,
  };
}

// Pastel fill + matching darker outline, cycled per box (like the sample poster).
export const PALETTE: [string, string][] = [
  ["#C9B6F2", "#7C5CC4"], ["#F6B3D3", "#C2417F"], ["#FDBF8A", "#D9731F"], ["#FDE68A", "#C99A06"],
  ["#B9E6A1", "#4D9A2A"], ["#9FE3D8", "#1F9584"], ["#A9D8F5", "#2B87C4"], ["#C7CDF8", "#5560C9"], ["#F8B4B4", "#C83E3E"],
];

export const FRAME_COLORS: Record<string, string> = {
  classic: "#3B82F6", nature: "#6CC04A", sunset: "#F97316", dark: "#8B5CF6", playful: "#EC4899",
};

export const FONT = `'Comic Sans MS','Chalkboard SE','Baloo 2','Segoe UI','Noto Sans Arabic','Noto Sans Telugu',sans-serif`;
export const EMOJI_FONT = `'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif`;

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Greedy word wrap by an approximate character budget per line. */
export function wrapText(text: string, maxChars: number, maxLines = 3): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= maxChars) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, "…");
  }
  return lines;
}

const W = 820;

export function renderKidsFlowchartSvg(chart: KidsFlowchart, opts: { rtl?: boolean; frame?: string } = {}): string {
  const rtl = !!opts.rtl;
  const frame = opts.frame ?? FRAME_COLORS.nature;
  const dir = rtl ? ` direction="rtl"` : "";
  // Mirror x positions for right-to-left languages.
  const mx = (x: number) => (rtl ? W - x : x);
  const rx = (x: number, w: number) => (rtl ? W - x - w : x);
  const out: string[] = [];

  const text = (x: number, y: number, lines: string[], size: number, opt: { anchor?: string; weight?: number; fill?: string } = {}) => {
    const lh = size * 1.2;
    const y0 = y - ((lines.length - 1) * lh) / 2;
    return lines.map((l, i) =>
      `<text x="${x}" y="${(y0 + i * lh).toFixed(1)}" font-family="${FONT}" font-size="${size}" font-weight="${opt.weight ?? 700}" fill="${opt.fill ?? "#1F2937"}" text-anchor="${opt.anchor ?? "middle"}" dominant-baseline="central"${dir}>${esc(l)}</text>`
    ).join("");
  };
  const emoji = (x: number, y: number, e: string, size: number) =>
    e ? `<text x="${x}" y="${y}" font-family="${EMOJI_FONT}" font-size="${size}" text-anchor="middle" dominant-baseline="central">${esc(e)}</text>` : "";
  const arrowDown = (x: number, y1: number, y2: number, color = "#374151") =>
    `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2 - 7}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M${x - 7} ${y2 - 9} L${x + 7} ${y2 - 9} L${x} ${y2} Z" fill="${color}"/>`;
  const tag = (x: number, cy: number, w: number, label: string, color: string) =>
    `<rect x="${rx(x, w)}" y="${cy - 16}" width="${w}" height="32" rx="9" fill="#FFFFFF" stroke="${color}" stroke-width="3"/>` +
    text(mx(x + w / 2), cy, [label], 16, { fill: "#1F2937" });

  const outcomeBox = (x: number, y: number, w: number, o: KidsOutcome, color: string) => {
    const lines = wrapText(o.text, Math.floor(w / 13), 2);
    const textH = lines.length * 30 + 20;
    const h = textH + (o.emojis.length ? 74 : 6);
    let s = `<rect x="${rx(x, w)}" y="${y}" width="${w}" height="${h}" rx="18" fill="#FFFFFF" stroke="${color}" stroke-width="4"/>`;
    s += text(mx(x + w / 2), y + textH / 2 + 4, lines, 24, { fill: "#1F2937" });
    const n = o.emojis.length;
    o.emojis.forEach((e, i) => {
      const cx = x + w / 2 + (i - (n - 1) / 2) * 76;
      s += `<circle cx="${mx(cx)}" cy="${y + textH + 34}" r="31" fill="#FFF7E6" stroke="${color}" stroke-width="3"/>`;
      s += emoji(mx(cx), y + textH + 36, e, 34);
    });
    return { svg: s, h };
  };

  // Title + intro
  let y = 40;
  const titleLines = wrapText(chart.title, 30, 2);
  out.push(text(W / 2, y + 30 + (titleLines.length - 1) * 24, titleLines, 46, { fill: frame, weight: 800 }));
  y += 30 + titleLines.length * 52;
  if (chart.intro) {
    // With direction="rtl", "start" is the right-hand end, so the same anchor works for both directions.
    out.push(text(mx(48), y + 6, [chart.intro], 21, { anchor: "start", fill: "#374151" }));
    y += 36;
  } else y += 10;

  if (chart.kind === "decision") {
    const yesColor = "#4D9A2A", noColor = "#4B5563";
    const pillX = 120, pillW = 400, railX = 668;
    const centers: number[] = [];
    chart.nodes.forEach((n, i) => {
      const [fill, stroke] = PALETTE[i % PALETTE.length];
      const lines = wrapText(n.text, 22, 2);
      const h = Math.max(58, lines.length * 28 + 22);
      const cy = y + h / 2;
      centers.push(cy);
      if (i > 0) out.push(arrowDown(mx(76), centers[i - 1] + 16, cy - 16));
      out.push(tag(44, cy, 64, chart.yes_label, yesColor));
      out.push(`<line x1="${mx(108)}" y1="${cy}" x2="${mx(pillX)}" y2="${cy}" stroke="${stroke}" stroke-width="3"/>`);
      out.push(`<rect x="${rx(pillX, pillW)}" y="${y}" width="${pillW}" height="${h}" rx="22" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`);
      out.push(emoji(mx(pillX + 38), cy + 2, n.emoji, 30));
      out.push(text(mx(pillX + 38 + (pillW - 38) / 2), cy, lines, 23));
      out.push(`<line x1="${mx(pillX + pillW)}" y1="${cy}" x2="${mx(540)}" y2="${cy}" stroke="${stroke}" stroke-width="3"/>`);
      out.push(tag(540, cy, 60, chart.no_label, noColor));
      out.push(`<line x1="${mx(600)}" y1="${cy}" x2="${mx(railX)}" y2="${cy}" stroke="${noColor}" stroke-width="3"/>`);
      y += h + 30;
    });
    const endY = y + 14;
    if (chart.end_yes) {
      out.push(arrowDown(mx(76), centers[centers.length - 1] + 16, endY));
      const box = outcomeBox(36, endY, 380, chart.end_yes, yesColor);
      out.push(box.svg);
      y = Math.max(y, endY + box.h);
    }
    if (chart.end_no) {
      out.push(`<line x1="${mx(railX)}" y1="${centers[0]}" x2="${mx(railX)}" y2="${endY - 7}" stroke="${noColor}" stroke-width="3"/>`);
      out.push(`<path d="M${mx(railX) - 7} ${endY - 9} L${mx(railX) + 7} ${endY - 9} L${mx(railX)} ${endY} Z" fill="${noColor}"/>`);
      const box = outcomeBox(448, endY, 336, chart.end_no, noColor);
      out.push(box.svg);
      y = Math.max(y, endY + box.h);
    }
  } else {
    const pillX = 110, pillW = 600, cx = W / 2;
    let prevBottom = 0;
    chart.nodes.forEach((n, i) => {
      const [fill, stroke] = PALETTE[i % PALETTE.length];
      const lines = wrapText(n.text, 32, 3);
      const h = Math.max(70, lines.length * 28 + 26);
      if (i > 0) out.push(arrowDown(cx, prevBottom, y));
      const cy = y + h / 2;
      out.push(`<rect x="${rx(pillX, pillW)}" y="${y}" width="${pillW}" height="${h}" rx="24" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`);
      // Step number bubble + emoji bubble on the leading side.
      out.push(`<circle cx="${mx(pillX)}" cy="${y + 6}" r="17" fill="${stroke}"/>`);
      out.push(text(mx(pillX), y + 6, [String(i + 1)], 18, { fill: "#FFFFFF", weight: 800 }));
      out.push(`<circle cx="${mx(pillX + 52)}" cy="${cy}" r="30" fill="#FFFFFF" stroke="${stroke}" stroke-width="2"/>`);
      out.push(emoji(mx(pillX + 52), cy + 2, n.emoji, 32));
      out.push(text(mx(pillX + 96 + (pillW - 110) / 2), cy, lines, 23));
      prevBottom = y + h;
      y += h + 40;
    });
    if (chart.end_yes) {
      out.push(arrowDown(cx, prevBottom, y));
      const box = outcomeBox(170, y, 480, chart.end_yes, frame);
      out.push(box.svg);
      y += box.h;
    } else y -= 40;
  }

  const H = Math.ceil(y + 44);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/>`,
    `<rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="34" fill="none" stroke="${frame}" stroke-width="12"/>`,
    ...out,
    `</svg>`,
  ].join("");
}
