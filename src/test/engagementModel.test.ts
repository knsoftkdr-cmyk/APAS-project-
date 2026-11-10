import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIG, sanitizeConfig, categoryFor, computeEngagement, videoActivity, quizActivity, assignmentActivity,
  liveClassActivity, interactionActivity, compareScores, improvementTips, missingActivities, periodFor, localDateKey, factsAsOf, normClass, normSection,
  type EngagementFacts, type QuizItem, type AssignmentItem, type LiveSession,
} from "../../supabase/functions/_shared/engagementModel";

const DAY = 86_400_000;
// 20 Oct 2026, 12:00 UTC (17:30 IST)
const now = Date.UTC(2026, 9, 20, 12, 0, 0);
const iso = (daysAgo: number, hours = 0) => new Date(now - daysAgo * DAY + hours * 3_600_000).toISOString();
const cfg = DEFAULT_CONFIG;
const period = periodFor(now, 30);

/** Five meaningful doubts in the period = a perfect doubts score (the AI tutor is open to every student). */
const withDoubts = (f: EngagementFacts): EngagementFacts => ({
  ...f, interactions: Array.from({ length: 5 }, (_, i) => ({ at: iso(i + 1), kind: "tutor" as const, chars: 60 })),
});

const emptyFacts = (): EngagementFacts => ({
  videos: { availableIds: [], events: [] }, quizzes: [], assignments: [], liveSessions: [], liveAttendance: [], interactions: [],
});

const quiz = (id: string, status: QuizItem["status"], dueDaysAgo: number | null = 5): QuizItem => ({
  id, status, opens_at: iso(10), created_at: iso(10), due_at: dueDaysAgo === null ? null : iso(dueDaysAgo),
});
const hw = (id: string, submittedDaysAgo: number | null, dueDaysAgo: number | null = 5, kind: "homework" | "worksheet" = "worksheet"): AssignmentItem => ({
  kind, id, assigned_at: iso(12), due_at: dueDaysAgo === null ? null : iso(dueDaysAgo),
  submitted_at: submittedDaysAgo === null ? null : iso(submittedDaysAgo),
});

describe("categoryFor", () => {
  it("uses the specified bands", () => {
    expect(categoryFor(100)).toBe("highly_engaged");
    expect(categoryFor(80)).toBe("highly_engaged");
    expect(categoryFor(79.9)).toBe("moderately_engaged");
    expect(categoryFor(60)).toBe("moderately_engaged");
    expect(categoryFor(59)).toBe("low");
    expect(categoryFor(40)).toBe("low");
    expect(categoryFor(39.9)).toBe("very_low");
    expect(categoryFor(0)).toBe("very_low");
  });
  it("has no category without a score", () => {
    expect(categoryFor(null)).toBeNull();
  });
});

describe("sanitizeConfig (configurable weights)", () => {
  it("defaults to 20/25/25/20/10", () => {
    expect(sanitizeConfig(undefined).weights).toEqual({ video: 20, quiz: 25, assignment: 25, live_class: 20, interaction: 10 });
  });
  it("accepts custom weights and clamps nonsense", () => {
    const c = sanitizeConfig({ weights: { video: 40, quiz: -5, assignment: "30", live_class: 1000, interaction: "x" }, window_days: 5000 });
    expect(c.weights.video).toBe(40);
    expect(c.weights.quiz).toBe(0);
    expect(c.weights.assignment).toBe(30);
    expect(c.weights.live_class).toBe(100);
    expect(c.weights.interaction).toBe(10);
    expect(c.window_days).toBe(90);
  });
  it("falls back to defaults when every weight is zero", () => {
    expect(sanitizeConfig({ weights: { video: 0, quiz: 0, assignment: 0, live_class: 0, interaction: 0 } }).weights.quiz).toBe(25);
  });
});

