// Client for the School Academic Digital Twin and What-If Academic Simulation.
// Both are served by the existing `whatif-timetable` edge function (no new function) via `mode`.
import { supabase } from "@/integrations/supabase/client";

export type Risk = { high: number; medium: number; low: number };

export interface TwinSignal {
  severity: "critical" | "warning" | "info";
  type: string;
  message: string;
  class_id?: string;
  teacher_id?: string;
  subject?: string;
}

export interface TwinSubject {
  subject: string;
  teacher_id: string;
  teacher_name: string;
  weekly_periods: number;
  syllabus: { covered: number; total: number; pct: number | null };
  avg_predicted: number | null;
  students_with_data: number;
  risk: Risk;
}

export interface TwinClass {
  id: string;
  name: string;
  section: string;
  student_count: number;
  avg_predicted: number | null;
  avg_mastery_pct: number | null;
  risk: Risk;
  attendance_pct: number | null;
  syllabus_pct: number | null;
  weekly_periods: number;
  free_slots: number;
  has_timetable: boolean;
  health: number | null;
  health_label: "healthy" | "watch" | "attention" | "no_data";
  subjects: TwinSubject[];
}

export interface TwinTeacher {
  id: string;
  name: string;
  weekly_periods: number;
  load_status: "ok" | "high" | "overloaded" | "none";
  assignments: { class_id: string; class: string; subject: string; weekly_periods: number }[];
  syllabus_pct: number | null;
  avg_student_predicted: number | null;
  attendance_pct: number | null;
}

export interface TwinSnapshot {
  model_version: string;
  generated_at: string;
  school_id: string;
  scope: "school" | "teacher";
  window_days: number;
  summary: {
    students: number;
    teachers: number;
    classes: number;
    avg_predicted: number | null;
    avg_mastery_pct: number | null;
    avg_syllabus_pct: number | null;
    student_attendance_pct: number | null;
    teacher_attendance_pct: number | null;
    risk: Risk & { unassessed: number };
    scheduled_periods_per_week: number;
    avg_teacher_load: number | null;
    classes_with_timetable: number;
  };
  classes: TwinClass[];
  teachers: TwinTeacher[];
  signals: TwinSignal[];
  data_quality: {
    students_without_predictions: number;
    classes_without_timetable: number;
    class_subjects_without_syllabus: number;
    unmatched_timetable_cells: number;
    mastery_sampled: boolean;
    last_prediction_at: string | null;
  };
}

export interface SimOptions {
  classes: {
    id: string;
    name: string;
    section: string;
    student_count: number;
    has_timetable: boolean;
    subjects: { subject: string; teacher_id: string; teacher_name: string; weekly_periods: number }[];
  }[];
  teachers: { id: string; name: string }[];
  max_weeks: number;
}

export interface ScenarioRequest {
  label?: string;
  subject: string;
  extra_periods: number;
  remedial_periods: number;
  remedial_target: "at_risk" | "below_average" | "all";
  weeks: number;
  teacher_id?: string;
}

export interface ScenarioResult {
  label: string;
  error?: string;
  scenario?: ScenarioRequest;
  timetable?: { weekly_periods_now: number; weekly_periods_after: number; remedial_periods: number };
  projected?: {
    students_evaluated: number;
    students_without_baseline: number;
    students_targeted: number;
    avg_before: number | null;
    avg_after: number | null;
    avg_gain: number | null;
    gain_low: number | null;
    gain_high: number | null;
    confidence: "none" | "low" | "medium";
  };
  risk?: { before: Risk; after: Risk; improved: number; declined: number };
  syllabus?: {
    available: boolean;
    note?: string;
    covered?: number;
    total?: number;
    current_pct?: number | null;
    lessons_per_week_now?: number;
    lessons_per_week_after?: number;
    projected_pct_without_change?: number | null;
    projected_pct_with_change?: number | null;
    weeks_to_finish_now?: number | null;
    weeks_to_finish_after?: number | null;
  };
  teacher_load?: {
    teacher_id: string;
    teacher_name: string;
    before: number;
    after: number;
    class_teacher_before: number;
    class_teacher_after: number;
    status: "ok" | "high" | "overloaded";
  };
  feasibility?: {
    checked: boolean;
    slots_needed: number;
    slots_available: number | null;
    slots_freed: number;
    sample_slots: { day: string; period: string }[];
    feasible: boolean | null;
    note: string;
  };
  students?: {
    student_id: string;
    name: string;
    before: number;
    after: number;
    delta: number;
    targeted: boolean;
    attendance_pct: number;
    baseline_source: "subject" | "other_subjects";
  }[];
  warnings?: string[];
  assumptions?: string[];
}

export interface SimResponse {
  class: { id: string; name: string; section: string; student_count: number; attendance_pct: number | null; has_timetable: boolean };
  results: ScenarioResult[];
  model: { version: string; kind: string; disclaimer: string; assumptions: string[] };
}

/** Surfaces the function's own error message instead of a generic "non-2xx" one. */
async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("whatif-timetable", { body });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j?.error) message = j.error;
      }
    } catch { /* keep generic message */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const fetchTwinSnapshot = () => call<TwinSnapshot>({ mode: "twin_snapshot" });
export const fetchSimOptions = () => call<SimOptions>({ mode: "academic_simulation_options" });
export const runAcademicSimulation = (class_id: string, scenarios: ScenarioRequest[]) =>
  call<SimResponse>({ mode: "academic_simulation", class_id, scenarios });
