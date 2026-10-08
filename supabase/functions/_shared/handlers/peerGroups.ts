// supabase/functions/_shared/handlers/peerGroups.ts
//
// PEER GROUP IDENTIFICATION. Not a standalone edge function (deployment limit): `get-class-mastery`
// routes to it via mode "peer_groups" - see _shared/mergedRouter.ts.
//
// Staff only (teachers: only classes they are assigned to; school-bound staff: only their school).
// Body: { class_id, book_id?, min_objectives?, similarity?, max_group_size? }
//
// Clusters students who share the SAME learning gaps (weak-topic overlap, average-linkage on Jaccard
// similarity), so a teacher can teach "these 5 are all shaky on fractions and ratios" together.
// Strong students with no gaps are grouped for extension. Students with too little assessed evidence
// are listed separately rather than forced into a group. Each support group is enriched with the
// misconceptions its members share (best-effort).

// deno-lint-ignore-file no-explicit-any
import { canStaffAccessClass } from "../studentAccess.ts";
import { clusterPeerGroups, type PeerGroupOptions } from "../learningGroupsCore.ts";
import { errorMessage } from "../errorMessage.ts";
import {
  authenticateStaff, json, loadClassSignals, parseBookId, parseMinObjectives, corsHeaders, UUID_RE,
} from "../learningGroupsData.ts";

type Row = Record<string, any>;
const MISCONCEPTION_STUDENT_CAP = 60;

export async function handlePeerGroups(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await authenticateStaff(req);
    if (!auth.ok) return auth.res;
    const { ctx } = auth;

    const body = await req.json().catch(() => ({}));
    const classId = body.class_id;
    if (typeof classId !== "string" || !UUID_RE.test(classId)) return json({ error: "class_id must be a valid id" }, 400);
    const book = parseBookId(body.book_id);
    if (!book.ok) return json({ error: "book_id must be a positive integer" }, 400);
    const minObj = parseMinObjectives(body.min_objectives);
    if (!minObj.ok) return json({ error: "min_objectives must be an integer from 1 to 50" }, 400);

    const opts: Partial<PeerGroupOptions> = {};
    if (body.similarity != null) {
      const n = Number(body.similarity);
      if (!Number.isFinite(n) || n < 0.1 || n > 0.9) return json({ error: "similarity must be between 0.1 and 0.9" }, 400);
      opts.similarity = n;
    }
    if (body.max_group_size != null) {
      const n = Number(body.max_group_size);
      if (!Number.isInteger(n) || n < 2 || n > 30) return json({ error: "max_group_size must be an integer from 2 to 30" }, 400);
      opts.maxGroupSize = n;
    }

    const access = await canStaffAccessClass(ctx.admin, ctx.caller, classId);
    if (!access.ok) return json({ error: access.error }, access.status ?? 403);
    const studentIds = access.studentIds ?? [];
    if (!studentIds.length) {
      return json({ class_id: classId, book_id: book.value, roster_size: 0, assessed_count: 0, groups: [], individual: [], on_track: [], unassessed: [], warnings: [] });
    }

    const loaded = await loadClassSignals(ctx, { classId, studentIds, bookId: book.value, minObjectives: minObj.value });
    const result = clusterPeerGroups(loaded.signals, opts);
    const warnings = [...loaded.warnings];

    // ── Shared misconceptions per support group (best-effort) ────────────────────────────────
    const supportMembers = result.groups.filter((g) => g.kind === "support").flatMap((g) => g.members.map((m) => m.student_id));
    const misconceptionsByStudent = new Map<string, Row[]>();
    if (supportMembers.length && supportMembers.length <= MISCONCEPTION_STUDENT_CAP) {
      try {
        await Promise.all(supportMembers.map(async (sid) => {
          const { data, error } = await ctx.userClient.rpc("get_student_misconceptions", {
            p_student_id: sid, p_min_occurrences: 2, p_book_id: book.value,
          });
          if (error) throw error;
          misconceptionsByStudent.set(sid, Array.isArray(data) ? data : []);
        }));
      } catch (e) {
        console.error("misconception lookup failed (non-fatal)", e);
        warnings.push("Shared misconceptions could not be loaded.");
        misconceptionsByStudent.clear();
      }
    }

    const groups = result.groups.map((g) => {
      if (g.kind !== "support" || misconceptionsByStudent.size === 0) return { ...g, shared_misconceptions: [] };
      const tally = new Map<string, { text: string; severity: string; hint: string | null; why: string | null; count: number }>();
      for (const m of g.members) {
        for (const mc of misconceptionsByStudent.get(m.student_id) ?? []) {
          const key = String(mc.misconception_id);
          const e = tally.get(key) ?? { text: mc.misconception_text, severity: mc.severity, hint: mc.correction_hint ?? null, why: mc.why_it_happens ?? null, count: 0 };
          e.count++; tally.set(key, e);
        }
      }
      const shared = [...tally.values()]
        .filter((e) => e.count >= Math.min(2, g.size))
        .sort((a, b) => b.count - a.count)
        .slice(0, 4)
        .map((e) => ({ misconception: e.text, severity: e.severity, students_affected: e.count, correction_hint: e.hint, why_it_happens: e.why }));
      return { ...g, shared_misconceptions: shared };
    });

    return json({
      class_id: classId,
      class_name: loaded.className,
      book_id: book.value,
      roster_size: studentIds.length,
      assessed_count: loaded.signals.filter((s) => s.score !== null).length,
      min_objectives: minObj.value,
      groups,
      individual: result.individual,
      on_track: result.on_track,
      unassessed: result.unassessed,
      options: result.options,
      warnings,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("peer_groups error", e);
    return json({ error: errorMessage(e) }, 500);
  }
}
