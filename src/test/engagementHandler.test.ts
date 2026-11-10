// End-to-end test of the engagement edge handler against an in-memory stand-in for Supabase.
// The data below is seeded as realistic APAS rows; every expected number is worked out by hand in the comments.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => {
  (globalThis as any).Deno = { env: { get: (_: string) => "x" } };
  return { db: {} as Record<string, any[]>, failTables: new Set<string>(), writes: { scoreUpserts: 0 } };
});

type Row = Record<string, any>;
const cmp = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);

class Q {
  private filters: ((r: Row) => boolean)[] = [];
  private orderBy: string | null = null;
  private lo = 0; private hi = Infinity;
  private op: "select" | "upsert" | "delete" = "select";
  private payload: Row[] = []; private conflict = "";
  private single = false;
  constructor(private table: string, private cols = "*") {}
  select(cols = "*") { this.cols = cols; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] !== null && r[c] !== undefined && cmp(String(r[c]), String(v)) >= 0); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] !== null && r[c] !== undefined && cmp(String(r[c]), String(v)) <= 0); return this; }
  order(c: string) { this.orderBy = c; return this; }
  range(a: number, b: number) { this.lo = a; this.hi = b; return this; }
  limit(n: number) { this.lo = 0; this.hi = n - 1; return this; }
  maybeSingle() { this.single = true; return this; }
  upsert(rows: Row | Row[], o: { onConflict: string }) { this.op = "upsert"; this.payload = Array.isArray(rows) ? rows : [rows]; this.conflict = o.onConflict; return this; }
  delete() { this.op = "delete"; return this; }
  then(res: (v: any) => any, rej?: (e: any) => any) { return Promise.resolve(this.run()).then(res, rej); }
  private run() {
    if (h.failTables.has(this.table)) return { data: null, error: { message: `relation "${this.table}" does not exist` } };
    const rows = (h.db[this.table] ??= []);
    if (this.op === "upsert") {
      if (this.table === "engagement_scores") h.writes.scoreUpserts += this.payload.length;
      const keys = this.conflict.split(",");
      for (const p of this.payload) {
        const i = rows.findIndex((r) => keys.every((k) => r[k] === p[k]));
        if (i >= 0) rows[i] = { ...rows[i], ...p }; else rows.push({ ...p });
      }
      return { data: null, error: null };
    }
    if (this.op === "delete") {
      h.db[this.table] = rows.filter((r) => !this.filters.every((f) => f(r)));
      return { data: null, error: null };
    }
    let out = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderBy) out = [...out].sort((a, b) => cmp(a[this.orderBy!], b[this.orderBy!]));
    out = out.slice(this.lo, Math.min(this.hi, 1e9) + 1);
    if (this.table === "class_teachers" && this.cols.includes("classes(")) {
      out = out.map((r) => ({ ...r, classes: (h.db.classes ?? []).find((c) => c.id === r.class_id) ?? null }));
    }
    return { data: this.single ? (out[0] ?? null) : out, error: null };
  }
}

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: (_url: string, key: string, opts?: { global?: { headers?: Record<string, string> } }) => {
    const token = opts?.global?.headers?.Authorization?.replace("Bearer ", "");
    return {
      from: (t: string) => new Q(t),
      auth: { getUser: async () => (token ? { data: { user: { id: token } }, error: null } : { data: { user: null }, error: { message: "no" } }) },
    };
  },
}));

import { handleEngagementScore } from "../../supabase/functions/_shared/handlers/engagementScore";

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0); // 9 Nov 2026 12:00 UTC
const DAY = 86_400_000;
const iso = (daysAgo: number, h = 0) => new Date(NOW - daysAgo * DAY + h * 3_600_000).toISOString();
const dateOf = (daysAgo: number) => iso(daysAgo).slice(0, 10);

