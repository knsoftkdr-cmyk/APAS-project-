import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── KEY ROTATION (same keys as generate-lessons / generate-period-plans / generate-mcqs) ────
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
    Deno.env.get("GROK_API_KEY"),
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
              generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
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
          temperature: 0.3,
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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { subject, studentClass, topic, questions, answers } = await req.json();

    const geminiKeys = getGeminiKeys();
    const groqKeys = getGroqKeys();

    if (geminiKeys.length === 0 && groqKeys.length === 0) {
      return new Response(JSON.stringify({ error: "No AI API keys configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build question analysis
    const correctQs: string[] = [];
    const wrongQs: { question: string; studentAnswer: string; correctAnswer: string; explanation: string }[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const studentAns = answers[String(i)];
      if (studentAns === q.correct) {
        correctQs.push(q.question);
      } else {
        wrongQs.push({
          question: q.question,
          studentAnswer: `${studentAns}: ${q.options?.[studentAns] || "N/A"}`,
          correctAnswer: `${q.correct}: ${q.options?.[q.correct] || "N/A"}`,
          explanation: q.explanation || "",
        });
      }
    }

    const systemPrompt = `You are an expert educational analyst for ${subject} (${studentClass} level).
Analyze a student's test performance and provide a structured JSON response.

You MUST return ONLY valid JSON with this exact structure:
{
  "strengths": [
    { "concept": "Name of concept/skill", "detail": "One sentence explaining what the student demonstrated well" }
  ],
  "weaknesses": [
    { "concept": "Name of concept/skill", "detail": "One sentence explaining the gap or misconception" }
  ],
  "suggestions": [
    { "title": "Short actionable title", "description": "Specific 1-2 sentence improvement tip with resources or practice ideas" }
  ],
  "overall_summary": "2-3 sentence overall performance summary with encouragement"
}

Rules:
- Identify 2-5 strengths based on correctly answered questions
- Identify 2-5 weaknesses based on incorrectly answered questions
- Provide 3-5 specific, actionable improvement suggestions related to the weak areas
- Be encouraging and constructive
- Focus on the specific ${subject} concepts tested
${topic ? `- The test focused on the topic: "${topic}"` : ""}
- If there are no wrong answers, still suggest areas for deeper mastery
- If there are no correct answers, still acknowledge effort and provide gentle guidance`;

    const userPrompt = `Subject: ${subject}
Class: ${studentClass}
${topic ? `Topic: ${topic}` : ""}
Total Questions: ${questions.length}
Correct: ${correctQs.length}
Wrong: ${wrongQs.length}

CORRECTLY ANSWERED QUESTIONS:
${correctQs.length > 0 ? correctQs.map((q, i) => `${i + 1}. ${q}`).join("\n") : "None"}

INCORRECTLY ANSWERED QUESTIONS:
${wrongQs.length > 0 ? wrongQs.map((w, i) => `${i + 1}. Question: ${w.question}\n   Student chose: ${w.studentAnswer}\n   Correct was: ${w.correctAnswer}\n   Explanation: ${w.explanation}`).join("\n\n") : "None"}

Analyze the student's performance and provide strengths, weaknesses, and improvement suggestions.`;

    // Try Gemini keys first, fall back to Groq — same order as the other generators
    let result = geminiKeys.length > 0
      ? await callGeminiWithRotation(systemPrompt, userPrompt, geminiKeys)
      : null;

    if (!result && groqKeys.length > 0) {
      console.log("All Gemini keys failed/exhausted — falling back to Groq...");
      result = await callGroqWithRotation(systemPrompt, userPrompt, groqKeys);
    }

    if (!result) {
      return new Response(JSON.stringify({ error: "All API keys exhausted. Please try again later or check your key quotas." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let content = result.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let analysis: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (e) {
      console.error("Failed to parse AI response:", content.substring(0, 500));
      return new Response(JSON.stringify({ error: "Failed to parse AI response. Please try again.", raw: content.substring(0, 200) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-test-results error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});