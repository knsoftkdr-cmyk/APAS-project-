import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/learningEvents", () => ({ trackLearningEvent: vi.fn(), flushLearningEvents: vi.fn(), call: vi.fn() }));

import { WatchAccumulator } from "@/lib/videoWatchTracker";
import { parseTimestamp, formatTimestamp } from "@/lib/interactiveVideo";
import {
  applyProgress, gradeAnswer, mergeRanges, parseGeneratedQuestions, resumePosition, sanitizeQuestion, sanitizeRanges,
  studentSafeQuestion, summarizeProgress, summarizeQuestions, type StoredQuestion,
} from "../../supabase/functions/_shared/interactiveVideoModel";
import { describeEvent } from "../../supabase/functions/_shared/learningEventModel";
import { interactionActivity, DEFAULT_CONFIG } from "../../supabase/functions/_shared/engagementModel";

const q = (o: Record<string, unknown> = {}) => ({ timestamp_seconds: 30, question_text: "What is 2+2?", question_type: "mcq", options: ["3", "4", "5"], correct_index: 1, explanation: "Because.", ...o });

describe("sanitizeQuestion", () => {
  it("accepts a valid MCQ and trims", () => {
    const r = sanitizeQuestion(q({ question_text: "  Hi?  " }));
    expect(r.ok && r.value.question_text).toBe("Hi?");
  });
  it("forces True/False options", () => {
    const r = sanitizeQuestion(q({ question_type: "true_false", options: ["x"], correct_index: 1 }));
    expect(r.ok && r.value.options).toEqual(["True", "False"]);
  });
  it.each([
    [{ question_text: "" }], [{ options: ["a"] }], [{ options: ["a", "A"] }], [{ options: ["a", ""] }],
    [{ correct_index: 3 }], [{ timestamp_seconds: -1 }], [{ timestamp_seconds: "x" }],
  ])("rejects %j", (o) => expect(sanitizeQuestion(q(o)).ok).toBe(false));
  it("rejects a time after the end of the video", () => expect(sanitizeQuestion(q({ timestamp_seconds: 100 }), 60).ok).toBe(false));
});

describe("grading and answer secrecy", () => {
  const stored = { id: "1", ...(q() as object) } as StoredQuestion;
  it("grades", () => {
    expect(gradeAnswer(stored, 1)).toEqual({ valid: true, correct: true });
    expect(gradeAnswer(stored, 0)).toEqual({ valid: true, correct: false });
    expect(gradeAnswer(stored, 9).valid).toBe(false);
    expect(gradeAnswer(stored, "1.5").valid).toBe(false);
  });
  it("never sends the key or explanation to students", () => {
    const safe = studentSafeQuestion(stored) as Record<string, unknown>;
    expect(safe).not.toHaveProperty("correct_index");
    expect(safe).not.toHaveProperty("explanation");
  });
});

describe("watched ranges", () => {
  it("merges overlaps so re-watching never inflates watch time", () => {
    expect(mergeRanges([[0, 10]], [[5, 20]], [[30, 40]])).toEqual([[0, 20], [30, 40]]);
    expect(mergeRanges([[0, 10]], [[0, 10]])).toEqual([[0, 10]]);
  });
  it("clamps to the video length and drops junk", () => {
    expect(sanitizeRanges([[0, 999], ["a", 2], [5, 5], [-4, 3]], 100)).toEqual([[0, 100], [0, 3]]);
  });
  it("applyProgress is monotonic and completes at 90%", () => {
    const a = applyProgress(null, { position: 50, furthest: 50, duration: 100, ranges: [[0, 50]] })!;
    expect(a.watched_seconds).toBe(50);
    expect(a.completed).toBe(false);
    const b = applyProgress(a, { position: 10, furthest: 10, duration: 100, ranges: [[0, 10]] })!;   // went back and replayed
    expect(b.watched_seconds).toBe(50);
    expect(b.furthest_seconds).toBe(50);
    expect(b.last_position_seconds).toBe(10);
    const c = applyProgress(b, { position: 95, furthest: 95, duration: 100, ranges: [[40, 95]] })!;
    expect(c.completed).toBe(true);
    expect(c.completion_pct).toBe(95);
    const d = applyProgress(c, { position: 1, furthest: 1, duration: 100, ranges: [] })!;
    expect(d.completed).toBe(true);
  });
  it("watch time can never exceed the video", () => {
    const a = applyProgress(null, { position: 10, furthest: 10, duration: 60, ranges: [[0, 5000]] })!;
    expect(a.watched_seconds).toBe(60);
    expect(a.completion_pct).toBe(100);
  });
  it("refuses a report with no duration", () => expect(applyProgress(null, { position: 1, furthest: 1, duration: 0, ranges: [] })).toBeNull());
});

