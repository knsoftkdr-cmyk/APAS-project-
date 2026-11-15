import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");
const sql = read("supabase/migrations/20261030000000_ai_flashcards.sql");
const handler = read("supabase/functions/_shared/handlers/flashcards.ts");
const anchor = read("supabase/functions/cat-session/index.ts");
const app = read("src/App.tsx");

describe("flashcards migration - security", () => {
  for (const t of ["flashcards", "student_flashcards", "flashcard_reviews"]) {
    it(`${t}: RLS on`, () => expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`));
  }
  it("has no client INSERT / UPDATE / DELETE / ALL policy", () => {
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.flashcards, public\.student_flashcards, public\.flashcard_reviews FROM anon, authenticated/);
  });
  it("students read only their own progress, history and cards in their own deck", () => {
    expect(sql).toMatch(/Students read own flashcard progress[\s\S]*?profile_id = auth\.uid\(\)/);
    expect(sql).toMatch(/Students read own flashcard reviews[\s\S]*?profile_id = auth\.uid\(\)/);
    expect(sql).toMatch(/Students read cards in own deck[\s\S]*?student_flashcards/);
  });
  it("the Daily Review pull-forward function is service-role only and can only move a review EARLIER", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.flashcard_pull_review_forward\(uuid, bigint, int\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.flashcard_pull_review_forward\(uuid, bigint, int\) TO service_role/);
    expect(sql).toMatch(/EXCLUDED\.due_at < rs\.due_at/);
    expect(sql).toMatch(/rs\.suspended = false/);
  });
  it("never writes self-rated results into mastery evidence", () => {
    expect(sql.replace(/--.*$/gm, "")).not.toMatch(/mastery_evidence_log|record_mastery_evidence/);
    expect(handler.replace(/\/\/.*$/gm, "")).not.toMatch(/record_mastery_evidence|mastery_evidence_log/);
  });
  it("cards must carry a grounding excerpt and are unique per topic question", () => {
    expect(sql).toMatch(/source_excerpt text NOT NULL/);
    expect(sql).toMatch(/UNIQUE \(topic_id, question_hash\)/);
  });
});

describe("flashcards handler - access rules", () => {
  it("students only; class/student come from the verified JWT, not the body", () => {
    expect(handler).toMatch(/role !== "student"/);
    expect(handler).toMatch(/auth\.getUser\(\)/);
    expect(handler).not.toMatch(/body\??\.(student_id|class|school_id)/);
  });
  it("scope is checked against the student's own class books", () => {
    expect(handler).toMatch(/loadClassBooks/);
    expect(handler).toMatch(/not_your_syllabus/);
  });
  it("rating is idempotent (optimistic lock) and validates the rating", () => {
    expect(handler).toMatch(/\.eq\("times_seen", row\.times_seen\)/);
    expect(handler).toMatch(/isRating\(body\?\.rating\)/);
  });
  it("limits how many cards can be generated per hour", () => expect(handler).toMatch(/MAX_NEW_CARDS_PER_HOUR/));
});

describe("flashcards wiring", () => {
  it("routes every fc_ action through the cat-session anchor (no new edge function)", () => {
    for (const a of ["catalog", "generate", "study", "rate", "overview", "report"]) {
      expect(anchor).toContain(`fc_${a}: { handler: handleFlashcards, action: "${a}" }`);
    }
  });
  it("Daily Review and Flashcards are tabs of one student-only page (like My Mastery / Exam Readiness)", () => {
    // /flashcards is students only. /daily-review also admits the principal who sets Daily Review's marking rules.
    expect(app).toContain('<Route path="/flashcards" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><StudentReviewFlashcards />');
    expect(app).toContain('<Route path="/daily-review" element={<ProtectedRoute><RoleGuard allowedRoles={["student", "principal"]}><StudentReviewFlashcards />');
    expect(app).not.toMatch(/<DailyReview \/>/);
  });
  it("the sidebar keeps one Daily Review entry that also highlights on /flashcards", () => {
    const sidebar = read("src/components/layout/AppSidebar.tsx");
    expect(sidebar).toMatch(/path: "\/daily-review"[^}]*alsoActiveOn: \["\/flashcards"\]/);
    expect(sidebar).not.toMatch(/path: "\/flashcards"/);
  });
  it("existing Daily Review routes are untouched", () => {
    for (const a of ["sr_forecast", "sr_due", "sr_session_answer", "sr_snooze"]) expect(anchor).toContain(a);
  });
});
