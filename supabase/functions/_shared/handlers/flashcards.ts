// supabase/functions/_shared/handlers/flashcards.ts
//
// AI Auto Flashcards. Not a standalone edge function (deployment limit): `cat-session` routes to this handler via its
// `action` field - see _shared/mergedRouter.ts and CONSOLIDATION.md.
//
//   fc_catalog   { subject? }                                   subjects for the student's class; with `subject`, its chapters + topics
//   fc_generate  { topic_id | chapter_id, types?, count? }      build (or reuse) cards from the APAS textbook text and add them to the deck
//   fc_study     { topic_id? | chapter_id? | subject?, mode?, limit? }   the study queue (due first, a few new cards)
//   fc_rate      { flashcard_id, rating, session_id? }          Easy | Medium | Difficult -> reschedule + history (+ Daily Review pull-forward)
//   fc_overview  { tz_offset_minutes? }                         stats, decks, 7-day history, streak, weak topics, due counts
//   fc_report    { flashcard_id }                               "this card looks wrong" (3 different students retire a card)
//
// SECURITY
//   * Students only. The student row, class, school and curriculum come from the verified JWT - the body can never choose them.
//   * Cards are only ever built from books that belong to the student's own class + school + curriculum.
//   * Every write uses the service role AFTER those checks; RLS gives clients read-only access to their own rows.
//   * Accuracy: cards are built only from the student's textbook text (or, when a topic has none, the syllabus outline) and each
//     card is kept only if the passage it cites really occurs in that text (see flashcardModel.validateCard).
//   * Needs migration 20261030000000 (else 503 `persistence_unavailable`). AI uses _shared/aiClient.ts (same Gemini keys as the rest of APAS).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAi, getAiConfig } from "../aiClient.ts";
import { classKey as toClassKey, classLabel, gradeLevel, subjectKey } from "../gamificationQuestionModel.ts";
import { groupSubjects, loadClassBooks, type StudentCtx } from "./gamificationQuestions.ts";
import {
  CARD_TYPES, DEFAULT_CARDS, MAX_CARDS, MAX_QUEUE, MAX_REPORTS_BEFORE_RETIRE, MIN_CARDS, NEW_CARDS_PER_SESSION,
  buildPrompt, buildSource, cardState, intervalLabel, isCardType, isRating, nextSchedule, orderStudyQueue, parseGenerated,
  pullForwardDays, summarizeDeck, validateBatch,
  type CardType, type Progress, type Rating,
} from "../flashcardModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class Unavailable extends Error {}
class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }

const MAX_TOPICS_PER_REQUEST = 3;
const MAX_NEW_CARDS_PER_HOUR = 60;
const chunk = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const shuffled = <T,>(xs: T[]): T[] => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function tableMissing(err: any): boolean {
  const msg = String(err?.message ?? "");
  return ["42P01", "42883", "PGRST205", "PGRST202", "42703"].includes(err?.code) || /does not exist|schema cache|could not find the function/i.test(msg);
}
function must(res: { data: any; error: any }): any {
  if (res.error) { if (tableMissing(res.error)) throw new Unavailable(); throw res.error; }
  return res.data;
}
/** Optional read (textbook text may not exist in every environment): a missing table is just "no rows". */
function optional(res: { data: any; error: any }): any[] {
  if (res.error) { if (tableMissing(res.error)) return []; throw res.error; }
  return res.data ?? [];
}

// ── who is asking ─────────────────────────────────────────────────────────────────────────────────

interface Ctx extends StudentCtx { studentId: string }

async function resolveStudent(admin: any, userId: string): Promise<Ctx> {
  const profile = must(await admin.from("profiles").select("role, school_id, class_grade").eq("id", userId).maybeSingle());
  if (profile?.role !== "student") throw new HttpError(403, "Flashcards are for students", "students_only");
  const student = must(await admin.from("students").select("id, grade, curriculum").eq("profile_id", userId).maybeSingle());
  if (!student?.id) throw new HttpError(403, "Student record not found", "no_student");

  const enrol = must(await admin.from("class_students").select("assigned_at, classes(name)").eq("student_id", student.id)
    .order("assigned_at", { ascending: false }).limit(1));
  const raw = enrol?.[0]?.classes?.name || (student.grade ? String(student.grade).trim() : "") || (profile.class_grade ? String(profile.class_grade).trim() : "") || null;

  const key = toClassKey(raw);
  const level = key ? gradeLevel(key) : null;
  if (!raw || !key || level == null) {
    throw new HttpError(422, "We couldn't find your class yet. Please ask your school admin to assign you to a class.", "class_unrecognised");
  }
  return {
    studentId: student.id, userId, schoolId: profile.school_id ?? null,
    curriculum: student.curriculum ? String(student.curriculum).trim() : null,
    classKey: key, level, label: classLabel(key),
  };
}

