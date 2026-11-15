/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory Supabase / hook stand-ins are intentionally loosely typed */
// Runs the REAL spaced-repetition handler against an in-memory stand-in for Supabase, to prove that negative marking
//   * scores correct / wrong / skipped as configured,
//   * never changes what reaches record_mastery_evidence (so BKT + the SM-2 trigger behave exactly as before),
//   * scores each scheduled review once (no retry-farming) and rolls back if grading fails,
//   * can't be configured by students / teachers or across schools, and
//   * never blocks Daily Review when marking is off or its tables are missing.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  (globalThis as any).Deno = { env: { get: (_: string) => "x" } };
  return {
    db: {} as Record<string, any[]>,
    failTables: new Set<string>(),
    evidenceFails: false,
    rpcCalls: [] as { name: string; args: any }[],
  };
});

type Row = Record<string, any>;
const UNIQUE: Record<string, string[]> = { daily_review_marks: ["student_id", "schedule_id", "due_at"], daily_review_settings: ["school_id"] };

class Q {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "upsert" | "delete" = "select";
  private payload: Row[] = []; private conflict = ""; private ignoreDup = false;
  private mode: "many" | "maybe" | "single" = "many";
  private lim = Infinity;
  constructor(private table: string) {}
  select(_c?: string, _o?: any) { return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "single"; return this; }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows: Row | Row[], o: { onConflict: string; ignoreDuplicates?: boolean }) { this.op = "upsert"; this.payload = Array.isArray(rows) ? rows : [rows]; this.conflict = o.onConflict; this.ignoreDup = !!o.ignoreDuplicates; return this; }
  delete() { this.op = "delete"; return this; }
  then(res: (v: any) => any, rej?: (e: any) => any) { return Promise.resolve(this.run()).then(res, rej); }
  private run() {
    if (h.failTables.has(this.table)) return { data: null, error: { code: "42P01", message: `relation "${this.table}" does not exist` } };
    const rows = (h.db[this.table] ??= []);
    const keys = UNIQUE[this.table] ?? [];
    const clash = (p: Row) => keys.length > 0 && rows.some((r) => keys.every((k) => r[k] === p[k]));
    if (this.op === "insert") {
      const inserted: Row[] = [];
      for (const p of this.payload) {
        if (clash(p)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        const row = { id: p.id ?? `${this.table}-${rows.length + 1}`, ...p }; rows.push(row); inserted.push(row);
      }
      return this.shape(inserted);
    }
    if (this.op === "upsert") {
      const ks = this.conflict.split(",");
      for (const p of this.payload) {
        const i = rows.findIndex((r) => ks.every((k) => r[k] === p[k]));
        if (i >= 0) { if (!this.ignoreDup) rows[i] = { ...rows[i], ...p }; } else rows.push({ id: `${this.table}-${rows.length + 1}`, ...p });
      }
      return { data: null, error: null };
    }
    if (this.op === "delete") { h.db[this.table] = rows.filter((r) => !this.filters.every((f) => f(r))); return { data: null, error: null }; }
    return this.shape(rows.filter((r) => this.filters.every((f) => f(r))).slice(0, this.lim));
  }
  private shape(out: Row[]) {
    if (this.mode === "many") return { data: out, error: null };
    if (!out.length) return this.mode === "single" ? { data: null, error: { message: "no rows" } } : { data: null, error: null };
    return { data: out[0], error: null };
  }
}

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: (_url: string, key: string, opts?: { global?: { headers?: Record<string, string> } }) => {
    const token = (opts?.global?.headers?.Authorization ?? "").replace("Bearer ", "");
    return {
      auth: { getUser: async () => (token.startsWith("u-") ? { data: { user: { id: token } }, error: null } : { data: { user: null }, error: { message: "bad" } }) },
      from: (t: string) => new Q(t),
      rpc: async (name: string, args: any) => {
        h.rpcCalls.push({ name, args });
        if (name === "record_mastery_evidence") return h.evidenceFails ? { data: null, error: { message: "boom" } } : { data: [{ p_mastery_before: 0.4, p_mastery_after: 0.55 }], error: null };
        if (name === "reschedule_review") return { data: [{ due_at: "2026-11-12T09:00:00Z" }], error: null };
        if (name === "get_due_reviews") return { data: [], error: null };
        return { data: null, error: null };
      },
    };
  },
}));

