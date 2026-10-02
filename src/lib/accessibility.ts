import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

// Accessibility Engine - preferences, how they are applied to the page, and how they are saved.
//
// Persistence goes through the already-deployed `get-mastery-history` function (actions
// "accessibility_get" / "accessibility_save"; no new edge function). A copy is also cached in localStorage so
// the page is accessible from the very first paint (and on the login screen, before anyone is signed in).
//
// Keep the shape and clamping rules in sync with supabase/functions/_shared/accessibilityModel.ts.

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

const STORAGE_KEY = "apas.a11y.v1";
const FONT_LINK_ID = "apas-a11y-dyslexia-font";
const DYSLEXIA_FONT_URL = "https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&display=swap";

export function clampTextScale(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_PREFS.textScale;
  const stepped = Math.round(n / TEXT_SCALE_STEP) * TEXT_SCALE_STEP;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, stepped));
}

export function sanitizePrefs(input: unknown, base: AccessibilityPrefs = DEFAULT_PREFS): AccessibilityPrefs {
  const src = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(src, k);
  const flag = (k: keyof AccessibilityPrefs) => (has(k) ? src[k] === true : (base[k] as boolean));
  return {
    dyslexiaMode: flag("dyslexiaMode"),
    screenReaderMode: flag("screenReaderMode"),
    keyboardNavigation: flag("keyboardNavigation"),
    textScale: has("textScale") ? clampTextScale(src.textScale) : base.textScale,
  };
}

export function prefsEqual(a: AccessibilityPrefs, b: AccessibilityPrefs): boolean {
  return (
    a.dyslexiaMode === b.dyslexiaMode &&
    a.screenReaderMode === b.screenReaderMode &&
    a.keyboardNavigation === b.keyboardNavigation &&
    a.textScale === b.textScale
  );
}

export const isDefaultPrefs = (p: AccessibilityPrefs) => prefsEqual(p, DEFAULT_PREFS);

// ── device cache ────────────────────────────────────────────────────────────────────────────────
export function loadLocalPrefs(): AccessibilityPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizePrefs(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveLocalPrefs(p: AccessibilityPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* private mode / storage full: the settings still apply for this session */
  }
}

// ── applying to the page ────────────────────────────────────────────────────────────────────────
/** Toggles the classes + root font size that src/index.css keys off. Safe to call repeatedly. */
export function applyPrefsToDocument(p: AccessibilityPrefs, doc: Document = document): void {
  const root = doc.documentElement;
  root.classList.toggle("a11y-dyslexia", p.dyslexiaMode);
  root.classList.toggle("a11y-screenreader", p.screenReaderMode);
  root.classList.toggle("a11y-keyboard", p.keyboardNavigation);
  // Everything in the app is sized in rem, so scaling the root scales the whole interface.
  root.style.fontSize = p.textScale === 100 ? "" : `${p.textScale}%`;
  // The sidebar/header widths are fixed px, so index.css scales them by the same factor (see .a11y-scaled).
  root.classList.toggle("a11y-scaled", p.textScale > 100);
  if (p.textScale > 100) root.style.setProperty("--a11y-scale", String(p.textScale / 100));
  else root.style.removeProperty("--a11y-scale");

  // The dyslexia-friendly font is only downloaded for people who turn the mode on.
  const existing = doc.getElementById(FONT_LINK_ID);
  if (p.dyslexiaMode && !existing) {
    const link = doc.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href = DYSLEXIA_FONT_URL;
    doc.head.appendChild(link);
  }
}

/**
 * Flags sent along with AI assistant requests so the reply is written for the reader
 * (see accessibilityDirective in the edge functions). Returns undefined when nothing is on, so
 * requests are unchanged for everyone else.
 */
export function getAiAccessibilityFlags(): { dyslexia?: true; screen_reader?: true } | undefined {
  const p = loadLocalPrefs();
  const flags: { dyslexia?: true; screen_reader?: true } = {};
  if (p.dyslexiaMode) flags.dyslexia = true;
  if (p.screenReaderMode) flags.screen_reader = true;
  return Object.keys(flags).length ? flags : undefined;
}

// ── server persistence ──────────────────────────────────────────────────────────────────────────
export interface AccessibilitySuggestion {
  settings: Partial<AccessibilityPrefs>;
  reasons: string[];
}

export interface ServerPrefsResult {
  preferences: AccessibilityPrefs | null;
  saved: boolean;
  persistence: "available" | "unavailable";
  suggestion: AccessibilitySuggestion | null;
}

export async function fetchServerPrefs(): Promise<ServerPrefsResult> {
  const { data, error } = await supabase.functions.invoke("get-mastery-history", {
    body: { action: "accessibility_get" },
  });
  if (error) throw new Error((await unwrapFunctionError(error, "Couldn't load accessibility settings.")).message);
  return {
    preferences: data?.preferences ? sanitizePrefs(data.preferences) : null,
    saved: !!data?.saved,
    persistence: data?.persistence === "unavailable" ? "unavailable" : "available",
    suggestion:
      data?.suggestion && typeof data.suggestion === "object" && Array.isArray(data.suggestion.reasons)
        ? { settings: sanitizePartial(data.suggestion.settings), reasons: data.suggestion.reasons.map(String) }
        : null,
  };
}

export async function saveServerPrefs(p: AccessibilityPrefs): Promise<void> {
  const { error } = await supabase.functions.invoke("get-mastery-history", {
    body: { action: "accessibility_save", preferences: p },
  });
  if (error) throw new Error((await unwrapFunctionError(error, "Couldn't save accessibility settings.")).message);
}

/** Keeps only the keys that are actually present (used for suggestions, which are partial). */
export function sanitizePartial(input: unknown): Partial<AccessibilityPrefs> {
  const src = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const out: Partial<AccessibilityPrefs> = {};
  for (const k of ["dyslexiaMode", "screenReaderMode", "keyboardNavigation"] as const) {
    if (src[k] === true) out[k] = true;
  }
  if ("textScale" in src) out.textScale = clampTextScale(src.textScale);
  return out;
}
