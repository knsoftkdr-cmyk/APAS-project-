// supabase/functions/_shared/interactiveVideoModel.ts
//
// Pure logic for the Interactive Video Player (no I/O, unit-tested in src/test/interactiveVideoModel.test.ts).
//
//   * validating teacher-authored / AI-generated questions
//   * grading an answer, and hiding the answer key from students
//   * merging watched time ranges so "watch time" is UNIQUE seconds actually played (never more than the video)
//   * resume / completion maths
//   * turning raw rows into the analytics the teacher screens show

export const COMPLETION_THRESHOLD = 0.9;      // 90% of the video genuinely watched = completed
export const MAX_QUESTIONS_PER_VIDEO = 30;
export const MAX_RANGES = 400;
export const MAX_DURATION_SECONDS = 86400;
export const MIN_QUESTION_GAP_SECONDS = 5;

export type QuestionType = "mcq" | "true_false";

export interface QuestionInput {
  timestamp_seconds: number;
  question_text: string;
  question_type: QuestionType;
  options: string[];
  correct_index: number;
  explanation: string | null;
}

const clean = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max);
};

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validate one question coming from the browser or from the AI. Returns a clean row or a human reason. */
export function sanitizeQuestion(raw: unknown, durationSeconds?: number | null): Validated<QuestionInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Invalid question" };
  const r = raw as Record<string, unknown>;

  const ts = Number(r.timestamp_seconds);
  if (!Number.isFinite(ts) || ts < 0 || ts > MAX_DURATION_SECONDS) return { ok: false, error: "Choose a time inside the video" };
  const timestamp = Math.round(ts);
  if (durationSeconds && durationSeconds > 0 && timestamp > durationSeconds) return { ok: false, error: "The time is after the end of the video" };

  const text = clean(r.question_text, 500);
  if (!text) return { ok: false, error: "Write the question" };

  const type: QuestionType = r.question_type === "true_false" ? "true_false" : "mcq";
  let options: string[];
  if (type === "true_false") {
    options = ["True", "False"];
  } else {
    const list = Array.isArray(r.options) ? r.options : [];
    options = list.map((o) => clean(o, 200));
    if (options.some((o) => !o)) return { ok: false, error: "Fill in every option or remove the empty ones" };
    if (options.length < 2 || options.length > 6) return { ok: false, error: "A question needs 2 to 6 options" };
    const lower = options.map((o) => o.toLowerCase());
    if (new Set(lower).size !== lower.length) return { ok: false, error: "Options must be different from each other" };
  }

  const correct = Number(r.correct_index);
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) return { ok: false, error: "Mark the correct option" };

  const explanation = clean(r.explanation, 1000) || null;
  return { ok: true, value: { timestamp_seconds: timestamp, question_text: text, question_type: type, options, correct_index: correct, explanation } };
}

export interface VideoSettingsInput { allow_video_skip: boolean; allow_question_skip: boolean; duration_seconds: number | null }

export function sanitizeSettings(raw: unknown): VideoSettingsInput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = Number(r.duration_seconds);
  return {
    allow_video_skip: r.allow_video_skip !== false,
    allow_question_skip: r.allow_question_skip !== false,
    duration_seconds: Number.isFinite(d) && d >= 1 ? Math.min(Math.round(d), MAX_DURATION_SECONDS) : null,
  };
}

// ── grading ──────────────────────────────────────────────────────────────────────────────────────

export interface StoredQuestion extends QuestionInput { id: string; listing_id?: string; source?: string }

export function gradeAnswer(q: Pick<StoredQuestion, "correct_index" | "options">, selected: unknown): { valid: boolean; correct: boolean } {
  const n = Number(selected);
  if (!Number.isInteger(n) || n < 0 || n >= q.options.length) return { valid: false, correct: false };
  return { valid: true, correct: n === q.correct_index };
}

/** What a STUDENT may see before answering: never the key or the explanation. */
export function studentSafeQuestion(q: StoredQuestion) {
  return { id: q.id, timestamp_seconds: q.timestamp_seconds, question_text: q.question_text, question_type: q.question_type, options: q.options };
}

// ── watched time ─────────────────────────────────────────────────────────────────────────────────
// A range is [start, end) in whole seconds. The player sends the ranges it has actually played; the server
// merges them with what it already has, so watching the same part twice or on two devices never inflates the total.

export type Range = [number, number];

export function sanitizeRanges(raw: unknown, duration: number): Range[] {
  if (!Array.isArray(raw)) return [];
  const cap = duration > 0 ? Math.ceil(duration) : MAX_DURATION_SECONDS;
  const out: Range[] = [];
  for (const r of raw.slice(0, MAX_RANGES * 2)) {
    if (!Array.isArray(r) || r.length < 2) continue;
    const a = Math.floor(Number(r[0])), b = Math.ceil(Number(r[1]));
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const start = Math.max(0, a), end = Math.min(cap, b);
    if (end > start) out.push([start, end]);
  }
  return out;
}

