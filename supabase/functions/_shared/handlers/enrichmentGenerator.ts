// supabase/functions/_shared/handlers/enrichmentGenerator.ts
//
// Enrichment Content Generator. Never a standalone edge function (Edge Function deployment limit):
// `generate-item-bank` routes to it via action "enrichment" - see _shared/mergedRouter.ts.
//
// Generates a "beyond the textbook" pack for high-performing students: a deeper look at the
// ideas, hard challenge problems with worked solutions, open "what if" questions, real-world
// links and a small project. Packs are about a curriculum scope, not a person, so they are
// cached per (scope, language) in `enrichment_packs` and shared by every eligible student.
//
//   Body: {
//     scope_type: "chapter" | "topic" | "subtopic"
//     scope_id:   number
//     language?:  "en" | "hi" | "te" | "ta" | "kn" | "ml" | "mr" | "bn"   default "en"
//     refresh?:   boolean   staff only - regenerate and overwrite the cached pack
//   }
//
//   Response (HTTP 200 in both cases):
//     { eligible: true,  avg_mastery, pack: { id, title, language, content, cached, created_at } }
//     { eligible: false, avg_mastery, required, attempted_objectives, needed_objectives, message }
//
// ELIGIBILITY (students only; staff skip the gate so they can preview / pre-generate)
//   Average BKT p_mastery across the objectives in scope the student has actually attempted
//   (same definition adaptive homework uses for its mastery bands) must reach
//   ENRICHMENT_MIN_MASTERY, over at least MIN_ATTEMPTED_OBJECTIVES objectives (or every
//   objective, if the scope has fewer). Tune the constants below.
//
// ACCURACY NOTE
//   Challenge solutions are model-written. The prompt asks the model to work each problem
//   through before answering and the UI labels packs as AI-generated, but unlike question_bank
//   drafts there is no teacher-approval step. Use `refresh` (staff) to regenerate a weak pack.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { languageDirective, normaliseLanguageCode, resolveTeachingLanguage } from "../languages.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];
const MODEL = "google/gemini-2.5-flash";
const AI_URL = Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_TIMEOUT_MS = 90_000;

const ENRICHMENT_MIN_MASTERY = 0.8;
const MIN_ATTEMPTED_OBJECTIVES = 2;
const MAX_OBJECTIVES_IN_PROMPT = 40;

