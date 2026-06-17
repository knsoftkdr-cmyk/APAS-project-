import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { subject, studentClass, topic, questions, answers } = await req.json();
    const GROQ_API_KEY = Deno.env.get("GROK_API_KEY");
    if (!GROQ_API_KEY) throw new Error("GROK_API_KEY is not configured");

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

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
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

    if (!response.ok) {
      const t = await response.text();
      console.error("Groq API error:", response.status, t);
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    const analysis = JSON.parse(content);

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
