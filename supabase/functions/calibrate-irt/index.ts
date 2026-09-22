// supabase/functions/calibrate-irt/index.ts
//
// Deploy with:
//   supabase functions deploy calibrate-irt
//
// Staff only. Re-estimates item difficulty (b) - and, once an item has
// enough data, discrimination (a) - from the accumulated response log, and
// flags items that look mis-keyed or badly behaved.
//
//   Body: {
//     scope_type?: "concept"|"topic"|"chapter"|"subject", scope_id?: number
//                                  omit both to calibrate the whole bank
//     dry_run?: boolean            report what WOULD change, write nothing
//     min_n_rasch?: number         default 30  - responses before b is estimated
//     min_n_2pl?: number           default 200 - responses before a is estimated too
//     auto_suspend?: boolean       default true - items flagged "review_key" are moved
//                                  back to "draft" so they stop being served until a
//                                  teacher re-checks the key and re-approves them
//   }
//
// The estimator (marginal maximum likelihood via EM) lives in
// ../_shared/irt.ts. It is used instead of "percent correct" because CAT
// routes strong students to hard items, which makes raw p-values misleading;
// selection that depends only on earlier answers is ignorable for MML.
//
// SCALE NOTE: each run fixes the population prior at N(0,1) over the
// responses it sees, so θ and b are expressed relative to *this cohort of
// examinees*. It is a relative scale, not an absolute one. If you calibrate
// different classes/grades separately their scales are not comparable until
// the items are linked across cohorts.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  belowChance,
  calibrateMML,
  detectMiskey,
  type CalibrationMode,
  type CalibrationResponse,
} from "../_shared/irt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];
const SCOPE_TYPES = ["concept", "topic", "chapter", "subject"];
const MAX_RESPONSES = 250_000;
const PAGE = 1000;
const IN_CHUNK = 100;

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
    if (!profile || !STAFF_ROLES.includes(profile.role)) return json({ error: "Not permitted to calibrate items" }, 403);

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const autoSuspend = body.auto_suspend !== false;
    const minRasch = Math.max(10, Math.round(Number(body.min_n_rasch ?? 30)) || 30);
    const min2pl = Math.max(minRasch, Math.round(Number(body.min_n_2pl ?? 200)) || 200);

    let scopeType: string | null = null;
    let scopeId: number | null = null;
    if (body.scope_type != null || body.scope_id != null) {
      scopeType = String(body.scope_type);
      scopeId = Number(body.scope_id);
      if (!SCOPE_TYPES.includes(scopeType) || !Number.isFinite(scopeId)) {
        return json({ error: "scope_type (concept|topic|chapter|subject) and numeric scope_id must be given together" }, 400);
      }
    }

    // ── 1. Items in scope ────────────────────────────────────────────────
    let items: Row[] = [];
    if (scopeType) {
      const { data: subs, error } = await admin.rpc("cat_scope_subtopic_ids", { p_scope_type: scopeType, p_scope_id: scopeId });
      if (error) throw new Error(error.message);
      const subIds = (subs ?? []).map((s: Row) => s.subtopic_id as number);
      for (const chunk of chunks(subIds, 200)) {
        const { data } = await admin.from("question_bank")
          .select("id, stem, status, correct_option, irt_a, irt_b, irt_c, b_prior, calibration_status, n_responses")
          .in("subtopic_id", chunk).gt("n_responses", 0);
        items.push(...(data ?? []));
      }
    } else {
      for (let from = 0; ; from += PAGE) {
        const { data } = await admin.from("question_bank")
          .select("id, stem, status, correct_option, irt_a, irt_b, irt_c, b_prior, calibration_status, n_responses")
          .gt("n_responses", 0).order("id").range(from, from + PAGE - 1);
        items.push(...(data ?? []));
        if ((data?.length ?? 0) < PAGE) break;
      }
    }
    if (!items.length) return json({ error: "No answered items in this scope yet - nothing to calibrate" }, 404);

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
          return json({ error: `More than ${MAX_RESPONSES} responses in scope - narrow the scope (e.g. one subject at a time)` }, 413);
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
    const modeCounts: Record<CalibrationMode, number> = { prior: 0, rasch: 0, "2pl": 0 };

    for (const c of fit.items) {
      modeCounts[c.mode]++;
      if (c.mode === "prior") continue;
      const item = byId.get(c.id)!;

      const obs = (respByItem.get(c.id) ?? [])
        .filter((r) => thetaBySession.has(r.session_id))
        .map((r) => ({ option: r.selected_option as string, theta: thetaBySession.get(r.session_id)! }));
      const miskey = detectMiskey(item.correct_option, obs);
      // Independent check: answered correctly LESS often than blind guessing.
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
      if (flag !== "ok") flagged.push({ item_id: c.id, stem: String(item.stem).slice(0, 120), flag, note, n: c.n });
    }

    if (!dryRun) {
      for (const batch of chunks(updates, 20)) {
        const results = await Promise.all(batch.map((u) => admin.from("question_bank").update(u.patch).eq("id", u.id)));
        const failed = results.find((r) => r.error);
        if (failed?.error) throw new Error(`update failed: ${failed.error.message}`);
      }
    }

    const meanAbsShift = changes.length ? changes.reduce((s, c) => s + Math.abs(c.delta_b), 0) / changes.length : 0;
    const summary = {
      by_stage: modeCounts,
      flagged_count: flagged.length,
      auto_suspended_count: suspended.length,
      mean_abs_b_shift: round(meanAbsShift, 3),
    };

    await admin.from("irt_calibration_runs").insert({
      run_by: user.id, scope_type: scopeType, scope_id: scopeId, dry_run: dryRun,
      items_considered: items.length, items_updated: dryRun ? 0 : updates.length,
      responses_used: fit.responses, units_used: fit.units, iterations: fit.iterations, converged: fit.converged, summary,
    });

    return json({
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
    });
  } catch (e) {
    console.error("calibrate-irt error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function round(x: number, d: number) {
  const m = 10 ** d;
  return Math.round(x * m) / m;
}