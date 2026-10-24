// supabase/functions/_shared/handlers/masteryEvidenceReport.ts
//
// AI learning evidence report (feature 38): explains why a student's mastery estimate changed.
// Never a standalone edge function (Edge Function deployment limit): `cat-session` routes to it via the
// action "mastery_evidence" - see _shared/mergedRouter.ts.
//
//   Body: { student_profile_id?: uuid (parents only), learning_objective_id?: number, days?: 1-90,
//           explain?: boolean, language?: "en" | "hi" | "te" | ... }
//
//   Response: { window_days, overall, objectives[], truncated, ai: { status, model? } }
//
// SAFE BY CONSTRUCTION
//   * Students see only themselves. Parents see only children linked to them in parent_students. Nobody else.
//   * Read-only: nothing is written. The facts come from mastery_evidence_log, and the explanation is built by
//     fixed rules (masteryEvidenceModel.ts), so it is always true.
//   * The AI is called ONLY when the user asks ("explain": true). It receives topic names and numbers only (no
//     student name, no answers), and its text is validated and cleaned. If it fails, the facts still come back.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAi, getAiConfig } from "../aiClient.ts";
import { languageDirective, resolveTeachingLanguage } from "../languages.ts";
import { resolveCaller, studentIdForProfile } from "../studentAccess.ts";
import {
  MAX_ROWS,
  buildNarrationPrompt,
  cleanRows,
  cleanText,
  clampDays,
  explainSummary,
  groupByObjective,
  overallStats,
  parseNarration,
  rankSummaries,
  summariseObjective,
  type ObjectiveSummary,
} from "../masteryEvidenceModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export async function handleMasteryEvidenceReport(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new HttpError(401, "Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userError } = await asCaller.auth.getUser();
    if (userError || !user) throw new HttpError(401, "Not authenticated");

    const caller = await resolveCaller(admin, user.id);
    if (!caller) throw new HttpError(403, "Profile not found");
    if (caller.role !== "student" && caller.role !== "parent") throw new HttpError(403, "Not permitted");

    const body = await req.json().catch(() => ({}));

    // ── whose evidence ────────────────────────────────────────────────────────────────────────
    let studentId: string;
    if (caller.role === "student") {
      const own = await studentIdForProfile(admin, user.id);
      if (!own) throw new HttpError(404, "No student record found for this account");
      studentId = own;
    } else {
      const childProfileId = body?.student_profile_id;
      if (typeof childProfileId !== "string" || !UUID_RE.test(childProfileId)) {
        throw new HttpError(400, "Please choose a child.", "bad_student");
      }
      const { data: link } = await admin.from("parent_students").select("student_id")
        .eq("parent_id", user.id).eq("student_id", childProfileId).maybeSingle();
      if (!link) throw new HttpError(403, "Not permitted");
      const { data: student } = await admin.from("students").select("id").eq("profile_id", childProfileId).maybeSingle();
      if (!student) throw new HttpError(404, "No student record found for this child");
      studentId = student.id;
    }

    // ── the evidence ──────────────────────────────────────────────────────────────────────────
    const days = clampDays(body?.days);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const objectiveFilter = Number.isInteger(body?.learning_objective_id) && body.learning_objective_id > 0
      ? (body.learning_objective_id as number)
      : null;

    let query = admin.from("mastery_evidence_log")
      .select("learning_objective_id, is_correct, source, p_mastery_before, p_mastery_after, responded_at")
      .eq("student_id", studentId)
      .gte("responded_at", since)
      .order("responded_at", { ascending: false })
      .limit(MAX_ROWS);
    if (objectiveFilter !== null) query = query.eq("learning_objective_id", objectiveFilter);

    const { data: rawRows, error: rowsError } = await query;
    if (rowsError) {
      console.error("mastery-evidence: query failed", rowsError);
      throw new HttpError(500, "Could not load the learning evidence right now. Please try again.");
    }
    const rows = cleanRows(rawRows ?? []);
    const truncated = (rawRows ?? []).length >= MAX_ROWS;

    // ── facts per objective ───────────────────────────────────────────────────────────────────
    const summaries: ObjectiveSummary[] = [];
    for (const [objectiveId, list] of groupByObjective(rows)) {
      const s = summariseObjective(objectiveId, list);
      if (s) summaries.push(s);
    }
    const ranked = rankSummaries(summaries);

    const texts = new Map<number, string>();
    if (ranked.length > 0) {
      const { data: objectives } = await admin.from("learning_objectives")
        .select("id, objective_text").in("id", ranked.map((s) => s.objective_id));
      for (const o of objectives ?? []) texts.set(Number(o.id), cleanText(o.objective_text, 200));
    }

    // ── optional AI wording (only when asked) ─────────────────────────────────────────────────
    let narration: Record<number, string> = {};
    let ai: { status: "not_requested" | "ok" | "unavailable"; model?: string } = { status: "not_requested" };
    if (body?.explain === true && ranked.length > 0) {
      try {
        const cfg = getAiConfig();
        const lang = resolveTeachingLanguage(body.language);
        const items = ranked.map((s) => ({
          objective_id: s.objective_id,
          objective_text: texts.get(s.objective_id) ?? "this topic",
          summary: s,
        }));
        const out = await callAi(cfg, buildNarrationPrompt(items, languageDirective(lang)), {
          temperature: 0.3,
          maxOutputTokens: 2048,
        });
        narration = parseNarration(out.text, ranked.map((s) => s.objective_id));
        ai = Object.keys(narration).length > 0 ? { status: "ok", model: out.model } : { status: "unavailable" };
      } catch (e) {
        console.error("mastery-evidence: AI wording failed (facts are still returned)", e);
        ai = { status: "unavailable" };
      }
    }

    return json({
      window_days: days,
      overall: overallStats(rows),
      objectives: ranked.map((s) => ({
        ...s,
        objective_text: texts.get(s.objective_id) ?? "Learning objective",
        reasons: explainSummary(s),
        ai_summary: narration[s.objective_id] ?? null,
      })),
      truncated,
      ai,
    });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error("mastery-evidence error", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
