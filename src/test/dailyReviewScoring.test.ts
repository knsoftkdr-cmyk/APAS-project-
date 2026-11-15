import { describe, it, expect } from "vitest";
import {
  DEFAULT_RULES, exampleScore, formatMarks, marksFor, rulesFromRow, summarizeSession, validateRules,
  type ScoringRules,
} from "../../supabase/functions/_shared/dailyReviewScoring";

const on = (marks = 1, penalty = 0.25): ScoringRules => ({ enabled: true, marks_per_correct: marks, negative_marks_per_wrong: penalty });

describe("marks per answer", () => {
  it("correct = +marks, wrong = -penalty, skipped = 0", () => {
    expect(marksFor("correct", on(1, 0.25))).toBe(1);
    expect(marksFor("wrong", on(1, 0.25))).toBe(-0.25);
    expect(marksFor("skipped", on(1, 0.25))).toBe(0);
  });
  it("uses whatever the school configured", () => {
    expect(marksFor("correct", on(4, 1))).toBe(4);
    expect(marksFor("wrong", on(4, 1))).toBe(-1);
    expect(marksFor("wrong", on(2, 0))).toBe(-0);          // penalty 0: wrong costs nothing
    expect(Object.is(marksFor("wrong", on(2, 0)), -0) || marksFor("wrong", on(2, 0)) === 0).toBe(true);
  });
  it("scores nothing when negative marking is off, so the old screen is unchanged", () => {
    const off = { ...on(), enabled: false };
    for (const o of ["correct", "wrong", "skipped"] as const) expect(marksFor(o, off)).toBe(0);
    expect(DEFAULT_RULES.enabled).toBe(false);
  });
});

describe("session score", () => {
  const rules = on(1, 0.25);
  const row = (outcome: "correct" | "wrong" | "skipped") => ({ outcome, marks: marksFor(outcome, rules) });

  it("adds the correct marks, deducts the wrong ones, ignores skipped, and reports every count", () => {
    const rows = [...Array(7).fill(0).map(() => row("correct")), row("wrong"), row("wrong"), row("skipped")];
    const s = summarizeSession(rows, 10, rules);
    expect(s).toMatchObject({ total_questions: 10, correct: 7, wrong: 2, skipped: 1, unanswered: 1, marks_gained: 7, marks_deducted: 0.5, net: 6.5, max_possible: 10 });
  });

  it("counts questions never reached as unanswered, worth 0", () => {
    const s = summarizeSession([row("correct"), row("wrong")], 5, rules);
    expect(s.unanswered).toBe(3);
    expect(s.net).toBe(0.75);
    expect(s.max_possible).toBe(5);
  });

  it("can go below zero when a student gets many wrong, and says so exactly", () => {
    const s = summarizeSession([row("wrong"), row("wrong"), row("wrong"), row("wrong"), row("correct")], 5, rules);
    expect(s.net).toBe(0);                                  // 1 - 4*0.25
    const worse = summarizeSession([row("wrong"), row("wrong"), row("wrong")], 3, rules);
    expect(worse.net).toBe(-0.75);
  });

  it("has no floating point drift (0.1 + 0.2 style)", () => {
    const r = on(0.1, 0.2);
    const rows = [{ outcome: "correct" as const, marks: 0.1 }, { outcome: "correct" as const, marks: 0.1 }, { outcome: "correct" as const, marks: 0.1 }, { outcome: "wrong" as const, marks: -0.2 }];
    expect(summarizeSession(rows, 4, r).net).toBe(0.1);
    expect(summarizeSession(Array(10).fill({ outcome: "wrong", marks: -0.15 }), 10, on(1, 0.15)).net).toBe(-1.5);
  });

  it("an empty session scores 0 / 0", () => {
    expect(summarizeSession([], 0, rules)).toMatchObject({ net: 0, correct: 0, wrong: 0, unanswered: 0, max_possible: 0 });
  });

  it("never reports fewer questions than were answered", () => {
    expect(summarizeSession([row("correct"), row("correct")], 1, rules).total_questions).toBe(2);
  });
});

