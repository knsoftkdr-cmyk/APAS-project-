import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import {
  DEFAULT_PREFS, applyPrefsToDocument, getAiAccessibilityFlags, isDefaultPrefs, loadLocalPrefs, sanitizePartial,
  sanitizePrefs, saveLocalPrefs,
} from "@/lib/accessibility";

const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  root.className = "";
  root.removeAttribute("style");
  document.getElementById("apas-a11y-dyslexia-font")?.remove();
});

describe("applyPrefsToDocument", () => {
  it("toggles the mode classes", () => {
    applyPrefsToDocument({ ...DEFAULT_PREFS, dyslexiaMode: true, screenReaderMode: true, keyboardNavigation: true });
    for (const c of ["a11y-dyslexia", "a11y-screenreader", "a11y-keyboard"]) expect(root.classList.contains(c)).toBe(true);
    applyPrefsToDocument(DEFAULT_PREFS);
    for (const c of ["a11y-dyslexia", "a11y-screenreader", "a11y-keyboard", "a11y-scaled"]) expect(root.classList.contains(c)).toBe(false);
  });
  it("scales the root font size and layout variable, and clears them at 100%", () => {
    applyPrefsToDocument({ ...DEFAULT_PREFS, textScale: 150 });
    expect(root.style.fontSize).toBe("150%");
    expect(root.style.getPropertyValue("--a11y-scale")).toBe("1.5");
    expect(root.classList.contains("a11y-scaled")).toBe(true);
    applyPrefsToDocument(DEFAULT_PREFS);
    expect(root.style.fontSize).toBe("");
    expect(root.style.getPropertyValue("--a11y-scale")).toBe("");
  });
  it("only loads the dyslexia font when the mode is on, and only once", () => {
    applyPrefsToDocument(DEFAULT_PREFS);
    expect(document.getElementById("apas-a11y-dyslexia-font")).toBeNull();
    applyPrefsToDocument({ ...DEFAULT_PREFS, dyslexiaMode: true });
    applyPrefsToDocument({ ...DEFAULT_PREFS, dyslexiaMode: true });
    expect(document.querySelectorAll("#apas-a11y-dyslexia-font")).toHaveLength(1);
  });
});

describe("device cache", () => {
  it("round-trips and sanitises", () => {
    saveLocalPrefs({ ...DEFAULT_PREFS, dyslexiaMode: true, textScale: 130 });
    expect(loadLocalPrefs()).toEqual({ ...DEFAULT_PREFS, dyslexiaMode: true, textScale: 130 });
  });
  it("survives corrupt storage", () => {
    localStorage.setItem("apas.a11y.v1", "{not json");
    expect(loadLocalPrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem("apas.a11y.v1", JSON.stringify({ textScale: 9000, dyslexiaMode: "x" }));
    expect(loadLocalPrefs()).toEqual({ ...DEFAULT_PREFS, textScale: 200 });
  });
});

describe("AI flags", () => {
  it("is undefined when nothing relevant is on (requests unchanged)", () => {
    expect(getAiAccessibilityFlags()).toBeUndefined();
    saveLocalPrefs({ ...DEFAULT_PREFS, textScale: 150 });
    expect(getAiAccessibilityFlags()).toBeUndefined();
  });
  it("reports dyslexia and screen reader mode", () => {
    saveLocalPrefs({ ...DEFAULT_PREFS, dyslexiaMode: true, screenReaderMode: true });
    expect(getAiAccessibilityFlags()).toEqual({ dyslexia: true, screen_reader: true });
  });
});

describe("helpers", () => {
  it("isDefaultPrefs", () => {
    expect(isDefaultPrefs(DEFAULT_PREFS)).toBe(true);
    expect(isDefaultPrefs(sanitizePrefs({ textScale: 110 }))).toBe(false);
  });
  it("sanitizePartial keeps only true flags + clamped scale", () => {
    expect(sanitizePartial({ dyslexiaMode: true, screenReaderMode: false, textScale: 999, x: 1 })).toEqual({ dyslexiaMode: true, textScale: 200 });
    expect(sanitizePartial(null)).toEqual({});
  });
});
