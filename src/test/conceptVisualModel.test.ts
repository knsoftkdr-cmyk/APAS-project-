import { describe, it, expect } from "vitest";
import {
  sanitizeConcept,
  sanitizeGrade,
  buildPrompt,
  parseVisualResponse,
  MAX_STEPS,
} from "../../supabase/functions/_shared/conceptVisualModel";

const good = {
  title: "Photosynthesis",
  summary: "Plants make food using sunlight.",
  steps: [
    { label: "Take in light", detail: "Leaves catch sunlight." },
    { label: "Absorb water", detail: "Roots pull water from soil." },
    { label: "Make food", detail: "Plant makes glucose and oxygen." },
  ],
  parts: [{ name: "Chlorophyll", role: "Green pigment that catches light." }],
  analogy: "A leaf is like a tiny solar kitchen.",
  check_question: "What does the plant need to make food?",
};

describe("sanitizeConcept", () => {
  it("accepts a normal concept and tidies spaces", () => {
    expect(sanitizeConcept("  Water   cycle ")).toBe("Water cycle");
  });
  it("rejects non-text, too short, too long and symbol-only input", () => {
    expect(sanitizeConcept(42)).toBeNull();
    expect(sanitizeConcept("a")).toBeNull();
    expect(sanitizeConcept("x".repeat(81))).toBeNull();
    expect(sanitizeConcept("1234 !!!")).toBeNull();
  });
  it("removes characters used for tricks", () => {
    expect(sanitizeConcept('Gravity <script>"{}')).toBe("Gravity script");
  });
});

describe("sanitizeGrade", () => {
  it("keeps simple class labels", () => {
    expect(sanitizeGrade("Class 6 A")).toBe("Class 6 A");
    expect(sanitizeGrade("10th")).toBe("10th");
  });
  it("drops odd values", () => {
    expect(sanitizeGrade("")).toBeNull();
    expect(sanitizeGrade("6; drop table")).toBeNull();
    expect(sanitizeGrade(5)).toBeNull();
  });
});

describe("buildPrompt", () => {
  it("puts the concept inside markers and mentions the class", () => {
    const p = buildPrompt("Photosynthesis", "6");
    expect(p).toContain("<<<TOPIC\nPhotosynthesis\nTOPIC>>>");
    expect(p).toContain('"6"');
  });
});

describe("parseVisualResponse", () => {
  it("parses clean JSON", () => {
    const r = parseVisualResponse(JSON.stringify(good));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.visual.steps).toHaveLength(3);
      expect(r.visual.parts[0].name).toBe("Chlorophyll");
    }
  });
  it("parses JSON wrapped in code fences", () => {
    const r = parseVisualResponse("```json\n" + JSON.stringify(good) + "\n```");
    expect(r.ok).toBe(true);
  });
  it("reports a refusal", () => {
    expect(parseVisualResponse('{"refused": true}')).toEqual({ ok: false, reason: "refused" });
  });
  it("rejects broken JSON, too few steps and missing summary", () => {
    expect(parseVisualResponse("not json")).toEqual({ ok: false, reason: "invalid" });
    expect(parseVisualResponse(JSON.stringify({ ...good, steps: good.steps.slice(0, 2) })).ok).toBe(false);
    expect(parseVisualResponse(JSON.stringify({ ...good, summary: "" })).ok).toBe(false);
  });
  it("removes HTML and links from AI text", () => {
    const dirty = { ...good, summary: "Plants <b>eat</b> light https://evil.example/x ok" };
    const r = parseVisualResponse(JSON.stringify(dirty));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.visual.summary).not.toContain("<");
      expect(r.visual.summary).not.toContain("http");
    }
  });
  it("caps the number of steps", () => {
    const many = { ...good, steps: Array.from({ length: 10 }, (_, i) => ({ label: `S${i}`, detail: `D${i}` })) };
    const r = parseVisualResponse(JSON.stringify(many));
    expect(r.ok && r.visual.steps.length).toBe(MAX_STEPS);
  });
  it("uses the fallback title when the AI gives none", () => {
    const r = parseVisualResponse(JSON.stringify({ ...good, title: "" }), "Photosynthesis");
    expect(r.ok && r.visual.title).toBe("Photosynthesis");
  });
});
