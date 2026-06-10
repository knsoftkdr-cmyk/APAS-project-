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
    // fallback: original Groq key still tried last via separate path
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
              generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
            }),
          }
        );

        if (response.status === 429 || response.status === 503) {
          console.warn(`Key ${key.slice(-6)} / ${model} rate limited (${response.status}), rotating...`);
          break; // try next key for this model
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
          max_tokens: 8000,
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
      lessonContent,
      classLevel,
      section,
      subject,
      periodsPerWeek,
      periodDuration,
      totalTeachingDays,
      regeneratePeriod,
    } = await req.json();

    if (!lessonContent) {
      return new Response(
        JSON.stringify({ error: "Lesson content is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiKeys = getGeminiKeys();
    const groqKeys = getGroqKeys();

    if (geminiKeys.length === 0 && groqKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: "No AI API keys configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Keys available — Gemini: ${geminiKeys.length}, Groq: ${groqKeys.length}`);

    const totalPeriods = Math.ceil(
      (periodsPerWeek || 5) * ((totalTeachingDays || 20) / 5)
    );

    let systemPrompt: string;
    let userPrompt: string;

    if (regeneratePeriod !== undefined && regeneratePeriod !== null) {
      systemPrompt = `You are an expert curriculum planner. Regenerate ONLY the plan for Period ${regeneratePeriod + 1}. Return valid JSON only — an object with: day, period, topic, objective, activity, materials, assessment, duration_minutes, youtube_videos. The youtube_videos field MUST be an array of 1-3 objects: { title, url, channel, why } pointing to real, well-known educational YouTube videos (Khan Academy, CrashCourse, TED-Ed, NCERT Official, BYJU'S, etc.) relevant to the period's topic.`;
      userPrompt = `Regenerate Period ${regeneratePeriod + 1} for this lesson plan:

Subject: ${subject || "General"}
Class: ${classLevel}
Section: ${section}
Period Duration: ${periodDuration || 40} minutes

LESSON PLAN:
${lessonContent.substring(0, 6000)}

Return ONLY a single JSON object (not wrapped in array):
{"day": number, "period": number, "topic": "...", "objective": "...", "activity": "...", "materials": "...", "assessment": "...", "duration_minutes": ${periodDuration || 40}, "youtube_videos": [{"title": "...", "url": "https://www.youtube.com/watch?v=...", "channel": "Khan Academy", "why": "..."}]}`;
    } else {
      systemPrompt = `You are an expert curriculum planner and instructional designer. Your task is to intelligently break down a complete lesson plan into daily, period-wise teaching plans.

Rules:
- Divide content logically across periods maintaining pedagogical flow
- Balance workload evenly across periods
- Ensure learning objectives align with activities
- Each period must have a clear topic, objective, activity, materials, and assessment
- Each period MUST include 1-3 relevant YouTube video references in a "youtube_videos" array. Use REAL videos from trusted educational channels (Khan Academy, CrashCourse, TED-Ed, NCERT Official, BYJU'S, Amoeba Sisters, SciShow Kids) appropriate to the class. If unsure of a specific video, use a channel search URL like https://www.youtube.com/@khanacademy/search?query=TOPIC. Never fabricate fake video IDs.
- Return ONLY a valid JSON array, no markdown, no explanation`;

      userPrompt = `Break down this lesson plan into ${totalPeriods} period-wise daily plans.

Subject: ${subject || "General"}
Class: ${classLevel}
Section: ${section}
Periods per week: ${periodsPerWeek || 5}
Period duration: ${periodDuration || 40} minutes
Total teaching days: ${totalTeachingDays || 20}

LESSON PLAN:
${lessonContent.substring(0, 8000)}

Return a JSON array of objects. Each object represents one period:
[
  {
    "day": 1,
    "period": 1,
    "topic": "Introduction to ...",
    "objective": "Students will be able to ...",
    "activity": "Teacher-led discussion on ...",
    "materials": "Textbook, whiteboard, ...",
    "assessment": "Quick quiz on ...",
    "duration_minutes": ${periodDuration || 40},
    "youtube_videos": [
      {"title": "Intro to ...", "url": "https://www.youtube.com/watch?v=VIDEO_ID", "channel": "Khan Academy", "why": "Visual walkthrough of the core concept"}
    ]
  }
]

Generate exactly ${totalPeriods} period entries covering all ${totalTeachingDays} teaching days. Return ONLY the JSON array.`;
    }

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

    const rawContent = result.text;

    let parsed: any;
    try {
      const jsonMatch = rawContent.match(/\[[\s\S]*\]/) || rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(rawContent);
      }
    } catch (e) {
      console.error("Failed to parse AI response:", rawContent.substring(0, 500));
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response", raw: rawContent.substring(0, 200) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ plan: parsed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-period-plans error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});