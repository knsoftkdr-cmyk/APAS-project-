// supabase/functions/generate-item-bank/index.ts
//
// Deploy with:
//   supabase functions deploy generate-item-bank
//
// Staff only. Authors persistent, learning-objective-tagged MCQs for the
// adaptive-testing item bank (question_bank).
//
//   Body: {
//     subtopic_id? | topic_id? | learning_objective_id?   (one is required)
//     target_per_objective?: number   default 8, max 12  - "top up" to this many
//                                      non-retired items per objective, so
//                                      re-running never double-generates
//     auto_activate?: boolean         default false - items land as "draft"
//                                      until a teacher approves them
//   }
//
// Why items start as drafts: an AI-written MCQ occasionally has a wrong key
// or two defensible answers, and a mis-keyed item actively teaches students
// the wrong thing. Drafts never reach students. (calibrate-irt later flags
// items whose answer pattern looks mis-keyed as a second safety net.)
//
// Each item ships with a COLD-START difficulty prior (b_prior) derived from
// the model's difficulty target and the objective's Bloom level; real
// difficulty replaces it once enough students have answered (calibrate-irt).
//
// Distractors are tied to the concept's known misconceptions
// (concept_misconceptions) where they apply, so a wrong answer can later
// report *which* misconception the student likely holds.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { priorDifficulty } from "../_shared/irt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];
const MODEL = "google/gemini-2.5-flash";
const AI_URL = Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_OBJECTIVES_PER_CALL = 24;
const CONCURRENCY = 4;
const LETTERS = ["A", "B", "C", "D"] as const;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface RawItem {
  stem?: unknown;
  options?: unknown;
  correct?: unknown;
  explanation?: unknown;
  difficulty_target?: unknown;
  distractor_misconceptions?: unknown;
}

