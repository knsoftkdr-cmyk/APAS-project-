// tools/i18n/rtlCodemod.mjs
//
// One-time migration of Tailwind classes from physical directions (left/right)
// to logical ones (start/end), so the layout mirrors when <html dir="rtl"> is
// set for Arabic and stays exactly as before for left-to-right languages.
//
//   node tools/i18n/rtlCodemod.mjs           report what would change
//   node tools/i18n/rtlCodemod.mjs --write   apply it
//
// ml-4 -> ms-4    pr-2 -> pe-2      left-0 -> start-0     text-right -> text-end
// rounded-l-lg -> rounded-s-lg      border-r -> border-e  rounded-tl -> rounded-ss
// space-x-4      -> space-x-4 rtl:space-x-reverse        (same for divide-x)
// -translate-x-full -> -translate-x-full rtl:translate-x-full   (slide-ins)
//
// Left alone on purpose:
//   - centring: left-1/2, left-[50%] and any string that also holds a
//     translate-x-1/2 / translate-x-[-50%] - mirroring those would de-centre them
//   - tokens whose value is not a Tailwind value, so ids like "left-panel" survive
//   - slide-in-from-left style animation names, background positions, inline styles
// Only string literals are touched (className, cn(), cva(), class tables), never comments.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const WRITE = process.argv.includes("--write");
const EXCLUDED = ["/src/integrations/", "/src/RFID Module/", "/src/test/"];

const SPACING = String.raw`(?:\d+(?:\.\d+)?|px|auto|\[[^\]\s]+\])`;
const INSET = String.raw`(?:\d+(?:\.\d+)?|px|auto|full|\d\/\d|\[[^\]\s]+\])`;
const RADIUS = String.raw`(?:none|sm|md|lg|xl|2xl|3xl|full|\[[^\]\s]+\])`;
const BORDER = String.raw`(?:\d+|\[[^\]\s]+\]|transparent|current|inherit|white|black|[a-z]+(?:-\d{2,3})?(?:\/\d+)?)`;
const VARIANTS = String.raw`((?:[^\s:]+:)*)`;

const CENTRING_STRING = /(^|[\s:])-?translate-x-(1\/2|\[-?50%\])(?=$|\s)/;
const CENTRING_VALUE = /^(1\/2|\[50%\])$/;

/** Rewrites one class token; returns the replacement (possibly several tokens) or null. */
function mapToken(token, centring) {
  let m;
  if ((m = token.match(new RegExp(`^${VARIANTS}(!?)(-?)m([lr])-(${SPACING})$`)))) {
    return `${m[1]}${m[2]}${m[3]}m${m[4] === "l" ? "s" : "e"}-${m[5]}`;
  }
  if ((m = token.match(new RegExp(`^${VARIANTS}(!?)p([lr])-(${SPACING})$`)))) {
    return `${m[1]}${m[2]}p${m[3] === "l" ? "s" : "e"}-${m[4]}`;
  }
  if ((m = token.match(new RegExp(`^${VARIANTS}(!?)(-?)(left|right)-(${INSET})$`)))) {
    if (centring || CENTRING_VALUE.test(m[5])) return null;
    return `${m[1]}${m[2]}${m[3]}${m[4] === "left" ? "start" : "end"}-${m[5]}`;
  }
  if ((m = token.match(new RegExp(`^${VARIANTS}(!?)text-(left|right)$`)))) {
    return `${m[1]}${m[2]}text-${m[3] === "left" ? "start" : "end"}`;
  }
  if ((m = token.match(new RegExp(`^${VARIANTS}(!?)rounded-(l|r|tl|tr|bl|br)(?:-(${RADIUS}))?$`)))) {
    const map = { l: "s", r: "e", tl: "ss", tr: "se", bl: "es", br: "ee" };
    return `${m[1]}${m[2]}rounded-${map[m[3]]}${m[4] ? `-${m[4]}` : ""}`;
  }
  if ((m = token.match(new RegExp(`^${VARIANTS}(!?)border-(l|r)(?:-(${BORDER}))?$`)))) {
    return `${m[1]}${m[2]}border-${m[3] === "l" ? "s" : "e"}${m[4] ? `-${m[4]}` : ""}`;
  }
  return null;
}

