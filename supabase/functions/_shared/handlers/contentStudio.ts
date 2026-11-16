// supabase/functions/_shared/handlers/contentStudio.ts
//
// CONTENT STUDIO (Phase 1): teacher prompt -> outline -> PPTX / flashcards / flowchart.
// Not a standalone edge function (deployment limit): `generate-entry-ticket` routes to it via
// action "content_studio" - see _shared/mergedRouter.ts.
// Gemini key: CONTENT_STUDIO_GEMINI_API_KEY first, then the shared keys in _shared/aiClient.ts.
// Needs migration 20261113000000_content_studio.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import PptxGenJS from "npm:pptxgenjs@3.12.0";
import { callAi, getAiConfig } from "../aiClient.ts";
import { buildThemedPptx, DEFAULT_THEME, THEMES } from "../pptxTemplates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "generated-content";
const SUPPORTED_OUTPUTS = ["pptx", "flashcards", "mermaid"] as const;
type OutputFormat = (typeof SUPPORTED_OUTPUTS)[number];
const DAILY_JOB_LIMIT = 5;

interface Outline {
  title: string;
  slides: { title: string; bullets: string[]; speaker_notes: string }[];
  flashcards?: { front: string; back: string }[];
  flowchart_mermaid?: string;
}

function buildPrompt(req: { prompt: string; subject: string; class_level: string; language: string; slide_count: number; outputs: OutputFormat[] }) {
  const wantsFlashcards = req.outputs.includes("flashcards");
  const wantsFlowchart = req.outputs.includes("mermaid");
  return [
    `You are an expert school teacher creating classroom material.`,
    `Subject: ${req.subject || "General"}. Class: ${req.class_level || "not specified"}. Write ALL content in this language: ${req.language}.`,
    `Teacher request: """${req.prompt}"""`,
    ``,
    `Return ONLY a JSON object with this shape (no markdown, no commentary):`,
    `{`,
    `  "title": "short lesson title",`,
    `  "slides": [ { "title": "...", "bullets": ["2-5 short bullet points"], "speaker_notes": "1-3 sentences the teacher can say" } ]`,
    `  ${wantsFlashcards ? `,"flashcards": [ { "front": "question or term", "back": "short answer" } ]  // 8-12 cards` : ""}`,
    `  ${wantsFlowchart ? `,"flowchart_mermaid": "a valid Mermaid flowchart TD diagram as plain text, 5-12 nodes, labels in double quotes"` : ""}`,
    `}`,
    `Rules: "slides" must contain exactly ${req.slide_count} items. Keep bullets short and age-appropriate for the class.`,
  ].join("\n");
}

function parseOutline(text: string, req: { outputs: OutputFormat[]; slide_count: number }): Outline {
  const clean = text.replace(/```json|```/g, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error("AI returned invalid JSON for the outline");
  }
  if (!parsed || typeof parsed.title !== "string" || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error("AI outline is missing title or slides");
  }
  const slides = parsed.slides.slice(0, Math.max(req.slide_count, 1)).map((s: any) => ({
    title: String(s?.title ?? "").slice(0, 200),
    bullets: Array.isArray(s?.bullets) ? s.bullets.map((b: any) => String(b)).slice(0, 6) : [],
    speaker_notes: String(s?.speaker_notes ?? ""),
  }));
  const outline: Outline = { title: parsed.title, slides };
  if (req.outputs.includes("flashcards")) {
    outline.flashcards = (Array.isArray(parsed.flashcards) ? parsed.flashcards : [])
      .map((c: any) => ({ front: String(c?.front ?? ""), back: String(c?.back ?? "") }))
      .filter((c: { front: string; back: string }) => c.front && c.back);
  }
  if (req.outputs.includes("mermaid")) {
    const m = String(parsed.flowchart_mermaid ?? "").replace(/```mermaid|```/g, "").trim();
    if (!/^(flowchart|graph)\b/i.test(m)) throw new Error("AI flowchart is not valid Mermaid");
    outline.flowchart_mermaid = m;
  }
  return outline;
}

function buildPptx(outline: Outline, template: string, subtitle: string, rtl: boolean): Promise<Uint8Array> {
  return buildThemedPptx(PptxGenJS, { title: outline.title, subtitle, slides: outline.slides, rtl }, template);
}

