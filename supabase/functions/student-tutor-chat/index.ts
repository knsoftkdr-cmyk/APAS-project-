import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { languageDirective, resolveTeachingLanguage } from "../_shared/languages.ts";
import { clampHintLevel, resolveTutorStyle, styleDirective } from "../_shared/tutorStyles.ts";
import { accessibilityDirective } from "../_shared/accessibilityModel.ts";
import { callerOwnsStudent, pruneThread, resolveMode, saveMessage, tapStream } from "../_shared/tutorMemory.ts";
import { emitLearningEvent } from "../_shared/learningEvents.ts";
import { screenStudentMessage, sseFromText, voiceDirective } from "../_shared/voiceTutorSafety.ts";
import { evaluateAndStore } from "../_shared/handlers/aiQualityControl.ts";
import {
  attachmentDirective, attachmentNote, buildUserContent, sanitizeHistory, validateAttachments,
} from "../_shared/tutorAttachments.ts";

// Share of finished replies sent to the AI quality & safety evaluator (sheet row 40). Voice replies are spoken
// to younger children without a screen to re-read, so they are sampled more. Tunable via Supabase secrets.
const QUALITY_SAMPLE_RATE = Number(Deno.env.get("AI_QUALITY_SAMPLE_RATE") ?? "0.2");
const VOICE_QUALITY_SAMPLE_RATE = Number(Deno.env.get("AI_QUALITY_VOICE_SAMPLE_RATE") ?? "0.5");

/** Runs work after the response is returned when the runtime supports it, so the student never waits on it. */
function runInBackground(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p.catch((e) => console.error("background task failed:", e)));
  else p.catch((e) => console.error("background task failed:", e));
}

