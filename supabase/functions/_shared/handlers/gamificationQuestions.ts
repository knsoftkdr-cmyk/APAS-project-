// supabase/functions/_shared/handlers/gamificationQuestions.ts
//
// Class-strict, never-repeating questions for every Gamification game.
//
// Not a standalone edge function (deployment limit): `update-mastery` routes to this handler via its `action`
// field - see _shared/mergedRouter.ts and CONSOLIDATION.md.
//
//   action "gq_context"  Body: {}                                              -> the student's class (from the DB) + subjects taught to it
//   action "gq_serve"    Body: { game_type, subject?|mode:"generic", session_id? } -> fresh items for one game, recorded as served
//
// Access: students only, own data only. The class, school and curriculum ALWAYS come from the database for the
// verified JWT's user (class enrolment -> students.grade -> profiles.class_grade); the body can never choose them.
// Needs migration 20261029000000 (else 503 `persistence_unavailable`). AI generation reuses _shared/aiClient.ts
// (the same Gemini keys as generate-mcqs / generate-item-bank); without a key the game still serves unseen
// question_bank + pooled items and says plainly when it runs out.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAi, getAiConfig } from "../aiClient.ts";
import {
  bandForGrade, buildGenerationPrompt, candidatesFromGenerated, classKey as toClassKey, classLabel, difficultyFromAccuracy,
  exhaustedMessage, fingerprintOf, gradeLevel, isGameType, normalizeText, parseGeneratedItems, serveItems, serveSpec, shuffled,
  subjectKey, validateItem, type Candidate, type GameType, type ServeDeps,
} from "../gamificationQuestionModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class Unavailable extends Error {}
class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }

