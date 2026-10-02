import { describe, it, expect } from "vitest";
import {
  appointmentFingerprint, buildAiUserPrompt, buildFallbackPrep, buildSignals, buildSnapshot, parseAiJson,
  sanitiseAiPrep, summariseAttendance, summariseMarks, type PtmInput,
} from "../../supabase/functions/_shared/ptmPrepModel";

const D = 86400000;
const now = Date.UTC(2026, 9, 2);
const day = (ago: number) => new Date(now - ago * D).toISOString().slice(0, 10);

const base = (over: Partial<PtmInput> = {}): PtmInput => ({
  now,
  appointment: { reason_category: "general_checkin", reason_note: null, requested_by: "parent", meeting_mode: "in_person", date: day(-2) },
  previous_meetings: [],
  attendance: null, marks: null, practice_tests: null, homework: null, behaviour: null,
  notes: null, interventions: null, mastery: null, prediction: null, goals: null,
  ...over,
});

const att = (statuses: Array<[string, number]>) => statuses.map(([status, ago]) => ({ status, date: day(ago) }));
const manyAtt = (n: number, status: string, startAgo = 1) => Array.from({ length: n }, (_, i) => ({ status, date: day(startAgo + i) }));

describe("summariseAttendance", () => {
  it("excludes excused days and counts late as present", () => {
    const s = summariseAttendance(att([["present", 1], ["late", 2], ["absent", 3], ["excused", 4]]), now);
    expect(s.counted).toBe(3);
    expect(s.excused).toBe(1);
    expect(s.rate).toBeCloseTo(66.7, 1);
  });
  it("returns null rates when there is nothing", () => {
    expect(summariseAttendance(null, now).rate).toBeNull();
    expect(summariseAttendance([], now).rate).toBeNull();
  });
  it("ignores rows with unparseable dates", () => {
    const s = summariseAttendance([{ status: "absent", date: "not-a-date" }], now);
    expect(s.counted).toBe(0);
  });
});

describe("summariseMarks", () => {
  it("computes per-subject averages weighted by max marks and sorts weakest first", () => {
    const r = summariseMarks([
      { subject: "Maths", obtained: 10, max: 50, at: day(5) },
      { subject: "Maths", obtained: 30, max: 50, at: day(40) },
      { subject: "English", obtained: 45, max: 50, at: day(5) },
    ]);
    expect(r.subjects[0].subject).toBe("Maths");
    expect(r.subjects[0].pct).toBe(40);
    expect(r.overall).toBe(Math.round((85 / 150) * 100));
  });
  it("detects a falling latest result by date, not by input order", () => {
    const r = summariseMarks([
      { subject: "Maths", obtained: 20, max: 100, at: day(60) }, // oldest listed first
      { subject: "Maths", obtained: 80, max: 100, at: day(30) },
      { subject: "Maths", obtained: 30, max: 100, at: day(2) }, // latest
    ]);
    expect(r.subjects[0].latestPct).toBe(30);
    expect(r.subjects[0].trend).toBe("down");
  });
  it("skips rows with zero max marks instead of dividing by zero", () => {
    const r = summariseMarks([{ subject: "Art", obtained: 5, max: 0, at: null }]);
    expect(r.subjects).toEqual([]);
    expect(r.overall).toBeNull();
  });
});

