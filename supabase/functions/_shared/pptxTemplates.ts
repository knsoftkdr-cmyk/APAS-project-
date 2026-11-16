// supabase/functions/_shared/pptxTemplates.ts
//
// Themed PPTX builder for Content Studio. Pure module: the PptxGenJS class is passed in,
// so the same code runs in the edge function (Deno, npm:pptxgenjs) and in local Node tests.
// Layout is 16:9 wide (13.333 x 7.5 in). Only erasable TypeScript (no enums) so Node can
// run it with type stripping.

export interface DeckSlide { title: string; bullets: string[]; speaker_notes: string }
export interface DeckInput { title: string; subtitle?: string; slides: DeckSlide[]; rtl?: boolean }

export interface Theme {
  label: string;
  bg: string;          // slide background
  primary: string;     // title color, bars, cover background
  accent: string;      // decorative shapes, underline
  soft: string;        // card fill
  text: string;        // body text
  muted: string;       // footer text
  onPrimary: string;   // text on primary background
  coverBg?: string;    // cover / closing / split panel background (default: primary)
  onCover?: string;    // text on coverBg (default: onPrimary)
  headFont: string;
  bodyFont: string;
}

export const THEMES: Record<string, Theme> = {
  classic: {
    label: "Classic Blue", bg: "FFFFFF", primary: "1E3A8A", accent: "3B82F6", soft: "EFF6FF",
    text: "1F2937", muted: "6B7280", onPrimary: "FFFFFF", headFont: "Segoe UI Semibold", bodyFont: "Segoe UI",
  },
  nature: {
    label: "Nature Green", bg: "F7FBF4", primary: "166534", accent: "4ADE80", soft: "DCFCE7",
    text: "1A2E1A", muted: "4D7C0F", onPrimary: "FFFFFF", headFont: "Trebuchet MS", bodyFont: "Trebuchet MS",
  },
  sunset: {
    label: "Sunset", bg: "FFF7ED", primary: "C2410C", accent: "F59E0B", soft: "FFEDD5",
    text: "431407", muted: "9A3412", onPrimary: "FFFFFF", headFont: "Georgia", bodyFont: "Calibri",
  },
  dark: {
    label: "Dark Modern", bg: "0F172A", primary: "38BDF8", accent: "A78BFA", soft: "1E293B",
    text: "E2E8F0", muted: "94A3B8", onPrimary: "0F172A", coverBg: "020617", onCover: "F8FAFC", headFont: "Segoe UI Semibold", bodyFont: "Segoe UI",
  },
  playful: {
    label: "Kids Playful", bg: "FFFBEB", primary: "7C3AED", accent: "EC4899", soft: "FCE7F3",
    text: "3B0764", muted: "7E22CE", onPrimary: "FFFFFF", headFont: "Comic Sans MS", bodyFont: "Comic Sans MS",
  },
};

export const DEFAULT_THEME = "classic";

const W = 13.333;
const H = 7.5;

// Smaller font when there is more text, so bullets stay inside their box.
function bodySize(bullets: string[], base: number): number {
  const chars = bullets.reduce((n, b) => n + b.length, 0);
  if (chars > 420) return base - 6;
  if (chars > 300) return base - 4;
  if (chars > 200) return base - 2;
  return base;
}