describe("1. video watching", () => {
  it("opening a video (tiny watch) earns nothing", () => {
    const r = videoActivity(["v1", "v2", "v3"], [{ ref_id: "v1", watched_seconds: 5, video_duration: 600 }], cfg);
    expect(r.available).toBe(true);
    expect(r.score).toBe(0);
  });
  it("credits the fraction actually watched", () => {
    const r = videoActivity(["v1", "v2", "v3"], [{ ref_id: "v1", watched_seconds: 300, video_duration: 600 }], cfg);
    expect(r.credit).toBe(0.5);
    expect(r.score).toBe(16.7); // 0.5 of an expected 3
  });
  it("is capped at the number of videos expected", () => {
    const events = ["a", "b", "c", "d"].map((id) => ({ ref_id: id, watched_seconds: 600, video_duration: 600 }));
    expect(videoActivity(["a", "b", "c", "d"], events, cfg).score).toBe(100);
  });
  it("is unavailable when no video exists for the student", () => {
    expect(videoActivity([], [], cfg).available).toBe(false);
  });
  it("counts a watched video even if the availability list was empty", () => {
    const r = videoActivity([], [{ ref_id: "x", watched_seconds: 600, video_duration: 600 }], cfg);
    expect(r.available).toBe(true);
    expect(r.score).toBe(100);
  });
});

describe("7. duplicate events do not inflate the score", () => {
  it("repeated progress events for one video use the maximum, not the sum", () => {
    const e = { ref_id: "v1", watched_seconds: 120, video_duration: 600 };
    const once = videoActivity(["v1"], [e], cfg);
    const many = videoActivity(["v1"], Array.from({ length: 50 }, () => e), cfg);
    expect(many.score).toBe(once.score);
    expect(many.credit).toBe(0.2);
  });
  it("watched seconds beyond the duration are clamped", () => {
    expect(videoActivity(["v1"], [{ ref_id: "v1", watched_seconds: 9999, video_duration: 100 }], cfg).credit).toBe(1);
  });
  it("duplicate quiz and assignment rows count once", () => {
    const q = quiz("q1", "submitted");
    expect(quizActivity([q, q, q], period, cfg).opportunities).toBe(1);
    const a = hw("h1", 4);
    expect(assignmentActivity([a, a], period, cfg).opportunities).toBe(1);
  });
  it("the doubt daily cap stops spamming", () => {
    const events = Array.from({ length: 30 }, () => ({ at: iso(1), kind: "tutor" as const, chars: 80 }));
    const r = interactionActivity(events, period, cfg);
    expect(r.credit).toBe(cfg.interaction_daily_cap);
  });
});

describe("2. quiz participation", () => {
  it("submitted = full credit, started = partial, not started = 0", () => {
    const r = quizActivity([quiz("a", "submitted"), quiz("b", "in_progress"), quiz("c", null)], period, cfg);
    expect(r.opportunities).toBe(3);
    expect(r.credit).toBe(1.5);
    expect(r.score).toBe(50);
  });
  it("a quiz that is still open and untouched is not counted as missed", () => {
    const r = quizActivity([quiz("a", "submitted"), { ...quiz("b", null), due_at: iso(-3) }], period, cfg);
    expect(r.opportunities).toBe(1);
    expect(r.score).toBe(100);
  });
  it("a quiz that has not opened yet is ignored", () => {
    const future = { ...quiz("a", null), opens_at: iso(-1) };
    expect(quizActivity([future], period, cfg).available).toBe(false);
  });
  it("graded counts as participation", () => {
    expect(quizActivity([quiz("a", "graded")], period, cfg).score).toBe(100);
  });
});

describe("3. assignments and deadlines", () => {
  it("on-time = 1, late = late_credit, missed = 0", () => {
    const r = assignmentActivity([hw("a", 6, 5), hw("b", 3, 5), hw("c", null, 5)], period, cfg);
    expect(r.opportunities).toBe(3);
    expect(r.credit).toBe(1.6);
    expect(r.score).toBe(53.3);
  });
  it("an assignment not yet due and unsubmitted is excluded", () => {
    const r = assignmentActivity([hw("a", 6, 5), hw("b", null, -4)], period, cfg);
    expect(r.opportunities).toBe(1);
    expect(r.score).toBe(100);
  });
  it("homework without a deadline is missed only after the grace period", () => {
    const fresh: AssignmentItem = { kind: "homework", id: "h", assigned_at: iso(1), due_at: null, submitted_at: null };
    const old: AssignmentItem = { ...fresh, id: "h2", assigned_at: iso(10) };
    expect(assignmentActivity([fresh], period, cfg).available).toBe(false);
    expect(assignmentActivity([old], period, cfg).score).toBe(0);
  });
  it("assignments from outside the reporting period are ignored", () => {
    const ancient: AssignmentItem = { kind: "homework", id: "x", assigned_at: iso(120), due_at: iso(100), submitted_at: null };
    expect(assignmentActivity([ancient], period, cfg).available).toBe(false);
  });
});

