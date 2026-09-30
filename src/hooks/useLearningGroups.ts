// src/hooks/useLearningGroups.ts
//
// Frontend calls for Peer Group Identification, Dynamic Student Grouping and the Teacher Copilot.
// None of these are their own edge function (deployment limit) - they are served by two existing ones:
//   get-class-mastery     { mode: "peer_groups" | "dynamic_groups", ... }
//   ai-teacher-assistant  { action: "copilot", ... }
// See supabase/functions/CONSOLIDATION.md.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

// ── Shared types ────────────────────────────────────────────────────────────────────────────
export type Tier = "remedial" | "regular" | "enrichment";
export type Pace = "slow" | "average" | "fast" | "insufficient_data";
export type RiskLevel = "high" | "medium" | "low" | "insufficient_data";

export class FunctionCallError extends Error {
  code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const { message, code } = await unwrapFunctionError(error, "Request failed");
    throw new FunctionCallError(message, code);
  }
  return data as T;
}

// ── Peer groups ─────────────────────────────────────────────────────────────────────────────
export interface SharedNeed {
  topic_id: number; topic_name: string; chapter_name: string;
  weak_count: number; member_count: number; avg_score: number;
}
export interface PeerGroupMember {
  student_id: string; full_name: string; score: number | null; pace: Pace | null; risk: RiskLevel | null;
  fit: number; weak_topic_ids: number[];
}
export interface SharedMisconception {
  misconception: string; severity: string; students_affected: number;
  correction_hint: string | null; why_it_happens: string | null;
}
export interface PeerGroup {
  id: string; kind: "support" | "extension"; label: string; cohesion: number; size: number;
  avg_score: number | null; pace_mix: Record<string, number>;
  shared_needs: SharedNeed[]; members: PeerGroupMember[]; shared_misconceptions: SharedMisconception[];
}
export interface PeerGroupsResponse {
  class_id: string; class_name?: string | null; book_id: number | null;
  roster_size: number; assessed_count: number;
  groups: PeerGroup[];
  individual: Array<{ student_id: string; full_name: string; score: number | null; weak_topics: Array<{ topic_id: number; topic_name: string; score: number }> }>;
  on_track: Array<{ student_id: string; full_name: string; score: number | null }>;
  unassessed: Array<{ student_id: string; full_name: string }>;
  warnings: string[]; generated_at?: string;
}

export function usePeerGroups(classId?: string, bookId?: number) {
  return useQuery<PeerGroupsResponse>({
    queryKey: ["peer-groups", classId, bookId ?? "all"],
    queryFn: () => invoke<PeerGroupsResponse>("get-class-mastery", { mode: "peer_groups", class_id: classId, book_id: bookId ?? null }),
    enabled: !!classId,
    staleTime: 60 * 1000,
  });
}

// ── Dynamic learning groups ─────────────────────────────────────────────────────────────────
export interface TierPlacement {
  student_id: string; full_name: string; tier: Tier; previous_tier: Tier | null; moved: "up" | "down" | null;
  composite: number | null; mastery: number | null; pace: Pace | null; risk: RiskLevel | null;
  reasons: string[]; pinned: boolean; provisional: boolean; suggested_tier: Tier;
}
export interface TierSummary {
  tier: Tier; count: number; avg_composite: number | null; student_ids: string[];
  focus_topics: Array<{ topic_id: number; topic_name: string; chapter_name: string; avg_score: number; members: number }>;
}
export interface DynamicGroupsResponse {
  class_id: string; class_name?: string | null; book_id: number | null; op: "preview" | "apply";
  saved: boolean; persistence_available: boolean; roster_size: number;
  thresholds: { remedial_below: number; enrichment_at_least: number; hysteresis: number; high_risk_margin: number };
  tiers: TierSummary[]; placements: TierPlacement[];
  changes: { up: string[]; down: string[]; new: number };
  warnings: string[]; generated_at: string;
}
export interface SavedGroupsResponse {
  class_id: string; book_id: number | null; roster_size: number; saved: boolean; computed_at: string | null;
  counts: Record<Tier, number>;
  placements: Array<{ student_id: string; full_name: string; tier: Tier; previous_tier: Tier | null; composite: number | null; pinned: boolean; pinned_note: string | null; computed_at: string }>;
  recent_moves: Array<{ student_id: string; full_name: string; from_tier: Tier | null; to_tier: Tier; composite: number | null; source: "auto" | "manual"; note: string | null; changed_at: string }>;
}
export interface GroupThresholds { remedial_below?: number; enrichment_at_least?: number }

export function useGroupsPreview(classId?: string, bookId?: number, thresholds?: GroupThresholds) {
  return useQuery<DynamicGroupsResponse>({
    queryKey: ["learning-groups", "preview", classId, bookId ?? "all", thresholds ?? {}],
    queryFn: () => invoke<DynamicGroupsResponse>("get-class-mastery", {
      mode: "dynamic_groups", op: "preview", class_id: classId, book_id: bookId ?? null, ...thresholds,
    }),
    enabled: !!classId,
    staleTime: 60 * 1000,
  });
}

/** Saved placements + recent moves. A 503 "not_deployed" (migration missing) resolves to null instead of throwing. */
export function useSavedGroups(classId?: string, bookId?: number) {
  return useQuery<SavedGroupsResponse | null>({
    queryKey: ["learning-groups", "current", classId, bookId ?? "all"],
    queryFn: async () => {
      try {
        return await invoke<SavedGroupsResponse>("get-class-mastery", {
          mode: "dynamic_groups", op: "current", class_id: classId, book_id: bookId ?? null,
        });
      } catch (e) {
        if (e instanceof FunctionCallError && e.code === "not_deployed") return null;
        throw e;
      }
    },
    enabled: !!classId,
    staleTime: 30 * 1000,
  });
}

export function useApplyGroups(classId?: string, bookId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (thresholds?: GroupThresholds) => invoke<DynamicGroupsResponse>("get-class-mastery", {
      mode: "dynamic_groups", op: "apply", class_id: classId, book_id: bookId ?? null, ...thresholds,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["learning-groups"] }),
  });
}

export function useOverrideGroup(classId?: string, bookId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { studentId: string; tier: Tier | null; note?: string }) => invoke<{ pinned: boolean }>("get-class-mastery", {
      mode: "dynamic_groups", op: "override", class_id: classId, book_id: bookId ?? null,
      student_id: v.studentId, tier: v.tier, note: v.note,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["learning-groups"] }),
  });
}

// ── Teacher Copilot ─────────────────────────────────────────────────────────────────────────
export type CopilotTask = "auto" | "lesson_plan" | "assessment" | "remediation" | "student_analysis" | "general";
export interface CopilotTurn { role: "user" | "assistant"; content: string }
export interface CopilotRequest {
  message: string; task?: CopilotTask; classId?: string; bookId?: number; studentId?: string; history?: CopilotTurn[];
}
export interface CopilotResponse {
  task: Exclude<CopilotTask, "auto">; reply: string;
  scope: { class_id: string | null; class_name: string | null; student_id: string | null; student_name: string | null; book_id: number | null };
  grounded_in: string[]; suggested_actions: Array<{ label: string; route: string }>; warnings: string[];
}

export function useTeacherCopilot() {
  return useMutation({
    mutationFn: (r: CopilotRequest) => invoke<CopilotResponse>("ai-teacher-assistant", {
      action: "copilot", message: r.message, task: r.task ?? "auto",
      class_id: r.classId ?? null, book_id: r.bookId ?? null, student_id: r.studentId ?? null,
      history: (r.history ?? []).slice(-8),
    }),
  });
}