// ── scope: a topic / chapter / subject that really belongs to THIS student's class ────────────────

interface TopicRow { id: number; name: string; description: string | null; chapter_id: number; display_order: number }
interface Scope { subject: string; book: { id: number; curriculum: string | null }; chapter: { id: number; name: string }; topics: TopicRow[] }

async function resolveScope(admin: any, s: Ctx, body: any): Promise<Scope> {
  const books = await loadClassBooks(admin, s);
  const bookById = new Map(books.map((b) => [b.id, b]));
  if (!books.length) throw new HttpError(404, `No subjects have been set up for ${s.label} yet. Please ask your school admin.`, "no_subjects");

  let chapterId: number | null = null;
  let onlyTopic: number | null = null;
  if (body?.topic_id != null) {
    const t = must(await admin.from("topics").select("id, chapter_id").eq("id", Number(body.topic_id)).maybeSingle());
    if (!t) throw new HttpError(404, "That topic was not found", "topic_not_found");
    chapterId = t.chapter_id; onlyTopic = t.id;
  } else if (body?.chapter_id != null) {
    chapterId = Number(body.chapter_id);
  } else {
    throw new HttpError(400, "Choose a chapter or a topic", "scope_required");
  }

  const chapter = must(await admin.from("curriculum_chapters").select("id, chapter_name, unit_id").eq("id", chapterId).eq("is_active", true).maybeSingle());
  if (!chapter) throw new HttpError(404, "That chapter was not found", "chapter_not_found");
  const unit = must(await admin.from("units").select("id, book_id").eq("id", chapter.unit_id).maybeSingle());
  const book = unit ? bookById.get(unit.book_id) : undefined;
  if (!book) throw new HttpError(403, `That chapter isn't part of your ${s.label} syllabus`, "not_your_syllabus");

  let q = admin.from("topics").select("id, topic_name, topic_description, chapter_id, display_order").eq("chapter_id", chapter.id);
  if (onlyTopic != null) q = q.eq("id", onlyTopic);
  const topics = (must(await q.order("display_order").order("id").limit(200)) as any[]).map((t) => ({
    id: t.id, name: t.topic_name, description: t.topic_description ?? null, chapter_id: t.chapter_id, display_order: t.display_order ?? 0,
  }));
  if (!topics.length) throw new HttpError(404, "This chapter has no topics yet", "no_topics");
  return { subject: book.subject, book: { id: book.id, curriculum: book.curriculum }, chapter: { id: chapter.id, name: chapter.chapter_name }, topics };
}

// ── generate ──────────────────────────────────────────────────────────────────────────────────────

interface TopicResult {
  topic_id: number; topic_name: string; added: number; reused: number; generated: number;
  rejected: Record<string, number>; status: "ok" | "no_material" | "ai_failed" | "nothing_new"; message?: string;
}