const S1 = "s1", S2 = "s2";
const P = { A: "pA", B: "pB", C: "pC", D: "pD", T: "tT", T2: "tT2", AD1: "ad1", AD2: "ad2", PR: "pr1" };
const ST = { A: "11111111-1111-1111-1111-11111111111a", B: "11111111-1111-1111-1111-11111111111b", C: "11111111-1111-1111-1111-11111111111c", D: "11111111-1111-1111-1111-11111111111d" };
const CL = { c5A: "22222222-2222-2222-2222-22222222222a", c5B: "22222222-2222-2222-2222-22222222222b", c5C: "22222222-2222-2222-2222-22222222222c" };

function seed() {
  const ev = (n: number, student: string, type: string, daysAgo: number, payload: Row, source: string | null = null, ref: string | null = null) =>
    ({ id: n, student_id: student, event_type: type, source, ref_id: ref, payload, occurred_at: iso(daysAgo) });
  h.db = {
    profiles: [
      { id: P.A, role: "student", school_id: S1, full_name: "Asha" }, { id: P.B, role: "student", school_id: S1, full_name: "Bala" },
      { id: P.C, role: "student", school_id: S2, full_name: "Chitra" }, { id: P.D, role: "student", school_id: S1, full_name: "Deepak" },
      { id: P.T, role: "teacher", school_id: S1 }, { id: P.T2, role: "teacher", school_id: S1 },
      { id: P.AD1, role: "admin", school_id: S1 }, { id: P.AD2, role: "admin", school_id: S2 }, { id: P.PR, role: "principal", school_id: S1 },
    ],
    students: [
      { id: ST.A, profile_id: P.A, grade: "5" }, { id: ST.B, profile_id: P.B, grade: "5" },
      { id: ST.C, profile_id: P.C, grade: "5" }, { id: ST.D, profile_id: P.D, grade: "9" },
    ],
    classes: [{ id: CL.c5A, name: "Class 5", section: "A" }, { id: CL.c5B, name: "Class 5", section: "B" }, { id: CL.c5C, name: "Class 5", section: "C" }],
    class_students: [
      { id: 1, class_id: CL.c5A, student_id: ST.A }, { id: 2, class_id: CL.c5B, student_id: ST.B }, { id: 3, class_id: CL.c5C, student_id: ST.C },
    ],
    class_teachers: [{ id: 1, class_id: CL.c5A, teacher_id: P.T }],
    marketplace_listings: [
      ...["v1", "v2", "v3"].map((id) => ({ id, content_type: "video", status: "published", class_label: "5", publisher_school_id: S1, published_at: iso(40), created_at: iso(40) })),
      { id: "vX", content_type: "video", status: "published", class_label: "5", publisher_school_id: S2, published_at: iso(40), created_at: iso(40) },
    ],
    learning_events: [
      ev(1, ST.A, "video_progress", 4, { resource_id: "v1", watched_seconds: 600, video_duration: 600 }, "client", "v1"), // 100%
      ev(2, ST.A, "video_progress", 3, { resource_id: "v2", watched_seconds: 300, video_duration: 600 }, "client", "v2"), // 50%
      ev(3, ST.A, "tutor_message", 1, { chars: 80 }, "tutor"), ev(4, ST.A, "tutor_message", 2, { chars: 90 }, "tutor"), ev(5, ST.A, "tutor_message", 3, { chars: 60 }, "tutor"),
      ev(6, ST.A, "tutor_message", 3, { chars: 5 }, "tutor"),      // too short: not a meaningful doubt
      ev(7, ST.A, "tutor_message", 2, { chars: 200 }, "career"),   // career coach: not a doubt
    ],
    generated_assessment_papers: [],
    generated_assessment_paper_assignments: [
      { id: "p1", due_at: iso(20), opens_at: iso(25), created_at: iso(25) }, { id: "p2", due_at: iso(12), opens_at: iso(15), created_at: iso(15) },
      { id: "p3", due_at: iso(3), opens_at: iso(6), created_at: iso(6) },
    ],
    generated_assessment_paper_attempts: [
      { id: 1, assignment_id: "p1", student_id: ST.A, status: "submitted", submitted_at: iso(21), created_at: iso(25) },
      { id: 2, assignment_id: "p2", student_id: ST.A, status: "graded", submitted_at: iso(13), created_at: iso(15) },
      { id: 3, assignment_id: "p3", student_id: ST.A, status: "in_progress", submitted_at: null, created_at: iso(6) },
    ],
    worksheet_assignments: [
      { id: "w1", school_id: S1, class_level: "5", section: "A", assigned_at: iso(20), due_date: iso(10), status: "active" },
      { id: "wZ", school_id: S1, class_level: "5", section: "Z", assigned_at: iso(20), due_date: iso(10), status: "active" }, // a class nobody here is in
    ],
    worksheet_submissions: [{ id: 1, assignment_id: "w1", student_id: P.A, submitted_at: iso(12), status: "submitted", created_at: iso(12) }],
    homework_assignments: [{ id: "h1", class_level: "Class 5", section: "A", assigned_by: P.T, created_at: iso(15) }],
    homework_submissions: [{ id: 1, assignment_id: "h1", student_id: P.A, submitted_at: iso(14) }],
    virtual_classroom_sessions: [{
      id: "s1", class_id: CL.c5A, status: "scheduled", scheduled_start: `${dateOf(5)}T03:30:00.000Z`, scheduled_end: `${dateOf(5)}T04:30:00.000Z`, recurrence_end_date: dateOf(1),
    }],
    virtual_classroom_attendance: [5, 4, 2].map((d, i) => ({ id: i + 1, session_id: "s1", student_id: ST.A, session_date: dateOf(d), attendance_status: "joined" })),
    classroom_posts: [], engagement_scores: [], engagement_score_history: [], engagement_recalc_queue: [], engagement_settings: [],
  };
  h.failTables.clear();
  h.writes.scoreUpserts = 0;
}