// AI model names. Providers retire models regularly (Gemini 2.0 Flash: 1 Jun 2026, Groq Llama 3.x: 16 Aug 2026,
// Gemini 2.5 Flash: 16 Oct 2026), so they can be changed WITHOUT a code change via Supabase secrets, e.g.
//   supabase secrets set GEMINI_MODELS="gemini-3.5-flash,gemini-3.6-flash"
//   supabase secrets set GROQ_MODELS="openai/gpt-oss-120b,openai/gpt-oss-20b"
const listFromEnv = (name: string, fallback: string[]) => {
  const v = (Deno.env.get(name) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return v.length ? v : fallback;
};
const GEMINI_MODELS = listFromEnv("GEMINI_MODELS", ["gemini-3.5-flash", "gemini-3.6-flash"]);
const GROQ_MODELS = listFromEnv("GROQ_MODELS", ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
const GATEWAY_MODEL = Deno.env.get("AI_GATEWAY_MODEL") ?? "google/gemini-3.5-flash";

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
    const OPENAI_KEY = Deno.env.get("OPEN_AI_KEY");
    const GATEWAY_KEY = Deno.env.get("LOVABLE_API_KEY");
    // GROK_API_KEY may be a Groq key (gsk_...) or an xAI Grok key (xai-...): route by prefix.
    const rawKey = (Deno.env.get("GROK_API_KEY") ?? Deno.env.get("GROQ_API_KEY") ?? "").trim();
    const XAI_KEY = rawKey.startsWith("xai-") ? rawKey : "";
    const GROQ_KEY = rawKey && !XAI_KEY ? rawKey : "";
    const GEMINI_KEYS = [
      "GEMINI_API_KEY", "GEMINI_API_KEY_1", "GOOGLE_GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY_2",
      "GEMINI_KEY_2", "GEMINI_KEY_3", "GEMINI_KEY_4", "Worksheet_gemini_api_key",
    ].map((n) => Deno.env.get(n)).filter((k): k is string => !!k);
    if (!XAI_KEY && !GROQ_KEY && !GATEWAY_KEY && !GEMINI_KEYS.length) {
      throw new Error("AI tutor is not configured: set GROK_API_KEY, a Gemini key or LOVABLE_API_KEY in Supabase secrets");
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    // `language` is optional; missing/unknown/"en" => English, i.e. unchanged behaviour.
    // `style` ("explain" | "socratic" | "hint"), `hint_level` (1-4) and `mode` ("tutor" | "career") are optional;
    // when absent the request behaves exactly as before.
    // `voice: true` = Voice conversational tutor: short, speakable, age-banded replies (see voiceTutorSafety.ts).
    // `attachments` = photos / documents the student sent with the question.
    const {
      message, student_id, conversation_history = [], language, style, hint_level, mode,
      accessibility, voice, grade_band, attachments,
    } = await req.json();
    const voiceMode = voice === true;
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

    // Photos / documents: validated here regardless of what the browser claims, and only for the signed-in
    // student themself (never for an anonymous caller or someone using another student's id).
    const checked = validateAttachments(attachments);
    if (!checked.ok) {
      return new Response(JSON.stringify({ error: checked.error }), {
        status: checked.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { images, documents } = checked;
    const hasAttachments = images.length > 0 || documents.length > 0;
    if (hasAttachments && !persist) {
      return new Response(JSON.stringify({ error: "Please sign in again to attach photos or documents." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // The chat history keeps a one-line note about the attachment, never the file itself.
    const messageForHistory = String(message) + attachmentNote(images, documents);
    if (persist) await saveMessage(supabase, student_id, threadMode, "user", messageForHistory, tutorStyle);

    // Get student context. Only for the verified student: an anonymous caller must not be able to read another
    // student's name, school, class or test results just by sending their id.
    const { data: profile } = persist
      ? await supabase
        .from("profiles")
        .select("full_name, school_id")
        .eq("id", student_id)
        .maybeSingle()
      : { data: null };

    const { data: student } = persist
      ? await supabase
        .from("students")
        .select("id, profile_id, grade, age, vark_type, zpd_score, curriculum, dominant_intelligence")
        .eq("profile_id", student_id)
        .maybeSingle()
      : { data: null };

    // Safeguards run before the model: worrying, unsafe or personal messages get a fixed, caring reply.
    const screen = screenStudentMessage(String(message));
    if (screen.kind !== "ok" && screen.reply) {
      if (persist) {
        await saveMessage(supabase, student_id, threadMode, "assistant", screen.reply, tutorStyle);
        // A disclosure of distress or abuse must reach a person: flag it to the school's safeguarding lead.
        if (screen.kind === "distress" && student?.id && profile?.school_id) {
          const { error: sgErr } = await supabase.from("safeguarding_incidents").insert({
            school_id: profile.school_id, student_id: student.id, category: "emotional", severity: "high",
            description: `Automatic flag from the AI Tutor${voiceMode ? " (voice mode)" : ""}: the student's message matched distress / abuse keywords. ` +
              `The tutor showed Childline (1098) and asked the student to speak to a trusted adult. Message: "${String(message).slice(0, 500)}"`,
            reported_by: student_id, is_anonymous: false,
          });
          if (sgErr) console.error("safeguarding auto-flag failed:", sgErr.message);
        }
      }
      return new Response(sseFromText(screen.reply), { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
    }

    // Learning event stream: record THAT the student asked the tutor (length + mode only, never the text).
    // Only when the caller's own JWT proved they are this student; failures are swallowed inside the helper.
    if (persist && student?.id) {
      await emitLearningEvent(supabase, {
        studentId: student.id, eventType: "tutor_message", source: threadMode,
        payload: { chars: String(message).length, language: teachingLang?.code ?? "en", style: tutorStyle },
      });
    }

    // Get recent test results for weak topics
    const { data: tests } = persist
      ? await supabase
        .from("academic_tests")
        .select("subject, score, total_questions")
        .eq("student_id", student_id)
        .order("completed_at", { ascending: false })
        .limit(5)
      : { data: null };

    const weakTopics = (tests || [])
      .filter(t => t.total_questions > 0 && (t.score / t.total_questions) < 0.6)
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
- Keep responses concise but thorough (150-300 words max)
- If the student's message is a broad topic request (e.g. "help me with fractions"), do NOT refuse and do NOT ask many questions: give a short friendly overview with one simple worked example, then ask ONE follow-up question (e.g. which part they want to practise)
- Greet by first name only on the first reply, not every time
- Format with markdown: short paragraphs, **bold** key terms, bullet or numbered lists for steps, and put each worked example on its own lines
- Write maths in plain text (e.g. 1/2 + 1/4 = 3/4), never LaTeX or $...$ symbols
- End with a short encouraging line or one question to check understanding
- NEVER answer non-academic questions regardless of how the student phrases them${styleDirective(tutorStyle, hintLevel)}${languageDirective(teachingLang)}${accessibilityDirective(accessibility)}${voiceMode ? voiceDirective(grade_band) : ""}${attachmentDirective(images, documents)}`;

    // History may only hold plain user/assistant text (a client must not be able to inject "system" turns).
    // `content` is a plain string for typed chat (unchanged) and a list of text + image parts when photos are attached.
    const messages: Array<{ role: string; content: unknown }> = [
      { role: "system", content: systemPrompt },
      ...sanitizeHistory(conversation_history, 10),
      { role: "user", content: buildUserContent(String(message), images, documents) },
    ];

    // Stream response. English (and any request without a language) goes to Groq exactly as before.
    // Non-English teaching prefers Gemini via the AI gateway - Llama 3.3 is noticeably weaker in Telugu
    // and other Indic scripts - and falls back to Groq if the gateway key is missing or the call fails.
    // Both return the same OpenAI-style SSE stream, so the client parser is unaffected.
    const openAiCompat = (url: string, key: string, model: string, extra: Record<string, unknown> = {}) =>
      fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: true, temperature: 0.6, ...extra }),
      });

    const attempts: Array<{ name: string; run: () => Promise<Response> }> = [];
    const addGemini = () => {
      for (const k of GEMINI_KEYS) for (const m of GEMINI_MODELS) {
        attempts.push({
          name: `gemini:${m}`,
          run: () => openAiCompat("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", k, m),
        });
      }
    };
    const addGateway = () => {
      if (GATEWAY_KEY) attempts.push({
        name: "gateway",
        run: () => openAiCompat(
          Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions",
          GATEWAY_KEY, GATEWAY_MODEL),
      });
    };
    const addGrokOrGroq = () => {
      if (XAI_KEY) for (const m of ["grok-3-mini", "grok-3", "grok-4"]) {
        attempts.push({ name: `xai:${m}`, run: () => openAiCompat("https://api.x.ai/v1/chat/completions", XAI_KEY, m) });
      }
      if (GROQ_KEY) for (const m of GROQ_MODELS) {
        attempts.push({ name: `groq:${m}`, run: () => openAiCompat("https://api.groq.com/openai/v1/chat/completions", GROQ_KEY, m, { max_tokens: 2000 }) });
      }
    };
    // Non-English prefers Gemini (better Indic scripts); English prefers Grok/Groq. Everything else is a fallback.
    if (images.length > 0) {
      // Only the Gemini providers can read photos (the Groq/Grok chat models here are text-only).
      addGemini(); addGateway();
      if (attempts.length === 0) {
        return new Response(JSON.stringify({
          error: "Photo questions need an AI model that can read images, and none is set up. Ask your administrator to add a Gemini key (GEMINI_API_KEY) in Supabase secrets. You can type the question instead.",
        }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else if (teachingLang) { addGemini(); addGateway(); addGrokOrGroq(); }
    else { addGrokOrGroq(); addGemini(); addGateway(); }

    let aiResp: Response | null = null;
    let lastStatus = 0;
    const failures: string[] = [];
    for (const a of attempts) {
      try {
        const r = await a.run();
        if (r.ok && r.body) { aiResp = r; break; }
        lastStatus = r.status;
        const detail = (await r.text().catch(() => "")).slice(0, 200);
        failures.push(`${a.name}=${r.status}`);
        console.error(`Tutor provider ${a.name} failed:`, r.status, detail);
      } catch (e) {
        failures.push(`${a.name}=network`);
        console.error(`Tutor provider ${a.name} threw:`, e);
      }
    }
    if (!aiResp) {
      const only429 = failures.length > 0 && failures.every((f) => f.endsWith("=429"));
      const msg = only429
        ? "The AI is busy right now. Please try again in a minute."
        : `The AI service could not be reached. Details: ${failures.join(", ")}. Check the API keys in Supabase secrets.`;
      return new Response(JSON.stringify({ error: msg }), {
        status: only429 ? 429 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Same byte stream as before; when persisting, the reply is also saved once it has finished streaming.
    const outBody = persist && aiResp.body
      ? tapStream(aiResp.body, async (text) => {
          await saveMessage(supabase, student_id, threadMode, "assistant", text, tutorStyle);
          await pruneThread(supabase, student_id, threadMode);
          // AI quality & safety: score a sample of finished replies (hallucination, bias, alignment, privacy, age).
          if (text.trim() && Math.random() < (voiceMode ? VOICE_QUALITY_SAMPLE_RATE : QUALITY_SAMPLE_RATE)) {
            runInBackground(evaluateAndStore(supabase, {
              content: text, question: String(message), reference: relevantContext || null,
              gradeBand: grade_band ?? student?.grade ?? null, subject: null,
              source: voiceMode ? "voice_tutor" : "ai_tutor", schoolId: profile?.school_id ?? null,
            }));
          }
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