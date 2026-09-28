// supabase/functions/generate-open-ended-items/index.ts
//
// Deploy with:
//   supabase functions deploy generate-open-ended-items
//
// Staff only. Authors descriptive / case-based / HOTS / scenario / competency
// items into question_bank_extended - the free-response sibling of
// question_bank (which stays MCQ-only and feeds CAT/IRT). These items are
// rubric-graded (AI first pass + teacher review, see grade-open-response),
// not auto-keyed, so they never enter the adaptive test engine directly -
// they're meant for homework, worksheets and teacher-assigned tests.
//
//   Body: {
//     // curriculum scope - required for "descriptive" | "case_based" | "hots" | "scenario"
//     subtopic_id? | topic_id? | learning_objective_id?
//
//     // competency scope - required for the "competency" type
//     competency_id?
//
//     question_types: ("descriptive"|"case_based"|"hots"|"scenario"|"competency")[]
//     target_per_type?: number   default 3, max 8 - "top up" to this many
//                                 non-retired items per (objective|competency, type)
//     difficulty?: "easy"|"medium"|"hard"|"mixed"   default "mixed"
//     auto_activate?: boolean    default false - items land as "draft" until
//                                 a teacher approves them, same as question_bank
//   }
//
// Items always start as drafts (unless auto_activate) - AI rubrics occasionally
// need a teacher's edit, and a bad rubric silently mis-scores every student who
// gets that item.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];
const MODEL = "google/gemini-2.5-flash";
const AI_URL = Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_TASKS_PER_CALL = 12;
const CONCURRENCY = 3;

type QuestionType = "descriptive" | "case_based" | "hots" | "scenario" | "competency";
const VALID_TYPES: QuestionType[] = ["descriptive", "case_based", "hots", "scenario", "competency"];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface RubricCriterion { criterion: string; description?: string; max_marks: number; sub_question_id?: string }
interface SubQuestion { id: string; text: string; max_marks: number }
interface CleanItem {
  stem: string;
  contextPassage: string | null;
  subQuestions: SubQuestion[];
  rubric: RubricCriterion[];
  modelAnswer: string | null;
  maxMarks: number;
  difficulty: "easy" | "medium" | "hard";
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
    const { subtopic_id, topic_id, learning_objective_id, competency_id } = body;

    const requestedTypes: QuestionType[] = Array.isArray(body.question_types)
      ? body.question_types.filter((t: unknown): t is QuestionType => VALID_TYPES.includes(t as QuestionType))
      : [];
    if (!requestedTypes.length) {
      return json({ error: `question_types is required, one or more of: ${VALID_TYPES.join(", ")}` }, 400);
    }

    const loBasedTypes = requestedTypes.filter((t) => t !== "competency") as Exclude<QuestionType, "competency">[];
    const wantsCompetency = requestedTypes.includes("competency");

    if (loBasedTypes.length && !subtopic_id && !topic_id && !learning_objective_id) {
      return json({ error: "subtopic_id, topic_id or learning_objective_id is required for descriptive/case_based/hots/scenario" }, 400);
    }
    if (wantsCompetency && !competency_id) {
      return json({ error: "competency_id is required for the competency question type" }, 400);
    }

    const target = Math.min(8, Math.max(1, Math.round(Number(body.target_per_type ?? 3)) || 3));
    const difficulty = ["easy", "medium", "hard", "mixed"].includes(body.difficulty) ? body.difficulty : "mixed";
    const autoActivate = body.auto_activate === true;

    // ── Build the task list: one task per (objective|competency, type) ────
    type Task =
      | { kind: "lo"; type: Exclude<QuestionType, "competency">; lo: Row; ctx: LoCtx; need: number }
      | { kind: "competency"; type: "competency"; competency: Row; need: number };

    const tasks: Task[] = [];