describe("4. live class attendance", () => {
  // Daily recurring class 09:00-10:00 IST (03:30-04:30 UTC), 3 days ago to 1 day ago
  const session: LiveSession = {
    id: "s1", status: "scheduled", scheduled_start: iso(3).slice(0, 10) + "T03:30:00.000Z",
    scheduled_end: iso(3).slice(0, 10) + "T04:30:00.000Z", recurrence_end_date: iso(1).slice(0, 10),
  };
  const d = (daysAgo: number) => iso(daysAgo).slice(0, 10);

  it("counts each daily occurrence and rewards joins", () => {
    const att = [{ session_id: "s1", session_date: d(3), attendance_status: "joined" }, { session_id: "s1", session_date: d(2), attendance_status: "joined" }];
    const r = liveClassActivity([session], att, period, cfg);
    expect(r.opportunities).toBe(3);
    expect(r.credit).toBe(2);
    expect(r.score).toBe(66.7);
  });
  it("a day with no attendance row counts as not attended", () => {
    expect(liveClassActivity([session], [], period, cfg).score).toBe(0);
  });
  it("excused absences are excluded from the denominator", () => {
    const att = [
      { session_id: "s1", session_date: d(3), attendance_status: "joined" },
      { session_id: "s1", session_date: d(2), attendance_status: "excused" },
      { session_id: "s1", session_date: d(1), attendance_status: "absent" },
    ];
    const r = liveClassActivity([session], att, period, cfg);
    expect(r.opportunities).toBe(2);
    expect(r.score).toBe(50);
  });
  it("cancelled sessions are ignored", () => {
    expect(liveClassActivity([{ ...session, status: "cancelled" }], [], period, cfg).available).toBe(false);
  });
  it("a class that has not finished today is not counted yet", () => {
    const later: LiveSession = {
      id: "s2", status: "scheduled", scheduled_start: `${localDateKey(now, 330)}T14:00:00.000Z`,
      scheduled_end: `${localDateKey(now, 330)}T15:00:00.000Z`, recurrence_end_date: null,
    };
    expect(liveClassActivity([later], [], period, cfg).available).toBe(false);
  });
  it("sessions that never existed for the student give no live-class score", () => {
    expect(liveClassActivity([], [], period, cfg).available).toBe(false);
  });
});

describe("5. doubts and interactions", () => {
  it("counts meaningful doubts and classroom questions, not tiny or career-coach messages", () => {
    const r = interactionActivity([
      { at: iso(2), kind: "tutor", chars: 80 },
      { at: iso(3), kind: "tutor", chars: 4 },
      { at: iso(4), kind: "classroom_question", chars: null },
    ], period, cfg);
    expect(r.credit).toBe(2);
    expect(r.score).toBe(40);
  });
  it("ignores interactions outside the period", () => {
    expect(interactionActivity([{ at: iso(60), kind: "tutor", chars: 80 }], period, cfg).credit).toBe(0);
  });
});

describe("6. multiple activities combine with the configured weights", () => {
  it("computes the weighted total", () => {
    const f = emptyFacts();
    f.videos = { availableIds: ["v1", "v2", "v3"], events: [{ ref_id: "v1", watched_seconds: 600, video_duration: 600 }, { ref_id: "v2", watched_seconds: 600, video_duration: 600 }, { ref_id: "v3", watched_seconds: 600, video_duration: 600 }] }; // 100
    f.quizzes = [quiz("q1", "submitted"), quiz("q2", null)]; // 50
    f.assignments = [hw("a1", 6, 5), hw("a2", 6, 5)]; // 100
    f.liveSessions = []; // unavailable
    f.interactions = Array.from({ length: 5 }, (_, i) => ({ at: iso(i + 1), kind: "tutor" as const, chars: 60 })); // 100
    const r = computeEngagement(f, now);
    // video 100*20 + quiz 50*25 + assignment 100*25 + interaction 100*10 = 2000+1250+2500+1000 = 6750 / 80 = 84.375
    expect(r.status).toBe("ok");
    expect(r.score).toBe(84.4);
    expect(r.category).toBe("highly_engaged");
    expect(r.activities.live_class.available).toBe(false);
    expect(r.activities.video.effective_weight).toBe(25);
    expect(r.activities.quiz.effective_weight).toBe(31.3);
  });
  it("honours custom weights", () => {
    const f = emptyFacts();
    f.quizzes = [quiz("q1", "submitted"), quiz("q2", null), quiz("q3", null)]; // 33.3
    f.assignments = [hw("a1", 6, 5), hw("a2", 6, 5), hw("a3", 6, 5)]; // 100
    const quizHeavy = computeEngagement(f, now, { weights: { video: 0, quiz: 90, assignment: 10, live_class: 0, interaction: 0 } });
    const assignHeavy = computeEngagement(f, now, { weights: { video: 0, quiz: 10, assignment: 90, live_class: 0, interaction: 0 } });
    expect(quizHeavy.score).toBe(40);
    expect(assignHeavy.score).toBe(93.3);
  });
});

