import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface GraphNode {
  id: number;
  name: string;
  chapter_id?: number;
  chapter_name?: string;
  topic_id?: number;
  topic_name?: string;
  is_external?: boolean;
}

export interface GraphEdge {
  from: number;
  to: number;
  strength: number;
  rationale: string | null;
}

export interface Misconception {
  id: number;
  subtopic_id: number;
  text: string;
  why: string | null;
  correction: string | null;
  severity: "low" | "medium" | "high";
}

export interface PrerequisiteInfo {
  subtopic_id: number;
  name: string;
  strength: number;
  p_mastery: number;
  attempted: boolean;
}

export interface ReadinessResult {
  subtopic_id: number;
  prerequisite_count: number;
  readiness_score: number;
  is_ready: boolean;
  prerequisites: PrerequisiteInfo[];
}

export interface AtRiskConcept {
  subtopic_id: number;
  subtopic_name: string;
  topic_id: number;
  topic_name: string;
  readiness_score: number;
  weak_prerequisites: PrerequisiteInfo[];
}

// ── Topic-level graph for a whole subject ────────────────────────────────
export function useTopicGraph(bookId?: number) {
  return useQuery<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    queryKey: ["knowledge-graph-topics", bookId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-knowledge-graph", { body: { book_id: bookId } });
      if (error) throw error;
      return { nodes: data?.nodes ?? [], edges: data?.edges ?? [] };
    },
    enabled: !!bookId,
    staleTime: 60 * 1000,
  });
}

// ── Concept-level graph + misconceptions for one topic ───────────────────
export function useConceptGraph(topicId?: number) {
  return useQuery<{ nodes: GraphNode[]; edges: GraphEdge[]; misconceptions: Misconception[] }>({
    queryKey: ["knowledge-graph-concepts", topicId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-knowledge-graph", { body: { topic_id: topicId } });
      if (error) throw error;
      return { nodes: data?.nodes ?? [], edges: data?.edges ?? [], misconceptions: data?.misconceptions ?? [] };
    },
    enabled: !!topicId,
    staleTime: 60 * 1000,
  });
}

// ── AI-generate the graph (topic-level via bookId, concept-level via topicId) ──
export function useGenerateKnowledgeGraph() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { bookId?: number; topicId?: number }) => {
      const { data, error } = await supabase.functions.invoke("generate-knowledge-graph", {
        body: { book_id: args.bookId, topic_id: args.topicId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-graph-topics"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-graph-concepts"] });
    },
  });
}

// ── Prerequisite readiness for one concept (self, or a given student for staff) ──
export function usePrerequisiteReadiness(subtopicId?: number, studentId?: string) {
  return useQuery<ReadinessResult>({
    queryKey: ["prerequisite-readiness", subtopicId, studentId ?? "self"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-prerequisite-readiness", {
        body: { subtopic_id: subtopicId, student_id: studentId },
      });
      if (error) throw error;
      return data as ReadinessResult;
    },
    enabled: !!subtopicId,
    staleTime: 60 * 1000,
  });
}

// ── At-risk concepts across a subject (self, or a given student for staff) ──
export function useAtRiskConcepts(bookId?: number, studentId?: string) {
  return useQuery<AtRiskConcept[]>({
    queryKey: ["at-risk-concepts", bookId, studentId ?? "self"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-at-risk-concepts", {
        body: { book_id: bookId, student_id: studentId },
      });
      if (error) throw error;
      return (data?.at_risk ?? []) as AtRiskConcept[];
    },
    enabled: !!bookId,
    staleTime: 60 * 1000,
  });
}
