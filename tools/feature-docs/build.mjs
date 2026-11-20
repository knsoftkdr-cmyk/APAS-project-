// tools/feature-docs/build.mjs
//
// Builds the feature documentation for one role from three kinds of source, strongest first:
//   1. MANUAL   the hand-written guide (supabase/functions/_shared/<role>FeatureGuide.ts). Always wins.
//   2. HELP     the page-help registry (src/components/help), already test-verified against the code.
//   3. EXTRACTED facts read from the screen's real source (tabs, buttons, headings, fields, messages, comment).
// Anything it cannot ground is flagged `needsReview` instead of being described.
//
// It also compares with the previous generation to report added / modified / removed / renamed features.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { loadTs } from "./loadTs.mjs";
import { extractScreenFacts, mergeFacts, cleanText } from "./extractScreen.mjs";
import { parseRoutes, resolveImport } from "./routes.mjs";
import { MANUAL_FEATURE_SOURCES, SKIP_IMPORT_PREFIXES, MAX_FILES_PER_FEATURE, FOLLOW_DEPTH } from "./config.mjs";

export const SCHEMA_VERSION = 1;

const sha = (v) => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex").slice(0, 16);
const norm = (s) => (s ?? "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const baseName = (s) => s.replace(/\s*\(.*\)\s*$/, "");
const rel = (root, f) => path.relative(root, f).split(path.sep).join("/");

// ───────────────────────────── reading screens ─────────────────────────────

function makeScreenReader(root) {
  const cache = new Map();
  const facts = (file) => {
    if (!cache.has(file)) cache.set(file, extractScreenFacts(fs.readFileSync(file, "utf8"), file));
    return cache.get(file);
  };
  /** Read a page and the feature components it renders (not UI kit / layout / hooks). */
  const readScreen = (startFiles) => {
    const seen = new Set();
    const order = [];
    const queue = startFiles.filter(Boolean).map((f) => [f, 0]);
    while (queue.length && order.length < MAX_FILES_PER_FEATURE) {
      const [file, depth] = queue.shift();
      if (seen.has(file) || !fs.existsSync(file)) continue;
      seen.add(file);
      order.push(file);
      if (depth >= FOLLOW_DEPTH) continue;
      const f = facts(file);
      for (const imp of f.imports) {
        if (SKIP_IMPORT_PREFIXES.some((p) => imp.spec.startsWith(p))) continue;
        if (!imp.names.some((n) => f.jsxTags.includes(n))) continue; // only components this screen actually renders
        const target = resolveImport(imp.spec, file, root);
        if (target && /\.tsx$/.test(target)) queue.push([target, depth + 1]);
      }
    }
    return { files: order.map((f) => rel(root, f)), screen: mergeFacts(order.map(facts)) };
  };
  return { readScreen };
}

function readProfileTabs(root, file) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) return [];
  const sf = ts.createSourceFile(p, fs.readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tabs = [];
  sf.forEachChild(function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText() === "TABS" && n.initializer) {
      let arr = n.initializer;
      if (ts.isAsExpression(arr)) arr = arr.expression;
      if (ts.isArrayLiteralExpression(arr)) {
        for (const el of arr.elements) {
          if (!ts.isObjectLiteralExpression(el)) continue;
          const o = {};
          for (const pr of el.properties) if (ts.isPropertyAssignment(pr) && ts.isStringLiteral(pr.initializer)) o[pr.name.getText()] = pr.initializer.text;
          if (o.value && o.label) tabs.push({ value: o.value, label: o.label, hint: o.hint ?? null });
        }
      }
    }
    ts.forEachChild(n, visit);
  });
  return tabs;
}

// ───────────────────────────── composing a document ─────────────────────────────

const PRIVATE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\d{7,}|https?:\/\//i;

function list(label, items) {
  return items.length ? `${label}: ${items.map((i) => i.replace(/[.\s]+$/, "")).join("; ")}.` : null;
}

function composeContent(d) {
  const L = [d.name, `Where: ${d.where}`];
  L.push(d.purpose ? `What it is: ${d.purpose}` : "What it is: (not documented yet)");
  if (d.steps.length) L.push(`How to use it: ${d.steps.map((s, i) => `(${i + 1}) ${s}`).join(" ")}`);
  const sc = d.screen;
  const onScreen = [list("Tabs", sc.tabs), list("Buttons", sc.buttons), list("Sections", sc.headings), list("Fields", sc.inputs), list("Messages it can show", sc.messages)].filter(Boolean);
  if (onScreen.length) L.push(`On the screen: ${onScreen.join(" ")}`);
  if (d.notes.length) L.push(`Good to know: ${d.notes.join(" ")}`);
  if (d.problems.length) L.push(`If something goes wrong: ${d.problems.join(" ")}`);
  if (d.confidence === "low") L.push("Documentation status: incomplete. Only the screen text above is known. Say what is visible there, and do not guess what the feature does beyond it.");
  return L.join("\n");
}

