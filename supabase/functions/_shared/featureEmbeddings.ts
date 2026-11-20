// supabase/functions/_shared/featureEmbeddings.ts
//
// Gemini embeddings for the feature knowledge base. Used by the edge function (to embed the student's question)
// and by tools/sync-feature-kb.mjs (to embed the feature documents) - the same code, so both sides live in the same
// vector space. No I/O except `fetch`, which can be injected for tests.
//
// This does NOT train or change any model. An embedding is a list of numbers describing the meaning of a text; the
// knowledge base is searched by comparing those lists. Adding a feature = embedding one more document.

export const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIMS = 768; // must equal extensions.vector(768) in the migration
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

export type EmbedTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface EmbedOptions {
  model?: string;
  dims?: number;
  taskType: EmbedTask;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Unit-length vector. Required for cosine search when the model is asked for fewer than its full dimensions. */
export function normalizeVector(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? v.map((x) => x / norm) : v;
}

/** pgvector text form, accepted by PostgREST / supabase-js for a vector parameter or column. */
export const toPgVector = (v: number[]): string => `[${v.join(",")}]`;

export function buildEmbedBody(text: string, taskType: EmbedTask, model: string, dims: number) {
  return {
    model: `models/${model}`,
    content: { parts: [{ text: text.slice(0, 8000) }] },
    taskType,
    outputDimensionality: dims,
  };
}

/** Statuses where ANOTHER key may well work: invalid/blocked key (400, 401, 403), rate limit (429), server error (5xx). */
const isKeyProblem = (status: number): boolean => status === 400 || status === 401 || status === 403 || status === 429 || status >= 500;

async function post(url: string, body: unknown, key: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key }, // header, not ?key=, so the key is never in a URL or a log
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Embed one text. Tries each API key in turn (the project rotates several keys). Returns null on ANY failure so the
 * caller can fall back to text-only search - an embedding problem must never break the assistant.
 */
export async function embedText(text: string, keys: string[], o: EmbedOptions): Promise<number[] | null> {
  const model = o.model ?? EMBED_MODEL;
  const dims = o.dims ?? EMBED_DIMS;
  const f = o.fetchImpl ?? fetch;
  if (!text.trim() || keys.length === 0) return null;
  for (const key of keys) {
    try {
      const res = await post(`${ENDPOINT}/models/${model}:embedContent`, buildEmbedBody(text, o.taskType, model, dims), key, o.timeoutMs ?? 2500, f);
      if (isKeyProblem(res.status)) continue; // bad/blocked/rate-limited key or the service hiccuped: try the next key
      if (!res.ok) return null;
      const json = await res.json();
      const values: number[] | undefined = json?.embedding?.values;
      if (!Array.isArray(values) || values.length !== dims) return null;
      return normalizeVector(values);
    } catch {
      /* timeout or network error: try the next key */
    }
  }
  return null;
}

/** Embed many texts (the sync script). Result has one entry per input, null where it failed. */
export async function embedBatch(texts: string[], keys: string[], o: EmbedOptions & { batchSize?: number }): Promise<(number[] | null)[]> {
  const model = o.model ?? EMBED_MODEL;
  const dims = o.dims ?? EMBED_DIMS;
  const f = o.fetchImpl ?? fetch;
  const size = Math.max(1, Math.min(o.batchSize ?? 50, 100));
  const out: (number[] | null)[] = new Array(texts.length).fill(null);
  for (let start = 0; start < texts.length; start += size) {
    const slice = texts.slice(start, start + size);
    const body = { requests: slice.map((t) => buildEmbedBody(t, o.taskType, model, dims)) };
    for (const key of keys) {
      try {
        const res = await post(`${ENDPOINT}/models/${model}:batchEmbedContents`, body, key, o.timeoutMs ?? 30000, f);
        if (isKeyProblem(res.status)) continue; // try the next key
        if (!res.ok) break;
        const json = await res.json();
        const embeddings: { values?: number[] }[] = json?.embeddings ?? [];
        slice.forEach((_, i) => {
          const v = embeddings[i]?.values;
          if (Array.isArray(v) && v.length === dims) out[start + i] = normalizeVector(v);
        });
        break;
      } catch {
        /* try the next key */
      }
    }
  }
  return out;
}