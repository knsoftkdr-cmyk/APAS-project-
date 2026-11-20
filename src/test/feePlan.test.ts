// Client-side rules for Automatic Fee Plan Assignment, plus contract checks that keep them in step with the database
// migration. The database behaviour itself (trigger, idempotency, RLS, guards) is exercised against a real Postgres in
// supabase/tests/fee-plan-assignment/.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  feeNorm, matchStructure, allocateConcession, computeBreakdown, validatePlanInput, validateInstalmentTemplate,
  previewInstalments, sumLines, emptyLines, friendlyFeeError, FEE_LINES, type FeeStructure,
} from "@/lib/feePlan";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261116000000_fee_plan_assignment.sql"), "utf8");
// Same text without `-- comments`, for assertions about what the migration actually DOES (comments may mention existing objects).
const code = sql.replace(/--.*$/gm, "");

const mk = (over: Partial<FeeStructure>): FeeStructure => ({
  ...emptyLines(), id: "s1", school_id: "sch1", name: "Std", academic_year: "2026-27", class_grade: "Grade 5", category: null,
  total_fee: 0, due_date: null, instalment_schedule: null, notes: null, is_active: true, tuition_fee: 50000, ...over,
});

describe("feeNorm mirrors public.fee_norm", () => {
  it.each([
    ["Grade 5", "5"], ["class 5", "5"], ["5", "5"], ["Class  5", "5"], ["Pre-KG", "prekg"], ["pre kg", "prekg"],
    ["2026-27", "202627"], ["2026 - 27", "202627"], ["Staff Ward", "staffward"], ["staff_ward", "staffward"], [null, ""], ["  ", ""],
  ])("%s -> %s", (input, out) => { expect(feeNorm(input as string | null)).toBe(out); });
  it("the SQL function uses the same pattern", () => {
    expect(sql).toContain("'^(grade|class)\\s+'");
    expect(sql).toContain("'[\\s_-]+'");
  });
});

describe("matchStructure (class + category + academic year)", () => {
  const std = mk({ id: "std", category: null });
  const staff = mk({ id: "staff", category: "Staff Ward", tuition_fee: 20000 });

  it("matches class + year and ignores label formatting", () => {
    expect(matchStructure([std], { academic_year: "2026 - 27", class_grade: "class 5", category: null })?.structure.id).toBe("std");
  });
  it("a category-specific structure beats the all-categories one", () => {
    const m = matchStructure([std, staff], { academic_year: "2026-27", class_grade: "Grade 5", category: "staff ward" });
    expect(m?.structure.id).toBe("staff");
    expect(m?.basis).toBe("exact");
  });
  it("falls back to the all-categories structure when the category has none, and says so", () => {
    const m = matchStructure([std, staff], { academic_year: "2026-27", class_grade: "Grade 5", category: "quota" });
    expect(m?.structure.id).toBe("std");
    expect(m?.basis).toBe("default");
  });
  it("never matches a different class, a different year, an inactive structure or another school", () => {
    const ctx = { academic_year: "2026-27", class_grade: "Grade 5", category: null };
    expect(matchStructure([std], { ...ctx, class_grade: "Grade 6" })).toBeNull();
    expect(matchStructure([std], { ...ctx, academic_year: "2027-28" })).toBeNull();
    expect(matchStructure([mk({ is_active: false })], ctx)).toBeNull();
    expect(matchStructure([std], { ...ctx, school_id: "other" })).toBeNull();
  });
  it("with only a category-specific structure, a different category gets NO match (warning + manual assignment)", () => {
    expect(matchStructure([staff], { academic_year: "2026-27", class_grade: "Grade 5", category: "general" })).toBeNull();
  });
  it("the SQL prefers an exact category and falls back to blank, in that order", () => {
    expect(sql).toMatch(/fee_norm\(s\.category\) = public\.fee_norm\(a\.category\) OR public\.fee_norm\(s\.category\) = ''/);
    expect(sql).toMatch(/ORDER BY \(public\.fee_norm\(s\.category\) = public\.fee_norm\(a\.category\)\) DESC/);
  });
});

