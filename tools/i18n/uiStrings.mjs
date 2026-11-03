// tools/i18n/uiStrings.mjs
//
// Finds the user-facing English text in a source file, and (optionally) rewrites
// each occurrence into a lookup: `"Save"` -> `__apasT("Save")`.
//
// Used in two places, so the strings we translate and the strings the app looks up
// are produced by the same code and can never drift apart:
//   - tools/i18n/vitePlugin.mjs   rewrites files at build/dev time (source files on
//                                  disk are never modified)
//   - tools/translate-ui.mjs       collects the messages to send for translation
//
// What counts as user-facing text:
//   - JSX text children, e.g. <h1>Upcoming Events</h1>. A text that mixes in
//     expressions, e.g. <p>Submitted {date}</p>, becomes ONE message
//     "Submitted {0}" so the translation can reorder words around the value.
//   - String values of display attributes (placeholder, title, aria-label, ...).
//   - Display properties of object literals (title, label, description, ...) such
//     as nav tables, option lists and toast({ title }) calls - except objects that
//     look like database rows or request payloads (see isPayloadObject).
//   - Messages given to toast()/alert()/confirm(), and zod / react-hook-form
//     validation messages.
//   - String branches of conditionals in any of those positions:
//     {saving ? "Saving..." : "Save"}.
//
// Database content, AI output and anything computed at runtime is never touched:
// only string literals written in the source are rewritten.

import ts from "typescript";

export const RUNTIME_IMPORT = `import { __t as __apasT, __s as __apasS } from "@/i18n/runtime";`;
const T = "__apasT";
const S = "__apasS";

/**
 * English plural endings picked by a conditional: `student{n === 1 ? "" : "s"}`.
 * They are not words to translate - other languages pluralise differently - so
 * they are wrapped in __apasS, which drops them outside English.
 */
const PLURAL_SUFFIX = /^(s|es|ies|y|ren|en)$/;

/** Attributes whose string value is shown to the user. */
export const DISPLAY_ATTRS = new Set([
  "placeholder", "title", "aria-label", "aria-description", "alt", "label", "description",
  "subtitle", "heading", "tooltip", "helperText", "emptyText", "emptyMessage", "emptyLabel",
  "confirmText", "cancelText", "confirmLabel", "cancelLabel", "buttonText", "ctaText", "actionLabel",
  "loadingText", "searchPlaceholder", "noResultsText", "hint",
]);

/** Object-literal properties whose string value is shown to the user. */
export const DISPLAY_PROPS = new Set([
  "title", "label", "description", "placeholder", "subtitle", "heading", "tooltip", "helperText",
  "emptyText", "emptyMessage", "confirmText", "cancelText", "confirmLabel", "cancelLabel",
  "buttonText", "ctaText", "actionLabel", "studentTitle", "hint", "shortLabel", "caption", "tagline",
]);

/** Elements whose content is code, not prose. */
const SKIP_ELEMENTS = new Set(["code", "pre", "kbd", "samp", "script", "style"]);

/** Calls whose object arguments are data being sent somewhere, not UI. */
const PAYLOAD_CALLS = new Set([
  "insert", "update", "upsert", "rpc", "invoke", "fetch", "stringify", "setItem", "track",
  "logEvent", "logAudit", "mutate", "mutateAsync", "send", "post", "put", "patch",
  "sendNotification", "from", "eq", "neq", "match", "filter", "in", "select", "order", "postMessage",
]);

/** Object properties whose subtree is a payload. */
const PAYLOAD_PROPS = new Set(["body", "queryKey", "payload", "params", "headers", "metadata", "details"]);

/** Calls whose string arguments are messages for the user. */
const MESSAGE_CALLEES = new Set(["toast", "alert", "confirm"]);
const TOAST_METHODS = new Set(["success", "error", "info", "warning", "message", "loading"]);

/** zod refinements and react-hook-form rules that take a user-facing message. */
const VALIDATION_METHODS = new Set([
  "min", "max", "length", "email", "url", "uuid", "regex", "nonempty", "refine", "startsWith",
  "endsWith", "positive", "negative", "nonnegative", "int", "gt", "gte", "lt", "lte", "date",
]);
const VALIDATION_PROPS = new Set(["message", "required", "required_error", "invalid_type_error"]);