function buildSearchText(d, keywords) {
  return [d.name, ...d.aliases, ...keywords, d.purpose, ...d.screen.tabs, ...d.screen.buttons, ...d.screen.headings, ...d.taskTitles].filter(Boolean).join(" . ");
}

function sentence(s, max = 220) {
  const t = s.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{20,}?[.!?])(\s|$)/);
  const out = m ? m[1] : t;
  return out.length > max ? out.slice(0, max - 1).trimEnd() + "…" : out;
}

/** Decide where the purpose comes from and how much to trust it. */
function pickPurpose({ manual, help, screen }) {
  if (manual?.summary) return { purpose: manual.summary, source: "manual" };
  if (help?.purpose) return { purpose: help.purpose, source: "help" };
  if (screen.comment) return { purpose: sentence(screen.comment), source: "comment" };
  const sub = screen.descriptions.find((x) => x.split(" ").length >= 6 && !/^(No |Nothing |You haven)/i.test(x));
  if (sub) return { purpose: sentence(sub), source: "subtitle" };
  return { purpose: null, source: "none" };
}

function grade({ purposeSource, screen, hasSteps }) {
  const labels = screen.tabs.length + screen.buttons.length + screen.headings.length + screen.inputs.length;
  if (purposeSource === "manual" || purposeSource === "help") return { confidence: "high", reasons: [] };
  if (purposeSource === "tab-hint") return { confidence: "medium", reasons: [] }; // the tab's own one-line hint is a real description
  if ((purposeSource === "comment" || purposeSource === "subtitle") && labels >= 3) return { confidence: "medium", reasons: ["purpose was read from a screen comment/subtitle, not written by a person"] };
  const why = purposeSource === "none" ? "no purpose could be read from the code" : "purpose found but too little screen text to explain how to use it";
  return { confidence: "low", reasons: [`${why} (${labels} labels found)`] };
}

// ───────────────────────────── main build ─────────────────────────────

/**
 * @param {{root:string, cfg:object, previous?:object|null, accept?:Set<string>|'all'}} o
 */
