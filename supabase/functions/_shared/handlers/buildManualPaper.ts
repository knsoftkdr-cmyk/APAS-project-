// supabase/functions/_shared/handlers/buildManualPaper.ts
//
// ONE-SCREEN ASSESSMENT BUILDER (sheet row 42). Not a standalone edge function (deployment limit):
// `evaluate-assessment` routes to it via action "build_paper" - see _shared/mergedRouter.ts.
//
// The Mock Exam builder ASSEMBLES a paper automatically from a pattern. This is the hand-picked counterpart:
// the teacher chooses exact questions from the item bank, sets marks and order, and gets the same kind of
// generated_assessment_papers row back - so assigning (action "assign_paper"), taking (My Exams), auto-marking
// and Exam Reviews all work unchanged.
//
// Staff only. Body:
//   { title: string, instructions?: string[],
//     items: [{ kind: "mcq" | "extended", id: uuid, marks: number, section_label?: string }
//             | { kind: "custom", question: QuestionDraft, marks?: number, section_label?: string }] }   (1-100 items, in order)
// "custom" items are questions the teacher refined with the Copilot (Chat to Refine Questions). They are validated here with the same
// rules the AI output goes through, then stored as NEW item-bank rows (the original bank rows are never edited) and attached to the paper.
// Returns: { paper_id, item_count, total_marks }

// deno-lint-ignore-file no-explicit-any
import { authenticateStaff, corsHeaders, json, UUID_RE } from "../learningGroupsData.ts";
import { validateQuestionDraft, type QuestionDraft } from "../paperRefineModel.ts";

const MAX_ITEMS = 100;