import { handleSpacedRepetition } from "../../supabase/functions/_shared/handlers/spacedRepetition";

const PAST = "2026-11-10T09:00:00Z";
const FUTURE = "2099-01-01T00:00:00Z";
const call = async (user: string, body: Row) => {
  const res = await handleSpacedRepetition(new Request("http://x/", { method: "POST", headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const answer = (user: string, sched: string, item: string, option: string, extra: Row = {}) =>
  call(user, { action: "session-answer", schedule_id: sched, learning_objective_id: 7, item_id: item, selected_option: option, session_id: "sess-1", session_total: 5, ...extra });
const evidenceCalls = () => h.rpcCalls.filter((c) => c.name === "record_mastery_evidence");
const marksRows = () => h.db.daily_review_marks ?? [];

const enable = (marks = 1, penalty = 0.25, school = "school-A") =>
  (h.db.daily_review_settings = [{ school_id: school, negative_marking_enabled: true, marks_per_correct: marks, negative_marks_per_wrong: penalty }]);

beforeEach(() => {
  h.failTables.clear(); h.evidenceFails = false; h.rpcCalls.length = 0;
  h.db = {
    profiles: [
      { id: "u-s1", role: "student", school_id: "school-A" },
      { id: "u-s2", role: "student", school_id: "school-A" },
      { id: "u-sB", role: "student", school_id: "school-B" },
      { id: "u-teacher", role: "teacher", school_id: "school-A" },
      { id: "u-sa", role: "school_admin", school_id: "school-A" },
      { id: "u-principal", role: "principal", school_id: "school-A" },
      { id: "u-admin", role: "admin", school_id: "school-A" },
      { id: "u-hod", role: "hod", school_id: "school-A" },
      { id: "u-principalB", role: "principal", school_id: "school-B" },
      { id: "u-noschool", role: "principal", school_id: null },
    ],
    students: [{ id: "st1", profile_id: "u-s1" }, { id: "st2", profile_id: "u-s2" }, { id: "stB", profile_id: "u-sB" }],
    review_schedule: [
      { id: "11111111-1111-1111-1111-111111111111", student_id: "st1", learning_objective_id: 7, due_at: PAST, suspended: false },
      { id: "22222222-2222-2222-2222-222222222222", student_id: "st1", learning_objective_id: 7, due_at: PAST, suspended: false },
      { id: "33333333-3333-3333-3333-333333333333", student_id: "st1", learning_objective_id: 7, due_at: PAST, suspended: false },
      { id: "44444444-4444-4444-4444-444444444444", student_id: "st1", learning_objective_id: 7, due_at: FUTURE, suspended: false },
      { id: "55555555-5555-5555-5555-555555555555", student_id: "st2", learning_objective_id: 7, due_at: PAST, suspended: false },
    ],
    question_bank: [
      { id: "item-1", status: "active", correct_option: "B", explanation: "Because B.", learning_objective_id: 7 },
      { id: "item-2", status: "active", correct_option: "C", explanation: "Because C.", learning_objective_id: 7 },
    ],
    daily_review_settings: [], daily_review_marks: [],
  };
});

const S1 = "11111111-1111-1111-1111-111111111111", S2 = "22222222-2222-2222-2222-222222222222", S3 = "33333333-3333-3333-3333-333333333333";
const S_FUTURE = "44444444-4444-4444-4444-444444444444", S_OTHER = "55555555-5555-5555-5555-555555555555";

describe("marking OFF (the default): Daily Review is exactly as before", () => {
  it("grades, records evidence and writes no marks", async () => {
    const r = await answer("u-s1", S1, "item-1", "B");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ is_correct: true, correct_option: "B", p_mastery_before: 0.4, scoring: { enabled: false, counted: false } });
    expect(marksRows()).toHaveLength(0);
    expect(evidenceCalls()).toHaveLength(1);
  });
  it("still works when the marking tables don't exist yet (code deployed before the migration)", async () => {
    h.failTables.add("daily_review_settings"); h.failTables.add("daily_review_marks");
    const r = await answer("u-s1", S1, "item-1", "A");
    expect(r.status).toBe(200);
    expect(r.body.is_correct).toBe(false);
    expect(evidenceCalls()).toHaveLength(1);
  });
});

describe("marking ON", () => {
  beforeEach(() => enable(1, 0.25));

  it("correct answer: +marks", async () => {
    const r = await answer("u-s1", S1, "item-1", "B");
    expect(r.body.scoring).toMatchObject({ enabled: true, counted: true, outcome: "correct", marks: 1 });
    expect(marksRows()[0]).toMatchObject({ student_id: "st1", outcome: "correct", marks: 1, marks_for_correct: 1, penalty: 0.25, session_id: "sess-1" });
  });

  it("wrong answer: -penalty", async () => {
    const r = await answer("u-s1", S1, "item-1", "A");
    expect(r.body.scoring).toMatchObject({ counted: true, outcome: "wrong", marks: -0.25 });
    expect(marksRows()[0]).toMatchObject({ outcome: "wrong", marks: -0.25 });
  });

  it("uses the configured values", async () => {
    enable(4, 1);
    expect((await answer("u-s1", S1, "item-1", "B")).body.scoring.marks).toBe(4);
    expect((await answer("u-s1", S2, "item-1", "D")).body.scoring.marks).toBe(-1);
  });

  it("SM-2 / BKT input is IDENTICAL with marking on or off: same verdict, same call, nothing about marks", async () => {
    await answer("u-s1", S1, "item-1", "A");                 // wrong, marking on
    const withMarking = evidenceCalls()[0].args;
    h.rpcCalls.length = 0; h.db.daily_review_settings = []; h.db.daily_review_marks = [];
    await answer("u-s1", S1, "item-1", "A");                 // wrong, marking off
    expect(evidenceCalls()[0].args).toEqual(withMarking);
    expect(withMarking).toEqual({ p_student_id: "st1", p_learning_objective_id: 7, p_is_correct: false, p_source: "spaced_review", p_source_id: S1 });
  });

  it("a wrong answer is never 'more wrong' for scheduling: the verdict is the same whatever the penalty", async () => {
    enable(10, 10);
    await answer("u-s1", S1, "item-1", "A");
    expect(evidenceCalls()[0].args.p_is_correct).toBe(false);
  });

  it("scores each scheduled review once: re-submitting a different option can't turn a penalty into a mark", async () => {
    const first = await answer("u-s1", S1, "item-1", "A");     // wrong: -0.25
    const retry = await answer("u-s1", S1, "item-1", "B");     // now picks the right one
    expect(first.body.scoring.marks).toBe(-0.25);
    expect(retry.body.scoring).toMatchObject({ counted: false, duplicate: true, outcome: "wrong", marks: -0.25 });
    expect(marksRows()).toHaveLength(1);
    expect(evidenceCalls()).toHaveLength(1);                   // no second mastery evidence either
  });

  it("does not score a review that isn't due yet, or one that belongs to someone else - but still grades it as before", async () => {
    const notDue = await answer("u-s1", S_FUTURE, "item-1", "B");
    const theirs = await answer("u-s1", S_OTHER, "item-1", "B");
    for (const r of [notDue, theirs]) {
      expect(r.status).toBe(200);
      expect(r.body.scoring).toMatchObject({ enabled: true, counted: false, marks: 0 });
    }
    expect(marksRows()).toHaveLength(0);
    expect(evidenceCalls()).toHaveLength(2);
  });

  it("does not score when no schedule_id is sent (old client) and still grades", async () => {
    const r = await call("u-s1", { action: "session-answer", learning_objective_id: 7, item_id: "item-1", selected_option: "B" });
    expect(r.status).toBe(200);
    expect(r.body.scoring.counted).toBe(false);
    expect(marksRows()).toHaveLength(0);
  });

  it("releases the scoring slot when grading fails, so the student can answer again", async () => {
    h.evidenceFails = true;
    const bad = await answer("u-s1", S1, "item-1", "A");
    expect(bad.status).toBe(500);
    expect(marksRows()).toHaveLength(0);
    h.evidenceFails = false;
    const ok = await answer("u-s1", S1, "item-1", "B");
    expect(ok.body.scoring).toMatchObject({ counted: true, marks: 1 });
  });

  it("a failing marks write never blocks grading", async () => {
    h.failTables.add("daily_review_marks");
    const r = await answer("u-s1", S1, "item-1", "B");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ is_correct: true, scoring: { counted: false, marks: 0 } });
    expect(evidenceCalls()).toHaveLength(1);
  });

  it("totals the session on the server: correct + wrong + skipped + never reached", async () => {
    await answer("u-s1", S1, "item-1", "B");                   // +1
    await answer("u-s1", S2, "item-1", "A");                   // -0.25
    const r = await answer("u-s1", S3, "item-2", "C");         // +1
    expect(r.body.scoring.session).toMatchObject({ total_questions: 5, correct: 2, wrong: 1, unanswered: 2, marks_gained: 2, marks_deducted: 0.25, net: 1.75, max_possible: 5 });
  });

  it("keeps sessions separate", async () => {
    await answer("u-s1", S1, "item-1", "B", { session_id: "sess-1" });
    const r = await answer("u-s1", S2, "item-1", "B", { session_id: "sess-2" });
    expect(r.body.scoring.session).toMatchObject({ correct: 1, net: 1 });
  });
});

