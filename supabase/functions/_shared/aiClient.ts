// supabase/functions/_shared/aiClient.ts
//
// One place that talks to the AI provider. Calls Gemini directly using the same
// secrets generate-learning-objectives uses (GOOGLE_GEMINI_API_KEY_2 /
// GOOGLE_GEMINI_API_KEY / GEMINI_KEY_2..4), rotating across keys and models on
// failures. Falls back to the Lovable AI Gateway only if LOVABLE_API_KEY is set.
//
// Models: Google shut down the 2.0 models and restricted 2.5 to accounts that
// already used it, so the defaults are the current 3.x Flash models. To change
// them without redeploying code, set a Supabase secret, e.g.
//   GEMINI_MODELS=gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite

const DEFAULT_GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const LOVABLE_MODEL = "google/gemini-2.5-flash";

function geminiModels(): string[] {
  const fromEnv = (Deno.env.get("GEMINI_MODELS") ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_GEMINI_MODELS;
}

export interface AiConfig { geminiKeys: string[]; lovableKey: string | null }

export function getAiConfig(): AiConfig {
  const geminiKeys = [
    Deno.env.get("GOOGLE_GEMINI_API_KEY_2"),
    Deno.env.get("GOOGLE_GEMINI_API_KEY"),
    Deno.env.get("GEMINI_KEY_2"),
    Deno.env.get("GEMINI_KEY_3"),
    Deno.env.get("GEMINI_KEY_4"),
  ].filter((k, i, a): k is string => !!k && k.trim().length > 0 && a.indexOf(k) === i);
  const cfg = { geminiKeys, lovableKey: Deno.env.get("LOVABLE_API_KEY") || null };
  if (cfg.geminiKeys.length === 0 && !cfg.lovableKey) {
    throw new Error("No AI key configured. Set GOOGLE_GEMINI_API_KEY_2 (or GOOGLE_GEMINI_API_KEY / LOVABLE_API_KEY) in the Supabase function secrets.");
  }
  return cfg;
}

// reasoning: let the model think before answering (default is minimal thinking, which is fine for writing
// but not for checking arithmetic / working out a correct answer).
// timeoutMs: total time budget across every key/model attempt. Edge functions are killed at their wall-clock
// limit with a non-JSON response, so a slow call must give up early enough for the caller to answer cleanly.
// thinkingLevel: with reasoning, cap how long the model thinks (3.x levels; 2.5 gets a matching token budget).
export interface CallOptions {
  system?: string; temperature?: number; maxOutputTokens?: number; reasoning?: boolean;
  timeoutMs?: number; thinkingLevel?: "low" | "medium" | "high";
}

const THINKING_BUDGET_25 = { low: 1024, medium: 4096, high: 8192 } as const;

function geminiUrl(model: string, key: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
}

/** Returns the model's raw text plus the model that produced it. */
export async function callAi(cfg: AiConfig, prompt: string, opts: CallOptions = {}): Promise<{ text: string; model: string }> {
  const system = opts.system ?? "You output strict JSON only. No markdown, no commentary.";
  const temperature = opts.temperature ?? 0.4;
  // Thinking tokens count toward this limit, so leave generous headroom for a batch of MCQs.
  const maxOutputTokens = opts.maxOutputTokens ?? 16384;
  const errors: string[] = [];
  const deadline = opts.timeoutMs ? Date.now() + opts.timeoutMs : Number.POSITIVE_INFINITY;
  // With reasoning, an explicit thinkingLevel is sent (and dropped on a 400 like the minimal setting).
  const thinkingFor = (model: string) =>
    opts.reasoning
      ? (opts.thinkingLevel
        ? (model.startsWith("gemini-2.5") ? { thinkingBudget: THINKING_BUDGET_25[opts.thinkingLevel] } : { thinkingLevel: opts.thinkingLevel })
        : null)
      : (model.startsWith("gemini-2.5") ? { thinkingBudget: 0 } : { thinkingLevel: "minimal" });

  attempts:
  for (const key of cfg.geminiKeys) {
    for (const model of geminiModels()) {
      // Send the thinking setting; if a model rejects it (400), retry once without it.
      const thinking = thinkingFor(model);
      for (const withThinking of thinking ? [true, false] : [false]) {
        const remaining = deadline - Date.now();
        if (remaining < 3000) { errors.push("timed out"); break attempts; }
        try {
          const generationConfig: Record<string, unknown> = { temperature, maxOutputTokens, responseMimeType: "application/json" };
          if (withThinking) generationConfig.thinkingConfig = thinking;
          const resp = await fetch(geminiUrl(model, key), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig,
            }),
            signal: Number.isFinite(remaining) ? AbortSignal.timeout(remaining) : undefined,
          });
          if (resp.status === 400 && withThinking) { await resp.text(); continue; } // retry without thinkingConfig
          if (resp.status === 429 || resp.status === 503) { errors.push(`${model}: rate limited (${resp.status})`); break; }
          if (!resp.ok) { errors.push(`${model}: ${resp.status} ${(await resp.text()).replace(/\s+/g, " ").slice(0, 120)}`); break; }
          const data = await resp.json();
          // deno-lint-ignore no-explicit-any
          const text = (data?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p?.thought).map((p: any) => p?.text ?? "").join("");
          if (text.trim()) return { text, model };
          errors.push(`${model}: empty response (finish: ${data?.candidates?.[0]?.finishReason ?? "unknown"})`);
          break;
        } catch (e) {
          errors.push(`${model}: network error ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
      }
    }
  }

  if (cfg.lovableKey && deadline - Date.now() >= 3000) {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LOVABLE_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        temperature,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      return { text: data?.choices?.[0]?.message?.content ?? "[]", model: LOVABLE_MODEL };
    }
    errors.push(`gateway: ${resp.status}`);
  }

  // Report every failure (deduplicated), not just the last one, so the real cause is visible.
  throw new Error(`All AI models failed - ${[...new Set(errors)].slice(0, 6).join(" | ") || "no provider responded"}`);
}