async function generateForTopic(admin: any, s: Ctx, scope: Scope, topic: TopicRow, types: CardType[], want: number): Promise<TopicResult> {
  const res: TopicResult = { topic_id: topic.id, topic_name: topic.name, added: 0, reused: 0, generated: 0, rejected: {}, status: "ok" };

  // 1. Cards already made for this topic (by this student or classmates) - reuse before paying for new ones.
  const existing = must(await admin.from("flashcards").select("id, question_hash, question, card_type")
    .eq("topic_id", topic.id).eq("status", "active").limit(500)) as any[];
  const inDeck = new Set<string>();
  for (const ids of chunk(existing.map((c) => c.id as string), 100)) {
    for (const r of must(await admin.from("student_flashcards").select("flashcard_id").eq("student_id", s.studentId).in("flashcard_id", ids)) as any[]) inDeck.add(r.flashcard_id);
  }
  const reusable = shuffled(existing.filter((c) => !inDeck.has(c.id) && types.includes(c.card_type))).slice(0, want);
  let attach: string[] = reusable.map((c) => c.id);
  res.reused = attach.length;

  // 2. Build the shortfall from the student's textbook material.
  const need = want - attach.length;
  if (need > 0) {
    const made = (await admin.from("flashcards").select("id", { count: "exact", head: true })
      .eq("created_by", s.studentId).gte("created_at", new Date(Date.now() - 3600_000).toISOString())).count ?? 0;
    if (made >= MAX_NEW_CARDS_PER_HOUR) {
      throw new HttpError(429, "You've made a lot of new flashcards this hour. Study these first and make more a bit later!", "rate_limited");
    }

    const subs = must(await admin.from("subtopics").select("id, subtopic_name, subtopic_description").eq("topic_id", topic.id).eq("is_active", true).limit(60)) as any[];
    const subIds = subs.map((x) => x.id as number);
    const los: any[] = subIds.length
      ? must(await admin.from("learning_objectives").select("id, subtopic_id, objective_text").in("subtopic_id", subIds).eq("status", "active").order("display_order").limit(40))
      : [];
    const chunks = optional(await admin.from("textbook_chunks").select("chunk_text, page_number, content_type")
      .eq("topic_id", topic.id).eq("book_id", scope.book.id).order("page_number").limit(300));

    const outline = [
      `Topic: ${topic.name}`,
      topic.description ? `Description: ${topic.description}` : "",
      ...subs.map((x) => `Concept - ${x.subtopic_name}${x.subtopic_description ? `: ${x.subtopic_description}` : ""}`),
      ...los.map((o) => `Learning objective: ${o.objective_text}`),
    ].filter(Boolean).join("\n");

    const source = buildSource(chunks.map((c) => ({ page: c.page_number, text: c.chunk_text, content_type: c.content_type })), outline);
    if (!source) {
      res.status = attach.length ? "ok" : "no_material";
      res.message = "There isn't enough study material for this topic yet, so we didn't make cards for it.";
    } else {
      const objectiveIds = new Set<number>(los.map((o) => o.id));
      let kept: ReturnType<typeof validateBatch>["cards"] = [];
      let model: string | null = null;
      const known = new Set<string>(existing.map((c) => c.question_hash));
      const avoid = existing.map((c) => String(c.question));

      for (let attempt = 0; attempt < 2 && kept.length < Math.min(need, 3); attempt++) {
        let text: string;
        try {
          const cfg = getAiConfig();
          const { system, prompt } = buildPrompt({
            classLabel: s.label, level: s.level, subject: scope.subject, chapter: scope.chapter.name, topic: topic.name,
            curriculumName: scope.book.curriculum ?? s.curriculum, source, types, count: Math.min(MAX_CARDS, need + 2),
            objectives: los.map((o) => ({ id: o.id, text: o.objective_text })), avoid,
          });
          const out = await callAi(cfg, prompt, { system, temperature: 0.3 + attempt * 0.2, maxOutputTokens: 8192 });
          text = out.text; model = out.model;
        } catch (e) {
          if (!attach.length && !kept.length) { res.status = "ai_failed"; res.message = e instanceof Error && /No AI key/.test(e.message) ? "AI isn't set up yet. Please ask your school admin." : "The flashcard helper is busy right now. Please try again in a minute."; console.error("flashcards AI error", e); }
          break;
        }
        const rep = validateBatch(parseGenerated(text), { source, allowedTypes: types, objectiveIds }, known, need - kept.length);
        for (const [k, v] of Object.entries(rep.rejected)) res.rejected[k] = (res.rejected[k] ?? 0) + v;
        for (const c of rep.cards) { known.add(c.question_hash); avoid.push(c.question); }
        kept = [...kept, ...rep.cards];
      }

      if (kept.length) {
        const rows = kept.map((c) => ({
          school_id: s.schoolId, book_id: scope.book.id, chapter_id: scope.chapter.id, topic_id: topic.id,
          subtopic_id: null as number | null, learning_objective_id: c.learning_objective_id,
          card_type: c.card_type, question: c.question, answer: c.answer, hint: c.hint, difficulty: c.difficulty,
          source_excerpt: c.source_excerpt, source_pages: source.pages, grounding: source.grounding,
          question_hash: c.question_hash, ai_generated: true, generation_model: model, status: "active", created_by: s.studentId,
        }));
        // subtopic of the linked objective (when there is one)
        for (const r of rows) {
          const lo = los.find((o) => o.id === r.learning_objective_id);
          r.subtopic_id = lo ? lo.subtopic_id : null;
        }
        const inserted = must(await admin.from("flashcards").upsert(rows, { onConflict: "topic_id,question_hash", ignoreDuplicates: true }).select("id, question_hash")) as any[];
        res.generated = inserted.length;
        attach = attach.concat(inserted.map((r) => r.id));
        // another request may have inserted the same question a moment ago: attach that row too
        const insertedHashes = new Set(inserted.map((r) => r.question_hash));
        const raced = kept.filter((c) => !insertedHashes.has(c.question_hash)).map((c) => c.question_hash);
        if (raced.length) {
          const rr = must(await admin.from("flashcards").select("id").eq("topic_id", topic.id).eq("status", "active").in("question_hash", raced)) as any[];
          for (const r of rr) if (!inDeck.has(r.id) && !attach.includes(r.id)) attach.push(r.id);
        }
      } else if (res.status === "ok" && !attach.length) {
        res.status = "nothing_new";
        res.message = "We couldn't make good new cards from this topic right now. Try another topic, or come back later.";
      }
    }
  }

  // 3. Put everything into the student's deck, due now.
  if (attach.length) {
    const deckRows = [...new Set(attach)].map((id) => ({ student_id: s.studentId, flashcard_id: id }));
    const added = must(await admin.from("student_flashcards").upsert(deckRows, { onConflict: "student_id,flashcard_id", ignoreDuplicates: true }).select("flashcard_id")) as any[];
    res.added = added.length;
  }
  return res;
}

