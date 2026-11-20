// tools/feature-docs/loadTs.mjs
// Load a TypeScript module from Node without a separate build step (esbuild bundles it, in a child process).
// Used to read the hand-written guide (supabase/functions/_shared/*.ts), the page-help registry (src/components/help)
// and the shared embedding helper, so the generator uses the SAME code the app and the edge functions use.
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bundler = path.join(path.dirname(fileURLToPath(import.meta.url)), "bundle.mjs");
const cache = new Map();

export async function loadTs(entry, root) {
  const id = path.resolve(root, entry);
  const code = execFileSync(process.execPath, [bundler, entry, root], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  // a unique specifier per content so an edited file is re-read (matters in tests that rewrite fixtures)
  const key = id + ":" + code.length + ":" + Buffer.from(code).toString("base64").slice(-24);
  if (!cache.has(key)) cache.set(key, import("data:text/javascript;base64," + Buffer.from(code).toString("base64")));
  return cache.get(key);
}
