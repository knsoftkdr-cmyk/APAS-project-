import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAi, getAiConfig } from "../_shared/aiClient.ts";
import { routeMerged, type RouteTable } from "../_shared/mergedRouter.ts";
import { handleContentStudio } from "../_shared/handlers/contentStudio.ts";

// Features merged in (Edge Function deployment limit) - see _shared/mergedRouter.ts.
//   action "content_studio": Content Studio - prompt -> PPTX / flash cards / flowchart.
// A body WITHOUT `action` (the entry-ticket call) runs the original code below.
const MERGED_ROUTES: RouteTable = {
  content_studio: { handler: handleContentStudio },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const merged = await routeMerged(req, MERGED_ROUTES, "action");
  if (merged) return merged;

  try {
    const body = await req.json();
    const subject = (body.subject ?? "").trim();
    const chapter = (body.chapter ?? "").trim();
    const topic = (body.topic ?? "").trim();
    const subtopic = (body.subtopic ?? "").trim();
    const class_level = (body.class_level ?? "").trim();

    // Fallback hierarchy: subtopic > topic > chapter
    const focus = subtopic || topic || chapter;
    if (!focus) {
      return json({ error: "At least one of chapter, topic, or subtopic must be provided" }, 400);
    }

    const contextParts = [];
    if (chapter) contextParts.push("Chapter: " + chapter);
    if (topic) contextParts.push("Topic: " + topic);
    if (subtopic) contextParts.push("Subtopic: " + subtopic);
    const contextStr = contextParts.join(", ");

    const prompt = "You are creating a prior-knowledge entry ticket for " + class_level + " students studying " + subject + ".\n" +
      contextStr + "\n" +
      "Generate exactly 5 simple prior-knowledge questions that specifically relate to '" + focus + "' " +
      "(use the most specific topic given above as the main focus of every question, do not generate generic subject questions). " +
      "These questions test what students already know BEFORE the topic is taught. " +
      "Respond ONLY with a JSON array, no markdown, no explanation: " +
      "[{\"q_no\":1,\"question\":\"...\"},{\"q_no\":2,\"question\":\"...\"},{\"q_no\":3,\"question\":\"...\"},{\"q_no\":4,\"question\":\"...\"},{\"q_no\":5,\"question\":\"...\"}]";

    // Shared client: tries the current Gemini 3.x models across all configured keys.
    // The worksheet key this function used before goes first.
    const cfg = getAiConfig();
    const worksheetKey = Deno.env.get("Worksheet_gemini_api_key");
    if (worksheetKey && !cfg.geminiKeys.includes(worksheetKey)) cfg.geminiKeys.unshift(worksheetKey);

    const { text } = await callAi(cfg, prompt, { temperature: 0.4, maxOutputTokens: 4096 });
    const clean = text.replace(/```json|```/g, "").trim();

    let questions;
    try {
      const parsed = JSON.parse(clean);
      // Accept either a bare array or an object wrapping it (e.g. {"questions":[...]}).
      questions = Array.isArray(parsed) ? parsed : (parsed?.questions ?? Object.values(parsed ?? {}).find(Array.isArray));
    } catch {
      return json({ error: "Failed to parse AI output as JSON", raw: text }, 500);
    }
    if (!Array.isArray(questions) || questions.length === 0) {
      return json({ error: "AI returned no questions", raw: text }, 500);
    }

    return json({ questions });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
