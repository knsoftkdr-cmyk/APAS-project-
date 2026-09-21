// supabase/functions/generate-knowledge-graph/index.ts
//
// Deploy with:
//   supabase functions deploy generate-knowledge-graph
//
// Admin/teacher only. Two modes:
//   { book_id }  -> topic-level prerequisite graph for a whole subject
//   { topic_id } -> concept-level prerequisite graph + misconceptions for
//                   every subtopic under that topic
//
// Uses the same Lovable AI Gateway pattern as generate-learning-objectives.
// Edges that would create a cycle are silently skipped (the DB trigger
// rejects them; we catch that specific error per-edge so one bad edge
// doesn't fail the whole batch).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-2.5-flash";

async function callGemini(lovableApiKey: string, systemPrompt: string, userPrompt: string) {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
    }),
  });
  if (!resp.ok) throw new Error(`AI gateway error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const raw: string = data?.choices?.[0]?.message?.content ?? "{}";
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Could not parse AI response as JSON: ${cleaned.slice(0, 300)}`);
  }
}

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
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !["admin", "teacher", "school_admin", "principal", "hod"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Not permitted to generate the knowledge graph" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const { book_id, topic_id } = await req.json();
    if (!book_id && !topic_id) {
      return new Response(JSON.stringify({ error: "book_id or topic_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Mode 1: topic-level graph for a whole subject ──────────────────────
    if (book_id) {
      const { data: book } = await supabaseAdmin.from("books").select("id, subject").eq("id", book_id).single();
      const { data: topics, error: topicsError } = await supabaseAdmin
        .from("topics")
        .select("id, topic_name, curriculum_chapters!inner(chapter_name, unit_id, units!inner(book_id))")
        .eq("curriculum_chapters.units.book_id", book_id);
      if (topicsError) throw topicsError;
      if (!topics || topics.length < 2) {
        return new Response(JSON.stringify({ error: "Need at least 2 topics in this subject to build a graph" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const topicList = topics.map((t) => ({
        id: t.id, name: t.topic_name,
        // deno-lint-ignore no-explicit-any
        chapter: (t as any).curriculum_chapters?.chapter_name,
      }));

      const result = await callGemini(
        LOVABLE_API_KEY,
        "You are a curriculum sequencing expert. You output strict JSON only, no markdown, no commentary.",
        `Subject: ${book?.subject}. Here are its topics with their real database ids:
${JSON.stringify(topicList)}

Decide which topics are prerequisites for which others (a topic should be
learned before a dependent topic that builds on it). Only propose an edge
when there's a genuine conceptual dependency — most topics will have zero or
one prerequisite, not everything needs to connect. Never propose a topic as
its own prerequisite. Never create a cycle.

Return ONLY JSON in this exact shape:
{"edges": [{"topic_id": <id>, "prerequisite_topic_id": <id>, "strength": 0.0-1.0, "rationale": "one short sentence"}]}`,
      );

      const edges: Array<{ topic_id: number; prerequisite_topic_id: number; strength?: number; rationale?: string }> =
        result?.edges ?? [];

      const inserted: unknown[] = [];
      const skipped: unknown[] = [];
      for (const e of edges) {
        if (!e.topic_id || !e.prerequisite_topic_id || e.topic_id === e.prerequisite_topic_id) continue;
        const { data, error } = await supabaseAdmin
          .from("topic_prerequisites")
          .upsert({
            topic_id: e.topic_id,
            prerequisite_topic_id: e.prerequisite_topic_id,
            strength: e.strength ?? 0.7,
            rationale: e.rationale ?? null,
            ai_generated: true,
          }, { onConflict: "topic_id,prerequisite_topic_id" })
          .select("id");
        if (error) skipped.push({ edge: e, reason: error.message });
        else inserted.push(data);
      }

      return new Response(JSON.stringify({ mode: "topics", inserted: inserted.length, skipped }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Mode 2: concept-level graph + misconceptions for one topic ─────────
    const { data: topic } = await supabaseAdmin
      .from("topics").select("id, topic_name, curriculum_chapters(chapter_name)").eq("id", topic_id).single();
    const { data: concepts, error: conceptsError } = await supabaseAdmin
      .from("subtopics").select("id, subtopic_name, subtopic_description").eq("topic_id", topic_id).eq("is_active", true);
    if (conceptsError) throw conceptsError;
    if (!concepts || concepts.length === 0) {
      return new Response(JSON.stringify({ error: "This topic has no concepts yet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const conceptList = concepts.map((c) => ({ id: c.id, name: c.subtopic_name, description: c.subtopic_description }));

    const result = await callGemini(
      LOVABLE_API_KEY,
      "You are a curriculum design and misconception-analysis expert. You output strict JSON only, no markdown, no commentary.",
      // deno-lint-ignore no-explicit-any
      `Topic: ${topic?.topic_name} (chapter: ${(topic as any)?.curriculum_chapters?.chapter_name}).
Concepts in this topic with their real database ids:
${JSON.stringify(conceptList)}

1. Identify prerequisite relationships AMONG these concepts (a concept should
   be learned before a dependent one that builds on it). Not every concept
   needs a prerequisite. Never a concept depending on itself. Never a cycle.
2. For each concept, list 1-3 common student misconceptions — genuine wrong
   mental models students form, not just "forgets a step". Explain briefly
   why the misconception tends to form and a short correction hint a teacher
   could use.

Return ONLY JSON in this exact shape:
{
  "edges": [{"subtopic_id": <id>, "prerequisite_subtopic_id": <id>, "strength": 0.0-1.0, "rationale": "one short sentence"}],
  "misconceptions": [{"subtopic_id": <id>, "misconception_text": "...", "why_it_happens": "...", "correction_hint": "...", "severity": "low|medium|high"}]
}`,
    );

    const edges: Array<{ subtopic_id: number; prerequisite_subtopic_id: number; strength?: number; rationale?: string }> =
      result?.edges ?? [];
    const misconceptions: Array<{
      subtopic_id: number; misconception_text: string; why_it_happens?: string;
      correction_hint?: string; severity?: string;
    }> = result?.misconceptions ?? [];

    const insertedEdges: unknown[] = [];
    const skippedEdges: unknown[] = [];
    for (const e of edges) {
      if (!e.subtopic_id || !e.prerequisite_subtopic_id || e.subtopic_id === e.prerequisite_subtopic_id) continue;
      const { data, error } = await supabaseAdmin
        .from("concept_prerequisites")
        .upsert({
          subtopic_id: e.subtopic_id,
          prerequisite_subtopic_id: e.prerequisite_subtopic_id,
          strength: e.strength ?? 0.7,
          rationale: e.rationale ?? null,
          ai_generated: true,
        }, { onConflict: "subtopic_id,prerequisite_subtopic_id" })
        .select("id");
      if (error) skippedEdges.push({ edge: e, reason: error.message });
      else insertedEdges.push(data);
    }

    const misconceptionRows = misconceptions
      .filter((m) => m.subtopic_id && m.misconception_text?.trim())
      .map((m) => ({
        subtopic_id: m.subtopic_id,
        misconception_text: m.misconception_text.trim(),
        why_it_happens: m.why_it_happens ?? null,
        correction_hint: m.correction_hint ?? null,
        severity: m.severity ?? "medium",
        ai_generated: true,
      }));

    let insertedMisconceptions = 0;
    if (misconceptionRows.length > 0) {
      const { data, error } = await supabaseAdmin.from("concept_misconceptions").insert(misconceptionRows).select("id");
      if (error) throw error;
      insertedMisconceptions = data?.length ?? 0;
    }

    return new Response(JSON.stringify({
      mode: "concepts",
      edges_inserted: insertedEdges.length,
      edges_skipped: skippedEdges,
      misconceptions_inserted: insertedMisconceptions,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-knowledge-graph error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