    if (loBasedTypes.length) {
      let loQuery = admin.from("learning_objectives")
        .select("id, subtopic_id, objective_text, bloom_level, difficulty").eq("status", "active");
      if (learning_objective_id) loQuery = loQuery.eq("id", learning_objective_id);
      else if (subtopic_id) loQuery = loQuery.eq("subtopic_id", subtopic_id);
      else {
        const { data: subs } = await admin.from("subtopics").select("id").eq("topic_id", topic_id);
        const ids = (subs ?? []).map((s: Row) => s.id);
        if (!ids.length) return json({ error: "That topic has no concepts yet" }, 404);
        loQuery = loQuery.in("subtopic_id", ids);
      }
      const { data: los, error: loErr } = await loQuery.order("id");
      if (loErr) throw new Error(loErr.message);
      if (!los?.length) {
        return json({ error: "No learning objectives found. Generate objectives for this concept first." }, 404);
      }

      const contexts = await loadLoContext(admin, los as Row[]);

      const { data: existing } = await admin.from("question_bank_extended")
        .select("learning_objective_id, question_type")
        .in("learning_objective_id", (los as Row[]).map((l) => l.id))
        .neq("status", "retired");
      const have = new Map<string, number>();
      for (const r of existing ?? []) {
        const key = `${r.learning_objective_id}:${r.question_type}`;
        have.set(key, (have.get(key) ?? 0) + 1);
      }

      for (const lo of los as Row[]) {
        for (const type of loBasedTypes) {
          const need = target - (have.get(`${lo.id}:${type}`) ?? 0);
          if (need > 0) tasks.push({ kind: "lo", type, lo, ctx: contexts.get(lo.subtopic_id)!, need });
        }
      }
    }

    let competencyRow: Row | null = null;
    if (wantsCompetency) {
      const { data: comp, error: compErr } = await admin.from("competencies")
        .select("id, subject, name, description, grade_level").eq("id", competency_id).single();
      if (compErr || !comp) return json({ error: "Competency not found" }, 404);
      competencyRow = comp;

      const { count } = await admin.from("question_bank_extended")
        .select("id", { count: "exact", head: true })
        .eq("competency_id", competency_id).eq("question_type", "competency").neq("status", "retired");
      const need = target - (count ?? 0);
      if (need > 0) tasks.push({ kind: "competency", type: "competency", competency: comp, need });
    }

    if (!tasks.length) {
      return json({ inserted: 0, message: "Every requested (objective/competency, type) combination already has enough items." });
    }

    const batch = tasks.slice(0, MAX_TASKS_PER_CALL);
    const remaining = tasks.length - batch.length;

