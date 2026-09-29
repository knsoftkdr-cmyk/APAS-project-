// supabase/functions/_shared/examAnalysis.ts
//
// One place that turns a student's attempt at a generated paper into a
// per-question result and a post-exam analysis (by section, Bloom level,
// difficulty and topic). Used by submit-assessment-paper-attempt (to store the
// analysis) and get-assessment-paper-attempt (to recompute it live, so a
// teacher's later review scores show up without any extra step).
//
// MARKS RULE: the PAPER decides what a question is worth. A bank item authored
// for 5 marks sitting in a 3-mark slot is graded out of its own rubric and then
// scaled by slot_marks / bank_max_marks, and can never exceed the slot. The
// same rule is applied by the DB trigger that finalises teacher-reviewed
// attempts (see 20261006000000_exam_readiness_simulation_cohort.sql).
//
// For an open-ended answer the score used is the teacher's if it has been
// reviewed, otherwise the AI's first pass (flagged provisional).

// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function scaleToSlot(rawScore: number, bankMax: number | null | undefined, slotMarks: number): number {
  const max = Number(bankMax) > 0 ? Number(bankMax) : slotMarks;
  const scaled = (Math.max(0, Number(rawScore) || 0) * slotMarks) / max;
  return r2(Math.min(scaled, slotMarks));
}

export interface AttemptResult {
  items: Row[];
  totals: { score: number; max_marks: number; pct: number | null; provisional: boolean; unanswered: number };
  analysis: {
    sections: Row[]; bloom: Row[]; difficulty: Row[]; topics: Row[]; weak_topics: Row[];
  };
}

