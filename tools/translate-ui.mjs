#!/usr/bin/env node
// tools/translate-ui.mjs
//
// Translates the app's UI text with Google Cloud Translation and stores the result
// in src/i18n/locales/<lang>.json, which is committed and loaded by the app. Only
// messages that are not translated yet are sent, so re-running after UI changes
// costs only the new text.
//
//   npm run i18n:translate              translate new Arabic messages
//   npm run i18n:translate -- --dry-run  count what would be sent, send nothing
//   npm run i18n:check                  list messages with no translation (exit 1 if any)
//   npm run i18n:translate -- --prune    also drop translations no longer used in src/
//   --target=hi                          another language (default ar)
//
// Sign-in: you are asked for a platform-admin email and password each run (or set
// APAS_ADMIN_EMAIL / APAS_ADMIN_PASSWORD in the shell for that one command). They
// are used only to get a session for this run and are never written anywhere.
// The Google API key never leaves Supabase: requests go to the `log-audit` edge
// function (mode "ui_translate"), which holds the CLOUD_TRANSLATION_API secret.
//
// Wording precedence at runtime: <lang>.overrides.json (reviewed by people) wins
// over <lang>.json (machine). Messages that have an override are never sent.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { ROOT, collectMessages } from "./i18n/collect.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const target = (args.find((a) => a.startsWith("--target=")) ?? "--target=ar").split("=")[1];
const DRY_RUN = flag("dry-run");
const CHECK = flag("check");
const PRUNE = flag("prune");

const BATCH_STRINGS = 50;
const BATCH_CHARS = 20000;

const localesDir = path.join(ROOT, "src", "i18n", "locales");
const generatedFile = path.join(localesDir, `${target}.json`);
const overridesFile = path.join(localesDir, `${target}.overrides.json`);

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
const writeJson = (file, data) => {
  const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n");
};

function readEnv() {
  const env = {};
  for (const name of [".env.local", ".env"]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Echo nothing while the password is typed.
      rl._writeToOutput = (s) => { if (!rl.__shownPrompt) { rl.output.write(s); rl.__shownPrompt = true; } };
    }
    rl.question(question, (answer) => {
      if (hidden) process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function signIn(url, anonKey) {
  const email = process.env.APAS_ADMIN_EMAIL || (await ask("Admin email: "));
  const password = process.env.APAS_ADMIN_PASSWORD || (await ask("Password (hidden): ", { hidden: true }));
  const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Sign-in failed: ${error?.message ?? "no session returned"}`);
  return data.session.access_token;
}

function batches(list) {
  const out = [];
  let cur = [];
  let chars = 0;
  for (const s of list) {
    if (cur.length && (cur.length >= BATCH_STRINGS || chars + s.length > BATCH_CHARS)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(s);
    chars += s.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function main() {
  console.log(`Collecting UI messages from src/ ...`);
  const used = collectMessages();
  const generated = readJson(generatedFile);
  const overrides = readJson(overridesFile);
  const missing = [...used.keys()].filter((m) => !(m in generated) && !(m in overrides));
  const missingChars = missing.reduce((n, m) => n + m.length, 0);
  const stale = Object.keys(generated).filter((m) => !used.has(m));

  console.log(`  messages in use: ${used.size}`);
  console.log(`  translated (${target}.json): ${Object.keys(generated).length}   reviewed overrides: ${Object.keys(overrides).length}`);
  console.log(`  missing: ${missing.length} (${missingChars} characters)   no longer used: ${stale.length}`);

  if (CHECK) {
    for (const m of missing.slice(0, 50)) console.log(`  - ${JSON.stringify(m)}  <${used.get(m)[0]}>`);
    if (missing.length > 50) console.log(`  ... and ${missing.length - 50} more`);
    process.exit(missing.length ? 1 : 0);
  }

  if (PRUNE && stale.length) {
    for (const m of stale) delete generated[m];
    if (!DRY_RUN) writeJson(generatedFile, generated);
    console.log(`  pruned ${stale.length} unused translations${DRY_RUN ? " (dry run, not saved)" : ""}`);
  }

  if (!missing.length) return console.log("Nothing to translate.");
  if (DRY_RUN) return console.log(`Dry run: would send ${missing.length} messages in ${batches(missing).length} requests.`);

  const env = readEnv();
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY not found in .env");

  const token = await signIn(url, anonKey);
  const endpoint = `${url}/functions/v1/log-audit`;
  const work = batches(missing);
  let done = 0, kept = 0, rejected = 0, sentChars = 0;

  for (const [i, strings] of work.entries()) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: "ui_translate", strings, target }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      writeJson(generatedFile, generated);
      throw new Error(`Request ${i + 1}/${work.length} failed (HTTP ${res.status}): ${body.error ?? "no details"}. ` +
        `${kept} translations saved so far; re-run to continue.`);
    }
    body.translations.forEach((t, j) => {
      if (typeof t === "string" && t) { generated[strings[j]] = t; kept++; }
      else rejected++;
    });
    done += strings.length;
    sentChars += body.characters ?? 0;
    writeJson(generatedFile, generated); // after every batch, so an interruption loses nothing
    process.stdout.write(`\r  translated ${done}/${missing.length}`);
  }

  console.log(`\nDone. Saved ${kept} translations to ${path.relative(ROOT, generatedFile)} (${sentChars} characters sent).`);
  if (rejected) {
    console.log(`  ${rejected} came back with broken {n} placeholders and were skipped; they show in English.`);
    console.log(`  Add them to ${path.relative(ROOT, overridesFile)} by hand, or re-run to try again.`);
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
