// Daily Practice Problems: shared types and small pure helpers (no I/O here).

export type DppQuestionType = "mcq" | "true_false" | "short_answer" | "numeric" | "open_ended";
export type DppDifficulty = "easy" | "medium" | "hard";
export type DppAssignmentStatus = "not_started" | "in_progress" | "submitted";

export const QUESTION_TYPE_LABEL: Record<DppQuestionType, string> = {
  mcq: "Multiple choice",
  true_false: "True / False",
  short_answer: "Short answer",
  numeric: "Numeric",
  open_ended: "Open-ended (teacher marks)",
};

export interface DppAssignment {
  assignment_id: string; set_id: string; title: string; description: string | null; subject: string; chapter: string | null;
  difficulty: DppDifficulty | "mixed"; time_limit_minutes: number | null; source: "teacher" | "auto"; assigned_for: string;
  question_count: number; total_marks: number; status: DppAssignmentStatus; attempt_id: string | null;
  percent: number | null; score: number | null; max_score: number | null; submitted_at: string | null;
  grading_status: "auto" | "pending_manual" | "complete" | null; overdue: boolean;
}
export interface DppStreak { current: number; longest: number; total_completed: number; done_today: boolean }
export interface DppToday { today: string; assignments: DppAssignment[]; streak: DppStreak }

export interface DppRunItem {
  item_id: string; position: number; question_type: DppQuestionType; stem: string;
  options: Record<string, string> | null; marks: number; difficulty: DppDifficulty;
}
export interface DppRun {
  attempt_id: string; set_id: string; title: string; subject: string; time_limit_minutes: number | null;
  remaining_seconds: number | null; started_at: string; items: DppRunItem[]; answers: Record<string, string>;
  time_up?: boolean;
}
export interface DppResultItem {
  item_id: string; answer_id: string | null; position: number; question_type: DppQuestionType; stem: string;
  options: Record<string, string> | null; marks: number; difficulty: DppDifficulty; chapter: string | null;
  answer: string | null; is_correct: boolean | null; marks_awarded: number | null; pending: boolean;
  correct_answer: string | null; explanation: string | null; teacher_feedback: string | null;
}
export interface DppResult {
  attempt_id: string; set_id: string; title: string; subject: string; chapter: string | null;
  grading_status: "auto" | "pending_manual" | "complete"; auto_submitted: boolean;
  score: number; max_score: number; percent: number; correct: number; incorrect: number; unanswered: number;
  pending_manual: number; accuracy: number; time_taken_seconds: number | null; submitted_at: string;
  items: DppResultItem[]; student_name?: string; student_id?: string;
}
export interface DppSummary {
  totals: { attempts: number; avg_percent: number; correct: number; incorrect: number; questions: number; time_seconds: number };
  week: { date: string; attempts: number; percent: number | null }[];
  by_subject: { subject: string; answered: number; correct: number; accuracy: number | null }[];
  by_difficulty: { difficulty: DppDifficulty; answered: number; correct: number; accuracy: number | null }[];
  improve: { subject: string; chapter: string; answered: number; accuracy: number }[];
  streak: DppStreak;
}
export interface DppHistoryRow {
  attempt_id: string; title: string; subject: string; submitted_at: string; percent: number; score: number; max_score: number;
  correct: number; incorrect: number; time_taken_seconds: number | null; grading_status: string;
}
export interface DppRecommendation { subtopic_id: number; name: string; chapter: string | null; subject: string | null; answered: number; accuracy: number }