describe("8. unassigned activities do not reduce the score", () => {
  it("a student with only quizzes is judged only on quizzes (and doubts, which every student can ask)", () => {
    const f = emptyFacts();
    f.quizzes = [quiz("a", "submitted"), quiz("b", "submitted"), quiz("c", "submitted")];
    const r = computeEngagement(withDoubts(f), now);
    expect(r.score).toBe(100);
    expect(r.activities.assignment.available).toBe(false);
    expect(r.activities.video.available).toBe(false);
    expect(r.activities.live_class.available).toBe(false);
  });
  it("two students with different opportunities but the same behaviour score the same", () => {
    const a = emptyFacts(); a.quizzes = [quiz("1", "submitted"), quiz("2", "submitted"), quiz("3", "submitted")];
    const b = emptyFacts(); b.quizzes = [quiz("1", "submitted"), quiz("2", "submitted"), quiz("3", "submitted")];
    b.assignments = [hw("x", 6, 5), hw("y", 6, 5)];
    expect(computeEngagement(withDoubts(a), now).score).toBe(computeEngagement(withDoubts(b), now).score);
  });
  it("missing assignments are not counted against a student who has none", () => {
    const f = emptyFacts();
    f.quizzes = [quiz("a", "submitted"), quiz("b", "submitted"), quiz("c", "submitted")];
    const without = computeEngagement(withDoubts(f), now);
    f.assignments = [hw("x", null, 5)]; // now one IS assigned and missed: the score must drop
    const missed = computeEngagement(withDoubts(f), now);
    expect(without.score).toBe(100);
    expect(missed.score).toBeLessThan(100);
  });
  it("a zero-weight activity is ignored even when available", () => {
    const f = emptyFacts();
    f.quizzes = [quiz("a", "submitted"), quiz("b", "submitted"), quiz("c", "submitted")];
    f.assignments = [hw("x", null, 5)];
    const r = computeEngagement(f, now, { weights: { video: 20, quiz: 25, assignment: 0, live_class: 20, interaction: 0 } });
    expect(r.score).toBe(100);
  });
  it("doubts can be switched off with a zero weight", () => {
    const f = emptyFacts();
    f.quizzes = [quiz("a", "submitted"), quiz("b", "submitted"), quiz("c", "submitted")];
    expect(computeEngagement(f, now, { weights: { interaction: 0 } }).score).toBe(100);
  });
});

describe("9. insufficient data", () => {
  it("shows no score and no category with too few opportunities", () => {
    const f = emptyFacts();
    f.quizzes = [quiz("a", "submitted")];
    const r = computeEngagement(f, now);
    expect(r.status).toBe("insufficient");
    expect(r.score).toBeNull();
    expect(r.category).toBeNull();
  });
  it("a student with nothing at all is insufficient, not zero", () => {
    const r = computeEngagement(emptyFacts(), now);
    expect(r.status).toBe("insufficient");
    expect(r.score).toBeNull();
  });
  it("interactions alone never produce a score", () => {
    const f = emptyFacts();
    f.interactions = Array.from({ length: 5 }, (_, i) => ({ at: iso(i + 1), kind: "tutor" as const, chars: 60 }));
    expect(computeEngagement(f, now).status).toBe("insufficient");
  });
  it("the minimum is configurable", () => {
    const f = emptyFacts();
    f.quizzes = [quiz("a", "submitted")];
    expect(computeEngagement(f, now, { min_opportunities: 1 }).status).toBe("ok");
  });
});

