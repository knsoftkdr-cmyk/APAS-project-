// supabase/functions/_shared/featureRetrieval.ts
//
// Retrieval-augmented lookup of app-feature documentation for an assistant.
//
//   question (+ recent turns) -> hybrid search in app_feature_docs (meaning + names/typos) -> only the few relevant
//   docs go into the prompt, plus a names-only list so the assistant knows what exists.
//
// Safe by design: every failure (table missing, embeddings down, timeout) returns `usable: false` and the caller
// falls back to the built-in guide, so the assistant never gets worse than it was. The role comes from the server
// (the verified profile), and the database enforces it again with row-level security.

export interface FeatureHit {
  feature_key: string;
  name: string;
  aliases?: string[] | null;
  route: string | null;
  kind: string;
  content: string;
  confidence: "high" | "medium" | "low";
  needs_review: boolean;
  name_score: number | null;
  text_score: number | null;
  vector_score: number | null;
  score: number;
}

export type MatchLevel = "strong" | "weak" | "none";

export interface Thresholds {
  /** database name_score needed for a candidate to be considered for a name match (verified by word coverage) */
  nameStrong: number;
  /** a name this close is certain enough to skip the embedding call entirely */
  nameExact: number;
  /** meaning similarity that counts as a confident match */
  vectorStrong: number;
  /** meaning similarity that counts as "possibly this" */
  vectorWeak: number;
  /** full-text relevance that counts as "possibly this" */
  textWeak: number;
}

/**
 * Starting points, not measured values: the vector numbers depend on the embedding model and should be tuned
 * against real student questions (override with env FEATURE_KB_VECTOR_STRONG / FEATURE_KB_VECTOR_WEAK).
 */
export const DEFAULT_THRESHOLDS: Thresholds = { nameStrong: 0.6, nameExact: 0.85, vectorStrong: 0.7, vectorWeak: 0.55, textWeak: 0.6 };

export interface RetrievalResult {
  /** Text to put in the system prompt, or null when retrieval could not be used. */
  section: string | null;
  /** false = caller should use its built-in guide instead. */
  usable: boolean;
  level: MatchLevel;
  matched: string[];
  reason?: string;
}

type Turn = { role: string; text: string };

