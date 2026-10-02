import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

// Individual Education Plan generator. Served by the already-deployed `ai-teacher-assistant`
// function via action "iep_generate" (no new edge function). It returns a DRAFT and saves nothing.

export const IEP_DOMAINS = ["Academic", "Behavioral", "Communication", "Social", "Motor", "Self-Help"] as const;

export interface IepDraftGoal {
  domain: string;
  goal_description: string;
  baseline: string;
  target_criteria: string;
  target_date: string;
}

export interface IepDraftAccommodation {
  accommodation_type: string;
  applies_to: string;
  description: string;
}

export interface IepDraft {
  title: string;
  start_date: string;
  end_date: string;
  next_review_date: string;
  present_levels: string;
  strengths: string[];
  needs: string[];
  goals: IepDraftGoal[];
  accommodations: IepDraftAccommodation[];
  strategies: string[];
}

export interface IepGenerateResponse {
  sen_student_id: string;
  student_name: string;
  generated_at: string;
  source: "ai" | "rules";
  model: string | null;
  draft: IepDraft;
  warnings: string[];
  data_gaps: string[];
}

export async function generateIepDraft(opts: {
  senStudentId: string;
  durationMonths?: number;
  focusDomains?: string[];
  teacherNotes?: string;
}): Promise<IepGenerateResponse> {
  const { data, error } = await supabase.functions.invoke("ai-teacher-assistant", {
    body: {
      action: "iep_generate",
      sen_student_id: opts.senStudentId,
      duration_months: opts.durationMonths,
      focus_domains: opts.focusDomains,
      teacher_notes: opts.teacherNotes,
    },
  });
  if (error) {
    const { message } = await unwrapFunctionError(error, "Couldn't generate the IEP draft.");
    throw new Error(message);
  }
  const payload = data as (IepGenerateResponse & { error?: string }) | null;
  if (!payload || payload.error || !payload.draft) {
    throw new Error(payload?.error ?? "Couldn't generate the IEP draft.");
  }
  return payload;
}

/** Plain-text version of a draft for the "Copy full IEP" button. */
export function draftToText(d: IepDraft, studentName: string): string {
  const out: string[] = [];
  out.push(`${d.title} - ${studentName}`, `Plan period: ${d.start_date} to ${d.end_date}. Next review: ${d.next_review_date}.`, "");
  out.push("PRESENT LEVELS", d.present_levels, "");
  if (d.strengths.length) out.push("STRENGTHS", ...d.strengths.map((s) => `- ${s}`), "");
  if (d.needs.length) out.push("NEEDS", ...d.needs.map((s) => `- ${s}`), "");
  out.push("GOALS");
  d.goals.forEach((g, n) => out.push(`${n + 1}. [${g.domain}] ${g.goal_description}`, `   Baseline: ${g.baseline}`, `   Target: ${g.target_criteria} (by ${g.target_date})`));
  out.push("");
  if (d.accommodations.length) out.push("ACCOMMODATIONS", ...d.accommodations.map((a) => `- ${a.accommodation_type} (${a.applies_to}): ${a.description}`), "");
  if (d.strategies.length) out.push("TEACHING STRATEGIES", ...d.strategies.map((s) => `- ${s}`));
  return out.join("\n");
}
