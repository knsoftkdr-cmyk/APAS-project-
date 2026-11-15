// Client for the Interactive Video Player. Served by the existing `get-mastery-history` edge function via the
// `vid_*` actions; server side: supabase/functions/_shared/handlers/interactiveVideo.ts (rules in
// interactiveVideoModel.ts). The videos are the existing Marketplace video listings.
import { call } from "@/lib/learningEvents";

export type QuestionType = "mcq" | "true_false";

/** What a student receives: no correct answer, no explanation (those come back after they answer). */
export interface PlayerQuestion {
  id: string; timestamp_seconds: number; question_text: string; question_type: QuestionType; options: string[];
}
/** What staff receive. */
export interface StaffQuestion extends PlayerQuestion { correct_index: number; explanation: string | null; source?: string }

export interface QuestionDraft {
  timestamp_seconds: number; question_text: string; question_type: QuestionType; options: string[]; correct_index: number; explanation: string | null;
}

export interface VideoSettings { allow_video_skip: boolean; allow_question_skip: boolean; duration_seconds: number | null }

export interface AnsweredQuestion {
  question_id: string; attempts: number; skipped: boolean; selected_index: number | null; is_correct: boolean | null;
  correct_index?: number; explanation?: string | null;
}
export interface VideoProgressRow {
  last_position_seconds: number; furthest_seconds: number; watched_seconds: number; duration_seconds: number;
  completion_pct: number; completed: boolean; watched_ranges: [number, number][];
}

export interface PlayerConfig {
  persistence?: "unavailable" | "available";
  listing: { id: string; title: string };
  settings: VideoSettings;
  questions: PlayerQuestion[];
  answered: AnsweredQuestion[];
  progress: VideoProgressRow | null;
  resume_at: number;
}
export interface StaffConfig { persistence?: "unavailable" | "available"; listing: { id: string; title: string }; settings: VideoSettings; questions: StaffQuestion[] }

export interface AnswerResult { ok: boolean; skipped: boolean; is_correct: boolean | null; correct_index: number; explanation: string | null; attempt_no: number }

export interface Doubt {
  id: string; timestamp_seconds: number; question_text: string; ai_answer: string | null; answer_text: string | null;
  answered_at?: string | null; status: "open" | "answered"; created_at: string; student_id?: string; student_name?: string | null;
}

export interface QuestionStat {
  question_id: string; timestamp_seconds: number; question_text: string; options: string[]; correct_index: number;
  students: number; answered: number; skipped: number; correct: number; accuracy_pct: number | null; option_counts: number[];
}
export interface VideoSummary { viewers: number; avg_watch_seconds: number; avg_completion_pct: number; completed: number; completion_rate_pct: number | null }
export interface VideoOverviewRow extends VideoSummary {
  listing_id: string; title: string; class_label: string | null; subject: string | null; question_count: number;
  answers: number; accuracy_pct: number | null; doubts_total: number; doubts_open: number;
}
export interface VideoStudentRow {
  student_id: string; name: string | null; watched_seconds: number; duration_seconds: number; completion_pct: number; completed: boolean;
  last_watched_at: string; questions_answered: number; questions_correct: number;
}
export interface VideoDetail {
  persistence?: "unavailable" | "available";
  listing: { id: string; title: string; class_label: string | null; subject: string | null };
  settings: VideoSettings; summary: VideoSummary; questions: QuestionStat[]; students: VideoStudentRow[];
  doubts: { total: number; open: number }; scope: "school" | "your_classes";
}
export interface StudentVideoRow {
  listing_id: string; title: string; watched_seconds: number; duration_seconds: number; completion_pct: number; completed: boolean;
  last_watched_at: string | null; questions_answered: number; questions_correct: number; questions_skipped: number; doubts: number;
}

export const fetchVideoConfig = <T = PlayerConfig | StaffConfig>(listingId: string) => call<T>({ action: "vid_config", listing_id: listingId });
export const saveVideoSettings = (listingId: string, s: VideoSettings) => call<{ ok: boolean; settings: VideoSettings }>({ action: "vid_settings_save", listing_id: listingId, ...s });
export const saveVideoQuestion = (listingId: string, question: QuestionDraft, id?: string) => call<{ ok: boolean; id: string }>({ action: "vid_question_save", listing_id: listingId, question, ...(id ? { id } : {}) });
export const addVideoQuestions = (listingId: string, questions: QuestionDraft[], source: "ai" | "manual") => call<{ ok: boolean; added: number }>({ action: "vid_question_bulk", listing_id: listingId, questions, source });
export const deleteVideoQuestion = (listingId: string, id: string) => call<{ ok: boolean }>({ action: "vid_question_delete", listing_id: listingId, id });
export const generateVideoQuestions = (listingId: string, o: { count: number; notes?: string; durationSeconds?: number | null }) =>
  call<{ questions: QuestionDraft[]; used_notes: boolean; duration_seconds: number }>({ action: "vid_generate", listing_id: listingId, count: o.count, notes: o.notes, duration_seconds: o.durationSeconds ?? undefined });
export const answerVideoQuestion = (questionId: string, a: { selectedIndex?: number; skipped?: boolean; timeToAnswerMs?: number }) =>
  call<AnswerResult>({ action: "vid_answer", question_id: questionId, selected_index: a.selectedIndex, skipped: a.skipped === true, time_to_answer_ms: a.timeToAnswerMs });
export const saveVideoProgress = (p: { listingId: string; position: number; furthest: number; duration: number; ranges: [number, number][] }) =>
  call<{ ok: boolean; watched_seconds: number; completion_pct: number; completed: boolean }>({ action: "vid_progress", listing_id: p.listingId, position: p.position, furthest: p.furthest, duration: p.duration, ranges: p.ranges });
export const postVideoDoubt = (listingId: string, timestampSeconds: number, question: string) => call<{ ok: boolean; doubt: Doubt }>({ action: "vid_doubt_post", listing_id: listingId, timestamp_seconds: timestampSeconds, question });
export const fetchVideoDoubts = (listingId: string) => call<{ doubts: Doubt[] }>({ action: "vid_doubts", listing_id: listingId });
export const answerVideoDoubt = (doubtId: string, answer: string) => call<{ ok: boolean }>({ action: "vid_doubt_answer", doubt_id: doubtId, answer });
export const fetchVideoOverview = () => call<{ persistence?: string; videos: VideoOverviewRow[]; scope: "school" | "your_classes" }>({ action: "vid_analytics" });
export const fetchVideoDetail = (listingId: string) => call<VideoDetail>({ action: "vid_analytics", listing_id: listingId });
export const fetchStudentVideoReport = (studentId: string) => call<{ persistence?: string; videos: StudentVideoRow[] }>({ action: "vid_student_report", student_id: studentId });

export const formatTimestamp = (s: number): string => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

/** "3:05" / "1:02:03" / "185" -> seconds, or null when it is not a time. */
export function parseTimestamp(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  const parts = t.split(":").map((p) => p.trim());
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.length > 1 && n.slice(1).some((x) => x > 59)) return null;
  return n.reduce((acc, x) => acc * 60 + x, 0);
}

export const formatWatch = (seconds: number): string => {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