export function mergeRanges(...lists: Range[][]): Range[] {
  const all = lists.flat().filter((r) => r[1] > r[0]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: Range[] = [];
  for (const [s, e] of all) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  // Keep the row small: if a student seeks around a lot, close the smallest gaps first.
  while (out.length > MAX_RANGES) {
    let best = 0, gap = Infinity;
    for (let i = 0; i < out.length - 1; i++) {
      const g = out[i + 1][0] - out[i][1];
      if (g < gap) { gap = g; best = i; }
    }
    out.splice(best, 2, [out[best][0], out[best + 1][1]]);
  }
  return out;
}

export const rangesTotal = (ranges: Range[]): number => ranges.reduce((s, [a, b]) => s + (b - a), 0);

export interface ProgressRow {
  last_position_seconds: number; furthest_seconds: number; watched_seconds: number; duration_seconds: number;
  completion_pct: number; completed: boolean; watched_ranges: Range[];
}

export interface ProgressReport { position: unknown; furthest: unknown; duration: unknown; ranges: unknown }

/**
 * Fold one report from the player into the stored row. Watch time / furthest point / completion only ever go UP
 * (a student who re-opens a finished video does not lose it); the resume position follows the latest report.
 */
export function applyProgress(prev: ProgressRow | null, rep: ProgressReport): ProgressRow | null {
  const d = Number(rep.duration);
  const duration = Number.isFinite(d) && d > 0 ? Math.min(Math.round(d), MAX_DURATION_SECONDS) : prev?.duration_seconds ?? 0;
  if (duration <= 0) return null;

  const merged = mergeRanges(prev?.watched_ranges ?? [], sanitizeRanges(rep.ranges, duration));
  const watched = Math.min(rangesTotal(merged), duration);
  const pct = Math.min(100, Math.round((watched / duration) * 10000) / 100);

  const pos = Number(rep.position);
  const position = Number.isFinite(pos) ? Math.min(Math.max(0, pos), duration) : prev?.last_position_seconds ?? 0;
  const fur = Number(rep.furthest);
  const furthest = Math.max(prev?.furthest_seconds ?? 0, Number.isFinite(fur) ? Math.min(Math.max(0, fur), duration) : 0);

  return {
    last_position_seconds: Math.round(position * 100) / 100,
    furthest_seconds: Math.round(furthest * 100) / 100,
    watched_seconds: watched,
    duration_seconds: duration,
    completion_pct: pct,
    completed: (prev?.completed ?? false) || watched / duration >= COMPLETION_THRESHOLD,
    watched_ranges: merged,
  };
}

/**
 * Where playback should restart: where the student stopped, a little earlier so they regain context. A video
 * that was finished starts again from the beginning. An unanswered question the student was looking at when they
 * left (the overlay pauses the video at the question) is shown again.
 */
export function resumePosition(
  p: Pick<ProgressRow, "last_position_seconds" | "duration_seconds" | "completed"> | null,
  unresolvedQuestionTimes: number[] = [],
): number {
  if (!p || p.last_position_seconds < 5) return 0;
  if (p.duration_seconds > 0 && p.last_position_seconds >= p.duration_seconds - 3) return 0;
  const pos = p.last_position_seconds;
  const pending = unresolvedQuestionTimes.filter((t) => t <= pos && pos - t <= 5).sort((a, b) => a - b)[0];
  if (pending !== undefined) return Math.max(0, pending - 1);
  return Math.max(0, Math.floor(pos - 2));
}

// ── AI question generation ───────────────────────────────────────────────────────────────────────

export interface GenerationContext {
  title: string; description: string | null; subject: string | null; class_label: string | null;
  notes: string | null; duration_seconds: number; count: number;
}

export function buildGenerationPrompt(c: GenerationContext): string {
  const hasNotes = !!c.notes && c.notes.trim().length > 0;
  return [
    `You write in-video comprehension questions for school students${c.class_label ? ` (class ${c.class_label})` : ""}${c.subject ? `, subject: ${c.subject}` : ""}.`,
    `Video title: ${c.title}`,
    c.description ? `Video description: ${c.description}` : "",
    hasNotes ? `Lesson material / transcript (the ONLY content you may test):\n"""\n${c.notes!.slice(0, 12000)}\n"""` : "No transcript was supplied: base the questions strictly on the title and description, and keep them about the core idea they state. Do not invent specific facts.",
    `The video is ${c.duration_seconds} seconds long. Write exactly ${c.count} questions and spread them in order across the video (not in the first 10% and not in the last 5%, at least ${MIN_QUESTION_GAP_SECONDS * 3} seconds apart). Each question's timestamp_seconds is the moment right AFTER the idea it tests has been explained.`,
    `Mix "mcq" (4 options) and "true_false" (options must be exactly ["True","False"]). Exactly one option is correct; correct_index is its 0-based position. Give a one or two sentence explanation that teaches why the answer is right. Keep the language simple and age-appropriate. No trick questions.`,
    `Return strict JSON only: {"questions":[{"timestamp_seconds":number,"question_type":"mcq"|"true_false","question_text":string,"options":[string],"correct_index":number,"explanation":string}]}`,
  ].filter(Boolean).join("\n\n");
}

/** Parse the model's reply: keep only valid questions, inside the video, spaced apart, in time order. */
export function parseGeneratedQuestions(text: string, durationSeconds: number, count: number): QuestionInput[] {
  let data: unknown;
  try {
    const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    data = JSON.parse(t);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { data = JSON.parse(m[0]); } catch { return []; }
  }
  const list = Array.isArray(data) ? data : Array.isArray((data as { questions?: unknown })?.questions) ? (data as { questions: unknown[] }).questions : [];
  const valid: QuestionInput[] = [];
  for (const item of list) {
    const v = sanitizeQuestion(item, durationSeconds);
    if (v.ok) valid.push(v.value);
  }
  valid.sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
  const spaced: QuestionInput[] = [];
  for (const q of valid) {
    const last = spaced[spaced.length - 1];
    if (last && q.timestamp_seconds - last.timestamp_seconds < MIN_QUESTION_GAP_SECONDS) continue;
    spaced.push(q);
  }
  return spaced.slice(0, Math.max(1, count));
}

// ── analytics ────────────────────────────────────────────────────────────────────────────────────

export interface AttemptRow { question_id: string; student_id: string; selected_index: number | null; is_correct: boolean | null; skipped: boolean; attempt_no: number; created_at: string }
export interface QuestionStat {
  question_id: string; timestamp_seconds: number; question_text: string; options: string[]; correct_index: number;
  students: number; answered: number; skipped: number; correct: number; accuracy_pct: number | null; option_counts: number[];
}

/** Question-wise performance. Accuracy uses each student's FIRST answer so retries do not flatter the number. */
export function summarizeQuestions(
  questions: readonly (StoredQuestion & { id: string })[], attempts: readonly AttemptRow[],
): QuestionStat[] {
  const byQ = new Map<string, AttemptRow[]>();
  for (const a of attempts) byQ.set(a.question_id, [...(byQ.get(a.question_id) ?? []), a]);
  return [...questions].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds).map((q) => {
    const rows = (byQ.get(q.id) ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    const firstByStudent = new Map<string, AttemptRow>();
    for (const r of rows) if (!firstByStudent.has(r.student_id)) firstByStudent.set(r.student_id, r);
    const first = [...firstByStudent.values()];
    const answeredRows = first.filter((r) => !r.skipped && r.selected_index !== null);
    const correct = answeredRows.filter((r) => r.is_correct === true).length;
    const optionCounts = q.options.map(() => 0);
    for (const r of answeredRows) if (r.selected_index !== null && r.selected_index < optionCounts.length) optionCounts[r.selected_index]++;
    return {
      question_id: q.id, timestamp_seconds: q.timestamp_seconds, question_text: q.question_text, options: q.options, correct_index: q.correct_index,
      students: firstByStudent.size, answered: answeredRows.length, skipped: first.length - answeredRows.length, correct,
      accuracy_pct: answeredRows.length ? Math.round((correct / answeredRows.length) * 100) : null, option_counts: optionCounts,
    };
  });
}

export interface ProgressSummaryRow { student_id: string; watched_seconds: number; duration_seconds: number; completion_pct: number; completed: boolean }
export interface VideoSummary {
  viewers: number; avg_watch_seconds: number; avg_completion_pct: number; completed: number; completion_rate_pct: number | null;
}

export function summarizeProgress(rows: readonly ProgressSummaryRow[]): VideoSummary {
  const n = rows.length;
  if (!n) return { viewers: 0, avg_watch_seconds: 0, avg_completion_pct: 0, completed: 0, completion_rate_pct: null };
  const completed = rows.filter((r) => r.completed).length;
  return {
    viewers: n,
    avg_watch_seconds: Math.round(rows.reduce((s, r) => s + r.watched_seconds, 0) / n),
    avg_completion_pct: Math.round(rows.reduce((s, r) => s + r.completion_pct, 0) / n),
    completed,
    completion_rate_pct: Math.round((completed / n) * 100),
  };
}

export const formatTimestamp = (s: number): string => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
