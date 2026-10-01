import { describe, it, expect } from "vitest";
import {
  buildTwinSnapshot, simulateScenarios, validateScenario, resolveTimetables, riskBand, type SchoolData,
} from "../../supabase/functions/_shared/schoolTwinModel";

const grid = (rows: string[][]) => ({ headers: ["Period", "Monday", "Tuesday"], rows });

function makeData(over: Partial<SchoolData> = {}): SchoolData {
  const students = ["s1", "s2", "s3", "s4"];
  return {
    schoolId: "sch",
    classes: [{ id: "c1", name: "Class 6", section: "A" }, { id: "c2", name: "Class 7", section: "A" }],
    assignments: [
      { class_id: "c1", teacher_id: "t1", subject: "Mathematics" },
      { class_id: "c1", teacher_id: "t2", subject: "English" },
      { class_id: "c2", teacher_id: "t1", subject: "Mathematics" },
    ],
    teacherNames: new Map([["t1", "Asha"], ["t2", "Ravi"]]),
    studentsByClass: new Map([["c1", students]]),
    studentNames: new Map(students.map((s) => [s, s.toUpperCase()])),
    predictions: [
      { student_id: "s1", subject: "Mathematics", predicted_score_next_test: 85, risk_level: "low", confidence_score: 0.8 },
      { student_id: "s2", subject: "Mathematics", predicted_score_next_test: 62, risk_level: "medium", confidence_score: 0.8 },
      { student_id: "s3", subject: "Maths", predicted_score_next_test: 45, risk_level: "high", confidence_score: 0.8 },
      { student_id: "s4", subject: "Mathematics", predicted_score_next_test: 30, risk_level: "high", confidence_score: 0.8 },
    ],
    mastery: new Map(), masterySampled: false,
    attendance: new Map(students.map((s) => [s, { sum: 27, n: 30 }])),
    teacherAttendance: new Map(),
    timetables: [
      { class_grade: "Class 6", section: "A", parsed_grid: grid([["P1", "Maths", "English"], ["P2", "English", ""], ["Lunch", "Break", "Break"], ["P3", "", ""]]) },
      { class_grade: "Class 7", section: "A", parsed_grid: grid([["P1", "", "Maths"], ["P2", "Maths", ""]]) },
    ],
    lessons: [], chaptersByKey: new Map([["class 6|mathematics", 10]]),
    scopeClassIds: new Set(["c1", "c2"]), windowDays: 30, lessonWindowWeeks: 8,
    ...over,
  };
}
const sc = (o: any = {}) => { const v = validateScenario({ subject: "Mathematics", ...o }); if (!v.ok) throw new Error((v as { error: string }).error); return (v as any).value; };

describe("resolveTimetables", () => {
  it("skips break rows, matches synonyms, and records blanks", () => {
    const tt = resolveTimetables(makeData());
    expect(tt.cells.filter((c) => c.classId === "c1" && c.subject === "Mathematics")).toHaveLength(1); // "Maths" -> Mathematics
    expect(tt.cells.some((c) => /break/i.test(c.period))).toBe(false);
    expect(tt.blanks.filter((b) => b.classId === "c1")).toHaveLength(3); // P2 Tue, P3 Mon+Tue
    expect(tt.periodsByTeacher.get("t1")).toBe(3);
  });
});

describe("riskBand", () => {
  it("uses predict-performance thresholds", () => {
    expect([riskBand(70), riskBand(69.9), riskBand(50), riskBand(49.9)]).toEqual(["low", "medium", "medium", "high"]);
  });
});