export interface DppSetRow {
  set_id: string; title: string; subject: string; class_level: string | null; difficulty: string; status: string;
  time_limit_minutes: number | null; created_at: string; questions: number; assigned: number; started: number;
  submitted: number; avg_percent: number | null; pending_manual: number;
}
export interface DppTeacherOverview {
  sets: DppSetRow[];
  weak_students: { student_id: string; name: string; class: string; attempts: number; avg_percent: number }[];
  difficult_questions: { item_id: string; stem: string; set_title: string; answered: number; correct_percent: number }[];
  pending_manual: number;
}
export interface DppEditorItem {
  question_type: DppQuestionType; stem: string; options?: Record<string, string>; correct_answer?: string;
  accepted_answers?: string[]; numeric_answer?: number | null; tolerance?: number; explanation?: string; marks: number;
  difficulty: DppDifficulty; bank_item_id?: string; learning_objective_id?: number | null; subtopic_id?: number | null; chapter?: string | null;
}
export interface DppSetDetail {
  set: { id: string; title: string; description: string | null; subject: string; class_level: string | null; chapter: string | null;
         difficulty: string; time_limit_minutes: number | null; status: string; source: string };
  items: (DppEditorItem & { id: string; position: number; numeric_answer: number | null })[];
  students: { student_id: string; name: string; class: string; assigned_for: string; status: DppAssignmentStatus; attempt_id: string | null;
              percent: number | null; score: number | null; max_score: number | null; time_taken_seconds: number | null; submitted_at: string | null; pending_manual: number }[];
  question_stats: { item_id: string; position: number; answered: number; correct: number; correct_percent: number | null }[];
}
export interface DppAdminOverview {
  today: string; days: number;
  totals: { students: number; participants: number; assigned: number; submitted: number; avg_percent: number | null; pending: number };
  by_class: { class: string; assigned: number; submitted: number; completion: number | null; avg_percent: number | null }[];
  by_subject: { subject: string; attempts: number; avg_percent: number | null; answers: number; weak: boolean }[];
  daily: { date: string; assigned: number; submitted: number; avg_percent: number | null }[];
  teachers: { teacher_id: string; name: string | null; sets: number; assignments: number; submissions: number }[];
}
export interface DppParentOverview extends DppSummary {
  child_name: string; today: string;
  assigned: { title: string; subject: string; assigned_for: string; questions: number; status: "pending" | "in_progress" | "submitted"; percent: number | null; submitted_at: string | null }[];
  pending_count: number;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "-";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}s`;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Short weekday label for a yyyy-mm-dd date, without timezone drift. */
export function weekdayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

export function percentTone(p: number | null | undefined): "good" | "ok" | "low" | "none" {
  if (p == null) return "none";
  if (p >= 75) return "good";
  if (p >= 50) return "ok";
  return "low";
}

export const TONE_CLASS = {
  good: "bg-emerald-100 text-emerald-800 border-emerald-300",
  ok: "bg-amber-100 text-amber-800 border-amber-300",
  low: "bg-red-100 text-red-800 border-red-300",
  none: "bg-muted text-muted-foreground border-border",
} as const;

export const DIFFICULTY_CLASS: Record<string, string> = {
  easy: "bg-emerald-100 text-emerald-800 border-emerald-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  hard: "bg-red-100 text-red-800 border-red-300",
  mixed: "bg-blue-100 text-blue-800 border-blue-300",
};

/** Turns a database exception into a message a student or teacher can act on. */
export function friendlyDppError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e ?? "");
  if (raw.includes("ALREADY_SUBMITTED")) return "This practice was already submitted.";
  if (raw.includes("NOT_AVAILABLE_YET")) return raw.replace(/^.*NOT_AVAILABLE_YET: ?/, "Not open yet: ");
  if (raw.includes("ASSIGNMENT_NOT_FOUND") || raw.includes("ATTEMPT_NOT_FOUND")) return "This practice is not available to you.";
  if (raw.includes("SET_LOCKED")) return "Students have already started this set, so its questions can't be changed. Create a new set instead.";
  if (raw.includes("NOT_AUTHENTICATED")) return "Your session expired. Please sign in again.";
  if (raw.includes("FORBIDDEN")) return raw.includes(":") ? raw.replace(/^.*FORBIDDEN: ?/, "") : "You don't have permission to do that.";
  const m = raw.match(/INVALID: ?(.*)$/m);
  if (m) return m[1];
  return raw || "Something went wrong. Please try again.";
}

/** Client-side check of an editor row before sending; the database validates again. Returns an error message or null. */
export function validateEditorItem(it: DppEditorItem, n: number): string | null {
  if (!it.stem.trim()) return `Question ${n}: write the question text.`;
  if (!(it.marks > 0) || it.marks > 100) return `Question ${n}: marks must be more than 0 and at most 100.`;
  if (it.question_type === "mcq") {
    const o = it.options ?? {};
    const filled = ["A", "B", "C", "D"].filter((k) => (o[k] ?? "").trim());
    if (!(o.A ?? "").trim() || !(o.B ?? "").trim()) return `Question ${n}: options A and B are required.`;
    if (!it.correct_answer || !filled.includes(it.correct_answer)) return `Question ${n}: choose the correct option (it must have text).`;
  }
  if (it.question_type === "true_false" && !["A", "B"].includes(it.correct_answer ?? "")) return `Question ${n}: choose True or False.`;
  if (it.question_type === "short_answer" && !(it.accepted_answers ?? []).some((a) => a.trim())) return `Question ${n}: add at least one accepted answer.`;
  if (it.question_type === "numeric" && (it.numeric_answer == null || Number.isNaN(Number(it.numeric_answer)))) return `Question ${n}: enter the numeric answer.`;
  return null;
}

/** Shapes an editor row into what dpp_save_set expects (drops empty options and blank accepted answers). */
export function toRpcItem(it: DppEditorItem): Record<string, unknown> {
  const base: Record<string, unknown> = {
    question_type: it.question_type, stem: it.stem.trim(), marks: it.marks, difficulty: it.difficulty,
    explanation: it.explanation?.trim() || null, bank_item_id: it.bank_item_id ?? null,
    learning_objective_id: it.learning_objective_id ?? null, subtopic_id: it.subtopic_id ?? null, chapter: it.chapter ?? null,
  };
  if (it.question_type === "mcq") {
    const options: Record<string, string> = {};
    for (const k of ["A", "B", "C", "D"]) if ((it.options?.[k] ?? "").trim()) options[k] = it.options![k].trim();
    return { ...base, options, correct_answer: it.correct_answer };
  }
  if (it.question_type === "true_false") return { ...base, correct_answer: it.correct_answer };
  if (it.question_type === "short_answer") return { ...base, accepted_answers: (it.accepted_answers ?? []).map((a) => a.trim()).filter(Boolean) };
  if (it.question_type === "numeric") return { ...base, numeric_answer: it.numeric_answer, tolerance: it.tolerance ?? 0 };
  return base;
}

export function blankEditorItem(type: DppQuestionType = "mcq"): DppEditorItem {
  return {
    question_type: type, stem: "", marks: 1, difficulty: "medium", explanation: "",
    options: type === "mcq" ? { A: "", B: "", C: "", D: "" } : undefined,
    correct_answer: type === "true_false" ? "A" : undefined,
    accepted_answers: type === "short_answer" ? [""] : undefined,
    numeric_answer: type === "numeric" ? null : undefined, tolerance: 0,
  };
}

/** What the AI Tutor is told to open with for a DPP question. */
export function tutorPromptForItem(stem: string, wasCorrect: boolean | null): string {
  const q = stem.trim().slice(0, 400);
  return wasCorrect === false
    ? `I got this practice question wrong: "${q}". Can you explain how to solve it step by step?`
    : `Can you explain this practice question in a simple way: "${q}"`;
}
