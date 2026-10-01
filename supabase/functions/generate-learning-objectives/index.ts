// supabase/functions/generate-learning-objectives/index.ts
//
// Deploy with:
//   supabase functions deploy generate-learning-objectives
//
// Admin/teacher only. Takes a subtopic_id (a "concept" in the mastery tree)
// or a topic_id (batches across every subtopic under that topic) and asks
// Gemini to produce 3-6 granular learning
// objectives per subtopic (the finest level of the Student Mastery Engine).
// Each objective gets a BKT parameter row automatically via DB trigger.
//
// create_missing_concepts: when a topic_id has no concepts (subtopics) yet - the
// textbook loader only extracts chapters and topics - the AI first proposes 3-6
// concepts for that topic and they are saved, then objectives are generated.
// Topics that already have concepts are never touched.
//
// AI provider: calls Gemini directly with the same keys the other APAS
// functions use (GOOGLE_GEMINI_API_KEY_2 / GOOGLE_GEMINI_API_KEY /
// GEMINI_KEY_2..4), rotating across keys and models on rate limits. Falls back
// to the Lovable AI Gateway only if LOVABLE_API_KEY is set.

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

const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const LOVABLE_MODEL = "google/gemini-2.5-flash";

interface AiConfig { geminiKeys: string[]; lovableKey: string | null }

function getAiConfig(): AiConfig {
  const geminiKeys = [
    Deno.env.get("GOOGLE_GEMINI_API_KEY_2"),
    Deno.env.get("GOOGLE_GEMINI_API_KEY"),
    Deno.env.get("GEMINI_KEY_2"),
    Deno.env.get("GEMINI_KEY_3"),
    Deno.env.get("GEMINI_KEY_4"),
  ].filter((k, i, a): k is string => !!k && k.trim().length > 0 && a.indexOf(k) === i);
  return { geminiKeys, lovableKey: Deno.env.get("LOVABLE_API_KEY") || null };
}

const SYSTEM_PROMPT = "You output strict JSON only. No markdown, no commentary.";

/** Returns the model's raw text plus the model that produced it. */
async function callAi(cfg: AiConfig, prompt: string): Promise<{ text: string; model: string }> {
  let lastError = "";

  for (const key of cfg.geminiKeys) {
    for (const model of GEMINI_MODELS) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.4, maxOutputTokens: 2048, responseMimeType: "application/json" },
            }),
          },
        );
        if (resp.status === 429 || resp.status === 503) { lastError = `Gemini ${model} rate limited (${resp.status})`; break; } // next key
        if (!resp.ok) { lastError = `Gemini ${model} error ${resp.status}: ${(await resp.text()).slice(0, 200)}`; continue; }
        const data = await resp.json();
        // deno-lint-ignore no-explicit-any
        const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("");
        if (text.trim()) return { text, model };
        lastError = `Gemini ${model} returned an empty response`;
      } catch (e) {
        lastError = `Gemini ${model} network error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }

  if (cfg.lovableKey) {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LOVABLE_MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
        temperature: 0.4,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      return { text: data?.choices?.[0]?.message?.content ?? "[]", model: LOVABLE_MODEL };
    }
    lastError = `AI gateway error ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
  }

  throw new Error(lastError || "No AI provider responded");
}

interface GeneratedConcept { name: string; description: string }

async function generateConceptsForTopic(
  ai: AiConfig,
  topicName: string,
  topicDescription: string,
  chapterName: string,
  subject: string,
): Promise<GeneratedConcept[]> {
  const prompt = `You are a curriculum design expert. Break the following textbook topic into
3 to 6 distinct teachable concepts (the smallest units a teacher would plan and
assess separately). Concepts must be specific to this topic, non-overlapping,
and ordered from foundational to advanced. Use the topic description as the
source of truth for what the textbook covers.

Subject: ${subject}
Chapter: ${chapterName}
Topic: ${topicName}
Topic description: ${(topicDescription || "(none provided)").slice(0, 3000)}

Return ONLY a JSON array, no prose, no markdown fences, in this exact shape:
[{"name": "short concept name", "description": "one sentence on what the concept covers"}]`;

  const { text } = await callAi(ai, prompt);
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  let parsed: GeneratedConcept[];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Could not parse concepts as JSON: ${cleaned.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("AI concept response was not a JSON array");
  const seen = new Set<string>();
  return parsed
    .map((c) => ({ name: String(c?.name ?? "").trim(), description: String(c?.description ?? "").trim() }))
    .filter((c) => c.name && !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()))
    .slice(0, 6);
}

async function generateForSubtopic(
  ai: AiConfig,
  subtopicName: string,
  subtopicDescription: string,
  topicName: string,
  chapterName: string,
  subject: string,
): Promise<{ objectives: GeneratedObjective[]; model: string }> {
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

  const { text: raw, model } = await callAi(ai, prompt);
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

  let parsed: GeneratedObjective[];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Could not parse AI response as JSON: ${cleaned.slice(0, 300)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("AI response was not a JSON array");
  return { objectives: parsed.filter((o) => o.objective_text?.trim()), model };
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

    const ai = getAiConfig();
    if (ai.geminiKeys.length === 0 && !ai.lovableKey) {
      throw new Error("No AI key configured. Set GOOGLE_GEMINI_API_KEY_2 (or GOOGLE_GEMINI_API_KEY / LOVABLE_API_KEY) in the Supabase function secrets.");
    }

    const { subtopic_id, topic_id, overwrite = false, create_missing_concepts = false } = await req.json();
    if (!subtopic_id && !topic_id) {
      return new Response(JSON.stringify({ error: "subtopic_id or topic_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve the set of subtopics to generate for, each with full context for grounding
    let subtopicIds: number[] = [];
    let conceptsCreated = 0;
    if (subtopic_id) {
      subtopicIds = [subtopic_id];
    } else {
      const { data: subtopics, error } = await supabaseAdmin
        .from("subtopics").select("id").eq("topic_id", topic_id).eq("is_active", true);
      if (error) throw error;
      subtopicIds = (subtopics ?? []).map((s) => s.id);

      if (subtopicIds.length === 0 && create_missing_concepts) {
        const { data: t, error: tErr } = await supabaseAdmin
          .from("topics")
          .select(`id, topic_name, topic_description,
            curriculum_chapters!inner ( chapter_name, units!inner ( books!inner ( subject ) ) )`)
          .eq("id", topic_id)
          .single();
        if (tErr || !t) {
          return new Response(JSON.stringify({ results: [{ topic_id, error: "Topic not found" }] }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // deno-lint-ignore no-explicit-any
        const ch = (t as any).curriculum_chapters;
        try {
          const concepts = await generateConceptsForTopic(
            ai, t.topic_name, t.topic_description ?? "", ch?.chapter_name ?? "", ch?.units?.books?.subject ?? "",
          );
          if (concepts.length === 0) throw new Error("AI returned no concepts");
          const { data: created, error: cErr } = await supabaseAdmin
            .from("subtopics")
            .insert(concepts.map((c) => ({
              topic_id, subtopic_name: c.name, subtopic_description: c.description, is_active: true,
            })))
            .select("id");
          if (cErr) throw cErr;
          subtopicIds = (created ?? []).map((c) => c.id);
          conceptsCreated = subtopicIds.length;
        } catch (e) {
          return new Response(JSON.stringify({
            results: [{ topic_id, error: `Could not create concepts: ${e instanceof Error ? e.message : String(e)}` }],
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
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
        const { objectives, model: usedModel } = await generateForSubtopic(
          ai,
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
          generation_model: usedModel,
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

    return new Response(JSON.stringify({ results, concepts_created: conceptsCreated }), {
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