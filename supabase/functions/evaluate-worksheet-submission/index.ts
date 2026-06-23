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

async function evaluateWithGemini(worksheetContent: string, answers: Record<string, string>, answerFileUrl: string | null, studentName: string): Promise<{ ai_score: number; ai_feedback: string; ai_per_activity: any[] }> {
  const apiKey = Deno.env.get("Worksheet_gemini_api_key") || Deno.env.get("Worksheet_Submission_Gemini_API_Key");
  if (!apiKey) throw new Error("No Gemini API key configured");
  console.log("Using key ending in:", apiKey.slice(-6));

  const answerKey = extractAnswerKey(worksheetContent);
  const activities = parseActivities(worksheetContent);
  const answersText = activities.map((activity, idx) => {
    const ans = answers[idx] || answers[String(idx)] || "(no answer provided)";
    return `--- ACTIVITY ${idx + 1} ---\n${activity}\n\nSTUDENT ANSWER:\n${ans}`;
  }).join("\n\n");

  const systemPrompt = `You are an expert educational evaluator. Evaluate student worksheet answers fairly and age-appropriately. Be encouraging. Return ONLY valid JSON:
{"total_score":<0-100>,"overall_feedback":"<2-3 encouraging sentences>","per_activity":[{"activity_index":0,"is_correct":<bool>,"partial_credit":<bool>,"student_score":<number>,"correct_answer":"<ideal>","what_student_got_right":"<string>","reason_for_wrong":"<simple kind explanation or empty>"}]}`;

  const userPrompt = `Evaluate this student worksheet.\nSTUDENT: ${studentName}\n${answerKey ? `ANSWER KEY:\n${answerKey}\n\n` : ""}ANSWERS:\n${answersText}`;

  const contentParts: any[] = [{ text: userPrompt }];
  if (answerFileUrl && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(answerFileUrl)) {
    try {
      const imgRes = await fetch(answerFileUrl);
      if (imgRes.ok) {
        const buf = await imgRes.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        contentParts.push({ inline_data: { mime_type: imgRes.headers.get("content-type") || "image/jpeg", data: base64 } });
      }
    } catch (e) { console.warn("Image load failed:", e); }
  }

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: contentParts }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
  });

  const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"];
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
      });
      if (!res.ok) { console.warn(`Model ${model} failed (${res.status}): ${(await res.text()).substring(0, 100)}`); continue; }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!text) continue;
      const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]);
      return { ai_score: Math.round(parsed.total_score || 0), ai_feedback: parsed.overall_feedback || "AI evaluation complete.", ai_per_activity: parsed.per_activity || [] };
    } catch (e) { console.error(`Model ${model} error:`, e); }
  }
  throw new Error("All Gemini models failed");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { submission_ids, submission_id } = await req.json();
    const ids: string[] = submission_ids || (submission_id ? [submission_id] : []);
    if (ids.length === 0) return new Response(JSON.stringify({ error: "submission_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const results: any[] = [];

    for (const id of ids) {
      try {
        const { data: sub, error: subErr } = await supabase.from("worksheet_submissions").select("*, worksheets(worksheet_content, topic, subject)").eq("id", id).single();
        if (subErr || !sub) { results.push({ id, error: "Submission not found" }); continue; }
        if (!sub.worksheets?.worksheet_content) { results.push({ id, error: "Worksheet content not found" }); continue; }
        const { ai_score, ai_feedback, ai_per_activity } = await evaluateWithGemini(sub.worksheets.worksheet_content, sub.answers || {}, sub.answer_file_url || null, sub.student_name || "Student");
        const { error: upErr } = await supabase.from("worksheet_submissions").update({ ai_score, ai_feedback, ai_per_activity, ai_reviewed_at: new Date().toISOString(), status: "ai_reviewed" }).eq("id", id);
        if (upErr) results.push({ id, error: upErr.message });
        else results.push({ id, success: true, ai_score, ai_feedback });
      } catch (e: any) { results.push({ id, error: e.message || "Evaluation failed" }); }
    }
    return new Response(JSON.stringify({ results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});