export async function buildRoleDocs({ root, cfg, previous = null, accept = new Set() }) {
  const { readScreen } = makeScreenReader(root);
  const guide = await loadTs(cfg.guide, root);
  const manualList = guide[cfg.guideExport] ?? [];
  const menuRows = guide[cfg.menuRowsExport]();
  const help = (await loadTs("src/components/help/pageHelp.ts", root)).PAGE_HELP ?? [];
  const appFile = path.join(root, "src/App.tsx");
  const routes = parseRoutes(fs.readFileSync(appFile, "utf8"), appFile, root);
  const tabs = readProfileTabs(root, cfg.profileTabsFile);
  const prevByKey = new Map((previous?.docs ?? []).map((d) => [d.key, d]));

  const used = new Set();
  const matchManual = (pred) => manualList.find((m) => !used.has(m.id) && pred(m));
  const drafts = [];

  // 1) every page in the role's menu
  for (const row of menuRows) {
    const [routePath] = row.path.split("?");
    const r = routes.get(routePath);
    const helpEntry = help.find((h) => h.route === routePath && h.roles.includes(cfg.role)) ?? null;
    const manual = matchManual((m) => m.routes?.includes(row.path) || norm(baseName(m.name)) === norm(row.name)) ?? null;
    if (manual) used.add(manual.id);
    const helpFiles = (helpEntry?.sources ?? []).map((f) => path.join(root, f));
    const { files, screen } = readScreen([r?.file, ...helpFiles]);
    drafts.push({
      key: `nav:${row.path}`, kind: "page", name: row.name, route: row.path,
      where: manual?.where ?? `Left menu, ${row.name}.`,
      roles: r?.allowedRoles ?? null, manual, helpEntry, files, screen,
    });
  }

  // 2) profile tabs read from the tab strip
  for (const t of tabs) {
    const manual = matchManual((m) => m.profileTabs?.length === 1 && m.profileTabs[0] === t.label && norm(m.name).startsWith(norm(t.label)));
    if (manual) used.add(manual.id);
    drafts.push({
      key: `tab:student-profile/${t.value}`, kind: "tab", name: `${t.label} (profile tab)`, route: null,
      where: manual?.where ?? `Student Profile, ${t.label} tab.`, roles: null, manual, helpEntry: null,
      files: [cfg.profileTabsFile], screen: { comment: null, tabs: [], buttons: [], headings: [], descriptions: [], inputs: [], messages: [] },
      tabHint: t.hint,
    });
  }

  // 3) hand-written entries that are neither (cards, header tools, umbrella entries)
  for (const m of manualList) {
    if (used.has(m.id)) continue;
    const srcs = (MANUAL_FEATURE_SOURCES[m.id] ?? []).map((f) => path.join(root, f));
    const { files, screen } = readScreen(srcs);
    drafts.push({ key: `manual:${m.id}`, kind: "manual", name: m.name, route: null, where: m.where, roles: null, manual: m, helpEntry: null, files, screen });
  }

  // assemble final documents
  const docs = drafts.map((d) => {
    const prev = prevByKey.get(d.key);
    const m = d.manual;
    const purposeInfo = m?.summary || d.helpEntry?.purpose ? pickPurpose({ manual: m, help: d.helpEntry, screen: d.screen })
      : d.tabHint ? { purpose: d.tabHint.endsWith(".") ? d.tabHint : d.tabHint + ".", source: "tab-hint" } : pickPurpose({ manual: null, help: null, screen: d.screen });
    const task0 = d.helpEntry?.tasks?.[0];
    const steps = (m?.howTo?.length ? m.howTo : task0?.steps ?? []).map((s) => s.trim());
    const notes = [...(m?.notes ?? []), ...(!m?.notes && task0?.result ? [task0.result] : [])];
    const problems = (d.helpEntry?.problems ?? []).slice(0, 3).map((p) => `${p.problem} - ${p.fix}`);
    const taskTitles = (d.helpEntry?.tasks ?? []).map((t) => t.title);
    const aliasesFromKeywords = (m?.keywords ?? []).filter((k) => k.trim().split(/\s+/).length >= 2 && norm(k) !== norm(d.name));
    const keywords = (m?.keywords ?? []).filter((k) => k.trim().split(/\s+/).length < 2);
    const renamedFrom = prev && prev.name !== d.name ? [prev.name] : [];
    const aliases = [...new Set([...(prev?.aliases ?? []), ...renamedFrom, ...aliasesFromKeywords])].filter((a) => norm(a) !== norm(d.name)).slice(0, 16);

    const tabLike = d.tabHint ? [] : [];
    const screen = d.screen;
    const factsHash = sha({
      route: d.route, roles: d.roles, screen, tabHint: d.tabHint ?? null,
      help: d.helpEntry ? { name: d.helpEntry.name, purpose: d.helpEntry.purpose, controls: d.helpEntry.controls, tasks: d.helpEntry.tasks, problems: d.helpEntry.problems } : null,
    });
    const hasManual = !!m;
    let reviewed = prev?.reviewedFactsHash ?? factsHash;
    if (prev && !prev.docOrigin.includes("manual") && hasManual) reviewed = factsHash; // author just wrote it
    if (accept === "all" || (accept instanceof Set && accept.has(d.key))) reviewed = factsHash;

    const { confidence, reasons } = grade({ purposeSource: purposeInfo.source, screen, hasSteps: steps.length > 0 });
    const reviewReasons = [...reasons];
    let needsReview = confidence === "low";
    if (hasManual && prev && reviewed !== factsHash) {
      needsReview = true;
      reviewReasons.push("the screen changed since this written documentation was last reviewed - re-check it, then run: npm run features:accept -- " + d.key);
    }
    if (d.kind === "manual" && d.files.length === 0 && !m?.summary) needsReview = true;

    const doc = {
      key: d.key, role: cfg.role, kind: d.kind, name: d.name, aliases, keywords, route: d.route,
      where: d.where, accessRoles: d.roles,
      purpose: purposeInfo.purpose, purposeSource: purposeInfo.source, steps, notes, problems, taskTitles,
      screen: { tabs: screen.tabs, buttons: screen.buttons, headings: screen.headings, inputs: screen.inputs, messages: screen.messages },
      sources: d.files, docOrigin: [hasManual ? "manual" : null, d.helpEntry ? "help" : null, d.files.length ? "extracted" : null, d.tabHint ? "tab-hint" : null].filter(Boolean),
      confidence, needsReview, reviewReasons, factsHash, reviewedFactsHash: reviewed,
    };
    doc.content = composeContent({ ...doc, screen: doc.screen });
    doc.searchText = buildSearchText(doc, keywords);
    // privacy backstop: nothing that looks like personal data may enter the knowledge base
    if (PRIVATE.test(doc.content) || PRIVATE.test(doc.searchText)) {
      throw new Error(`Feature doc ${d.key} contains something that looks like personal data or a link. Remove it from the source text or the guide.`);
    }
    doc.contentHash = sha({ n: doc.name, a: doc.aliases, k: doc.keywords, r: doc.route, c: doc.content, s: doc.searchText, v: SCHEMA_VERSION });
    return doc;
  });

  docs.sort((a, b) => a.key.localeCompare(b.key));
  return { schema: SCHEMA_VERSION, role: cfg.role, docs };
}