// ── source files ─────────────────────────────────────────────────────────────────

const EXCLUDED_DIRS = ["/src/i18n/", "/src/integrations/", "/src/RFID Module/", "/src/test/", "/src/data/"];

/** Whether a file takes part in UI translation. Paths may use either slash. */
export function isTranslatableFile(file) {
  const p = file.replace(/\\/g, "/").split("?")[0];
  if (!/\/src\//.test(p)) return false;
  if (!/\.(tsx|ts)$/.test(p) || /\.d\.ts$/.test(p)) return false;
  if (/\.(test|spec)\.(tsx|ts)$/.test(p)) return false;
  if (/\/src\/main\.tsx$/.test(p)) return false;
  if (p.includes("/node_modules/")) return false;
  return !EXCLUDED_DIRS.some((d) => p.includes(d));
}

// ── text helpers ─────────────────────────────────────────────────────────────────

const NAMED_ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", copy: "©", hellip: "…", mdash: "—", ndash: "–", rarr: "→", larr: "←", middot: "·", bull: "•" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The string React renders for a JSX text node (Babel's JSX whitespace rules). */
export function cookJsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((l, i) => { if (/[^ \t]/.test(l)) lastNonEmpty = i; });
  let out = "";
  lines.forEach((line, i) => {
    let t = line.replace(/\t/g, " ");
    if (i !== 0) t = t.replace(/^[ ]+/, "");
    if (i !== lines.length - 1) t = t.replace(/[ ]+$/, "");
    if (t) {
      if (i !== lastNonEmpty) t += " ";
      out += t;
    }
  });
  return decodeEntities(out);
}

const hasWords = (s) => /[A-Za-z]{2}/.test(s);