type ScopeType = "chapter" | "topic" | "subtopic";
const SCOPE_TYPES: ScopeType[] = ["chapter", "topic", "subtopic"];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export async function handleEnrichmentGenerator(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new HttpError(401, "Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userError } = await asCaller.auth.getUser();
    if (userError || !user) throw new HttpError(401, "Not authenticated");

    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!profile) throw new HttpError(403, "Profile not found");

    const isStaff = STAFF_ROLES.includes(profile.role);
    const isStudent = profile.role === "student";
    if (!isStaff && !isStudent) throw new HttpError(403, "Not permitted");

    let ownStudentId: string | null = null;
    if (isStudent) {
      const { data: s } = await admin.from("students").select("id").eq("profile_id", user.id).single();
      ownStudentId = s?.id ?? null;
      if (!ownStudentId) throw new HttpError(403, "Student record not found");
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const body = await req.json().catch(() => ({}));
    const scopeType = String(body.scope_type ?? "") as ScopeType;
    const scopeId = Number(body.scope_id);
    if (!SCOPE_TYPES.includes(scopeType) || !Number.isFinite(scopeId) || scopeId <= 0) {
      throw new HttpError(400, "scope_type (chapter | topic | subtopic) and a numeric scope_id are required");
    }
    const lang = resolveTeachingLanguage(body.language);
    const langCode = normaliseLanguageCode(body.language);
    const refresh = body.refresh === true && isStaff;

    // ── Resolve the curriculum scope ────────────────────────────────────────
    const scope = await resolveScope(admin, scopeType, scopeId);

    // ── Eligibility gate (students) ─────────────────────────────────────────
    let avgMastery: number | null = null;
    if (isStudent && ownStudentId) {
      const { data: rows, error: mErr } = await admin
        .from("student_mastery_labeled")
        .select("learning_objective_id, p_mastery, opportunities_count")
        .eq("student_id", ownStudentId)
        .in("learning_objective_id", scope.objectives.map((o) => o.id));
      if (mErr) throw new HttpError(500, mErr.message);

      const attempted = (rows ?? []).filter((r: Row) => Number(r.opportunities_count) > 0);
      const needed = Math.min(MIN_ATTEMPTED_OBJECTIVES, scope.objectives.length);
      avgMastery = attempted.length
        ? Math.round((attempted.reduce((a: number, r: Row) => a + Number(r.p_mastery), 0) / attempted.length) * 1000) / 1000
        : null;

      if (attempted.length < needed || avgMastery === null || avgMastery < ENRICHMENT_MIN_MASTERY) {
        return json({
          eligible: false,
          avg_mastery: avgMastery,
          required: ENRICHMENT_MIN_MASTERY,
          attempted_objectives: attempted.length,
          needed_objectives: needed,
          message: attempted.length < needed
            ? "Practise a few more concepts in this chapter first - enrichment unlocks once you've shown strong mastery."
            : "Enrichment unlocks when your mastery of this chapter is high. Keep practising and come back soon!",
        });
      }
    }

    // ── Cache lookup (a missing table must not break generation) ────────────
    let cacheUsable = true;
    if (!refresh) {
      const { data: cached, error: cErr } = await admin
        .from("enrichment_packs")
        .select("id, title, language, content, created_at")
        .eq("scope_type", scopeType).eq("scope_id", scopeId).eq("language", langCode)
        .maybeSingle();
      if (cErr) {
        cacheUsable = false;
        console.warn("enrichment_packs read failed (migration applied?):", cErr.message);
      } else if (cached) {
        return json({ eligible: true, avg_mastery: avgMastery, pack: { ...cached, cached: true } });
      }
    }

    // ── Generate ────────────────────────────────────────────────────────────
    const raw = await callModel(apiKey, buildPrompt(scope, lang));
    const content = cleanPack(raw);
    if (!content) throw new HttpError(502, "The AI returned an unusable enrichment pack. Please try again.");

    // ── Persist ─────────────────────────────────────────────────────────────
    let saved: Row | null = null;
    if (cacheUsable) {
      const row = {
        scope_type: scopeType, scope_id: scopeId, language: langCode,
        title: content.title, content, model: MODEL, created_by: user.id,
      };
      const table = admin.from("enrichment_packs");
      const write = refresh ? table.upsert(row, { onConflict: "scope_type,scope_id,language" }) : table.insert(row);
      const { data, error } = await write.select("id, title, language, content, created_at").single();
      if (!error) {
        saved = data;
      } else if (error.code === "23505") {
        // Another request generated the same pack first - serve theirs so everyone sees one version.
        const { data: winner } = await admin
          .from("enrichment_packs").select("id, title, language, content, created_at")
          .eq("scope_type", scopeType).eq("scope_id", scopeId).eq("language", langCode).maybeSingle();
        saved = winner ?? null;
      } else {
        console.warn("enrichment_packs write failed:", error.message);
      }
    }

    const pack = saved
      ? { ...saved, cached: false }
      : { id: null, title: content.title, language: langCode, content, cached: false, created_at: new Date().toISOString() };
    return json({ eligible: true, avg_mastery: avgMastery, pack });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error("enrichment error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}

// ── Scope resolution ─────────────────────────────────────────────────────────
interface Scope {
  subject: string;
  className: string;
  curriculum: string;
  chapter: string;
  outline: Array<{ topic: string; concepts: Array<{ name: string; description: string; objectives: string[] }> }>;
  objectives: Array<{ id: number; text: string }>;
}

async function resolveScope(admin: ReturnType<typeof createClient>, scopeType: ScopeType, scopeId: number): Promise<Scope> {
  let topicIds: number[] = [];
  let subs: Row[] = [];

  if (scopeType === "chapter") {
    const { data } = await admin.from("topics").select("id").eq("chapter_id", scopeId);
    topicIds = (data ?? []).map((t: Row) => t.id);
    if (topicIds.length) {
      const r = await admin.from("subtopics").select("id, subtopic_name, subtopic_description, topic_id").in("topic_id", topicIds).order("id");
      subs = r.data ?? [];
    }
  } else if (scopeType === "topic") {
    topicIds = [scopeId];
    const r = await admin.from("subtopics").select("id, subtopic_name, subtopic_description, topic_id").eq("topic_id", scopeId).order("id");
    subs = r.data ?? [];
  } else {
    const r = await admin.from("subtopics").select("id, subtopic_name, subtopic_description, topic_id").eq("id", scopeId);
    subs = r.data ?? [];
    topicIds = [...new Set(subs.map((s) => s.topic_id as number))];
  }
  if (!subs.length) throw new HttpError(404, "No concepts found for that chapter/topic yet.", "empty_scope");

  const { data: los } = await admin
    .from("learning_objectives").select("id, subtopic_id, objective_text")
    .in("subtopic_id", subs.map((s) => s.id)).eq("status", "active").order("id");
  if (!los?.length) throw new HttpError(404, "No learning objectives exist for this scope yet.", "empty_scope");

  const { data: topics } = await admin.from("topics").select("id, topic_name, chapter_id").in("id", topicIds);
  const chapterIds = [...new Set((topics ?? []).map((t: Row) => t.chapter_id))];
  const { data: chapters } = await admin.from("curriculum_chapters").select("id, chapter_name, unit_id").in("id", chapterIds);
  const unitIds = [...new Set((chapters ?? []).map((c: Row) => c.unit_id))];
  const { data: units } = await admin.from("units").select("id, book_id").in("id", unitIds);
  const { data: books } = await admin
    .from("books").select("id, subject, class_name, curriculum").in("id", [...new Set((units ?? []).map((u: Row) => u.book_id))]);

  const book = books?.[0];
  const outline = (topics ?? []).map((t: Row) => ({
    topic: t.topic_name as string,
    concepts: subs.filter((s) => s.topic_id === t.id).map((s) => ({
      name: s.subtopic_name as string,
      description: (s.subtopic_description ?? "") as string,
      objectives: los.filter((l: Row) => l.subtopic_id === s.id).map((l: Row) => l.objective_text as string),
    })),
  })).filter((t) => t.concepts.length);

  return {
    subject: book?.subject ?? "the subject",
    className: book?.class_name ?? "",
    curriculum: book?.curriculum ?? "",
    chapter: (chapters ?? []).map((c: Row) => c.chapter_name).join("; "),
    outline,
    objectives: los.map((l: Row) => ({ id: l.id as number, text: l.objective_text as string })),
  };
}

// ── Prompt + model call ──────────────────────────────────────────────────────
function buildPrompt(scope: Scope, lang: ReturnType<typeof resolveTeachingLanguage>): string {
  let budget = MAX_OBJECTIVES_IN_PROMPT;
  const outline = scope.outline.map((t) => {
    const concepts = t.concepts.map((c) => {
      const objs = c.objectives.slice(0, Math.max(0, budget));
      budget -= objs.length;
      return `  - ${c.name}${c.description ? `: ${c.description}` : ""}${objs.length ? `\n${objs.map((o) => `      * ${o}`).join("\n")}` : ""}`;
    }).join("\n");
    return `Topic: ${t.topic}\n${concepts}`;
  }).join("\n");

  return `You are an expert teacher writing an ENRICHMENT pack for a student who has already mastered this material and is ready for more.

Subject: ${scope.subject}
Class: ${scope.className || "not specified"}
Curriculum: ${scope.curriculum || "not specified"}
Chapter: ${scope.chapter}

What the student has already learned (do NOT re-teach this; go beyond it):
${outline}

Write material that is ONE STEP beyond this class level - challenging and curious, but still reachable for a strong student of this class. It must not drift into college-level content.

Requirements:
- Every challenge problem must be solvable with the stated knowledge plus the ideas you introduce. Work each problem through step by step BEFORE writing it, and make sure the final answer in "worked_solution" is correct and consistent with the problem.
- Do not invent facts, statistics, names, quotations, books or links. If unsure of a fact, leave it out.
- Keep it engaging and age-appropriate. No "all of the above" style filler.${languageDirective(lang)}

Return STRICT JSON ONLY (no markdown fences, no commentary) with exactly this shape:
{
  "title": "short, inspiring title",
  "tagline": "one sentence hook",
  "why_it_matters": "2-3 sentences on why going deeper here is worthwhile",
  "deep_dive": [ { "heading": "...", "explanation": "a clear 80-150 word explanation going beyond the textbook", "key_takeaway": "one sentence" } ],
  "challenge_problems": [ { "question": "...", "hint": "a nudge that does not give the answer away", "worked_solution": "step-by-step solution ending in the final answer", "level": "hard" | "stretch" } ],
  "think_about_it": [ "open-ended 'what if / why' question" ],
  "real_world_connections": [ "a concrete, accurate real-world link" ],
  "project": { "title": "...", "description": "a small hands-on investigation or build a student can do at home with ordinary materials" },
  "key_terms": [ { "term": "...", "meaning": "simple definition" } ]
}
Counts: deep_dive 2-4 items, challenge_problems 3-4 items, think_about_it 2-3, real_world_connections 2-3, key_terms 3-6.`;
}

async function callModel(apiKey: string, prompt: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const resp = await fetch(AI_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "You output strict JSON only. No markdown, no commentary." },
          { role: "user", content: prompt },
        ],
        temperature: 0.6,
      }),
    });
    if (resp.status === 429) throw new HttpError(429, "AI is busy right now. Please try again in a moment.");
    if (resp.status === 402) throw new HttpError(402, "AI credits exhausted. Please contact your administrator.");
    if (!resp.ok) throw new Error(`AI gateway error ${resp.status}: ${(await resp.text()).slice(0, 300)}`);

    const data = await resp.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "{}";
    const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new HttpError(502, "Could not parse the AI response. Please try again.");
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new HttpError(504, "The AI took too long. Please try again.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Validation: never trust model output shape ───────────────────────────────
export interface EnrichmentContent {
  title: string;
  tagline: string | null;
  why_it_matters: string | null;
  deep_dive: Array<{ heading: string; explanation: string; key_takeaway: string | null }>;
  challenge_problems: Array<{ question: string; hint: string | null; worked_solution: string; level: "hard" | "stretch" }>;
  think_about_it: string[];
  real_world_connections: string[];
  project: { title: string; description: string } | null;
  key_terms: Array<{ term: string; meaning: string }>;
}

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

const arr = (v: unknown, max: number): Row[] => (Array.isArray(v) ? v.slice(0, max) : []);

function cleanPack(raw: unknown): EnrichmentContent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Row;

  const title = str(r.title, 160);
  const deep_dive = arr(r.deep_dive, 4).flatMap((d) => {
    const heading = str(d?.heading, 160), explanation = str(d?.explanation, 2000);
    return heading && explanation ? [{ heading, explanation, key_takeaway: str(d?.key_takeaway, 300) }] : [];
  });
  const challenge_problems = arr(r.challenge_problems, 4).flatMap((c) => {
    const question = str(c?.question, 1200), worked_solution = str(c?.worked_solution, 3000);
    return question && worked_solution
      ? [{ question, hint: str(c?.hint, 500), worked_solution, level: c?.level === "stretch" ? "stretch" as const : "hard" as const }]
      : [];
  });
  // A pack with no teaching content or no problems isn't worth caching and showing to students.
  if (!title || !deep_dive.length || !challenge_problems.length) return null;

  const strings = (v: unknown, n: number) =>
    (Array.isArray(v) ? v : []).map((x) => str(x, 600)).filter((x): x is string => !!x).slice(0, n);

  const p = r.project as Row | undefined;
  const projTitle = str(p?.title, 160), projDesc = str(p?.description, 1500);

  return {
    title,
    tagline: str(r.tagline, 240),
    why_it_matters: str(r.why_it_matters, 800),
    deep_dive,
    challenge_problems,
    think_about_it: strings(r.think_about_it, 3),
    real_world_connections: strings(r.real_world_connections, 3),
    project: projTitle && projDesc ? { title: projTitle, description: projDesc } : null,
    key_terms: arr(r.key_terms, 6).flatMap((k) => {
      const term = str(k?.term, 80), meaning = str(k?.meaning, 300);
      return term && meaning ? [{ term, meaning }] : [];
    }),
  };
}
