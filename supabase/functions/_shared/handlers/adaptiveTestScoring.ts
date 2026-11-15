// supabase/functions/_shared/handlers/adaptiveTestScoring.ts
//
// Negative marking for the ADAPTIVE TEST (cat-session, mode "assessment"). Used by cat-session/index.ts; it is not
// an edge function of its own.
//
//   correct = + marks_per_correct,  wrong = - negative_marks_per_wrong,  not answered = 0
//
// A scoring OVERLAY, derived from item_responses (one immutable row per answered question). Nothing here feeds the
// adaptive engine: theta / se (EAP), item selection, the stopping rule, student_ability, the scaled score + band,
// BKT mastery and apply_cat_response() are all untouched.
//
//   * Rules are copied into cat_session_scoring when a test STARTS, so changing them mid-test can't change that test.
//   * A test with no snapshot (started before this feature / while marking was off / practice mode) has no marks.
//   * Every read / write here is best-effort: if the tables are missing or a query fails, the adaptive test runs
//     exactly as it did before (marks are simply absent).
//   * Pure arithmetic is shared with Daily Review: ../dailyReviewScoring.ts.

// deno-lint-ignore-file no-explicit-any
import {
  DEFAULT_RULES, marksFor, summarizeSession, toCents, fromCents, validateRules,
  type Outcome, type ScoredRow, type ScoringRules, type SessionScore,
} from "../dailyReviewScoring.ts";

type Row = Record<string, any>;

/** Who may change the Adaptive Test marking rules (they apply to the principal's own school). */
export const SCORING_ADMIN_ROLES = ["principal"];

export class ScoringError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

const isMissingRelation = (err: Row | null | undefined) =>
  !!err && (["42P01", "PGRST205", "42703"].includes(String(err.code)) || /does not exist|schema cache/i.test(String(err.message ?? "")));

// ── school rules (what an admin edits) ───────────────────────────────────────

export async function loadSchoolRules(admin: any, schoolId: string | null): Promise<ScoringRules> {
  if (!schoolId) return { ...DEFAULT_RULES };
  const { data, error } = await admin.from("adaptive_test_settings")
    .select("negative_marking_enabled, marks_per_correct, negative_marks_per_wrong").eq("school_id", schoolId).maybeSingle();
  if (error) {
    if (!isMissingRelation(error)) console.error("adaptive_test_settings read failed (marking off)", error);
    return { ...DEFAULT_RULES };
  }
  if (!data) return { ...DEFAULT_RULES };
  const check = validateRules({ enabled: data.negative_marking_enabled === true, marks_per_correct: data.marks_per_correct, negative_marks_per_wrong: data.negative_marks_per_wrong });
  return check.ok ? check.rules : { ...DEFAULT_RULES };
}

export interface Who { role: string; schoolId: string | null; userId?: string }

export async function scoringGet(admin: any, who: Who) {
  return { rules: await loadSchoolRules(admin, who.schoolId), can_edit: SCORING_ADMIN_ROLES.includes(who.role) && !!who.schoolId, school_id: who.schoolId };
}

export async function scoringSet(admin: any, who: Who, body: Row) {
  if (!SCORING_ADMIN_ROLES.includes(who.role)) throw new ScoringError(403, "Only a principal can change the Adaptive Test scoring rules", "not_authorised");
  if (!who.schoolId) throw new ScoringError(400, "Your account isn't linked to a school", "no_school");
  const check = validateRules({ enabled: body.enabled, marks_per_correct: body.marks_per_correct, negative_marks_per_wrong: body.negative_marks_per_wrong });
  if (!check.ok) throw new ScoringError(400, check.error, "invalid_rules");

  const { error } = await admin.from("adaptive_test_settings").upsert({
    school_id: who.schoolId,
    negative_marking_enabled: check.rules.enabled,
    marks_per_correct: check.rules.marks_per_correct,
    negative_marks_per_wrong: check.rules.negative_marks_per_wrong,
    updated_by: who.userId ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "school_id" });
  if (error) {
    if (isMissingRelation(error)) throw new ScoringError(503, "Adaptive Test scoring isn't set up yet (apply migration 20261113000000).", "persistence_unavailable");
    throw new ScoringError(500, error.message, "scoring_save_failed");
  }
  return { rules: check.rules, can_edit: true, school_id: who.schoolId };
}

// ── per-test snapshot ────────────────────────────────────────────────────────

/** Call right after a NEW Adaptive Test session is created. Only "assessment" tests are marked, and only if the school has marking on. */
export async function recordRulesAtStart(admin: any, args: { session: Row; studentId: string | null; schoolId: string | null }): Promise<void> {
  try {
    const { session, studentId, schoolId } = args;
    if (!session?.id || !studentId || (session.mode ?? "assessment") !== "assessment") return;
    const rules = await loadSchoolRules(admin, schoolId);
    if (!rules.enabled) return;
    const { error } = await admin.from("cat_session_scoring").upsert({
      session_id: session.id, student_id: studentId, school_id: schoolId,
      marks_per_correct: rules.marks_per_correct, negative_marks_per_wrong: rules.negative_marks_per_wrong,
    }, { onConflict: "session_id", ignoreDuplicates: true });
    if (error && !isMissingRelation(error)) console.error("cat_session_scoring snapshot failed (test continues unmarked)", error);
  } catch (e) {
    console.error("recordRulesAtStart failed (test continues unmarked)", e);
  }
}

