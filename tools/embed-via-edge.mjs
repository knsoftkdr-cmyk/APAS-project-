#!/usr/bin/env node
// tools/embed-via-edge.mjs - give the feature knowledge base its vectors WITHOUT a Gemini key on this computer.
// The edge functions already hold working Gemini keys; this asks one of them (generate-item-bank, action
// "feature_kb_embed") to embed every document that has no vector yet. No new edge function is needed.
//
//   needs:  SUPABASE_URL (or VITE_SUPABASE_URL)  and  SUPABASE_SERVICE_ROLE_KEY   (the same two `features:sync` uses)
//   run:    npm run features:embed            all roles
//           npm run features:embed -- --role=teacher
// First run `npm run features:sync` (it writes the text), then this.
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first (same as for features:sync)."); process.exit(1); }
const role = process.argv.find((a) => a.startsWith("--role="))?.split("=")[1];
let total = 0, stuck = 0;
for (let round = 1; round <= 40; round++) {
  const res = await fetch(`${url.replace(/\/$/, "")}/functions/v1/generate-item-bank`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ action: "feature_kb_embed", limit: 40, ...(role ? { role } : {}) }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${out.error ?? "failed"}`);
    if (res.status === 404 || /not found/i.test(String(out.error ?? ""))) console.error("The updated generate-item-bank function is not deployed yet: run `supabase functions deploy generate-item-bank`.");
    process.exit(1);
  }
  total += out.embedded ?? 0;
  console.log(`round ${round}: embedded ${out.embedded}, failed ${out.failed}, remaining ${out.remaining}`);
  if (out.probe) { console.log("The edge function's Gemini keys were rejected:"); for (const p of out.probe) console.log(`  key ${p.key}: ${p.status}${p.message ? " - " + p.message : ""}`); process.exit(1); }
  if (!out.remaining) { console.log(`Done: ${total} vector(s) written. Meaning search is active.`); process.exit(0); }
  stuck = out.embedded ? 0 : stuck + 1;
  if (stuck >= 2) { console.log("No progress; stopping. Re-run later, or see the messages above."); process.exit(1); }
}
console.log(`Stopped after 40 rounds with vectors still missing (${total} written). Run again.`);
