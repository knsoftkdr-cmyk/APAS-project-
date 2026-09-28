// supabase/functions/_shared/runOpenEndedCalibration.ts
//
// The actual calibration work for question_bank_extended, factored out so it
// can run two ways without duplicating logic (same split as
// runCalibration.ts for the MCQ bank):
//   - interactively, from calibrate-open-ended-items (a signed-in staff
//     member, one scope)
//   - on a schedule, from calibrate-open-ended-items-cron (pg_cron, every
//     scope in turn)
//
// No IRT here - open-ended items are rubric-scored with partial credit, not
// a single right/wrong key, so there's no theta/discrimination to estimate.
// What's real and worth trusting is: what fraction of the available marks do
// students actually earn? That ratio, once enough students have answered,
// replaces the author's original easy/medium/hard guess.

// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;
type SupabaseAdmin = any;

export const SCOPE_TYPES = ["subtopic", "topic", "competency", "all"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

const MAX_ITEMS_PER_RUN = 300; // one run's worth of work; a bigger bank just gets caught over successive nights
const MIN_SAMPLE_DEFAULT = 5;

export interface OpenEndedCalibrationOptions {
  scopeType?: ScopeType | null;
  scopeId?: string | number | null; // bigint subtopic/topic id, or uuid competency id
  minSample?: number;
  dryRun?: boolean;
  runBy?: string | null; // profile id, or null for a system/scheduled run
}

export interface OpenEndedCalibrationResult {
  ok: true;
  items_scanned: number;
  items_calibrated: number;
  items_adjusted: number;
  items_low_sample: number;
  details: Row[];
}
export interface OpenEndedCalibrationSkip { ok: false; reason: string }

function empiricalBand(avgPct: number): "easy" | "medium" | "hard" {
  if (avgPct >= 75) return "easy";   // students are comfortably clearing it
  if (avgPct <= 40) return "hard";   // students are mostly falling short
  return "medium";
}

function direction(before: string | null, after: "easy" | "medium" | "hard"): "ok" | "adjusted_easier" | "adjusted_harder" {
  const rank = { easy: 0, medium: 1, hard: 2 } as const;
  const beforeRank = before && before in rank ? rank[before as keyof typeof rank] : 1;
  if (rank[after] === beforeRank) return "ok";
  return rank[after] < beforeRank ? "adjusted_easier" : "adjusted_harder";
}

export async function runOpenEndedCalibrationForScope(
  admin: SupabaseAdmin, opts: OpenEndedCalibrationOptions,
): Promise<OpenEndedCalibrationResult | OpenEndedCalibrationSkip> {
  const minSample = Math.max(1, Math.round(opts.minSample ?? MIN_SAMPLE_DEFAULT));
  const dryRun = opts.dryRun === true;

  let itemQuery = admin.from("question_bank_extended")
    .select("id, question_type, difficulty, status, learning_objective_id, subtopic_id, competency_id, calibration_status")
    .neq("status", "retired")
    .limit(MAX_ITEMS_PER_RUN);

  if (opts.scopeType === "subtopic" && opts.scopeId != null) itemQuery = itemQuery.eq("subtopic_id", opts.scopeId);
  else if (opts.scopeType === "topic" && opts.scopeId != null) {
    const { data: subs } = await admin.from("subtopics").select("id").eq("topic_id", opts.scopeId);
    const ids = (subs ?? []).map((s: Row) => s.id);
    if (!ids.length) return { ok: false, reason: "That topic has no concepts yet" };
    itemQuery = itemQuery.in("subtopic_id", ids);
  } else if (opts.scopeType === "competency" && opts.scopeId != null) itemQuery = itemQuery.eq("competency_id", opts.scopeId);
  // scopeType "all" (or unset): no extra filter - used by the nightly cron sweep.

  const { data: items, error: itemErr } = await itemQuery;
  if (itemErr) throw new Error(itemErr.message);
  if (!items?.length) return { ok: false, reason: "No matching items" };

  const itemIds = (items as Row[]).map((it) => it.id);

  // Pull graded submissions for these items. Prefer the teacher's final score
  // where one exists (it's the score of record); fall back to the AI's
  // first-pass suggestion otherwise.
  const { data: subs, error: subErr } = await admin.from("open_response_submissions")
    .select("item_id, teacher_score, ai_suggested_score, status")
    .in("item_id", itemIds)
    .in("status", ["ai_graded", "teacher_reviewed"]);
  if (subErr) throw new Error(subErr.message);

  const maxMarksByItem = new Map<string, number>();
  {
    const { data: marks } = await admin.from("question_bank_extended").select("id, max_marks").in("id", itemIds);
    for (const m of marks ?? []) maxMarksByItem.set(m.id, Number(m.max_marks) || 1);
  }

  const byItem = new Map<string, number[]>(); // item_id -> list of score ratios (0-1)
  for (const s of subs ?? []) {
    const score = s.teacher_score != null ? Number(s.teacher_score) : Number(s.ai_suggested_score);
    if (!Number.isFinite(score)) continue;
    const maxMarks = maxMarksByItem.get(s.item_id) ?? 1;
    const ratio = Math.max(0, Math.min(1, score / maxMarks));
    if (!byItem.has(s.item_id)) byItem.set(s.item_id, []);
    byItem.get(s.item_id)!.push(ratio);
  }

  let calibrated = 0, adjusted = 0, lowSample = 0;
  const details: Row[] = [];

  for (const item of items as Row[]) {
    const ratios = byItem.get(item.id) ?? [];
    const n = ratios.length;
    if (n === 0) continue; // nothing to learn from yet - leave it exactly as authored

    const avgPct = (ratios.reduce((s, r) => s + r, 0) / n) * 100;

    if (n < minSample) {
      lowSample++;
      details.push({ item_id: item.id, n, avg_pct: Math.round(avgPct), flag: "low_sample" });
      if (!dryRun) {
        await admin.from("question_bank_extended").update({
          empirical_avg_score_pct: avgPct, n_graded_responses: n, calibration_flag: "low_sample",
        }).eq("id", item.id);
      }
      continue;
    }

    const empirical = empiricalBand(avgPct);
    const flag = direction(item.difficulty, empirical);
    calibrated++;
    if (flag !== "ok") adjusted++;

    details.push({ item_id: item.id, n, avg_pct: Math.round(avgPct), before: item.difficulty, after: empirical, flag });

    if (!dryRun) {
      await admin.from("question_bank_extended").update({
        difficulty: empirical,
        empirical_difficulty: empirical,
        empirical_avg_score_pct: avgPct,
        n_graded_responses: n,
        calibration_status: "calibrated",
        calibration_flag: flag,
        last_calibrated_at: new Date().toISOString(),
      }).eq("id", item.id);
    }
  }

  if (!dryRun) {
    await admin.from("open_ended_calibration_runs").insert({
      scope_type: opts.scopeType ?? "all",
      scope_id: opts.scopeId != null ? String(opts.scopeId) : null,
      items_scanned: items.length, items_calibrated: calibrated, items_adjusted: adjusted, items_low_sample: lowSample,
      run_by: opts.runBy ?? null, details,
    });
  }

  return { ok: true, items_scanned: items.length, items_calibrated: calibrated, items_adjusted: adjusted, items_low_sample: lowSample, details };
}
