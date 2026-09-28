// supabase/functions/_shared/gradeOpenResponse.ts
//
// The AI first-pass rubric grader, factored out of grade-open-response so
// submit-assessment-paper-attempt can score an open-ended answer the exact
// same way when a student submits a full exam paper, instead of duplicating
// the prompt and drifting out of sync with it.

// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;

export const GRADING_MODEL = "google/gemini-2.5-flash";
const AI_URL = Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface GradedResponse { total_score: number; rubric_scores: Row[]; feedback: string }

/**
 * item needs: question_type, context_passage, stem, sub_questions, model_answer, rubric.
 * Matches the columns selected from question_bank_extended by both callers.
 */
export async function aiGradeOpenResponse(apiKey: string, item: Row, answerText: string): Promise<GradedResponse> {
  const rubric: Row[] = Array.isArray(item.rubric) ? item.rubric : [];
  const subQuestions: Row[] = Array.isArray(item.sub_questions) ? item.sub_questions : [];

  const prompt = `You are grading a student's written answer against a rubric. Be fair but rigorous - do not award marks for vague or off-topic writing, and do not penalize phrasing/grammar if the reasoning is sound.

Question type: ${item.question_type}
${item.context_passage ? `Context given to the student:\n${item.context_passage}\n` : ""}
Question: ${item.stem}
${subQuestions.length ? `Sub-questions:\n${subQuestions.map((s) => `  (${s.id}) ${s.text} [${s.max_marks} marks]`).join("\n")}\n` : ""}
${item.model_answer ? `Model / ideal answer (reference only - the student's answer need not match it word for word):\n${item.model_answer}\n` : ""}
Rubric (grade against exactly these criteria):
${rubric.map((c, i) => `  ${i + 1}. ${c.criterion}${c.description ? ` - ${c.description}` : ""} [${c.max_marks} marks]${c.sub_question_id ? ` (sub-question ${c.sub_question_id})` : ""}`).join("\n")}

Student's answer:
"""
${answerText}
"""

For each rubric criterion, decide marks_awarded (can be partial, 0 to max_marks) and a one-sentence reasoning. Then give one short overall feedback comment for the student (2-3 sentences, specific and constructive).

Return ONLY JSON, no prose, no markdown fences:
{
  "rubric_scores": [{"criterion":"...","max_marks":2,"awarded":1.5,"met":false,"reasoning":"..."}],
  "total_score": 4.5,
  "feedback": "..."
}`;

  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GRADING_MODEL,
      messages: [
        { role: "system", content: "You output strict JSON only. No markdown, no commentary." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    }),
  });
  if (!resp.ok) throw new Error(`AI gateway error ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "{}";
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned);

  const rubricScores: Row[] = Array.isArray(parsed.rubric_scores) ? parsed.rubric_scores : [];
  const total = Number(parsed.total_score);
  const computedTotal = rubricScores.reduce((s, c) => s + (Number(c.awarded) || 0), 0);
  return {
    total_score: Number.isFinite(total) ? total : computedTotal,
    rubric_scores: rubricScores,
    feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
  };
}
