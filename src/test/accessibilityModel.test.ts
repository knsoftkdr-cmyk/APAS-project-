import { describe, it, expect } from "vitest";
import {
  DEFAULT_PREFS, accessibilityDirective, clampTextScale, sanitizePrefs, suggestFromAccommodations,
} from "../../supabase/functions/_shared/accessibilityModel";

describe("clampTextScale", () => {
  it("clamps to 100-200 and snaps to steps of 10", () => {
    expect(clampTextScale(50)).toBe(100);
    expect(clampTextScale(999)).toBe(200);
    expect(clampTextScale(134)).toBe(130);
    expect(clampTextScale(135)).toBe(140);
  });
  it("falls back to 100 for junk", () => {
    expect(clampTextScale("abc")).toBe(100);
    expect(clampTextScale(undefined)).toBe(100);
    expect(clampTextScale(NaN)).toBe(100);
  });
});

describe("sanitizePrefs", () => {
  it("returns defaults for non-objects", () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs("x")).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs([1, 2])).toEqual(DEFAULT_PREFS);
  });
  it("only honours literal true, drops unknown keys", () => {
    const out = sanitizePrefs({ dyslexiaMode: "yes", screenReaderMode: true, evil: true, textScale: 150 });
    expect(out).toEqual({ ...DEFAULT_PREFS, screenReaderMode: true, textScale: 150 });
    expect(Object.keys(out).sort()).toEqual(Object.keys(DEFAULT_PREFS).sort());
  });
  it("merges a partial update over a base", () => {
    const base = { ...DEFAULT_PREFS, screenReaderMode: true, textScale: 120 };
    expect(sanitizePrefs({ dyslexiaMode: true }, base)).toEqual({ ...base, dyslexiaMode: true });
    expect(sanitizePrefs({ screenReaderMode: false }, base).screenReaderMode).toBe(false);
  });
});

describe("suggestFromAccommodations", () => {
  it("suggests nothing for unrelated accommodations", () => {
    const s = suggestFromAccommodations([
      { accommodation_type: "Extra reading time", description: "25% more time" },
      { accommodation_type: "Scribe / reader", description: null },
    ]);
    expect(s.settings).toEqual({});
    expect(s.reasons).toEqual([]);
  });
  it("maps dyslexia, large print and screen reader", () => {
    const s = suggestFromAccommodations([
      { accommodation_type: "Dyslexia-friendly materials" },
      { accommodation_type: "Large print worksheets" },
      { accommodation_type: "Text-to-speech software" },
    ]);
    expect(s.settings).toEqual({ dyslexiaMode: true, textScale: 140, screenReaderMode: true });
    expect(s.reasons).toHaveLength(3);
  });
  it("handles null/empty input", () => {
    expect(suggestFromAccommodations(null).settings).toEqual({});
    expect(suggestFromAccommodations([]).reasons).toEqual([]);
  });
});

describe("accessibilityDirective", () => {
  it("is empty (prompt unchanged) when nothing is on", () => {
    expect(accessibilityDirective(undefined)).toBe("");
    expect(accessibilityDirective({})).toBe("");
    expect(accessibilityDirective({ dyslexia: "true", screen_reader: 1 })).toBe("");
    expect(accessibilityDirective([true])).toBe("");
  });
  it("adds dyslexia guidance", () => {
    const d = accessibilityDirective({ dyslexia: true });
    expect(d).toContain("DYSLEXIA-FRIENDLY");
    expect(d).not.toContain("SCREEN-READER");
  });
  it("adds screen reader guidance", () => {
    const d = accessibilityDirective({ screen_reader: true });
    expect(d).toContain("SCREEN-READER");
    expect(d).toContain("No emojis");
  });
  it("combines both", () => {
    const d = accessibilityDirective({ dyslexia: true, screen_reader: true });
    expect(d).toContain("DYSLEXIA-FRIENDLY");
    expect(d).toContain("SCREEN-READER");
  });
});