async function generate(admin: any, s: Ctx, body: any) {
  const types = (Array.isArray(body?.types) ? body.types : []).filter(isCardType) as CardType[];
  const useTypes = types.length ? [...new Set(types)] : [...CARD_TYPES];
  const count = Math.max(MIN_CARDS, Math.min(MAX_CARDS, Math.round(Number(body?.count ?? DEFAULT_CARDS)) || DEFAULT_CARDS));
  const scope = await resolveScope(admin, s, body);

  let topics = scope.topics;
  let perTopic = count;
  if (body?.topic_id == null) {
    // Whole chapter: work on the topics where this student has the fewest cards, a few at a time.
    const have = new Map<number, number>();
    for (const ids of chunk(topics.map((t) => t.id), 100)) {
      const rows = must(await admin.from("student_flashcards").select("flashcards!inner(topic_id)").eq("student_id", s.studentId).in("flashcards.topic_id", ids).limit(5000)) as any[];
      for (const r of rows) { const t = r.flashcards?.topic_id; if (t != null) have.set(t, (have.get(t) ?? 0) + 1); }
    }
    topics = [...topics].sort((a, b) => (have.get(a.id) ?? 0) - (have.get(b.id) ?? 0) || a.display_order - b.display_order || a.id - b.id);
    const take = Math.min(MAX_TOPICS_PER_REQUEST, topics.length);
    perTopic = Math.max(MIN_CARDS, Math.round(count / take));
    topics = topics.slice(0, take);
  }

  const results = await Promise.all(topics.map((t) => generateForTopic(admin, s, scope, t, useTypes, perTopic).catch((e) => {
    if (e instanceof HttpError && e.code === "rate_limited") throw e;
    if (e instanceof Unavailable) throw e;
    console.error("flashcards topic failed", t.id, e);
    return { topic_id: t.id, topic_name: t.name, added: 0, reused: 0, generated: 0, rejected: {}, status: "ai_failed", message: "Something went wrong with this topic." } as TopicResult;
  })));

  const added = results.reduce((n, r) => n + r.added, 0);
  const noMaterial = results.length > 0 && results.every((r) => r.status === "no_material");
  if (added === 0 && noMaterial) {
    throw new HttpError(422, "This topic doesn't have study material in APAS yet, so we can't make accurate flashcards for it. Please ask your teacher to upload it.", "no_material");
  }
  const failed = results.find((r) => r.status === "ai_failed");
  if (added === 0 && failed) throw new HttpError(503, failed.message ?? "The flashcard helper is busy right now. Please try again in a minute.", "ai_unavailable");

  return {
    subject: scope.subject, chapter: { id: scope.chapter.id, name: scope.chapter.name },
    added, reused: results.reduce((n, r) => n + r.reused, 0), generated: results.reduce((n, r) => n + r.generated, 0),
    topics: results, scope: body?.topic_id != null ? "topic" : "chapter",
    message: added === 0 ? (results.find((r) => r.message)?.message ?? "No new cards this time.") : null,
  };
}

