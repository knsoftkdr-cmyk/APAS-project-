// supabase/functions/generate-learning-objectives/index.ts
//
// Deploy with:
//   supabase functions deploy generate-learning-objectives
//
// Admin/teacher only. Takes a subtopic_id (a "concept" in the mastery tree)
// or a topic_id (batches across every subtopic under that topic) and asks
// Gemini, via the Lovable AI Gateway, to produce 3-6 granular learning
// objectives per subtopic (the finest level of the Student Mastery Engine).
// Each objective gets a BKT parameter row automatically via DB trigger.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GeneratedObjective {
  objective_text: string;
  bloom_level: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
  difficulty: "easy" | "medium" | "hard";
}

const MODEL = "google/gemini-2.5-flash";

async function generateForSubtopic(
  lovableApiKey: string,
  subtopicName: string,
  subtopicDescription: string,
  topicName: string,
  chapterName: string,
  subject: string,
): Promise<GeneratedObjective[]> {
  const prompt = `You are a curriculum design expert. Break the following concept down into
3 to 6 granular, measurable learning objectives a student should be able to
demonstrate. Each objective must start with an action verb (Bloom's taxonomy),
be independently assessable with a single MCQ or short question, and stay
tightly scoped to this concept only (not the whole topic/chapter).

Subject: ${subject}
Chapter: ${chapterName}
Topic: ${topicName}
Concept: ${subtopicName}
Concept description: ${subtopicDescription || "(none provided)"}

Return ONLY a JSON array, no prose, no markdown fences, in this exact shape:
[{"objective_text": "...", "bloom_level": "remember|understand|apply|analyze|evaluate|create", "difficulty": "easy|medium|hard"}]`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "You output strict JSON only. No markdown, no commentary." },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`AI gateway error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const raw: string = data?.choices?.[0]?.message?.content ?? "[]";
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

  let parsed: GeneratedObjective[];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Could not parse AI response as JSON: ${cleaned.slice(0, 300)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("AI response was not a JSON array");
  return parsed.filter((o) => o.objective_text?.trim());
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("role").eq("id", user.id).single();

    if (!profile || !["admin", "teacher", "school_admin", "principal", "hod"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Not permitted to generate learning objectives" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const { subtopic_id, topic_id, overwrite = false } = await req.json();
    if (!subtopic_id && !topic_id) {
      return new Response(JSON.stringify({ error: "subtopic_id or topic_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve the set of subtopics to generate for, each with full context for grounding
    let subtopicIds: number[] = [];
    if (subtopic_id) {
      subtopicIds = [subtopic_id];
    } else {
      const { data: subtopics, error } = await supabaseAdmin
        .from("subtopics").select("id").eq("topic_id", topic_id).eq("is_active", true);
      if (error) throw error;
      subtopicIds = (subtopics ?? []).map((s) => s.id);
    }

    const results: Record<string, unknown>[] = [];

    for (const stId of subtopicIds) {
      const { data: ctx, error: ctxError } = await supabaseAdmin
        .from("subtopics")
        .select(`
          id, subtopic_name, subtopic_description,
          topics!inner ( id, topic_name,
            curriculum_chapters!inner ( id, chapter_name,
              units!inner ( id,
                books!inner ( id, subject )
              )
            )
          )
        `)
        .eq("id", stId)
        .single();

      if (ctxError || !ctx) {
        results.push({ subtopic_id: stId, error: "Concept not found" });
        continue;
      }

      if (!overwrite) {
        const { count } = await supabaseAdmin
          .from("learning_objectives")
          .select("id", { count: "exact", head: true })
          .eq("subtopic_id", stId)
          .eq("status", "active");
        if ((count ?? 0) > 0) {
          results.push({ subtopic_id: stId, skipped: true, reason: "Objectives already exist" });
          continue;
        }
      }

      // deno-lint-ignore no-explicit-any
      const topic = (ctx as any).topics;
      const chapter = topic?.curriculum_chapters;
      const unit = chapter?.units;
      const book = unit?.books;

      try {
        const objectives = await generateForSubtopic(
          LOVABLE_API_KEY,
          ctx.subtopic_name,
          ctx.subtopic_description ?? "",
          topic?.topic_name ?? "",
          chapter?.chapter_name ?? "",
          book?.subject ?? "",
        );

        if (objectives.length === 0) {
          results.push({ subtopic_id: stId, error: "AI returned no objectives" });
          continue;
        }

        const rows = objectives.map((o, idx) => ({
          subtopic_id: stId,
          objective_text: o.objective_text.trim(),
          bloom_level: o.bloom_level,
          difficulty: o.difficulty ?? "medium",
          display_order: idx + 1,
          ai_generated: true,
          generation_model: MODEL,
        }));

        const { data: inserted, error: insertError } = await supabaseAdmin
          .from("learning_objectives")
          .upsert(rows, { onConflict: "subtopic_id,objective_text", ignoreDuplicates: true })
          .select("id, objective_text, bloom_level, difficulty");

        if (insertError) throw insertError;

        results.push({ subtopic_id: stId, generated: inserted?.length ?? 0, objectives: inserted });
      } catch (e) {
        results.push({ subtopic_id: stId, error: e instanceof Error ? e.message : "Generation failed" });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-learning-objectives error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
