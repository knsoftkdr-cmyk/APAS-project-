// supabase/functions/_shared/handlers/contentStudio.ts
//
// CONTENT STUDIO: teacher prompt -> outline -> PPTX / flashcards / flowchart / narration MP3 / video.
// Not a standalone edge function (deployment limit): `generate-entry-ticket` routes to it via
// action "content_studio" - see _shared/mergedRouter.ts.
// Gemini key: CONTENT_STUDIO_GEMINI_API_KEY first, then the shared keys in _shared/aiClient.ts.
// Audio: Google Cloud TTS with GOOGLE_TTS_API_KEY (see _shared/googleTts.ts).
// Video: this function only narrates each slide (scenes/scene-NN.mp3); the browser draws the slides,
// encodes the MP4 (src/lib/lessonVideo.ts) and uploads it through op "video_upload" + "video_done".
// Needs migrations 20261113000000_content_studio.sql, 20261116000000_content_studio_audio.sql and
// 20261116120000_content_studio_video.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import PptxGenJS from "npm:pptxgenjs@3.12.0";
import { callAi, getAiConfig } from "../aiClient.ts";
import { planExplainerScenes } from "../explainerScenes.ts";
import { buildThemedPptx, DEFAULT_THEME, THEMES } from "../pptxTemplates.ts";
import { concatBytes, synthesizeSections } from "../googleTts.ts";
import { KIDS_FLASHCARDS_PROMPT, type KidsFlashcard, parseKidsFlashcards, renderFlashcardSheetSvg } from "../kidsFlashcards.ts";
import { FRAME_COLORS, KIDS_FLOWCHART_PROMPT, type KidsFlowchart, parseKidsFlowchart, renderKidsFlowchartSvg } from "../kidsFlowchart.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "generated-content";
const SUPPORTED_OUTPUTS = ["pptx", "flashcards", "mermaid", "audio", "video"] as const;
type OutputFormat = (typeof SUPPORTED_OUTPUTS)[number];
const DAILY_JOB_LIMIT = 5;

interface Outline {
  title: string;
  /** scene: animated explainer plan for the video (op "video_scenes"; drawn by src/lib/explainerScene.ts). */
  slides: { title: string; bullets: string[]; speaker_notes: string; narration?: string; scene?: Record<string, unknown> | null }[];
  /** emoji is missing on jobs made before picture cards. */
  flashcards?: KidsFlashcard[];
  /** Kids poster flow chart (output key "mermaid" kept for the DB check constraint). */
  flowchart?: KidsFlowchart;
  /** Older jobs stored Mermaid code instead. */
  flowchart_mermaid?: string;
  /** What the poster was drawn with, so history can redraw it. */
  /** video_style: "explainer" = animated picture scenes, "slides" = bullet slides. scene_tries limits AI re-planning. */
  render?: { template: string; rtl: boolean; video_style?: "explainer" | "slides"; scene_tries?: number };
}

function flashcardsSvg(outline: Partial<Outline>): string | null {
  if (!outline.flashcards?.length || !outline.flashcards.some((c) => c.emoji)) return null;
  const r = outline.render ?? { template: DEFAULT_THEME, rtl: false };
  return renderFlashcardSheetSvg(outline.flashcards, {
    title: outline.title, rtl: r.rtl, frame: FRAME_COLORS[r.template] ?? FRAME_COLORS.nature,
  });
}

function flowchartSvg(outline: Partial<Outline>): string | null {
  if (!outline.flowchart) return null;
  const r = outline.render ?? { template: DEFAULT_THEME, rtl: false };
  return renderKidsFlowchartSvg(outline.flowchart, { rtl: r.rtl, frame: FRAME_COLORS[r.template] ?? FRAME_COLORS.nature });
}