function tableMissing(err: any): boolean {
  const msg = String(err?.message ?? "");
  return ["42P01", "42883", "PGRST205", "PGRST202", "42703"].includes(err?.code) || /does not exist|schema cache|could not find the function/i.test(msg);
}
function must(res: { data: any; error: any }): any {
  if (res.error) { if (tableMissing(res.error)) throw new Unavailable(); throw res.error; }
  return res.data;
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const chunk = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// ── who is asking, and which class they are REALLY in ─────────────────────────────────────────────

interface StudentCtx {
  userId: string;
  schoolId: string | null;
  curriculum: string | null;
  classKey: string;
  level: number;
  label: string;
}

async function resolveStudent(admin: any, userId: string): Promise<StudentCtx> {
  const profile = must(await admin.from("profiles").select("role, school_id, class_grade").eq("id", userId).maybeSingle());
  if (profile?.role !== "student") throw new HttpError(403, "Gamification is for students");

  const student = must(await admin.from("students").select("id, grade, curriculum").eq("profile_id", userId).maybeSingle());

  // Enrolment first (the class the school put them in), then the students / profiles records - same order as get_next_best_action.
  let raw: string | null = null;
  if (student?.id) {
    const enrol = must(await admin.from("class_students").select("assigned_at, classes(name)").eq("student_id", student.id)
      .order("assigned_at", { ascending: false }).limit(1));
    raw = enrol?.[0]?.classes?.name ?? null;
  }
  raw = raw || (student?.grade ? String(student.grade).trim() : "") || (profile?.class_grade ? String(profile.class_grade).trim() : "") || null;

  const key = toClassKey(raw);
  const level = key ? gradeLevel(key) : null;
  if (!raw || !key || level == null) {
    throw new HttpError(422, "We couldn't find your class yet. Please ask your school admin to assign you to a class.", "class_unrecognised");
  }
  return {
    userId, schoolId: profile.school_id ?? null, curriculum: student?.curriculum ? String(student.curriculum).trim() : null,
    classKey: key, level, label: classLabel(key),
  };
}

// ── subjects + curriculum for exactly this class (and school) ─────────────────────────────────────

interface BookRow { id: number; subject: string; curriculum: string | null }

async function loadClassBooks(admin: any, s: StudentCtx): Promise<BookRow[]> {
  const out: BookRow[] = [];
  for (let from = 0; ; from += 1000) {
    let q = admin.from("books").select("id, subject, class_name, curriculum").eq("is_active", true).order("id").range(from, from + 999);
    q = s.schoolId ? q.eq("school_id", s.schoolId) : q.is("school_id", null);     // never another school's books
    const rows = must(await q) as any[];
    for (const b of rows ?? []) {
      if (!b.subject || toClassKey(b.class_name) !== s.classKey) continue;           // exact class match only
      if (s.curriculum && b.curriculum && normalizeText(s.curriculum) !== normalizeText(b.curriculum)) continue; // permitted curriculum
      out.push({ id: b.id, subject: String(b.subject).trim(), curriculum: b.curriculum ?? null });
    }
    if (!rows || rows.length < 1000) break;
  }
  return out;
}

function groupSubjects(books: BookRow[]): Map<string, { key: string; label: string; bookIds: number[]; curriculum: string | null }> {
  const m = new Map<string, { key: string; label: string; bookIds: number[]; curriculum: string | null }>();
  for (const b of books) {
    const k = subjectKey(b.subject);
    const g = m.get(k) ?? { key: k, label: b.subject, bookIds: [], curriculum: b.curriculum };
    g.bookIds.push(b.id);
    m.set(k, g);
  }
  return m;
}

interface Curriculum { topics: string[]; objectives: string[]; subtopicIds: number[] }

async function loadCurriculum(admin: any, bookIds: number[]): Promise<Curriculum> {
  const empty: Curriculum = { topics: [], objectives: [], subtopicIds: [] };
  if (!bookIds.length) return empty;
  const units = must(await admin.from("units").select("id").in("book_id", bookIds).eq("is_active", true)) as any[];
  const unitIds = (units ?? []).map((u) => u.id);
  const chapterIds: number[] = [];
  for (const ids of chunk(unitIds, 100)) {
    const r = must(await admin.from("curriculum_chapters").select("id").in("unit_id", ids).eq("is_active", true)) as any[];
    chapterIds.push(...(r ?? []).map((c) => c.id));
  }
  const topics: { id: number; name: string }[] = [];
  for (const ids of chunk(chapterIds, 100)) {
    const r = must(await admin.from("topics").select("id, topic_name").in("chapter_id", ids)) as any[];
    topics.push(...(r ?? []).map((t) => ({ id: t.id, name: t.topic_name })));
    if (topics.length >= 400) break;
  }
  const subtopicIds: number[] = [];
  for (const ids of chunk(topics.map((t) => t.id), 100)) {
    const r = must(await admin.from("subtopics").select("id").in("topic_id", ids).eq("is_active", true)) as any[];
    subtopicIds.push(...(r ?? []).map((x) => x.id));
    if (subtopicIds.length >= 800) break;
  }
  const objectives: string[] = [];
  for (const ids of chunk(shuffled(subtopicIds).slice(0, 200), 100)) {
    const r = must(await admin.from("learning_objectives").select("objective_text").in("subtopic_id", ids).eq("status", "active").limit(100)) as any[];
    objectives.push(...(r ?? []).map((o) => String(o.objective_text)));
  }
  return { topics: topics.map((t) => t.name).filter(Boolean), objectives, subtopicIds };
}

// ── candidates, history ───────────────────────────────────────────────────────────────────────────

/** Teacher-approved MCQs (question_bank, status 'active') for this class's curriculum - quick quiz only. */
async function loadBankCandidates(admin: any, cur: Curriculum, s: StudentCtx): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const letters = ["A", "B", "C", "D"];
  for (const ids of chunk(cur.subtopicIds.slice(0, 800), 100)) {
    const rows = must(await admin.from("question_bank").select("id, stem, options, correct_option")
      .in("subtopic_id", ids).eq("status", "active").limit(300)) as any[];
    for (const r of rows ?? []) {
      const opts = letters.map((l) => r.options?.[l]);
      const v = validateItem("quick-quiz",
        { question: r.stem, options: opts, correctIndex: letters.indexOf(r.correct_option) },
        { classKey: s.classKey, level: s.level }, { trusted: true });
      if (!v.ok) continue;
      out.push({ fingerprint: fingerprintOf("quick-quiz", v.item), payload: v.item, source: "bank", poolItemId: null, classKey: s.classKey });
    }
  }
  return out;
}