describe("buildSignals", () => {
  it("flags low attendance with evidence containing the real numbers", () => {
    const s = buildSignals(base({ attendance: [...manyAtt(6, "absent"), ...manyAtt(4, "present", 10)] }));
    const sig = s.find((x) => x.id === "att_low")!;
    expect(sig.severity).toBe(3);
    expect(sig.evidence).toContain("40%");
    expect(sig.evidence).toContain("6 absent");
  });
  it("draws no attendance conclusion from fewer than 5 records", () => {
    const s = buildSignals(base({ attendance: manyAtt(4, "absent") }));
    expect(s.some((x) => x.category === "attendance")).toBe(false);
  });
  it("detects a recent attendance drop", () => {
    const recent = manyAtt(10, "absent", 1); // last 30 days: all absent
    const earlier = manyAtt(20, "present", 40); // before that: all present
    const s = buildSignals(base({ attendance: [...recent, ...earlier] }));
    expect(s.some((x) => x.id === "att_trend")).toBe(true);
  });
  it("treats strong subjects as strengths and weak as concerns", () => {
    const s = buildSignals(base({
      marks: [
        { subject: "Maths", obtained: 30, max: 100, at: day(5) },
        { subject: "Science", obtained: 92, max: 100, at: day(5) },
      ],
    }));
    expect(s.find((x) => x.id === "marks_maths")!.polarity).toBe("concern");
    expect(s.find((x) => x.id === "marks_maths")!.severity).toBe(3);
    expect(s.find((x) => x.id === "marks_science")!.polarity).toBe("strength");
  });
  it("only judges homework with at least 3 assignments, and clamps submitted to assigned", () => {
    expect(buildSignals(base({ homework: { assigned: 2, submitted: 0 } })).some((x) => x.category === "homework")).toBe(false);
    const s = buildSignals(base({ homework: { assigned: 10, submitted: 3 } }));
    expect(s.find((x) => x.id === "hw_low")!.severity).toBe(3);
    const over = buildSignals(base({ homework: { assigned: 4, submitted: 9 } }));
    expect(over.find((x) => x.id === "hw_good")!.evidence).toContain("4 of 4");
  });
  it("flags repeated behaviour incidents only inside the 90 day window", () => {
    const old = Array.from({ length: 5 }, () => ({ category: "negative", title: "Talking", points: -2, date: day(200), action_taken: null }));
    expect(buildSignals(base({ behaviour: old })).some((x) => x.id === "beh_neg")).toBe(false);
    const recent = Array.from({ length: 3 }, (_, i) => ({ category: "negative", title: `Incident ${i}`, points: -2, date: day(5 + i), action_taken: null }));
    expect(buildSignals(base({ behaviour: recent })).find((x) => x.id === "beh_neg")!.severity).toBe(2);
  });
  it("reports an active high-priority intervention", () => {
    const s = buildSignals(base({ interventions: [{ reason: "Reading gap", priority: "high", tier: 2, status: "active", review_date: "2026-10-20", effectiveness: null, action_plan: ["Daily reading"] }] }));
    const sig = s.find((x) => x.id === "intv_0")!;
    expect(sig.severity).toBe(3);
    expect(sig.evidence).toContain("Reading gap");
    expect(sig.evidence).toContain("2026-10-20");
  });
  it("keeps signal ids unique", () => {
    const s = buildSignals(base({ marks: [
      { subject: "Maths!", obtained: 10, max: 100, at: null },
      { subject: "Maths?", obtained: 10, max: 100, at: null },
    ] }));
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
  });
  it("produces nothing from an empty student", () => {
    expect(buildSignals(base())).toEqual([]);
  });
});

