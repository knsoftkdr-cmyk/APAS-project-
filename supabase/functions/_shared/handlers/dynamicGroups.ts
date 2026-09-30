// supabase/functions/_shared/handlers/dynamicGroups.ts
//
// DYNAMIC STUDENT GROUPING. Not a standalone edge function (deployment limit): `get-class-mastery`
// routes to it via mode "dynamic_groups" - see _shared/mergedRouter.ts.
//
// Staff only (teachers: only classes they are assigned to). One endpoint, sub-operation in `op`:
//
//   op "preview" (default)  { class_id, book_id?, remedial_below?, enrichment_at_least?, hysteresis?, min_objectives? }
//       Computes remedial / regular / enrichment groups from CURRENT performance and shows who would
//       move relative to the last saved placement. Writes nothing.
//   op "apply"              same body. Recomputes server-side (client-sent tiers are never trusted), saves the
//       placements and appends a history row for every student whose tier changed.
//   op "current"            { class_id, book_id? }   The saved placements + recent movement.
//   op "override"           { class_id, book_id?, student_id, tier, note? }   Pin one student to a tier.
//                           tier = null unpins (the next apply then follows the rules again).
//
// Groups change as performance changes: each apply re-scores everyone (mastery + learning pace + early-warning
// risk), with hysteresis so a student sitting on a boundary doesn't flip back and forth, and teacher pins that
// the rules never silently overturn. The tables come from migration 20261008000000; if they are not deployed
// yet, "preview" still works and the saving operations return a clear 503.

// deno-lint-ignore-file no-explicit-any
import { canStaffAccessClass } from "../studentAccess.ts";
import {
  assignTiers, summariseTiers, validateTierOptions, TIER_ORDER,
  type PriorPlacement, type Tier, type TierOptions,
} from "../learningGroupsCore.ts";
import {
  authenticateStaff, corsHeaders, json, loadClassSignals, parseBookId, parseMinObjectives, UUID_RE,
  type AuthContext,
} from "../learningGroupsData.ts";

type Row = Record<string, any>;
const OPS = ["preview", "apply", "current", "override"];
const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIER_ORDER as string[]).includes(v);
const MISSING_TABLE = (e: any) => e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? ""));
const NOT_DEPLOYED = "Group history tables are not deployed yet. Apply migration 20261008000000_dynamic_learning_groups.sql.";

async function readPrior(admin: any, classId: string, bookScope: number): Promise<{ available: boolean; rows: Row[] }> {
  const { data, error } = await admin.from("student_learning_groups")
    .select("student_id, tier, pinned, pinned_note, computed_at, composite")
    .eq("class_id", classId).eq("book_id", bookScope);
  if (error) {
    if (MISSING_TABLE(error)) return { available: false, rows: [] };
    throw error;
  }
  return { available: true, rows: data ?? [] };
}

function parseThresholds(body: Row): { ok: true; value: TierOptions } | { ok: false; error: string } {
  const partial: Partial<TierOptions> = {};
  const map: Array<[string, keyof TierOptions]> = [
    ["remedial_below", "remedialBelow"], ["enrichment_at_least", "enrichmentAtLeast"],
    ["hysteresis", "hysteresis"], ["high_risk_margin", "highRiskMargin"],
  ];
  for (const [k, prop] of map) {
    if (body[k] == null) continue;
    const n = Number(body[k]);
    if (!Number.isFinite(n)) return { ok: false, error: `${k} must be a number` };
    partial[prop] = n;
  }
  return validateTierOptions(partial);
}

/** Recompute placements from live data + the saved state. Shared by preview and apply. */
export async function computeTierView(ctx: AuthContext, classId: string, studentIds: string[], bookId: number | null, minObjectives: number, opts: TierOptions) {
  const bookScope = bookId ?? 0;
  const [loaded, prior] = await Promise.all([
    loadClassSignals(ctx, { classId, studentIds, bookId, minObjectives }),
    readPrior(ctx.admin, classId, bookScope),
  ]);
  const priorMap = new Map<string, PriorPlacement>();
  for (const r of prior.rows) if (isTier(r.tier)) priorMap.set(r.student_id, { tier: r.tier, pinned: !!r.pinned });

  const placements = assignTiers(loaded.signals, priorMap, opts);
  const tiers = summariseTiers(placements, loaded.signals);
  return { loaded, prior, placements, tiers, bookScope };
}

