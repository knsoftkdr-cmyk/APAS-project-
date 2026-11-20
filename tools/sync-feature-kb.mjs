#!/usr/bin/env node
// tools/sync-feature-kb.mjs
//
// Loads the generated feature docs into the database knowledge base (public.app_feature_docs) and embeds them with
// Gemini. Run after `npm run features:generate`, from a developer machine or CI as part of every deploy:
//
//   npm run features:sync                 new / changed docs are embedded and upserted, removed features are retired
//   npm run features:sync -- --dry-run    show what would change, write nothing
//   npm run features:sync -- --no-embed   write the text only (search by name still works; add vectors later)
//
// Environment (never commit these):
//   SUPABASE_URL (or VITE_SUPABASE_URL)   SUPABASE_SERVICE_ROLE_KEY   a Gemini key: GEMINI_API_KEY (or the same
//   key names the edge functions use: Worksheet_gemini_api_key, GOOGLE_GEMINI_API_KEY_2, GEMINI_KEY_2..4)
// Optional: FEATURE_KB_EMBED_MODEL (default gemini-embedding-001)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { ROLE_CONFIGS } from "./feature-docs/config.mjs";
import { loadTs } from "./feature-docs/loadTs.mjs";
import { runSync } from "./feature-docs/sync.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noEmbed = args.includes("--no-embed");
const only = args.find((a) => a.startsWith("--role="))?.split("=")[1];

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const geminiKeys = ["GEMINI_API_KEY", "Worksheet_gemini_api_key", "GOOGLE_GEMINI_API_KEY_2", "GEMINI_KEY_2", "GEMINI_KEY_3", "GEMINI_KEY_4"].map((k) => process.env[k]).filter((k) => k && k.trim());

const missing = [!url && "SUPABASE_URL", !serviceKey && "SUPABASE_SERVICE_ROLE_KEY", !noEmbed && !dryRun && geminiKeys.length === 0 && "a Gemini API key (GEMINI_API_KEY)"].filter(Boolean);
if (missing.length && !(dryRun && url && serviceKey)) {
  console.error("Missing environment: " + missing.join(", "));
  process.exit(2);
}

const emb = await loadTs("supabase/functions/_shared/featureEmbeddings.ts", root);
const model = process.env.FEATURE_KB_EMBED_MODEL || emb.EMBED_MODEL;
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
console.log(`Syncing feature knowledge base to ${new URL(url).host}${dryRun ? " (dry run)" : ""}, embedding model ${model}`);

let failed = false;
for (const cfg of Object.values(ROLE_CONFIGS)) {
  if (only && only !== cfg.role) continue;
  const file = path.join(root, `${cfg.out}.features.json`);
  if (!fs.existsSync(file)) {
    console.error(`[${cfg.role}] ${path.relative(root, file)} not found. Run: npm run features:generate`);
    failed = true;
    continue;
  }
  const { docs } = JSON.parse(fs.readFileSync(file, "utf8"));
  try {
    const s = await runSync({
      supabase, role: cfg.role, docs, model, dryRun, embed: !noEmbed,
      toPgVector: emb.toPgVector,
      embedBatch: (texts) => emb.embedBatch(texts, geminiKeys, { taskType: "RETRIEVAL_DOCUMENT", model }),
      log: (l) => console.log(l),
    });
    console.log(`[${cfg.role}] ${dryRun ? "would write" : "wrote"} ${dryRun ? s.plan.upsert.length : s.upserted} (embedded ${s.embedded}, text-only ${s.embeddingPending}), retire ${dryRun ? s.plan.retire.length : s.retired}, unchanged ${s.unchanged}.`);
    if (s.embeddingPending && !noEmbed && !dryRun) console.warn(`[${cfg.role}] ${s.embeddingPending} doc(s) have no vector (embedding failed). They are still found by name; run the sync again to retry.`);
  } catch (e) {
    console.error(`[${cfg.role}] ${e.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
