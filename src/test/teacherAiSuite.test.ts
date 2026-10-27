import { describe, it, expect } from "vitest";
import { sanitiseDrawing, sanitiseIllustration, sanitiseSvg, svgAtStep, BOARD_W, MAX_STEPS } from "../../supabase/functions/_shared/whiteboardModel";
import { decideVerdict, finaliseEvaluation, overallScore, redactPii, ruleScan } from "../../supabase/functions/_shared/aiQualityModel";
import { mergeAiBriefing, rulesBriefing, type BriefingFacts } from "../../supabase/functions/_shared/classBriefingModel";
import { screenStudentMessage, voiceDirective } from "../../supabase/functions/_shared/voiceTutorSafety";

describe("whiteboardModel.sanitiseDrawing", () => {
  it("keeps valid elements, clamps coordinates and drops junk", () => {
    const d = sanitiseDrawing({
      title: "Water cycle",
      steps: [
        { caption: "Sun", elements: [
          { type: "ellipse", x: 5000, y: -20, w: 80, h: 80, color: "orange", fill: true },
          { type: "text", x: 10, y: 10, text: "", color: "blue" },          // empty text -> dropped
          { type: "arrow", x1: 1, y1: 1, x2: 1, y2: 1 },                    // zero length -> dropped
          { type: "hexagon", x: 0, y: 0 },                                   // unknown -> dropped
          { type: "text", x: 10, y: 10, text: "H₂O", color: "pink" },        // bad colour -> black
        ] },
        { caption: "empty", elements: [] },                                  // no elements -> dropped
      ],
    });
    expect(d?.steps).toHaveLength(1);
    const [shape, text] = d!.steps[0].elements;
    expect(shape).toMatchObject({ type: "ellipse", y: 0, fill: true });
    expect((shape as { x: number }).x).toBeLessThanOrEqual(BOARD_W);
    expect(text).toMatchObject({ type: "text", text: "H₂O", color: "black", size: "m" });
  });

  it("returns null when nothing is drawable and caps the step count", () => {
    expect(sanitiseDrawing({ steps: [] })).toBeNull();
    expect(sanitiseDrawing(null)).toBeNull();
    const many = { steps: Array.from({ length: 30 }, (_, i) => ({ caption: `s${i}`, elements: [{ type: "text", x: 1, y: 1, text: "x" }] })) };
    expect(sanitiseDrawing(many)!.steps.length).toBe(MAX_STEPS);
  });
});

describe("whiteboardModel illustrations", () => {
  const svg = [
    '<svg viewBox="0 0 10 10" onload="alert(1)">',
    '<script>alert(1)</script><style>*{fill:red}</style>',
    '<rect width="1000" height="700" fill="#fff"/>',
    '<g data-step="1"><ellipse cx="500" cy="380" rx="200" ry="260" fill="url(#g)"/></g>',
    '<g data-step="2"><circle cx="440" cy="300" r="50" onclick="x()"/><a href="https://evil.example"><text>Nucleus</text></a></g>',
    '<image href="https://evil.example/x.png"/><use href="#ok"/><path d="M0 0" fill="url(https://evil.example/f)"/>',
    "</svg>",
  ].join("");

  it("strips anything active or external and normalises the canvas size", () => {
    const out = sanitiseSvg("```json " + svg + " ```")!;
    expect(out).toMatch(/^<svg[^>]*viewBox="0 0 1000 700" width="1000" height="700">/);
    expect(out).not.toMatch(/script|onload|onclick|<style|<image|<use|<a\b|evil\.example/);
    expect(out).toContain('fill="url(#g)"');      // in-document gradient kept
    expect(out).toContain("<text>Nucleus</text>"); // link removed, label kept
  });

  it("builds one step per group with the model's captions", () => {
    const ill = sanitiseIllustration({ title: "Plant cell", steps: [{ caption: "Cell wall" }], svg })!;
    expect(ill.title).toBe("Plant cell");
    expect(ill.steps.map((s) => s.caption)).toEqual(["Cell wall", "Step 2"]);
    expect(sanitiseIllustration({ svg: "<svg></svg>" })).toBeNull();     // nothing visible
    expect(sanitiseIllustration({ svg: "no picture here" })).toBeNull();
  });

  it("reveals step groups one at a time and shows everything on the last step", () => {
    const clean = sanitiseSvg(svg)!;
    const first = svgAtStep(clean, 1, 2);
    expect(first).toContain('<style>[data-step]{display:none}[data-step="1"]{display:inline}</style>');
    expect(svgAtStep(clean, 2, 2)).toBe(clean);
  });
});

