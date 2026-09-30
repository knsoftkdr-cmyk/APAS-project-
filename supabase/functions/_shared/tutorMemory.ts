// supabase/functions/_shared/tutorMemory.ts
//
// Persistent AI Tutor chat history (table tutor_chat_messages).
//
// Trust model: student-tutor-chat is deployed with verify_jwt=false and historically trusted the
// `student_id` in the body. History is personal data, so it is only read/written when the caller's
// own JWT verifies AND belongs to that same student_id. Anything else (e.g. the old anon-key
// callers) keeps the exact old behaviour, minus persistence.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// deno-lint-ignore no-explicit-any
type Admin = any;

const KEEP_PER_THREAD = 200;     // older rows are pruned so a thread can't grow forever
const MAX_STORED_CHARS = 20000;  // hard cap per stored message

export type TutorMode = "tutor" | "career";
export const resolveMode = (v: unknown): TutorMode => (v === "career" ? "career" : "tutor");

/** True only if the request carries a valid user JWT whose user id equals `studentId`. */
export async function callerOwnsStudent(req: Request, studentId: string): Promise<boolean> {
  try {
    const auth = req.headers.get("Authorization");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!auth || !anon || !auth.toLowerCase().startsWith("bearer ")) return false;
    const client = createClient(Deno.env.get("SUPABASE_URL")!, anon, { global: { headers: { Authorization: auth } } });
    const { data, error } = await client.auth.getUser();
    return !error && !!data?.user && data.user.id === studentId;
  } catch {
    return false;
  }
}

export async function saveMessage(
  admin: Admin, studentId: string, mode: TutorMode, role: "user" | "assistant", content: string, style: string | null,
): Promise<void> {
  const text = content.trim().slice(0, MAX_STORED_CHARS);
  if (!text) return;
  try {
    const { error } = await admin.from("tutor_chat_messages").insert({ student_id: studentId, mode, role, content: text, style });
    if (error) console.warn("tutor memory save failed:", error.message);
  } catch (e) {
    console.warn("tutor memory save threw:", e);
  }
}

/** Keep only the newest KEEP_PER_THREAD rows of a thread. Best effort. */
export async function pruneThread(admin: Admin, studentId: string, mode: TutorMode): Promise<void> {
  try {
    const { data } = await admin.from("tutor_chat_messages").select("id")
      .eq("student_id", studentId).eq("mode", mode).order("id", { ascending: false }).range(KEEP_PER_THREAD, KEEP_PER_THREAD);
    const cutoff = data?.[0]?.id;
    if (cutoff != null) await admin.from("tutor_chat_messages").delete().eq("student_id", studentId).eq("mode", mode).lte("id", cutoff);
  } catch (e) {
    console.warn("tutor memory prune threw:", e);
  }
}

/** Extracts the assistant text from OpenAI-style SSE lines, tolerating chunk boundaries mid-line. */
export class SseTextCollector {
  text = "";
  private buf = "";
  push(chunk: string) {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf("\n")) !== -1) {
      let line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const c = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (typeof c === "string") this.text += c;
      } catch { /* partial / non-JSON line: ignore */ }
    }
  }
}

/**
 * Passes the model's SSE stream through to the client byte-for-byte while collecting the reply text.
 * `onDone(text)` runs exactly once: when the stream finishes, or if the client disconnects (whatever
 * was streamed so far is kept, so a dropped connection never leaves a question with no answer).
 */
export function tapStream(body: ReadableStream<Uint8Array>, onDone: (text: string) => Promise<void>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const collector = new SseTextCollector();
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    try { await onDone(collector.text); } catch (e) { console.warn("tutor memory onDone failed:", e); }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { await finish(); controller.close(); return; }
        collector.push(decoder.decode(value, { stream: true }));
        controller.enqueue(value);
      } catch (e) {
        await finish();
        controller.error(e);
      }
    },
    async cancel(reason) {
      await finish();
      await reader.cancel(reason).catch(() => {});
    },
  });
}
