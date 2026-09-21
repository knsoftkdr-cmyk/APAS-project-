// supabase/functions/get-knowledge-graph/index.ts
//
// Deploy with:
//   supabase functions deploy get-knowledge-graph
//
// Body: { book_id } -> topic-level graph (nodes = topics, edges = prerequisites)
// Body: { topic_id } -> concept-level graph for one topic (nodes = subtopics,
//        edges = prerequisites, plus that topic's misconceptions catalog)
//
// Read-only for any authenticated user (students can view it too, e.g. to
// understand why a concept is locked / what to review first).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { book_id, topic_id } = await req.json();
    if (!book_id && !topic_id) {
      return new Response(JSON.stringify({ error: "book_id or topic_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (book_id) {
      const { data, error } = await supabaseClient.rpc("get_topic_graph", { p_book_id: book_id });
      if (error) throw error;
      return new Response(JSON.stringify({ scope: "topics", book_id, ...data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabaseClient.rpc("get_concept_graph", { p_topic_id: topic_id });
    if (error) throw error;
    return new Response(JSON.stringify({ scope: "concepts", topic_id, ...data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("get-knowledge-graph error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