    // ── Generate with bounded concurrency ──────────────────────────────
    const results: Row[] = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
      while (cursor < batch.length) {
        const task = batch[cursor++];
        try {
          results.push(await runTask({ admin, apiKey, userId: user.id, task, need: task.need, difficulty, autoActivate }));
        } catch (e) {
          results.push({
            question_type: task.type,
            learning_objective_id: task.kind === "lo" ? task.lo.id : null,
            competency_id: task.kind === "competency" ? task.competency.id : null,
            inserted: 0,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    });
    await Promise.all(workers);

    const inserted = results.reduce((s, r) => s + (r.inserted ?? 0), 0);
    return json({
      inserted,
      status_of_new_items: autoActivate ? "active" : "draft",
      tasks_processed: batch.length,
      remaining_tasks: remaining,
      per_task: results,
    });
  } catch (e) {
    console.error("generate-open-ended-items error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Curriculum context (same shape/loader as generate-item-bank)

interface LoCtx {
  subject: string; className: string; curriculum: string;
  chapter: string; topic: string; concept: string; conceptDescription: string;
  misconceptions: { id: number; text: string }[];
}

async function loadLoContext(admin: ReturnType<typeof createClient>, los: Row[]): Promise<Map<number, LoCtx>> {
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

  const out = new Map<number, LoCtx>();
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

// ─────────────────────────────────────────────────────────────────────────
// Generation + insertion, one (objective|competency, type) task at a time

async function runTask(a: {
  admin: ReturnType<typeof createClient>; apiKey: string; userId: string;
  task:
    | { kind: "lo"; type: Exclude<QuestionType, "competency">; lo: Row; ctx: LoCtx; need: number }
    | { kind: "competency"; type: "competency"; competency: Row; need: number };
  need: number; difficulty: string; autoActivate: boolean;
}): Promise<Row> {
  const { admin, task, need, difficulty, autoActivate } = a;

  const prompt = task.kind === "lo"
    ? buildLoPrompt(task.type, need, task.lo, task.ctx, difficulty)
    : buildCompetencyPrompt(need, task.competency, difficulty);

  const raw = await callModel(a.apiKey, prompt);

  const seenStems = new Set<string>();
  const clean: CleanItem[] = [];
  let rejected = 0;
  for (const r of raw) {
    const c = cleanItem(task.type, r);
    if (!c || seenStems.has(c.stem.toLowerCase())) { rejected++; continue; }
    seenStems.add(c.stem.toLowerCase());
    clean.push(c);
    if (clean.length >= need) break;
  }

  let inserted = 0, duplicates = 0;
  for (const c of clean) {
    const insertRow: Row = {
      question_type: task.type,
      stem: c.stem,
      context_passage: c.contextPassage,
      sub_questions: c.subQuestions,
      rubric: c.rubric,
      model_answer: c.modelAnswer,
      max_marks: c.maxMarks,
      difficulty: c.difficulty,
      status: autoActivate ? "active" : "draft",
      ai_generated: true, generation_model: MODEL, created_by: a.userId,
    };
    if (task.kind === "lo") {
      insertRow.learning_objective_id = task.lo.id;
      insertRow.subtopic_id = task.lo.subtopic_id;
      insertRow.bloom_level = task.lo.bloom_level;
    } else {
      insertRow.competency_id = task.competency.id;
    }

    const { error } = await admin.from("question_bank_extended").insert(insertRow);
    if (!error) inserted++;
    else if (error.code === "23505") duplicates++;
    else throw new Error(`insert failed: ${error.message}`);
  }

  return {
    question_type: task.type,
    learning_objective_id: task.kind === "lo" ? task.lo.id : null,
    competency_id: task.kind === "competency" ? task.competency.id : null,
    requested: need, inserted, rejected_invalid: rejected, skipped_duplicates: duplicates,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Prompts (one builder per scope; type-specific instructions inline)

const DIFFICULTY_LINE: Record<string, string> = {
  easy: "All items should be straightforward, testing basic understanding.",
  medium: "Items should sit at a moderate level - some reasoning required, not pure recall.",
  hard: "Items should be genuinely challenging - multi-step reasoning, synthesis, or justification.",
  mixed: "Spread items across easy, medium and hard.",
};

const TYPE_BRIEF: Record<Exclude<QuestionType, "competency">, string> = {
  descriptive: `Write a DESCRIPTIVE (short/long answer) question that asks the student to explain, describe, derive, or compare in their own words - not a single fact. No context_passage or sub_questions needed (leave them empty).`,
  hots: `Write a HIGHER-ORDER THINKING SKILLS (HOTS) question at the Bloom levels analyze/evaluate/create: the student must break down a problem, judge between alternatives, critique a claim, or design/construct a solution - never a question answerable by recall alone. No context_passage or sub_questions needed (leave them empty).`,
  case_based: `Write a CASE-BASED question: a short realistic case/passage (2-5 sentences) in "context_passage", followed by 2-4 sub_questions that each probe a different angle of the case (each with its own id like "a","b","c" and its own max_marks). Put the overall framing/instruction in "stem" (e.g. "Read the case below and answer the questions that follow.").`,
  scenario: `Write a SCENARIO-based question: describe a realistic real-world situation relevant to this concept in "context_passage" (2-4 sentences), then put ONE application question about that scenario in "stem". Leave sub_questions empty - this is single-part.`,
};

function rubricInstruction(maxMarksHint: number) {
  return `Write a "rubric" as an array of 2-4 discrete scoring criteria that together add up to "max_marks" (${maxMarksHint} is a reasonable total unless the item clearly needs more/fewer). Each entry: {"criterion": short label, "description": what earns these marks, "max_marks": number}. For case_based items, each rubric entry should include "sub_question_id" matching the sub_question it grades.`;
}

function buildLoPrompt(type: Exclude<QuestionType, "competency">, n: number, lo: Row, ctx: LoCtx, difficulty: string): string {
  const mcBlock = ctx.misconceptions.length
    ? `Known misconceptions for this concept (a good descriptive/HOTS question can ask the student to explain why one of these is wrong):\n${ctx.misconceptions.map((m) => `  - ${m.text}`).join("\n")}`
    : "";
  const diffLine = DIFFICULTY_LINE[difficulty] ?? DIFFICULTY_LINE.mixed;
  const suggestedMarks = type === "case_based" ? 6 : type === "hots" ? 5 : 4;

  return `You are an expert assessment writer creating ${type.replace("_", "-")} questions for a school assessment bank.

Subject: ${ctx.subject}${ctx.className ? ` (Class ${ctx.className})` : ""}${ctx.curriculum ? `, ${ctx.curriculum}` : ""}
Chapter: ${ctx.chapter}
Topic: ${ctx.topic}
Concept: ${ctx.concept}${ctx.conceptDescription ? `\nConcept description: ${ctx.conceptDescription}` : ""}
Learning objective to assess: ${lo.objective_text}
Bloom level: ${lo.bloom_level ?? "apply"}

${mcBlock}

${TYPE_BRIEF[type]}

Write exactly ${n} DISTINCT items that each assess THIS learning objective. ${diffLine}
Every item is fully self-contained (no "as shown in class").
Provide a "model_answer" - the ideal answer a grader (human or AI) checks against - never shown to students.
${rubricInstruction(suggestedMarks)}
Set "max_marks" to the sum of the rubric's max_marks.
Set "difficulty_target" to one of "easy"|"medium"|"hard" reflecting the item you actually wrote.

Return ONLY a JSON array, no prose, no markdown fences. Shape:
[{
  "stem": "...",
  "context_passage": "..." | null,
  "sub_questions": [{"id":"a","text":"...","max_marks":2}] | [],
  "rubric": [{"criterion":"...","description":"...","max_marks":2,"sub_question_id":"a"}],
  "model_answer": "...",
  "max_marks": 6,
  "difficulty_target": "easy|medium|hard"
}]`;
}

function buildCompetencyPrompt(n: number, competency: Row, difficulty: string): string {
  const diffLine = DIFFICULTY_LINE[difficulty] ?? DIFFICULTY_LINE.mixed;
  return `You are an expert assessment writer creating COMPETENCY-based questions - questions that assess a broad applied skill rather than a single curriculum fact.

Subject: ${competency.subject}
Grade level: ${competency.grade_level ?? "not specified"}
Competency to assess: ${competency.name}${competency.description ? `\nCompetency description: ${competency.description}` : ""}

Write a question (optionally with a short real-world "context_passage" the student must apply the competency to) that requires the student to DEMONSTRATE this competency in practice - not recite a definition of it.
Write exactly ${n} DISTINCT such items. ${diffLine}
Provide a "model_answer" - what a strong demonstration of the competency looks like - never shown to students.
${rubricInstruction(6)}
Set "max_marks" to the sum of the rubric's max_marks.
Set "difficulty_target" to one of "easy"|"medium"|"hard".
Leave "sub_questions" as an empty array - competency items are single-part.

Return ONLY a JSON array, no prose, no markdown fences. Shape:
[{
  "stem": "...",
  "context_passage": "..." | null,
  "sub_questions": [],
  "rubric": [{"criterion":"...","description":"...","max_marks":2}],
  "model_answer": "...",
  "max_marks": 6,
  "difficulty_target": "easy|medium|hard"
}]`;
}

// ─────────────────────────────────────────────────────────────────────────

async function callModel(apiKey: string, prompt: string): Promise<Row[]> {
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
  return parsed as Row[];
}

function cleanItem(type: QuestionType, r: Row): CleanItem | null {
  const stem = typeof r.stem === "string" ? r.stem.trim() : "";
  if (stem.length < 8 || stem.length > 2000) return null;

  const contextPassage = typeof r.context_passage === "string" && r.context_passage.trim() ? r.context_passage.trim() : null;
  if (type === "case_based" && !contextPassage) return null; // case-based needs its passage

  let subQuestions: SubQuestion[] = [];
  if (Array.isArray(r.sub_questions)) {
    for (const sq of r.sub_questions) {
      const id = typeof sq?.id === "string" ? sq.id.trim() : "";
      const text = typeof sq?.text === "string" ? sq.text.trim() : "";
      const maxMarks = Number(sq?.max_marks);
      if (!id || !text || !Number.isFinite(maxMarks) || maxMarks <= 0) continue;
      subQuestions.push({ id, text, max_marks: maxMarks });
    }
  }
  if (type === "case_based" && subQuestions.length < 2) return null; // needs at least 2 parts

  const rubricRaw = Array.isArray(r.rubric) ? r.rubric : [];
  const rubric: RubricCriterion[] = [];
  for (const c of rubricRaw) {
    const criterion = typeof c?.criterion === "string" ? c.criterion.trim() : "";
    const maxMarks = Number(c?.max_marks);
    if (!criterion || !Number.isFinite(maxMarks) || maxMarks <= 0) continue;
    rubric.push({
      criterion,
      description: typeof c?.description === "string" ? c.description.trim() : undefined,
      max_marks: maxMarks,
      sub_question_id: typeof c?.sub_question_id === "string" ? c.sub_question_id : undefined,
    });
  }
  if (rubric.length < 1) return null;

  const modelAnswer = typeof r.model_answer === "string" && r.model_answer.trim() ? r.model_answer.trim() : null;

  const rubricTotal = rubric.reduce((s, c) => s + c.max_marks, 0);
  const maxMarks = Number.isFinite(Number(r.max_marks)) && Number(r.max_marks) > 0 ? Number(r.max_marks) : rubricTotal;

  const dt = String(r.difficulty_target ?? "medium").toLowerCase();
  const difficulty = (["easy", "medium", "hard"].includes(dt) ? dt : "medium") as CleanItem["difficulty"];

  return { stem, contextPassage, subQuestions, rubric, modelAnswer, maxMarks, difficulty };
}
