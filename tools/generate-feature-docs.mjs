#!/usr/bin/env node
// tools/generate-feature-docs.mjs
//
// Builds the assistants' feature knowledge base from the real application code and writes:
//   docs/feature-kb/<role>.features.json   machine-readable, consumed by `npm run features:sync`
//   docs/feature-kb/<role>.features.md     human-readable, reviewed in pull requests
//
//   npm run features:generate                   rebuild and print what was added / modified / renamed / removed
//   npm run features:check                      exit 1 if the committed files are out of date (CI)
//   npm run features:check -- --strict          also exit 1 if any feature still needs developer review
//   npm run features:accept -- <key> | --all    mark a written doc as re-checked after a screen change
//
// Run `npm run features:generate` after tools/generate-feature-manifest.mjs (the package.json script does both).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_CONFIGS } from "./feature-docs/config.mjs";
import { buildRoleDocs, diffDocs, applyMoves, renderMarkdown, summariseReport } from "./feature-docs/build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const strict = args.includes("--strict");
const acceptAll = args.includes("--all");
const acceptKeys = new Set(args.filter((a) => !a.startsWith("--")));
const accepting = acceptAll || acceptKeys.size > 0;

let failed = false;
for (const cfg of Object.values(ROLE_CONFIGS)) {
  const jsonPath = path.join(root, `${cfg.out}.features.json`);
  const mdPath = path.join(root, `${cfg.out}.features.md`);
  const previous = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : null;

  const next = await buildRoleDocs({ root, cfg, previous, accept: acceptAll ? "all" : acceptKeys });
  const report = diffDocs(previous, next);
  applyMoves(previous ?? { docs: [] }, next, report);
  const json = JSON.stringify(next, null, 2) + "\n";
  const md = renderMarkdown(next, report) + "\n";

  if (check) {
    const stale = !previous || fs.readFileSync(jsonPath, "utf8") !== json || !fs.existsSync(mdPath) || fs.readFileSync(mdPath, "utf8") !== md;
    if (stale) {
      console.error(`[${cfg.role}] feature docs are out of date. Run: npm run features:generate`);
      const s = summariseReport(report);
      if (s) console.error(s);
      failed = true;
    } else console.log(`[${cfg.role}] feature docs are up to date (${next.docs.length} features).`);
    if (strict && report.needsReview.length) {
      console.error(`[${cfg.role}] ${report.needsReview.length} feature(s) need developer review:\n` + summariseReport({ ...report, added: [], modified: [], renamed: [], removed: [] }));
      failed = true;
    }
    continue;
  }

  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, json);
  fs.writeFileSync(mdPath, md);
  console.log(`[${cfg.role}] wrote ${path.relative(root, jsonPath)} and ${path.relative(root, mdPath)} (${next.docs.length} features).`);
  if (previous && !accepting) {
    const s = summariseReport(report);
    console.log(s || "No changes since the last generation.");
  } else if (!previous) console.log("Initial generation.");
  if (accepting) console.log("Marked as reviewed.");
  const low = next.docs.filter((d) => d.needsReview).length;
  if (low) console.log(`${low} feature(s) are flagged for developer review - see the top of ${path.relative(root, mdPath)}.`);
}
process.exit(failed ? 1 : 0);
