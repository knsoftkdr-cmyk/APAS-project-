import { describe, expect, it } from "vitest";
import { blankEditorItem, formatClock, formatDuration, friendlyDppError, percentTone, toRpcItem, tutorPromptForItem, validateEditorItem, weekdayLabel } from "@/lib/dpp";
import { dppContextDirective } from "../../supabase/functions/_shared/dppContext";

describe("dpp helpers", () => {
  it("formats durations and clocks", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(null)).toBe("-");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(-3)).toBe("00:00");
  });
  it("labels weekdays without timezone drift", () => {
    expect(weekdayLabel("2026-11-09")).toBe("Mon");
    expect(weekdayLabel("2026-11-15")).toBe("Sun");
  });
  it("classifies scores", () => {
    expect(percentTone(80)).toBe("good");
    expect(percentTone(50)).toBe("ok");
    expect(percentTone(49.9)).toBe("low");
    expect(percentTone(null)).toBe("none");
  });
  it("turns database errors into readable messages", () => {
    expect(friendlyDppError(new Error("ALREADY_SUBMITTED: abc"))).toMatch(/already submitted/);
    expect(friendlyDppError({ message: "INVALID: title is required" })).toBe("title is required");
    expect(friendlyDppError(new Error("SET_LOCKED: x"))).toMatch(/already started/);
  });
  it("validates editor questions", () => {
    const mcq = blankEditorItem("mcq");
    expect(validateEditorItem(mcq, 1)).toMatch(/question text/);
    mcq.stem = "2+2?"; mcq.options = { A: "3", B: "4", C: "", D: "" };
    expect(validateEditorItem(mcq, 1)).toMatch(/correct option/);
    mcq.correct_answer = "C";
    expect(validateEditorItem(mcq, 1)).toMatch(/correct option/);
    mcq.correct_answer = "B";
    expect(validateEditorItem(mcq, 1)).toBeNull();
    const num = { ...blankEditorItem("numeric"), stem: "pi?" };
    expect(validateEditorItem(num, 2)).toMatch(/numeric answer/);
    expect(validateEditorItem({ ...num, numeric_answer: 3.14 }, 2)).toBeNull();
    expect(validateEditorItem({ ...blankEditorItem("short_answer"), stem: "x" }, 3)).toMatch(/accepted answer/);
    expect(validateEditorItem({ ...mcq, marks: 0 }, 4)).toMatch(/marks/);
  });
  it("shapes rows for the RPC without empty options or blank answers", () => {
    const row = toRpcItem({ ...blankEditorItem("mcq"), stem: " q ", options: { A: "1", B: "2", C: " ", D: "" }, correct_answer: "A" });
    expect(row.options).toEqual({ A: "1", B: "2" });
    expect(row.stem).toBe("q");
    const sa = toRpcItem({ ...blankEditorItem("short_answer"), stem: "s", accepted_answers: ["Paris", " ", ""] });
    expect(sa.accepted_answers).toEqual(["Paris"]);
  });
  it("builds a tutor prompt", () => {
    expect(tutorPromptForItem("What is x?", false)).toMatch(/got this practice question wrong/);
    expect(tutorPromptForItem("What is x?", true)).toMatch(/explain this practice question/);
  });
});

describe("dppContextDirective (AI Tutor)", () => {
  it("returns nothing without a question", () => {
    expect(dppContextDirective(null)).toBe("");
    expect(dppContextDirective({})).toBe("");
  });
  it("never includes the key or explanation while the attempt is active", () => {
    const out = dppContextDirective({ locked: true, stem: "2+2?", options: { A: "3", B: "4" }, correct_answer: "B", explanation: "four", student_answer: "A" });
    expect(out).toContain("2+2?");
    expect(out).toMatch(/IN PROGRESS/);
    expect(out).not.toContain("four");
    expect(out).not.toMatch(/Correct answer/);
    expect(out).not.toMatch(/Student's answer/);
  });
  it("reveals answer and explanation after submission", () => {
    const out = dppContextDirective({ locked: false, stem: "2+2?", student_answer: "A", is_correct: false, correct_answer: "B", explanation: "four" });
    expect(out).toContain("Correct answer: B");
    expect(out).toContain("four");
    expect(out).toContain("(incorrect)");
  });
});
