// supabase/functions/_shared/accessibilityModel.ts
//
// Pure helpers for the Accessibility Engine (no I/O, unit-tested in src/test/accessibilityModel.test.ts).
//
//  - sanitizePrefs()              validate/normalise a preferences object coming from a client
//  - suggestFromAccommodations()  turn a student's approved SEN accommodations into SUGGESTED settings
//  - accessibilityDirective()     extra system-prompt text for the AI assistants (dyslexia / screen reader)
//
// Keep the shape in sync with src/lib/accessibility.ts (the frontend mirror of these rules).

export interface AccessibilityPrefs {
  dyslexiaMode: boolean;
  screenReaderMode: boolean;
  keyboardNavigation: boolean;
  /** Text size as a percentage of the default (100 = normal). */
  textScale: number;
}

export const TEXT_SCALE_MIN = 100;
export const TEXT_SCALE_MAX = 200;
export const TEXT_SCALE_STEP = 10;

export const DEFAULT_PREFS: AccessibilityPrefs = {
  dyslexiaMode: false,
  screenReaderMode: false,
  keyboardNavigation: false,
  textScale: 100,
};

export function clampTextScale(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_PREFS.textScale;
  const stepped = Math.round(n / TEXT_SCALE_STEP) * TEXT_SCALE_STEP;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, stepped));
}

/** Only literal `true` turns a switch on; unknown keys are dropped; missing keys fall back to `base`. */
export function sanitizePrefs(input: unknown, base: AccessibilityPrefs = DEFAULT_PREFS): AccessibilityPrefs {
  const src = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const flag = (k: keyof AccessibilityPrefs): boolean =>
    Object.prototype.hasOwnProperty.call(src, k) ? src[k] === true : (base[k] as boolean);
  return {
    dyslexiaMode: flag("dyslexiaMode"),
    screenReaderMode: flag("screenReaderMode"),
    keyboardNavigation: flag("keyboardNavigation"),
    textScale: Object.prototype.hasOwnProperty.call(src, "textScale") ? clampTextScale(src.textScale) : base.textScale,
  };
}

export interface AccommodationRow {
  accommodation_type?: string | null;
  description?: string | null;
}

export interface Suggestion {
  settings: Partial<AccessibilityPrefs>;
  /** Plain-language reasons shown to the student, e.g. "Dyslexia-friendly materials". */
  reasons: string[];
}

// Deliberately narrow keywords: "extra reading time" or "scribe/reader" must NOT trigger anything.
const RULES: { test: RegExp; settings: Partial<AccessibilityPrefs> }[] = [
  { test: /dyslex|opendyslexic/i, settings: { dyslexiaMode: true } },
  { test: /large[\s-]?(print|text|font)|enlarged|magnif/i, settings: { textScale: 140 } },
  { test: /screen[\s-]?reader|text[\s-]?to[\s-]?speech|\btts\b|read[\s-]?aloud|\bjaws\b|\bnvda\b|voiceover/i, settings: { screenReaderMode: true } },
  { test: /keyboard[\s-]?(only|navigation|access)|switch access/i, settings: { keyboardNavigation: true } },
];

export function suggestFromAccommodations(rows: AccommodationRow[] | null | undefined): Suggestion {
  const settings: Partial<AccessibilityPrefs> = {};
  const reasons: string[] = [];
  for (const row of rows ?? []) {
    const text = `${row?.accommodation_type ?? ""} ${row?.description ?? ""}`;
    for (const rule of RULES) {
      if (!rule.test.test(text)) continue;
      Object.assign(settings, rule.settings);
      const label = (row?.accommodation_type ?? "").trim();
      if (label && !reasons.includes(label)) reasons.push(label);
    }
  }
  return { settings, reasons };
}

/**
 * Extra system-prompt text for the AI assistants. Takes the loose `{ dyslexia, screen_reader }` flags the
 * frontend sends. Returns "" when neither is set, so the prompt is byte-for-byte unchanged for everyone else.
 */
export function accessibilityDirective(flags: unknown): string {
  const f = flags && typeof flags === "object" && !Array.isArray(flags) ? (flags as Record<string, unknown>) : {};
  const parts: string[] = [];

  if (f.dyslexia === true) {
    parts.push(
      `DYSLEXIA-FRIENDLY WRITING (the student turned this on; it overrides any length or style guideline above):
- Use short sentences (about 12 words or fewer) and common, everyday words. One idea per sentence.
- Keep paragraphs to 2-3 short lines. Put a blank line between ideas.
- Explain any hard or new word in brackets right after it the first time you use it.
- Prefer numbered steps ("1.", "2.") over long paragraphs. Avoid idioms, sarcasm and metaphors.
- Do not use ALL CAPS, long italic passages or dense tables.`,
    );
  }

  if (f.screen_reader === true) {
    parts.push(
      `SCREEN-READER-FRIENDLY WRITING (the student uses a screen reader or read-aloud; it overrides any formatting guideline above):
- Plain text only. No emojis, no emoticons, no decorative symbols, no ASCII art, no tables.
- Do not rely on bold, colour or position to carry meaning. Say it in words.
- Write maths and symbols in words the first time (for example "x squared", "5 divided by 2", "greater than or equal to").
- Present steps as full sentences that start with "Step 1.", "Step 2.", and so on.
- Describe any diagram or picture you mention in a sentence instead of pointing at it.`,
    );
  }

  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}