/** Rejects strings that are identifiers, codes, paths or URLs rather than prose. */
export function looksLikeText(s) {
  const t = s.trim();
  if (!hasWords(t)) return false;
  if (/^(https?:|mailto:|tel:|data:|www\.|\/|\.\/|#)/i.test(t)) return false;
  if (/\.(png|jpe?g|svg|gif|webp|pdf|csv|json|xlsx?|docx?|mp[34]|tsx?|jsx?)$/i.test(t)) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return false;           // email
  if (/^[A-Z0-9_.:\-/]+$/.test(t)) return false;                     // CODE, FA-3, ID
  if (/^[a-z][a-z0-9]*([A-Z_][a-zA-Z0-9]*)+$/.test(t)) return false; // camelCase / snake_case
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(t)) return false;              // kebab-case keys
  if (/[{}<>]|=>|\$\{/.test(t)) return false;                        // code-ish
  if (looksLikeClassList(t)) return false;
  return true;
}

/** "bg-red-100 text-red-700", "md:flex hidden" - Tailwind classes, never prose. */
function looksLikeClassList(s) {
  const tokens = s.split(/\s+/);
  return tokens.every((tok) => /^[!-]?([a-z0-9-]+:)*-?[a-z]+(-[\w./%#[\]()]+)*$/.test(tok)) &&
    tokens.some((tok) => tok.includes("-") || tok.includes(":"));
}

/**
 * Pads a replacement with the newlines its original text spanned, so every line
 * after it stays on the same line number. Replacements always end in `)` or `}`,
 * where extra whitespace is harmless.
 */
function keepLines(replacement, original) {
  const missing = (original.match(/\n/g) || []).length - (replacement.match(/\n/g) || []).length;
  if (missing <= 0) return replacement;
  return replacement.slice(0, -1) + "\n".repeat(missing) + replacement.slice(-1);
}

/** Splits leading/trailing whitespace off a message. */
function splitSpace(s) {
  const lead = s.match(/^\s*/)[0];
  const trail = s.slice(lead.length).match(/\s*$/)[0];
  return { lead, core: s.slice(lead.length, s.length - trail.length), trail };
}

// ── AST helpers ──────────────────────────────────────────────────────────────────

const isFunctionLike = (n) =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);

function propName(node) {
  const n = node.name;
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
}

function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

function rootIdentifier(expr) {
  let e = expr;
  for (;;) {
    if (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    else break;
  }
  return ts.isIdentifier(e) ? e.text : null;
}

function jsxTagName(el) {
  const opening = ts.isJsxElement(el) ? el.openingElement : ts.isJsxSelfClosingElement(el) ? el : null;
  return opening ? opening.tagName.getText() : null;
}

function insideSkipElement(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p) && SKIP_ELEMENTS.has(jsxTagName(p))) return true;
  }
  return false;
}

/** Object literals that look like a database row or request body. */
function isPayloadObject(obj) {
  for (const prop of obj.properties) {
    const name = propName(prop);
    if (name && name.includes("_")) return true; // snake_case column names
  }
  for (let p = obj.parent; p && !isFunctionLike(p); p = p.parent) {
    if (ts.isCallExpression(p) && PAYLOAD_CALLS.has(calleeName(p))) return true;
    if (ts.isPropertyAssignment(p) && PAYLOAD_PROPS.has(propName(p))) return true;
    if (ts.isJsxAttribute(p)) return false;
  }
  return false;
}

function isMessageCall(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return MESSAGE_CALLEES.has(e.text);
  if (ts.isPropertyAccessExpression(e)) {
    const obj = e.expression;
    if (ts.isIdentifier(obj) && obj.text === "toast" && TOAST_METHODS.has(e.name.text)) return true;
    if (ts.isIdentifier(obj) && obj.text === "window" && (e.name.text === "alert" || e.name.text === "confirm")) return true;
  }
  return false;
}

function isValidationCall(call) {
  const name = calleeName(call);
  if (!name) return false;
  if (name === "register" || name === "useController") return true;
  return VALIDATION_METHODS.has(name) && rootIdentifier(call.expression) === "z";
}

/** Helpers that produce display text: getGreeting, statusLabel, formatRiskText, ... */
const LABEL_FUNCTION = /(Label|Text|Title|Message|Greeting|Description|Caption|Heading|Subtitle|Tooltip|Hint|Copy)$/;
/** Lookup tables of display text: STATUS_LABELS, riskTitles, EMPTY_MESSAGES, ... */
const LABEL_TABLE = /(labels?|titles?|texts?|messages?|descriptions?|captions?|headings?|greetings?|tooltips?|hints?|copy)$/i;

function functionName(fn) {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.getText();
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p)) return propName(p);
  return null;
}

function isLabelFunction(fn) {
  const name = fn && functionName(fn);
  return !!name && LABEL_FUNCTION.test(name);
}

function enclosingFunction(node) {
  for (let p = node.parent; p; p = p.parent) if (isFunctionLike(p)) return p;
  return null;
}

/** `const STATUS_LABELS = { ... }` (also through `as const` / `satisfies`). */
function isLabelTable(obj) {
  let p = obj.parent;
  while (p && (ts.isAsExpression(p) || ts.isSatisfiesExpression?.(p) || ts.isParenthesizedExpression(p))) p = p.parent;
  return !!p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && LABEL_TABLE.test(p.name.text);
}

/** Nearest enclosing call within the same function, or null. */
function enclosingCall(node) {
  for (let p = node.parent; p && !isFunctionLike(p); p = p.parent) {
    if (ts.isCallExpression(p)) return p;
  }
  return null;
}

/**
 * Whether a string/template literal sits where its value is shown to the user.
 * Conditional branches, `a || "b"`, parentheses and template spans pass the
 * question up to their parent; the condition of a ternary never counts.
 */
