// tools/feature-docs/extractScreen.mjs
//
// Reads a React (.tsx) file with the TypeScript compiler and extracts FACTS about what a user sees on that screen:
// tab names, button labels, headings, field labels and placeholders, empty-state messages, and a leading comment.
// It never guesses or writes prose. A fact is a string that is literally in the source as JSX text or a JSX attribute.
//
// Privacy: strings that look like personal data (emails, phone numbers, ids, links) are dropped, and comments that
// talk about internals (tables, RLS, hooks, edge functions) are never used as a description.
import ts from "typescript";

const TAB_TAGS = new Set(["TabsTrigger", "TabsTab", "Tab"]);
const BUTTON_TAGS = new Set(["Button", "button", "IconButton"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "CardTitle", "DialogTitle", "SheetTitle", "AlertDialogTitle", "PageTitle", "SectionTitle"]);
const DESC_TAGS = new Set(["CardDescription", "DialogDescription", "SheetDescription"]);
const LABEL_TAGS = new Set(["Label", "label", "FormLabel"]);
const BUTTON_STOP = new Set(["cancel", "close", "ok", "yes", "no", "loading", "loading...", "try again", "retry", "dismiss", "x"]);

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const LONG_DIGITS = /\d{7,}/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const URLISH = /(https?:\/\/|www\.)/i;
const INTERNAL = /`|\bsupabase\b|\bRLS\b|\bedge function\b|\bhook\b|\buse[A-Z]\w+|\b[a-z]+_[a-z_]+\b|\bTODO\b|\bFIXME\b|eslint|@ts-|\bprops?\b|\bstate\b|\brender|\bcomponent\b|\bAPI\b|\bSQL\b|\bendpoint\b/;

/** Normalise a candidate string and drop it when it is not safe or not useful to show. */
export function cleanText(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 140) return null;
  if (!/[A-Za-z]{2}/.test(s)) return null;
  if (!/^[A-Za-z0-9"'\u2018\u201C]/.test(s)) return null; // starts mid-sentence or with a symbol: not a label
  if (/^loading\b/i.test(s)) return null;
  if (/[{}]|=>|&&|\|\|/.test(s)) return null;
  if (EMAIL.test(s) || LONG_DIGITS.test(s) || UUID.test(s) || URLISH.test(s)) return null;
  return s;
}

/** True when a leading comment is a user-facing description (not an implementation note). */
export function isDescriptiveComment(text) {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length < 30) return false;
  if (!/^[A-Z]/.test(s)) return false;
  if (INTERNAL.test(s)) return false;
  return true;
}

function literalTexts(expr) {
  if (!expr) return [];
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
  if (ts.isParenthesizedExpression(expr)) return literalTexts(expr.expression);
  if (ts.isConditionalExpression(expr)) return [...literalTexts(expr.whenTrue), ...literalTexts(expr.whenFalse)];
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return literalTexts(expr.right);
  if (ts.isJsxElement(expr) || ts.isJsxFragment(expr)) return [];
  return [];
}

function tagNameOf(el, sf) {
  const n = ts.isJsxElement(el) ? el.openingElement.tagName : el.tagName;
  return n.getText(sf);
}
function attrsOf(el) {
  return ts.isJsxElement(el) ? el.openingElement.attributes.properties : el.attributes.properties;
}
function attrString(el, name) {
  for (const a of attrsOf(el)) {
    if (ts.isJsxAttribute(a) && a.name.getText() === name && a.initializer) {
      if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
      if (ts.isJsxExpression(a.initializer)) return literalTexts(a.initializer.expression)[0];
    }
  }
  return undefined;
}

/**
 * All literal text inside an element (JSX text, {"literals"}, and nested elements up to depth 3).
 * `dynamic` is true when some part is computed at run time ({count}, {name}): the sentence is then incomplete
 * in the source, so callers must not present its fragments as a finished label or message.
 */
function textInside(el, depth = 0) {
  if (!ts.isJsxElement(el) || depth > 3) return { parts: [], dynamic: false };
  const parts = [];
  let dynamic = false;
  for (const c of el.children) {
    if (ts.isJsxText(c)) {
      if (!c.containsOnlyTriviaWhiteSpaces) parts.push(c.text);
    } else if (ts.isJsxExpression(c)) {
      const lits = literalTexts(c.expression);
      if (lits.length) parts.push(...lits);
      else if (c.expression) dynamic = true;
    } else if (ts.isJsxElement(c)) {
      const inner = textInside(c, depth + 1);
      parts.push(...inner.parts);
      dynamic ||= inner.dynamic;
    }
  }
  return { parts, dynamic };
}

const leadingComments = (source, pos) =>
  (ts.getLeadingCommentRanges(source, pos) || []).map((r) => {
    const raw = source.slice(r.pos, r.end);
    return raw.replace(/^\/\*+|\*+\/$/g, "").split("\n").map((l) => l.replace(/^\s*(\/\/+|\*+)\s?/, "")).join(" ").trim();
  });

/**
 * @returns {{comment:string|null, tabs:string[], buttons:string[], headings:string[], descriptions:string[],
 *            inputs:string[], messages:string[], jsxTags:string[], imports:{spec:string,names:string[]}[]}}
 */
export function extractScreenFacts(source, fileName = "file.tsx") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const facts = { tabs: [], buttons: [], headings: [], descriptions: [], inputs: [], messages: [], jsxTags: new Set(), imports: [] };
  const add = (list, raw) => {
    const s = cleanText(raw);
    if (s && !list.includes(s)) list.push(s);
  };
  const isMessage = (s) => /^(No |Nothing |You (haven't|have not|don't|do not) |There (are|is) no )/i.test(s) && s.length >= 12;

  // imports (to follow components that this screen renders)
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const names = [];
      const c = st.importClause;
      if (c?.name) names.push(c.name.text);
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) c.namedBindings.elements.forEach((e) => names.push(e.name.text));
      facts.imports.push({ spec: st.moduleSpecifier.text, names });
    }
  }

  // leading comment: top of file, or just above the first non-import statement
  const candidates = [...leadingComments(source, 0)];
  const first = sf.statements.find((s) => !ts.isImportDeclaration(s));
  if (first) candidates.push(...leadingComments(source, first.getFullStart()));
  facts.comment = candidates.find(isDescriptiveComment) ?? null;

  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = tagNameOf(node, sf);
      facts.jsxTags.add(tag);
      const inside = ts.isJsxElement(node) ? textInside(node) : { parts: [], dynamic: false };
      const texts = inside.dynamic ? [] : inside.parts; // an incomplete sentence is worse than none
      const joined = texts.join(" ");
      const upper = /^[A-Z]/.test(tag);

      if (TAB_TAGS.has(tag)) add(facts.tabs, joined);
      else if (BUTTON_TAGS.has(tag)) {
        const labels = texts.length > 1 && texts.every((t) => t.trim().length <= 30) && !inside.dynamic
          ? texts // {a ? "Start" : "Resume"} = separate alternatives, not one long label
          : [joined.trim() ? joined : attrString(node, "aria-label") ?? attrString(node, "title") ?? ""];
        for (const l of labels) {
          const c = cleanText(l);
          if (c && !BUTTON_STOP.has(c.toLowerCase())) add(facts.buttons, c);
        }
      } else if (HEADING_TAGS.has(tag)) add(facts.headings, joined);
      else if (DESC_TAGS.has(tag)) add(facts.descriptions, joined);
      else if (LABEL_TAGS.has(tag)) add(facts.inputs, joined);
      else if (tag === "p" && /muted/.test(attrString(node, "className") ?? "")) {
        const c = cleanText(joined);
        if (c && c.length >= 25 && c.split(" ").length >= 5) add(facts.descriptions, c);
      }

      const ph = attrString(node, "placeholder");
      if (ph) add(facts.inputs, ph);
      if (upper) {
        const t = attrString(node, "title") ?? attrString(node, "heading");
        const d = attrString(node, "subtitle") ?? attrString(node, "description");
        if (t) add(facts.headings, t);
        if (d) {
          const c = cleanText(d);
          if (c && c.split(" ").length >= 4) add(facts.descriptions, c);
        }
      }
      for (const t of texts) {
        const c = cleanText(t);
        if (c && isMessage(c)) add(facts.messages, c);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { ...facts, jsxTags: [...facts.jsxTags] };
}

/** Merge facts from several files (page first). Caps keep documents short. */
export function mergeFacts(list) {
  const CAP = { tabs: 12, buttons: 14, headings: 8, descriptions: 3, inputs: 8, messages: 6 };
  const out = { comment: null, tabs: [], buttons: [], headings: [], descriptions: [], inputs: [], messages: [] };
  for (const f of list) {
    out.comment ??= f.comment;
    for (const k of Object.keys(CAP)) for (const s of f[k]) if (!out[k].includes(s) && out[k].length < CAP[k]) out[k].push(s);
  }
  return out;
}
