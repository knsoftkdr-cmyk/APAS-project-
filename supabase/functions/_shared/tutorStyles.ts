// supabase/functions/_shared/tutorStyles.ts
//
// Teaching styles for the AI Tutor (used by student-tutor-chat):
//   "explain"  - the original behaviour. Returns "" so the system prompt is byte-for-byte unchanged.
//   "socratic" - guide with questions instead of handing over the answer.
//   "hint"     - progressive hint ladder driven by how many attempts/hints the student has used.
//
// Only the literal values below are honoured; anything else is treated as "explain".

export type TutorStyle = "explain" | "socratic" | "hint";
export const MAX_HINT_LEVEL = 4;

export function resolveTutorStyle(v: unknown): TutorStyle {
  return v === "socratic" || v === "hint" ? v : "explain";
}

export function clampHintLevel(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_HINT_LEVEL, Math.max(1, n));
}

const SOCRATIC = `

TEACHING STYLE - SOCRATIC MODE (the student chose this; it overrides the "examples and step-by-step explanations" guideline above):
- Do NOT hand over the final answer or a full solution straight away. Guide the student to discover it with questions.
- Ask ONE short, focused guiding question at a time (at most two sentences around it). Start from what the student already knows or has said, and build one step at a time.
- When the student answers: say what is right about their thinking, gently probe what is off (ask a question that lets them notice the gap; do not just correct them), then ask the next question.
- When the student gives a correct final answer, confirm it, ask them to explain why it works in their own words, and add one brief takeaway.
- Look at the conversation so far. If you have already asked about three guiding questions on this problem and the student is still stuck, OR they clearly ask you to just tell them twice, stop the questioning: give a clear, concise explanation of the answer, then ask one question to check they understood.
- A pure fact question ("what is the capital of..", "spell..") can be answered directly in one line followed by a question that deepens understanding.
- The subject restriction above still applies in full.`;

const HINT_LADDER: Record<number, string> = {
  1: "LEVEL 1 - a nudge only. Name the big idea or concept involved, or ask one question that points the student at what to look at. No formula, no steps, no numbers, no answer.",
  2: "LEVEL 2 - point to the approach. Say which method, rule or formula applies and what the very first move should be, but do NOT carry it out and do NOT give the answer.",
  3: "LEVEL 3 - show part of the way. Carry out the first step or two with the actual numbers/words so the student can see how it is done, then stop and ask them to do the rest. Still do NOT state the final answer.",
  4: "LEVEL 4 - the student has used all the hints. Now give the complete worked solution step by step with the final answer and a one-line reason for each step, then offer a similar practice question.",
};

function hintDirective(level: number): string {
  return `

TEACHING STYLE - HINT MODE (the student chose this; it overrides the "examples and step-by-step explanations" guideline above):
The student wants to solve the problem themselves and needs progressive hints, not the answer. The hint level for THIS reply is ${level} of ${MAX_HINT_LEVEL}.

How to reply:
1. If the student's latest message contains an ATTEMPT (a working or an answer): first say clearly whether it is right or wrong. If it is correct, congratulate them briefly, explain why it works in two or three lines, and invite them to try a new problem - do not give more hints. If it is wrong or partly wrong, point to WHERE the thinking went off without giving the correct answer, then give the hint for the level below.
2. If the student's message is a NEW problem (not a reply to your previous message), ignore the level number: treat it as LEVEL 1 and give only a level 1 hint.
3. If the student says they are stuck / asks for another hint, give the hint for the level below.

Hint for this reply: ${HINT_LADDER[level]}

Rules: give ONLY the hint for this level - never reveal anything from a higher level. Keep it short (under 120 words, except at level 4). Be warm and encouraging.
The subject restriction above still applies in full.`;
}

/** Prompt block appended after the base tutor prompt ("" for the default style). */
export function styleDirective(style: TutorStyle, hintLevel = 1): string {
  if (style === "socratic") return SOCRATIC;
  if (style === "hint") return hintDirective(clampHintLevel(hintLevel));
  return "";
}
