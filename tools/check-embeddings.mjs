#!/usr/bin/env node
// tools/check-embeddings.mjs - why does `npm run features:sync` say "embedding failed"?
// The sync (by design) never stops on an embedding error, so it hides the reason. This sends ONE tiny embedding request
// per Gemini key and prints the HTTP status and Google's own error message. Keys are never printed.
//   npm run features:check-embeddings
const NAMES = ["GEMINI_API_KEY", "Worksheet_gemini_api_key", "GOOGLE_GEMINI_API_KEY_2", "GEMINI_KEY_2", "GEMINI_KEY_3", "GEMINI_KEY_4"];
const model = process.env.FEATURE_KB_EMBED_MODEL || "gemini-embedding-001";
const found = NAMES.filter((n) => process.env[n] && process.env[n].trim());
console.log(`Model: ${model}. Keys found in this terminal: ${found.length ? found.join(", ") : "none"}`);
if (!found.length) { console.log("No Gemini key is set in this PowerShell window. Set one, e.g.  $env:GEMINI_API_KEY=\"...\"  then run again."); process.exit(1); }
let ok = 0;
for (const n of found) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env[n].trim() },
      body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: "test" }] }, taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 768 }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { const len = body?.embedding?.values?.length; console.log(`  ${n}: OK (${len} numbers${len === 768 ? "" : " - EXPECTED 768"})`); if (len === 768) ok++; }
    else console.log(`  ${n}: HTTP ${res.status} - ${String(body?.error?.message ?? "").slice(0, 200)}`);
  } catch (e) { console.log(`  ${n}: network error - ${e instanceof Error ? e.message : e}`); }
}
console.log(ok ? "\nAt least one key works. Run `npm run features:sync` again; only the missing vectors are retried." : "\nNo key could embed. Fix the key or model named above, then run `npm run features:sync` again.");
process.exit(ok ? 0 : 1);
