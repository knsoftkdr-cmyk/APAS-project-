// supabase/functions/_shared/runCalibration.ts
//
// The actual calibration work, factored out of calibrate-irt/index.ts so it
// can run two ways without duplicating logic or an HTTP round-trip:
//   - interactively, from calibrate-irt (a signed-in staff member, one scope)
//   - on a schedule, from calibrate-irt-cron (pg_cron, every subject in turn)
//
// This file has no auth logic in it - both callers are responsible for
// deciding who's allowed to call before they get here, and pass in `runBy`
// (a profile id, or null for a system/scheduled run) purely for the audit log.

// deno-lint-ignore-file no-explicit-any
import {
  belowChance,
  calibrateMML,
  detectMiskey,
  type CalibrationMode,
  type CalibrationResponse,
} from "./irt.ts";

type Row = Record<string, any>;
type SupabaseAdmin = any; // the service-role client; typed loosely to avoid pulling in supabase-js's generics here

export const SCOPE_TYPES = ["concept", "topic", "chapter", "subject"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

const MAX_RESPONSES = 250_000;
const PAGE = 1000;
const IN_CHUNK = 100;

export interface CalibrationOptions {
  scopeType?: ScopeType | null;
  scopeId?: number | null;
  dryRun?: boolean;
  autoSuspend?: boolean;
  minRasch?: number;
  min2pl?: number;
  runBy?: string | null; // profile id of the person who asked for this; null for a system/scheduled run
}

export interface CalibrationOutcome {
  ok: true;
  dry_run: boolean;
  items_considered: number;
  items_calibrated: number;
  items_left_at_prior: number;
  responses_used: number;
  sessions_used: number;
  iterations: number;
  converged: boolean;
  thresholds: { min_n_rasch: number; min_n_2pl: number };
  by_stage: Record<CalibrationMode, number>;
  flagged_count: number;
  newly_flagged_count: number;
  auto_suspended_count: number;
  mean_abs_b_shift: number;
  auto_suspended: string[];
  flagged: Row[];
  largest_changes: Row[];
}
export interface CalibrationEmpty {
  ok: false;
  reason: "no_data" | "too_many_responses";
  message: string;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function round(x: number, d: number) {
  const m = 10 ** d;
  return Math.round(x * m) / m;
}

/**
 * Re-estimate item difficulty/discrimination for one scope (or the whole
 * bank, if scopeType/scopeId are omitted) and, unless dryRun, write the
 * results and log a row to irt_calibration_runs.
 */
export async function runCalibrationForScope(admin: SupabaseAdmin, opts: CalibrationOptions): Promise<CalibrationOutcome | CalibrationEmpty> {
  const scopeType = opts.scopeType ?? null;
  const scopeId = opts.scopeId ?? null;
  const dryRun = opts.dryRun === true;
  const autoSuspend = opts.autoSuspend !== false;
  const minRasch = Math.max(10, Math.round(opts.minRasch ?? 30) || 30);
  const min2pl = Math.max(minRasch, Math.round(opts.min2pl ?? 200) || 200);

  // ── 1. Items in scope ────────────────────────────────────────────────
  let items: Row[] = [];
  if (scopeType) {
    const { data: subs, error } = await admin.rpc("cat_scope_subtopic_ids", { p_scope_type: scopeType, p_scope_id: scopeId });
    if (error) throw new Error(error.message);
    const subIds = (subs ?? []).map((s: Row) => s.subtopic_id as number);
    for (const chunk of chunks(subIds, 200)) {
      const { data } = await admin.from("question_bank")
        .select("id, stem, status, correct_option, irt_a, irt_b, irt_c, b_prior, calibration_status, n_responses, review_flag")
        .in("subtopic_id", chunk).gt("n_responses", 0);
      items.push(...(data ?? []));
    }
  } else {
    for (let from = 0; ; from += PAGE) {
      const { data } = await admin.from("question_bank")
        .select("id, stem, status, correct_option, irt_a, irt_b, irt_c, b_prior, calibration_status, n_responses, review_flag")
        .gt("n_responses", 0).order("id").range(from, from + PAGE - 1);
      items.push(...(data ?? []));
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  if (!items.length) return { ok: false, reason: "no_data", message: "No answered items in this scope yet - nothing to calibrate" };

  // ── 2. Responses for those items (paged; PostgREST caps rows/request) ─
  const responses: Row[] = [];
  for (const idChunk of chunks(items.map((i) => i.id), IN_CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from("item_responses")
        .select("item_id, session_id, is_correct, selected_option")
        .in("item_id", idChunk).order("id").range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      responses.push(...(data ?? []));
      if (responses.length > MAX_RESPONSES) {
        return { ok: false, reason: "too_many_responses", message: `More than ${MAX_RESPONSES} responses in scope - narrow the scope (e.g. one subject at a time)` };
      }
      if ((data?.length ?? 0) < PAGE) break;
    }
  }

  // ── 3. Fit ───────────────────────────────────────────────────────────
  const fit = calibrateMML(
    items.map((i) => ({ id: i.id, a: Number(i.irt_a), b: Number(i.irt_b), c: Number(i.irt_c), bPrior: Number(i.b_prior) })),
    responses.map((r): CalibrationResponse => ({ unit: r.session_id, itemId: r.item_id, correct: !!r.is_correct })),
    { minRasch, min2pl },
  );

  // ── 4. Answer-key sanity check (uses final θ of COMPLETED sessions) ───
  const sessionIds = [...new Set(responses.map((r) => r.session_id as string))];
  const thetaBySession = new Map<string, number>();
  for (const chunk of chunks(sessionIds, 150)) {
    const { data } = await admin.from("cat_sessions").select("id, theta").in("id", chunk).eq("status", "completed");
    for (const s of data ?? []) thetaBySession.set(s.id, Number(s.theta));
  }
  const respByItem = new Map<string, Row[]>();
  for (const r of responses) {
    const arr = respByItem.get(r.item_id) ?? [];
    arr.push(r);
    respByItem.set(r.item_id, arr);
  }

  // ── 5. Decide flags + build updates ──────────────────────────────────
  const byId = new Map(items.map((i) => [i.id as string, i]));
  const now = new Date().toISOString();
  const updates: Row[] = [];
  const flagged: Row[] = [];
  const changes: Row[] = [];
  const suspended: string[] = [];
  let newlyFlagged = 0;
  const modeCounts: Record<CalibrationMode, number> = { prior: 0, rasch: 0, "2pl": 0 };

  for (const c of fit.items) {
    modeCounts[c.mode]++;
    if (c.mode === "prior") continue;
    const item = byId.get(c.id)!;

    const obs = (respByItem.get(c.id) ?? [])
      .filter((r) => thetaBySession.has(r.session_id))
      .map((r) => ({ option: r.selected_option as string, theta: thetaBySession.get(r.session_id)! }));
    const miskey = detectMiskey(item.correct_option, obs);
    const chanceFail = belowChance(c.nCorrect, c.n, c.c);

    let flag: string = "ok";
    let note: string | null = null;
    if (chanceFail) {
      flag = "review_key";
      note = `Only ${Math.round((100 * c.nCorrect) / c.n)}% answered correctly - below the ${Math.round(100 * c.c)}% chance level, so the keyed answer is probably wrong`;
    } else if (miskey.suspect) { flag = "review_key"; note = miskey.reason; }
    else if (c.mode === "2pl" && c.a < 0.5) { flag = "low_discrimination"; note = `Weak discrimination (a = ${c.a.toFixed(2)}): strong and weak students answer alike`; }
    else if (c.b > 3) { flag = "too_hard"; note = `Very high difficulty (b = ${c.b.toFixed(2)})`; }
    else if (c.b < -3) { flag = "too_easy"; note = `Very low difficulty (b = ${c.b.toFixed(2)})`; }

    const suspend = autoSuspend && flag === "review_key" && item.status === "active";
    if (suspend) suspended.push(c.id);
    updates.push({
      id: c.id,
      patch: {
        ...(suspend ? { status: "draft" } : {}),
        irt_a: round(c.a, 3), irt_b: round(c.b, 3), b_se: c.bSe == null ? null : round(c.bSe, 3),
        calibration_status: c.mode, review_flag: flag, review_note: note, last_calibrated_at: now,
      },
    });
    changes.push({ item_id: c.id, n: c.n, mode: c.mode, b_before: round(Number(item.irt_b), 2), b_after: round(c.b, 2), a_after: round(c.a, 2), delta_b: round(c.b - Number(item.irt_b), 2) });
    if (flag !== "ok") {
      const alreadyFlagged = item.review_flag != null && item.review_flag !== "ok";
      flagged.push({ item_id: c.id, stem: String(item.stem).slice(0, 120), flag, note, n: c.n, already_flagged: alreadyFlagged });
      if (!alreadyFlagged) newlyFlagged++;
    }
  }

  if (!dryRun) {
    for (const batch of chunks(updates, 20)) {
      const results = await Promise.all(batch.map((u) => admin.from("question_bank").update(u.patch).eq("id", u.id)));
      const failed = results.find((r: Row) => r.error);
      if (failed?.error) throw new Error(`update failed: ${failed.error.message}`);
    }
  }

  const meanAbsShift = changes.length ? changes.reduce((s, c) => s + Math.abs(c.delta_b), 0) / changes.length : 0;
  const summary = {
    by_stage: modeCounts,
    flagged_count: flagged.length,
    newly_flagged_count: newlyFlagged,
    auto_suspended_count: suspended.length,
    mean_abs_b_shift: round(meanAbsShift, 3),
  };

  await admin.from("irt_calibration_runs").insert({
    run_by: opts.runBy ?? null, scope_type: scopeType, scope_id: scopeId, dry_run: dryRun,
    items_considered: items.length, items_updated: dryRun ? 0 : updates.length,
    responses_used: fit.responses, units_used: fit.units, iterations: fit.iterations, converged: fit.converged, summary,
  });

  return {
    ok: true,
    dry_run: dryRun,
    items_considered: items.length,
    items_calibrated: updates.length,
    items_left_at_prior: modeCounts.prior,
    responses_used: fit.responses,
    sessions_used: fit.units,
    iterations: fit.iterations,
    converged: fit.converged,
    thresholds: { min_n_rasch: minRasch, min_n_2pl: min2pl },
    ...summary,
    auto_suspended: dryRun ? [] : suspended,
    flagged,
    largest_changes: changes.sort((a, b) => Math.abs(b.delta_b) - Math.abs(a.delta_b)).slice(0, 15),
  };
}