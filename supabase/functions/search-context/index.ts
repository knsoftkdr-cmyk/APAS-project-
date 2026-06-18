import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-ada-002",
      input: text.slice(0, 8000),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    const status = response.status;
    
    // Check for quota/rate limit errors
    if (status === 429) {
      throw new Error("OPENAI_QUOTA_EXCEEDED");
    }
    throw new Error(`OpenAI embedding error: ${status} - ${err}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_KEY = Deno.env.get("OPEN_AI_KEY");
    if (!OPENAI_KEY) throw new Error("OPEN_AI_KEY not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { query, match_count = 5, match_threshold = 0.7, filters, source_types } = await req.json();
    // source_types: optional array like ["curriculum","teacher_content","student_history"]
    const sourceFilter: string[] | null = Array.isArray(source_types) && source_types.length > 0 ? source_types : null;

    if (!query) {
      return new Response(JSON.stringify({ error: "query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let results: any[] = [];

    try {
      // Try vector search first
      const queryEmbedding = await generateEmbedding(query, OPENAI_KEY);

      const { data, error } = await supabase.rpc("match_embeddings", {
        query_embedding: JSON.stringify(queryEmbedding),
        match_threshold: match_threshold,
        match_count: match_count,
        source_filter: sourceFilter,
      });

      if (error) {
        console.error("Match error:", error);
        throw new Error(`Similarity search failed: ${error.message}`);
      }

      results = data || [];
    } catch (embeddingError: any) {
      // Graceful fallback: if OpenAI quota exceeded, do a text-based search instead
      if (embeddingError.message === "OPENAI_QUOTA_EXCEEDED") {
        console.warn("OpenAI quota exceeded, falling back to text search");

        let textQuery = supabase
          .from("knowledge_chunks")
          .select("id, chunk_text, subject, class_level, curriculum, file_name, source_type")
          .ilike("chunk_text", `%${query.slice(0, 100)}%`)
          .limit(match_count);
        if (sourceFilter) textQuery = textQuery.in("source_type", sourceFilter);
        const { data: textResults, error: textError } = await textQuery;

        if (!textError && textResults) {
          results = textResults.map((r: any) => ({
            id: r.id,
            content: r.chunk_text,
            metadata: { subject: r.subject, class_level: r.class_level, curriculum: r.curriculum, file_name: r.file_name },
            similarity: 0.5,
            source_type: r.source_type ?? "curriculum",
          }));
        }
      } else {
        throw embeddingError;
      }
    }

    // Apply filters
    if (filters) {
      if (filters.subject) {
        results = results.filter((r: any) => r.metadata?.subject === filters.subject);
      }
      if (filters.class_level) {
        results = results.filter((r: any) => r.metadata?.class_level === filters.class_level);
      }
      if (filters.curriculum) {
        results = results.filter((r: any) => r.metadata?.curriculum === filters.curriculum);
      }
    }

    return new Response(
      JSON.stringify({ results, query, total: results.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("search-context error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