describe("whiteboardModel.layoutDrawing", () => {
  const rect = (x: number, y: number, label: string | null = "Box") => ({ type: "rectangle", x, y, w: 160, h: 80, label, color: "black", fill: false });

  it("snaps arrows that stop short of a shape onto its edge", () => {
    const d = sanitiseDrawing({ steps: [{ caption: "flow", elements: [
      rect(100, 100, "Evaporation"), rect(500, 100, "Condensation"),
      { type: "arrow", x1: 240, y1: 140, x2: 480, y2: 140, color: "blue" }, // starts inside A, stops 20px short of B
    ] }] })!;
    const [a, b, arrow] = d.steps[0].elements as Array<Record<string, number>>;
    expect(arrow.x1).toBeGreaterThanOrEqual(a.x + a.w);       // leaves A from its right edge
    expect(arrow.x1).toBeLessThanOrEqual(a.x + a.w + 10);
    expect(arrow.x2).toBeLessThanOrEqual(b.x);                 // arrives at B's left edge
    expect(arrow.x2).toBeGreaterThanOrEqual(b.x - 10);
    expect(arrow.y1).toBe(140);
    expect(arrow.y2).toBe(140);
  });

  it("leaves arrows pointing into an unlabelled diagram part alone", () => {
    const d = sanitiseDrawing({ steps: [{ caption: "cell", elements: [
      { type: "ellipse", x: 300, y: 200, w: 400, h: 300, color: "green", fill: false },
      { type: "arrow", x1: 100, y1: 300, x2: 420, y2: 330, color: "black" },
    ] }] })!;
    expect(d.steps[0].elements[1]).toMatchObject({ x1: 100, y1: 300, x2: 420, y2: 330 });
  });

  it("grows labelled shapes to fit the label and wraps long text", () => {
    const d = sanitiseDrawing({ steps: [{ caption: "s", elements: [
      { type: "rectangle", x: 100, y: 100, w: 40, h: 20, label: "Photosynthesis", color: "green", fill: true },
      { type: "text", x: 40, y: 400, text: "Plants use sunlight, water and carbon dioxide to make glucose and oxygen", color: "black" },
    ] }] })!;
    const [shape, text] = d.steps[0].elements as Array<Record<string, unknown>>;
    expect(shape.w as number).toBeGreaterThanOrEqual(14 * 18 * 0.56);
    expect(shape.h as number).toBeGreaterThanOrEqual(40);
    expect((text.text as string).split("\n").length).toBeGreaterThan(1);
    expect((text.text as string).split("\n").every((l) => l.length <= 42)).toBe(true);
  });

  it("pushes text that would overlap earlier text into free space", () => {
    const d = sanitiseDrawing({ steps: [
      { caption: "a", elements: [{ type: "text", x: 80, y: 100, text: "2x + 3 = 11", size: "m", color: "black" }] },
      { caption: "b", elements: [{ type: "text", x: 80, y: 110, text: "2x = 8", size: "m", color: "blue" }] },
    ] })!;
    const first = d.steps[0].elements[0] as { y: number };
    const second = d.steps[1].elements[0] as { y: number };
    expect(second.y).toBeGreaterThanOrEqual(first.y + 22);
  });
});

