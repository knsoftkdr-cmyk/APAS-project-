import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

// Enrichment Content Generator. Served by generate-item-bank (Edge Function limit):
// the discriminator is action: "enrichment" - there is no separate enrichment function.

export type EnrichmentScopeType = "chapter" | "topic" | "subtopic";

export interface EnrichmentContent {
  title: string;
  tagline: string | null;
  why_it_matters: string | null;
  deep_dive: Array<{ heading: string; explanation: string; key_takeaway: string | null }>;
  challenge_problems: Array<{ question: string; hint: string | null; worked_solution: string; level: "hard" | "stretch" }>;
  think_about_it: string[];
  real_world_connections: string[];
  project: { title: string; description: string } | null;
  key_terms: Array<{ term: string; meaning: string }>;
}

export interface EnrichmentPack {
  id: string | null;
  title: string;
  language: string;
  content: EnrichmentContent;
  cached: boolean;
  created_at: string;
}

export type EnrichmentResponse =
  | { eligible: true; avg_mastery: number | null; pack: EnrichmentPack }
  | {
      eligible: false;
      avg_mastery: number | null;
      required: number;
      attempted_objectives: number;
      needed_objectives: number;
      message: string;
    };

export interface EnrichmentRequest {
  scope_type: EnrichmentScopeType;
  scope_id: number;
  language?: string;
  /** Staff only - the server ignores it for students. */
  refresh?: boolean;
}

export function useGenerateEnrichment() {
  return useMutation<EnrichmentResponse, Error, EnrichmentRequest>({
    mutationFn: async (req) => {
      const { data, error } = await supabase.functions.invoke("generate-item-bank", {
        body: { ...req, action: "enrichment" },
      });
      if (error) {
        const { message } = await unwrapFunctionError(error, "Could not generate enrichment material.");
        throw new Error(message);
      }
      return data as EnrichmentResponse;
    },
  });
}