// ── catalog ───────────────────────────────────────────────────────────────────────────────────────

async function catalog(admin: any, s: Ctx, body: any) {
  const groups = groupSubjects(await loadClassBooks(admin, s));
  const subjects = [...groups.values()].map((g) => ({ key: g.key, label: g.label })).sort((a, b) => a.label.localeCompare(b.label));
  const base = { class: { key: s.classKey, label: s.label }, subjects, message: subjects.length ? null : `No subjects have been set up for ${s.label} yet. Please ask your school admin.` };
  if (!body?.subject) return base;

  const g = groups.get(subjectKey(String(body.subject).slice(0, 80)));
  if (!g) throw new HttpError(400, `${String(body.subject).slice(0, 40)} isn't a subject for ${s.label}.`, "subject_not_available");

  const units = must(await admin.from("units").select("id, unit_name").in("book_id", g.bookIds).eq("is_active", true).order("id")) as any[];
  const chapters: any[] = [];
  for (const ids of chunk(units.map((u) => u.id as number), 100)) {
    chapters.push(...must(await admin.from("curriculum_chapters").select("id, chapter_name, unit_id").in("unit_id", ids).eq("is_active", true).order("id")));
  }
  const topics: any[] = [];
  for (const ids of chunk(chapters.map((c) => c.id as number), 100)) {
    topics.push(...must(await admin.from("topics").select("id, topic_name, chapter_id, display_order").in("chapter_id", ids).order("display_order").order("id").limit(1000)));
    if (topics.length >= 800) break;
  }
  const available = new Map<number, number>(), mine = new Map<number, number>();
  for (const ids of chunk(topics.map((t) => t.id as number), 100)) {
    for (const r of must(await admin.from("flashcards").select("topic_id").in("topic_id", ids).eq("status", "active").limit(5000)) as any[]) available.set(r.topic_id, (available.get(r.topic_id) ?? 0) + 1);
    for (const r of must(await admin.from("student_flashcards").select("flashcards!inner(topic_id)").eq("student_id", s.studentId).in("flashcards.topic_id", ids).limit(5000)) as any[]) {
      const t = r.flashcards?.topic_id; if (t != null) mine.set(t, (mine.get(t) ?? 0) + 1);
    }
  }
  const unitName = new Map(units.map((u) => [u.id, u.unit_name]));
  return {
    ...base, subject: { key: g.key, label: g.label },
    chapters: chapters.map((c) => ({
      id: c.id, name: c.chapter_name, unit: unitName.get(c.unit_id) ?? null,
      topics: topics.filter((t) => t.chapter_id === c.id).map((t) => ({ id: t.id, name: t.topic_name, available: available.get(t.id) ?? 0, in_deck: mine.get(t.id) ?? 0 })),
    })).filter((c) => c.topics.length > 0),
  };
}

// ── deck rows (progress + card), used by study / overview ─────────────────────────────────────────

const CARD_COLS = "id, card_type, question, answer, hint, difficulty, topic_id, chapter_id, book_id, learning_objective_id, source_pages, grounding";
const PROGRESS_COLS = "id, flashcard_id, ease_factor, interval_days, repetitions, lapses, times_seen, times_correct, easy_count, medium_count, difficult_count, last_rating, last_reviewed_at, due_at, updated_at";

async function loadDeck(admin: any, studentId: string, filter?: { topicId?: number; chapterId?: number; bookIds?: number[] }): Promise<any[]> {
  let q = admin.from("student_flashcards").select(`${PROGRESS_COLS}, flashcards!inner(${CARD_COLS}, status)`)
    .eq("student_id", studentId).eq("flashcards.status", "active").eq("reported", false);
  if (filter?.topicId != null) q = q.eq("flashcards.topic_id", filter.topicId);
  if (filter?.chapterId != null) q = q.eq("flashcards.chapter_id", filter.chapterId);
  if (filter?.bookIds) q = q.in("flashcards.book_id", filter.bookIds);
  return (must(await q.limit(3000)) as any[]).filter((r) => r.flashcards);
}