export async function handleContentStudio(req: Request): Promise<Response> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Identify the caller from their JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Please log in again." }, 401);
    const teacherId = userData.user.id;

    // 2. Validate input.
    const body = await req.json();
    const prompt = String(body.prompt ?? "").trim();
    if (prompt.length < 5 || prompt.length > 1000) return json({ error: "Prompt should be between 5 and 1000 characters." }, 400);

    const outputs: OutputFormat[] = Array.isArray(body.outputs) ? body.outputs : [];
    const unsupported = outputs.filter((o) => !(SUPPORTED_OUTPUTS as readonly string[]).includes(o));
    if (unsupported.length) return json({ error: `Not supported yet: ${unsupported.join(", ")}` }, 400);
    if (outputs.length === 0) return json({ error: "Select at least one output." }, 400);

    const slideCount = Math.min(Math.max(Number(body.slide_count) || 8, 3), 12);
    const subject = String(body.subject ?? "").slice(0, 100);
    const classLevel = String(body.class_level ?? "").slice(0, 50);
    const language = String(body.language ?? "en").slice(0, 20);
    const template = typeof body.template === "string" && body.template in THEMES ? body.template : DEFAULT_THEME;
    const isRtl = /arab|عرب|^ar$/i.test(language);

    const admin = createClient(supabaseUrl, serviceKey);

    // 3. Simple daily quota per teacher.
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count } = await admin
      .from("content_jobs")
      .select("id", { count: "exact", head: true })
      .eq("teacher_id", teacherId)
      .gte("created_at", startOfDay.toISOString());
    if ((count ?? 0) >= DAILY_JOB_LIMIT) {
      return json({ error: `Daily limit reached (${DAILY_JOB_LIMIT} generations per day). Try again tomorrow.` }, 429);
    }

    // 4. Create the job row.
    const { data: job, error: jobErr } = await admin
      .from("content_jobs")
      .insert({ teacher_id: teacherId, prompt, subject, class_level: classLevel, language, slide_count: slideCount, outputs, status: "outline" })
      .select("id")
      .single();
    if (jobErr || !job) return json({ error: "Could not create job: " + (jobErr?.message ?? "unknown") }, 500);

    const fail = async (message: string, status = 500) => {
      await admin.from("content_jobs").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", job.id);
      return json({ error: message, job_id: job.id }, status);
    };

    // 5. Outline from Gemini (key order: CONTENT_STUDIO key first, then shared keys).
    let outline: Outline;
    try {
      const cfg = getAiConfig();
      const csKey = Deno.env.get("CONTENT_STUDIO_GEMINI_API_KEY");
      if (csKey && !cfg.geminiKeys.includes(csKey)) cfg.geminiKeys.unshift(csKey);
      const { text } = await callAi(cfg, buildPrompt({ prompt, subject, class_level: classLevel, language, slide_count: slideCount, outputs }), {
        temperature: 0.4,
        maxOutputTokens: 8192,
      });
      outline = parseOutline(text, { outputs, slide_count: slideCount });
    } catch (e) {
      return await fail(e instanceof Error ? e.message : String(e));
    }

    await admin.from("content_jobs").update({ outline, status: "rendering", updated_at: new Date().toISOString() }).eq("id", job.id);

    // 6. Render each requested file. A failure in one output does not stop the others.
    const results: { format: string; url: string | null; error?: string }[] = [];
    for (const format of outputs) {
      if (format === "flashcards") {
        // Flashcards live in the outline JSON; no file needed.
        results.push({ format, url: null });
        await admin.from("content_outputs").insert({ job_id: job.id, format, status: "done" });
        continue;
      }
      try {
        let bytes: Uint8Array;
        let path: string;
        let contentType: string;
        if (format === "pptx") {
          bytes = await buildPptx(outline, template, [subject, classLevel].filter(Boolean).join(" · "), isRtl);
          path = `${teacherId}/${job.id}/presentation.pptx`;
          contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        } else {
          bytes = new TextEncoder().encode(outline.flowchart_mermaid ?? "");
          path = `${teacherId}/${job.id}/flowchart.mmd`;
          contentType = "text/plain";
        }
        const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
        if (upErr) throw new Error(upErr.message);
        const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
        await admin.from("content_outputs").insert({ job_id: job.id, format, storage_path: path, status: "done" });
        results.push({ format, url: signed?.signedUrl ?? null });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await admin.from("content_outputs").insert({ job_id: job.id, format, status: "failed", error: message });
        results.push({ format, url: null, error: message });
      }
    }

    const anySucceeded = results.some((r) => !r.error);
    await admin.from("content_jobs").update({
      status: anySucceeded ? "done" : "failed",
      error: anySucceeded ? null : "All outputs failed",
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);

    return json({
      job_id: job.id,
      title: outline.title,
      slides: outline.slides,
      flashcards: outline.flashcards ?? [],
      flowchart_mermaid: outline.flowchart_mermaid ?? null,
      outputs: results,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
