import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { languageDirective, resolveTeachingLanguage } from "../_shared/languages.ts";
import { clampHintLevel, resolveTutorStyle, styleDirective } from "../_shared/tutorStyles.ts";
import { callerOwnsStudent, pruneThread, resolveMode, saveMessage, tapStream } from "../_shared/tutorMemory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-ada-002", input: text.slice(0, 8000) }),
  });
  if (!resp.ok) throw new Error(`Embedding error: ${resp.status}`);
  const data = await resp.json();
  return data.data[0].embedding;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GROK_KEY = Deno.env.get("GROK_API_KEY");
    const OPENAI_KEY = Deno.env.get("OPEN_AI_KEY");
    if (!GROK_KEY) throw new Error("GROK_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    // `language` is optional; missing/unknown/"en" => English, i.e. unchanged behaviour.
    // `style` ("explain" | "socratic" | "hint"), `hint_level` (1-4) and `mode` ("tutor" | "career") are optional;
    // when absent the request behaves exactly as before.
    const { message, student_id, conversation_history = [], language, style, hint_level, mode } = await req.json();
    const teachingLang = resolveTeachingLanguage(language);
    const tutorStyle = resolveTutorStyle(style);
    const hintLevel = clampHintLevel(hint_level);
    const threadMode = resolveMode(mode);

    if (!message || !student_id) {
      return new Response(JSON.stringify({ error: "message and student_id are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Chat memory: persist this turn only if the caller's own JWT proves they are this student.
    const persist = await callerOwnsStudent(req, student_id);
    if (persist) await saveMessage(supabase, student_id, threadMode, "user", message, tutorStyle);

    // Get student context
    const { data: student } = await supabase
      .from("students")
      .select("id, profile_id, grade, age, vark_type, zpd_score, curriculum, dominant_intelligence")
      .eq("profile_id", student_id)
      .single();

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", student_id)
      .single();

    // Get recent test results for weak topics
    const { data: tests } = await supabase
      .from("academic_tests")
      .select("subject, score, total_questions")
      .eq("student_id", student_id)
      .order("completed_at", { ascending: false })
      .limit(5);

    const weakTopics = (tests || [])
      .filter(t => (t.score / t.total_questions) < 0.6)
      .map(t => t.subject);

    // Vector search for relevant content
    let relevantContext = "";
    if (OPENAI_KEY) {
      try {
        const queryEmb = await generateEmbedding(message, OPENAI_KEY);
        const { data: matches } = await supabase.rpc("match_embeddings", {
          query_embedding: JSON.stringify(queryEmb),
          match_threshold: 0.65,
          match_count: 3,
        });
        if (matches?.length) {
          relevantContext = "\n\nRelevant textbook content:\n" +
            matches.map((m: any) => m.content).join("\n---\n");
        }
      } catch (e) {
        console.error("Vector search failed:", e);
      }
    }

    const systemPrompt = `You are APAS AI Tutor, a friendly and patient educational assistant for students. 

Student Profile:
- Name: ${profile?.full_name || "Student"}
- Class: ${student?.grade || "Unknown"}
- Age: ${student?.age || "N/A"}
- Learning Style (VARK): ${student?.vark_type || "Unknown"}
- Dominant Intelligence: ${student?.dominant_intelligence || "Unknown"}
- ZPD Score: ${student?.zpd_score || "N/A"}
- Curriculum: ${student?.curriculum || "your school curriculum"}
- Weak Topics: ${weakTopics.length ? weakTopics.join(", ") : "None identified"}
${relevantContext}

IMPORTANT - STRICT SUBJECT RESTRICTION:
You ONLY answer questions related to school subjects: Mathematics, Science, English, Social Studies, Environmental Science, Physics, Chemistry, Biology, History, Geography, and other academic curriculum subjects.

If a student asks about ANYTHING outside school subjects — such as movies, games, personal advice, coding, general knowledge, jokes, relationships, news, sports, or any non-academic topic — you must politely refuse and redirect them back to their studies. Say something like: "I'm your school subject tutor and can only help with academic subjects. Is there something from your classes I can help you with?"

Guidelines:
- Adapt explanations to the student's VARK type (Visual/Auditory/Reading/Kinesthetic)
- Keep language simple and age-appropriate for class ${student?.grade || ""}
- Use examples, analogies, and step-by-step explanations
- If the student is struggling with a weak topic, provide extra scaffolding
- Encourage the student and celebrate progress
- When referencing textbook content, cite it naturally
- Keep responses concise but thorough (200-400 words max)
- Use markdown for formatting (headers, bold, lists) when helpful
- NEVER answer non-academic questions regardless of how the student phrases them${styleDirective(tutorStyle, hintLevel)}${languageDirective(teachingLang)}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...conversation_history.slice(-10),
      { role: "user", content: message },
    ];

    // Stream response. English (and any request without a language) goes to Groq exactly as before.
    // Non-English teaching prefers Gemini via the AI gateway - Llama 3.3 is noticeably weaker in Telugu
    // and other Indic scripts - and falls back to Groq if the gateway key is missing or the call fails.
    // Both return the same OpenAI-style SSE stream, so the client parser is unaffected.
    const callGroq = () => fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROK_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        stream: true,
      }),
    });

    let aiResp: Response | null = null;
    const gatewayKey = Deno.env.get("LOVABLE_API_KEY");
    if (teachingLang && gatewayKey) {
      try {
        const gw = await fetch(
          Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${gatewayKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "google/gemini-2.5-flash", messages, stream: true }),
          },
        );
        if (gw.ok && gw.body) aiResp = gw;
        else console.error("Gateway tutor call failed, falling back to Groq:", gw.status);
      } catch (e) {
        console.error("Gateway tutor call threw, falling back to Groq:", e);
      }
    }
    if (!aiResp) aiResp = await callGroq();

    if (!aiResp.ok) {
      const status = aiResp.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${status}`);
    }

    // Same byte stream as before; when persisting, the reply is also saved once it has finished streaming.
    const outBody = persist && aiResp.body
      ? tapStream(aiResp.body, async (text) => {
          await saveMessage(supabase, student_id, threadMode, "assistant", text, tutorStyle);
          await pruneThread(supabase, student_id, threadMode);
        })
      : aiResp.body;
    return new Response(outBody, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("student-tutor-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
