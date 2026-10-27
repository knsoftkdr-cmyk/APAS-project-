// supabase/functions/_shared/handlers/verifyItemKeys.ts
//
// Served through generate-item-bank with { action: "verify_keys", ... } (see _shared/mergedRouter.ts).
// Staff only. Re-checks the answer key of ACTIVE multiple-choice items by having the model solve each
// question blind (it never sees the stored key):
//   agrees    -> review_flag = 'ok'   (not looked at again)
//   disagrees -> status = 'draft', review_flag = 'review_key', review_note = why
//                (the item stops being served; a teacher fixes/approves it in Item Bank Review)
//   no answer -> left untouched (retry later)
//
//   Body: { learning_objective_id? | subtopic_id? | topic_id? | book_id?   (one is required)
//           limit?: number  default 24, max 48   - items checked per call; repeat while remaining > 0 }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAiConfig } from "../aiClient.ts";
import { solveItems, keyConfirmed, mismatchNote } from "../itemKeyVerifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const chunk = <T,>(arr: T[], n: number): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function handleVerifyItemKeys(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userError } = await asCaller.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) return json({ error: "Not permitted" }, 403);

    const ai = getAiConfig();
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(48, Math.max(1, Math.round(Number(body.limit ?? 24)) || 24));

    // ── Resolve the scope to subtopic ids (question_bank.subtopic_id is denormalised) ──
    let subtopicIds: number[] | null = null;
    let loId: number | null = null;
    if (body.learning_objective_id) loId = Number(body.learning_objective_id);
    else if (body.subtopic_id) subtopicIds = [Number(body.subtopic_id)];
    else if (body.topic_id) {
      const { data } = await admin.from("subtopics").select("id").eq("topic_id", Number(body.topic_id));
      subtopicIds = (data ?? []).map((r: Row) => r.id);
    } else if (body.book_id) {
      const { data: units } = await admin.from("units").select("id").eq("book_id", Number(body.book_id));
      const unitIds = (units ?? []).map((r: Row) => r.id);
      const chapterIds: number[] = [];
      for (const ids of chunk(unitIds, 30)) {
        const { data } = await admin.from("curriculum_chapters").select("id").in("unit_id", ids);
        chapterIds.push(...(data ?? []).map((r: Row) => r.id));
      }
      const topicIds: number[] = [];
      for (const ids of chunk(chapterIds, 30)) {
        const { data } = await admin.from("topics").select("id").in("chapter_id", ids);
        topicIds.push(...(data ?? []).map((r: Row) => r.id));
      }
      subtopicIds = [];
      for (const ids of chunk(topicIds, 30)) {
        const { data } = await admin.from("subtopics").select("id").in("topic_id", ids);
        subtopicIds.push(...(data ?? []).map((r: Row) => r.id));
      }
    } else {
      return json({ error: "learning_objective_id, subtopic_id, topic_id or book_id is required" }, 400);
    }
    if (!loId && !subtopicIds?.length) return json({ checked: 0, confirmed: 0, flagged: 0, unverified: 0, remaining: 0 });

    // Active, never-checked items in scope (chunked: .in() with a long id list can exceed URL limits).
    const scopeQuery = () => {
      let q = admin.from("question_bank").select("id, stem, options, correct_option", { count: "exact" })
        .eq("status", "active").is("review_flag", null).order("id");
      return q;
    };
    const items: Row[] = [];
    let remainingTotal = 0;
    const groups: (number[] | null)[] = loId ? [null] : chunk(subtopicIds!, 40);
    for (const g of groups) {
      let q = scopeQuery();
      q = loId ? q.eq("learning_objective_id", loId) : q.in("subtopic_id", g!);
      const want = limit - items.length;
      const { data, count } = await q.limit(Math.max(want, 1));
      remainingTotal += count ?? 0;
      if (want > 0) items.push(...((data ?? []) as Row[]).slice(0, want));
    }

    const solved = await solveItems(ai, items.map((i) => ({ stem: i.stem, options: i.options })));
    let confirmed = 0, flagged = 0, unverified = 0;
    const flaggedItems: { id: string; stem: string; key: string; solver: string | null }[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (solved[i] === null) { unverified++; continue; }
      if (keyConfirmed(solved[i], it.correct_option)) {
        confirmed++;
        await admin.from("question_bank").update({ review_flag: "ok", review_note: null }).eq("id", it.id);
      } else {
        flagged++;
        flaggedItems.push({ id: it.id, stem: it.stem, key: it.correct_option, solver: solved[i] });
        await admin.from("question_bank").update({
          status: "draft", review_flag: "review_key", review_note: mismatchNote(solved[i], it.correct_option),
        }).eq("id", it.id);
      }
    }
    return json({
      checked: items.length, confirmed, flagged, unverified,
      remaining: Math.max(0, remainingTotal - confirmed - flagged),
      flagged_items: flaggedItems,
    });
  } catch (e) {
    console.error("verify_keys error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
