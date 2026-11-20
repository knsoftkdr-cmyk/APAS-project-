// Builds the "practice question" block of the AI Tutor prompt from dpp_tutor_context().
// Pure (no I/O) so it can be unit-tested. The database only releases the answer key and explanation AFTER the
// student has submitted the attempt (locked=false). While an attempt is active the context carries the question
// only (locked=true) and the tutor is told to coach with hints and never reveal or confirm the answer.

interface DppCtx {
  locked?: boolean; subject?: string | null; chapter?: string | null; stem?: string | null;
  options?: Record<string, string> | null; question_type?: string | null;
  student_answer?: string | null; is_correct?: boolean | null; correct_answer?: string | null; explanation?: string | null;
}

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function dppContextDirective(ctx: DppCtx | null | undefined): string {
  if (!ctx || !ctx.stem) return "";
  const lines = [`\n\nDAILY PRACTICE QUESTION (the student is asking about this): ${clip(ctx.stem, 800)}`];
  if (ctx.subject || ctx.chapter) lines.push(`Subject/chapter: ${[ctx.subject, ctx.chapter].map((x) => clip(x, 80)).filter(Boolean).join(" > ")}`);
  if (ctx.options && typeof ctx.options === "object") {
    lines.push("Options: " + Object.entries(ctx.options).map(([k, v]) => `${clip(k, 2)}. ${clip(v, 200)}`).join(" | "));
  }
  if (ctx.locked) {
    lines.push(
      "ASSESSMENT IS STILL IN PROGRESS. Rules: do NOT state, confirm, eliminate or hint at which option or value is the final answer. " +
      "Do not solve this exact question. Teach the underlying concept, give a similar worked example with different numbers, " +
      "or ask a guiding question. If the student asks for the answer, kindly say it can be reviewed after they submit.");
    return lines.join("\n");
  }
  if (ctx.student_answer != null) lines.push(`Student's answer: ${clip(ctx.student_answer, 300)}${ctx.is_correct === true ? " (correct)" : ctx.is_correct === false ? " (incorrect)" : " (awaiting teacher marking)"}`);
  if (ctx.correct_answer != null) lines.push(`Correct answer: ${clip(ctx.correct_answer, 300)}`);
  if (ctx.explanation) lines.push(`Teacher explanation: ${clip(ctx.explanation, 1200)}`);
  lines.push(
    "The attempt is submitted, so you may reveal and explain the answer. Explain step by step in simple words, say what likely went wrong " +
    "if the answer was incorrect, then suggest a similar practice idea and invite follow-up questions.");
  return lines.join("\n");
}
