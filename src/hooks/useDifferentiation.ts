// src/hooks/useDifferentiation.ts
// AI-assisted differentiation (sheet row 46). Data: ai-teacher-assistant { action: "differentiate", op } -
// see supabase/functions/_shared/handlers/differentiation.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeFn } from "@/hooks/useExamIntelligence";

export const DIFF_VERSIONS = [
  { key: "support", label: "Support", help: "Below level: scaffolds, worked example first" },
  { key: "core", label: "Core", help: "At grade level" },
  { key: "challenge", label: "Challenge", help: "Above level: deeper, open-ended" },
  { key: "language", label: "Language support", help: "Simple sentences, glossary, home-language help" },
  { key: "visual", label: "Visual", help: "Diagrams, tables, colour-coding" },
  { key: "sen", label: "SEN-friendly", help: "Short chunks, checklists, dyslexia-friendly" },
] as const;
export type DiffVersionKey = typeof DIFF_VERSIONS[number]["key"];

export const MATERIAL_TYPES = [
  { key: "worksheet", label: "Worksheet" },
  { key: "reading", label: "Reading passage" },
  { key: "notes", label: "Explanation notes" },
  { key: "exit_ticket", label: "Exit ticket" },
  { key: "homework", label: "Homework" },
] as const;

export interface DiffVersion {
  key: DiffVersionKey; label: string; for_whom: string; student_instructions: string;
  content: string; questions: Array<{ q: string; answer: string }>; teacher_notes: string;
}
export interface DiffPack {
  id: string; created_at: string; title: string; learning_objective: string; versions: DiffVersion[];
  group_counts?: Record<string, number> | null;
}
export interface DiffPackSummary { id: string; topic: string; subject: string | null; grade: string | null; material_type: string; created_at: string; versions: Array<{ key: string; label: string }> }

const call = <T,>(op: string, body: Record<string, unknown> = {}) => invokeFn<T>("ai-teacher-assistant", { action: "differentiate", op, ...body });

export function useDiffPacks() {
  return useQuery({ queryKey: ["diff-packs"], queryFn: () => call<{ packs: DiffPackSummary[] }>("list").then((r) => r.packs) });
}

export function useGenerateDiff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      topic: string; material_type: string; versions: string[]; subject?: string; grade?: string; objective?: string;
      language?: string; class_id?: string; book_id?: string; chapter_id?: string;
    }) => call<DiffPack>("generate", args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diff-packs"] }),
  });
}

/** Loads a saved pack into the same shape "generate" returns. */
export async function loadDiffPack(id: string): Promise<DiffPack> {
  // deno-lint-ignore no-explicit-any
  const { pack } = await call<{ pack: any }>("get", { id });
  return {
    id: pack.id, created_at: pack.created_at, title: pack.request?.title ?? pack.topic,
    learning_objective: pack.request?.learning_objective ?? "", versions: pack.versions ?? [], group_counts: pack.request?.group_counts ?? null,
  };
}

export const deleteDiffPack = (id: string) => call<{ ok: true }>("delete", { id });
export const shareDiffVersion = (id: string, versionKey: string, classId: string) =>
  call<{ material_id: string }>("share", { id, version_key: versionKey, class_id: classId });