const TRANSLATE_X = new RegExp(`^${VARIANTS}(-?)translate-x-(${INSET}|0)$`);

/** Tokens that stay, plus an rtl: counterpart appended once per string. */
function companion(token) {
  if (new RegExp(`^${VARIANTS}space-x-(?!reverse)`).test(token)) return "rtl:space-x-reverse";
  if (new RegExp(`^${VARIANTS}divide-x(?:-\\d+)?$`).test(token)) return "rtl:divide-x-reverse";
  return null;
}

/**
 * Mirrored slides: `-translate-x-full md:translate-x-0` gets
 * `rtl:translate-x-full rtl:md:translate-x-0`. Every translate-x in the string
 * gets a counterpart - including the zero ones - because an rtl: class beats its
 * plain responsive sibling on specificity, so a lone `rtl:translate-x-full` would
 * also win on desktop and keep a drawer hidden there.
 */
function translateCompanions(tokens, centring) {
  if (centring) return [];
  const found = tokens.map((t) => t.match(TRANSLATE_X)).filter(Boolean)
    // var() values are driven at runtime (e.g. a toast following the finger on swipe).
    .filter((m) => !m[1].includes("rtl:") && !CENTRING_VALUE.test(m[3]) && !m[3].includes("var("));
  if (!found.some((m) => m[3] !== "0")) return [];
  return found.map((m) => (m[3] === "0" ? `rtl:${m[1]}translate-x-0` : `rtl:${m[1]}${m[2] ? "" : "-"}translate-x-${m[3]}`));
}

function rewriteClassText(text) {
  if (!/\b(m[lr]|p[lr]|left|right|text-|rounded-|border-[lr]|space-x|divide-x|translate-x)/.test(text)) return { text, n: 0 };
  const centring = CENTRING_STRING.test(text);
  let n = 0;
  const extra = [];
  const addExtra = (add) => { if (add && !text.split(/\s+/).includes(add) && !extra.includes(add)) extra.push(add); };
  const out = text.replace(/[^\s]+/g, (tok) => {
    const mapped = mapToken(tok, centring);
    addExtra(companion(tok));
    if (mapped) { n++; return mapped; }
    return tok;
  });
  translateCompanions(text.split(/\s+/), centring).forEach(addExtra);
  n += extra.length;
  if (!extra.length) return { text: out, n };
  // Keep the closing whitespace of a template chunk where it was.
  const trail = out.match(/\s*$/)[0];
  return { text: `${out.slice(0, out.length - trail.length)} ${extra.join(" ")}${trail}`, n };
}

function rewriteFile(file) {
  const code = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
  const edits = [];
  let count = 0;
  const visit = (node) => {
    let pieces = [];
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // inner text range, excluding the quotes
      pieces = [[node.getStart(sf) + 1, node.end - 1]];
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const start = node.getStart(sf) + 1;                       // after ` or }
      const end = node.end - (ts.isTemplateTail(node) ? 1 : 2);  // before ` or ${
      pieces = [[start, end]];
    }
    for (const [start, end] of pieces) {
      const { text, n } = rewriteClassText(code.slice(start, end));
      if (n) { edits.push({ start, end, text }); count += n; }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) return 0;
  let out = code;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (WRITE) fs.writeFileSync(file, out);
  return count;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const posix = p.split(path.sep).join("/");
    if (e.isDirectory()) { if (!EXCLUDED.some((x) => `${posix}/`.includes(x))) walk(p, out); }
    else if (/\.(tsx|ts)$/.test(e.name) && !/\.d\.ts$|\.(test|spec)\./.test(e.name)) out.push(p);
  }
  return out;
}

let files = 0, changes = 0;
for (const file of walk(path.join(ROOT, "src"))) {
  const n = rewriteFile(file);
  if (n) { files++; changes += n; }
}
console.log(`${WRITE ? "Changed" : "Would change"} ${changes} classes in ${files} files.${WRITE ? "" : " Run with --write to apply."}`);