async function namesFor(admin: any, topicIds: number[]) {
  const topics = new Map<number, { name: string; chapter_id: number }>();
  for (const ids of chunk([...new Set(topicIds)], 100)) {
    for (const t of must(await admin.from("topics").select("id, topic_name, chapter_id").in("id", ids)) as any[]) topics.set(t.id, { name: t.topic_name, chapter_id: t.chapter_id });
  }
  const chapters = new Map<number, { name: string; book_id: number | null }>();
  for (const ids of chunk([...new Set([...topics.values()].map((t) => t.chapter_id))], 100)) {
    for (const c of must(await admin.from("curriculum_chapters").select("id, chapter_name, unit_id").in("id", ids)) as any[]) chapters.set(c.id, { name: c.chapter_name, book_id: null });
  }
  return { topics, chapters };
}

const toProgress = (r: any): Progress => ({
  times_seen: r.times_seen, times_correct: r.times_correct, interval_days: r.interval_days, repetitions: r.repetitions,
  last_rating: r.last_rating, due_at: r.due_at, ease_factor: Number(r.ease_factor), lapses: r.lapses,
});

function previewFor(p: Progress | null, now: Date) {
  const out: Record<string, string> = {};
  for (const rating of ["easy", "medium", "difficult"] as Rating[]) {
    const n = nextSchedule(p && p.times_seen > 0 ? { ease_factor: Number(p.ease_factor ?? 2.5), interval_days: p.interval_days, repetitions: p.repetitions, lapses: p.lapses ?? 0 } : null, rating, now);
    out[rating] = intervalLabel(now, n.due_at);
  }
  return out;
}

// ── study ─────────────────────────────────────────────────────────────────────────────────────────

async function study(admin: any, s: Ctx, body: any) {
  const now = new Date();
  const limit = Math.max(1, Math.min(MAX_QUEUE, Math.round(Number(body?.limit ?? 20)) || 20));
  const filter: { topicId?: number; chapterId?: number; bookIds?: number[] } = {};
  if (body?.topic_id != null) filter.topicId = Number(body.topic_id);
  else if (body?.chapter_id != null) filter.chapterId = Number(body.chapter_id);
  else if (body?.subject) {
    const g = groupSubjects(await loadClassBooks(admin, s)).get(subjectKey(String(body.subject).slice(0, 80)));
    if (!g) throw new HttpError(400, "That isn't one of your subjects", "subject_not_available");
    filter.bookIds = g.bookIds;
  }

  const deck = await loadDeck(admin, s.studentId, filter);
  const rows = deck.map((r) => ({ id: r.flashcard_id as string, progress: r.times_seen > 0 ? toProgress(r) : null, row: r }));

  const mode = body?.mode === "practice" ? "practice" : "due";
  // Right after making cards the student wants to see them all; otherwise a few new cards are mixed into the due ones.
  const newLimit = Math.max(0, Math.min(MAX_CARDS, Math.round(Number(body?.new_limit ?? NEW_CARDS_PER_SESSION)) || 0));
  const picked = mode === "practice"
    ? shuffled(rows).slice(0, limit)
    : orderStudyQueue(rows, now, limit, newLimit);

  const { topics, chapters } = await namesFor(admin, picked.map((p) => p.row.flashcards.topic_id));
  const dueTotal = rows.filter((r) => r.progress && new Date(r.progress.due_at) <= now).length;
  const newTotal = rows.filter((r) => !r.progress).length;
  return {
    mode, count: picked.length, due_total: dueTotal, new_total: newTotal, deck_total: rows.length,
    cards: picked.map(({ row, progress }) => {
      const c = row.flashcards;
      const t = topics.get(c.topic_id);
      return {
        id: c.id, card_type: c.card_type, question: c.question, answer: c.answer, hint: c.hint, difficulty: c.difficulty,
        topic_id: c.topic_id, topic_name: t?.name ?? null, chapter_name: t ? chapters.get(t.chapter_id)?.name ?? null : null,
        source_pages: c.source_pages ?? [], grounding: c.grounding,
        state: cardState(progress ?? { times_seen: 0, times_correct: 0, interval_days: 0, repetitions: 0, last_rating: null, due_at: now }),
        times_seen: row.times_seen, times_correct: row.times_correct, last_rating: row.last_rating,
        preview: previewFor(progress, now),
      };
    }),
  };
}

// ── rate ──────────────────────────────────────────────────────────────────────────────────────────