function isDisplayPosition(node) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isParenthesizedExpression(p)) return isDisplayPosition(p);
  if (ts.isConditionalExpression(p)) return p.condition !== node && isDisplayPosition(p);
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    const logical = op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken;
    return logical && (op === ts.SyntaxKind.AmpersandAmpersandToken ? p.right === node : true) && isDisplayPosition(p);
  }
  if (ts.isTemplateSpan(p)) return isDisplayPosition(p.parent);
  if (ts.isJsxExpression(p)) {
    const host = p.parent;
    if (ts.isJsxElement(host) || ts.isJsxFragment(host)) return !insideSkipElement(p);
    if (ts.isJsxAttribute(host)) return DISPLAY_ATTRS.has(host.name.getText());
    return false;
  }
  if (ts.isPropertyAssignment(p) && p.initializer === node) {
    const name = propName(p);
    const obj = p.parent;
    if (!ts.isObjectLiteralExpression(obj)) return false;
    if (VALIDATION_PROPS.has(name)) {
      const call = enclosingCall(obj);
      return !!call && isValidationCall(call);
    }
    if (isPayloadObject(obj)) return false;
    return DISPLAY_PROPS.has(name) || isLabelTable(obj);
  }
  if (ts.isCallExpression(p) && p.arguments.includes(node)) {
    return isMessageCall(p) || isValidationCall(p);
  }
  if (ts.isReturnStatement(p)) return isLabelFunction(enclosingFunction(p));
  if (ts.isArrowFunction(p) && p.body === node) return isLabelFunction(p);
  if (ts.isCaseClause(p) || ts.isDefaultClause(p)) return false;
  return false;
}

// ── main pass ────────────────────────────────────────────────────────────────────

/**
 * @param {string} code
 * @param {string} file  used for the parser's script kind
 * @param {{ rewrite?: boolean }} [options]
 * @returns {{ messages: string[], code: string | null }}
 *   messages: every message found, in source order (may repeat)
 *   code:     rewritten source, or null when nothing changed / rewrite is off
 */