describe("allocateConcession keeps the ledger columns summing to net", () => {
  const lines = { ...emptyLines(), admission_fee: 5000, tuition_fee: 50000, transport_fee: 8000, uniform_fee: 2000, material_fee: 1500, exam_fee: 500, other_fee: 1000 };

  it("no concession: admission + other land in other_amount, tuition in course_amount", () => {
    expect(allocateConcession(lines, 0)).toEqual({
      course_amount: 50000, transport_amount: 8000, other_amount: 6000, uniform_amount: 2000, material_amount: 1500, exam_amount: 500,
    });
  });
  it("takes the concession from tuition first", () => {
    const l = allocateConcession(lines, 10000);
    expect(l.course_amount).toBe(40000);
    expect(l.transport_amount).toBe(8000);
  });
  it("spills into the next lines when it exceeds tuition", () => {
    const l = allocateConcession({ ...emptyLines(), tuition_fee: 1000, admission_fee: 500, transport_fee: 300 }, 1200);
    expect(l.course_amount).toBe(0);
    expect(l.other_amount).toBe(300);
    expect(l.transport_amount).toBe(300);
  });
  it.each([0, 1, 999.99, 10000, 68000])("columns always add up to gross - concession (%s)", (c) => {
    const l = allocateConcession(lines, c);
    const total = l.course_amount + l.transport_amount + l.other_amount + l.uniform_amount + l.material_amount + l.exam_amount;
    expect(Math.round(total * 100) / 100).toBe(Math.round((68000 - c) * 100) / 100);
  });
  it("a full waiver is allowed; more than the fee is rejected", () => {
    expect(Object.values(allocateConcession(lines, 68000)).every((v) => v === 0)).toBe(true);
    expect(() => allocateConcession(lines, 68000.01)).toThrow(/more than the total fee/);
  });
  it("the SQL uses the same order", () => {
    const body = sql.slice(sql.indexOf("FUNCTION public.fee_ledger_lines"), sql.indexOf("FUNCTION public._fee_snapshot"));
    const order = [...body.matchAll(/v_take := least\((v_\w+), v_rem\)/g)].map((m) => m[1]);
    expect(order).toEqual(["v_tui", "v_adm", "v_oth", "v_exm", "v_mat", "v_uni", "v_trn"]);
  });
});

describe("computeBreakdown: fees, discounts, payments, outstanding", () => {
  const lines = { ...emptyLines(), tuition_fee: 50000, admission_fee: 10000 };
  it("pending with nothing paid", () => {
    expect(computeBreakdown(lines, 0, 0, "2026-12-01", "2026-11-16")).toEqual({ gross: 60000, concession: 0, net: 60000, paid: 0, outstanding: 60000, status: "pending" });
  });
  it("applies the concession and partial payment", () => {
    const b = computeBreakdown(lines, 6000, 20000, "2026-12-01", "2026-11-16");
    expect(b).toMatchObject({ net: 54000, paid: 20000, outstanding: 34000, status: "partial" });
  });
  it("overdue after the due date, paid when cleared", () => {
    expect(computeBreakdown(lines, 0, 100, "2026-01-01", "2026-11-16").status).toBe("overdue");
    expect(computeBreakdown(lines, 0, 60000, "2026-01-01", "2026-11-16").status).toBe("paid");
  });
  it("never shows a negative outstanding", () => { expect(computeBreakdown(lines, 0, 99999, null).outstanding).toBe(0); });
  it("sumLines handles all seven lines", () => { expect(sumLines({ ...emptyLines(), ...Object.fromEntries(FEE_LINES.map((l) => [l.key, 1])) })).toBe(7); });
});

describe("validatePlanInput", () => {
  const ok = { ...emptyLines(), tuition_fee: 1000 };
  it("accepts a valid plan", () => { expect(validatePlanInput(ok, 0, "")).toBeNull(); });
  it("rejects empty, negative, 3-decimal and over-concession input", () => {
    expect(validatePlanInput(emptyLines(), 0, "")).toMatch(/at least one/);
    expect(validatePlanInput({ ...ok, transport_fee: -1 }, 0, "")).toMatch(/negative/);
    expect(validatePlanInput({ ...ok, tuition_fee: 10.123 }, 0, "")).toMatch(/2 decimals/);
    expect(validatePlanInput(ok, 1001, "x")).toMatch(/more than the total/);
  });
  it("requires a reason for any concession", () => {
    expect(validatePlanInput(ok, 100, "  ")).toMatch(/reason/);
    expect(validatePlanInput(ok, 100, "Merit scholarship")).toBeNull();
  });
  it("refuses a total below what is already paid", () => { expect(validatePlanInput(ok, 0, "", 1500)).toMatch(/already paid/); });
});

