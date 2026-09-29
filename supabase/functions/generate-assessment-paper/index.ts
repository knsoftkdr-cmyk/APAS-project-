// supabase/functions/generate-assessment-paper/index.ts
//
// Deploy with:
//   supabase functions deploy generate-assessment-paper
//
// Staff only. Takes a blueprint (saved, or inline) and ASSEMBLES a real exam
// from your existing item banks - question_bank for MCQs, question_bank_extended
// for descriptive/case-based/HOTS/scenario/competency - to match:
//   - syllabus weightage   marks per chapter/topic
//   - question-type mix    how many marks come from each format
//   - difficulty mix       easy/medium/hard, applied within each type
//   - Bloom's taxonomy     used as a soft preference during selection (a hard
//                          three-way chapter × difficulty × bloom quota
//                          fragments into cells no finite bank can fill -
//                          see the long comment below)
//
// This is selection, not generation: it never writes a new question, only
// assembles from items that already exist and are `status = 'active'`.
// Prefers un-flagged, higher quality_score items; never spends a
// quality_flag = 'reject' item.
//
//   Body: {
//     blueprint_id?: uuid          -- use a saved blueprint
//     blueprint?: { ... }          -- OR an inline blueprint (see shape below);
//                                     required if blueprint_id is omitted
//     save_as_blueprint?: boolean  -- persist the inline blueprint for reuse
//     title?: string               -- defaults to "<blueprint title> - <date>"
//   }
//
//   Exam Simulation: instead of hand-building a blueprint, pass
//     exam_pattern_code: "cbse_10_science" | "cbse_10_maths_standard" | "unit_test_25" |
//                        "half_yearly_50" | "annual_100" | <a custom pattern code>
//     syllabus_weightage: [...]     -- which chapters/topics the mock covers (required)
//     title?: string
//   The pattern supplies total marks, duration, the section structure (e.g.
//   20 x 1-mark MCQ, 6 x 2-mark ..., case-based sections), Bloom and difficulty
//   mix, and the printed exam instructions. Each pattern section stays its own
//   section on the paper, even when two sections share a question type.
//   List patterns with: { list_exam_patterns: true }.
//
//   Inline blueprint shape:
//   {
//     title: string, subject?: string,
//     syllabus_weightage: [{ scope_type: "chapter"|"topic", scope_id: number, label?: string, weight_pct: number }],
//     total_marks: number, duration_minutes?: number,
//     bloom_distribution?: { remember?, understand?, apply?, analyze?, evaluate?, create?: number },  // percentages
//     difficulty_distribution?: { easy?, medium?, hard?: number },                                     // percentages
//     question_type_mix: [{ question_type: "mcq"|"descriptive"|"case_based"|"hots"|"scenario"|"competency", marks_per_item: number, total_marks: number }]
//   }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];
const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const BLOOM_LEVELS = ["remember", "understand", "apply", "analyze", "evaluate", "create"] as const;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

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
    if (!profile || !STAFF_ROLES.includes(profile.role)) return json({ error: "Not permitted to generate assessments" }, 403);

    const body = await req.json().catch(() => ({}));

    if (body.list_exam_patterns === true) {
      const { data, error } = await admin.from("exam_pattern_templates")
        .select("code, name, board, grade, subject, description, total_marks, duration_minutes, question_type_mix, bloom_distribution, difficulty_distribution, instructions, is_system")
        .eq("status", "active").order("is_system", { ascending: false }).order("name");
      if (error) throw new Error(error.message);
      return json({ patterns: data ?? [] });
    }

    // ── Load or validate the blueprint ───────────────────────────────
    let blueprint: Row;
    let blueprintId: string | null = null;
    let examPatternCode: string | null = null;
    if (body.exam_pattern_code) {
      const { data: pattern } = await admin.from("exam_pattern_templates").select("*")
        .eq("code", body.exam_pattern_code).eq("status", "active").maybeSingle();
      if (!pattern) return json({ error: `Unknown exam pattern "${body.exam_pattern_code}"` }, 404);
      if (!Array.isArray(body.syllabus_weightage) || !body.syllabus_weightage.length) {
        return json({ error: "syllabus_weightage is required with exam_pattern_code - say which chapters/topics the mock should cover" }, 400);
      }
      for (const w of body.syllabus_weightage) {
        if (!(Number(w?.scope_id) > 0) || !(Number(w?.weight_pct) > 0)) return json({ error: "each syllabus_weightage entry needs a scope_id and a positive weight_pct" }, 400);
      }
      blueprint = {
        title: body.title || pattern.name, subject: body.subject ?? pattern.subject ?? null,
        syllabus_weightage: body.syllabus_weightage, total_marks: pattern.total_marks,
        duration_minutes: pattern.duration_minutes, bloom_distribution: pattern.bloom_distribution ?? {},
        difficulty_distribution: pattern.difficulty_distribution ?? {}, question_type_mix: pattern.question_type_mix,
        instructions: pattern.instructions ?? [], exam_pattern_code: pattern.code,
      };
      const validation = validateBlueprint(blueprint);
      if (validation) return json({ error: validation }, 500);
      examPatternCode = pattern.code;
      if (body.save_as_blueprint === true) {
        const { data, error } = await admin.from("assessment_blueprints").insert({
          title: blueprint.title, subject: blueprint.subject, syllabus_weightage: blueprint.syllabus_weightage,
          total_marks: blueprint.total_marks, duration_minutes: blueprint.duration_minutes,
          bloom_distribution: blueprint.bloom_distribution, difficulty_distribution: blueprint.difficulty_distribution,
          question_type_mix: blueprint.question_type_mix, exam_pattern_code: pattern.code,
          instructions: blueprint.instructions, created_by: user.id,
        }).select("id").single();
        if (error) throw new Error(`Could not save blueprint: ${error.message}`);
        blueprintId = data.id;
      }
    } else if (body.blueprint_id) {
      const { data, error } = await admin.from("assessment_blueprints").select("*").eq("id", body.blueprint_id).single();
      if (error || !data) return json({ error: "Blueprint not found" }, 404);
      blueprint = data;
      blueprintId = data.id;
      examPatternCode = data.exam_pattern_code ?? null;
    } else if (body.blueprint) {
      const validation = validateBlueprint(body.blueprint);
      if (validation) return json({ error: validation }, 400);
      blueprint = body.blueprint;
      if (body.save_as_blueprint === true) {
        const { data, error } = await admin.from("assessment_blueprints").insert({
          title: blueprint.title, subject: blueprint.subject ?? null,
          syllabus_weightage: blueprint.syllabus_weightage, total_marks: blueprint.total_marks,
          duration_minutes: blueprint.duration_minutes ?? null,
          bloom_distribution: blueprint.bloom_distribution ?? {}, difficulty_distribution: blueprint.difficulty_distribution ?? {},
          question_type_mix: blueprint.question_type_mix, created_by: user.id,
        }).select("id").single();
        if (error) throw new Error(`Could not save blueprint: ${error.message}`);
        blueprintId = data.id;
      }
    } else {
      return json({ error: "Provide either blueprint_id or an inline blueprint" }, 400);
    }

    // ── Resolve syllabus scopes to subtopic ids ──────────────────────
    const scopeSubtopics = await resolveScopes(admin, blueprint.syllabus_weightage);
    if (!scopeSubtopics.length) return json({ error: "None of the blueprint's syllabus scopes resolved to any concepts" }, 404);

    const totalWeight = scopeSubtopics.reduce((s, sc) => s + sc.weightPct, 0) || 100;
    for (const sc of scopeSubtopics) sc.weightPct = (sc.weightPct / totalWeight) * 100; // normalize to 100

    const bloomTarget = normalizePct(blueprint.bloom_distribution, BLOOM_LEVELS);
    const difficultyTarget = normalizePct(blueprint.difficulty_distribution, DIFFICULTIES);

    // ── Assemble, one question-type bucket at a time ─────────────────
    const usedItemIds = new Set<string>();
    const bloomTally: Record<string, number> = Object.fromEntries(BLOOM_LEVELS.map((b) => [b, 0]));
    const selected: Row[] = [];
    const shortfalls: Row[] = [];

    for (const mix of blueprint.question_type_mix as Row[]) {
      const marksPerItem = Number(mix.marks_per_item);
      const nWanted = Math.max(0, Math.round(Number(mix.total_marks) / marksPerItem));
      if (nWanted === 0) continue;

      const perScopeCounts = largestRemainderAllocate(nWanted, scopeSubtopics.map((s) => s.weightPct));
      const perDifficultyCounts = largestRemainderAllocate(nWanted, DIFFICULTIES.map((d) => difficultyTarget[d]));
      const difficultyPool = expandCounts(DIFFICULTIES, perDifficultyCounts); // e.g. ["easy","easy","medium",...]

      let diffCursor = 0;
      for (let i = 0; i < scopeSubtopics.length; i++) {
        const scope = scopeSubtopics[i];
        const nForScope = perScopeCounts[i];
        for (let k = 0; k < nForScope; k++) {
          const preferredDifficulty = difficultyPool[diffCursor % difficultyPool.length] ?? "medium";
          diffCursor++;

          const picked = await pickBestItem(admin, {
            questionType: mix.question_type, subtopicIds: scope.subtopicIds,
            preferredDifficulty, bloomTarget, bloomTally, exclude: usedItemIds, slotMarks: marksPerItem,
          });

          if (picked) {
            usedItemIds.add(picked.id);
            bloomTally[picked.bloom_level ?? "apply"] = (bloomTally[picked.bloom_level ?? "apply"] ?? 0) + 1;
            selected.push({
              item_table: mix.question_type === "mcq" ? "question_bank" : "question_bank_extended",
              item_id: picked.id, marks: marksPerItem, question_type: mix.question_type,
              section_label: mix.section_label ?? null, bank_max_marks: picked.max_marks ?? null,
              difficulty: picked.difficulty, bloom_level: picked.bloom_level, scope_label: scope.label,
            });
          } else {
            shortfalls.push({
              question_type: mix.question_type, difficulty: preferredDifficulty, chapter: scope.label,
              needed: 1, found: 0, reason: `Not enough active, unused ${mix.question_type} items of ${preferredDifficulty} difficulty for "${scope.label}"`,
            });
          }
        }
      }
    }

    if (!selected.length) return json({ error: "Could not assemble any items - the item bank may be empty for this scope. Generate items first." }, 404);

    // ── Persist paper + items ────────────────────────────────────────
    const assembledMarks = selected.reduce((s, it) => s + it.marks, 0);
    const coverageReport = buildCoverageReport(blueprint, scopeSubtopics, selected, bloomTarget, difficultyTarget, shortfalls);

    const { data: paper, error: paperErr } = await admin.from("generated_assessment_papers").insert({
      blueprint_id: blueprintId, title: body.title || `${blueprint.title} - ${new Date().toISOString().slice(0, 10)}`,
      status: "draft", target_total_marks: blueprint.total_marks, assembled_total_marks: assembledMarks,
      coverage_report: coverageReport, generated_by: user.id,
      exam_pattern_code: examPatternCode, instructions: blueprint.instructions ?? [],
    }).select().single();
    if (paperErr) throw new Error(paperErr.message);

    const rows = selected.map((it, idx) => ({
      paper_id: paper.id,
      mcq_item_id: it.item_table === "question_bank" ? it.item_id : null,
      extended_item_id: it.item_table === "question_bank_extended" ? it.item_id : null,
      section_label: it.section_label || sectionLabelFor(it.question_type), marks: it.marks, order_index: idx,
    }));
    const { error: itemsErr } = await admin.from("generated_assessment_paper_items").insert(rows);
    if (itemsErr) throw new Error(itemsErr.message);

    return json({
      paper_id: paper.id, blueprint_id: blueprintId, exam_pattern_code: examPatternCode,
      duration_minutes: blueprint.duration_minutes ?? null, assembled_total_marks: assembledMarks,
      item_count: selected.length, coverage_report: coverageReport,
    });
  } catch (e) {
    console.error("generate-assessment-paper error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Blueprint validation (inline blueprints only - saved ones were already validated on save)

function validateBlueprint(b: Row): string | null {
  if (!b?.title) return "blueprint.title is required";
  if (!Array.isArray(b.syllabus_weightage) || !b.syllabus_weightage.length) return "blueprint.syllabus_weightage must be a non-empty array";
  if (!(Number(b.total_marks) > 0)) return "blueprint.total_marks must be a positive number";
  if (!Array.isArray(b.question_type_mix) || !b.question_type_mix.length) return "blueprint.question_type_mix must be a non-empty array";
  for (const m of b.question_type_mix) {
    if (!(Number(m.marks_per_item) > 0) || !(Number(m.total_marks) > 0)) return `question_type_mix entry for "${m.question_type}" needs positive marks_per_item and total_marks`;
    if (Math.abs(Number(m.total_marks) / Number(m.marks_per_item) - Math.round(Number(m.total_marks) / Number(m.marks_per_item))) > 1e-9) return `question_type_mix entry for "${m.question_type}": total_marks must be a whole multiple of marks_per_item`;
  }
  const mixTotal = b.question_type_mix.reduce((s: number, m: Row) => s + Number(m.total_marks), 0);
  if (Math.abs(mixTotal - Number(b.total_marks)) > 0.01) return `question_type_mix marks (${mixTotal}) must sum to total_marks (${b.total_marks})`;
  return null;
}

function normalizePct(dist: Row | null | undefined, keys: readonly string[]): Record<string, number> {
  const raw = keys.map((k) => Math.max(0, Number(dist?.[k]) || 0));
  const sum = raw.reduce((s, v) => s + v, 0);
  if (sum <= 0) { const even = 100 / keys.length; return Object.fromEntries(keys.map((k) => [k, even])); }
  return Object.fromEntries(keys.map((k, i) => [k, (raw[i] / sum) * 100]));
}

// ─────────────────────────────────────────────────────────────────────────
// Scope resolution: chapter/topic -> subtopic ids, keeping the declared weight

interface ScopeGroup { label: string; weightPct: number; subtopicIds: number[] }

async function resolveScopes(admin: ReturnType<typeof createClient>, weightage: Row[]): Promise<ScopeGroup[]> {
  const groups: ScopeGroup[] = [];
  for (const w of weightage) {
    let subtopicIds: number[] = [];
    if (w.scope_type === "topic") {
      const { data } = await admin.from("subtopics").select("id").eq("topic_id", w.scope_id);
      subtopicIds = (data ?? []).map((s: Row) => s.id);
    } else { // "chapter" (default)
      const { data: topics } = await admin.from("topics").select("id").eq("chapter_id", w.scope_id);
      const topicIds = (topics ?? []).map((t: Row) => t.id);
      if (topicIds.length) {
        const { data: subs } = await admin.from("subtopics").select("id").in("topic_id", topicIds);
        subtopicIds = (subs ?? []).map((s: Row) => s.id);
      }
    }
    if (subtopicIds.length) groups.push({ label: w.label || `scope ${w.scope_id}`, weightPct: Number(w.weight_pct) || 0, subtopicIds });
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────────────────
// Allocation helpers

/** Rounds shares of `total` proportional to `weights`, guaranteeing the parts sum to exactly `total`. */
function largestRemainderAllocate(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((s, w) => s + w, 0) || 1;
  const raw = weights.map((w) => (w / sumW) * total);
  const floors = raw.map(Math.floor);
  let remaining = total - floors.reduce((s, f) => s + f, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (let k = 0; k < remaining && k < order.length; k++) out[order[k].i]++;
  return out;
}

function expandCounts<T>(labels: readonly T[], counts: number[]): T[] {
  const out: T[] = [];
  labels.forEach((label, i) => { for (let k = 0; k < counts[i]; k++) out.push(label); });
  return out;
}

function sectionLabelFor(type: string): string {
  const labels: Record<string, string> = {
    mcq: "Section A - Multiple Choice", descriptive: "Section B - Short/Long Answer", case_based: "Section C - Case-Based",
    hots: "Section D - Higher-Order Thinking", scenario: "Section E - Scenario-Based", competency: "Section F - Competency-Based",
  };
  return labels[type] ?? `Section - ${type}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Item selection
//
// Bloom's taxonomy is applied here as a SOFT preference rather than a hard
// per-(chapter,difficulty) quota. A rigid three-way quota (e.g. "exactly 1
// hard, analyze-level, case-based item from chapter 4") creates cells a
// finite item bank usually can't fill even when it has plenty of items
// overall. Instead: within the (type, chapter, difficulty) bucket the
// syllabus weightage and difficulty mix already narrowed to, prefer whichever
// available item's Bloom level is currently furthest BELOW its target share
// of the paper so far - the running mix is nudged toward the blueprint's
// Bloom distribution without ever blocking on an empty cell.

async function pickBestItem(
  admin: ReturnType<typeof createClient>,
  opts: { questionType: string; subtopicIds: number[]; preferredDifficulty: string; bloomTarget: Record<string, number>; bloomTally: Record<string, number>; exclude: Set<string>; slotMarks?: number },
): Promise<Row | null> {
  const table = opts.questionType === "mcq" ? "question_bank" : "question_bank_extended";
  const cols = table === "question_bank"
    ? "id, difficulty, bloom_level, quality_score, quality_flag, review_flag, distractor_flag, status, subtopic_id"
    : "id, difficulty, bloom_level, quality_score, quality_flag, calibration_flag, status, subtopic_id, question_type, max_marks";

  let q = admin.from(table).select(cols).in("subtopic_id", opts.subtopicIds).eq("status", "active").eq("difficulty", opts.preferredDifficulty);
  if (table === "question_bank_extended") q = q.eq("question_type", opts.questionType);
  if (table === "question_bank") q = q.or("quality_flag.is.null,quality_flag.neq.reject").or("review_flag.is.null,review_flag.eq.ok");
  else q = q.or("quality_flag.is.null,quality_flag.neq.reject");

  let { data: candidates } = await q;
  candidates = (candidates ?? []).filter((c: Row) => !opts.exclude.has(c.id));

  // Fall back to any active difficulty in scope if the preferred band is exhausted -
  // hitting the marks total and syllabus weighting matters more than the exact
  // difficulty label on any single item.
  if (!candidates.length) {
    let q2 = admin.from(table).select(cols).in("subtopic_id", opts.subtopicIds).eq("status", "active");
    if (table === "question_bank_extended") q2 = q2.eq("question_type", opts.questionType);
    // Same quality gates as the primary query - a fallback must never spend a rejected item.
    if (table === "question_bank") q2 = q2.or("quality_flag.is.null,quality_flag.neq.reject").or("review_flag.is.null,review_flag.eq.ok");
    else q2 = q2.or("quality_flag.is.null,quality_flag.neq.reject");
    const { data: fallback } = await q2;
    candidates = (fallback ?? []).filter((c: Row) => !opts.exclude.has(c.id));
  }
  if (!candidates.length) return null;

  const totalTallied = Object.values(opts.bloomTally).reduce((s, v) => s + v, 0) || 1;
  const bloomGap = (level: string | null) => {
    const l = level ?? "apply";
    const targetShare = (opts.bloomTarget[l] ?? 0) / 100;
    const actualShare = (opts.bloomTally[l] ?? 0) / totalTallied;
    return targetShare - actualShare; // bigger = more under-represented = more desirable
  };

  // A bank item whose own max_marks equals the paper slot needs no rescaling
  // when graded, so it is a cleaner fit; prefer it before anything else.
  const slotFit = (c: Row) => (opts.slotMarks == null || c.max_marks == null || Number(c.max_marks) === opts.slotMarks) ? 0 : 1;
  candidates.sort((a: Row, b: Row) => {
    const fitDiff = slotFit(a) - slotFit(b);
    if (fitDiff !== 0) return fitDiff;
    const gapDiff = bloomGap(b.bloom_level) - bloomGap(a.bloom_level);
    if (Math.abs(gapDiff) > 0.02) return gapDiff;
    return (Number(b.quality_score) || 50) - (Number(a.quality_score) || 50);
  });

  return candidates[0];
}

// ─────────────────────────────────────────────────────────────────────────
// Coverage report

function buildCoverageReport(blueprint: Row, scopes: ScopeGroup[], selected: Row[], bloomTarget: Row, difficultyTarget: Row, shortfalls: Row[]): Row {
  const totalMarks = selected.reduce((s, it) => s + it.marks, 0) || 1;

  const bloomActual: Row = {};
  const difficultyActual: Row = {};
  for (const it of selected) {
    const b = it.bloom_level ?? "apply", d = it.difficulty ?? "medium";
    bloomActual[b] = (bloomActual[b] ?? 0) + it.marks;
    difficultyActual[d] = (difficultyActual[d] ?? 0) + it.marks;
  }
  for (const k of Object.keys(bloomActual)) bloomActual[k] = round1((bloomActual[k] / totalMarks) * 100);
  for (const k of Object.keys(difficultyActual)) difficultyActual[k] = round1((difficultyActual[k] / totalMarks) * 100);

  const syllabus = scopes.map((sc) => {
    const actualMarks = selected.filter((it) => it.scope_label === sc.label).reduce((s, it) => s + it.marks, 0);
    return { label: sc.label, target_marks: round1((sc.weightPct / 100) * Number(blueprint.total_marks)), actual_marks: actualMarks };
  });

  const targetMarksAssembled = Number(blueprint.total_marks);
  const matchScore = Math.max(0, Math.round(100 - (Math.abs(targetMarksAssembled - totalMarks) / targetMarksAssembled) * 100 - shortfalls.length * 2));

  return {
    bloom: { target: roundObj(bloomTarget), actual: bloomActual },
    difficulty: { target: roundObj(difficultyTarget), actual: difficultyActual },
    syllabus,
    match_score: matchScore,
    shortfalls,
  };
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function roundObj(o: Row) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round1(Number(v))])); }