describe("admin rule validation", () => {
  const ok = (o: object) => validateRules({ enabled: true, marks_per_correct: 1, negative_marks_per_wrong: 0.25, ...o });

  it("accepts sensible rules, including strings from form inputs", () => {
    expect(ok({})).toEqual({ ok: true, rules: on(1, 0.25) });
    expect(ok({ marks_per_correct: "4", negative_marks_per_wrong: "1" })).toEqual({ ok: true, rules: on(4, 1) });
    expect(ok({ negative_marks_per_wrong: 0 }).ok).toBe(true);
    expect(ok({ marks_per_correct: 10, negative_marks_per_wrong: 10 }).ok).toBe(true);
  });
  it("rejects a penalty bigger than the marks for a correct answer", () => {
    expect(ok({ marks_per_correct: 1, negative_marks_per_wrong: 2 }).ok).toBe(false);
  });
  it("rejects negative penalties, zero / huge marks, blanks, NaN and 3+ decimals", () => {
    for (const bad of [
      { negative_marks_per_wrong: -0.25 }, { marks_per_correct: 0 }, { marks_per_correct: -1 }, { marks_per_correct: 11 },
      { marks_per_correct: "" }, { negative_marks_per_wrong: "" }, { marks_per_correct: "abc" }, { negative_marks_per_wrong: NaN },
      { marks_per_correct: Infinity }, { negative_marks_per_wrong: 0.123 }, { marks_per_correct: null },
    ]) expect(ok(bad).ok, JSON.stringify(bad)).toBe(false);
  });
  it("requires an explicit on / off", () => {
    expect(validateRules({ marks_per_correct: 1, negative_marks_per_wrong: 0.25 }).ok).toBe(false);
    expect(validateRules({ enabled: "yes", marks_per_correct: 1, negative_marks_per_wrong: 0.25 }).ok).toBe(false);
    expect(validateRules(null).ok).toBe(false);
  });
  it("a rejected rule explains itself in plain words", () => {
    const r = ok({ negative_marks_per_wrong: 2 });
    expect("error" in r && r.error).toMatch(/more than the marks/);
  });
});

describe("reading stored settings", () => {
  it("builds rules from a row", () => {
    expect(rulesFromRow({ negative_marking_enabled: true, marks_per_correct: "2.00", negative_marks_per_wrong: "0.50" })).toEqual(on(2, 0.5));
  });
  it("falls back to OFF for a missing or corrupt row, so Daily Review is never blocked", () => {
    expect(rulesFromRow(null)).toEqual(DEFAULT_RULES);
    expect(rulesFromRow(undefined)).toEqual(DEFAULT_RULES);
    expect(rulesFromRow({ negative_marking_enabled: true, marks_per_correct: 1, negative_marks_per_wrong: 5 })).toEqual(DEFAULT_RULES);
    expect(rulesFromRow({ negative_marking_enabled: false, marks_per_correct: 2, negative_marks_per_wrong: 1 }).enabled).toBe(false);
  });
});

describe("display", () => {
  it("formats marks with a real minus sign and no trailing zeros", () => {
    expect(formatMarks(1)).toBe("1");
    expect(formatMarks(1, { sign: true })).toBe("+1");
    expect(formatMarks(-0.25)).toBe("−0.25");
    expect(formatMarks(-0.5)).toBe("−0.5");
    expect(formatMarks(6.5)).toBe("6.5");
    expect(formatMarks(0, { sign: true })).toBe("0");
    expect(formatMarks(-0)).toBe("0");
  });
  it("shows admins a worked example", () => {
    expect(exampleScore(on(1, 0.25)).text).toBe("10 questions: 7 correct, 2 wrong, 1 skipped = 6.5 / 10");
    expect(exampleScore(on(2, 1)).net).toBe(12);
  });
});
