import { describe, it, expect } from "vitest";
import { sanitiseDrawing, BOARD_W, MAX_STEPS } from "../../supabase/functions/_shared/whiteboardModel";
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