describe("instalment template", () => {
  const t = (p: number[]) => p.map((percent, i) => ({ label: `T${i + 1}`, percent, due_date: `2026-0${i + 6}-10` }));
  it("optional; needs 2+ rows summing to exactly 100", () => {
    expect(validateInstalmentTemplate([])).toBeNull();
    expect(validateInstalmentTemplate(t([100]))).toMatch(/at least 2/);
    expect(validateInstalmentTemplate(t([50, 40]))).toMatch(/add up to 100/);
    expect(validateInstalmentTemplate(t([50, 50]))).toBeNull();
    expect(validateInstalmentTemplate(t([33.33, 33.33, 33.34]))).toBeNull();
  });
  it("rejects a missing date or a zero percentage", () => {
    expect(validateInstalmentTemplate([{ label: "a", percent: 50, due_date: "" }, { label: "b", percent: 50, due_date: "2026-07-01" }])).toMatch(/due date/);
    expect(validateInstalmentTemplate(t([100, 0]))).toMatch(/above 0/);
  });
  it("preview splits the outstanding exactly; the last instalment absorbs rounding", () => {
    const p = previewInstalments(t([33.33, 33.33, 33.34]), 1000);
    expect(p.map((x) => x.amount)).toEqual([333.3, 333.3, 333.4]);
    expect(Math.round(p.reduce((s, x) => s + x.amount, 0) * 100) / 100).toBe(1000);
  });
});

describe("database contract (migration text)", () => {
  it("fires only when an applicant BECOMES admitted (or is created admitted), never on enquiry/application", () => {
    expect(sql).toMatch(/AFTER UPDATE OF status ON public\.admission_applicants\s+FOR EACH ROW WHEN \(new\.status = 'admitted' AND old\.status IS DISTINCT FROM 'admitted'\)/);
    expect(sql).toMatch(/AFTER INSERT ON public\.admission_applicants\s+FOR EACH ROW WHEN \(new\.status = 'admitted'\)/);
  });
  it("the trigger swallows failures so an admission decision can never be blocked", () => {
    const body = sql.slice(sql.indexOf("FUNCTION public.fee_on_admit_trigger"), sql.indexOf("DROP TRIGGER IF EXISTS trg_fee_assign_on_admit ON"));
    expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN/);
  });
  it("one live assignment per applicant per academic year (duplicate prevention) and one active structure per class/category/year", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_assignments_one_live[\s\S]*?\(applicant_id, public\.fee_norm\(academic_year\)\) WHERE status IN \('active', 'unmatched'\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_structures_active[\s\S]*?WHERE is_active/);
  });
  it("assignments and history are not writable by app roles; history has no UPDATE/DELETE policy", () => {
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.fee_assignments, public\.fee_assignment_history FROM anon, authenticated/);
    expect(sql).not.toMatch(/CREATE POLICY \w+ ON public\.fee_assignment_history FOR (INSERT|UPDATE|DELETE)/);
    expect(sql).not.toMatch(/CREATE POLICY \w+ ON public\.fee_assignments FOR (INSERT|UPDATE|DELETE)/);
  });
  it("the engine functions are not callable by clients; the admin RPCs are", () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION\s+public\.fee_try_auto_assign\(uuid, uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION\s+public\.fee_assign_manual\(/);
  });
  it("every admin RPC re-checks the caller", () => {
    for (const fn of ["fee_assign_manual", "fee_assignment_cancel", "fee_assignment_link_student", "fee_resolve_unmatched", "fee_assignment_create_instalments"]) {
      const start = sql.indexOf(`FUNCTION public.${fn}(`);
      const body = sql.slice(start, sql.indexOf("END $$;", start));
      expect(body, fn).toMatch(/is_fee_staff\(/);
    }
  });
  it("amounts on a plan-managed fee row are guarded; payment columns are not", () => {
    const body = sql.slice(sql.indexOf("FUNCTION public.fee_payments_plan_guard"), sql.indexOf("DROP TRIGGER IF EXISTS trg_fee_payments_plan_guard"));
    for (const col of ["amount_due", "course_amount", "transport_amount", "other_amount", "uniform_amount", "material_amount", "exam_amount"]) expect(body).toContain(`new.${col}`);
    for (const col of ["amount_paid", "razorpay", "status"]) expect(body).not.toContain(`new.${col}`);
  });
  it("does not redefine or drop anything that already exists (Razorpay / parent fee page stay untouched)", () => {
    expect(code).not.toMatch(/get_parent_fee_details/);
    expect(code).not.toMatch(/DROP (TABLE|FUNCTION|POLICY (?!IF EXISTS fee_))/i);
    expect(code).not.toMatch(/ALTER TABLE public\.fee_payments (DROP|ALTER)/i);
  });
});

describe("friendlyFeeError", () => {
  it("translates the common failures", () => {
    expect(friendlyFeeError('duplicate key value violates unique constraint "uq_fee_structures_active"')).toMatch(/already exists/);
    expect(friendlyFeeError('insert or update violates foreign key constraint "fee_assignments_structure_id_fkey"')).toMatch(/Deactivate/);
    expect(friendlyFeeError("Not authorised")).toMatch(/permission/);
    expect(friendlyFeeError("ERROR: The concession cannot be more than the total fee")).toBe("The concession cannot be more than the total fee");
  });
});
