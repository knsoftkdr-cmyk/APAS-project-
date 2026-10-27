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
//     items: [{ kind: "mcq" | "extended", id: uuid, marks: number, section_label?: string }] }   (1-100 items, in order)
// Returns: { paper_id, item_count, total_marks }

// deno-lint-ignore-file no-explicit-any
import { authenticateStaff, corsHeaders, json, UUID_RE } from "../learningGroupsData.ts";

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
    const items: Array<{ kind: "mcq" | "extended"; id: string; marks: number; section_label: string | null }> = [];
    for (const it of raw) {
      const kind = it?.kind === "mcq" ? "mcq" : it?.kind === "extended" ? "extended" : null;
      const marks = Number(it?.marks);
      if (!kind || !UUID_RE.test(String(it?.id))) return json({ error: "Each question needs a kind (mcq/extended) and an id" }, 400);
      if (!(marks > 0) || marks > 100) return json({ error: "Marks must be between 0 and 100" }, 400);
      const key = `${kind}:${it.id}`;
      if (seen.has(key)) return json({ error: "The same question is in the test twice" }, 400);
      seen.add(key);
      items.push({ kind, id: it.id, marks, section_label: typeof it.section_label === "string" && it.section_label.trim() ? it.section_label.trim().slice(0, 80) : null });
    }

    // Every question must exist, be active and not rejected by the quality check - same gates as the generator.
    const check = async (table: string, ids: string[]) => {
      if (!ids.length) return new Set<string>();
      const { data, error } = await admin.from(table).select("id, status, quality_flag").in("id", ids);
      if (error) throw new Error(error.message);
      return new Set((data ?? []).filter((r: any) => r.status === "active" && r.quality_flag !== "reject").map((r: any) => r.id));
    };
    const okMcq = await check("question_bank", items.filter((i) => i.kind === "mcq").map((i) => i.id));
    const okExt = await check("question_bank_extended", items.filter((i) => i.kind === "extended").map((i) => i.id));
    const bad = items.filter((i) => !(i.kind === "mcq" ? okMcq : okExt).has(i.id)).length;
    if (bad) return json({ error: `${bad} question${bad > 1 ? "s are" : " is"} no longer active in the item bank. Remove ${bad > 1 ? "them" : "it"} and try again.` }, 409);

    const total = items.reduce((s, i) => s + i.marks, 0);
    const { data: paper, error: paperErr } = await admin.from("generated_assessment_papers").insert({
      blueprint_id: null, title, status: "draft", target_total_marks: total, assembled_total_marks: total,
      coverage_report: { source: "manual_builder", item_count: items.length }, generated_by: userId,
      exam_pattern_code: null, instructions,
    }).select("id").single();
    if (paperErr) throw new Error(paperErr.message);

    const { error: itemsErr } = await admin.from("generated_assessment_paper_items").insert(items.map((i, idx) => ({
      paper_id: paper.id,
      mcq_item_id: i.kind === "mcq" ? i.id : null,
      extended_item_id: i.kind === "extended" ? i.id : null,
      section_label: i.section_label ?? (i.kind === "mcq" ? "Section A - Multiple choice" : "Section B - Written answers"),
      marks: i.marks, order_index: idx,
    })));
    if (itemsErr) {
      await admin.from("generated_assessment_papers").delete().eq("id", paper.id); // don't leave an empty paper behind
      throw new Error(itemsErr.message);
    }
    return json({ paper_id: paper.id, item_count: items.length, total_marks: total });
  } catch (e) {
    console.error("build-manual-paper error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
