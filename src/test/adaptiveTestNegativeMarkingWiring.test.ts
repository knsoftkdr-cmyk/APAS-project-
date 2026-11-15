import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");
const strip = (s: string) => s.replace(/--.*$/gm, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const sql = read("supabase/migrations/20261113000000_adaptive_test_negative_marking.sql");
const index = read("supabase/functions/cat-session/index.ts");
const module_ = read("supabase/functions/_shared/handlers/adaptiveTestScoring.ts");
const irt = read("supabase/functions/_shared/irt.ts");
const app = read("src/App.tsx");
const sidebar = read("src/components/layout/AppSidebar.tsx");

const slice = (src: string, from: string, to: string) => {
  const a = src.indexOf(from), b = src.indexOf(to, a + from.length);
  expect(a, `missing ${from}`).toBeGreaterThan(-1); expect(b, `missing ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
};

describe("migration", () => {
  it("is additive: two new tables, no change to cat_sessions / item_responses / anything else", () => {
    const code = strip(sql);
    expect(code.match(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)?.map((m) => m.split(".")[1]).sort()).toEqual(["adaptive_test_settings", "cat_session_scoring"]);
    expect(code).not.toMatch(/ALTER TABLE public\.(?!adaptive_test_settings|cat_session_scoring)/);
    expect(code).not.toMatch(/DROP (TABLE|FUNCTION|TRIGGER)|CREATE (OR REPLACE )?(FUNCTION|TRIGGER)/);
  });
  it("RLS on, read-only policies, no client writes; off by default; penalty can't exceed marks", () => {
    expect(sql).toContain("ALTER TABLE public.adaptive_test_settings ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.cat_session_scoring ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.adaptive_test_settings, public\.cat_session_scoring FROM anon, authenticated/);
    expect(sql).toMatch(/negative_marking_enabled boolean NOT NULL DEFAULT false/);
    expect(sql.match(/CHECK \(negative_marks_per_wrong <= marks_per_correct\)/g)).toHaveLength(2);
  });
});

describe("the adaptive engine is untouched", () => {
  it("answer() - grading, theta estimation, apply_cat_response - has no marks logic and is not edited", () => {
    const body = slice(index, "async function answer(", "// ── advance");
    expect(body).toContain("estimateAbilityEAP(scored");
    expect(body).toContain('rpc("apply_cat_response"');
    expect(body).toContain("p_is_correct: isCorrect");
    expect(body).not.toMatch(/marks|scoring|penalt/i);
  });
  it("advance / finalize / selection / stopping have no marks logic", () => {
    const body = slice(index, "async function advance(", "// ── state (resume / resync)");
    expect(body).not.toMatch(/marks|scoring|penalt/i);
    expect(body).toContain("evaluateStopping(");
    expect(body).toContain("selectNextItem(");
  });
  it("the IRT maths knows nothing about marks", () => {
    expect(irt).not.toMatch(/negative marking|dailyReviewScoring|adaptiveTestScoring|marks_per|penalt|cat_session_scoring/i);
  });
  it("marks are added AFTER the engine has run, by wrapping its results", () => {
    expect(index).toMatch(/const answered = \(await answer\(ctx, body\)\) as Row;\s*return json\(await decorateAnswer\(/);
    expect(index).toMatch(/const started = \(await start\(ctx, body\)\) as Row;/);
  });
  it("only tests started as mode 'assessment' are marked (practice rounds are not)", () => {
    expect(module_).toMatch(/\(session\.mode \?\? "assessment"\) !== "assessment"\) return/);
  });
});

describe("the scoring module writes only to its own tables", () => {
  const code = strip(module_);
  it("never updates / inserts into the adaptive engine's tables", () => {
    for (const t of ["cat_sessions", "item_responses", "student_ability", "student_mastery", "mastery_evidence_log", "review_schedule", "question_bank"]) {
      expect(code, t).not.toMatch(new RegExp(`from\\("${t}"\\)\\s*\\.(update|insert|upsert|delete)`));
    }
    expect(code).not.toMatch(/rpc\(/);                                       // calls no engine function at all
    expect(code).not.toMatch(/estimateAbilityEAP|apply_cat_response|theta/);
  });
  it("its only writes are the school's rules and a test's rules snapshot", () => {
    const writes = [...code.matchAll(/from\("(\w+)"\)\s*\.(?:update|insert|upsert|delete)/g)].map((m) => m[1]).sort();
    expect(writes).toEqual(["adaptive_test_settings", "cat_session_scoring"]);
  });
  it("only the principal can set the rules, and the school comes from the caller's profile", () => {
    expect(module_).toMatch(/SCORING_ADMIN_ROLES = \["principal"\]/);
    expect(module_).toMatch(/school_id: who\.schoolId/);
    expect(module_).not.toMatch(/body\.school_id/);
  });
  it("every decorating call is best-effort: it can't throw into the test", () => {
    for (const fn of ["recordRulesAtStart", "decorateWithRules", "decorateAnswer", "buildResultScoring", "decorateListWithMarks"]) {
      const start = module_.indexOf(`export async function ${fn}`);
      expect(start, `missing ${fn}`).toBeGreaterThan(-1);
      const next = module_.indexOf("\nexport ", start + 10);
      const body = module_.slice(start, next === -1 ? undefined : next);
      expect(body, fn).toMatch(/try \{[\s\S]*\} catch/);
    }
  });
});

describe("no new menu or module", () => {
  it("routes the new actions inside the existing cat-session switch", () => {
    expect(index).toContain('case "cat_scoring_get":');
    expect(index).toContain('case "cat_scoring_set":');
  });
  it("/adaptive-test admits the principal who sets its rules, and they find it in their menu", () => {
    expect(app).toContain('<Route path="/adaptive-test" element={<ProtectedRoute><RoleGuard allowedRoles={["student", "principal"]}><AdaptiveTest />');
    expect(sidebar.match(/path: "\/adaptive-test"/g)).toHaveLength(2);                                          // the student entry + the principal entry
    expect(sidebar).toMatch(/title: "Adaptive Test"[^}]*roles: \["student"\], module: "Assessments"/);           // student entry unchanged
    expect(sidebar).toMatch(/title: "Adaptive Test & Daily Review"[^}]*roles: \["principal"\], alsoActiveOn: \["\/daily-review"\] \}/);   // ONE principal entry for both, no module
    expect(sidebar).not.toMatch(/scoring|negative|marking/i);
  });
  it("Daily Review marking is still wired", () => {
    expect(index).toContain('sr_scoring_get: { handler: handleSpacedRepetition, action: "scoring-get" }');
  });
});
