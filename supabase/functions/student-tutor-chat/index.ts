import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
    const { message, student_id, conversation_history = [] } = await req.json();

    if (!message || !student_id) {
      return new Response(JSON.stringify({ error: "message and student_id are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
- Curriculum: ${student?.curriculum || "CBSE"}
- Weak Topics: ${weakTopics.length ? weakTopics.join(", ") : "None identified"}
${relevantContext}

Guidelines:
- Adapt explanations to the student's VARK type (Visual/Auditory/Reading/Kinesthetic)
- Keep language simple and age-appropriate for class ${student?.grade || ""}
- Use examples, analogies, and step-by-step explanations
- If the student is struggling with a weak topic, provide extra scaffolding
- Encourage the student and celebrate progress
- When referencing textbook content, cite it naturally
- Keep responses concise but thorough (200-400 words max)
- Use markdown for formatting (headers, bold, lists) when helpful`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...conversation_history.slice(-10),
      { role: "user", content: message },
    ];

    // Stream response
    const aiResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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

    return new Response(aiResp.body, {
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
