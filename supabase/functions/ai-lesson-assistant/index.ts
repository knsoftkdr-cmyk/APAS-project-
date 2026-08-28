import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getGeminiKeys(): string[] {
  return [
    Deno.env.get("GOOGLE_GEMINI_API_KEY_2"),
    Deno.env.get("GEMINI_KEY_2"),
    Deno.env.get("GEMINI_KEY_3"),
    Deno.env.get("GEMINI_KEY_4"),
  ].filter((k): k is string => !!k && k.trim().length > 0);
}

const CREATE_LESSON_TOOL = {
  functionDeclarations: [
    {
      name: "create_lesson_plan",
      description:
        "Call this once topic, subject, class_level, section and duration_minutes are all known. Do not call it while any of these are still missing — ask the teacher for the missing ones instead.",
      parameters: {
        type: "OBJECT",
        properties: {
          topic: { type: "STRING", description: "The lesson topic, e.g. 'Fractions'" },
          subject: { type: "STRING", description: "e.g. 'Mathematics'" },
          class_level: { type: "STRING", description: "e.g. 'Class 5'" },
          section: { type: "STRING", description: "e.g. 'A'" },
          duration_minutes: { type: "NUMBER", description: "Lesson duration in minutes" },
        },
        required: ["topic", "subject", "class_level", "section", "duration_minutes"],
      },
    },
  ],
};

async function callGemini(
  systemPrompt: string,
  contents: any[],
  keys: string[],
  tools?: any
): Promise<any | null> {
  const models = ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
  for (const key of keys) {
    for (const model of models) {
      try {
        const body: any = {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
        };
        if (tools) body.tools = [tools];
        else body.generationConfig.responseMimeType = "application/json";

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );

        if (response.status === 429 || response.status === 503) {
          console.warn(`Key ${key.slice(-6)} / ${model} rate limited, rotating...`);
          break;
        }
        if (!response.ok) {
          const err = await response.text();
          console.warn(`Key ${key.slice(-6)} / ${model} error ${response.status}: ${err.substring(0, 150)}`);
          continue;
        }

        const data = await response.json();
        const candidate = data?.candidates?.[0];
        if (!candidate) continue;
        return candidate;
      } catch (e) {
        console.error(`Network error on key ${key.slice(-6)} / ${model}:`, e);
      }
    }
  }
  return null;
}

function formatLessonMarkdown(topic: string, plan: any): string {
  const lines: string[] = [];
  lines.push(`## Learning Objectives`);
  (plan.objectives || []).forEach((o: string) => lines.push(`- ${o}`));
  lines.push(``, `## Introduction`, plan.introduction || "");
  lines.push(``, `## Activities`);
  (plan.activities || []).forEach((a: any) =>
    lines.push(`### ${a.title} (${a.duration_minutes || "?"} min)`, a.description || "")
  );
  lines.push(``, `## Examples`, plan.examples || "");
  lines.push(``, `## Assessment`, plan.assessment || "");
  lines.push(``, `## Homework`, plan.homework || "");
  return lines.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message, history = [] } = await req.json();
    const geminiKeys = getGeminiKeys();

    if (geminiKeys.length === 0) {
      return new Response(JSON.stringify({ error: "No AI API keys configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const routerSystemPrompt = `You are APAS AI Teaching Assistant, helping a teacher create lesson plans by conversation.
Collect these five fields naturally across the conversation: topic, subject, class_level (e.g. "Class 5"), section (e.g. "A"), duration_minutes.
If any are missing, ask a short, friendly question for the missing ones only — do not re-ask for ones already given.
Once all five are known, call create_lesson_plan with them. Do not call it before all five are known.`;

    const contents = [
      ...history.map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.text }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const candidate = await callGemini(routerSystemPrompt, contents, geminiKeys, CREATE_LESSON_TOOL);

    if (!candidate) {
      return new Response(JSON.stringify({ error: "AI is unavailable right now. Please try again." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parts = candidate.content?.parts || [];
    const functionCallPart = parts.find((p: any) => p.functionCall)?.functionCall;

    if (!functionCallPart) {
      const text = parts.find((p: any) => p.text)?.text || "Could you tell me more about the lesson you'd like?";
      return new Response(JSON.stringify({ type: "message", text }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const args = functionCallPart.args as {
      topic: string; subject: string; class_level: string; section: string; duration_minutes: number;
    };

    const genSystemPrompt = `You are an expert curriculum designer. Respond with ONLY valid JSON (no markdown fences) matching:
{
  "objectives": ["...", "..."],
  "introduction": "...",
  "activities": [{"title": "...", "description": "...", "duration_minutes": 10}],
  "examples": "...",
  "assessment": "...",
  "homework": "..."
}`;
    const genUserPrompt = `Create a lesson plan.
Topic: ${args.topic}
Subject: ${args.subject}
Class: ${args.class_level} - Section ${args.section}
Duration: ${args.duration_minutes} minutes`;

    const genCandidate = await callGemini(
      genSystemPrompt,
      [{ role: "user", parts: [{ text: genUserPrompt }] }],
      geminiKeys
    );

    if (!genCandidate) {
      return new Response(JSON.stringify({ error: "Lesson generation failed. Please try again." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let raw = genCandidate.content?.parts?.[0]?.text || "{}";
    raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) raw = jsonMatch[0];
    const plan = JSON.parse(raw);

    const lessonContentMarkdown = formatLessonMarkdown(args.topic, plan);

    return new Response(
      JSON.stringify({
        type: "lesson_preview",
        args,
        plan,
        lesson_content: lessonContentMarkdown,
        title: `${args.class_level}-${args.section} ${args.subject} ${args.topic}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ai-lesson-assistant error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