async function call(uid: string, action: string, extra: Row = {}) {
  const res = await handleEngagementScore(new Request("http://local/fn", {
    method: "POST", headers: { Authorization: `Bearer ${uid}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }),
  }));
  return { status: res.status, body: await res.json() as any };
}

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => { vi.setSystemTime(NOW); seed(); });

/** Previous period (30-60 days ago): three quizzes all submitted. Now: two of the older ones undone. Quiz-only weights. */
function makeAshaDecline() {
  for (const [i, id] of ["q1", "q2", "q3"].entries()) {
    h.db.generated_assessment_paper_assignments.push({ id, due_at: iso(40 - i), opens_at: iso(50), created_at: iso(50) });
    h.db.generated_assessment_paper_attempts.push({ id: 10 + i, assignment_id: id, student_id: ST.A, status: "submitted", submitted_at: iso(45 - i), created_at: iso(50) });
  }
  h.db.learning_events.length = 0;
  h.db.engagement_settings.push({ school_id: S1, config: { weights: { video: 0, quiz: 100, assignment: 0, live_class: 0, interaction: 0 }, min_opportunities: 1 } });
  for (const a of h.db.generated_assessment_paper_attempts.slice(0, 2)) Object.assign(a, { status: "assigned", submitted_at: null });
}

describe("1-6. a student's score is built from their real activity", () => {
  it("computes each activity and the weighted total (hand-checked)", async () => {
    const { status, body } = await call(P.A, "me");
    expect(status).toBe(200);
    const a = body.score.activities;
    expect(a.video.score).toBe(50);          // watched 100% of v1 + 50% of v2 = 1.5 credit of 3 expected
    expect(a.quiz.score).toBe(83.3);         // submitted + graded + started(0.5) = 2.5 of 3
    expect(a.assignment.score).toBe(100);    // worksheet on time + homework submitted
    expect(a.live_class.score).toBe(60);     // 5 daily classes, joined 3
    expect(a.live_class.opportunities).toBe(5);
    expect(a.interaction.score).toBe(60);    // 3 meaningful doubts of 5 (short message + career coach ignored)
    // (50*20 + 83.3*25 + 100*25 + 60*20 + 60*10) / 100 = 73.8
    expect(body.score.status).toBe("ok");
    expect(body.score.score).toBe(73.8);
    expect(body.score.category).toBe("moderately_engaged");
    expect(body.score.category_label).toBe("Moderately Engaged");
    expect(body.score.tips.length).toBeGreaterThan(0);
  });

  it("the video activity ignores videos from another school", async () => {
    const { body } = await call(P.A, "me");
    expect(body.score.activities.video.opportunities).toBe(3); // v1,v2,v3 only, not vX
  });

  it("stores the latest score and one history snapshot", async () => {
    await call(P.A, "me");
    expect(h.db.engagement_scores).toHaveLength(1);
    expect(h.db.engagement_scores[0]).toMatchObject({ student_id: ST.A, school_id: S1, status: "ok", score: 73.8 });
    expect(h.db.engagement_score_history).toHaveLength(1);
    await call(P.A, "me", { force: true });
    expect(h.db.engagement_score_history).toHaveLength(1); // same day -> overwritten, never duplicated
  });

  it("returns 'Not enough data' for a student with no assigned activity", async () => {
    const { body } = await call(P.D, "me");
    expect(body.score.status).toBe("insufficient");
    expect(body.score.score).toBeNull();
    expect(body.score.category).toBeNull();
  });

  it("a student with unassigned activities is not penalised for them", async () => {
    // B is in 5B: videos exist (0 watched) but there is no quiz / worksheet / live class / homework for 5B at all.
    const { body } = await call(P.B, "me");
    const a = body.score.activities;
    expect(a.quiz.available).toBe(false);
    expect(a.assignment.available).toBe(false);
    expect(a.live_class.available).toBe(false);
    expect(a.video.available).toBe(true);
  });
});

describe("7. duplicate events do not inflate the score", () => {
  it("fifty repeated progress events change nothing", async () => {
    const before = (await call(P.A, "me", { force: true })).body.score.score;
    for (let i = 0; i < 50; i++) h.db.learning_events.push({ id: 100 + i, student_id: ST.A, event_type: "video_progress", source: "client", ref_id: "v2", payload: { resource_id: "v2", watched_seconds: 300, video_duration: 600 }, occurred_at: iso(3) });
    const after = (await call(P.A, "me", { force: true })).body.score.score;
    expect(after).toBe(before);
  });
  it("a duplicate classroom/tutor flood is capped per day", async () => {
    for (let i = 0; i < 40; i++) h.db.learning_events.push({ id: 200 + i, student_id: ST.A, event_type: "tutor_message", source: "tutor", ref_id: null, payload: { chars: 100 }, occurred_at: iso(6) });
    const { body } = await call(P.A, "me", { force: true });
    expect(body.score.activities.interaction.credit).toBe(6); // 3 earlier doubts + at most 3 on the flooded day
  });
});

describe("10. scores update automatically, cheaply", () => {
  it("does not recalculate while nothing is new", async () => {
    await call(P.A, "me");
    const n = h.writes.scoreUpserts;
    await call(P.A, "me"); await call(P.A, "me");
    expect(h.writes.scoreUpserts).toBe(n);
  });
  it("new activity is picked up after the cool-down, and the queue marker is cleared", async () => {
    const first = (await call(P.A, "me")).body.score.score;
    // The student submits the third quiz; the DB trigger marks them dirty.
    Object.assign(h.db.generated_assessment_paper_attempts[2], { status: "submitted", submitted_at: iso(0, -1) });
    h.db.engagement_recalc_queue.push({ student_id: ST.A, school_id: S1, reason: "quiz", requested_at: new Date(NOW + 1000).toISOString() });
    vi.setSystemTime(NOW + 60_000); // 1 minute later: inside the cool-down, so a burst costs nothing
    expect((await call(P.A, "me")).body.score.score).toBe(first);
    vi.setSystemTime(NOW + 6 * 60_000); // after the cool-down
    const updated = (await call(P.A, "me")).body.score;
    expect(updated.score).toBeGreaterThan(first);
    expect(updated.activities.quiz.score).toBe(100);
    expect(h.db.engagement_recalc_queue).toHaveLength(0);
  });
  it("activity recorded WHILE recalculating stays queued", async () => {
    await call(P.A, "me");
    h.db.engagement_recalc_queue.push({ student_id: ST.A, requested_at: new Date(NOW + 10 * 60_000).toISOString() });
    vi.setSystemTime(NOW + 6 * 60_000);
    await call(P.A, "me", { force: true });
    expect(h.db.engagement_recalc_queue).toHaveLength(1); // newer than this calculation
  });
});

describe("13. history and comparison with the previous period", () => {
  it("rebuilds the previous period from timestamps (nothing existed or was done then)", async () => {
    // 30-60 days ago: the three videos were already published but nothing else existed and none was watched.
    const { body } = await call(P.A, "me");
    expect(body.score.previous_score).toBe(0);
    expect(body.score.trend).toBe("up");
    expect(body.score.delta).toBe(73.8);
  });
  it("has no comparison when the previous period had too little data", async () => {
    // D has nothing in either period.
    const { body } = await call(P.D, "me");
    expect(body.score.trend).toBe("unknown");
    expect(body.score.delta).toBeNull();
  });
  it("detects a declining student from real previous-period data", async () => {
    makeAshaDecline();
    const { body } = await call(P.A, "me", { force: true });
    expect(body.score.previous_score).toBe(100);
    expect(body.score.score).toBeLessThan(100);
    expect(body.score.declining).toBe(true);
    expect(body.score.trend).toBe("down");
  });
  it("returns the stored daily history for the trend graph", async () => {
    await call(P.A, "me");
    const { body } = await call(P.A, "me");
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({ date: dateOf(0), score: 73.8 });
  });
});

describe("11. teachers see only the students they teach", () => {
  it("can open their own class and student", async () => {
    const cls = await call(P.T, "class", { class_id: CL.c5A });
    expect(cls.status).toBe(200);
    expect(cls.body.students.map((s: Row) => s.name)).toEqual(["Asha"]);
    expect(cls.body.summary.average).toBe(73.8);
    expect((await call(P.T, "student", { student_id: ST.A })).status).toBe(200);
  });
  it("cannot open another class or a student outside their classes", async () => {
    expect((await call(P.T, "class", { class_id: CL.c5B })).status).toBe(403);
    expect((await call(P.T, "student", { student_id: ST.B })).status).toBe(403);
    expect((await call(P.T, "student", { student_id: ST.C })).status).toBe(403);
  });
  it("a teacher with no classes sees nothing", async () => {
    expect((await call(P.T2, "class", { class_id: CL.c5A })).status).toBe(403);
    const ov = await call(P.T2, "overview");
    expect(ov.body.classes).toEqual([]);
    expect(ov.body.summary.roster).toBe(0);
  });
  it("the teacher overview lists only their classes and flags missing activities", async () => {
    const { body } = await call(P.T, "overview");
    expect(body.scope).toBe("teacher");
    expect(body.classes.map((c: Row) => c.class_id)).toEqual([CL.c5A]);
    const cls = (await call(P.T, "class", { class_id: CL.c5A })).body;
    expect(cls.summary.activity_averages.video).toBe(50);
  });
});

describe("12. admins and principals see their own school only", () => {
  it("school overview covers every student in the school and none from another", async () => {
    const { body } = await call(P.AD1, "overview");
    expect(body.scope).toBe("school");
    expect(body.summary.roster).toBe(3); // A, B, D
    const names = [...body.most_engaged, ...body.least_engaged].map((s: Row) => s.name);
    expect(names).not.toContain("Chitra");
    expect(body.classes.some((c: Row) => c.class_id === CL.c5C)).toBe(false); // class with only the other school's student
    expect(body.summary.scored).toBe(2); // A and B have scores; D has not enough data
    expect(body.summary.insufficient).toBe(0 + (body.summary.students - body.summary.scored));
  });
  it("the principal gets the same school view", async () => {
    const { body } = await call(P.PR, "overview");
    expect(body.summary.roster).toBe(3);
  });
  it("the other school sees only its own student", async () => {
    const { body } = await call(P.AD2, "overview");
    expect(body.summary.roster).toBe(1);
    expect(body.classes.map((c: Row) => c.class_id)).toEqual([CL.c5C]);
  });
  it("cannot open a student from another school", async () => {
    expect((await call(P.AD1, "student", { student_id: ST.C })).status).toBe(403);
    expect((await call(P.AD2, "student", { student_id: ST.A })).status).toBe(403);
    expect((await call(P.AD1, "class", { class_id: CL.c5C })).status).toBe(403);
  });
  it("lists a declining student for the school and for their teacher", async () => {
    makeAshaDecline();
    const school = (await call(P.AD1, "overview", { force: true })).body;
    expect(school.declining.map((s: Row) => s.name)).toEqual(["Asha"]);
    expect(school.declining[0].delta).toBeLessThan(0);
    const teacher = (await call(P.T, "overview")).body;
    expect(teacher.declining.map((s: Row) => s.name)).toEqual(["Asha"]);
    expect(teacher.summary.declining).toBe(1);
  });
});

describe("students cannot use staff views", () => {
  it("rejects class, student and overview requests from a student", async () => {
    expect((await call(P.A, "class", { class_id: CL.c5A })).status).toBe(403);
    expect((await call(P.A, "student", { student_id: ST.B })).status).toBe(403);
    expect((await call(P.A, "overview")).status).toBe(403);
  });
  it("a staff account cannot call the student-only action", async () => {
    expect((await call(P.T, "me")).status).toBe(403);
  });
  it("rejects unauthenticated and unknown requests", async () => {
    const res = await handleEngagementScore(new Request("http://local/fn", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    expect((await call(P.A, "nope")).status).toBe(400);
  });
});

describe("configurable weights", () => {
  it("school staff can change them; students and teachers cannot", async () => {
    expect((await call(P.T, "settings_save", { config: { weights: { video: 50 } } })).status).toBe(403);
    expect((await call(P.A, "settings_save", { config: {} })).status).toBe(403);
    const ok = await call(P.AD1, "settings_save", { config: { weights: { video: 0, quiz: 100, assignment: 0, live_class: 0, interaction: 0 } } });
    expect(ok.status).toBe(200);
    expect(h.db.engagement_settings[0]).toMatchObject({ school_id: S1 });
  });
  it("saved weights change the next score (stored scores are recomputed lazily)", async () => {
    const before = (await call(P.A, "me")).body.score.score;
    await call(P.AD1, "settings_save", { config: { weights: { video: 0, quiz: 100, assignment: 0, live_class: 0, interaction: 0 } } });
    const after = (await call(P.A, "me")).body.score;
    expect(after.score).toBe(83.3); // quiz-only
    expect(after.score).not.toBe(before);
  });
  it("junk settings are clamped to safe values", async () => {
    const { body } = await call(P.AD1, "settings_save", { config: { weights: { video: -5, quiz: "abc" }, window_days: 100000 } });
    expect(body.config.window_days).toBe(90);
    expect(body.config.weights.video).toBe(0);
    expect(body.config.weights.quiz).toBe(25);
  });
});

describe("missing data sources never break scoring", () => {
  it("skips live classes when the table is unavailable and says so", async () => {
    h.failTables.add("virtual_classroom_sessions");
    h.failTables.add("virtual_classroom_attendance");
    const { status, body } = await call(P.A, "me");
    expect(status).toBe(200);
    expect(body.sources_unavailable).toContain("live_class");
    expect(body.score.activities.live_class.available).toBe(false);
    expect(body.score.status).toBe("ok"); // the other activities still produce a score
  });
});
