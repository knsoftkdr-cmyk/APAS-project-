import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface IndividualPayload {
  mode: "individual";
  studentName: string;
  className?: string;
  section?: string;
  topic?: string;
  score: number;
  teacherFeedback?: string;
  answers: { question: string; answer: string }[];
  history?: { topic: string; score: number }[];
}

interface ClassPayload {
  mode: "class";
  className?: string;
  section?: string;
  avgScore: number;
  submissionRate: number;
  totalStudents: number;
  pendingEval: number;
  perAssignment: { name: string; avgScore: number; submissions: number }[];
  topPerformers: { name: string; avgScore: number }[];
  bottomPerformers: { name: string; avgScore: number }[];
  commonFeedback?: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    const GROK_API_KEY = Deno.env.get("GROK_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY") || Deno.env.get("GEMINI_ADVANCED_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPEN_AI_KEY");
    if (!OPENROUTER_API_KEY && !GROK_API_KEY && !GEMINI_API_KEY && !OPENAI_API_KEY) {
      throw new Error("No AI provider API key configured");
    }

    const payload = (await req.json()) as IndividualPayload | ClassPayload;

    let systemPrompt = "";
    let userPrompt = "";

    if (payload.mode === "individual") {
      systemPrompt = `You are an expert K-12 educational coach. Based on a single student's homework answers, the teacher's score, and the teacher's feedback, generate concise, actionable improvement suggestions tailored to this student.

Return ONLY valid JSON in this exact structure (no markdown, no code fences):
{
  "summary": "2-3 sentence performance summary, encouraging and specific",
  "strengths": ["short bullet", "short bullet"],
  "weak_areas": ["short bullet describing the concept gap", "short bullet"],
  "suggestions": [
    { "title": "Short actionable title", "action": "1-2 sentence specific practice / activity / resource the student should do this week" }
  ],
  "parent_tip": "One short sentence the teacher can share with parents"
}

Rules:
- Provide 2-4 strengths, 2-4 weak areas, 4-6 suggestions
- Suggestions must be concrete (e.g., "Practice 5 word problems daily using the bar-model method")
- Tone: warm, motivating, age-appropriate
- Use the teacher feedback as a strong signal of where to focus`;

      userPrompt = `Student: ${payload.studentName}
Class: ${payload.className || "N/A"} ${payload.section || ""}
Topic: ${payload.topic || "N/A"}
Teacher Score: ${payload.score}/100
Teacher Feedback: ${payload.teacherFeedback || "(none provided)"}

Student's Answers:
${payload.answers
  .map((a, i) => `Q${i + 1}: ${a.question}\nA: ${a.answer || "(no answer)"}`)
  .join("\n\n")}

${payload.history?.length ? `Recent score history: ${payload.history.map(h => `${h.topic}=${h.score}`).join(", ")}` : ""}

Generate personalized improvement suggestions for this student.`;
    } else {
      systemPrompt = `You are an expert classroom analytics coach. Based on aggregate class performance, generate clear, actionable suggestions a teacher can apply to improve the WHOLE CLASS's outcomes.

Return ONLY valid JSON (no markdown, no code fences):
{
  "summary": "2-3 sentence overview of how the class is performing",
  "class_strengths": ["bullet", "bullet"],
  "class_weak_areas": ["bullet describing topic/skill gap", "bullet"],
  "teaching_strategies": [
    { "title": "Short title", "action": "1-2 sentence specific teaching move (grouping, re-teach plan, activity, formative check)" }
  ],
  "focus_students": [
    { "name": "Student name from bottom performers", "why": "one short reason", "intervention": "one specific next step" }
  ],
  "next_lesson_recommendation": "One sentence suggesting what to teach or revise next"
}

Rules:
- 2-4 class strengths, 2-4 weak areas, 4-6 teaching strategies, up to 3 focus students
- Suggestions must be specific and immediately actionable
- Use the per-assignment averages to identify which topics need re-teaching`;

      userPrompt = `Class: ${payload.className || "N/A"} Section ${payload.section || ""}
Total Students: ${payload.totalStudents}
Class Average Score: ${payload.avgScore}%
Submission Rate: ${payload.submissionRate}%
Pending Evaluation: ${payload.pendingEval}

Per-Assignment Averages:
${payload.perAssignment.map(a => `- ${a.name}: avg ${Math.round(a.avgScore)}% (${a.submissions} submissions)`).join("\n") || "(none)"}

Top Performers:
${payload.topPerformers.map(s => `- ${s.name}: ${Math.round(s.avgScore)}%`).join("\n") || "(none)"}

Bottom Performers (focus group):
${payload.bottomPerformers.map(s => `- ${s.name}: ${Math.round(s.avgScore)}%`).join("\n") || "(none)"}

${payload.commonFeedback?.length ? `Recurring teacher feedback themes:\n${payload.commonFeedback.map(f => `- ${f}`).join("\n")}` : ""}

Generate class-level improvement strategies.`;
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    async function callOpenAICompatible(url: string, key: string, model: string, extraHeaders: Record<string, string> = {}) {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: JSON.stringify({ model, messages, temperature: 0.7 }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`${url} ${r.status}: ${t.slice(0, 300)}`);
      }
      const j = await r.json();
      return j.choices?.[0]?.message?.content || "";
    }

    async function callGemini(key: string) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
          }),
        }
      );
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`gemini ${r.status}: ${t.slice(0, 300)}`);
      }
      const j = await r.json();
      return j.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    let content = "";
    const errors: string[] = [];

    const providers: Array<() => Promise<string>> = [];
    if (OPENROUTER_API_KEY) {
      // Try multiple OpenRouter models in order (free tier first, then paid fallbacks)
      const orModels = [
        "meta-llama/llama-3.3-70b-instruct:free",
        "google/gemini-flash-1.5",
        "openai/gpt-4o-mini",
      ];
      for (const m of orModels) {
        providers.push(() =>
          callOpenAICompatible(
            "https://openrouter.ai/api/v1/chat/completions",
            OPENROUTER_API_KEY,
            m,
            { "HTTP-Referer": "https://lovable.dev", "X-Title": "APAS Analytics" }
          )
        );
      }
    }
    if (GEMINI_API_KEY) providers.push(() => callGemini(GEMINI_API_KEY));
    if (OPENAI_API_KEY) {
      providers.push(() =>
        callOpenAICompatible("https://api.openai.com/v1/chat/completions", OPENAI_API_KEY, "gpt-4o-mini")
      );
    }
    if (GROK_API_KEY) {
      providers.push(() =>
        callOpenAICompatible("https://api.x.ai/v1/chat/completions", GROK_API_KEY, "grok-beta")
      );
    }

    for (const p of providers) {
      try {
        content = await p();
        if (content) break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("Provider failed:", msg);
        errors.push(msg);
      }
    }

    if (!content) {
      return new Response(
        JSON.stringify({ error: "All AI providers failed", details: errors }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let suggestions;
    try {
      suggestions = JSON.parse(content);
    } catch (e) {
      console.error("Parse error:", e, content);
      throw new Error("AI returned invalid JSON");
    }

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analytics-ai-suggestions error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