// ───────────────────────────── change report ─────────────────────────────

/** Compare two generations. Rename = same key with a new name, or a vanished + new feature that share the same main source file. */
export function diffDocs(previous, next) {
  const prev = new Map((previous?.docs ?? []).map((d) => [d.key, d]));
  const cur = new Map(next.docs.map((d) => [d.key, d]));
  const rep = { added: [], removed: [], renamed: [], modified: [], needsReview: [] };
  const goneKeys = [...prev.keys()].filter((k) => !cur.has(k));
  const newKeys = [...cur.keys()].filter((k) => !prev.has(k));
  const movedFrom = new Set();
  const movedTo = new Set();
  for (const nk of newKeys) {
    const n = cur.get(nk);
    const mainFile = n.sources?.[0];
    const g = goneKeys.find((gk) => !movedFrom.has(gk) && mainFile && prev.get(gk).sources?.[0] === mainFile && n.kind === prev.get(gk).kind);
    if (g) { movedFrom.add(g); movedTo.add(nk); rep.renamed.push({ key: nk, from: prev.get(g).name, to: n.name, oldKey: g }); }
  }
  for (const k of newKeys) if (!movedTo.has(k)) rep.added.push({ key: k, name: cur.get(k).name, confidence: cur.get(k).confidence });
  for (const k of goneKeys) if (!movedFrom.has(k)) rep.removed.push({ key: k, name: prev.get(k).name });
  for (const [k, n] of cur) {
    const p = prev.get(k);
    if (!p) continue;
    if (p.name !== n.name) rep.renamed.push({ key: k, from: p.name, to: n.name });
    else if (p.contentHash !== n.contentHash) rep.modified.push({ key: k, name: n.name, appChanged: p.factsHash !== n.factsHash });
  }
  rep.needsReview = next.docs.filter((d) => d.needsReview).map((d) => ({ key: d.key, name: d.name, reasons: d.reviewReasons }));
  return rep;
}

/** Carry the old name(s) of a moved feature forward as aliases so students who still use the old name are understood. */
export function applyMoves(previous, next, report) {
  for (const r of report.renamed) {
    if (!r.oldKey) continue;
    const old = previous.docs.find((d) => d.key === r.oldKey);
    const doc = next.docs.find((d) => d.key === r.key);
    if (old && doc) doc.aliases = [...new Set([...old.aliases, old.name, ...doc.aliases])].filter((a) => norm(a) !== norm(doc.name)).slice(0, 16);
  }
}

// ───────────────────────────── output ─────────────────────────────

export function renderMarkdown(set, report) {
  const L = [`# ${set.role[0].toUpperCase() + set.role.slice(1)} feature knowledge base`, "",
    "GENERATED by `tools/generate-feature-docs.mjs` - do not edit. To change what the assistant says about a feature, edit the hand-written guide",
    `(\`supabase/functions/_shared/${set.role}FeatureGuide.ts\`); it always wins over what is extracted from the code. Then run \`npm run features:generate\`.`, "",
    `${set.docs.length} features. High confidence: ${set.docs.filter((d) => d.confidence === "high").length}, medium: ${set.docs.filter((d) => d.confidence === "medium").length}, low: ${set.docs.filter((d) => d.confidence === "low").length}.`, ""];
  const review = set.docs.filter((d) => d.needsReview);
  if (review.length) {
    L.push("## Needs developer review", "");
    for (const d of review) L.push(`- **${d.name}** (\`${d.key}\`): ${d.reviewReasons.join("; ") || "details missing"}`);
    L.push("");
  }
  L.push("## Features", "");
  for (const d of set.docs) {
    L.push(`### ${d.name}`, "", `- Key: \`${d.key}\``, `- Confidence: ${d.confidence}${d.needsReview ? " (needs review)" : ""}`, `- Documentation from: ${d.docOrigin.join(" + ") || "name only"}`, "", "```text", d.content, "```", "");
  }
  return L.join("\n");
}

export function summariseReport(report) {
  const lines = [];
  const f = (title, arr, fmt) => arr.length && lines.push(`${title} (${arr.length}):`, ...arr.map((x) => "  - " + fmt(x)));
  f("ADDED", report.added, (x) => `${x.name} [${x.confidence}]`);
  f("MODIFIED", report.modified, (x) => `${x.name}${x.appChanged ? " (screen changed)" : " (documentation changed)"}`);
  f("RENAMED / MOVED", report.renamed, (x) => `${x.from} -> ${x.to}`);
  f("REMOVED", report.removed, (x) => x.name);
  f("NEEDS REVIEW", report.needsReview, (x) => `${x.name}: ${x.reasons.join("; ") || "details missing"}`);
  return lines.join("\n");
}
