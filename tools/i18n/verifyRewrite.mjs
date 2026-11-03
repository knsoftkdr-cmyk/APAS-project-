// tools/i18n/verifyRewrite.mjs
//
// Safety check for the i18n rewrite: runs it over every translatable file and
// fails if the output has a syntax error the original did not, or if lines moved
// (which would make stack traces point at the wrong source line).
// Run: node tools/i18n/verifyRewrite.mjs
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isTranslatableFile, processSource } from "./uiStrings.mjs";

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (isTranslatableFile(p)) out.push(p);
  }
  return out;
}

const parseErrors = (code, file) => {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind).parseDiagnostics.length;
};
const lineCount = (text) => text.split("\n").length;

const files = walk(path.resolve("src"));
let rewritten = 0, broken = 0, moved = 0, messages = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const { code, messages: found } = processSource(src, file, { rewrite: true });
  messages += found.length;
  if (!code) continue;
  rewritten++;
  const rel = path.relative(process.cwd(), file);
  if (parseErrors(code, file) > parseErrors(src, file)) {
    broken++;
    console.log("BROKEN:", rel);
  }
  // The rewrite appends exactly two lines (a blank line and the runtime import).
  if (lineCount(code) !== lineCount(src) + 2) {
    moved++;
    console.log("LINES MOVED:", rel, lineCount(src), "->", lineCount(code) - 2);
  }
}
console.log(`files scanned: ${files.length}  rewritten: ${rewritten}  message occurrences: ${messages}  broken: ${broken}  lines moved: ${moved}`);
process.exit(broken || moved ? 1 : 0);