describe("buildFallbackPrep", () => {
  it("puts the parent's stated agenda first", () => {
    const input = base({
      appointment: { reason_category: "academic_concern", reason_note: "Worried about her maths", requested_by: "parent", meeting_mode: "in_person", date: day(-1) },
      marks: [{ subject: "Maths", obtained: 20, max: 100, at: day(3) }],
    });
    const prep = buildFallbackPrep(input, buildSignals(input));
    expect(prep.discussion_points[0].category).toBe("agenda");
    expect(prep.discussion_points[0].evidence[0]).toContain("Worried about her maths");
    expect(prep.agenda.raised_by).toBe("parent");
  });
  it("labels a teacher-requested agenda as the teacher's", () => {
    const input = base({ appointment: { reason_category: "behaviour_discussion", reason_note: "Talk about focus", requested_by: "teacher", meeting_mode: null, date: null } });
    const prep = buildFallbackPrep(input, []);
    expect(prep.agenda.raised_by).toBe("teacher");
    expect(prep.discussion_points[0].title).toMatch(/Your reason/);
  });
  it("orders by priority and groups one point per category", () => {
    const input = base({
      attendance: [...manyAtt(6, "absent"), ...manyAtt(4, "present", 10)],
      marks: [{ subject: "Maths", obtained: 45, max: 100, at: day(3) }, { subject: "Science", obtained: 30, max: 100, at: day(3) }],
    });
    const prep = buildFallbackPrep(input, buildSignals(input));
    const cats = prep.discussion_points.map((p) => p.category);
    expect(new Set(cats).size).toBe(cats.length);
    expect(prep.discussion_points[0].priority).toBe("high");
  });
  it("is honest when there is no data", () => {
    const prep = buildFallbackPrep(base(), []);
    expect(prep.summary).toMatch(/little recorded data/i);
    expect(prep.discussion_points).toEqual([]);
    expect(prep.data_gaps.length).toBeGreaterThan(0);
    expect(prep.proposed_next_steps.length).toBeGreaterThan(0);
  });
  it("lists strengths to open with", () => {
    const input = base({ marks: [{ subject: "English", obtained: 95, max: 100, at: day(3) }] });
    const prep = buildFallbackPrep(input, buildSignals(input));
    expect(prep.strengths[0].title).toMatch(/English/);
  });
});

describe("buildSnapshot", () => {
  it("reports the last meeting and behaviour counts", () => {
    const snap = buildSnapshot(base({
      previous_meetings: [{ date: "2026-08-01", reason_category: "academic_concern", reason_note: null }],
      behaviour: [{ category: "positive", title: "Helped", points: 2, date: day(3), action_taken: null }, { category: "negative", title: "Late", points: -1, date: day(4), action_taken: null }],
    }));
    expect(snap.last_meeting).toEqual({ date: "2026-08-01", reason: "Academic concern" });
    expect(snap.behaviour).toEqual({ positive: 1, negative: 1, net_points: 1 });
  });
});