function buildPrompt(req: { prompt: string; subject: string; class_level: string; language: string; slide_count: number; outputs: OutputFormat[] }) {
  const wantsFlashcards = req.outputs.includes("flashcards");
  const wantsFlowchart = req.outputs.includes("mermaid");
  const wantsAudio = req.outputs.includes("audio") || req.outputs.includes("video");
  return [
    `You are an expert school teacher creating classroom material.`,
    `Subject: ${req.subject || "General"}. Class: ${req.class_level || "not specified"}. Write ALL content in this language: ${req.language}.`,
    `Teacher request: """${req.prompt}"""`,
    ``,
    `Return ONLY a JSON object with this shape (no markdown, no commentary):`,
    `{`,
    `  "title": "short lesson title",`,
    `  "slides": [ { "title": "...", "bullets": ["2-5 short bullet points"], "speaker_notes": "1-3 sentences the teacher can say"${
      wantsAudio ? `, "narration": "3-4 sentences a friendly teacher would SPEAK to explain this slide to the class, natural spoken style, no bullet symbols, no emojis, no markdown"` : ""
    } } ]`,
    `  ${wantsFlashcards ? `,${KIDS_FLASHCARDS_PROMPT}` : ""}`,
    `  ${wantsFlowchart ? `,${KIDS_FLOWCHART_PROMPT}` : ""}`,
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
    narration: typeof s?.narration === "string" ? s.narration.slice(0, 3000) : undefined,
  }));
  const outline: Outline = { title: parsed.title, slides };
  if (req.outputs.includes("flashcards")) {
    outline.flashcards = parseKidsFlashcards(parsed.flashcards);
  }
  if (req.outputs.includes("mermaid")) {
    const chart = parseKidsFlowchart(parsed.flowchart);
    if (!chart) throw new Error("AI did not return a usable flow chart");
    outline.flowchart = chart;
  }
  return outline;
}

/** Spoken script: lesson title, then each slide's narration (falls back to notes + bullets). */
function narrationSections(outline: Outline) {
  return [
    { text: outline.title },
    ...outline.slides.map((s) => ({
      heading: s.title,
      text: s.narration?.trim() || [s.speaker_notes, ...s.bullets].filter(Boolean).join(". "),
    })),
  ];
}

function buildPptx(outline: Outline, template: string, subtitle: string, rtl: boolean): Promise<Uint8Array> {
  return buildThemedPptx(PptxGenJS, { title: outline.title, subtitle, slides: outline.slides, rtl }, template);
}

const HISTORY_LIMIT = 100; // the page searches / filters these in the browser

/** Scene 0 is the title; scene i is slide i (1-based). Same order as narrationSections(). */
const scenePath = (teacherId: string, jobId: string, i: number) =>
  `${teacherId}/${jobId}/scenes/scene-${String(i).padStart(2, "0")}.mp3`;
const videoPath = (teacherId: string, jobId: string) => `${teacherId}/${jobId}/video.mp4`;

/** Signed links to every scene's narration, or null when any is missing. */
// deno-lint-ignore no-explicit-any
async function sceneAudioUrls(admin: any, teacherId: string, jobId: string, sceneCount: number): Promise<string[] | null> {
  const paths = Array.from({ length: sceneCount }, (_, i) => scenePath(teacherId, jobId, i));
  const { data } = await admin.storage.from(BUCKET).createSignedUrls(paths, 3600);
  const urls = (data ?? []).map((d: { signedUrl?: string | null; error?: string | null }) => (d.error ? null : d.signedUrl ?? null));
  return urls.length === sceneCount && urls.every(Boolean) ? urls : null;
}

/** Signed upload slot for the browser-made MP4 (the bucket is private; the teacher never gets write access). */
// deno-lint-ignore no-explicit-any
async function videoUploadSlot(admin: any, teacherId: string, jobId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "Invalid job id" }, 400);
  const { data: job } = await admin.from("content_jobs").select("id").eq("id", jobId).eq("teacher_id", teacherId).maybeSingle();
  if (!job) return json({ error: "Not found" }, 404);
  const path = videoPath(teacherId, jobId);
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return json({ error: error?.message ?? "Could not prepare the upload" }, 500);
  return json({ bucket: BUCKET, path, token: data.token });
}

const MAX_SCENE_TRIES = 3;

/**
 * Animated explainer plan for every slide of a job (planned once, then reused from the outline).
 * Called by the browser before it builds an "explainer" video, so the AI time does not count
 * against the main generation request.
 */
