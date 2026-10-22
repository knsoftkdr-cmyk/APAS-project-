export const aiState: { mode: "ok" | "throw" | "nokey"; reply: string; calls: string[] } = { mode: "ok", reply: "", calls: [] };
export function getAiConfig() { if (aiState.mode === "nokey") throw new Error("No AI key configured"); return {} as any; }
export async function callAi(_cfg: any, prompt: string) { aiState.calls.push(prompt); if (aiState.mode === "throw") throw new Error("provider down"); return { text: aiState.reply, model: "stub" }; }
