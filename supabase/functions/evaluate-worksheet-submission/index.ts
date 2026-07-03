import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseActivities(content: string): string[] {
  const keyIndex = content.search(/COMPLETE ANSWER KEY/i);
  const studentFacing = keyIndex >= 0 ? content.slice(0, keyIndex) : content;
  return studentFacing.split(/^---$/m).map((b) => b.trim()).filter((b) => b.length > 0);
}

function extractAnswerKey(content: string): string {
  const idx = content.search(/COMPLETE ANSWER KEY/i);
  return idx >= 0 ? content.slice(idx) : "";
}

// Chunked base64 encoding so large PDFs/images don't blow the call stack
// (spreading a huge Uint8Array into String.fromCharCode(...) can crash).
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function guessMimeType(url: string, headerType: string | null): string {
  if (headerType && headerType !== "application/octet-stream" && headerType !== "binary/octet-stream") {
    return headerType.split(";")[0].trim();
  }
  if (/\.pdf(\?|$)/i.test(url)) return "application/pdf";
  if (/\.(jpg|jpeg)(\?|$)/i.test(url)) return "image/jpeg";
  if (/\.png(\?|$)/i.test(url)) return "image/png";
  if (/\.gif(\?|$)/i.test(url)) return "image/gif";
  if (/\.webp(\?|$)/i.test(url)) return "image/webp";
  return "";
}

const SUPPORTED_GEMINI_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"];

interface EvalResult {
  ai_score: number;
  ai_feedback: string;
  ai_per_activity: any[];
  ai_topic_analysis: any[];
  ai_study_plan: any[];
}

// Structured output schema (OpenAPI subset, per Gemini docs).
// Forcing this shape server-side eliminates the regex/markdown-strip JSON
// extraction that was breaking on unescaped characters inside long
// explanation strings.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    total_score: { type: "NUMBER" },
    overall_feedback: { type: "STRING" },
    per_activity: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          activity_index: { type: "INTEGER" },
          is_correct: { type: "BOOLEAN" },
          partial_credit: { type: "BOOLEAN" },
          student_score: { type: "NUMBER" },
          correct_answer: { type: "STRING" },
          what_student_got_right: { type: "STRING" },
          reason_for_wrong: { type: "STRING" },
          topic: { type: "STRING" },
          question_type: {
            type: "STRING",
            enum: ["recall", "conceptual", "application", "assertion_reason", "numerical", "derivation"],
          },
        },
        required: ["activity_index", "is_correct", "student_score", "correct_answer", "topic", "question_type"],
      },
    },
    topic_analysis: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          topic: { type: "STRING" },
          proficiency_percent: { type: "NUMBER" },
          status: { type: "STRING", enum: ["strong", "weak", "critical_gap"] },
        },
        required: ["topic", "proficiency_percent", "status"],
      },
    },
    study_plan: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          priority: { type: "INTEGER" },
          title: { type: "STRING" },
          description: { type: "STRING" },
        },
        required: ["priority", "title", "description"],
      },
    },
  },
  required: ["total_score", "overall_feedback", "per_activity", "topic_analysis", "study_plan"],
};