// deno-lint-ignore no-explicit-any
async function videoScenes(admin: any, teacherId: string, jobId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "Invalid job id" }, 400);
  const { data: job } = await admin.from("content_jobs").select("id, outline, language, subject, class_level")
    .eq("id", jobId).eq("teacher_id", teacherId).maybeSingle();
  if (!job?.outline?.slides?.length) return json({ error: "Not found" }, 404);
  const outline = job.outline as Outline;
  const missing = outline.slides.map((s, i) => (s.scene ? -1 : i)).filter((i) => i >= 0);
  const tries = outline.render?.scene_tries ?? 0;
  if (missing.length && tries < MAX_SCENE_TRIES) {
    const cfg = getAiConfig();
    const csKey = Deno.env.get("CONTENT_STUDIO_GEMINI_API_KEY");
    if (csKey && !cfg.geminiKeys.includes(csKey)) cfg.geminiKeys.unshift(csKey);
    let planned: (Record<string, unknown> | null)[];
    try {
      planned = await planExplainerScenes(cfg, missing.map((i) => outline.slides[i]), {
        language: job.language ?? "English", subject: job.subject ?? "", classLevel: job.class_level ?? "", title: outline.title,
      });
    } catch (e) {
      outline.render = { ...(outline.render ?? { template: DEFAULT_THEME, rtl: false }), scene_tries: tries + 1 };
      await admin.from("content_jobs").update({ outline }).eq("id", jobId);
      const message = e instanceof Error ? e.message : String(e);
      return json({ error: /timed out|rate limited/i.test(message) ? "The AI is busy right now. Please try again in a minute." : message }, 503);
    }
    missing.forEach((slideIdx, k) => { if (planned[k]) outline.slides[slideIdx].scene = planned[k]; });
    outline.render = { ...(outline.render ?? { template: DEFAULT_THEME, rtl: false }), scene_tries: tries + 1 };
    await admin.from("content_jobs").update({ outline }).eq("id", jobId);
  }
  return json({ scenes: outline.slides.map((s) => s.scene ?? null) });
}

/** Record the uploaded MP4 and return a link to play it. */
// deno-lint-ignore no-explicit-any
async function videoDone(admin: any, teacherId: string, jobId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "Invalid job id" }, 400);
  const { data: job } = await admin.from("content_jobs").select("id").eq("id", jobId).eq("teacher_id", teacherId).maybeSingle();
  if (!job) return json({ error: "Not found" }, 404);
  const path = videoPath(teacherId, jobId);
  const { data: files } = await admin.storage.from(BUCKET).list(`${teacherId}/${jobId}`, { search: "video.mp4" });
  if (!files?.some((f: { name: string }) => f.name === "video.mp4")) return json({ error: "The video was not uploaded" }, 400);
  await admin.from("content_outputs").delete().eq("job_id", jobId).eq("format", "video");
  const { error } = await admin.from("content_outputs").insert({ job_id: jobId, format: "video", storage_path: path, status: "done" });
  if (error) return json({ error: "Could not save the video: " + error.message }, 500);
  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
  return json({ url: signed?.signedUrl ?? null });
}

/** The teacher's past jobs, in the same shape as a fresh generation, with new 1-hour download links. */
// deno-lint-ignore no-explicit-any
async function listHistory(admin: any, teacherId: string): Promise<Response> {
  const { data: jobs, error } = await admin
    .from("content_jobs")
    .select("id, prompt, subject, class_level, language, outputs, outline, status, error, created_at")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) return json({ error: error.message }, 500);
  const ids = (jobs ?? []).map((j: { id: string }) => j.id);
  if (ids.length === 0) return json({ jobs: [] });

  const { data: rows } = await admin.from("content_outputs").select("job_id, format, storage_path, status, error").in("job_id", ids);
  const paths = (rows ?? []).filter((r: { storage_path: string | null }) => r.storage_path).map((r: { storage_path: string }) => r.storage_path);
  const urlByPath = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }

  // Jobs that asked for a video but have no MP4 yet can still build it from the stored scene narration.
  const videoAssets = new Map<string, string[]>();
  for (const j of jobs ?? []) {
    if (!(j.outputs ?? []).includes("video")) continue;
    if ((rows ?? []).some((r: any) => r.job_id === j.id && r.format === "video" && r.storage_path)) continue;
    const sceneCount = (j.outline?.slides?.length ?? 0) + 1;
    const urls = sceneCount > 1 ? await sceneAudioUrls(admin, teacherId, j.id, sceneCount) : null;
    if (urls) videoAssets.set(j.id, urls);
  }

  return json({
    jobs: (jobs ?? []).map((j: any) => {
      const outline: Partial<Outline> = j.outline ?? {};
      // Keep the order the teacher asked for; a format with no row (old migration) is shown as failed.
      const outputs = (j.outputs ?? []).map((format: string) => {
        const row = (rows ?? []).find((r: any) => r.job_id === j.id && r.format === format);
        // Older text-only flash cards have no file; they are shown on the page instead.
        if (format === "flashcards" && !row?.storage_path) return { format, url: null, ...(row?.status === "failed" ? { error: row.error } : {}) };
        if (format === "video" && !row?.storage_path && videoAssets.has(j.id)) return { format, url: null, pending: true };
        const url = row?.storage_path ? urlByPath.get(row.storage_path) ?? null : null;
        return { format, url, ...(url ? {} : { error: row?.error ?? "Not available" }) };
      });
      return {
        job_id: j.id,
        created_at: j.created_at,
        status: j.status,
        error: j.error,
        prompt: j.prompt,
        subject: j.subject,
        class_level: j.class_level,
        language: j.language,
        title: outline.title ?? j.prompt.slice(0, 80),
        slides: outline.slides ?? [],
        flashcards: outline.flashcards ?? [],
        flowchart_mermaid: outline.flowchart_mermaid ?? null,
        flowchart_svg: flowchartSvg(outline),
        flashcards_svg: flashcardsSvg(outline),
        render: outline.render ?? { template: DEFAULT_THEME, rtl: false },
        subtitle: [j.subject, j.class_level].filter(Boolean).join(" · "),
        video_assets: videoAssets.has(j.id) ? { scene_audio_urls: videoAssets.get(j.id) } : null,
        outputs,
      };
    }),
  });
}

