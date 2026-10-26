// supabase/functions/_shared/rubricGradingModel.ts
//
// Interactive rubric grading (sheet row 44): validates the teacher's per-criterion marks and works out the
// question score from them, so the stored score always matches the rubric the teacher ticked.
// Rubric rows: { criterion, max_marks, awarded, comment?, evidence? }  (evidence = a quote from the answer)

export interface RubricScore { criterion: string; max_marks: number; awarded: number; comment: string | null; evidence: string | null }

const MAX_ROWS = 20;
const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

/** Returns the cleaned rubric, or an error message. `null` input = no rubric sent (allowed). */
export function sanitiseTeacherRubric(raw: unknown): { ok: true; rows: RubricScore[] | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, rows: null };
  if (!Array.isArray(raw) || !raw.length) return { ok: false, error: "teacher_rubric must be a non-empty array" };
  if (raw.length > MAX_ROWS) return { ok: false, error: `A rubric can have at most ${MAX_ROWS} criteria` };
  const rows: RubricScore[] = [];
  for (const r of raw) {
    const criterion = clip((r as Record<string, unknown>)?.criterion, 300);
    const max = Number((r as Record<string, unknown>)?.max_marks);
    const awarded = Number((r as Record<string, unknown>)?.awarded);
    if (!criterion) return { ok: false, error: "Every rubric row needs a criterion" };
    if (!(max > 0)) return { ok: false, error: `"${criterion}" needs positive max marks` };
    if (!Number.isFinite(awarded) || awarded < 0 || awarded > max) return { ok: false, error: `"${criterion}": marks must be between 0 and ${max}` };
    rows.push({
      criterion, max_marks: max, awarded: Math.round(awarded * 100) / 100,
      comment: clip((r as Record<string, unknown>).comment, 1000), evidence: clip((r as Record<string, unknown>).evidence, 1000),
    });
  }
  return { ok: true, rows };
}

/** Rubric total rescaled to the question's max marks (rubrics don't always add up to max_marks). */
export function rubricScore(rows: RubricScore[], itemMax: number): number {
  const max = rows.reduce((s, r) => s + r.max_marks, 0);
  const got = rows.reduce((s, r) => s + r.awarded, 0);
  if (!(max > 0) || !(itemMax > 0)) return 0;
  return Math.round((got / max) * itemMax * 100) / 100;
}