describe("simulateScenarios", () => {
  it("is a no-op with warning when nothing changes", () => {
    const r: any = simulateScenarios(makeData(), "c1", [sc()]).results[0];
    expect(r.projected.avg_gain).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/No change entered/);
  });

  it("extra periods raise scores, never above 100, more for weaker students", () => {
    const r: any = simulateScenarios(makeData(), "c1", [sc({ extra_periods: 2, weeks: 12 })]).results[0];
    expect(r.projected.avg_gain).toBeGreaterThan(0);
    r.students.forEach((s: any) => { expect(s.after).toBeLessThanOrEqual(100); expect(s.delta).toBeGreaterThanOrEqual(0); });
    const by = Object.fromEntries(r.students.map((s: any) => [s.student_id, s.delta]));
    expect(by.s4).toBeGreaterThan(by.s1);
  });

  it("more weeks -> larger realised effect", () => {
    const g = (weeks: number) => (simulateScenarios(makeData(), "c1", [sc({ extra_periods: 2, weeks })]).results[0] as any).projected.avg_gain;
    expect(g(2)).toBeLessThan(g(8));
    expect(g(8)).toBeLessThan(g(30));
  });

  it("remedial periods only help targeted students, with diminishing returns", () => {
    const run = (n: number) => simulateScenarios(makeData(), "c1", [sc({ remedial_periods: n, weeks: 10 })]).results[0] as any;
    const one = run(1), three = run(3);
    const s1 = one.students.find((s: any) => s.student_id === "s1");
    expect(s1.targeted).toBe(false);
    expect(s1.delta).toBe(0);
    expect(one.projected.students_targeted).toBe(3); // 62 (medium), 45, 30; s1 (85, low) excluded
    expect(three.projected.avg_gain).toBeGreaterThan(one.projected.avg_gain);
    expect(three.projected.avg_gain).toBeLessThan(one.projected.avg_gain * 3);
  });

  it("removing periods lowers scores", () => {
    const r: any = simulateScenarios(makeData(), "c1", [sc({ extra_periods: -1, weeks: 12 })]).results[0];
    expect(r.projected.avg_gain).toBeLessThan(0);
  });

  it("moves students across risk bands", () => {
    const r: any = simulateScenarios(makeData(), "c1", [sc({ extra_periods: 3, remedial_periods: 4, weeks: 30 })]).results[0];
    expect(r.risk.before.high).toBe(2);
    expect(r.risk.improved).toBeGreaterThan(0);
  });

  it("flags teacher overload and discounts the effect", () => {
    const heavy = makeData({ timetables: [{ class_grade: "Class 6", section: "A", parsed_grid: grid(Array.from({ length: 16 }, (_, i) => [`P${i}`, "Maths", "Maths"])) }] });
    const r: any = simulateScenarios(heavy, "c1", [sc({ extra_periods: 5 })]).results[0];
    expect(r.teacher_load.status).not.toBe("ok");
    expect(r.warnings.join(" ")).toMatch(/recommended max/);
  });

  it("checks free slots for both class and teacher", () => {
    const r: any = simulateScenarios(makeData(), "c1", [sc({ extra_periods: 1 })]).results[0];
    expect(r.feasibility.checked).toBe(true);
    // class 6 blanks: Tue P2, Mon P3, Tue P3. Asha teaches Class 7 on Tue P1 and Mon P2 -> none of those collide
    expect(r.feasibility.slots_available).toBe(3);
    const tooMany: any = simulateScenarios(makeData(), "c1", [sc({ extra_periods: 5 })]).results[0];
    expect(tooMany.feasibility.feasible).toBe(false);
  });

  it("excludes a teacher's busy slot", () => {
    const data = makeData({ timetables: [
      { class_grade: "Class 6", section: "A", parsed_grid: grid([["P1", "Maths", ""]]) },
      { class_grade: "Class 7", section: "A", parsed_grid: grid([["P1", "", "Maths"]]) },
    ] });
    const r: any = simulateScenarios(data, "c1", [sc({ extra_periods: 1 })]).results[0];
    expect(r.feasibility.slots_available).toBe(0); // Tue P1 is blank for class 6 but Asha is teaching Class 7
  });

  it("handles no predictions and unassigned subjects without throwing", () => {
    const empty: any = simulateScenarios(makeData({ predictions: [] }), "c1", [sc({ extra_periods: 1 })]).results[0];
    expect(empty.projected.avg_after).toBeNull();
    expect(empty.projected.confidence).toBe("none");
    const bad: any = simulateScenarios(makeData(), "c1", [sc({ subject: "Chemistry" })]).results[0];
    expect(bad.error).toMatch(/isn't assigned/);
  });

  it("projects syllabus pace from recent lessons", () => {
    const now = Date.now();
    const lessons = Array.from({ length: 8 }, (_, i) => ({ teacher_id: "t1", class_level: "Class 6", subject: "Mathematics", created_at: new Date(now - i * 6 * 86400000).toISOString() }));
    const r: any = simulateScenarios(makeData({ lessons }), "c1", [sc({ extra_periods: 2, weeks: 4 })]).results[0];
    expect(r.syllabus.available).toBe(true);
    expect(r.syllabus.covered).toBe(8);
    expect(r.syllabus.lessons_per_week_after).toBeGreaterThan(r.syllabus.lessons_per_week_now);
    expect(r.syllabus.projected_pct_with_change).toBeGreaterThanOrEqual(r.syllabus.projected_pct_without_change);
  });
});

