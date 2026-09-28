// supabase/functions/score-question-quality/index.ts
//
// Deploy with:
//   supabase functions deploy score-question-quality
//
// Staff only. Has an AI read an already-authored item (MCQ from question_bank,
// or open-ended from question_bank_extended) and score it on four dimensions,
// BEFORE relying on real student response data:
//
//   - ambiguity            could a reasonable student defend a different answer,
//                          or is the stem/task missing information it needs?
//   - difficulty_match     does the item's actual difficulty match what it
//                          claims (bloom level / declared difficulty)?
//   - syllabus_alignment   does it truly test the stated learning objective /
//                          competency, not off-syllabus or off-target content?
//   - answer_validity      MCQ: is the marked key uniquely correct and every
//                          distractor unambiguously wrong? Open-ended: is the
//                          rubric internally consistent with the model answer
//                          and the marks it claims to add up to?
//
// This is a companion to, not a replacement for, calibrate-irt's statistical
// review_flag: that catches problems once students have answered; this catches
// problems by just reading the item, so it can run the moment a draft lands.
//
//   Body: {
//     item_table: "question_bank" | "question_bank_extended"
//     item_ids?: uuid[]                          -- score specific items
//     // ...or bulk-select unscored/stale items in a scope:
//     subtopic_id? | topic_id? | learning_objective_id?
//     status_filter?: ("draft"|"active")[]        default ["draft","active"]
//     rescore?: boolean                           default false - by default,
//                                                   items already quality-checked
//                                                   are skipped
//     limit?: number                              default 20, max 50
//     auto_suspend?: boolean                      default true - flips an
//                                                   ACTIVE item back to "draft"
//                                                   when the AI flags "reject"
//   }
//
// A "reject" from answer_validity_critical always wins regardless of the
// averaged score - a single unambiguously wrong key is worse than four
// mediocre-but-passable dimensions.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];
const MODEL = "google/gemini-2.5-flash";
const AI_URL = Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions";
const BATCH_SIZE = 8; // items per AI call
const CONCURRENCY = 3;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type ItemTable = "question_bank" | "question_bank_extended";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    if (!profile || !STAFF_ROLES.includes(profile.role)) return json({ error: "Not permitted to review questions" }, 403);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const body = await req.json().catch(() => ({}));
    const itemTable: ItemTable = body.item_table === "question_bank_extended" ? "question_bank_extended" : "question_bank";
    const statusFilter: string[] = Array.isArray(body.status_filter) && body.status_filter.length ? body.status_filter : ["draft", "active"];
    const rescore = body.rescore === true;
    const limit = Math.min(50, Math.max(1, Math.round(Number(body.limit ?? 20)) || 20));
    const autoSuspend = body.auto_suspend !== false;

    // ── Select items ──────────────────────────────────────────────────
    const items = await selectItems(admin, itemTable, body, statusFilter, rescore, limit);
    if (!items.length) return json({ scored: 0, message: "No matching items to score." });

    const contexts = itemTable === "question_bank"
      ? await loadMcqContext(admin, items)
      : await loadExtendedContext(admin, items);

    // ── Batch + score ─────────────────────────────────────────────────
    const batches: Row[][] = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) batches.push(items.slice(i, i + BATCH_SIZE));

    const results: Row[] = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      while (cursor < batches.length) {
        const batch = batches[cursor++];
        try {
          const graded = await scoreBatch(apiKey, itemTable, batch, contexts);
          for (const g of graded) {
            const item = batch.find((it) => it.id === g.id);
            if (!item) continue;
            results.push(await persist(admin, itemTable, item, g, user.id, autoSuspend));
          }
        } catch (e) {
          for (const item of batch) results.push({ id: item.id, error: e instanceof Error ? e.message : String(e) });
        }
      }
    });
    await Promise.all(workers);

    return json({
      scored: results.filter((r) => !r.error).length,
      failed: results.filter((r) => r.error).length,
      results,
    });
  } catch (e) {
    console.error("score-question-quality error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Item selection

async function selectItems(
  admin: ReturnType<typeof createClient>, itemTable: ItemTable, body: Row,
  statusFilter: string[], rescore: boolean, limit: number,
): Promise<Row[]> {
  if (Array.isArray(body.item_ids) && body.item_ids.length) {
    const cols = itemTable === "question_bank"
      ? "id, learning_objective_id, subtopic_id, stem, options, correct_option, explanation, bloom_level, status, quality_checked_at"
      : "id, learning_objective_id, competency_id, subtopic_id, question_type, stem, context_passage, sub_questions, rubric, model_answer, max_marks, difficulty, bloom_level, status, quality_checked_at";
    const { data } = await admin.from(itemTable).select(cols).in("id", body.item_ids);
    return (data ?? []) as Row[];
  }

  const { subtopic_id, topic_id, learning_objective_id } = body;
  let subtopicIds: number[] | null = null;
  if (subtopic_id) subtopicIds = [subtopic_id];
  else if (topic_id) {
    const { data: subs } = await admin.from("subtopics").select("id").eq("topic_id", topic_id);
    subtopicIds = (subs ?? []).map((s: Row) => s.id);
  }

  const cols = itemTable === "question_bank"
    ? "id, learning_objective_id, subtopic_id, stem, options, correct_option, explanation, bloom_level, status, quality_checked_at"
    : "id, learning_objective_id, competency_id, subtopic_id, question_type, stem, context_passage, sub_questions, rubric, model_answer, max_marks, difficulty, bloom_level, status, quality_checked_at";

  let q = admin.from(itemTable).select(cols).in("status", statusFilter).order("created_at", { ascending: true }).limit(limit);
  if (learning_objective_id) q = q.eq("learning_objective_id", learning_objective_id);
  else if (subtopicIds) q = q.in("subtopic_id", subtopicIds);
  if (!rescore) q = q.is("quality_checked_at", null);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

// ─────────────────────────────────────────────────────────────────────────
// Context loaders (subject/chapter/topic/concept, same shape as the generators)

interface Ctx {
  subject: string; className: string; chapter: string; topic: string;
  concept: string; conceptDescription: string;
}

async function loadMcqContext(admin: ReturnType<typeof createClient>, items: Row[]): Promise<Map<number, Ctx>> {
  return loadContextBySubtopic(admin, [...new Set(items.map((i) => i.subtopic_id).filter(Boolean))]);
}

async function loadExtendedContext(admin: ReturnType<typeof createClient>, items: Row[]): Promise<Map<number, Ctx>> {
  const subIds = [...new Set(items.map((i) => i.subtopic_id).filter(Boolean))];
  return loadContextBySubtopic(admin, subIds);
}

async function loadContextBySubtopic(admin: ReturnType<typeof createClient>, subIds: number[]): Promise<Map<number, Ctx>> {
  if (!subIds.length) return new Map();
  const { data: subs } = await admin.from("subtopics").select("id, subtopic_name, subtopic_description, topic_id").in("id", subIds);
  const topicIds = [...new Set((subs ?? []).map((s: Row) => s.topic_id))];
  const { data: topics } = await admin.from("topics").select("id, topic_name, chapter_id").in("id", topicIds);
  const chapterIds = [...new Set((topics ?? []).map((t: Row) => t.chapter_id))];
  const { data: chapters } = await admin.from("curriculum_chapters").select("id, chapter_name, unit_id").in("id", chapterIds);
  const unitIds = [...new Set((chapters ?? []).map((c: Row) => c.unit_id))];
  const { data: units } = await admin.from("units").select("id, book_id").in("id", unitIds);
  const bookIds = [...new Set((units ?? []).map((u: Row) => u.book_id))];
  const { data: books } = await admin.from("books").select("id, subject, class_name").in("id", bookIds);

  const by = <T extends Row>(rows: T[] | null) => new Map((rows ?? []).map((r) => [r.id, r]));
  const T = by(topics), C = by(chapters), U = by(units), B = by(books);

  const out = new Map<number, Ctx>();
  for (const s of subs ?? []) {
    const topic = T.get(s.topic_id), chapter = topic && C.get(topic.chapter_id);
    const unit = chapter && U.get(chapter.unit_id), book = unit && B.get(unit.book_id);
    out.set(s.id, {
      subject: book?.subject ?? "the subject", className: book?.class_name ?? "",
      chapter: chapter?.chapter_name ?? "", topic: topic?.topic_name ?? "",
      concept: s.subtopic_name, conceptDescription: s.subtopic_description ?? "",
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Scoring

interface Dimension { score: number; note: string }
interface Graded {
  id: string;
  ambiguity: Dimension;
  difficulty_match: Dimension;
  syllabus_alignment: Dimension;
  answer_validity: Dimension & { critical_issue: boolean };
  suggested_fix: string | null;
}

async function scoreBatch(apiKey: string, itemTable: ItemTable, batch: Row[], contexts: Map<number, Ctx>): Promise<Graded[]> {
  const prompt = itemTable === "question_bank"
    ? buildMcqPrompt(batch, contexts)
    : buildExtendedPrompt(batch, contexts);

  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "You are a strict assessment quality reviewer. You output strict JSON only. No markdown, no commentary." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
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
  return (parsed as Row[]).map(cleanGraded).filter((g): g is Graded => g !== null);
}

function dimensionBlock() {
  return `For EACH item, score four dimensions from 0 (severe problem) to 10 (no problem), each with a one-sentence note (empty string if no issue):

  - "ambiguity": Could a reasonable student defend a different answer than intended, or does the stem/task withhold information it needs?
  - "difficulty_match": Does the item's actual difficulty genuinely match what it claims (its bloom level / declared difficulty)?
  - "syllabus_alignment": Does it truly test the stated learning objective/concept - not something off-syllabus, off-topic, or too far outside it?
  - "answer_validity": Is the marked correct answer / rubric+model-answer actually, unambiguously correct and internally consistent? Set "critical_issue": true ONLY if you believe the marked key is wrong, multiple options are equally correct, or the rubric contradicts the model answer - i.e. a genuine authoring error, not a stylistic quibble.

If you found a real problem, put a one-sentence fix in "suggested_fix" (e.g. "correct option should be C, not B"); otherwise null.`;
}

function buildMcqPrompt(batch: Row[], contexts: Map<number, Ctx>): string {
  const blocks = batch.map((it) => {
    const ctx = contexts.get(it.subtopic_id);
    const opts = it.options as Record<string, string>;
    return `--- ITEM ${it.id} ---
Subject/topic/concept: ${ctx?.subject ?? "?"} > ${ctx?.chapter ?? "?"} > ${ctx?.topic ?? "?"} > ${ctx?.concept ?? "?"}
Bloom level: ${it.bloom_level ?? "not set"}
Stem: ${it.stem}
Options: A) ${opts?.A}  B) ${opts?.B}  C) ${opts?.C}  D) ${opts?.D}
Marked correct: ${it.correct_option}
Explanation given: ${it.explanation ?? "(none)"}`;
  }).join("\n\n");

  return `You are reviewing multiple-choice assessment items for quality before they are used with students.

${dimensionBlock()}

${blocks}

Return ONLY a JSON array with one object per item, no prose, no markdown fences:
[{"id":"<item id copied exactly>","ambiguity":{"score":9,"note":""},"difficulty_match":{"score":8,"note":""},"syllabus_alignment":{"score":9,"note":""},"answer_validity":{"score":10,"note":"","critical_issue":false},"suggested_fix":null}]`;
}

function buildExtendedPrompt(batch: Row[], contexts: Map<number, Ctx>): string {
  const blocks = batch.map((it) => {
    const ctx = it.subtopic_id ? contexts.get(it.subtopic_id) : null;
    const rubric = Array.isArray(it.rubric) ? it.rubric : [];
    const subQs = Array.isArray(it.sub_questions) ? it.sub_questions : [];
    const rubricTotal = rubric.reduce((s: number, c: Row) => s + (Number(c.max_marks) || 0), 0);
    return `--- ITEM ${it.id} (${it.question_type}) ---
${ctx ? `Subject/topic/concept: ${ctx.subject} > ${ctx.chapter} > ${ctx.topic} > ${ctx.concept}` : "Competency-tagged item (no curriculum topic path)"}
Difficulty declared: ${it.difficulty ?? "not set"}   Bloom level: ${it.bloom_level ?? "not set"}
${it.context_passage ? `Context passage: ${it.context_passage}\n` : ""}Stem: ${it.stem}
${subQs.length ? `Sub-questions: ${subQs.map((s: Row) => `(${s.id}) ${s.text} [${s.max_marks}m]`).join("; ")}\n` : ""}Rubric (should sum to max_marks=${it.max_marks}): ${rubric.map((c: Row) => `${c.criterion} [${c.max_marks}m]`).join("; ")} (rubric sums to ${rubricTotal})
Model answer: ${it.model_answer ?? "(none provided)"}`;
  }).join("\n\n");

  return `You are reviewing open-ended assessment items (descriptive/case-based/HOTS/scenario/competency) for quality before they are used with students.

${dimensionBlock()}
For "answer_validity" on these items, also set "critical_issue": true if the rubric's marks don't sum to max_marks, if the rubric grades something the stem never asks for, or if the model answer doesn't actually satisfy the stem/rubric.

${blocks}

Return ONLY a JSON array with one object per item, no prose, no markdown fences:
[{"id":"<item id copied exactly>","ambiguity":{"score":9,"note":""},"difficulty_match":{"score":8,"note":""},"syllabus_alignment":{"score":9,"note":""},"answer_validity":{"score":10,"note":"","critical_issue":false},"suggested_fix":null}]`;
}

function cleanGraded(r: Row): Graded | null {
  const id = typeof r.id === "string" ? r.id : null;
  if (!id) return null;
  const dim = (v: Row): Dimension | null => {
    const score = Number(v?.score);
    if (!Number.isFinite(score) || score < 0 || score > 10) return null;
    return { score, note: typeof v?.note === "string" ? v.note : "" };
  };
  const ambiguity = dim(r.ambiguity), difficulty_match = dim(r.difficulty_match), syllabus_alignment = dim(r.syllabus_alignment);
  const avRaw = dim(r.answer_validity);
  if (!ambiguity || !difficulty_match || !syllabus_alignment || !avRaw) return null;
  return {
    id, ambiguity, difficulty_match, syllabus_alignment,
    answer_validity: { ...avRaw, critical_issue: r.answer_validity?.critical_issue === true },
    suggested_fix: typeof r.suggested_fix === "string" && r.suggested_fix.trim() ? r.suggested_fix.trim() : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Persist: overall score, flag, review row, optional auto-suspend

function computeFlag(overall: number, critical: boolean): "pass" | "minor_issues" | "needs_revision" | "reject" {
  if (critical) return "reject";
  if (overall >= 80) return "pass";
  if (overall >= 60) return "minor_issues";
  if (overall >= 40) return "needs_revision";
  return "reject";
}

async function persist(
  admin: ReturnType<typeof createClient>, itemTable: ItemTable, item: Row, g: Graded, reviewerId: string, autoSuspend: boolean,
): Promise<Row> {
  const overall = ((g.ambiguity.score + g.difficulty_match.score + g.syllabus_alignment.score + g.answer_validity.score) / 4) * 10;
  const flag = computeFlag(overall, g.answer_validity.critical_issue);
  const shouldSuspend = autoSuspend && flag === "reject" && item.status === "active";

  const reviewRow: Row = {
    ambiguity_score: g.ambiguity.score, ambiguity_note: g.ambiguity.note || null,
    difficulty_match_score: g.difficulty_match.score, difficulty_match_note: g.difficulty_match.note || null,
    syllabus_alignment_score: g.syllabus_alignment.score, syllabus_alignment_note: g.syllabus_alignment.note || null,
    answer_validity_score: g.answer_validity.score, answer_validity_note: g.answer_validity.note || null,
    answer_validity_critical: g.answer_validity.critical_issue,
    overall_score: overall, flag, suggested_fix: g.suggested_fix,
    model: MODEL, auto_suspended: shouldSuspend, reviewed_by: reviewerId,
  };
  if (itemTable === "question_bank") reviewRow.mcq_item_id = item.id;
  else reviewRow.extended_item_id = item.id;

  const { error: reviewErr } = await admin.from("question_quality_reviews").insert(reviewRow);
  if (reviewErr) throw new Error(reviewErr.message);

  const update: Row = { quality_score: overall, quality_flag: flag, quality_checked_at: new Date().toISOString() };
  if (shouldSuspend) update.status = "draft";
  const { error: updErr } = await admin.from(itemTable).update(update).eq("id", item.id);
  if (updErr) throw new Error(updErr.message);

  return { id: item.id, overall_score: overall, flag, critical_issue: g.answer_validity.critical_issue, auto_suspended: shouldSuspend, suggested_fix: g.suggested_fix };
}