async function loadPoolCandidates(admin: any, s: StudentCtx, subKey: string, gameType: GameType): Promise<Candidate[]> {
  const rows = must(await admin.from("gamification_question_pool").select("id, fingerprint, payload, class_key")
    .eq("school_scope", s.schoolId ?? ZERO_UUID).eq("class_key", s.classKey).eq("subject_key", subKey)
    .eq("game_type", gameType).eq("status", "active").limit(1000)) as any[];
  return (rows ?? []).map((r) => ({ fingerprint: r.fingerprint, payload: r.payload, source: "pool" as const, poolItemId: r.id, classKey: r.class_key }));
}

async function loadSeen(admin: any, s: StudentCtx, subKey: string): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const rows = must(await admin.from("student_question_history").select("fingerprint")
      .eq("user_id", s.userId).eq("class_key", s.classKey).eq("subject_key", subKey).order("served_at").range(from, from + 999)) as any[];
    for (const r of rows ?? []) seen.add(r.fingerprint);
    if (!rows || rows.length < 1000) break;
  }
  return seen;
}

function readableStem(gameType: GameType, p: any): string {
  switch (gameType) {
    case "quick-quiz": return p.question;
    case "word-scramble": return p.word;
    case "match-pairs": return `${p.a} = ${p.b}`;
    case "category-sort": return `${p.leftLabel} / ${p.rightLabel}: ${p.rule}`;
    case "speed-tap": return p.instruction;
    case "visual-memory": return (p.items as string[]).join(", ");
  }
}

/** Observed average accuracy in this subject (the same signal selectGamesForStudent was meant to use) -> difficulty. */
async function studentDifficulty(admin: any, userId: string, subKey: string) {
  try {
    const rows = (await admin.from("gamification_events").select("subject, accuracy").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(40)).data as any[] | null;
    const acc = (rows ?? []).filter((r) => r.subject && subjectKey(String(r.subject)) === subKey && r.accuracy != null).slice(0, 10).map((r) => Number(r.accuracy));
    return difficultyFromAccuracy(acc.length ? acc.reduce((a, b) => a + b, 0) / acc.length : null);
  } catch { return difficultyFromAccuracy(null); }
}

// ── actions ───────────────────────────────────────────────────────────────────────────────────────