describe("13. trends and history", () => {
  it("detects improvement, decline and stability", () => {
    expect(compareScores(80, 60).trend).toBe("up");
    expect(compareScores(60, 80).trend).toBe("down");
    expect(compareScores(61, 60).trend).toBe("flat");
  });
  it("flags a decline only past the threshold", () => {
    expect(compareScores(70, 78).declining).toBe(false);
    expect(compareScores(60, 78).declining).toBe(true);
    expect(compareScores(75, 78, 2).declining).toBe(true);
  });
  it("is unknown when either period lacks data", () => {
    expect(compareScores(70, null)).toEqual({ delta: null, trend: "unknown", declining: false });
    expect(compareScores(null, 70).trend).toBe("unknown");
  });
});

describe("suggestions", () => {
  it("suggests the weakest, heaviest activities and skips unavailable ones", () => {
    const f = emptyFacts();
    f.quizzes = [quiz("a", null), quiz("b", null), quiz("c", null)];
    f.assignments = [hw("x", 6, 5), hw("y", 6, 5)];
    const r = computeEngagement(f, now);
    const tips = improvementTips(r);
    expect(tips[0].key).toBe("quiz");
    expect(tips.some((t) => t.key === "video")).toBe(false);
    expect(missingActivities(r)).toContain("quiz");
  });
});

describe("localDateKey", () => {
  it("converts to school-local dates", () => {
    expect(localDateKey(Date.UTC(2026, 9, 20, 20, 0, 0), 330)).toBe("2026-10-21");
    expect(localDateKey(Date.UTC(2026, 9, 20, 20, 0, 0), 0)).toBe("2026-10-20");
  });
});

describe("normClass", () => {
  it("matches the common ways a class is written", () => {
    expect(normClass("Class 5")).toBe("5");
    expect(normClass("grade 5")).toBe("5");
    expect(normClass("Std. 5")).toBe("5");
    expect(normClass("5")).toBe("5");
    expect(normClass("Nursery")).toBe("nursery");
    expect(normClass(null)).toBe("");
    expect(normSection(" a ")).toBe("A");
  });
});

describe("13. previous period is rebuilt from timestamps", () => {
  it("work submitted after the cut-off did not exist yet", () => {
    const f = emptyFacts();
    // Three quizzes, all submitted 3 days ago.
    f.quizzes = ["a", "b", "c"].map((id) => ({ ...quiz(id, "submitted"), submitted_at: iso(3) }));
    const asOf = now - 5 * DAY;
    const past = factsAsOf(f, asOf);
    expect(past.quizzes.every((q) => q.status === null)).toBe(true);
    const nowFacts = factsAsOf(f, now);
    expect(nowFacts.quizzes.every((q) => q.status === "submitted")).toBe(true);
  });
  it("items created after the cut-off are dropped", () => {
    const f = emptyFacts();
    f.assignments = [hw("old", 20, 18), { ...hw("new", null, 5), assigned_at: iso(2) }];
    expect(factsAsOf(f, now - 10 * DAY).assignments.map((a) => a.id)).toEqual(["old"]);
  });
  it("scores the previous 30 days against the 30 before it, from the same facts", () => {
    const f = emptyFacts();
    // Previous period (days 30-60 ago): 3 quizzes, all done. Current period: 3 quizzes, none done.
    const mk = (id: string, createdAgo: number, dueAgo: number, doneAgo: number | null) => ({
      id, opens_at: iso(createdAgo), created_at: iso(createdAgo), due_at: iso(dueAgo),
      status: (doneAgo === null ? null : "submitted") as QuizItem["status"], submitted_at: doneAgo === null ? null : iso(doneAgo),
    });
    f.quizzes = [mk("p1", 55, 50, 52), mk("p2", 50, 45, 46), mk("p3", 45, 40, 41), mk("c1", 20, 15, null), mk("c2", 15, 10, null), mk("c3", 12, 8, null)];
    const current = computeEngagement(withDoubts(f), now);
    const previous = computeEngagement(withDoubts(factsAsOf(f, now - 30 * DAY)), now - 30 * DAY);
    expect(previous.score).toBeGreaterThan(current.score!);
    expect(compareScores(current.score, previous.score).declining).toBe(true);
  });
});
