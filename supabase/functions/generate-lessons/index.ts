import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── KEY ROTATION (same keys as curative-assistant) ──────────────────────────
function getGeminiKeys(): string[] {
  return [
    Deno.env.get("GOOGLE_GEMINI_API_KEY_2"),
    Deno.env.get("GEMINI_KEY_2"),
    Deno.env.get("GEMINI_KEY_3"),
    Deno.env.get("GEMINI_KEY_4"),
  ].filter((k): k is string => !!k && k.trim().length > 0);
}

function getGroqKeys(): string[] {
  return [
    Deno.env.get("APAS_LESSON_GENERATOR"),
  ].filter((k): k is string => !!k && k.trim().length > 0);
}

async function callGeminiWithRotation(
  systemPrompt: string,
  userPrompt: string,
  keys: string[]
): Promise<{ text: string } | null> {
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"];

  for (const key of keys) {
    for (const model of models) {
      console.log(`Trying Gemini ${model} with key ${key.slice(-6)}...`);
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
            }),
          }
        );

        if (response.status === 429 || response.status === 503) {
          console.warn(`Key ${key.slice(-6)} / ${model} rate limited (${response.status}), rotating...`);
          break; // next key
        }

        if (!response.ok) {
          const err = await response.text();
          console.warn(`Key ${key.slice(-6)} / ${model} error ${response.status}: ${err.substring(0, 150)}`);
          continue;
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (text) return { text };
      } catch (e) {
        console.error(`Network error on key ${key.slice(-6)} / ${model}:`, e);
      }
    }
  }
  return null;
}

async function callGroqWithRotation(
  systemPrompt: string,
  userPrompt: string,
  keys: string[]
): Promise<{ text: string } | null> {
  for (const key of keys) {
    console.log(`Trying Groq key ${key.slice(-6)}...`);
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: 4096,
        }),
      });

      if (response.status === 429 || response.status === 401 || response.status === 402 || response.status === 403) {
        console.warn(`Groq key ${key.slice(-6)} failed with ${response.status}, rotating...`);
        continue;
      }

      if (!response.ok) {
        const err = await response.text();
        console.warn(`Groq key error ${response.status}: ${err.substring(0, 150)}`);
        continue;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || "";
      if (text) return { text };
    } catch (e) {
      console.error(`Network error on Groq key ${key.slice(-6)}:`, e);
    }
  }
  return null;
}
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      studentName,
      ageGroup,
      strengths,
      weaknesses,
      recommendedFramework,
      learningGoals,
      cognitivePattern,
      diagnosticScore,
    } = await req.json();

    const geminiKeys = getGeminiKeys();
    const groqKeys = getGroqKeys();

    if (geminiKeys.length === 0 && groqKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: "No AI API keys configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Keys available — Gemini: ${geminiKeys.length}, Groq: ${groqKeys.length}`);

    const systemPrompt = `You are an expert educational content designer specialising in personalised pedagogy. You design curative lesson plans tailored to individual student profiles based on their diagnostic assessment data.

You MUST respond with ONLY valid JSON matching this exact structure (no markdown, no extra text):
{
  "lesson_objectives": ["objective 1", "objective 2", ...],
  "activity_plan": [
    {"title": "...", "description": "...", "duration_minutes": 10, "materials": "..."}
  ],
  "practice_exercises": [
    {"title": "...", "description": "...", "type": "..."}
  ],
  "assessment_checkpoints": [
    {"checkpoint": "...", "criteria": "...", "method": "..."}
  ],
  "youtube_videos": [
    {"title": "...", "url": "https://www.youtube.com/watch?v=VIDEO_ID", "channel": "Khan Academy", "why": "Why this helps the student", "when_to_use": "Hook | Main Teaching | Reinforcement | Homework"}
  ],
  "framework_summary": "...",
  "estimated_duration_minutes": 40
}

For "youtube_videos": include 2-4 REAL, age-appropriate videos from well-known educational channels (Khan Academy, CrashCourse, TED-Ed, NCERT Official, BYJU'S, Amoeba Sisters, SciShow Kids, National Geographic Kids). Never fabricate video IDs — if unsure of a specific video, use a channel search URL like https://www.youtube.com/@khanacademy/search?query=TOPIC.`;

    const userPrompt = `Generate a personalised curative lesson plan for the following student:

Student Name: ${studentName}
Age Group: ${ageGroup}+
Learning Strengths: ${strengths}
Weakness Areas: ${weaknesses}
Cognitive Pattern: ${cognitivePattern}
Diagnostic Score Summary: ${diagnosticScore}
Recommended Framework: ${recommendedFramework}
Learning Goals: ${learningGoals}

Create a comprehensive lesson plan that includes:
1. 3-4 specific lesson objectives targeting the weakness areas
2. A detailed activity plan with 3-4 activities (each with title, description, duration, and materials needed)
3. 2-3 practice exercises that reinforce the learning
4. 2-3 assessment checkpoints to measure progress

The plan should follow the ${recommendedFramework} framework and be appropriate for the ${ageGroup}+ age group.`;

    // Try Gemini keys first, fall back to Groq
    let result = geminiKeys.length > 0
      ? await callGeminiWithRotation(systemPrompt, userPrompt, geminiKeys)
      : null;

    if (!result && groqKeys.length > 0) {
      console.log("All Gemini keys failed/exhausted — falling back to Groq...");
      result = await callGroqWithRotation(systemPrompt, userPrompt, groqKeys);
    }

    if (!result) {
      return new Response(
        JSON.stringify({ error: "All API keys exhausted. Please try again later or check your key quotas." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Strip markdown code blocks if present
    let content = result.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    // Extract JSON object from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) content = jsonMatch[0];

    const lessonPlan = JSON.parse(content);

    return new Response(JSON.stringify({ lessonPlan }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-lessons error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});