describe("unanswered / skipped = 0", () => {
  beforeEach(() => enable(1, 0.25));

  it("'Remind me tomorrow' logs a skipped 0-mark row and still reschedules exactly as before", async () => {
    const r = await call("u-s1", { action: "snooze", learning_objective_id: 7, days: 1, schedule_id: S1, session_id: "sess-1" });
    expect(r.status).toBe(200);
    expect(marksRows()).toHaveLength(1);
    expect(marksRows()[0]).toMatchObject({ outcome: "skipped", marks: 0, item_id: null });
    expect(h.rpcCalls.filter((c) => c.name === "reschedule_review")[0].args).toEqual({ p_student_id: "st1", p_learning_objective_id: 7, p_days: 1 });
    expect(evidenceCalls()).toHaveLength(0);                   // skipping is not evidence of anything
  });

  it("a skipped question doesn't change the score", async () => {
    await call("u-s1", { action: "snooze", learning_objective_id: 7, days: 1, schedule_id: S1, session_id: "sess-1" });
    const r = await answer("u-s1", S2, "item-1", "B");
    expect(r.body.scoring.session).toMatchObject({ correct: 1, skipped: 1, net: 1, unanswered: 4 });
  });

  it("snooze without a schedule_id (old client) behaves as before and logs nothing", async () => {
    const r = await call("u-s1", { action: "snooze", learning_objective_id: 7, days: 1 });
    expect(r.status).toBe(200);
    expect(marksRows()).toHaveLength(0);
  });

  it("snooze with marking off logs nothing", async () => {
    h.db.daily_review_settings = [];
    await call("u-s1", { action: "snooze", learning_objective_id: 7, days: 1, schedule_id: S1 });
    expect(marksRows()).toHaveLength(0);
  });
});