describe("sanitiseAiPrep", () => {
  const input = base({
    appointment: { reason_category: "academic_concern", reason_note: "Maths worries", requested_by: "parent", meeting_mode: null, date: null },
    marks: [{ subject: "Maths", obtained: 30, max: 100, at: day(3) }],
  });
  const signals = buildSignals(input);
  const fallback = buildFallbackPrep(input, signals);

  it("returns null for unusable model output", () => {
    expect(sanitiseAiPrep(null, input, signals, fallback)).toBeNull();
    expect(sanitiseAiPrep({ discussion_points: "nope" }, input, signals, fallback)).toBeNull();
    expect(sanitiseAiPrep({ discussion_points: [] }, input, signals, fallback)).toBeNull();
  });
  it("drops points that cite no real signal (hallucination guard)", () => {
    const out = sanitiseAiPrep({
      discussion_points: [
        { title: "Invented issue", category: "behaviour", priority: "high", approach: "Say things", signal_ids: ["made_up_id"] },
        { title: "Maths support", category: "academics", priority: "medium", approach: "Ask about study habits", signal_ids: ["marks_maths"] },
      ],
    }, input, signals, fallback);
    expect(out!.discussion_points.map((p) => p.title)).toEqual(["Maths support"]);
  });
  it("takes evidence from the signals, never from model text", () => {
    const out = sanitiseAiPrep({
      discussion_points: [{ title: "Maths", category: "academics", priority: "high", approach: "Talk", signal_ids: ["marks_maths"], evidence: ["Maths average 99%"] }],
    }, input, signals, fallback)!;
    expect(out.discussion_points[0].evidence[0]).toContain("30%");
    expect(JSON.stringify(out)).not.toContain("99%");
  });
  it("only accepts an agenda point when a real agenda exists, and puts it first", () => {
    const withAgenda = sanitiseAiPrep({
      discussion_points: [
        { title: "Maths support", category: "academics", priority: "high", approach: "Ask", signal_ids: ["marks_maths"] },
        { title: "Their worry", category: "agenda", priority: "low", approach: "Listen first", signal_ids: [] },
      ],
    }, input, signals, fallback)!;
    expect(withAgenda.discussion_points[0].category).toBe("agenda");
    expect(withAgenda.discussion_points[0].evidence[0]).toContain("Maths worries");

    const noAgendaInput = base({ marks: input.marks });
    const s2 = buildSignals(noAgendaInput);
    const out = sanitiseAiPrep({
      discussion_points: [{ title: "Invented agenda", category: "agenda", priority: "high", approach: "x", signal_ids: [] }],
    }, noAgendaInput, s2, buildFallbackPrep(noAgendaInput, s2));
    expect(out).toBeNull();
  });
  it("normalises bad enums, caps lengths and counts, restores names", () => {
    const out = sanitiseAiPrep({
      summary: "x".repeat(2000),
      discussion_points: Array.from({ length: 12 }, (_, i) => ({
        title: `Point ${i} about STU_01`, category: "bogus", priority: "urgent", approach: "y".repeat(2000), signal_ids: ["marks_maths"],
      })),
      questions_for_parent: Array.from({ length: 10 }, (_, i) => `Q${i}`),
      proposed_next_steps: [],
    }, input, signals, fallback, (t) => t.replace(/STU_01/g, "Aarav"))!;
    expect(out.discussion_points.length).toBeLessThanOrEqual(6);
    expect(out.discussion_points[0].category).toBe("academics");
    expect(["high", "medium", "low"]).toContain(out.discussion_points[0].priority);
    expect(out.discussion_points[0].title).toContain("Aarav");
    expect(out.discussion_points[0].approach.length).toBeLessThanOrEqual(400);
    expect(out.summary.length).toBeLessThanOrEqual(420);
    expect(out.questions_for_parent.length).toBe(4);
    expect(out.proposed_next_steps).toEqual(fallback.proposed_next_steps); // empty -> fallback
  });
  it("never lets the model replace the snapshot or data gaps", () => {
    const out = sanitiseAiPrep({
      discussion_points: [{ title: "Maths", category: "academics", priority: "high", approach: "Talk", signal_ids: ["marks_maths"] }],
      snapshot: { avg_marks_pct: 100 }, data_gaps: [],
    }, input, signals, fallback)!;
    expect(out.snapshot).toEqual(fallback.snapshot);
    expect(out.data_gaps).toEqual(fallback.data_gaps);
  });
});

describe("parseAiJson", () => {
  it("handles fenced and chatty output", () => {
    expect(parseAiJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseAiJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(parseAiJson("not json")).toBeNull();
  });
});

describe("buildAiUserPrompt", () => {
  it("scrubs the student's name and never includes raw records or a parent name", () => {
    const input = base({
      appointment: { reason_category: "academic_concern", reason_note: "Is Aarav Sharma coping?", requested_by: "parent", meeting_mode: null, date: null },
      marks: [{ subject: "Maths", obtained: 10, max: 100, at: day(3) }],
    });
    const prompt = buildAiUserPrompt(input, buildSignals(input), (t) => t.replace(/Aarav Sharma/gi, "STU_01"));
    expect(prompt).toContain("STU_01");
    expect(prompt).not.toContain("Aarav");
    expect(prompt).toContain("marks_maths");
  });
});

describe("appointmentFingerprint", () => {
  it("changes when the agenda changes", () => {
    const a = appointmentFingerprint({ reason_category: "academic_concern", reason_note: "a", appointment_date: "2026-10-05", teacher_id: "t", student_id: "s" });
    const b = appointmentFingerprint({ reason_category: "academic_concern", reason_note: "b", appointment_date: "2026-10-05", teacher_id: "t", student_id: "s" });
    expect(a).not.toBe(b);
  });
});
