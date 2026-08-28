import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getGeminiKeys(): string[] {
  return [
    Deno.env.get("Worksheet_gemini_api_key"),
    Deno.env.get("GOOGLE_GEMINI_API_KEY_2"),
    Deno.env.get("GEMINI_KEY_2"),
    Deno.env.get("GEMINI_KEY_3"),
    Deno.env.get("GEMINI_KEY_4"),
  ].filter((k): k is string => !!k && k.trim().length > 0);
}

const INTENT_TOOL = {
  functionDeclarations: [
    {
      name: "create_lesson_plan_intent",
      description:
        "Call this whenever the teacher's message describes wanting a lesson plan created, even if some fields are missing. Leave a field null if not mentioned - do not guess.",
      parameters: {
        type: "OBJECT",
        properties: {
          class_level: { type: "STRING", description: "e.g. '4', 'Nursery', 'LKG'. Numeric classes as bare digit string." },
          section: { type: "STRING", description: "e.g. 'A'. Null if not mentioned." },
          subject_query: { type: "STRING", description: "Subject as the teacher said it, e.g. 'maths', 'science'. Null if not mentioned." },
          topic_query: { type: "STRING", description: "Topic/chapter as the teacher said it, e.g. 'fractions'. Null if not mentioned." },
          periods: { type: "NUMBER", description: "Number of periods. Null if not mentioned." },
          duration_minutes: { type: "NUMBER", description: "Minutes per period. Null if not mentioned." },
        },
        required: [],
      },
    },
  ],
};

// Fetch with a hard per-attempt timeout so one slow/hanging key+model
// combination cannot stall the whole request - it just gets abandoned and
// the next candidate is tried immediately.
async function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(systemPrompt: string, userPrompt: string, keys: string[]): Promise<any | null> {
  // Trimmed to the two fastest/most reliable models - this endpoint only needs
  // to extract a few fields, not generate long content, so a heavier fallback
  // chain just adds latency without adding value.
  const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
  for (const key of keys) {
    for (const model of models) {
      try {
        const response = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              tools: [INTENT_TOOL],
              generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
            }),
          },
          6000, // give each attempt 6s max before moving on
        );
        if (response.status === 429 || response.status === 503) { console.warn(`Key ${key.slice(-6)} / ${model} rate limited, rotating...`); continue; }
        if (!response.ok) {
          const err = await response.text();
          console.warn(`Key ${key.slice(-6)} / ${model} error ${response.status}: ${err.substring(0, 150)}`);
          continue;
        }
        const data = await response.json();
        const candidate = data?.candidates?.[0];
        if (!candidate) continue;
        return candidate;
      } catch (e: any) {
        if (e?.name === "AbortError") {
          console.warn(`Key ${key.slice(-6)} / ${model} timed out after 6s, moving on`);
        } else {
          console.error(`Network error on key ${key.slice(-6)} / ${model}:`, e);
        }
      }
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { message } = await req.json();
    const keys = getGeminiKeys();

    if (keys.length === 0) {
      return new Response(JSON.stringify({ error: "No AI API keys configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are APAS AI Teaching Assistant, a friendly assistant for teachers using the APAS platform.

ABOUT APAS (Adaptive Pedagogy & Analytics System) - use this to answer any questions about the platform accurately, never guess or invent features:
- A multi-school, multi-role EdTech platform for students, teachers, HODs, principals, school admins, and KNSoft admins.
- Academics: lesson plan generation, curative/differentiated lesson plans by VARK learning style, diagnostic tests, academic tests, worksheets & homework, syllabus tracking, semester/timetable engine, exam seating, hall tickets.
- Analytics & AI: AI Tutor, AI Teacher Assistant, AI Knowledge Hub, predictive analytics, risk prediction, competency heatmaps, school quality index, knowledge graph dashboard.
- Student life: gamification (learning games, leaderboard), skills passport, group projects, virtual classroom, attendance marking & risk analysis, behaviour analytics, SEN management, safeguarding/incident reporting.
- Admin & ERP: admissions, fee management, inventory, library, HR/people, billing, ID card generator, multi-tenant dashboard, branch management, security center.
- Transport: bus tracking, route planning, driver management, geofencing, delay prediction, weather/traffic alerts.
- Communication: parent/teacher/student/driver communication centers, notifications, alerts, appointment booking.
- Built with React/TypeScript, Supabase (Postgres + Edge Functions), and Google Gemini/Groq for AI features.

If the teacher's message is asking you to create/generate a lesson plan, call the create_lesson_plan_intent tool with whatever fields you can extract - leave the rest null, do not guess.
Otherwise, do NOT call the tool. Instead reply naturally and conversationally:
- For greetings/small talk, keep it to 1-2 short sentences.
- For questions about APAS itself, answer accurately using the knowledge above in 2-4 sentences - be specific about which module/feature handles what.
- If asked about something APAS does NOT do (not listed above), say so honestly rather than inventing an answer.
You can mention you're able to build lesson plans if it fits naturally, but don't force it into every reply.`;

    const startedAt = Date.now();
    const candidate = await callGemini(systemPrompt, message, keys);
    console.log(`extract-lesson-intent resolved in ${Date.now() - startedAt}ms`);

    const parts = candidate?.content?.parts || [];
    const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;

    if (!fnCall) {
      const chatReply = parts.find((p: any) => p.text)?.text?.trim()
        || "Hi! I'm here whenever you'd like to build a lesson plan - just tell me the class, subject and topic.";
      return new Response(JSON.stringify({ isLessonRequest: false, chatReply }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ isLessonRequest: true, intent: fnCall.args }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-lesson-intent error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
