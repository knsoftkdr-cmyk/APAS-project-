/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory Supabase stand-in is intentionally loosely typed */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ScoringError, buildResultScoring, decorateAnswer, decorateListWithMarks, decorateWithRules, loadSchoolRules, loadSessionRules,
  recordRulesAtStart, scoringGet, scoringSet,
} from "../../supabase/functions/_shared/handlers/adaptiveTestScoring";

type Row = Record<string, any>;
const UNIQUE: Record<string, string[]> = { cat_session_scoring: ["session_id"], adaptive_test_settings: ["school_id"] };

let db: Record<string, Row[]> = {};
const failTables = new Set<string>();

class Q {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "upsert" = "select";
  private payload: Row[] = []; private conflict = ""; private ignoreDup = false;
  private mode: "many" | "maybe" = "many";
  private sortBy: string | null = null;
  constructor(private table: string) {}
  select(_c?: string) { return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  order(c: string) { this.sortBy = c; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  upsert(rows: Row | Row[], o: { onConflict: string; ignoreDuplicates?: boolean }) { this.op = "upsert"; this.payload = Array.isArray(rows) ? rows : [rows]; this.conflict = o.onConflict; this.ignoreDup = !!o.ignoreDuplicates; return this; }
  then(res: (v: any) => any, rej?: (e: any) => any) { return Promise.resolve(this.run()).then(res, rej); }
  private run() {
    if (failTables.has(this.table)) return { data: null, error: { code: "42P01", message: `relation "${this.table}" does not exist` } };
    const rows = (db[this.table] ??= []);
    if (this.op === "upsert") {
      const ks = this.conflict.split(",");
      for (const p of this.payload) {
        const i = rows.findIndex((r) => ks.every((k) => r[k] === p[k]));
        if (i >= 0) { if (!this.ignoreDup) rows[i] = { ...rows[i], ...p }; } else rows.push({ ...p });
      }
      void UNIQUE;
      return { data: null, error: null };
    }
    let out = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.sortBy) out = [...out].sort((a, b) => a[this.sortBy!] - b[this.sortBy!]);
    if (this.mode === "maybe") return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
}
const admin = { from: (t: string) => new Q(t) };

const SID = "sess-1";
const answered = (seq: number, correct: boolean, extra: Row = {}) => ({ session_id: SID, seq, item_id: `item-${seq}`, is_correct: correct, selected_option: correct ? "B" : "A", learning_objective_id: 7, ...extra });
const enableSchool = (marks = 1, penalty = 0.25, school = "school-A") => (db.adaptive_test_settings = [{ school_id: school, negative_marking_enabled: true, marks_per_correct: marks, negative_marks_per_wrong: penalty }]);
const newSession = (over: Row = {}) => ({ id: SID, mode: "assessment", ...over });

beforeEach(() => { db = { adaptive_test_settings: [], cat_session_scoring: [], item_responses: [] }; failTables.clear(); vi.restoreAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("school rules", () => {
  it("are OFF until an admin turns them on", async () => {
    expect((await loadSchoolRules(admin, "school-A")).enabled).toBe(false);
    expect((await loadSchoolRules(admin, null)).enabled).toBe(false);
    enableSchool(2, 0.5);
    expect(await loadSchoolRules(admin, "school-A")).toEqual({ enabled: true, marks_per_correct: 2, negative_marks_per_wrong: 0.5 });
    expect((await loadSchoolRules(admin, "school-B")).enabled).toBe(false);      // another school stays off
  });
  it("fall back to OFF for corrupt rows or a missing table", async () => {
    db.adaptive_test_settings = [{ school_id: "school-A", negative_marking_enabled: true, marks_per_correct: 1, negative_marks_per_wrong: 9 }];
    expect((await loadSchoolRules(admin, "school-A")).enabled).toBe(false);
    failTables.add("adaptive_test_settings");
    expect((await loadSchoolRules(admin, "school-A")).enabled).toBe(false);
  });
});

describe("rules are frozen when the test starts", () => {
  it("snapshots the school's rules for a new Adaptive Test", async () => {
    enableSchool(1, 0.25);
    await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" });
    expect(db.cat_session_scoring).toEqual([{ session_id: SID, student_id: "st1", school_id: "school-A", marks_per_correct: 1, negative_marks_per_wrong: 0.25 }]);
  });
  it("stores nothing when marking is off, for practice rounds, or without a student", async () => {
    await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" });           // off
    enableSchool();
    await recordRulesAtStart(admin, { session: newSession({ mode: "practice" }), studentId: "st1", schoolId: "school-A" });
    await recordRulesAtStart(admin, { session: newSession(), studentId: null, schoolId: "school-A" });
    expect(db.cat_session_scoring).toHaveLength(0);
  });
  it("an admin changing the rules mid-test can't change that test's marks", async () => {
    enableSchool(1, 0.25);
    await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" });
    enableSchool(5, 2);                                                                                          // admin edits the school rules
    expect(await loadSessionRules(admin, SID)).toEqual({ enabled: true, marks_per_correct: 1, negative_marks_per_wrong: 0.25 });
    db.item_responses = [answered(1, true)];
    const out = await decorateAnswer(admin, SID, { feedback: { is_correct: true }, complete: false, session: { id: SID } });
    expect(out.feedback.scoring.marks).toBe(1);                                                                  // not 5
  });
  it("a test that started before marking was turned on stays unmarked", async () => {
    await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" });           // off at start
    enableSchool();                                                                                              // turned on later
    expect((await loadSessionRules(admin, SID)).enabled).toBe(false);
  });
  it("starting twice never overwrites the first snapshot", async () => {
    enableSchool(1, 0.25);
    await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" });
    enableSchool(3, 1);
    await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" });
    expect(db.cat_session_scoring).toHaveLength(1);
    expect(db.cat_session_scoring[0].marks_per_correct).toBe(1);
  });
});

describe("marks for each answer", () => {
  beforeEach(async () => { enableSchool(1, 0.25); await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" }); });

  it("correct = +marks, wrong = -penalty, with the running score", async () => {
    db.item_responses = [answered(1, true)];
    const a = await decorateAnswer(admin, SID, { feedback: { is_correct: true, correct_option: "B" }, complete: false, session: { id: SID } });
    expect(a.feedback.scoring).toMatchObject({ enabled: true, counted: true, outcome: "correct", marks: 1 });
    expect(a.feedback.scoring.session).toMatchObject({ correct: 1, wrong: 0, net: 1 });

    db.item_responses.push(answered(2, false));
    const b = await decorateAnswer(admin, SID, { feedback: { is_correct: false }, complete: false, session: { id: SID } });
    expect(b.feedback.scoring).toMatchObject({ outcome: "wrong", marks: -0.25 });
    expect(b.feedback.scoring.session).toMatchObject({ correct: 1, wrong: 1, marks_gained: 1, marks_deducted: 0.25, net: 0.75, total_questions: 2, unanswered: 0, max_possible: 2 });
  });

  it("leaves the engine's own fields exactly as they were", async () => {
    db.item_responses = [answered(1, false)];
    const payload = { feedback: { is_correct: false, correct_option: "C", explanation: "x", mastery_before: 0.4, mastery_after: 0.3 }, complete: false, session: { id: SID, items_administered: 1 }, item: { item_id: "i2" } };
    const out = await decorateAnswer(admin, SID, payload);
    expect(out.feedback).toMatchObject({ is_correct: false, correct_option: "C", explanation: "x", mastery_before: 0.4, mastery_after: 0.3 });
    expect(out.item).toEqual({ item_id: "i2" });
    expect(out.session).toMatchObject({ id: SID, items_administered: 1 });
  });

  it("has no float drift (3 x 0.3 - 0.1 is exactly 0.8)", async () => {
    enableSchool(0.3, 0.1); db.cat_session_scoring = []; await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" });
    db.item_responses = [answered(1, true), answered(2, true), answered(3, true), answered(4, false)];
    const out = await decorateAnswer(admin, SID, { feedback: {}, complete: false, session: { id: SID } });
    expect(out.feedback.scoring.session.net).toBe(0.8);
    expect(0.3 * 3 - 0.1).not.toBe(0.8);                         // plain floating point would have given 0.7999999999999999
  });

  it("refuses to snapshot rules that would be invalid (penalty above the marks), so the test just runs unmarked", async () => {
    enableSchool(0.1, 0.2); db.cat_session_scoring = [];
    db.adaptive_test_settings[0].negative_marks_per_wrong = 0.2;
    await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" });
    expect(db.cat_session_scoring).toHaveLength(0);
  });

  it("when the test is finished the result carries the marks, so no session decoration is added", async () => {
    db.item_responses = [answered(1, true)];
    const out = await decorateAnswer(admin, SID, { feedback: {}, complete: true, result: {} });
    expect(out.session).toBeUndefined();
    expect(out.feedback.scoring.marks).toBe(1);
  });

  it("returns the response untouched when the test has no marking", async () => {
    const payload = { feedback: { is_correct: true }, complete: false, session: { id: "other" } };
    expect(await decorateAnswer(admin, "other", payload)).toBe(payload);
  });

  it("never breaks the adaptive test: a failing read just returns the original response", async () => {
    const payload = { feedback: { is_correct: true }, complete: false, session: { id: SID } };
    failTables.add("item_responses");
    expect(await decorateAnswer(admin, SID, payload)).toBe(payload);
    failTables.clear(); failTables.add("cat_session_scoring");
    expect(await decorateAnswer(admin, SID, payload)).toBe(payload);
  });
});

describe("the question screen learns the rules before the first answer", () => {
  it("attaches them to a started / resumed test, only when marking is on", async () => {
    enableSchool(1, 0.25);
    await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" });
    const on = await decorateWithRules(admin, { complete: false, session: { id: SID }, item: { item_id: "i1" } });
    expect(on.session.scoring).toEqual({ enabled: true, rules: { enabled: true, marks_per_correct: 1, negative_marks_per_wrong: 0.25 } });
    const plain = { complete: false, session: { id: "no-marking" } };
    expect(await decorateWithRules(admin, plain)).toBe(plain);
    const done = { complete: true, result: {} };
    expect(await decorateWithRules(admin, done)).toBe(done);
  });
});

describe("final marks on the result", () => {
  const items = new Map<string, Row>([
    ["item-1", { stem: "What is 2+2?", correct_option: "B" }], ["item-2", { stem: "Capital of France?", correct_option: "C" }], ["item-3", { stem: "Third?", correct_option: "B" }],
  ]);
  const topics = new Map<number, string>([[7, "Addition"]]);

  it("totals correct, wrong, marks deducted and the final score, with a look-back list in test order", async () => {
    enableSchool(1, 0.25);
    await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" });
    const rs = [answered(2, false), answered(1, true), answered(3, true)];                   // deliberately out of order
    const r = await buildResultScoring(admin, SID, rs, items, topics);
    if (!r.enabled) throw new Error("expected marks");
    expect(r.score).toMatchObject({ total_questions: 3, correct: 2, wrong: 1, unanswered: 0, marks_gained: 2, marks_deducted: 0.25, net: 1.75, max_possible: 3 });
    expect(r.items.map((i) => i.seq)).toEqual([1, 2, 3]);
    expect(r.items[1]).toMatchObject({ stem: "Capital of France?", outcome: "wrong", selected: "A", correct_option: "C", marks: -0.25, topic: "Addition" });
  });
  it("shows a negative total honestly", async () => {
    enableSchool(1, 1);
    await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" });
    const r = await buildResultScoring(admin, SID, [answered(1, false), answered(2, false), answered(3, true)], items, topics);
    expect(r.enabled && r.score.net).toBe(-1);
  });
  it("is just { enabled: false } for an unmarked test, and on any failure", async () => {
    expect(await buildResultScoring(admin, SID, [answered(1, true)], items, topics)).toEqual({ enabled: false });
    enableSchool(); await recordRulesAtStart(admin, { session: newSession(), studentId: "st1", schoolId: "school-A" });
    failTables.add("cat_session_scoring");
    expect(await buildResultScoring(admin, SID, [answered(1, true)], items, topics)).toEqual({ enabled: false });
  });
});

describe("past tests list", () => {
  it("adds marks to the tests that were marked, from their own snapshot", async () => {
    db.cat_session_scoring = [{ session_id: "a", marks_per_correct: 2, negative_marks_per_wrong: 0.5 }];
    const out = await decorateListWithMarks(admin, [
      { id: "a", items_administered: 10, correct_count: 7 }, { id: "b", items_administered: 8, correct_count: 8 },
    ]);
    expect(out[0].marks).toEqual({ net: 12.5, max_possible: 20, correct: 7, wrong: 3 });   // 7*2 - 3*0.5
    expect(out[1].marks).toBeUndefined();
  });
  it("is harmless when the table is missing", async () => {
    failTables.add("cat_session_scoring");
    const sessions = [{ id: "a", items_administered: 3, correct_count: 1 }];
    expect(await decorateListWithMarks(admin, sessions)).toBe(sessions);
  });
});

describe("who may configure the rules: the principal", () => {
  const rules = { enabled: true, marks_per_correct: 2, negative_marks_per_wrong: 0.5 };

  it("a principal can switch it on and save the rules, for their own school", async () => {
    const r = await scoringSet(admin, { role: "principal", schoolId: "school-A", userId: "u1" }, rules);
    expect(r.rules).toEqual(rules);
    expect(db.adaptive_test_settings).toEqual([expect.objectContaining({ school_id: "school-A", negative_marking_enabled: true, marks_per_correct: 2, negative_marks_per_wrong: 0.5, updated_by: "u1" })]);
  });
  it("and switch it off again", async () => {
    await scoringSet(admin, { role: "principal", schoolId: "school-A" }, rules);
    await scoringSet(admin, { role: "principal", schoolId: "school-A" }, { ...rules, enabled: false });
    expect((await loadSchoolRules(admin, "school-A")).enabled).toBe(false);
  });
  it("ignores any school_id in the request", async () => {
    await scoringSet(admin, { role: "principal", schoolId: "school-A" }, { ...rules, school_id: "school-B" });
    expect(db.adaptive_test_settings.map((r) => r.school_id)).toEqual(["school-A"]);
  });
  it("nobody else can: students, teachers, admin, school admin, HOD, parents", async () => {
    for (const role of ["student", "teacher", "admin", "school_admin", "hod", "parent"]) {
      await expect(scoringSet(admin, { role, schoolId: "school-A" }, rules), role).rejects.toMatchObject({ status: 403 });
    }
    expect(db.adaptive_test_settings).toHaveLength(0);
  });
  it("needs a school, valid numbers, and the table to exist", async () => {
    await expect(scoringSet(admin, { role: "principal", schoolId: null }, rules)).rejects.toMatchObject({ status: 400, code: "no_school" });
    for (const bad of [{ negative_marks_per_wrong: 3 }, { negative_marks_per_wrong: -1 }, { marks_per_correct: 0 }, { marks_per_correct: 11 }, { enabled: "yes" }, { negative_marks_per_wrong: "abc" }]) {
      await expect(scoringSet(admin, { role: "principal", schoolId: "school-A" }, { ...rules, ...bad })).rejects.toBeInstanceOf(ScoringError);
    }
    failTables.add("adaptive_test_settings");
    await expect(scoringSet(admin, { role: "principal", schoolId: "school-A" }, rules)).rejects.toMatchObject({ status: 503, code: "persistence_unavailable" });
  });
  it("get tells the principal they can edit and everyone else they can't", async () => {
    enableSchool(2, 0.5);
    expect((await scoringGet(admin, { role: "principal", schoolId: "school-A" })).can_edit).toBe(true);
    for (const role of ["student", "teacher", "school_admin", "admin"]) expect((await scoringGet(admin, { role, schoolId: "school-A" })).can_edit, role).toBe(false);
    const student = await scoringGet(admin, { role: "student", schoolId: "school-A" });
    expect(student.rules.enabled).toBe(true);
    expect((await scoringGet(admin, { role: "student", schoolId: "school-B" })).rules.enabled).toBe(false);
  });
});