/** The rules THIS test runs under: its snapshot, or "off". */
export async function loadSessionRules(admin: any, sessionId: string): Promise<ScoringRules> {
  try {
    const { data, error } = await admin.from("cat_session_scoring")
      .select("marks_per_correct, negative_marks_per_wrong").eq("session_id", sessionId).maybeSingle();
    if (error || !data) return { ...DEFAULT_RULES };
    const check = validateRules({ enabled: true, marks_per_correct: data.marks_per_correct, negative_marks_per_wrong: data.negative_marks_per_wrong });
    return check.ok ? check.rules : { ...DEFAULT_RULES };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

const outcomeOf = (r: Row): Outcome => (r.is_correct ? "correct" : "wrong");
const toScored = (rows: Row[], rules: ScoringRules): ScoredRow[] => rows.map((r) => ({ outcome: outcomeOf(r), marks: marksFor(outcomeOf(r), rules) }));

// ── decorating cat-session responses (all best-effort, never throw) ──────────

/** start / state: lets the question screen show "+1 correct · −0.25 wrong" before the first answer. */
export async function decorateWithRules<T extends Row>(admin: any, payload: T): Promise<T> {
  try {
    const session = payload?.session as Row | undefined;
    if (!session?.id || payload.complete) return payload;
    const rules = await loadSessionRules(admin, session.id);
    if (!rules.enabled) return payload;
    return { ...payload, session: { ...session, scoring: { enabled: true, rules } } };
  } catch (e) {
    console.error("decorateWithRules failed (unmarked)", e);
    return payload;
  }
}

/** answer: adds the marks for the answer just recorded, plus the running score, to `feedback`. */
export async function decorateAnswer<T extends Row>(admin: any, sessionId: string, payload: T): Promise<T> {
  try {
    const rules = await loadSessionRules(admin, sessionId);
    if (!rules.enabled || !payload?.feedback) return payload;
    const { data, error } = await admin.from("item_responses").select("seq, is_correct").eq("session_id", sessionId).order("seq");
    if (error || !data?.length) return payload;
    const rows = data as Row[];
    const last = rows[rows.length - 1];
    const outcome = outcomeOf(last);
    const scoring = {
      enabled: true, counted: true, outcome, marks: marksFor(outcome, rules), rules,
      session: summarizeSession(toScored(rows, rules), rows.length, rules),
    };
    const next: Row = { ...payload, feedback: { ...payload.feedback, scoring } };
    if (!payload.complete && payload.session) next.session = { ...payload.session, scoring: { enabled: true, rules } };
    return next as T;
  } catch (e) {
    console.error("decorateAnswer failed (unmarked)", e);
    return payload;
  }
}

export interface ResultItemMarks {
  seq: number; stem: string; outcome: Outcome; selected: string | null; correct_option: string | null; marks: number; topic: string;
}
export type ResultScoring =
  | { enabled: false }
  | { enabled: true; rules: ScoringRules; score: SessionScore; items: ResultItemMarks[] };

/**
 * Final marks for a finished test. `responses` are the item_responses rows buildResult already loaded;
 * `itemsById` holds question_bank rows (stem, correct_option); `topicOf` maps a learning objective id to its text.
 */
export async function buildResultScoring(
  admin: any, sessionId: string, responses: Row[], itemsById: Map<string, Row>, topicOf: Map<number, string>,
): Promise<ResultScoring> {
  try {
    const rules = await loadSessionRules(admin, sessionId);
    if (!rules.enabled) return { enabled: false };
    const rs = [...responses].sort((a, b) => Number(a.seq) - Number(b.seq));
    return {
      enabled: true, rules,
      score: summarizeSession(toScored(rs, rules), rs.length, rules),
      items: rs.map((r) => ({
        seq: Number(r.seq),
        stem: String(itemsById.get(r.item_id)?.stem ?? ""),
        outcome: outcomeOf(r),
        selected: r.selected_option ?? null,
        correct_option: itemsById.get(r.item_id)?.correct_option ?? null,
        marks: marksFor(outcomeOf(r), rules),
        topic: String(topicOf.get(r.learning_objective_id) ?? ""),
      })),
    };
  } catch (e) {
    console.error("buildResultScoring failed (unmarked)", e);
    return { enabled: false };
  }
}

/** list: adds `marks: { net, max_possible, correct, wrong }` to each past test that was marked. */
export async function decorateListWithMarks<T extends Row>(admin: any, sessions: T[]): Promise<T[]> {
  try {
    const ids = sessions.map((s) => s.id).filter(Boolean);
    if (!ids.length) return sessions;
    const { data, error } = await admin.from("cat_session_scoring")
      .select("session_id, marks_per_correct, negative_marks_per_wrong").in("session_id", ids);
    if (error || !data?.length) return sessions;
    const byId = new Map<string, Row>((data as Row[]).map((r) => [r.session_id, r]));
    return sessions.map((s) => {
      const snap = byId.get(s.id);
      if (!snap) return s;
      const answered = Number(s.items_administered ?? 0);
      const correct = Math.min(answered, Number(s.correct_count ?? 0));
      const wrong = Math.max(0, answered - correct);
      const mc = toCents(Number(snap.marks_per_correct)), pen = toCents(Number(snap.negative_marks_per_wrong));
      return { ...s, marks: { net: fromCents(correct * mc - wrong * pen), max_possible: fromCents(answered * mc), correct, wrong } };
    });
  } catch (e) {
    console.error("decorateListWithMarks failed (unmarked)", e);
    return sessions;
  }
}