async function rate(admin: any, s: Ctx, body: any) {
  const cardId = String(body?.flashcard_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(cardId)) throw new HttpError(400, "flashcard_id is required", "bad_request");
  if (!isRating(body?.rating)) throw new HttpError(400, "rating must be easy, medium or difficult", "bad_rating");
  const rating = body.rating as Rating;
  const session = typeof body?.session_id === "string" ? body.session_id.slice(0, 64) : null;

  const row = must(await admin.from("student_flashcards").select(`${PROGRESS_COLS}, flashcards!inner(id, status, learning_objective_id)`)
    .eq("student_id", s.studentId).eq("flashcard_id", cardId).maybeSingle());
  if (!row || row.flashcards?.status !== "active") throw new HttpError(404, "That card isn't in your deck", "not_in_deck");

  const now = new Date();
  const prev = row.times_seen > 0 || row.repetitions > 0
    ? { ease_factor: Number(row.ease_factor), interval_days: row.interval_days, repetitions: row.repetitions, lapses: row.lapses }
    : null;
  const next = nextSchedule(prev, rating, now);

  const patch = {
    ease_factor: next.ease_factor, interval_days: next.interval_days, repetitions: next.repetitions, lapses: next.lapses,
    times_seen: row.times_seen + 1, times_correct: row.times_correct + (next.correct ? 1 : 0),
    easy_count: row.easy_count + (rating === "easy" ? 1 : 0), medium_count: row.medium_count + (rating === "medium" ? 1 : 0),
    difficult_count: row.difficult_count + (rating === "difficult" ? 1 : 0),
    last_rating: rating, last_reviewed_at: now.toISOString(), due_at: next.due_at.toISOString(), updated_at: now.toISOString(),
  };
  // Optimistic lock on times_seen: a double-tap / retry / second tab can never rate the same view twice.
  const updated = must(await admin.from("student_flashcards").update(patch)
    .eq("id", row.id).eq("times_seen", row.times_seen).select("id")) as any[];
  if (!updated.length) {
    const cur = must(await admin.from("student_flashcards").select("due_at, interval_days, last_rating").eq("id", row.id).maybeSingle());
    return { duplicate: true, rating: cur?.last_rating ?? rating, due_at: cur?.due_at ?? next.due_at.toISOString(), interval_days: cur?.interval_days ?? next.interval_days, correct: next.correct, daily_review_pulled: false };
  }

  const hist = await admin.from("flashcard_reviews").insert({
    student_id: s.studentId, flashcard_id: cardId, rating, correct: next.correct,
    interval_before: row.interval_days, interval_after: next.interval_days, due_after: next.due_at.toISOString(), session_id: session,
  });
  if (hist.error) console.error("flashcard_reviews insert failed (non-fatal)", hist.error);

  // Daily Review: a Difficult card brings its learning objective's MCQ review forward (never pushes anything later).
  let pulled = false;
  const days = pullForwardDays(rating);
  const lo = row.flashcards?.learning_objective_id;
  if (days != null && lo != null) {
    const r = await admin.rpc("flashcard_pull_review_forward", { p_student_id: s.studentId, p_learning_objective_id: lo, p_days: days });
    if (r.error) console.error("flashcard_pull_review_forward failed (non-fatal)", r.error);
    else pulled = r.data === true;
  }

  return {
    duplicate: false, rating, correct: next.correct, due_at: next.due_at.toISOString(), interval_days: next.interval_days,
    next_label: intervalLabel(now, next.due_at), times_seen: patch.times_seen, times_correct: patch.times_correct, daily_review_pulled: pulled,
  };
}

// ── overview (home screen + Daily Review card) ────────────────────────────────────────────────────

const dayKey = (d: Date, tzMin: number) => new Date(d.getTime() - tzMin * 60_000).toISOString().slice(0, 10);