async function context(admin: any, userId: string) {
  const s = await resolveStudent(admin, userId);
  const subjects = [...groupSubjects(await loadClassBooks(admin, s)).values()]
    .map((g) => ({ key: g.key, label: g.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return {
    persistence: "available",
    class: { key: s.classKey, label: s.label },
    band: bandForGrade(s.level),
    subjects,
    message: subjects.length ? null : `No subjects have been set up for ${s.label} yet. Please ask your school admin.`,
  };
}

async function serve(admin: any, userId: string, body: any) {
  const gameType = body?.game_type;
  if (!isGameType(gameType)) throw new HttpError(400, "Unknown game type", "bad_game_type");
  const s = await resolveStudent(admin, userId);
  const session = typeof body?.session_id === "string" ? body.session_id.slice(0, 64) : "";

  const groups = groupSubjects(await loadClassBooks(admin, s));
  if (!groups.size) throw new HttpError(404, `No subjects have been set up for ${s.label} yet. Please ask your school admin.`, "no_subjects");

  // Subject: must be one of the subjects taught to THIS student's class. Generic mode picks the least-played one.
  let group;
  if (body?.mode === "generic" || !body?.subject) {
    const counts = new Map<string, number>();
    const rows = must(await admin.from("student_question_history").select("subject_key").eq("user_id", userId).eq("class_key", s.classKey).limit(5000)) as any[];
    for (const r of rows ?? []) counts.set(r.subject_key, (counts.get(r.subject_key) ?? 0) + 1);
    const pool = shuffled([...groups.values()]);
    group = pool.reduce((best, g) => ((counts.get(g.key) ?? 0) < (counts.get(best.key) ?? 0) ? g : best), pool[0]);
  } else {
    group = groups.get(subjectKey(String(body.subject).slice(0, 80)));
    if (!group) throw new HttpError(400, `${String(body.subject).slice(0, 40)} isn't a subject for ${s.label}.`, "subject_not_available");
  }

  const band = bandForGrade(s.level);
  const spec = serveSpec(gameType, band);
  const cur = await loadCurriculum(admin, group.bookIds);
  const difficulty = await studentDifficulty(admin, userId, group.key);
  let model: string | null = null;

  const deps: ServeDeps = {
    loadSeen: () => loadSeen(admin, s, group.key),

    loadCandidates: async () => {
      const pooled = await loadPoolCandidates(admin, s, group.key, gameType);
      const bank = gameType === "quick-quiz" ? await loadBankCandidates(admin, cur, s) : [];
      return [...bank, ...pooled];
    },

    generate: async (need) => {
      // Cheap guard against hammering the AI: another request created items for this exact pool in the last few seconds.
      const recent = (await admin.from("gamification_question_pool").select("created_at")
        .eq("school_scope", s.schoolId ?? ZERO_UUID).eq("class_key", s.classKey).eq("subject_key", group.key).eq("game_type", gameType)
        .order("created_at", { ascending: false }).limit(1)).data as any[] | null;
      if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < 8000) return [];

      const cfg = getAiConfig();                                             // throws when no key is configured -> graceful "failed"
      const existing = await loadPoolCandidates(admin, s, group.key, gameType);
      const avoid = existing.slice(-30).map((c) => String(readableStem(gameType, c.payload)).slice(0, 90));
      const material = shuffled([...cur.objectives, ...cur.topics]).slice(0, 14);
      const { system, prompt } = buildGenerationPrompt({
        gameType, classLabel: s.label, subject: group.label, difficulty, count: Math.min(need, 20),
        curriculum: material, avoid, seed: Math.floor(Math.random() * 1e6), curriculumName: group.curriculum ?? s.curriculum,
      });
      const res = await callAi(cfg, prompt, { system, temperature: 0.85, maxOutputTokens: 8192 });
      model = res.model;
      return candidatesFromGenerated(gameType, parseGeneratedItems(res.text), { classKey: s.classKey, level: s.level }).items;
    },

    savePool: async (items) => {
      const rows = items.map((c) => ({
        school_id: s.schoolId, school_scope: s.schoolId ?? ZERO_UUID, class_key: s.classKey, subject_key: group.key,
        subject_label: group.label, game_type: gameType, difficulty, fingerprint: c.fingerprint, payload: c.payload,
        source: "ai", generation_model: model, status: "active",
      }));
      const inserted = must(await admin.from("gamification_question_pool")
        .upsert(rows, { onConflict: "school_scope,class_key,subject_key,fingerprint", ignoreDuplicates: true })
        .select("fingerprint")) as any[];
      const fresh = new Set((inserted ?? []).map((r) => r.fingerprint));
      return items.filter((c) => fresh.has(c.fingerprint));                // only genuinely new items count as "created"
    },

    claim: async (items) => {
      const res = await admin.rpc("gq_claim_items", {
        p_user: userId, p_school: s.schoolId, p_class_key: s.classKey, p_subject_key: group.key, p_game_type: gameType, p_session: session,
        p_items: items.map((c) => ({ fingerprint: c.fingerprint, pool_item_id: c.poolItemId ?? null, source: c.source })),
      });
      return (must(res) as string[]) ?? [];
    },
  };

  const result = await serveItems(deps, spec, s.classKey);
  return {
    items: result.items.map((c) => c.payload),
    subject: group.label,
    class: { key: s.classKey, label: s.label },
    difficulty,
    meta: {
      served: result.served, requested: result.requested, short: result.short, exhausted: result.exhausted,
      generation: result.generation,
      sources: result.items.reduce((m: Record<string, number>, c) => ({ ...m, [c.source]: (m[c.source] ?? 0) + 1 }), {}),
    },
    message: result.exhausted ? exhaustedMessage(group.label, result.generation) : null,
  };
}

export async function handleGamificationQuestions(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    switch (body?.action) {
      case "context": return json(await context(admin, user.id));
      case "serve": return json(await serve(admin, user.id, body));
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof Unavailable) {
      return json({ error: "Question history isn't set up yet (apply migration 20261029000000).", code: "persistence_unavailable" }, 503);
    }
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error("gamificationQuestions handler error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
