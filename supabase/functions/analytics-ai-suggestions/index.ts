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

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds to your Lovable AI workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await resp.text();
      console.error("AI gateway error:", resp.status, t);
      throw new Error("AI gateway error");
    }

    const data = await resp.json();
    let content = data.choices?.[0]?.message?.content || "";
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