async function evaluateWithGemini(worksheetContent: string, answers: Record<string, string>, answerFileUrl: string | null, studentName: string): Promise<EvalResult> {
  const apiKey = Deno.env.get("Worksheet_gemini_api_key") || Deno.env.get("Worksheet_Submission_Gemini_API_Key");
  if (!apiKey) throw new Error("No Gemini API key configured");
  console.log("Using key ending in:", apiKey.slice(-6));

  const answerKey = extractAnswerKey(worksheetContent);
  const activities = parseActivities(worksheetContent);

  const hasTypedAnswers = activities.some((_, idx) => {
    const ans = answers[idx] || answers[String(idx)];
    return typeof ans === "string" && ans.trim().length > 0;
  });

  const answersText = activities.map((activity, idx) => {
    const ans = answers[idx] || answers[String(idx)] || "(no typed answer provided)";
    return `--- ACTIVITY ${idx + 1} ---\n${activity}\n\nSTUDENT ANSWER:\n${ans}`;
  }).join("\n\n");

  // Note: with responseSchema enforcing the JSON shape, we no longer need to
  // spell out the exact JSON format in the prompt itself - just the grading
  // instructions. The schema guarantees structure; the prompt guides content.
  const systemPrompt = `You are an expert educational evaluator. Evaluate student worksheet answers fairly and age-appropriately. Be encouraging. If the student's answers are provided as an attached image or PDF file rather than typed text, carefully read that attached file and match each answer to the correct activity number by its content and position.

For EACH activity, identify the specific topic/skill it tests (a short 2-6 word topic name, e.g. "Area of a Rectangle", "Perimeter vs Area Distinction") and its question_type.

Then, across ALL activities, group performance by topic and compute a topic proficiency map: for each distinct topic tested, give a proficiency_percent (0-100, based on how well the student did on questions of that topic) and a status of "strong" (80-100%), "weak" (40-79%), or "critical_gap" (0-39%).

Finally, produce a study_plan: an ordered list (max 3 items) of the topics most in need of attention, ranked by how much they impact the student's overall score (worst/most-critical first). Each item needs a short title (the topic name) and a 1-sentence actionable description of what the student should do.`;

  const fileNote = !hasTypedAnswers && answerFileUrl
    ? `\n\nIMPORTANT: The student did NOT type answers into the text boxes above (they all show "no typed answer provided"). Instead, the student uploaded afile containing their handwritten or typed answers, which is attached to this message as an image or PDF. Read that attached file carefully and evaluate thestudent's actual answers found there, matching them to each activity in order.`
    : "";

  const userPrompt = `Evaluate this student worksheet.\nSTUDENT: ${studentName}\n${answerKey ? `ANSWER KEY:\n${answerKey}\n\n` : ""}ANSWERS:\n${answersText}${fileNote}`;

  const contentParts: any[] = [{ text: userPrompt }];

  console.log("DEBUG: answerFileUrl =", answerFileUrl);
  if (answerFileUrl) {
    try {
      const fileRes = await fetch(answerFileUrl);
      console.log("DEBUG: fetch status =", fileRes.status, "content-type header =", fileRes.headers.get("content-type"));
      if (fileRes.ok) {
        const buf = await fileRes.arrayBuffer();
        console.log("DEBUG: fetched bytes length =", buf.byteLength);
        const mimeType = guessMimeType(answerFileUrl, fileRes.headers.get("content-type"));
        console.log("DEBUG: guessed mimeType =", mimeType, "supported =", SUPPORTED_GEMINI_TYPES.includes(mimeType));
        if (SUPPORTED_GEMINI_TYPES.includes(mimeType)) {
          const base64 = arrayBufferToBase64(buf);
          console.log("DEBUG: base64 length =", base64.length);
          contentParts.push({ inline_data: { mime_type: mimeType, data: base64 } });
        } else {
          console.warn("Unsupported file type for Gemini, skipping attachment:", mimeType, answerFileUrl);
        }
      } else {
        console.warn("Failed to fetch answer file:", fileRes.status, answerFileUrl);
      }
    } catch (e) {
      console.warn("Answer file load failed:", e);
    }
  }
  console.log("DEBUG: total contentParts count =", contentParts.length);

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: contentParts }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"];
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
      });
      if (!res.ok) { console.warn(`Model ${model} failed (${res.status}): ${(await res.text()).substring(0, 200)}`); continue; }
      const data = await res.json();

      const finishReason = data?.candidates?.[0]?.finishReason;
      if (finishReason === "MAX_TOKENS") {
        console.warn(`Model ${model} hit MAX_TOKENS - response likely truncated, trying next model`);
        continue;
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!text) { console.warn(`Model ${model} returned empty text. finishReason=${finishReason}`); continue; }

      // With responseSchema, Gemini returns raw JSON directly - no markdown
      // fences, no regex extraction needed.
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        console.error(`Model ${model} returned invalid JSON despite responseSchema:`, parseErr, "text length =", text.length);
        continue;
      }

      return {
        ai_score: Math.round(parsed.total_score || 0),
        ai_feedback: parsed.overall_feedback || "AI evaluation complete.",
        ai_per_activity: parsed.per_activity || [],
        ai_topic_analysis: parsed.topic_analysis || [],
        ai_study_plan: parsed.study_plan || [],
      };
    } catch (e) { console.error(`Model ${model} error:`, e); }
  }
  throw new Error("All Gemini models failed");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { submission_ids, submission_id } = await req.json();
    const ids: string[] = submission_ids || (submission_id ? [submission_id] : []);
    if (ids.length === 0) return new Response(JSON.stringify({ error: "submission_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type":"application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const results: any[] = [];

    for (const id of ids) {
      try {
        const { data: sub, error: subErr } = await supabase.from("worksheet_submissions").select("*, worksheets(worksheet_content, topic, subject)").eq("id", id).single();
        if (subErr || !sub) { results.push({ id, error: "Submission not found" }); continue; }
        if (!sub.worksheets?.worksheet_content) { results.push({ id, error: "Worksheet content not found" }); continue; }
        const { ai_score, ai_feedback, ai_per_activity, ai_topic_analysis, ai_study_plan } = await evaluateWithGemini(sub.worksheets.worksheet_content, sub.answers || {}, sub.answer_file_url|| null, sub.student_name || "Student");
        const { error: upErr } = await supabase.from("worksheet_submissions").update({ ai_score, ai_feedback, ai_per_activity, ai_topic_analysis, ai_study_plan, ai_reviewed_at: new Date().toISOString(), status: "ai_reviewed" }).eq("id", id);
        if (upErr) results.push({ id, error: upErr.message });
        else results.push({ id, success: true, ai_score, ai_feedback });
      } catch (e: any) { results.push({ id, error: e.message || "Evaluation failed" }); }
    }
    return new Response(JSON.stringify({ results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});