async function overview(admin: any, s: Ctx, body: any) {
  const now = new Date();
  const tz = Math.max(-840, Math.min(840, Math.round(Number(body?.tz_offset_minutes ?? 0)) || 0));   // minutes WEST of UTC, as Date.getTimezoneOffset()
  const deck = await loadDeck(admin, s.studentId);
  const stats = summarizeDeck(deck.map(toProgress), now);

  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const reviews = must(await admin.from("flashcard_reviews").select("rating, correct, reviewed_at").eq("student_id", s.studentId)
    .gte("reviewed_at", since).order("reviewed_at", { ascending: false }).limit(5000)) as any[];
  const perDay = new Map<string, { reviews: number; correct: number }>();
  for (const r of reviews) {
    const k = dayKey(new Date(r.reviewed_at), tz);
    const d = perDay.get(k) ?? { reviews: 0, correct: 0 };
    d.reviews += 1; d.correct += r.correct ? 1 : 0; perDay.set(k, d);
  }
  const recent_days = Array.from({ length: 7 }, (_, i) => {
    const k = dayKey(new Date(now.getTime() - (6 - i) * 86_400_000), tz);
    return { date: k, ...(perDay.get(k) ?? { reviews: 0, correct: 0 }) };
  });
  // streak: consecutive days with a review, ending today (or yesterday - today is still open)
  let streak = 0;
  for (let i = perDay.has(dayKey(now, tz)) ? 0 : 1; i < 31; i++) {
    if (perDay.has(dayKey(new Date(now.getTime() - i * 86_400_000), tz))) streak += 1; else break;
  }

  const byTopic = new Map<number, { total: number; due: number; mastered: number; seen: number; correct: number; newCards: number }>();
  for (const r of deck) {
    const t = r.flashcards.topic_id;
    const g = byTopic.get(t) ?? { total: 0, due: 0, mastered: 0, seen: 0, correct: 0, newCards: 0 };
    const p = toProgress(r);
    g.total += 1; g.seen += r.times_seen; g.correct += r.times_correct;
    if (r.times_seen === 0) g.newCards += 1;
    else if (new Date(r.due_at) <= now) g.due += 1;
    if (cardState(p) === "mastered") g.mastered += 1;
    byTopic.set(t, g);
  }
  const { topics, chapters } = await namesFor(admin, [...byTopic.keys()]);
  const decks = [...byTopic.entries()].map(([topic_id, g]) => {
    const t = topics.get(topic_id);
    return {
      topic_id, topic_name: t?.name ?? "Topic", chapter_id: t?.chapter_id ?? null, chapter_name: t ? chapters.get(t.chapter_id)?.name ?? null : null,
      total: g.total, due: g.due, new: g.newCards, mastered: g.mastered, accuracy: g.seen ? Math.round((g.correct / g.seen) * 100) : null,
    };
  }).sort((a, b) => b.due - a.due || b.new - a.new || a.topic_name.localeCompare(b.topic_name));

  const weak_topics = decks.filter((d) => d.accuracy != null && d.total >= 3).sort((a, b) => (a.accuracy! - b.accuracy!)).slice(0, 3)
    .filter((d) => d.accuracy! < 70);

  return { stats, recent_days, streak, decks, weak_topics, new_per_session: NEW_CARDS_PER_SESSION };
}

// ── report ────────────────────────────────────────────────────────────────────────────────────────

async function report(admin: any, s: Ctx, body: any) {
  const cardId = String(body?.flashcard_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(cardId)) throw new HttpError(400, "flashcard_id is required", "bad_request");
  const row = must(await admin.from("student_flashcards").select("id").eq("student_id", s.studentId).eq("flashcard_id", cardId).maybeSingle());
  if (!row) throw new HttpError(404, "That card isn't in your deck", "not_in_deck");
  must(await admin.from("student_flashcards").update({ reported: true, updated_at: new Date().toISOString() }).eq("id", row.id).select("id"));

  // Recount from the source of truth (idempotent), retire the card for everyone once enough different students flag it.
  const n = (await admin.from("student_flashcards").select("id", { count: "exact", head: true }).eq("flashcard_id", cardId).eq("reported", true)).count ?? 1;
  const retire = n >= MAX_REPORTS_BEFORE_RETIRE;
  must(await admin.from("flashcards").update({ report_count: n, ...(retire ? { status: "retired" } : {}), updated_at: new Date().toISOString() }).eq("id", cardId).select("id"));
  return { reported: true, retired: retire };
}

// ── entry ─────────────────────────────────────────────────────────────────────────────────────────

export async function handleFlashcards(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const s = await resolveStudent(admin, user.id);

    switch (body?.action) {
      case "catalog": return json(await catalog(admin, s, body));
      case "generate": return json(await generate(admin, s, body));
      case "study": return json(await study(admin, s, body));
      case "rate": return json(await rate(admin, s, body));
      case "overview": return json(await overview(admin, s, body));
      case "report": return json(await report(admin, s, body));
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof Unavailable) return json({ error: "Flashcards aren't set up yet (apply migration 20261030000000).", code: "persistence_unavailable" }, 503);
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    // gamificationQuestions' own errors (thrown by the shared book loader) carry a status too
    const any = e as any;
    if (any && typeof any.status === "number" && any.status >= 400 && any.status < 600) return json({ error: any.message, code: any.code }, any.status);
    console.error("flashcards handler error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