// deno-lint-ignore no-explicit-any
export async function buildThemedPptx(PptxCtor: any, deck: DeckInput, themeKey = DEFAULT_THEME): Promise<Uint8Array> {
  const t = THEMES[themeKey] ?? THEMES[DEFAULT_THEME];
  const pptx = new PptxCtor();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = deck.title;
  const S = pptx.ShapeType;
  const align = deck.rtl ? "right" : "left";
  const rtl = deck.rtl ? { rtlMode: true } : {};
  const total = deck.slides.length + 2;
  const coverBg = t.coverBg ?? t.primary;
  // Underline bar sits at the start of its text box: left for LTR, right for RTL.
  const barX = (boxX: number, boxW: number, barW: number) => (deck.rtl ? boxX + boxW - barW : boxX);
  const onCover = t.onCover ?? t.onPrimary;

  // deno-lint-ignore no-explicit-any
  const footer = (slide: any, n: number, onDark = false) => {
    slide.addText(deck.title, {
      x: 0.6, y: H - 0.55, w: 8, h: 0.35, fontSize: 10, fontFace: t.bodyFont,
      color: onDark ? onCover : t.muted, ...rtl,
    });
    slide.addShape(S.ellipse, { x: W - 1.05, y: H - 0.68, w: 0.5, h: 0.5, fill: { color: t.accent } });
    slide.addText(String(n), {
      x: W - 1.05, y: H - 0.68, w: 0.5, h: 0.5, fontSize: 11, bold: true, align: "center", valign: "middle",
      fontFace: t.bodyFont, color: "FFFFFF",
    });
  };

  // ---- Cover ----
  const cover = pptx.addSlide();
  cover.background = { color: coverBg };
  cover.addShape(S.ellipse, { x: W - 4.2, y: -1.6, w: 5.5, h: 5.5, fill: { color: t.accent, transparency: 55 } });
  cover.addShape(S.ellipse, { x: -1.4, y: H - 2.6, w: 3.8, h: 3.8, fill: { color: t.accent, transparency: 70 } });
  cover.addShape(S.rect, { x: barX(0.9, W - 3.5, 1.6), y: 4.35, w: 1.6, h: 0.08, fill: { color: t.accent } });
  cover.addText(deck.title, {
    x: 0.9, y: 2.0, w: W - 3.5, h: 2.2, fontSize: 44, bold: true, fontFace: t.headFont,
    color: onCover, valign: "bottom", align, ...rtl,
  });
  if (deck.subtitle) {
    cover.addText(deck.subtitle, {
      x: 0.9, y: 4.6, w: W - 3.5, h: 0.7, fontSize: 20, fontFace: t.bodyFont, color: onCover, align, ...rtl,
    });
  }

  // ---- Content slides: standard / split / cards ----
  deck.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: t.bg };
    const n = i + 2;
    const shortList = s.bullets.length >= 2 && s.bullets.length <= 3 && s.bullets.every((b) => b.length <= 110);

    if (shortList && i % 2 === 0) {
      // Cards: one rounded card per bullet with a number badge.
      slide.addText(s.title, {
        x: 0.6, y: 0.45, w: W - 1.2, h: 0.9, fontSize: 32, bold: true, fontFace: t.headFont, color: t.primary, align, ...rtl,
      });
      slide.addShape(S.rect, { x: barX(0.6, W - 1.2, 1.2), y: 1.38, w: 1.2, h: 0.07, fill: { color: t.accent } });
      const gap = 0.4;
      const cw = (W - 1.2 - gap * (s.bullets.length - 1)) / s.bullets.length;
      s.bullets.forEach((b, j) => {
        const x = 0.6 + j * (cw + gap);
        slide.addShape(S.roundRect, {
          x, y: 2.0, w: cw, h: 3.7, rectRadius: 0.15, fill: { color: t.soft }, line: { color: t.accent, width: 1.5 },
        });
        slide.addShape(S.ellipse, { x: x + 0.35, y: 2.35, w: 0.8, h: 0.8, fill: { color: t.primary } });
        slide.addText(String(j + 1), {
          x: x + 0.35, y: 2.35, w: 0.8, h: 0.8, fontSize: 22, bold: true, align: "center", valign: "middle",
          fontFace: t.headFont, color: t.onPrimary,
        });
        slide.addText(b, {
          x: x + 0.3, y: 3.35, w: cw - 0.6, h: 2.2, fontSize: 22, fontFace: t.bodyFont, color: t.text,
          valign: "top", align, ...rtl,
        });
      });
    } else if (i % 3 === 1) {
      // Split: coloured title panel on the left, bullets on the right.
      slide.addShape(S.rect, { x: 0, y: 0, w: 4.6, h: H, fill: { color: coverBg } });
      slide.addShape(S.ellipse, { x: -1.2, y: H - 2.4, w: 3.2, h: 3.2, fill: { color: t.accent, transparency: 60 } });
      slide.addShape(S.rect, { x: barX(0.5, 3.7, 1.2), y: 4.9, w: 1.2, h: 0.07, fill: { color: t.accent } });
      slide.addText(s.title, {
        x: 0.5, y: 1.2, w: 3.7, h: 3.6, fontSize: 30, bold: true, fontFace: t.headFont, color: onCover,
        valign: "bottom", align, ...rtl,
      });
      slide.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: { code: "25CF" }, breakLine: true } })),
        {
          x: 5.2, y: 1.0, w: W - 5.9, h: 5.4, fontSize: bodySize(s.bullets, 22), fontFace: t.bodyFont, color: t.text,
          valign: "middle", paraSpaceAfter: 14, align, ...rtl,
        },
      );
    } else {
      // Standard: accent bar on the left, title + underline, bullets.
      slide.addShape(S.rect, { x: 0, y: 0, w: 0.25, h: H, fill: { color: t.primary } });
      slide.addShape(S.ellipse, { x: W - 2.0, y: -1.0, w: 2.8, h: 2.8, fill: { color: t.accent, transparency: 75 } });
      slide.addText(s.title, {
        x: 0.8, y: 0.45, w: W - 3.2, h: 0.9, fontSize: 32, bold: true, fontFace: t.headFont, color: t.primary, align, ...rtl,
      });
      slide.addShape(S.rect, { x: barX(0.8, W - 3.2, 1.2), y: 1.38, w: 1.2, h: 0.07, fill: { color: t.accent } });
      slide.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: { code: "25CF" }, breakLine: true } })),
        {
          x: 0.9, y: 1.8, w: W - 2.0, h: 4.8, fontSize: bodySize(s.bullets, 24), fontFace: t.bodyFont, color: t.text,
          valign: "top", paraSpaceAfter: 12, align, ...rtl,
        },
      );
    }
    footer(slide, n, !shortList && i % 3 === 1);
    if (s.speaker_notes) slide.addNotes(s.speaker_notes);
  });

  // ---- Closing ----
  const end = pptx.addSlide();
  end.background = { color: coverBg };
  end.addShape(S.ellipse, { x: -1.5, y: -1.5, w: 4.5, h: 4.5, fill: { color: t.accent, transparency: 60 } });
  end.addShape(S.ellipse, { x: W - 3.0, y: H - 3.0, w: 4.5, h: 4.5, fill: { color: t.accent, transparency: 60 } });
  end.addText(deck.rtl ? "شكرًا لكم!" : "Thank you!", {
    x: 0, y: 2.4, w: W, h: 1.4, fontSize: 48, bold: true, align: "center", fontFace: t.headFont, color: onCover, ...rtl,
  });
  end.addText(deck.rtl ? "هل لديكم أسئلة؟" : "Any questions?", {
    x: 0, y: 3.8, w: W, h: 0.8, fontSize: 22, align: "center", fontFace: t.bodyFont, color: onCover, ...rtl,
  });
  footer(end, total, true);

  return (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
}