describe("client accumulator ranges / seed (resume)", () => {
  it("round-trips and keeps counting across sessions", () => {
    const a = new WatchAccumulator();
    a.setDuration(100);
    let t = 0;
    for (let i = 0; i < 20; i++) { a.tick(t, true, 1000 + i * 1000, 1); t += 1; }
    const ranges = a.ranges();
    expect(ranges.length).toBe(1);
    const b = new WatchAccumulator();
    b.seed(ranges);
    b.setDuration(100);
    expect(b.watched()).toBe(a.watched());
  });
});

describe("resumePosition", () => {
  const p = (pos: number, dur = 100, completed = false) => ({ last_position_seconds: pos, duration_seconds: dur, completed });
  it("starts at 0 with no progress, tiny progress or a finished video", () => {
    expect(resumePosition(null)).toBe(0);
    expect(resumePosition(p(3))).toBe(0);
    expect(resumePosition(p(99))).toBe(0);
  });
  it("rewinds a couple of seconds for context", () => expect(resumePosition(p(60))).toBe(58));
  it("re-shows a question that was open when the student left", () => expect(resumePosition(p(60.2), [60])).toBe(59));
});

describe("question analytics use the first attempt", () => {
  const qs = [{ id: "a", ...q({ timestamp_seconds: 10 }) }, { id: "b", ...q({ timestamp_seconds: 20 }) }] as StoredQuestion[];
  it("counts accuracy, skips and option spread", () => {
    const at = (question_id: string, student_id: string, selected_index: number | null, is_correct: boolean | null, skipped: boolean, n: number) =>
      ({ question_id, student_id, selected_index, is_correct, skipped, attempt_no: 1, created_at: `2026-01-01T00:00:0${n}Z` });
    const stats = summarizeQuestions(qs, [
      at("a", "s1", 0, false, false, 1), at("a", "s1", 1, true, false, 2),   // retry must not flatter
      at("a", "s2", 1, true, false, 1), at("a", "s3", null, null, true, 1),
    ]);
    expect(stats[0]).toMatchObject({ students: 3, answered: 2, skipped: 1, correct: 1, accuracy_pct: 50, option_counts: [1, 1, 0] });
    expect(stats[1].accuracy_pct).toBeNull();
  });
  it("summarises progress", () => {
    expect(summarizeProgress([]).completion_rate_pct).toBeNull();
    const s = summarizeProgress([
      { student_id: "1", watched_seconds: 60, duration_seconds: 100, completion_pct: 60, completed: false },
      { student_id: "2", watched_seconds: 100, duration_seconds: 100, completion_pct: 100, completed: true },
    ]);
    expect(s).toMatchObject({ viewers: 2, avg_watch_seconds: 80, avg_completion_pct: 80, completed: 1, completion_rate_pct: 50 });
  });
});

describe("AI output parsing", () => {
  const good = (t: number) => q({ timestamp_seconds: t });
  it("keeps valid, in-range, spaced questions in time order and strips code fences", () => {
    const text = "```json\n" + JSON.stringify({ questions: [good(90), good(30), good(32), q({ question_text: "" }), good(500)] }) + "\n```";
    const r = parseGeneratedQuestions(text, 120, 5);
    expect(r.map((x) => x.timestamp_seconds)).toEqual([30, 90]);
  });
  it("returns nothing for garbage", () => expect(parseGeneratedQuestions("sorry", 120, 3)).toEqual([]));
  it("respects the requested count", () => expect(parseGeneratedQuestions(JSON.stringify([good(10), good(30), good(60)]), 120, 2)).toHaveLength(2));
});

describe("timestamps", () => {
  it("parses and formats", () => {
    expect(parseTimestamp("2:30")).toBe(150);
    expect(parseTimestamp("1:02:03")).toBe(3723);
    expect(parseTimestamp("90")).toBe(90);
    expect(parseTimestamp("2:75")).toBeNull();
    expect(parseTimestamp("abc")).toBeNull();
    expect(formatTimestamp(150)).toBe("2:30");
    expect(formatTimestamp(3723)).toBe("1:02:03");
  });
});

describe("telemetry / engagement integration", () => {
  it("describes the new events in the live feed", () => {
    const e = { event_type: "video_question_answered", is_correct: true, payload: { title: "Fractions" } } as never;
    expect(describeEvent(e).label).toMatch(/video question/i);
  });
  it("answered video questions and video doubts earn interaction credit; nothing else changes", () => {
    const at = "2026-01-05T10:00:00Z";
    const period = { startMs: Date.parse("2026-01-01T00:00:00Z"), endMs: Date.parse("2026-01-31T00:00:00Z") } as never;
    const withVideo = interactionActivity([{ at, kind: "video_question", chars: null }, { at, kind: "video_doubt", chars: null }], period, DEFAULT_CONFIG);
    const without = interactionActivity([], period, DEFAULT_CONFIG);
    expect(without.score).toBe(0);
    expect(withVideo.score).toBeGreaterThan(0);
  });
});
