// Shared chat-history cleaner for the AI assistant edge functions.
// Gemini needs an alternating history that starts with a user turn.
// Drops leading assistant turns (e.g. a greeting), merges same-role runs,
// removes empty turns and keeps only the most recent `max` messages.
export interface HistoryTurn { role: "user" | "assistant"; text: string }

export function sanitizeHistory(raw: unknown, max = 10): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryTurn[] = [];
  for (const m of raw.slice(-max)) {
    const role = m?.role === "assistant" ? "assistant" : "user";
    const text = typeof m?.text === "string" ? m.text.trim().slice(0, 1500) : "";
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.text += "\n" + text;
    else out.push({ role, text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export function historyToContents(history: HistoryTurn[]) {
  return history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] }));
}
