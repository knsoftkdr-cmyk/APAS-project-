// Doubt tickets: shared types and the response-time numbers shown to staff.

export type DoubtStatus = "new" | "in_progress" | "resolved";

export interface Doubt {
  id: string;
  school_id: string;
  student_id: string;
  teacher_id: string;
  student_name: string;
  teacher_name: string;
  class_label: string | null;
  subject: string;
  question: string;
  source: "manual" | "ai_tutor";
  status: DoubtStatus;
  first_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DoubtReply {
  id: string;
  doubt_id: string;
  author_id: string;
  author_name: string;
  is_student: boolean;
  body: string;
  created_at: string;
}

export function doubtStatusLabel(status: DoubtStatus): string {
  if (status === "in_progress") return "In Progress";
  if (status === "resolved") return "Resolved";
  return "New";
}

export interface DoubtStats {
  new: number;
  inProgress: number;
  resolved: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
}

const minutesBetween = (from: string, to: string) => (new Date(to).getTime() - new Date(from).getTime()) / 60000;
const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function doubtStats(doubts: Pick<Doubt, "status" | "created_at" | "first_response_at" | "resolved_at">[]): DoubtStats {
  return {
    new: doubts.filter((d) => d.status === "new").length,
    inProgress: doubts.filter((d) => d.status === "in_progress").length,
    resolved: doubts.filter((d) => d.status === "resolved").length,
    avgFirstResponseMinutes: average(doubts.filter((d) => d.first_response_at).map((d) => minutesBetween(d.created_at, d.first_response_at!))),
    avgResolutionMinutes: average(doubts.filter((d) => d.status === "resolved" && d.resolved_at).map((d) => minutesBetween(d.created_at, d.resolved_at!))),
  };
}

export function formatDuration(minutes: number | null): string {
  if (minutes == null) return "-";
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)} hrs`;
  return `${(minutes / (60 * 24)).toFixed(1)} days`;
}
