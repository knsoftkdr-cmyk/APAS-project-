// Builds the "current lesson" block of the AI Tutor prompt from get_topic_tutor_context().
// Pure (no I/O) so it can be unit-tested. The context is built by the database only for a topic the student
// may open (published, own school, prerequisites met), so nothing here widens what the student can see.

interface TopicCtx {
  academic_year?: string | null; semester?: string | null; subject?: string | null; course_title?: string | null;
  module?: string | null; chapter?: string | null;
  topic?: { title?: string | null; description?: string | null; objectives?: string | null; content?: string | null } | null;
  materials?: { title?: string | null; type?: string | null; notes?: string | null }[] | null;
  completed?: boolean | null; time_spent_seconds?: number | null;
  next_topic?: { title?: string | null } | null;
  needs_support?: string[] | null;
}

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function topicContextDirective(ctx: TopicCtx | null | undefined): string {
  if (!ctx || !ctx.topic?.title) return "";
  const path = [ctx.academic_year, ctx.semester, ctx.subject ?? ctx.course_title, ctx.module, ctx.chapter, ctx.topic.title]
    .map((p) => clip(p, 120)).filter(Boolean).join(" > ");
  const lines = [`\n\nCURRENT LESSON (the student is studying this right now): ${path}`];
  if (ctx.topic.description) lines.push(`Topic summary: ${clip(ctx.topic.description, 600)}`);
  if (ctx.topic.objectives) lines.push(`Learning objectives: ${clip(ctx.topic.objectives, 600)}`);
  if (ctx.topic.content) lines.push(`Lesson text:\n${clip(ctx.topic.content, 4000)}`);
  const notes = (ctx.materials ?? []).filter((m) => m?.title).slice(0, 8);
  if (notes.length) {
    lines.push("Learning materials for this topic:\n" + notes.map((m) =>
      `- ${clip(m.title, 120)} (${clip(m.type, 20)})${m.notes ? `: ${clip(m.notes, 1500)}` : ""}`).join("\n"));
  }
  const mins = Math.round((ctx.time_spent_seconds ?? 0) / 60);
  lines.push(`Progress: ${ctx.completed ? "topic completed" : "topic not completed yet"}${mins ? `, about ${mins} min spent` : ""}.`);
  if (ctx.needs_support?.length) lines.push(`Topics the student has spent a long time on without finishing (offer extra support): ${ctx.needs_support.map((t) => clip(t, 80)).join("; ")}.`);
  if (ctx.next_topic?.title) lines.push(`Recommended next topic: ${clip(ctx.next_topic.title, 120)}.`);
  lines.push(
    "Tutor rules for this lesson: answer from the lesson text and materials above first and say so when you do; " +
    "explain in simple words; if the question is outside this lesson but still academic, answer briefly and link back to it; " +
    "when the student seems to have understood, suggest the recommended next topic.");
  return lines.join("\n");
}