export async function buildAttemptResult(admin: any, attempt: Row, paperId: string): Promise<AttemptResult> {
  const { data: paperItems } = await admin.from("generated_assessment_paper_items")
    .select("order_index, section_label, marks, mcq_item_id, extended_item_id")
    .eq("paper_id", paperId).order("order_index");
  const pis: Row[] = paperItems ?? [];

  const mcqIds = pis.filter((i) => i.mcq_item_id).map((i) => i.mcq_item_id);
  const extIds = pis.filter((i) => i.extended_item_id).map((i) => i.extended_item_id);

  const mcq = new Map<string, Row>();
  if (mcqIds.length) {
    const { data } = await admin.from("question_bank")
      .select("id, correct_option, explanation, bloom_level, difficulty, subtopic_id").in("id", mcqIds);
    for (const r of data ?? []) mcq.set(r.id, r);
  }
  const ext = new Map<string, Row>();
  if (extIds.length) {
    const { data } = await admin.from("question_bank_extended")
      .select("id, max_marks, bloom_level, difficulty, subtopic_id").in("id", extIds);
    for (const r of data ?? []) ext.set(r.id, r);
  }

  // subtopic -> topic name
  const subIds = [...new Set([...mcq.values(), ...ext.values()].map((r) => r.subtopic_id).filter(Boolean))];
  const topicBySub = new Map<number, { topic_id: number; topic_name: string }>();
  if (subIds.length) {
    const { data: subs } = await admin.from("subtopics").select("id, topic_id").in("id", subIds);
    const topicIds = [...new Set((subs ?? []).map((s: Row) => s.topic_id))];
    const { data: topics } = topicIds.length ? await admin.from("topics").select("id, topic_name").in("id", topicIds) : { data: [] };
    const nameByTopic = new Map<number, string>((topics ?? []).map((t: Row) => [t.id, t.topic_name]));
    for (const s of subs ?? []) topicBySub.set(s.id, { topic_id: s.topic_id, topic_name: nameByTopic.get(s.topic_id) ?? `Topic ${s.topic_id}` });
  }

  const answers = new Map<string, string>();
  for (const a of Array.isArray(attempt.mcq_answers) ? attempt.mcq_answers : []) answers.set(a.item_id, a.selected_option);

  const { data: subsRows } = await admin.from("open_response_submissions")
    .select("item_id, ai_suggested_score, ai_feedback, teacher_score, teacher_feedback, status")
    .eq("source", "test").eq("source_id", attempt.id);
  const openByItem = new Map<string, Row>();
  for (const s of subsRows ?? []) openByItem.set(s.item_id, s);

  let provisional = false;
  let unanswered = 0;
  const items: Row[] = pis.map((pi) => {
    const slot = Number(pi.marks);
    if (pi.mcq_item_id) {
      const q = mcq.get(pi.mcq_item_id) ?? {};
      const selected = answers.get(pi.mcq_item_id) ?? null;
      const correct = selected != null && selected === q.correct_option;
      if (selected == null) unanswered++;
      const t = topicBySub.get(q.subtopic_id);
      return {
        item_id: pi.mcq_item_id, question_type: "mcq", order_index: pi.order_index, section_label: pi.section_label,
        marks: slot, awarded: correct ? slot : 0, answered: selected != null, is_correct: correct,
        selected_option: selected, correct_option: q.correct_option, explanation: q.explanation ?? null,
        bloom_level: q.bloom_level ?? null, difficulty: q.difficulty ?? null,
        topic_id: t?.topic_id ?? null, topic_name: t?.topic_name ?? null,
      };
    }
    const q = ext.get(pi.extended_item_id) ?? {};
    const sub = openByItem.get(pi.extended_item_id);
    const t = topicBySub.get(q.subtopic_id);
    let awarded = 0, feedback: string | null = null, reviewed = false;
    if (sub) {
      reviewed = sub.status === "teacher_reviewed";
      const raw = reviewed ? sub.teacher_score : sub.ai_suggested_score;
      awarded = raw == null ? 0 : scaleToSlot(Number(raw), q.max_marks, slot);
      feedback = reviewed ? (sub.teacher_feedback ?? sub.ai_feedback ?? null) : (sub.ai_feedback ?? null);
      if (!reviewed) provisional = true;
    } else {
      unanswered++;
    }
    return {
      item_id: pi.extended_item_id, question_type: "open_ended", order_index: pi.order_index, section_label: pi.section_label,
      marks: slot, awarded, answered: !!sub, teacher_reviewed: reviewed, provisional: !!sub && !reviewed, feedback,
      bloom_level: q.bloom_level ?? null, difficulty: q.difficulty ?? null,
      topic_id: t?.topic_id ?? null, topic_name: t?.topic_name ?? null,
    };
  });

  const group = (keyFn: (i: Row) => string | null, labelKey: string, order?: string[]) => {
    const m = new Map<string, { marks: number; awarded: number; n: number }>();
    for (const it of items) {
      const k = keyFn(it) ?? "unclassified";
      const g = m.get(k) ?? { marks: 0, awarded: 0, n: 0 };
      g.marks += it.marks; g.awarded += it.awarded; g.n++;
      m.set(k, g);
    }
    const rows = [...m.entries()].map(([k, g]) => ({ [labelKey]: k, questions: g.n, marks: r2(g.awarded), max_marks: g.marks, pct: pct(g.awarded, g.marks) }));
    if (order) {
      const ix = (v: string) => { const i = order.indexOf(v); return i < 0 ? 99 : i; };
      rows.sort((a: Row, b: Row) => ix(a[labelKey]) - ix(b[labelKey]));
    }
    return rows;
  };

  const sections = group((i) => i.section_label, "label");
  const bloom = group((i) => i.bloom_level, "bloom_level", ["remember", "understand", "apply", "analyze", "evaluate", "create", "unclassified"]);
  const difficulty = group((i) => i.difficulty, "difficulty", ["easy", "medium", "hard", "unclassified"]);
  const topics = group((i) => i.topic_name, "topic_name");
  const weak_topics = topics.filter((t: Row) => t.max_marks >= 2 && (t.pct ?? 100) < 50 && t.topic_name !== "unclassified")
    .sort((a: Row, b: Row) => (a.pct ?? 0) - (b.pct ?? 0));

  const maxMarks = items.reduce((s, i) => s + i.marks, 0);
  const score = r2(items.reduce((s, i) => s + i.awarded, 0));
  return {
    items,
    totals: { score, max_marks: maxMarks, pct: pct(score, maxMarks), provisional, unanswered },
    analysis: { sections, bloom, difficulty, topics, weak_topics },
  };
}