const moves = (placements: ReturnType<typeof assignTiers>) => ({
  up: placements.filter((p) => p.moved === "up").map((p) => p.student_id),
  down: placements.filter((p) => p.moved === "down").map((p) => p.student_id),
  new: placements.filter((p) => p.previous_tier === null).length,
});

export async function handleDynamicGroups(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await authenticateStaff(req);
    if (!auth.ok) return auth.res;
    const { ctx } = auth;
    const { admin } = ctx;

    const body: Row = await req.json().catch(() => ({}));
    const op: string = body.op ?? "preview";
    if (!OPS.includes(op)) return json({ error: `Unknown op "${op}"` }, 400);

    const classId = body.class_id;
    if (typeof classId !== "string" || !UUID_RE.test(classId)) return json({ error: "class_id must be a valid id" }, 400);
    const book = parseBookId(body.book_id);
    if (!book.ok) return json({ error: "book_id must be a positive integer" }, 400);
    const bookScope = book.value ?? 0;

    const access = await canStaffAccessClass(admin, ctx.caller, classId);
    if (!access.ok) return json({ error: access.error }, access.status ?? 403);
    const studentIds = access.studentIds ?? [];
    const rosterSet = new Set(studentIds);

    // ── current: what is saved, plus recent movement ─────────────────────────────────────────
    if (op === "current") {
      const { data: rows, error } = await admin.from("student_learning_groups")
        .select("student_id, tier, previous_tier, composite, reasons, provisional, pinned, pinned_note, computed_at")
        .eq("class_id", classId).eq("book_id", bookScope);
      if (error) return MISSING_TABLE(error) ? json({ error: NOT_DEPLOYED, code: "not_deployed" }, 503) : json({ error: error.message }, 500);

      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { data: hist } = await admin.from("student_learning_group_history")
        .select("student_id, from_tier, to_tier, composite, source, note, changed_at")
        .eq("class_id", classId).eq("book_id", bookScope).gte("changed_at", since)
        .order("changed_at", { ascending: false }).limit(60);

      const ids = [...new Set([...(rows ?? []).map((r: Row) => r.student_id), ...(hist ?? []).map((h: Row) => h.student_id)])];
      const { data: names } = ids.length ? await admin.from("students").select("id, full_name").in("id", ids) : { data: [] };
      const nameBy = new Map<string, string>((names ?? []).map((n: Row) => [n.id, n.full_name ?? "Student"]));

      const placements = (rows ?? []).filter((r: Row) => rosterSet.has(r.student_id))
        .map((r: Row) => ({ ...r, full_name: nameBy.get(r.student_id) ?? "Student" }));
      const computedAt = placements.reduce((m: string | null, r: Row) => (!m || r.computed_at > m ? r.computed_at : m), null);
      return json({
        class_id: classId, book_id: book.value, roster_size: studentIds.length,
        saved: placements.length > 0, computed_at: computedAt,
        counts: Object.fromEntries(TIER_ORDER.map((t) => [t, placements.filter((p: Row) => p.tier === t).length])),
        placements,
        recent_moves: (hist ?? []).filter((h: Row) => rosterSet.has(h.student_id))
          .map((h: Row) => ({ ...h, full_name: nameBy.get(h.student_id) ?? "Student" })),
      });
    }

    // ── override: pin one student ────────────────────────────────────────────────────────────
    if (op === "override") {
      const studentId = body.student_id;
      if (typeof studentId !== "string" || !UUID_RE.test(studentId)) return json({ error: "student_id must be a valid id" }, 400);
      if (!rosterSet.has(studentId)) return json({ error: "That student is not on this class roster" }, 404);
      const unpin = body.tier === null;
      if (!unpin && !isTier(body.tier)) return json({ error: "tier must be remedial, regular, enrichment, or null to unpin" }, 400);
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

      const { data: existing, error: exErr } = await admin.from("student_learning_groups")
        .select("tier, composite").eq("class_id", classId).eq("book_id", bookScope).eq("student_id", studentId).maybeSingle();
      if (exErr) return MISSING_TABLE(exErr) ? json({ error: NOT_DEPLOYED, code: "not_deployed" }, 503) : json({ error: exErr.message }, 500);

      if (unpin) {
        if (!existing) return json({ error: "That student has no saved placement to unpin" }, 404);
        const { error } = await admin.from("student_learning_groups")
          .update({ pinned: false, pinned_by: null, pinned_note: null })
          .eq("class_id", classId).eq("book_id", bookScope).eq("student_id", studentId);
        if (error) throw error;
        return json({ class_id: classId, student_id: studentId, pinned: false });
      }

      const now = new Date().toISOString();
      const { error } = await admin.from("student_learning_groups").upsert({
        class_id: classId, book_id: bookScope, student_id: studentId, tier: body.tier,
        previous_tier: existing?.tier ?? null, composite: existing?.composite ?? null,
        reasons: [`Pinned to ${body.tier} by teacher${note ? `: ${note}` : ""}`], provisional: false,
        pinned: true, pinned_by: ctx.userId, pinned_note: note, computed_at: now, applied_by: ctx.userId,
      }, { onConflict: "class_id,book_id,student_id" });
      if (error) throw error;

      if (existing?.tier !== body.tier) {
        await admin.from("student_learning_group_history").insert({
          class_id: classId, book_id: bookScope, student_id: studentId, from_tier: existing?.tier ?? null,
          to_tier: body.tier, composite: existing?.composite ?? null, source: "manual", changed_by: ctx.userId, note,
        });
      }
      return json({ class_id: classId, student_id: studentId, tier: body.tier, pinned: true });
    }

    // ── preview / apply ──────────────────────────────────────────────────────────────────────
    const thresholds = parseThresholds(body);
    if (!thresholds.ok) return json({ error: thresholds.error }, 400);
    const minObj = parseMinObjectives(body.min_objectives);
    if (!minObj.ok) return json({ error: "min_objectives must be an integer from 1 to 50" }, 400);

    if (!studentIds.length) {
      return json({ class_id: classId, book_id: book.value, roster_size: 0, placements: [], tiers: summariseTiers([], []), warnings: [] });
    }

    const { loaded, prior, placements, tiers } = await computeTierView(ctx, classId, studentIds, book.value, minObj.value, thresholds.value);
    const m = moves(placements);

    let saved = false;
    if (op === "apply") {
      if (!prior.available) return json({ error: NOT_DEPLOYED, code: "not_deployed" }, 503);
      const now = new Date().toISOString();
      const rows = placements.map((p) => ({
        class_id: classId, book_id: bookScope, student_id: p.student_id, tier: p.tier,
        previous_tier: p.previous_tier, composite: p.composite, reasons: p.reasons,
        provisional: p.provisional, computed_at: now, applied_by: ctx.userId,
        // pinned/pinned_by/pinned_note intentionally omitted: an apply must not clear or change a teacher pin.
      }));
      const { error } = await admin.from("student_learning_groups").upsert(rows, { onConflict: "class_id,book_id,student_id" });
      if (error) throw error;

      const changed = placements.filter((p) => p.previous_tier !== p.tier);
      if (changed.length) {
        const { error: hErr } = await admin.from("student_learning_group_history").insert(changed.map((p) => ({
          class_id: classId, book_id: bookScope, student_id: p.student_id, from_tier: p.previous_tier, to_tier: p.tier,
          composite: p.composite, source: "auto", changed_by: ctx.userId, note: p.reasons[0] ?? null,
        })));
        if (hErr) console.error("history insert failed (non-fatal)", hErr);
      }
      saved = true;
    }

    return json({
      class_id: classId, class_name: loaded.className, book_id: book.value,
      op, saved, persistence_available: prior.available,
      roster_size: studentIds.length,
      thresholds: {
        remedial_below: thresholds.value.remedialBelow, enrichment_at_least: thresholds.value.enrichmentAtLeast,
        hysteresis: thresholds.value.hysteresis, high_risk_margin: thresholds.value.highRiskMargin,
      },
      tiers,
      placements,
      changes: m,
      warnings: [
        ...loaded.warnings,
        ...(prior.available ? [] : ["Group history is not set up yet, so changes since last time cannot be shown or saved."]),
      ],
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("dynamic_groups error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