/** Delete one of the teacher's own jobs and its files. */
// deno-lint-ignore no-explicit-any
async function deleteJob(admin: any, teacherId: string, jobId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "Invalid job id" }, 400);
  const { data: job } = await admin.from("content_jobs").select("id").eq("id", jobId).eq("teacher_id", teacherId).maybeSingle();
  if (!job) return json({ error: "Not found" }, 404);
  const folder = `${teacherId}/${jobId}`;
  const { data: files } = await admin.storage.from(BUCKET).list(folder);
  if (files?.length) await admin.storage.from(BUCKET).remove(files.map((f: { name: string }) => `${folder}/${f.name}`));
  const { error } = await admin.from("content_jobs").delete().eq("id", jobId);
  if (error) return json({ error: error.message }, 500);
  return json({ deleted: jobId });
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

    const body = await req.json();

    // History / delete: same route, chosen with body.op. Uses the service role but always filters by teacherId.
    if (body.op === "history") return await listHistory(createClient(supabaseUrl, serviceKey), teacherId);
    if (body.op === "delete") return await deleteJob(createClient(supabaseUrl, serviceKey), teacherId, String(body.job_id ?? ""));
    if (body.op === "video_upload") return await videoUploadSlot(createClient(supabaseUrl, serviceKey), teacherId, String(body.job_id ?? ""));
    if (body.op === "video_done") return await videoDone(createClient(supabaseUrl, serviceKey), teacherId, String(body.job_id ?? ""));
    if (body.op === "video_scenes") return await videoScenes(createClient(supabaseUrl, serviceKey), teacherId, String(body.job_id ?? ""));

    // 2. Validate input.
    const prompt = String(body.prompt ?? "").trim();
    if (prompt.length < 5 || prompt.length > 1000) return json({ error: "Prompt should be between 5 and 1000 characters." }, 400);

    const outputs: OutputFormat[] = Array.isArray(body.outputs) ? body.outputs : [];
    const unsupported = outputs.filter((o) => !(SUPPORTED_OUTPUTS as readonly string[]).includes(o));
    if (unsupported.length) return json({ error: `Not supported yet: ${unsupported.join(", ")}` }, 400);
    if (outputs.length === 0) return json({ error: "Select at least one output." }, 400);
    const ttsKey = Deno.env.get("GOOGLE_TTS_API_KEY");
    const wantsVoice = outputs.includes("audio") || outputs.includes("video");
    if (wantsVoice && !ttsKey) return json({ error: "Audio is not configured (GOOGLE_TTS_API_KEY missing)." }, 500);

    const slideCount = Math.min(Math.max(Number(body.slide_count) || 8, 3), 12);
    const subject = String(body.subject ?? "").slice(0, 100);
    const classLevel = String(body.class_level ?? "").slice(0, 50);
    const language = String(body.language ?? "en").slice(0, 20);
    const template = typeof body.template === "string" && body.template in THEMES ? body.template : DEFAULT_THEME;
    const isRtl = /arab|عرب|^ar$/i.test(language);
    const videoStyle: "explainer" | "slides" = body.video_style === "slides" ? "slides" : "explainer";

    const admin = createClient(supabaseUrl, serviceKey);

    // 3. Simple daily quota per teacher.
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count } = await admin
      .from("content_jobs")
      .select("id", { count: "exact", head: true })
      .eq("teacher_id", teacherId)
      .neq("status", "failed") // a failed try (e.g. AI timeout) should not use up the teacher's daily quota
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
        maxOutputTokens: wantsVoice ? 16384 : 8192,
        // Leave room for rendering + text-to-speech inside the edge function's wall-clock limit.
        timeoutMs: 95_000,
        // A model that hangs gives way to the next one instead of failing the whole request.
        attemptTimeoutMs: 50_000,
      });
      outline = parseOutline(text, { outputs, slide_count: slideCount });
      outline.render = { template, rtl: isRtl, ...(outputs.includes("video") ? { video_style: videoStyle } : {}) };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/timed out|rate limited/i.test(message)) {
        return await fail("The AI is busy right now and did not answer in time. Please try again in a minute (fewer slides is faster).", 503);
      }
      return await fail(message);
    }

    await admin.from("content_jobs").update({ outline, status: "rendering", updated_at: new Date().toISOString() }).eq("id", job.id);

    // 6. Narrate once (one MP3 per scene) for both the audio file and the video.
    let sceneAudio: Uint8Array[] | null = null;
    let ttsError = "";
    if (wantsVoice) {
      try {
        sceneAudio = await synthesizeSections(ttsKey!, narrationSections(outline), language, { timeoutMs: 25_000 });
      } catch (e) {
        ttsError = e instanceof Error ? e.message : String(e);
      }
    }
    let videoAssets: { scene_audio_urls: string[] } | null = null;

    // 7. Render each requested file. A failure in one output does not stop the others.
    const results: { format: string; url: string | null; error?: string; pending?: boolean }[] = [];
    for (const format of outputs) {
      if (format === "video") {
        // The browser builds the MP4 from these; the content_outputs row is added by op "video_done".
        try {
          if (!sceneAudio) throw new Error(ttsError || "Narration failed");
          await Promise.all(sceneAudio.map(async (bytes, i) => {
            const { error: upErr } = await admin.storage.from(BUCKET)
              .upload(scenePath(teacherId, job.id, i), bytes, { contentType: "audio/mpeg", upsert: true });
            if (upErr) throw new Error(upErr.message);
          }));
          const urls = await sceneAudioUrls(admin, teacherId, job.id, sceneAudio.length);
          if (!urls) throw new Error("Could not prepare the narration for the video");
          videoAssets = { scene_audio_urls: urls };
          results.push({ format, url: null, pending: true });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await admin.from("content_outputs").insert({ job_id: job.id, format, status: "failed", error: message });
          results.push({ format, url: null, error: message });
        }
        continue;
      }
      if (format === "flashcards" && !flashcardsSvg(outline)) {
        // No pictures came back: the cards still show on the page from the outline JSON.
        results.push({ format, url: null });
        await admin.from("content_outputs").insert({ job_id: job.id, format, status: "done" });
        continue;
      }
      try {
        let bytes: Uint8Array;
        let path: string;
        let contentType: string;
        if (format === "flashcards") {
          bytes = new TextEncoder().encode(flashcardsSvg(outline)!);
          path = `${teacherId}/${job.id}/flashcards.svg`;
          contentType = "image/svg+xml";
        } else if (format === "pptx") {
          bytes = await buildPptx(outline, template, [subject, classLevel].filter(Boolean).join(" · "), isRtl);
          path = `${teacherId}/${job.id}/presentation.pptx`;
          contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        } else if (format === "audio") {
          if (!sceneAudio) throw new Error(ttsError || "Narration failed");
          bytes = concatBytes(sceneAudio);
          path = `${teacherId}/${job.id}/narration.mp3`;
          contentType = "audio/mpeg";
        } else {
          bytes = new TextEncoder().encode(flowchartSvg(outline) ?? "");
          path = `${teacherId}/${job.id}/flowchart.svg`;
          contentType = "image/svg+xml";
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
      flowchart_mermaid: null,
      flowchart_svg: flowchartSvg(outline),
      flashcards_svg: flashcardsSvg(outline),
      render: outline.render,
      subtitle: [subject, classLevel].filter(Boolean).join(" · "),
      video_assets: videoAssets,
      outputs: results,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
