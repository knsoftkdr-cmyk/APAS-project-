// supabase/functions/embed-feature-docs/index.ts
//
// One-off / repair helper: adds the missing vectors to app_feature_docs using the Gemini keys stored as Supabase
// secrets (the same ones Study Buddy uses), so no key has to be copied to a computer.
// Call it with the SERVICE ROLE key as the bearer token. Any other caller gets 401.
// Safe to call repeatedly: it only touches active rows whose embedding is NULL.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { embedBatch, toPgVector, EMBED_MODEL } from "../_shared/featureEmbeddings.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function getGeminiKeys(): string[] {
  return [
    Deno.env.get("Worksheet_gemini_api_key"),
    Deno.env.get("GOOGLE_GEMINI_API_KEY_2"),
    Deno.env.get("GEMINI_KEY_2"),
    Deno.env.get("GEMINI_KEY_3"),
    Deno.env.get("GEMINI_KEY_4"),
    Deno.env.get("GEMINI_API_KEY"),
  ].filter((k): k is string => !!k && k.trim().length > 0).map((k) => k.trim());
}

serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || req.headers.get("Authorization") !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const keys = getGeminiKeys();
  if (keys.length === 0) return json({ error: "no Gemini key secrets found" }, 500);

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, { auth: { persistSession: false } });
  const model = Deno.env.get("FEATURE_KB_EMBED_MODEL") || EMBED_MODEL;

  const { data, error } = await supabase
    .from("app_feature_docs")
    .select("id, search_text")
    .eq("status", "active")
    .is("embedding", null)
    .limit(200);
  if (error) return json({ error: error.message }, 500);
  const rows = data ?? [];
  if (rows.length === 0) return json({ pending: 0, embedded: 0, message: "nothing to embed" });

  const vectors = await embedBatch(rows.map((r) => r.search_text), keys, { taskType: "RETRIEVAL_DOCUMENT", model });
  let embedded = 0;
  for (let i = 0; i < rows.length; i++) {
    const v = vectors[i];
    if (!v) continue;
    const { error: e } = await supabase
      .from("app_feature_docs")
      .update({ embedding: toPgVector(v), embedding_model: model, updated_at: new Date().toISOString() })
      .eq("id", rows[i].id);
    if (e) return json({ error: e.message, embedded }, 500);
    embedded++;
  }
  return json({ pending: rows.length, embedded, failed: rows.length - embedded, keysTried: keys.length });
});