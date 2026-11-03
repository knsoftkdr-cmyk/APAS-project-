// tools/i18n/collect.mjs
//
// Collects every UI message in src/ - exactly the set the Vite plugin looks up,
// because both use uiStrings.mjs. Used by translate-ui.mjs; run directly to print
// a summary: node tools/i18n/collect.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isTranslatableFile, processSource } from "./uiStrings.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (isTranslatableFile(p)) out.push(p);
  }
  return out;
}

/** @returns {Map<string, string[]>} message -> files that use it (repo-relative) */
export function collectMessages() {
  const found = new Map();
  for (const file of walk(path.join(ROOT, "src"))) {
    const { messages } = processSource(fs.readFileSync(file, "utf8"), file);
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    for (const m of messages) {
      if (!found.has(m)) found.set(m, []);
      if (!found.get(m).includes(rel)) found.get(m).push(rel);
    }
  }
  return found;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = collectMessages();
  let chars = 0;
  for (const m of found.keys()) chars += m.length;
  console.log(`unique messages: ${found.size}  characters: ${chars}`);
}
