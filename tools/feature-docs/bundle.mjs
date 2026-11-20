// tools/feature-docs/bundle.mjs  -  `node bundle.mjs <entry.ts> <projectRoot>` prints the bundled ESM to stdout.
// Run as a child process by loadTs.mjs so esbuild never runs inside a test runner's (jsdom) environment.
import path from "node:path";
import { build } from "esbuild";

const [entry, root] = process.argv.slice(2);
const r = await build({
  entryPoints: [path.resolve(root, entry)],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  alias: { "@": path.join(root, "src") },
});
process.stdout.write(r.outputFiles[0].text);
