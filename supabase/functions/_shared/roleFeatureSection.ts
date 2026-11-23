// supabase/functions/_shared/roleFeatureSection.ts
//
// The "how does the app work" prompt section for ONE role's assistant. Role-generic twin of getFeatureSection() in
// student-self-assistant (which is unchanged). Same behaviour:
//   1. retrieve only the relevant docs from app_feature_docs (meaning + name/typo search), read with the CALLER'S
//      session so row-level security returns only this role's docs;
//   2. otherwise (empty / unreachable / slow / nothing found but the built-in guide knows it) use the built-in guide.
// Never throws, never blocks the answer for more than ~4.5 s. Start it early and await it later so it overlaps the
// assistant's data queries.
import { retrieveFeatureKnowledge, DEFAULT_THRESHOLDS } from "./featureRetrieval.ts";
import { embedText } from "./featureEmbeddings.ts";
import { ROLE_PROFILES } from "./roleFeatureGuide.ts";

export interface RoleFeatureSectionArgs {
  /** log label, e.g. "hod-assistant" */
  tag: string;
  /** the caller's own client (anon key + their JWT) */
  supabase: any;
  /** the server-verified profiles.role: never from the request body */
  role: keyof typeof ROLE_PROFILES;
  message: string;
  history: { role: string; text: string }[];
  keys: string[];
  /** built-in fallback guide prompt */
  builtIn: () => string;
  /** does the built-in guide have an entry for this message? */
  builtInKnows: () => boolean;
  timeoutMs?: number;
  /** injectable for tests */
  retrieve?: typeof retrieveFeatureKnowledge;
}

export async function getRoleFeatureSection(a: RoleFeatureSectionArgs): Promise<string> {
  const num = (name: string, dflt: number) => {
    const v = parseFloat(Deno.env.get(name) ?? "");
    return Number.isFinite(v) ? v : dflt;
  };
  const profile = ROLE_PROFILES[a.role];
  const embedModel = Deno.env.get("FEATURE_KB_EMBED_MODEL") || undefined;
  const retrieve = a.retrieve ?? retrieveFeatureKnowledge;
  try {
    const kb = await Promise.race([
      retrieve({
        supabase: a.supabase,
        role: profile.role,
        message: a.message,
        history: a.history,
        roleLabel: profile.label,
        escalateTo: profile.escalateTo,
        embed: (text) => embedText(text, a.keys, { taskType: "RETRIEVAL_QUERY", model: embedModel, timeoutMs: 2500 }),
        thresholds: {
          ...DEFAULT_THRESHOLDS,
          vectorStrong: num("FEATURE_KB_VECTOR_STRONG", DEFAULT_THRESHOLDS.vectorStrong),
          vectorWeak: num("FEATURE_KB_VECTOR_WEAK", DEFAULT_THRESHOLDS.vectorWeak),
        },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), a.timeoutMs ?? 4500)),
    ]);
    if (kb && kb.usable && kb.section && !(kb.level === "none" && a.builtInKnows())) {
      console.log(`[${a.tag}] feature-kb`, JSON.stringify({ source: "kb", level: kb.level, matched: kb.matched }));
      return kb.section;
    }
    console.log(`[${a.tag}] feature-kb`, JSON.stringify({ source: "built-in", reason: kb ? kb.reason ?? `level ${kb.level}` : "timeout" }));
  } catch (e) {
    console.log(`[${a.tag}] feature-kb`, JSON.stringify({ source: "built-in", reason: (e instanceof Error ? e.message : "error").slice(0, 120) }));
  }
  return a.builtIn();
}
