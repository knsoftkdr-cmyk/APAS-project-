// supabase/functions/_shared/voiceTutorSafety.ts
//
// Voice conversational tutor (sheet row 28): age-appropriate safeguards used by student-tutor-chat.
//   1. screenStudentMessage - runs BEFORE the model. A child talking out loud is more likely to say something
//      personal or worrying than one typing; those messages get a fixed, caring reply (never an improvised one)
//      and the model is not called. Applies to typed messages too.
//   2. voiceDirective       - appended to the system prompt in voice mode: short, speakable, age-banded replies.
//   3. sseFromText          - wraps a fixed reply in the same OpenAI-style SSE stream the client already parses.

export type ScreenKind = "ok" | "distress" | "personal_info" | "unsafe_request";
export interface ScreenResult { kind: ScreenKind; reply?: string }

const DISTRESS = /\b(kill myself|want to die|end my life|suicid\w*|hurt myself|cut myself|self[- ]harm|no one loves me|(he|she|they|someone) (touches|touched|hits|hit|beats|beat) me|being abused|abus(e|ing) me)\b/i;
const PERSONAL = /\b(my (home )?address is|i live at|my (phone|mobile|whatsapp) (number )?is|my password is|my otp is|my aadhaar)\b|(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/i;
const UNSAFE = /\b(how (do i|to) (make|build) (a )?(bomb|gun|weapon)|buy (drugs|alcohol|cigarettes)|porn\w*|sex(ual)? (video|photo)s?)\b/i;

export function screenStudentMessage(text: string): ScreenResult {
  if (DISTRESS.test(text)) {
    return {
      kind: "distress",
      reply: "I'm really glad you told me. What you're feeling matters, and you don't have to handle it alone. " +
        "Please talk to a grown-up you trust right now - a parent, your class teacher or the school counsellor. " +
        "If you are in danger or thinking about hurting yourself, call **1098** (Childline, free, any time) or **112**. " +
        "I'm a study helper, so a real person is the right one to help with this. 💙",
    };
  }
  if (UNSAFE.test(text)) {
    return {
      kind: "unsafe_request",
      reply: "That's not something I can help with. I'm your school subject tutor - ask me anything about Maths, Science, English, Social Studies or your other subjects!",
    };
  }
  if (PERSONAL.test(text)) {
    return {
      kind: "personal_info",
      reply: "Quick safety tip: please don't share personal details like your address, phone number or passwords with me or anyone online. " +
        "I don't need them to help you study. Now, what would you like to learn?",
    };
  }
  return { kind: "ok" };
}

/** Spoken-reply rules per age band. Grade bands come from AITutor.tsx (getGradeBand). */
export function voiceDirective(gradeBand: unknown): string {
  const band = typeof gradeBand === "string" ? gradeBand : "";
  const length = band === "pre_primary" || band === "early"
    ? "at most 50 words, very short sentences, simple everyday words, one idea at a time"
    : band === "upper_primary"
      ? "at most 80 words, short sentences, explain any new word"
      : "at most 120 words";
  return `

VOICE CONVERSATION MODE (the student is TALKING to you and your reply will be read aloud by text-to-speech):
- Reply in ${length}.
- Write plain spoken sentences. No markdown, no bullet symbols, no tables, no emojis, no code. Say numbers and maths the way a teacher would say them aloud (e.g. "three quarters", "x squared").
- Sound warm and encouraging, like a kind teacher in the classroom. End with ONE short question so the conversation can continue.
- If what you heard does not make sense (speech recognition can mishear), ask the student to say it again instead of guessing.
- Never ask for or repeat personal details (name of school, address, phone, photos). Stay on school subjects.`;
}

/** A fixed reply as an OpenAI-style SSE stream, byte-compatible with the model streams. */
export function sseFromText(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
