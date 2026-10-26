// supabase/functions/_shared/handlers/aiQualityControl.ts
//
// AI QUALITY AND SAFETY CONTROL (sheet row 40). Not a standalone edge function (deployment limit): `ai-hooks`
// routes to it - see _shared/mergedRouter.ts. The anchor's own actions ("validate", "list") are untouched.
//
//   action "quality_evaluate"  staff:  { content, question?, reference?, grade_band?, subject?, source? }
//                                       -> { id, verdict, overall, scores, issues }   (stored, source defaults to "manual")
//   action "quality_list"      admins: { verdict?, source?, days? (default 30), limit? (default 50) }
//                                       -> { rows, summary }
//   action "quality_review"    admins: { id, note? } -> marks an evaluation as reviewed
//
// `evaluateAndStore` is also called by student-tutor-chat to sample tutor / voice-tutor replies automatically.
// School-bound callers only ever see their own school's evaluations; knsoft_admin sees all.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAi, getAiConfig } from "../aiClient.ts";
import { parseAiJson } from "../iepModel.ts";
import {
  buildEvaluatorPrompt, DIMENSIONS, EVALUATOR_SYSTEM_PROMPT, finaliseEvaluation, redactPii, ruleScan,
  type QualityInput, type QualityResult,
} from "../aiQualityModel.ts";
import { corsHeaders, json, UUID_RE } from "../learningGroupsData.ts";
import { STAFF_ROLES } from "../studentAccess.ts";

const ADMIN_ROLES = ["admin", "principal", "school_admin", "hod", "knsoft_admin"];
const EVALUATE_ROLES = [...STAFF_ROLES, "knsoft_admin"];

export async function evaluateContent(input: QualityInput): Promise<QualityResult & { model: string | null }> {
  const ruleFlags = ruleScan(input.content);
  try {
    const r = await callAi(getAiConfig(), buildEvaluatorPrompt(input), { system: EVALUATOR_SYSTEM_PROMPT, temperature: 0, maxOutputTokens: 2048 });
    return { ...finaliseEvaluation(parseAiJson(r.text), ruleFlags), model: r.model };
  } catch (e) {
    console.error("quality evaluator unavailable", e);
    return { ...finaliseEvaluation(null, ruleFlags), model: null };
  }
}

export async function evaluateAndStore(
  admin: any,
  input: QualityInput & { source: string; sourceRef?: string | null; schoolId?: string | null; requestedBy?: string | null },
) {
  const res = await evaluateContent(input);
  const { data, error } = await admin.from("ai_quality_evaluations").insert({
    school_id: input.schoolId ?? null, source: input.source, source_ref: input.sourceRef ?? null,
    requested_by: input.requestedBy ?? null, content_excerpt: redactPii(input.content).slice(0, 2000),
    grade_band: input.gradeBand ?? null, subject: input.subject ?? null,
    score_hallucination: res.scores?.hallucination ?? null, score_bias: res.scores?.bias ?? null,
    score_alignment: res.scores?.alignment ?? null, score_privacy: res.scores?.privacy ?? null,
    score_age_suitability: res.scores?.age_suitability ?? null, overall_score: res.overall,
    verdict: res.verdict, issues: res.issues, rule_flags: res.ruleFlags, evaluator_model: res.model,
  }).select("id").single();
  if (error) console.error("ai_quality_evaluations insert failed", error.message);
  return { id: data?.id ?? null, ...res };
}

async function authenticate(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return null;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: profile } = await admin.from("profiles").select("role, school_id").eq("id", user.id).maybeSingle();
  if (!profile) return null;
  return { admin, userId: user.id, role: profile.role as string, schoolId: (profile.school_id ?? null) as string | null };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function handleAiQualityControl(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await authenticate(req);
    if (!auth) return json({ error: "Not authenticated" }, 401);
    const body = await req.json().catch(() => ({}));
    const op = body.action as string; // set by the router: "evaluate" | "list" | "review"

    if (op === "evaluate") {
      if (!EVALUATE_ROLES.includes(auth.role)) return json({ error: "Not permitted" }, 403);
      const content = str(body.content, 12000);
      if (content.length < 5) return json({ error: "Paste the AI output to check" }, 400);
      const res = await evaluateAndStore(auth.admin, {
        content, question: str(body.question, 4000) || null, reference: str(body.reference, 12000) || null,
        gradeBand: str(body.grade_band, 40) || null, subject: str(body.subject, 60) || null,
        source: str(body.source, 40) || "manual", schoolId: auth.schoolId, requestedBy: auth.userId,
      });
      return json({ id: res.id, verdict: res.verdict, overall: res.overall, scores: res.scores, issues: res.issues, model: res.model });
    }

    if (!ADMIN_ROLES.includes(auth.role)) return json({ error: "Not permitted" }, 403);
    const scope = (q: any) => (auth.role === "knsoft_admin" || !auth.schoolId ? q : q.eq("school_id", auth.schoolId));

    if (op === "list") {
      const days = Math.min(365, Math.max(1, Number(body.days) || 30));
      const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));
      const since = new Date(Date.now() - days * 86400000).toISOString();

      let q = scope(auth.admin.from("ai_quality_evaluations").select("*").gte("created_at", since));
      if (["pass", "warn", "block"].includes(body.verdict)) q = q.eq("verdict", body.verdict);
      if (body.source) q = q.eq("source", String(body.source));
      const { data: rows, error } = await q.order("created_at", { ascending: false }).limit(limit);
      if (error) throw new Error(error.message);

      // Summary over the whole window (not just the page), capped to keep it cheap.
      const { data: all, error: allErr } = await scope(auth.admin.from("ai_quality_evaluations")
        .select("verdict, source, score_hallucination, score_bias, score_alignment, score_privacy, score_age_suitability")
        .gte("created_at", since)).limit(5000);
      if (allErr) throw new Error(allErr.message);
      const byVerdict = { pass: 0, warn: 0, block: 0 } as Record<string, number>;
      const sources = new Set<string>();
      const sums = Object.fromEntries(DIMENSIONS.map((d) => [d, { total: 0, n: 0 }])) as Record<string, { total: number; n: number }>;
      for (const r of all ?? []) {
        byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
        sources.add(r.source);
        for (const d of DIMENSIONS) {
          const v = r[`score_${d}`];
          if (typeof v === "number") { sums[d].total += v; sums[d].n++; }
        }
      }
      const averages = Object.fromEntries(DIMENSIONS.map((d) => [d, sums[d].n ? Math.round(sums[d].total / sums[d].n) : null]));
      return json({ rows: rows ?? [], summary: { total: (all ?? []).length, by_verdict: byVerdict, averages, sources: [...sources].sort(), days } });
    }

    if (op === "review") {
      if (!UUID_RE.test(String(body.id))) return json({ error: "id is required" }, 400);
      const { data: row } = await scope(auth.admin.from("ai_quality_evaluations").select("id").eq("id", body.id)).maybeSingle();
      if (!row) return json({ error: "Evaluation not found" }, 404);
      const { error } = await auth.admin.from("ai_quality_evaluations")
        .update({ reviewed_by: auth.userId, reviewed_at: new Date().toISOString(), review_note: str(body.note, 1000) || null }).eq("id", body.id);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    return json({ error: "Unknown op" }, 400);
  } catch (e) {
    console.error("ai-quality-control error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