export async function handleBuildManualPaper(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await authenticateStaff(req);
    if (!auth.ok) return auth.res;
    const { admin, userId } = auth.ctx;
    const body = await req.json().catch(() => ({}));

    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    if (!title) return json({ error: "Give the test a title" }, 400);
    const instructions = (Array.isArray(body.instructions) ? body.instructions : [])
      .map((s: unknown) => (typeof s === "string" ? s.trim().slice(0, 300) : "")).filter(Boolean).slice(0, 15);

    const raw = Array.isArray(body.items) ? body.items : [];
    if (!raw.length) return json({ error: "Add at least one question" }, 400);
    if (raw.length > MAX_ITEMS) return json({ error: `A test can have at most ${MAX_ITEMS} questions` }, 400);

    const seen = new Set<string>();
    type Item = { kind: "mcq" | "extended"; id: string | null; marks: number; section_label: string | null; draft?: QuestionDraft };
    const items: Item[] = [];
    for (const it of raw) {
      const marks = Number(it?.marks);
      const label = typeof it?.section_label === "string" && it.section_label.trim() ? it.section_label.trim().slice(0, 80) : null;
      if (it?.kind === "custom") {
        const v = validateQuestionDraft({ ...(it.question ?? {}), marks: it?.question?.marks ?? it?.marks });
        if (!v.ok) return json({ error: `A refined question is not valid: ${v.errors[0]}` }, 400);
        if (!v.value.learning_objective_id) return json({ error: "A refined question needs a learning objective (pick a chapter with objectives)" }, 400);
        items.push({ kind: v.value.type === "mcq" ? "mcq" : "extended", id: null, marks: v.value.marks, section_label: label, draft: v.value });
        continue;
      }
      const kind = it?.kind === "mcq" ? "mcq" : it?.kind === "extended" ? "extended" : null;
      if (!kind || !UUID_RE.test(String(it?.id))) return json({ error: "Each question needs a kind (mcq/extended) and an id" }, 400);
      if (!(marks > 0) || marks > 100) return json({ error: "Marks must be between 0 and 100" }, 400);
      const key = `${kind}:${it.id}`;
      if (seen.has(key)) return json({ error: "The same question is in the test twice" }, 400);
      seen.add(key);
      items.push({ kind, id: it.id, marks, section_label: label });
    }

    // Every question must exist, be active and not rejected by the quality check - same gates as the generator.
    const check = async (table: string, ids: string[]) => {
      if (!ids.length) return new Set<string>();
      const { data, error } = await admin.from(table).select("id, status, quality_flag").in("id", ids);
      if (error) throw new Error(error.message);
      return new Set((data ?? []).filter((r: any) => r.status === "active" && r.quality_flag !== "reject").map((r: any) => r.id));
    };
    const existing = items.filter((i) => i.id);
    const okMcq = await check("question_bank", existing.filter((i) => i.kind === "mcq").map((i) => i.id!));
    const okExt = await check("question_bank_extended", existing.filter((i) => i.kind === "extended").map((i) => i.id!));
    const bad = existing.filter((i) => !(i.kind === "mcq" ? okMcq : okExt).has(i.id!)).length;
    if (bad) return json({ error: `${bad} question${bad > 1 ? "s are" : " is"} no longer active in the item bank. Remove ${bad > 1 ? "them" : "it"} and try again.` }, 409);

    // Refined / AI-written questions -> new item-bank rows. Originals are never touched; rows created here are removed again if the paper fails.
    const created: Array<{ table: string; id: string }> = [];
    const cleanup = async () => { for (const c of created) await admin.from(c.table).delete().eq("id", c.id); };
    const customItems = items.filter((i) => i.draft);
    if (customItems.length) {
      const loIds = [...new Set(customItems.map((i) => i.draft!.learning_objective_id!))];
      const { data: los, error: loErr } = await admin.from("learning_objectives").select("id").in("id", loIds).eq("status", "active");
      if (loErr) throw new Error(loErr.message);
      const okLo = new Set((los ?? []).map((r: any) => Number(r.id)));
      if (loIds.some((id) => !okLo.has(id))) return json({ error: "A refined question points at a learning objective that does not exist" }, 400);
      try {
        for (const it of customItems) {
          const d = it.draft!;
          const table = d.type === "mcq" ? "question_bank" : "question_bank_extended";
          const row = d.type === "mcq" ? {
            learning_objective_id: d.learning_objective_id, stem: d.stem, options: d.options, correct_option: d.correct_option,
            explanation: d.explanation, bloom_level: d.bloom_level, status: "active", ai_generated: true, generation_model: "teacher-refine",
            created_by: userId, reviewed_by: userId, reviewed_at: new Date().toISOString(),
            // cold-start difficulty prior in the same convention the builder reads back (easy ≈ -1, medium ≈ 0, hard ≈ +1)
            b_prior: d.difficulty === "easy" ? -1 : d.difficulty === "hard" ? 1 : 0, irt_b: d.difficulty === "easy" ? -1 : d.difficulty === "hard" ? 1 : 0,
          } : {
            learning_objective_id: d.learning_objective_id, question_type: d.type, stem: d.stem, context_passage: d.context_passage,
            sub_questions: d.sub_questions ?? [], model_answer: d.model_answer, max_marks: d.marks, bloom_level: d.bloom_level,
            difficulty: d.difficulty, status: "active", ai_generated: true, generation_model: "teacher-refine",
            created_by: userId, reviewed_by: userId, reviewed_at: new Date().toISOString(),
          };
          const ins = await admin.from(table).insert(row).select("id").single();
          if (!ins.error) { it.id = ins.data.id; created.push({ table, id: ins.data.id }); continue; }
          if (ins.error.code !== "23505") throw new Error(ins.error.message);
          // Same objective + same wording already exists: reuse it only if it is genuinely the same question.
          const { data: ex } = await admin.from(table).select("*").eq("learning_objective_id", d.learning_objective_id).eq("stem", d.stem).maybeSingle();
          const same = ex && (d.type === "mcq"
            ? ex.correct_option === d.correct_option && JSON.stringify(ex.options) === JSON.stringify(d.options)
            : ex.question_type === d.type && (ex.model_answer ?? "") === (d.model_answer ?? ""));
          if (!ex || !same || ex.status !== "active") {
            await cleanup();
            return json({ error: "A question with the same wording already exists in the item bank with a different answer. Reword the question slightly and try again." }, 409);
          }
          it.id = ex.id;
        }
      } catch (e) { await cleanup(); throw e; }
      const ids = items.map((i) => `${i.kind}:${i.id}`);
      if (new Set(ids).size !== ids.length) { await cleanup(); return json({ error: "The same question is in the test twice" }, 400); }
    }

    const total = items.reduce((s, i) => s + i.marks, 0);
    const { data: paper, error: paperErr } = await admin.from("generated_assessment_papers").insert({
      blueprint_id: null, title, status: "draft", target_total_marks: total, assembled_total_marks: total,
      coverage_report: { source: "manual_builder", item_count: items.length, refined_questions: customItems.length }, generated_by: userId,
      exam_pattern_code: null, instructions,
    }).select("id").single();
    if (paperErr) { await cleanup(); throw new Error(paperErr.message); }

    const { error: itemsErr } = await admin.from("generated_assessment_paper_items").insert(items.map((i, idx) => ({
      paper_id: paper.id,
      mcq_item_id: i.kind === "mcq" ? i.id : null,
      extended_item_id: i.kind === "extended" ? i.id : null,
      section_label: i.section_label ?? (i.kind === "mcq" ? "Section A - Multiple choice" : "Section B - Written answers"),
      marks: i.marks, order_index: idx,
    })));
    if (itemsErr) {
      await admin.from("generated_assessment_papers").delete().eq("id", paper.id); // don't leave an empty paper behind
      await cleanup();
      throw new Error(itemsErr.message);
    }
    return json({ paper_id: paper.id, item_count: items.length, total_marks: total });
  } catch (e) {
    console.error("build-manual-paper error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
