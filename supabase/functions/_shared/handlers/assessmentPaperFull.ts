// supabase/functions/_shared/handlers/assessmentPaperFull.ts
//
// Formerly the standalone `get-assessment-paper-full` edge function. It is no longer deployed on its
// own (Edge Function deployment limit): `evaluate-assessment` routes to it via action "get_paper_full"
// - see _shared/mergedRouter.ts. Request/response contract is unchanged.
//
// Staff only. Returns a complete generated paper for printing/export - either
// the STUDENT version (no keys/rubrics) or, with include_answer_key: true,
// a version with the correct option / model answer / rubric alongside each
// item for a teacher's own copy.
//
//   Body: { paper_id: uuid, include_answer_key?: boolean }
//
// This is the read side of "printable/PDF export": it hands back structured
// JSON (title, sections, items, marks). Turning that into an actual PDF is
// done by the client (AssessmentPaperPrint page) via the browser's
// print-to-PDF, not rendered server-side here - see that component for why.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export async function handleAssessmentPaperFull(req: Request): Promise<Response> {
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
    if (!profile || !STAFF_ROLES.includes(profile.role)) return json({ error: "Not permitted to export assessments" }, 403);

    const body = await req.json().catch(() => ({}));
    const { paper_id } = body;
    const includeKey = body.include_answer_key === true;
    if (!paper_id) return json({ error: "paper_id is required" }, 400);

    const { data: paper, error: paperErr } = await admin.from("generated_assessment_papers")
      .select("id, title, target_total_marks, assembled_total_marks, blueprint_id, status").eq("id", paper_id).single();
    if (paperErr || !paper) return json({ error: "Paper not found" }, 404);

    let durationMinutes: number | null = null;
    if (paper.blueprint_id) {
      const { data: bp } = await admin.from("assessment_blueprints").select("duration_minutes").eq("id", paper.blueprint_id).single();
      durationMinutes = bp?.duration_minutes ?? null;
    }

    const { data: paperItems, error: itemsErr } = await admin.from("generated_assessment_paper_items")
      .select("order_index, section_label, marks, mcq_item_id, extended_item_id").eq("paper_id", paper_id).order("order_index");
    if (itemsErr) throw new Error(itemsErr.message);

    const mcqIds = (paperItems ?? []).filter((i: Row) => i.mcq_item_id).map((i: Row) => i.mcq_item_id);
    const extIds = (paperItems ?? []).filter((i: Row) => i.extended_item_id).map((i: Row) => i.extended_item_id);

    const mcqCols = includeKey
      ? "id, stem, options, correct_option, explanation, bloom_level, difficulty"
      : "id, stem, options, bloom_level, difficulty";
    const extCols = includeKey
      ? "id, question_type, stem, context_passage, sub_questions, rubric, model_answer, bloom_level, difficulty"
      : "id, question_type, stem, context_passage, sub_questions, bloom_level, difficulty";

    const mcqById = new Map<string, Row>();
    if (mcqIds.length) {
      const { data } = await admin.from("question_bank").select(mcqCols).in("id", mcqIds);
      for (const r of data ?? []) mcqById.set(r.id, r);
    }
    const extById = new Map<string, Row>();
    if (extIds.length) {
      const { data } = await admin.from("question_bank_extended").select(extCols).in("id", extIds);
      for (const r of data ?? []) {
        const subQs = (r.sub_questions ?? []).map((sq: Row) => ({ id: sq.id, text: sq.text, max_marks: sq.max_marks }));
        extById.set(r.id, { ...r, sub_questions: subQs });
      }
    }

    const items = (paperItems ?? []).map((pi: Row) => {
      if (pi.mcq_item_id) {
        const q = mcqById.get(pi.mcq_item_id) ?? {};
        return {
          order_index: pi.order_index, section_label: pi.section_label, marks: pi.marks, question_type: "mcq",
          stem: q.stem, options: q.options, bloom_level: q.bloom_level, difficulty: q.difficulty,
          ...(includeKey ? { correct_option: q.correct_option, explanation: q.explanation } : {}),
        };
      }
      const q = extById.get(pi.extended_item_id) ?? {};
      return {
        order_index: pi.order_index, section_label: pi.section_label, marks: pi.marks, question_type: q.question_type,
        stem: q.stem, context_passage: q.context_passage, sub_questions: q.sub_questions, bloom_level: q.bloom_level, difficulty: q.difficulty,
        ...(includeKey ? { rubric: q.rubric, model_answer: q.model_answer } : {}),
      };
    });

    const sections: Row[] = [];
    for (const it of items) {
      let sec = sections.find((s) => s.label === it.section_label);
      if (!sec) { sec = { label: it.section_label, items: [] }; sections.push(sec); }
      sec.items.push(it);
    }

    return json({
      paper: { id: paper.id, title: paper.title, total_marks: paper.assembled_total_marks, duration_minutes: durationMinutes, status: paper.status },
      include_answer_key: includeKey,
      sections,
    });
  } catch (e) {
    console.error("get-assessment-paper-full error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