interface CleanItem {
  stem: string;
  options: Record<string, string>;
  correct: string;
  explanation: string | null;
  difficulty: "easy" | "medium" | "hard";
  distractorMisconceptions: Record<string, number>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userError } = await asCaller.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) return json({ error: "Not permitted to author questions" }, 403);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const body = await req.json().catch(() => ({}));
    const { subtopic_id, topic_id, learning_objective_id } = body;
    if (!subtopic_id && !topic_id && !learning_objective_id) {
      return json({ error: "subtopic_id, topic_id or learning_objective_id is required" }, 400);
    }
    const target = Math.min(12, Math.max(2, Math.round(Number(body.target_per_objective ?? 8)) || 8));
    const autoActivate = body.auto_activate === true;

    // ── Resolve objectives + their curriculum context ─────────────────────
    let loQuery = admin.from("learning_objectives")
      .select("id, subtopic_id, objective_text, bloom_level, difficulty").eq("status", "active");
    if (learning_objective_id) {
      loQuery = loQuery.eq("id", learning_objective_id);
    } else if (subtopic_id) {
      loQuery = loQuery.eq("subtopic_id", subtopic_id);
    } else {
      const { data: subs } = await admin.from("subtopics").select("id").eq("topic_id", topic_id);
      const ids = (subs ?? []).map((s: Row) => s.id);
      if (!ids.length) return json({ error: "That topic has no concepts yet" }, 404);
      loQuery = loQuery.in("subtopic_id", ids);
    }
    const { data: los, error: loErr } = await loQuery.order("id");
    if (loErr) throw new Error(loErr.message);
    if (!los?.length) {
      return json({ error: "No learning objectives found. Generate objectives for this concept first (Class Mastery page)." }, 404);
    }

    const contexts = await loadContext(admin, los as Row[]);

    // Existing (non-retired) counts per objective -> how many to add.
    const { data: existing } = await admin.from("question_bank")
      .select("learning_objective_id").in("learning_objective_id", (los as Row[]).map((l) => l.id)).neq("status", "retired");
    const have = new Map<number, number>();
    for (const r of existing ?? []) have.set(r.learning_objective_id, (have.get(r.learning_objective_id) ?? 0) + 1);

    const work = (los as Row[])
      .map((lo) => ({ lo, need: Math.max(0, target - (have.get(lo.id) ?? 0)) }))
      .filter((w) => w.need > 0);
    const batch = work.slice(0, MAX_OBJECTIVES_PER_CALL);
    const remaining = work.length - batch.length;

    // ── Generate with bounded concurrency ────────────────────────────────
    const perObjective: Row[] = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
      while (cursor < batch.length) {
        const { lo, need } = batch[cursor++];
        try {
          perObjective.push(await generateForObjective({ admin, apiKey, userId: user.id, lo, need, ctx: contexts.get(lo.subtopic_id)!, autoActivate }));
        } catch (e) {
          perObjective.push({ learning_objective_id: lo.id, requested: need, inserted: 0, error: e instanceof Error ? e.message : String(e) });
        }
      }
    });
    await Promise.all(workers);

    const inserted = perObjective.reduce((s, r) => s + (r.inserted ?? 0), 0);
    return json({
      inserted,
      status_of_new_items: autoActivate ? "active" : "draft",
      objectives_processed: batch.length,
      objectives_already_full: (los as Row[]).length - work.length,
      remaining_objectives: remaining,
      per_objective: perObjective.sort((a, b) => a.learning_objective_id - b.learning_objective_id),
    });
  } catch (e) {
    console.error("generate-item-bank error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────

interface Ctx {
  subject: string; className: string; curriculum: string;
  chapter: string; topic: string; concept: string; conceptDescription: string;
  misconceptions: { id: number; text: string }[];
}

async function loadContext(admin: ReturnType<typeof createClient>, los: Row[]): Promise<Map<number, Ctx>> {
  const subIds = [...new Set(los.map((l) => l.subtopic_id as number))];
  const { data: subs } = await admin.from("subtopics").select("id, subtopic_name, subtopic_description, topic_id").in("id", subIds);
  const topicIds = [...new Set((subs ?? []).map((s: Row) => s.topic_id))];
  const { data: topics } = await admin.from("topics").select("id, topic_name, chapter_id").in("id", topicIds);
  const chapterIds = [...new Set((topics ?? []).map((t: Row) => t.chapter_id))];
  const { data: chapters } = await admin.from("curriculum_chapters").select("id, chapter_name, unit_id").in("id", chapterIds);
  const unitIds = [...new Set((chapters ?? []).map((c: Row) => c.unit_id))];
  const { data: units } = await admin.from("units").select("id, book_id").in("id", unitIds);
  const bookIds = [...new Set((units ?? []).map((u: Row) => u.book_id))];
  const { data: books } = await admin.from("books").select("id, subject, class_name, curriculum").in("id", bookIds);
  const { data: mcs } = await admin.from("concept_misconceptions").select("id, subtopic_id, misconception_text").in("subtopic_id", subIds);

  const by = <T extends Row>(rows: T[] | null) => new Map((rows ?? []).map((r) => [r.id, r]));
  const T = by(topics), C = by(chapters), U = by(units), B = by(books);

  const out = new Map<number, Ctx>();
  for (const s of subs ?? []) {
    const topic = T.get(s.topic_id), chapter = topic && C.get(topic.chapter_id);
    const unit = chapter && U.get(chapter.unit_id), book = unit && B.get(unit.book_id);
    out.set(s.id, {
      subject: book?.subject ?? "the subject", className: book?.class_name ?? "", curriculum: book?.curriculum ?? "",
      chapter: chapter?.chapter_name ?? "", topic: topic?.topic_name ?? "", concept: s.subtopic_name,
      conceptDescription: s.subtopic_description ?? "",
      misconceptions: (mcs ?? []).filter((m: Row) => m.subtopic_id === s.id).map((m: Row) => ({ id: m.id, text: m.misconception_text })),
    });
  }
  return out;
}

async function generateForObjective(a: {
  admin: ReturnType<typeof createClient>; apiKey: string; userId: string;
  lo: Row; need: number; ctx: Ctx; autoActivate: boolean;
}): Promise<Row> {
  const { admin, lo, need, ctx } = a;
  const raw = await callModel(a.apiKey, buildPrompt(lo, need, ctx));

  const seenStems = new Set<string>();
  const clean: CleanItem[] = [];
  let rejected = 0;
  const validMcIds = new Set(ctx.misconceptions.map((m) => m.id));
  for (const r of raw) {
    const c = cleanItem(r, validMcIds);
    if (!c || seenStems.has(c.stem.toLowerCase())) { rejected++; continue; }
    seenStems.add(c.stem.toLowerCase());
    clean.push(c);
    if (clean.length >= need) break;
  }

  let inserted = 0, duplicates = 0;
  for (const c of clean) {
    const shuffled = shuffleOptions(c);
    const b0 = priorDifficulty(c.difficulty, lo.bloom_level);
    const { error } = await admin.from("question_bank").insert({
      learning_objective_id: lo.id,
      subtopic_id: lo.subtopic_id, // trigger re-derives this; supplied to satisfy NOT NULL
      stem: c.stem,
      options: shuffled.options,
      correct_option: shuffled.correct,
      explanation: c.explanation,
      distractor_misconceptions: shuffled.distractorMisconceptions,
      bloom_level: lo.bloom_level,
      status: a.autoActivate ? "active" : "draft",
      irt_a: 1, irt_b: b0, irt_c: 0.25, b_prior: b0,
      calibration_status: "prior",
      ai_generated: true, generation_model: MODEL, created_by: a.userId,
    });
    if (!error) inserted++;
    else if (error.code === "23505") duplicates++;
    else throw new Error(`insert failed: ${error.message}`);
  }
  return { learning_objective_id: lo.id, requested: need, inserted, rejected_invalid: rejected, skipped_duplicates: duplicates };
}

function buildPrompt(lo: Row, n: number, ctx: Ctx): string {
  const mcBlock = ctx.misconceptions.length
    ? `Known misconceptions for this concept (use their numeric id in "distractor_misconceptions" when a distractor is built to catch one):\n${ctx.misconceptions.map((m) => `  ${m.id}: ${m.text}`).join("\n")}`
    : "No catalogued misconceptions - still make every distractor a plausible, common student error.";
  const easy = Math.max(1, Math.round(n * 0.25)), hard = Math.max(1, Math.round(n * 0.25)), med = Math.max(0, n - easy - hard);

  return `You are an expert assessment writer creating multiple-choice items for an adaptive test.

Subject: ${ctx.subject}${ctx.className ? ` (Class ${ctx.className})` : ""}${ctx.curriculum ? `, ${ctx.curriculum}` : ""}
Chapter: ${ctx.chapter}
Topic: ${ctx.topic}
Concept: ${ctx.concept}${ctx.conceptDescription ? `\nConcept description: ${ctx.conceptDescription}` : ""}
Learning objective to assess: ${lo.objective_text}
Bloom level: ${lo.bloom_level ?? "apply"}   Declared difficulty: ${lo.difficulty ?? "medium"}

${mcBlock}

Write exactly ${n} DISTINCT questions that each assess THIS learning objective (not the wider topic).
Spread difficulty for a typical student of this class: about ${easy} easy, ${med} medium, ${hard} hard.

Rules:
- Exactly 4 options labelled A, B, C, D; exactly ONE is unambiguously correct.
- Each stem must be fully self-contained (no "as shown above").
- Distractors must be plausible errors a student would really make - never obviously silly.
- Do NOT use "all of the above", "none of the above" or "both A and B".
- Keep options similar in length so the answer isn't given away by length.
- The explanation must justify the correct answer in 1-2 sentences.

Return ONLY a JSON array, no prose, no markdown fences:
[{"stem":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A|B|C|D","explanation":"...","difficulty_target":"easy|medium|hard","distractor_misconceptions":{"<letter of a distractor>":<misconception id or null>}}]`;
}

async function callModel(apiKey: string, prompt: string): Promise<RawItem[]> {
  const resp = await fetch(AI_URL, {
    method: "POST",
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
  if (!resp.ok) throw new Error(`AI gateway error ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "[]";
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Could not parse AI response as JSON: ${cleaned.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("AI response was not a JSON array");
  return parsed as RawItem[];
}

const BANNED_OPTION = /\b(all|none)\s+of\s+the\s+above\b|\bboth\s+[a-d]\s+and\s+[a-d]\b/i;

function cleanItem(r: RawItem, validMcIds: Set<number>): CleanItem | null {
  const stem = typeof r.stem === "string" ? r.stem.trim() : "";
  if (stem.length < 8 || stem.length > 800) return null;

  const opts = r.options as Record<string, unknown> | undefined;
  if (!opts || typeof opts !== "object") return null;
  const options: Record<string, string> = {};
  for (const L of LETTERS) {
    const v = opts[L];
    if (typeof v !== "string" || !v.trim() || v.length > 400) return null;
    if (BANNED_OPTION.test(v)) return null;
    options[L] = v.trim();
  }
  if (Object.keys(opts).length !== 4) return null;
  if (new Set(Object.values(options).map((v) => v.toLowerCase())).size !== 4) return null;

  const correct = typeof r.correct === "string" ? r.correct.trim().toUpperCase() : "";
  if (!LETTERS.includes(correct as typeof LETTERS[number])) return null;

  const dt = String(r.difficulty_target ?? "medium").toLowerCase();
  const difficulty = (["easy", "medium", "hard"].includes(dt) ? dt : "medium") as CleanItem["difficulty"];

  const dm: Record<string, number> = {};
  if (r.distractor_misconceptions && typeof r.distractor_misconceptions === "object") {
    for (const [k, v] of Object.entries(r.distractor_misconceptions as Record<string, unknown>)) {
      const letter = k.toUpperCase();
      const id = Number(v);
      if (LETTERS.includes(letter as typeof LETTERS[number]) && letter !== correct && Number.isFinite(id) && validMcIds.has(id)) dm[letter] = id;
    }
  }

  const explanation = typeof r.explanation === "string" && r.explanation.trim() ? r.explanation.trim() : null;
  return { stem, options, correct, explanation, difficulty, distractorMisconceptions: dm };
}

// Models over-produce "B" and "C" as the key. Re-deal the options with a
// cryptographic shuffle and remap the key + misconception tags to match.
function shuffleOptions(c: CleanItem) {
  const order = [...LETTERS];
  const rnd = new Uint32Array(order.length);
  crypto.getRandomValues(rnd);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const options: Record<string, string> = {};
  const distractorMisconceptions: Record<string, number> = {};
  let correct = "A";
  order.forEach((oldLetter, idx) => {
    const newLetter = LETTERS[idx];
    options[newLetter] = c.options[oldLetter];
    if (oldLetter === c.correct) correct = newLetter;
    if (c.distractorMisconceptions[oldLetter] != null) distractorMisconceptions[newLetter] = c.distractorMisconceptions[oldLetter];
  });
  return { options, correct, distractorMisconceptions };
}