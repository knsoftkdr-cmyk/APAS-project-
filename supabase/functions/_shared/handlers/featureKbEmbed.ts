// supabase/functions/_shared/handlers/featureKbEmbed.ts
//
// Served through generate-item-bank with { action: "feature_kb_embed" } (see _shared/mergedRouter.ts), so it needs NO
// new edge function. It gives the feature knowledge base its meaning-search vectors using the Gemini keys the edge
// functions already have, for when `npm run features:sync` cannot embed from your own computer (it then stores the text
// without vectors; name search still works, meaning search does not).
//
//   Body: { role?: "student"|"teacher"|..., limit?: number (default 40, max 60) }   repeat while `remaining` > 0
//   Auth: the project's service-role key (what tools/embed-via-edge.mjs sends) OR a signed-in platform admin
//         (profiles.role admin / knsoft_admin). Nobody else; it writes to app_feature_docs.
//   Only rows with NO vector are touched. It never changes a document's text.
//   Answer: { embedded, failed, remaining, keys, probe? }  - `probe` explains a failure (HTTP status per key, no key shown).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { embedBatch, toPgVector, EMBED_MODEL } from "../featureEmbeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ADMIN_ROLES = ["admin", "knsoft_admin"];
const KEY_NAMES = ["GEMINI_API_KEY", "Worksheet_gemini_api_key", "GOOGLE_GEMINI_API_KEY_2", "GEMINI_KEY_2", "GEMINI_KEY_3", "GEMINI_KEY_4"];

/** Same list the assistants use, de-duplicated. */
function geminiKeys(): string[] {
  const out: string[] = [];
  for (const n of KEY_NAMES) {
    const v = (Deno.env.get(n) ?? "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** One tiny request per key so a failure says why (status + Google's message). Never returns a key. */
async function probe(keys: string[], model: string): Promise<{ key: number; status: number | string; message?: string }[]> {
  const results: { key: number; status: number | string; message?: string }[] = [];
  for (let i = 0; i < keys.length; i++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": keys[i] },
        body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: "test" }] }, taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 768 }),
      });
      const b = await res.json().catch(() => ({}));
      results.push({ key: i + 1, status: res.status, message: res.ok ? undefined : String(b?.error?.message ?? "").slice(0, 160) });
    } catch (e) {
      results.push({ key: i + 1, status: "network", message: e instanceof Error ? e.message.slice(0, 120) : "error" });
    }
  }
  return results;
}

export async function handleFeatureKbEmbed(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey);

    const isService = authHeader === `Bearer ${serviceKey}`;
    if (!isService) {
      const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error } = await asCaller.auth.getUser();
      if (error || !user) return json({ error: "Not authenticated" }, 401);
      const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
      if (!profile || !ADMIN_ROLES.includes(profile.role)) return json({ error: "Not permitted" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(60, Math.max(1, Math.round(Number(body.limit ?? 40)) || 40));
    const model = Deno.env.get("FEATURE_KB_EMBED_MODEL") || EMBED_MODEL;
    const keys = geminiKeys();
    if (!keys.length) return json({ error: "No Gemini key is set for the edge functions", keys: 0 }, 500);

    let q = admin.from("app_feature_docs").select("role, feature_key, search_text").eq("status", "active").is("embedding", null).order("role").order("feature_key").limit(limit);
    if (typeof body.role === "string" && body.role) q = q.eq("role", body.role);
    const { data: rows, error: selErr } = await q;
    if (selErr) return json({ error: `read failed: ${selErr.message}` }, 500);

    let embedded = 0;
    let failed = 0;
    if (rows?.length) {
      const vectors = await embedBatch(rows.map((r) => r.search_text as string), keys, { taskType: "RETRIEVAL_DOCUMENT", model, timeoutMs: 30000 });
      for (let i = 0; i < rows.length; i++) {
        const v = vectors[i];
        if (!v) { failed++; continue; }
        const { error } = await admin.from("app_feature_docs")
          .update({ embedding: toPgVector(v), embedding_model: model, updated_at: new Date().toISOString() })
          .eq("role", rows[i].role).eq("feature_key", rows[i].feature_key).is("embedding", null);
        if (error) failed++; else embedded++;
      }
    }

    let cq = admin.from("app_feature_docs").select("feature_key", { count: "exact", head: true }).eq("status", "active").is("embedding", null);
    if (typeof body.role === "string" && body.role) cq = cq.eq("role", body.role);
    const { count } = await cq;
    return json({ embedded, failed, remaining: count ?? null, keys: keys.length, model, ...(embedded === 0 && (rows?.length ?? 0) > 0 ? { probe: await probe(keys, model) } : {}) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
}