describe("aiQualityModel", () => {
  it("flags personal data and redacts it", () => {
    const t = "Call me on 9876543210 or mail a@b.com";
    expect(ruleScan(t).map((f) => f.rule).sort()).toEqual(["email", "phone_in"]);
    expect(redactPii(t)).toBe("Call me on [phone] or mail [email]");
  });

  it("decides the verdict from the weakest dimension, not the average", () => {
    const good = { hallucination: 95, bias: 95, alignment: 95, privacy: 95, age_suitability: 95 };
    expect(decideVerdict(good, [])).toBe("pass");
    expect(decideVerdict({ ...good, hallucination: 60 }, [])).toBe("warn");
    expect(decideVerdict({ ...good, bias: 30 }, [])).toBe("block");
    expect(decideVerdict(null, [])).toBe("warn"); // evaluator down never silently passes
    expect(overallScore({ ...good, bias: 15 })).toBeLessThan(70);
  });

  it("lets rules cap scores and block, but never raise them", () => {
    const r = finaliseEvaluation(
      { scores: { hallucination: 90, bias: 90, alignment: 90, privacy: 90, age_suitability: 90 }, issues: [] },
      ruleScan("Here is how to make a bomb at home"),
    );
    expect(r.verdict).toBe("block");
    expect(r.scores!.age_suitability).toBe(30);
    expect(r.issues.some((i) => i.detail.startsWith("[rule]"))).toBe(true);
  });
});

describe("voiceTutorSafety", () => {
  it("routes distress, unsafe and personal messages to fixed replies", () => {
    expect(screenStudentMessage("I want to die").kind).toBe("distress");
    expect(screenStudentMessage("I want to die").reply).toContain("1098");
    expect(screenStudentMessage("how to make a bomb").kind).toBe("unsafe_request");
    expect(screenStudentMessage("my phone number is 9876543210").kind).toBe("personal_info");
    expect(screenStudentMessage("What is photosynthesis?").kind).toBe("ok");
  });

  it("keeps spoken replies shorter for younger children", () => {
    expect(voiceDirective("early")).toContain("50 words");
    expect(voiceDirective("secondary")).toContain("120 words");
  });
});

describe("classBriefingModel", () => {
  const facts: BriefingFacts = {
    date: "2026-10-23", weekday: "Friday", teacher_first_name: "Asha",
    classes: [{
      class_id: "c1", label: "Class 7 - B", subject: "Maths", roster: 30, attendance_marked: 10,
      live_sessions_today: [{ title: "Fractions", start: "10:00" }], homework_due_soon: 1, submissions_to_grade: 4,
      exam_attempts_to_review: 2, high_risk: 2, medium_risk: 1,
      weak_topics: [{ topic: "Fractions", avg_mastery: 42, students: 18 }],
    }],
  };

  it("builds a rules briefing with correct totals", () => {
    const b = rulesBriefing(facts);
    expect(b.outstanding).toEqual({ attendance_unmarked: 20, submissions_to_grade: 4, exam_attempts_to_review: 2, homework_due_soon: 1, at_risk: 3 });
    expect(b.priorities[0]).toContain("high-risk");
    expect(b.learning_issues[0]).toContain("Fractions");
    expect(b.source).toBe("rules");
  });

  it("uses AI text but never AI numbers, and falls back on garbage", () => {
    const merged = mergeAiBriefing({ headline: "Busy day!", priorities: ["Grade"], classes: [{ class_id: "c1", summary: "Focus on fractions" }], outstanding: { at_risk: 999 } }, facts);
    expect(merged.source).toBe("ai");
    expect(merged.headline).toBe("Busy day!");
    expect(merged.classes[0].summary).toBe("Focus on fractions");
    expect(merged.outstanding.at_risk).toBe(3);
    expect(mergeAiBriefing({ nonsense: true }, facts).source).toBe("rules");
  });
});