describe("who may configure the rules: the principal", () => {
  const rules = { action: "scoring-set", enabled: true, marks_per_correct: 2, negative_marks_per_wrong: 0.5 };

  it("a principal can switch it on and save the rules, for their own school", async () => {
    const r = await call("u-principal", rules);
    expect(r.status).toBe(200);
    expect(r.body.rules).toEqual({ enabled: true, marks_per_correct: 2, negative_marks_per_wrong: 0.5 });
    expect(h.db.daily_review_settings).toHaveLength(1);
    expect(h.db.daily_review_settings[0]).toMatchObject({ school_id: "school-A", negative_marking_enabled: true, marks_per_correct: 2, negative_marks_per_wrong: 0.5, updated_by: "u-principal" });
  });

  it("a principal can switch it off again", async () => {
    await call("u-principal", rules);
    const r = await call("u-principal", { ...rules, enabled: false });
    expect(r.status).toBe(200);
    expect(h.db.daily_review_settings[0].negative_marking_enabled).toBe(false);
  });

  it("the rules then apply to that school's students", async () => {
    await call("u-principal", rules);
    const seen = await call("u-s1", { action: "scoring-get" });
    expect(seen.body.rules).toEqual({ enabled: true, marks_per_correct: 2, negative_marks_per_wrong: 0.5 });
    expect((await call("u-sB", { action: "scoring-get" })).body.rules.enabled).toBe(false);   // another school is unaffected
  });

  it("ignores a school_id in the request: a principal can't change another school's rules", async () => {
    await call("u-principal", { ...rules, school_id: "school-B" });
    expect(h.db.daily_review_settings.map((r) => r.school_id)).toEqual(["school-A"]);
    await call("u-principalB", rules);
    expect(h.db.daily_review_settings.map((r) => r.school_id).sort()).toEqual(["school-A", "school-B"]);
  });

  it("nobody else can: students, teachers, admin, school admin, HOD", async () => {
    for (const who of ["u-s1", "u-teacher", "u-admin", "u-sa", "u-hod"]) {
      const r = await call(who, rules);
      expect(r.status, who).toBe(403);
    }
    expect(h.db.daily_review_settings).toHaveLength(0);
  });

  it("a principal with no school linked gets a clear error", async () => {
    const r = await call("u-noschool", rules);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("no_school");
  });

  it("rejects invalid rules without saving", async () => {
    for (const bad of [{ negative_marks_per_wrong: 3 }, { negative_marks_per_wrong: -1 }, { marks_per_correct: 0 }, { marks_per_correct: 99 }, { enabled: "yes" }, { negative_marks_per_wrong: "abc" }]) {
      const r = await call("u-principal", { ...rules, ...bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect(h.db.daily_review_settings).toHaveLength(0);
  });

  it("an unauthenticated caller is refused", async () => {
    expect((await call("nobody", rules)).status).toBe(401);
  });
});

describe("reading the rules", () => {
  it("students see their own school's rules; another school stays off", async () => {
    enable(2, 0.5, "school-A");
    const a = await call("u-s1", { action: "scoring-get" });
    const b = await call("u-sB", { action: "scoring-get" });
    expect(a.body.rules).toEqual({ enabled: true, marks_per_correct: 2, negative_marks_per_wrong: 0.5 });
    expect(a.body.can_edit).toBe(false);
    expect(b.body.rules.enabled).toBe(false);
  });
  it("the principal is told they can edit; everyone else is not", async () => {
    expect((await call("u-principal", { action: "scoring-get" })).body.can_edit).toBe(true);
    for (const who of ["u-s1", "u-teacher", "u-sa", "u-admin", "u-hod"]) expect((await call(who, { action: "scoring-get" })).body.can_edit, who).toBe(false);
  });
  it("the review queue carries the rules so the screen can show them before the first question", async () => {
    enable(1, 0.25);
    const r = await call("u-s1", { action: "due" });
    expect(r.body.scoring).toEqual({ enabled: true, marks_per_correct: 1, negative_marks_per_wrong: 0.25 });
    expect(r.body.reviews).toEqual([]);
  });
  it("a student in another school is never marked by this school's rules", async () => {
    enable(1, 0.25, "school-A");
    h.db.review_schedule.push({ id: "66666666-6666-6666-6666-666666666666", student_id: "stB", learning_objective_id: 7, due_at: PAST, suspended: false });
    const r = await answer("u-sB", "66666666-6666-6666-6666-666666666666", "item-1", "B");
    expect(r.body.scoring.enabled).toBe(false);
    expect(marksRows()).toHaveLength(0);
  });
});
