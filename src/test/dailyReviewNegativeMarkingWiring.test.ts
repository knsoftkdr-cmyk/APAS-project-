import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");
const sql = read("supabase/migrations/20261112000000_daily_review_negative_marking.sql");
const handler = read("supabase/functions/_shared/handlers/spacedRepetition.ts");
const anchor = read("supabase/functions/cat-session/index.ts");
const sidebar = read("src/components/layout/AppSidebar.tsx");
const strip = (s: string) => s.replace(/--.*$/gm, "").replace(/\/\/.*$/gm, "");

describe("negative marking migration", () => {
  it("is additive: creates two tables and alters/drops no existing object", () => {
    const code = strip(sql);
    expect(code.match(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)?.map((m) => m.split(".")[1]).sort()).toEqual(["daily_review_marks", "daily_review_settings"]);
    expect(code).not.toMatch(/ALTER TABLE public\.(?!daily_review_(settings|marks))/);
    expect(code).not.toMatch(/DROP (TABLE|FUNCTION|TRIGGER)/);
    expect(code).not.toMatch(/CREATE (OR REPLACE )?(FUNCTION|TRIGGER)/);
  });
  it("RLS on, read-only policies, no client writes", () => {
    expect(sql).toContain("ALTER TABLE public.daily_review_settings ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.daily_review_marks ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.daily_review_settings, public\.daily_review_marks FROM anon, authenticated/);
  });
  it("enforces the rules in the database as well: penalty <= marks, one score per scheduled review, outcome/marks agree", () => {
    expect(sql).toMatch(/CHECK \(negative_marks_per_wrong <= marks_per_correct\)/);
    expect(sql).toMatch(/UNIQUE \(student_id, schedule_id, due_at\)/);
    expect(sql).toMatch(/outcome = 'skipped' AND marks = 0/);
    expect(sql).toMatch(/negative_marking_enabled boolean NOT NULL DEFAULT false/);
  });
});

describe("scope: Daily Review only", () => {
  it("nothing in the marking code touches assessments, quizzes, tests or exams", () => {
    const code = strip(sql) + strip(read("supabase/functions/_shared/dailyReviewScoring.ts"));
    expect(code).not.toMatch(/\b(exams?|quiz(zes)?|tests?|assessments?|cat_session|worksheets?|homework|mock_exam\w*)\b/i);
  });
  it("the verdict sent to the mastery engine is the plain correct / incorrect result, never a mark", () => {
    expect(handler).toMatch(/p_is_correct: isCorrect,/);
    expect(strip(handler)).not.toMatch(/p_is_correct:\s*marks/);
    expect(strip(handler)).not.toMatch(/UPDATE public\.review_schedule/i);
  });
  it("only touches the SM-2 tables to READ the schedule being answered", () => {
    expect(handler).not.toMatch(/from\("review_schedule"\)\s*\.(update|insert|upsert|delete)/);
    expect(handler).not.toMatch(/from\("mastery_evidence_log"\)/);
  });
  it("reaches the same cat-session anchor; no new sidebar menu or module", () => {
    expect(anchor).toContain('sr_scoring_get: { handler: handleSpacedRepetition, action: "scoring-get" }');
    expect(anchor).toContain('sr_scoring_set: { handler: handleSpacedRepetition, action: "scoring-set" }');
    expect(sidebar).not.toMatch(/scoring|negative/i);
  });
  it("only the principal may change the rules, and the school comes from the caller's profile", () => {
    expect(handler).toMatch(/SCORING_ADMIN_ROLES = \["principal"\]/);
    expect(handler).toMatch(/school_id: ctx\.schoolId/);
    expect(handler).not.toMatch(/body\.school_id/);
  });
});