const norm = (s: string) => (s ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const PRONOUN = /\b(it|this|that|them|these|those|there|its|one)\b/;
const FOLLOW_OPENER = /^(and|also|so|then|what about|how about|tell me more|more|steps|show me|explain|why)\b/;

/**
 * Build the text to search with. A short follow-up ("how do I use it?") has no feature name in it, so the names of
 * features mentioned in the last turns are added. Long, self-contained questions are used as they are.
 */
export function rewriteQuery(message: string, history: Turn[], knownNames: string[]): string {
  const m = norm(message);
  const words = m.split(" ").filter(Boolean);
  const followUp = words.length > 0 && words.length <= 7 && (PRONOUN.test(m) || FOLLOW_OPENER.test(m) || words.length <= 2);
  if (!followUp || !history?.length) return message;
  const recent = norm(history.slice(-3).map((h) => h?.text ?? "").join(" "));
  const mentioned = knownNames.filter((n) => {
    const nn = norm(n.replace(/\s*\(.*\)\s*$/, ""));
    return nn.length >= 3 && new RegExp(`(^| )${nn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(recent);
  });
  if (mentioned.length) return `${message} ${mentioned.slice(-2).join(" ")}`;
  const lastUser = [...history].reverse().find((h) => h.role === "user")?.text ?? "";
  return `${message} ${lastUser}`.trim();
}

const best = (hits: FeatureHit[], pick: (h: FeatureHit) => number | null) => hits.reduce((mx, h) => Math.max(mx, pick(h) ?? 0), 0);

// ───────────────────────────── is the name REALLY in the question? ─────────────────────────────
// Trigram similarity finds candidates, but it also scores "quantum study portal" close to "study path". Before a
// name match is called certain, every significant word of the name (or of one alias) must be in the question.
// Words of 5+ letters may have one slip (a wrong, missing or swapped letter), shorter words must match exactly.
function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  return dp[a.length][b.length];
}
const wordMatches = (w: string, qWords: string[]) =>
  qWords.some((q) => q === w || q === w + "s" || w === q + "s" || (w.length >= 5 && q.length >= 5 && lev(w, q) <= 1));

/** Share (0..1) of a name's significant words that appear in the question. */
export function wordCoverage(name: string, question: string): number {
  const words = norm(name.replace(/\s*\(.*\)\s*$/, "")).split(" ").filter((w) => w.length >= 2);
  if (!words.length) return 0;
  const qWords = norm(question).split(" ").filter(Boolean);
  return words.filter((w) => wordMatches(w, qWords)).length / words.length;
}

/** True when the question contains the whole name (or a whole alias) of this feature, allowing for small typos. */
export function nameIsInQuestion(h: FeatureHit, question: string): boolean {
  return [h.name, ...(h.aliases ?? [])].some((n) => wordCoverage(n, question) >= 0.999);
}

/**
 * Decide how much to trust what came back.
 *   strong  the question contains a feature's whole name/alias (verified), or its meaning clearly matches
 *   weak    a partial name match or a moderate meaning match: offer it as "maybe" and let the assistant ask
 *   none    nothing credible: the assistant must say it has no details, never guess
 */
export function classifyMatch(hits: FeatureHit[], question: string, t: Thresholds = DEFAULT_THRESHOLDS): { level: MatchLevel; chosen: FeatureHit[] } {
  const named = hits.filter((h) => (h.name_score ?? 0) >= t.nameStrong && nameIsInQuestion(h, question));
  const byMeaning = hits.filter((h) => (h.vector_score ?? 0) >= t.vectorStrong && !named.includes(h));
  if (named.length) return { level: "strong", chosen: [...named, ...byMeaning].slice(0, 3) };
  if (byMeaning.length) return { level: "strong", chosen: byMeaning.slice(0, 3) };
  const weak = hits.filter((h) => (h.name_score ?? 0) >= t.nameStrong || (h.vector_score ?? 0) >= t.vectorWeak || (h.text_score ?? 0) >= t.textWeak);
  if (weak.length) return { level: "weak", chosen: weak.slice(0, 2) };
  return { level: "none", chosen: [] };
}

const MAX_DOC_CHARS = 1800;
const clip = (s: string) => (s.length > MAX_DOC_CHARS ? s.slice(0, MAX_DOC_CHARS - 1) + "…" : s);

export function buildKnowledgePrompt(names: string[], level: MatchLevel, chosen: FeatureHit[], roleLabel = "student"): string {
  const head = `APP FEATURE GUIDE (everything a ${roleLabel} can open in APAS; this is your knowledge of the app itself).\nFeatures: ${names.join("; ")}.`;
  if (level === "strong") {
    return `${head}\n\nFULL DETAILS for what the ${roleLabel} seems to be asking about:\n${chosen.map((h) => clip(h.content)).join("\n\n")}`;
  }
  if (level === "weak") {
    return `${head}\n\nPOSSIBLY RELEVANT (closest matches only; the ${roleLabel} may mean something else. If you are not sure which one they mean, name the closest feature and ask):\n${chosen.map((h) => clip(h.content)).join("\n\n")}`;
  }
  return `${head}\n\nNo feature in this guide matched the message. Only if the ${roleLabel} is asking how the app or one of its features works: say honestly that you don't have details on it yet and suggest the Help button at the top of the page or their teacher. Do not guess or invent a feature. If they are asking about their own records or a school topic, ignore this note.`;
}

// ───────────────────────────── names cache ─────────────────────────────
const NAMES_TTL_MS = 5 * 60 * 1000;
const namesCache = new Map<string, { at: number; names: string[] }>();
export const clearFeatureNamesCache = () => namesCache.clear();

async function loadNames(supabase: any, role: string, now: number): Promise<string[]> {
  const hit = namesCache.get(role);
  if (hit && now - hit.at < NAMES_TTL_MS) return hit.names;
  const { data, error } = await supabase.from("app_feature_docs").select("name").eq("role", role).eq("status", "active");
  if (error) throw new Error(`names: ${error.message}`);
  const names = (data ?? []).map((r: { name: string }) => r.name).sort((a: string, b: string) => a.localeCompare(b));
  namesCache.set(role, { at: now, names });
  return names;
}

export interface RetrieveArgs {
  supabase: any; // the caller's own client (RLS applies); the service role also works
  role: string; // from the verified profile, never from the request body
  message: string;
  history?: Turn[];
  /** returns the query embedding or null; must never throw */
  embed?: (text: string) => Promise<number[] | null>;
  thresholds?: Thresholds;
  limit?: number;
  now?: number;
  roleLabel?: string;
}

/**
 * Find the documentation relevant to this message. Never throws.
 * Cheap path first: a text-only search runs while the embedding is requested in parallel; if the question contains
 * a feature's exact name the embedding result is not needed.
 */
export async function retrieveFeatureKnowledge(a: RetrieveArgs): Promise<RetrievalResult> {
  const t = a.thresholds ?? DEFAULT_THRESHOLDS;
  const fail = (reason: string): RetrievalResult => ({ section: null, usable: false, level: "none", matched: [], reason });
  try {
    const names = await loadNames(a.supabase, a.role, a.now ?? Date.now());
    if (names.length === 0) return fail("knowledge base is empty for this role");

    const query = rewriteQuery(a.message, a.history ?? [], names);
    const embedding = a.embed ? a.embed(query).catch(() => null) : Promise.resolve(null);
    const search = async (vec: number[] | null): Promise<FeatureHit[]> => {
      const { data, error } = await a.supabase.rpc("match_feature_docs", {
        p_role: a.role,
        p_query: query,
        p_embedding: vec ? `[${vec.join(",")}]` : null,
        p_limit: a.limit ?? 4,
      });
      if (error) throw new Error(`search: ${error.message}`);
      return (data ?? []) as FeatureHit[];
    };

    let hits = await search(null);
    if (best(hits, (h) => h.name_score) < t.nameExact) {
      const vec = await embedding;
      if (vec) hits = await search(vec);
    }
    const { level, chosen } = classifyMatch(hits, query, t);
    return {
      section: buildKnowledgePrompt(names, level, chosen, a.roleLabel),
      usable: true,
      level,
      matched: chosen.map((h) => h.name),
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "unknown error");
  }
}