describe("validateScenario", () => {
  it("rejects out-of-range and non-integer input", () => {
    expect(validateScenario({ subject: "X", extra_periods: 99 }).ok).toBe(false);
    expect(validateScenario({ subject: "X", remedial_periods: 1.5 }).ok).toBe(false);
    expect(validateScenario({ subject: "X", weeks: 0 }).ok).toBe(false);
    expect(validateScenario({ subject: "X", remedial_target: "everyone" }).ok).toBe(false);
    expect(validateScenario({}).ok).toBe(false);
    expect(validateScenario({ subject: "X" }).ok).toBe(true);
  });
});

describe("buildTwinSnapshot", () => {
  it("connects students, teachers, classes, timetable, syllabus and performance", () => {
    const snap: any = buildTwinSnapshot(makeData(), "school");
    expect(snap.summary.students).toBe(4);
    expect(snap.summary.risk).toMatchObject({ high: 2, medium: 1, low: 1 });
    const c1 = snap.classes.find((c: any) => c.id === "c1");
    expect(c1.weekly_periods).toBeGreaterThan(0);
    expect(c1.subjects.find((s: any) => s.subject === "Mathematics").syllabus.total).toBe(10);
    expect(snap.teachers.find((t: any) => t.id === "t1").assignments).toHaveLength(2);
    expect(snap.data_quality.classes_without_timetable).toBe(0);
  });

  it("raises a risk-concentration signal only with 3+ high-risk students (and >=30%)", () => {
    const two: any = buildTwinSnapshot(makeData(), "school");
    expect(two.signals.some((s: any) => s.type === "risk_concentration")).toBe(false); // only 2 high
    const three = makeData({
      predictions: ["s1", "s2", "s3", "s4"].map((id, i) => ({ student_id: id, subject: "Mathematics", predicted_score_next_test: i === 0 ? 80 : 30, risk_level: i === 0 ? "low" : "high" })),
    });
    const snap: any = buildTwinSnapshot(three, "school");
    const sig = snap.signals.find((s: any) => s.type === "risk_concentration");
    expect(sig).toBeTruthy();
    expect(sig.severity).toBe("critical");
  });

  it("only exposes classes in scope (teacher view)", () => {
    const snap: any = buildTwinSnapshot(makeData({ scopeClassIds: new Set(["c2"]) }), "teacher");
    expect(snap.classes.map((c: any) => c.id)).toEqual(["c2"]);
    expect(snap.students).toHaveLength(0);
  });

  it("copes with an empty school", () => {
    const snap: any = buildTwinSnapshot(makeData({ classes: [], assignments: [], studentsByClass: new Map(), predictions: [], timetables: [], scopeClassIds: new Set() }), "school");
    expect(snap.summary.students).toBe(0);
    expect(snap.summary.avg_predicted).toBeNull();
  });
});