export function processSource(code, file, { rewrite = false } = {}) {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
  const messages = [];
  /** @type {{ start: number, end: number, text: string, consumed: boolean }[]} */
  const edits = [];

  const call = (msg, args) =>
    args && args.length ? `${T}(${JSON.stringify(msg)}, [${args.join(", ")}])` : `${T}(${JSON.stringify(msg)})`;

  /** Source of [start, end) with every not-yet-used edit inside it applied (and marked used). */
  function rewritten(start, end) {
    const inner = edits.filter((e) => !e.consumed && e.start >= start && e.end <= end).sort((a, b) => b.start - a.start);
    let out = code.slice(start, end);
    for (const e of inner) {
      out = out.slice(0, e.start - start) + e.text + out.slice(e.end - start);
      e.consumed = true;
    }
    return out;
  }

  /** Template literal -> message with {n} placeholders, or null when it has no prose. */
  function templateMessage(node) {
    if (ts.isNoSubstitutionTemplateLiteral(node)) return { msg: node.text, args: [] };
    let msg = node.head.text;
    const args = [];
    node.templateSpans.forEach((span, i) => {
      msg += `{${i}}` + span.literal.text;
      args.push(span.expression);
    });
    const prose = node.head.text + node.templateSpans.map((s) => s.literal.text).join(" ");
    return hasWords(prose) ? { msg, args } : null;
  }

  function isPluralSuffix(node) {
    if (!ts.isStringLiteral(node) || !PLURAL_SUFFIX.test(node.text)) return false;
    const p = node.parent;
    if (!p || !ts.isConditionalExpression(p) || p.condition === node) return false;
    const other = p.whenTrue === node ? p.whenFalse : p.whenTrue;
    return ts.isStringLiteral(other) && other.text.length <= 3;
  }

  function handleLiteral(node) {
    if (!isDisplayPosition(node)) return;
    if (isPluralSuffix(node)) {
      if (rewrite) edits.push({ start: node.getStart(sf), end: node.end, text: `${S}(${JSON.stringify(node.text)})`, consumed: false });
      return;
    }
    const isTemplate = ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node);
    if (isTemplate) {
      const tm = templateMessage(node);
      if (!tm) return;
      const { lead, core, trail } = splitSpace(tm.msg);
      if (!looksLikeText(core.replace(/\{\d+\}/g, " x "))) return;
      messages.push(core);
      if (!rewrite) return;
      const args = tm.args.map((a) => rewritten(a.getStart(sf), a.end));
      const looked = call(core, args);
      const text = lead || trail ? `(${JSON.stringify(lead)} + ${looked} + ${JSON.stringify(trail)})` : looked;
      edits.push({ start: node.getStart(sf), end: node.end, text, consumed: false });
      return;
    }
    const value = node.text;
    const { lead, core, trail } = splitSpace(value);
    if (!looksLikeText(core)) return;
    messages.push(core);
    if (!rewrite) return;
    const looked = call(core);
    const text = lead || trail ? `(${JSON.stringify(lead)} + ${looked} + ${JSON.stringify(trail)})` : looked;
    edits.push({ start: node.getStart(sf), end: node.end, text, consumed: false });
  }

  function handleAttribute(attr) {
    if (!DISPLAY_ATTRS.has(attr.name.getText())) return;
    const init = attr.initializer;
    if (!init || !ts.isStringLiteral(init)) return; // expression initializers go through isDisplayPosition
    const value = decodeEntities(init.text);
    const { core } = splitSpace(value);
    if (!looksLikeText(core)) return;
    messages.push(core);
    if (rewrite) edits.push({ start: init.getStart(sf), end: init.end, text: `{${call(core)}}`, consumed: false });
  }

  const jsx = (s) => `{${JSON.stringify(s)}}`;

  function handleChildren(el) {
    if (ts.isJsxElement(el) && SKIP_ELEMENTS.has(jsxTagName(el))) return;
    if (insideSkipElement(el)) return;
    const children = el.children;
    const meaningful = children.filter((c) =>
      ts.isJsxText(c) ? cookJsxText(c.text) !== "" : ts.isJsxExpression(c) ? !!c.expression : true);
    if (!meaningful.length) return;

    const mergeable =
      meaningful.every((c) => ts.isJsxText(c) || ts.isJsxExpression(c)) &&
      meaningful.some((c) => ts.isJsxExpression(c)) &&
      meaningful.some((c) => ts.isJsxText(c) && hasWords(cookJsxText(c.text)));

    if (mergeable) {
      let msg = "";
      const args = [];
      for (const c of meaningful) {
        if (ts.isJsxText(c)) msg += cookJsxText(c.text);
        else { msg += `{${args.length}}`; args.push(c.expression); }
      }
      const { lead, core, trail } = splitSpace(msg);
      if (!looksLikeText(core.replace(/\{\d+\}/g, " x "))) return;
      messages.push(core);
      if (!rewrite) return;
      const first = meaningful[0];
      const last = meaningful[meaningful.length - 1];
      const start = ts.isJsxText(first) ? first.pos : first.getStart(sf);
      const end = last.end;
      const argSrc = args.map((a) => rewritten(a.getStart(sf), a.end));
      const text = (lead ? jsx(lead) : "") + `{${call(core, argSrc)}}` + (trail ? jsx(trail) : "");
      edits.push({ start, end, text, consumed: false });
      return;
    }

    for (const c of meaningful) {
      if (!ts.isJsxText(c)) continue;
      const cooked = cookJsxText(c.text);
      if (!hasWords(cooked)) continue;
      const { lead, core, trail } = splitSpace(cooked);
      if (/[{}]/.test(core)) continue;
      messages.push(core);
      if (rewrite) {
        const text = (lead ? jsx(lead) : "") + `{${call(core)}}` + (trail ? jsx(trail) : "");
        edits.push({ start: c.pos, end: c.end, text, consumed: false });
      }
    }
  }

  function visit(node) {
    ts.forEachChild(node, visit); // post-order: inner rewrites exist before outer ones use them
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      if (!(node.parent && ts.isJsxAttribute(node.parent))) handleLiteral(node);
    } else if (ts.isJsxAttribute(node)) {
      handleAttribute(node);
    } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      handleChildren(node);
    }
  }
  visit(sf);

  if (!rewrite) return { messages, code: null };
  const top = edits.filter((e) => !e.consumed).sort((a, b) => b.start - a.start);
  if (!top.length) return { messages, code: null };
  let out = code;
  for (const e of top) out = out.slice(0, e.start) + keepLines(e.text, code.slice(e.start, e.end)) + out.slice(e.end);
  // Appended, not prepended: ES imports are hoisted, and keeping line 1 where it was
  // keeps line numbers in stack traces pointing at the right source line.
  return { messages, code: `${out}\n${RUNTIME_IMPORT}\n` };
}
