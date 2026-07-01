import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const subject = (body.subject ?? "").trim();
    const chapter = (body.chapter ?? "").trim();
    const topic = (body.topic ?? "").trim();
    const subtopic = (body.subtopic ?? "").trim();
    const class_level = (body.class_level ?? "").trim();

    const apiKey = Deno.env.get("Worksheet_gemini_api_key");
    if (!apiKey) return new Response(JSON.stringify({ error: "Worksheet_gemini_api_key secret not found" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Fallback hierarchy: subtopic > topic > chapter
    let focus = "";
    if (subtopic) {
      focus = subtopic;
    } else if (topic) {
      focus = topic;
    } else if (chapter) {
      focus = chapter;
    }

    if (!focus) {
      return new Response(JSON.stringify({ error: "At least one of chapter, topic, or subtopic must be provided" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const contextParts = [];
    if (chapter) contextParts.push("Chapter: " + chapter);
    if (topic) contextParts.push("Topic: " + topic);
    if (subtopic) contextParts.push("Subtopic: " + subtopic);
    const contextStr = contextParts.length > 0 ? contextParts.join(", ") : ("Chapter: " + focus);

    const prompt = "You are creating a prior-knowledge entry ticket for " + class_level + " students studying " + subject + ".\n" +
      contextStr + "\n" +
      "Generate exactly 5 simple prior-knowledge questions that specifically relate to '" + focus + "' " +
      "(use the most specific topic given above as the main focus of every question, do not generate generic subject questions). " +
      "These questions test what students already know BEFORE the topic is taught. " +
      "Respond ONLY with a JSON array, no markdown, no explanation: " +
      "[{\"q_no\":1,\"question\":\"...\"},{\"q_no\":2,\"question\":\"...\"},{\"q_no\":3,\"question\":\"...\"},{\"q_no\":4,\"question\":\"...\"},{\"q_no\":5,\"question\":\"...\"}]";

    const geminiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generation_config: {
          temperature: 0.4,
          max_output_tokens: 2048,
          thinking_config: { thinking_budget: 0 }
        }
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(JSON.stringify({ error: "Gemini API error: " + geminiRes.status + " " + errText }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await geminiRes.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const clean = raw.replace(/```json|```/g, "").trim();
    let questions;
    try {
      questions = JSON.parse(clean);
    } catch (parseErr) {
      return new Response(JSON.stringify({ error: "Failed to parse Gemini output as JSON", raw: raw, finishReason: data.candidates?.[0]?.finishReason }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ questions }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});