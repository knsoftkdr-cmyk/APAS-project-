// supabase/functions/_shared/kidsFlashcards.ts
//
// Content Studio picture flash cards: each card has an emoji picture, a short front (word / question)
// and a back (answer). This module draws a printable "cut and fold" sheet as SVG: picture + front on
// top, a dashed fold line, and the answer underneath. Pure module (no Deno APIs), testable in Node.

import { cleanEmoji, EMOJI_FONT, esc, FONT, PALETTE, wrapText } from "./kidsFlowchart.ts";

export interface KidsFlashcard {
  front: string;
  back: string;
  emoji: string;
}

export const KIDS_FLASHCARDS_PROMPT = `"flashcards": [ { "front": "a single word/term or a very short question (max 8 words)", "back": "short answer (max 15 words)", "emoji": "ONE emoji that pictures the front, e.g. 🍎 for apple, ☀️ for sunlight" } ]  // 8-12 cards`;

export function parseKidsFlashcards(raw: unknown): KidsFlashcard[] {
  return (Array.isArray(raw) ? raw : [])
    .map((c: any) => ({
      front: String(c?.front ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      back: String(c?.back ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      emoji: cleanEmoji(c?.emoji),
    }))
    .filter((c) => c.front && c.back)
    .slice(0, 16);
}

const W = 820;
const COLS = 3;
const MARGIN = 26;
const GAP = 16;
const CARD_W = (W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
const CARD_H = 330;

export function renderFlashcardSheetSvg(
  cards: KidsFlashcard[],
  opts: { title?: string; rtl?: boolean; frame?: string } = {},
): string {
  const dir = opts.rtl ? ` direction="rtl"` : "";
  const frame = opts.frame ?? "#6CC04A";
  const out: string[] = [];
  const lines = (x: number, yMid: number, ls: string[], size: number, weight: number, fill: string) => {
    const lh = size * 1.22;
    const y0 = yMid - ((ls.length - 1) * lh) / 2;
    return ls.map((l, i) =>
      `<text x="${x}" y="${(y0 + i * lh).toFixed(1)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="middle" dominant-baseline="central"${dir}>${esc(l)}</text>`
    ).join("");
  };

  let top = 26;
  if (opts.title) {
    out.push(lines(W / 2, top + 26, wrapText(opts.title, 34, 1), 34, 800, frame));
    out.push(lines(W / 2, top + 62, ["✂  Cut out each card, fold on the dotted line, answer on the back"], 14, 400, "#6B7280"));
    top += 86;
  }

  cards.forEach((c, i) => {
    const col = opts.rtl ? COLS - 1 - (i % COLS) : i % COLS;
    const x = MARGIN + col * (CARD_W + GAP);
    const y = top + Math.floor(i / COLS) * (CARD_H + GAP);
    const cx = x + CARD_W / 2;
    const [fill, stroke] = PALETTE[i % PALETTE.length];
    const foldY = y + 214;

    // Cut guide, coloured card, white picture window.
    out.push(`<rect x="${x - 4}" y="${y - 4}" width="${CARD_W + 8}" height="${CARD_H + 8}" rx="22" fill="none" stroke="#9CA3AF" stroke-width="1" stroke-dasharray="3 5"/>`);
    out.push(`<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="4"/>`);
    out.push(`<rect x="${x + 12}" y="${y + 12}" width="${CARD_W - 24}" height="${foldY - y - 22}" rx="14" fill="#FFFFFF"/>`);
    if (c.emoji) {
      out.push(`<text x="${cx}" y="${y + 78}" font-family="${EMOJI_FONT}" font-size="72" text-anchor="middle" dominant-baseline="central">${esc(c.emoji)}</text>`);
    }
    const front = wrapText(c.front, 17, 3);
    out.push(lines(cx, c.emoji ? y + 158 : y + 100, front, front.length > 2 ? 17 : 20, 800, "#1F2937"));

    // Fold line + answer.
    out.push(`<line x1="${x + 10}" y1="${foldY}" x2="${x + CARD_W - 10}" y2="${foldY}" stroke="${stroke}" stroke-width="2" stroke-dasharray="6 6"/>`);
    const back = wrapText(c.back, 24, 4);
    out.push(lines(cx, foldY + 10 + (CARD_H - (foldY - y) - 10) / 2, back, 15, 600, "#1F2937"));
  });

  const rows = Math.ceil(cards.length / COLS);
  const H = Math.ceil(top + rows * (CARD_H + GAP) - GAP + 30);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/>`,
    ...out,
    `</svg>`,
  ].join("");
}
