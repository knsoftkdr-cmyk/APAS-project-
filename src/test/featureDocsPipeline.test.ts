import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error - plain .mjs tools, no types
import { extractScreenFacts, cleanText, isDescriptiveComment } from "../../tools/feature-docs/extractScreen.mjs";
// @ts-expect-error
import { parseRoutes } from "../../tools/feature-docs/routes.mjs";
// @ts-expect-error
import { buildRoleDocs, diffDocs, applyMoves, renderMarkdown } from "../../tools/feature-docs/build.mjs";
// @ts-expect-error
import { ROLE_CONFIGS } from "../../tools/feature-docs/config.mjs";
// @ts-expect-error
import { planSync, runSync, toRow } from "../../tools/feature-docs/sync.mjs";

const REAL_ROOT = path.resolve(__dirname, "../..");

// ───────────────────────────── extractor ─────────────────────────────
describe("extractScreenFacts - reads facts, never guesses", () => {
  const tsx = (body: string) => `import React from "react";\n${body}`;

  it("finds tabs, buttons, headings, field labels, placeholders and empty-state messages", () => {
    const f = extractScreenFacts(
      tsx(`export default () => (<div>
        <h1>My Doubts</h1>
        <Tabs><TabsList><TabsTrigger value="a">Open</TabsTrigger><TabsTrigger value="b">Resolved</TabsTrigger></TabsList></Tabs>
        <Button>Ask a doubt</Button>
        <Label>Subject</Label>
        <Input placeholder="Search doubts" />
        <p>You haven't asked any doubts yet.</p>
      </div>)`),
    );
    expect(f.headings).toContain("My Doubts");
    expect(f.tabs).toEqual(["Open", "Resolved"]);
    expect(f.buttons).toContain("Ask a doubt");
    expect(f.inputs).toEqual(expect.arrayContaining(["Subject", "Search doubts"]));
    expect(f.messages).toContain("You haven't asked any doubts yet.");
  });

  it("splits a conditional label into separate buttons", () => {
    const f = extractScreenFacts(tsx(`export default () => <Button>{done ? "View result" : "Start"}</Button>`));
    expect(f.buttons).toEqual(["View result", "Start"]);
  });

  it("drops sentences that are broken up by run-time values (an incomplete sentence is worse than none)", () => {
    const f = extractScreenFacts(tsx(`export default () => (<div><p className="text-muted-foreground">You have {count} items waiting for review in your queue.</p><CardTitle>Total {n}</CardTitle></div>)`));
    expect(f.descriptions).toEqual([]);
    expect(f.headings).toEqual([]);
  });

  it("ignores generic buttons and loading text", () => {
    const f = extractScreenFacts(tsx(`export default () => (<div><Button>Cancel</Button><Button>Close</Button><Button>Loading…</Button><Button>Save plan</Button></div>)`));
    expect(f.buttons).toEqual(["Save plan"]);
  });

  it("never keeps personal data: emails, phone-like numbers, ids and links", () => {
    for (const bad of ["Mail teacher@school.edu", "Call 9876543210 now", "id 123e4567-e89b-12d3-a456-426614174000", "see https://x.example/y"]) {
      expect(cleanText(bad), bad).toBeNull();
    }
    const f = extractScreenFacts(tsx(`export default () => <div><h2>Contact: priya@school.in</h2><Button>Open results</Button></div>`));
    expect(f.headings).toEqual([]);
    expect(f.buttons).toEqual(["Open results"]);
  });

  it("uses a leading comment only when it describes the screen for a user, not the implementation", () => {
    expect(isDescriptiveComment("The student's assigned papers and mock exams, with status and score.")).toBe(true);
    for (const internal of ["Fetches rows from the student_exams table with RLS and a custom hook.", "TODO: refactor this component later on", "Uses useQuery and the supabase client to render the list."]) {
      expect(isDescriptiveComment(internal), internal).toBe(false);
    }
    const good = extractScreenFacts(`// Shows your assigned papers and mock exams with status and score.\nexport default () => <h1>My Exams</h1>`);
    expect(good.comment).toContain("assigned papers");
    const bad = extractScreenFacts(`// Reads from the exams table through a hook and renders it.\nexport default () => <h1>My Exams</h1>`);
    expect(bad.comment).toBeNull();
  });

  it("records which components the screen renders and which modules it imports", () => {
    const f = extractScreenFacts(`import { Panel } from "@/components/x/Panel";\nimport { helper } from "@/lib/helper";\nexport default () => <Panel />`);
    expect(f.jsxTags).toContain("Panel");
    expect(f.imports.map((i: any) => i.spec)).toEqual(["@/components/x/Panel", "@/lib/helper"]);
  });
});

// ───────────────────────────── fixture project ─────────────────────────────
const APP = (extra = "") => `
import { lazy } from "react";
const Alpha = lazy(() => import("./pages/Alpha"));
const Beta = lazy(() => import("./pages/Beta"));
const TeacherOnly = lazy(() => import("./pages/TeacherOnly"));
export default function App() { return (<Routes>
  <Route path="/alpha" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><Alpha /></RoleGuard></ProtectedRoute>} />
  <Route path="/beta" element={<ProtectedRoute><RoleGuard allowedRoles={["student","parent"]}><Beta /></RoleGuard></ProtectedRoute>} />
  <Route path="/teach" element={<ProtectedRoute><RoleGuard allowedRoles={["teacher"]}><TeacherOnly /></RoleGuard></ProtectedRoute>} />
  ${extra}
</Routes>); }`;

const ALPHA = `// Shows your study streak and lets you set a daily goal.
export default function Alpha() { return (<div>
  <h1>Study Streaks</h1>
  <Tabs><TabsTrigger value="a">This week</TabsTrigger><TabsTrigger value="b">All time</TabsTrigger></Tabs>
  <Button>Set daily goal</Button>
  <Input placeholder="Search streaks" />
</div>); }`;
const BETA = `export default function Beta() { return <h1>Beta Corner</h1>; }`;
const TEACHER = `export default function T() { return <h1>Marks entry</h1>; }`;
const PAGE_HELP = `export const PAGE_HELP = [];`;

function guideSource(entries: unknown[], rows: { name: string; path: string }[]) {
  return `export const STUDENT_FEATURES = ${JSON.stringify(entries)};\nexport const studentMenuRows = () => ${JSON.stringify(rows)};`;
}

let root: string;
const write = (rel: string, text: string) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const cfg = () => ({ role: "student", guide: "guide.ts", guideExport: "STUDENT_FEATURES", menuRowsExport: "studentMenuRows", profileTabsFile: "src/none.tsx", out: "docs/x" });
const gen = (previous: unknown = null, accept: Set<string> | "all" = new Set()) => buildRoleDocs({ root, cfg: cfg(), previous, accept });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "featdocs-"));
  write("src/App.tsx", APP());
  write("src/pages/Alpha.tsx", ALPHA);
  write("src/pages/Beta.tsx", BETA);
  write("src/pages/TeacherOnly.tsx", TEACHER);
  write("src/components/help/pageHelp.ts", PAGE_HELP);
  write("guide.ts", guideSource([], [{ name: "Study Streaks", path: "/alpha" }, { name: "Beta Corner", path: "/beta" }]));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("routes", () => {
  it("maps each route to its page file and the roles the RoleGuard allows", () => {
    const r = parseRoutes(fs.readFileSync(path.join(root, "src/App.tsx"), "utf8"), path.join(root, "src/App.tsx"), root);
    expect(r.get("/alpha").allowedRoles).toEqual(["student"]);
    expect(r.get("/beta").allowedRoles).toEqual(["student", "parent"]);
    expect(r.get("/teach").allowedRoles).toEqual(["teacher"]);
    expect(r.get("/alpha").file).toBe(path.join(root, "src/pages/Alpha.tsx"));
  });
});

// ───────────────────────────── the ten scenarios, on the build side ─────────────────────────────
describe("buildRoleDocs - generating documentation from code", () => {
  it("a NEW feature is documented automatically from its screen, with an honest confidence", async () => {
    const { docs } = await gen();
    const a = docs.find((d: any) => d.key === "nav:/alpha");
    expect(a.confidence).toBe("medium"); // purpose read from the screen comment, 3+ labels
    expect(a.purposeSource).toBe("comment");
    expect(a.purpose).toContain("study streak");
    expect(a.screen.tabs).toEqual(["This week", "All time"]);
    expect(a.screen.buttons).toContain("Set daily goal");
    expect(a.content).toContain("Where: Left menu, Study Streaks.");
    expect(a.content).toContain("Tabs: This week; All time");
    expect(a.needsReview).toBe(false);
  });

  it("INCOMPLETE information is flagged for a developer and the assistant is told not to guess", async () => {
    const { docs } = await gen();
    const b = docs.find((d: any) => d.key === "nav:/beta");
    expect(b.confidence).toBe("low");
    expect(b.needsReview).toBe(true);
    expect(b.reviewReasons.join(" ")).toMatch(/no purpose/);
    expect(b.content).toContain("What it is: (not documented yet)");
    expect(b.content).toContain("do not guess what the feature does");
    expect(b.purpose).toBeNull();
  });

  it("a ROLE-RESTRICTED feature is recorded with who may open it, and teacher pages are not in the student docs", async () => {
    const { docs } = await gen();
    expect(docs.find((d: any) => d.key === "nav:/beta").accessRoles).toEqual(["student", "parent"]);
    expect(docs.some((d: any) => d.name === "Marks entry" || d.key === "nav:/teach")).toBe(false);
  });

  it("MANUAL documentation is preserved and wins over what is extracted", async () => {
    write("guide.ts", guideSource([{ id: "streaks", name: "Study Streaks", routes: ["/alpha"], where: "Left menu, Study Streaks.", keywords: ["streak", "daily streak"], summary: "Keeps count of the days in a row you studied.", howTo: ["Open Study Streaks.", "Press Set daily goal."], notes: ["Missing a day resets it."] }], [{ name: "Study Streaks", path: "/alpha" }]));
    const a = (await gen()).docs.find((d: any) => d.key === "nav:/alpha");
    expect(a.purpose).toBe("Keeps count of the days in a row you studied."); // not the screen comment
    expect(a.purposeSource).toBe("manual");
    expect(a.confidence).toBe("high");
    expect(a.steps).toEqual(["Open Study Streaks.", "Press Set daily goal."]);
    expect(a.notes).toEqual(["Missing a day resets it."]);
    expect(a.aliases).toContain("daily streak"); // multi-word keyword kept as an alias
    expect(a.keywords).toContain("streak");
    expect(a.content).toContain("Buttons: Set daily goal"); // and the real screen labels are added next to it
  });

  it("a manual-only entry (no menu row, e.g. a card) is kept and not lost", async () => {
    write("guide.ts", guideSource([{ id: "card", name: "Progress Card", where: "A card on your Home page.", keywords: ["progress card"], summary: "Shows your progress at a glance." }], []));
    const { docs } = await gen();
    const c = docs.find((d: any) => d.key === "manual:card");
    expect(c.kind).toBe("manual");
    expect(c.confidence).toBe("high");
  });

  it("never lets personal data into the knowledge base, even from a hand-written entry", async () => {
    write("guide.ts", guideSource([{ id: "x", name: "X", routes: ["/alpha"], where: "Left menu.", keywords: [], summary: "Email help@school.edu for access." }], [{ name: "Study Streaks", path: "/alpha" }]));
    await expect(gen()).rejects.toThrow(/personal data or a link/);
  });

  it("output is deterministic (no timestamps), so --check never flaps", async () => {
    const a = JSON.stringify(await gen());
    const b = JSON.stringify(await gen());
    expect(a).toBe(b);
  });
});

describe("diffDocs - detecting change between two generations", () => {
  it("reports an ADDED feature", async () => {
    const before = await gen();
    write("src/pages/Gamma.tsx", `// Practise tables with quick quizzes and track your score.\nexport default () => (<div><h1>Tables Quiz</h1><Button>Start quiz</Button><Button>See score</Button><Tabs><TabsTrigger value="a">Easy</TabsTrigger></Tabs></div>)`);
    write("src/App.tsx", APP(`<Route path="/gamma" element={<ProtectedRoute><RoleGuard allowedRoles={["student"]}><Gamma /></RoleGuard></ProtectedRoute>} />`).replace("const Beta =", `const Gamma = lazy(() => import("./pages/Gamma"));\nconst Beta =`));
    write("guide.ts", guideSource([], [{ name: "Study Streaks", path: "/alpha" }, { name: "Beta Corner", path: "/beta" }, { name: "Tables Quiz", path: "/gamma" }]));
    const after = await gen(before);
    const r = diffDocs(before, after);
    expect(r.added.map((x: any) => x.name)).toEqual(["Tables Quiz"]);
    expect(r.removed).toEqual([]);
    expect(after.docs.find((d: any) => d.key === "nav:/gamma").content).toContain("Start quiz");
  });

  it("reports a MODIFIED feature, and flags the written documentation as possibly out of date", async () => {
    write("guide.ts", guideSource([{ id: "streaks", name: "Study Streaks", routes: ["/alpha"], where: "Left menu, Study Streaks.", keywords: [], summary: "Counts your study days.", howTo: ["Press Set daily goal."] }], [{ name: "Study Streaks", path: "/alpha" }]));
    const before = await gen();
    expect(before.docs.find((d: any) => d.key === "nav:/alpha").needsReview).toBe(false);
    write("src/pages/Alpha.tsx", ALPHA.replace("Set daily goal", "Choose goal")); // a developer renames the button
    const after = await gen(before);
    const r = diffDocs(before, after);
    expect(r.modified).toEqual([{ key: "nav:/alpha", name: "Study Streaks", appChanged: true }]);
    const a = after.docs.find((d: any) => d.key === "nav:/alpha");
    expect(a.needsReview).toBe(true);
    expect(a.reviewReasons.join(" ")).toMatch(/screen changed since this written documentation was last reviewed/);
    expect(a.content).toContain("Choose goal"); // the live screen text is already current
    // the manual text is still served (it is the source of truth), but a developer is told to re-check it
    expect(a.steps).toEqual(["Press Set daily goal."]);
  });

  it("accepting a reviewed doc clears the flag, and a no-op regeneration reports no changes", async () => {
    write("guide.ts", guideSource([{ id: "streaks", name: "Study Streaks", routes: ["/alpha"], where: "Left menu, Study Streaks.", keywords: [], summary: "Counts your study days." }], [{ name: "Study Streaks", path: "/alpha" }]));
    const v1 = await gen();
    write("src/pages/Alpha.tsx", ALPHA.replace("Set daily goal", "Choose goal"));
    const v2 = await gen(v1);
    expect(v2.docs.find((d: any) => d.key === "nav:/alpha").needsReview).toBe(true);
    const v3 = await gen(v2, new Set(["nav:/alpha"]));
    expect(v3.docs.find((d: any) => d.key === "nav:/alpha").needsReview).toBe(false);
    const v4 = await gen(v3);
    const r = diffDocs(v3, v4);
    expect([r.added, r.removed, r.renamed, r.modified]).toEqual([[], [], [], []]);
  });

  it("reports a REMOVED feature", async () => {
    const before = await gen();
    write("guide.ts", guideSource([], [{ name: "Study Streaks", path: "/alpha" }])); // Beta Corner leaves the menu
    const after = await gen(before);
    const r = diffDocs(before, after);
    expect(r.removed).toEqual([{ key: "nav:/beta", name: "Beta Corner" }]);
    expect(after.docs.some((d: any) => d.key === "nav:/beta")).toBe(false);
  });

  it("reports a RENAMED / MOVED feature and keeps the old name as an alias so students are still understood", async () => {
    const before = await gen();
    write("src/App.tsx", APP().replace('path="/alpha"', 'path="/streak-hub"'));
    write("guide.ts", guideSource([], [{ name: "Streak Hub", path: "/streak-hub" }, { name: "Beta Corner", path: "/beta" }]));
    const after = await gen(before);
    const r = diffDocs(before, after);
    applyMoves(before, after, r);
    expect(r.renamed).toEqual([{ key: "nav:/streak-hub", from: "Study Streaks", to: "Streak Hub", oldKey: "nav:/alpha" }]);
    expect(r.added.map((x: any) => x.name)).not.toContain("Streak Hub");
    expect(r.removed.map((x: any) => x.name)).not.toContain("Study Streaks");
    expect(after.docs.find((d: any) => d.key === "nav:/streak-hub").aliases).toContain("Study Streaks");
  });

  it("a same-route rename keeps the previous name too", async () => {
    const before = await gen();
    write("guide.ts", guideSource([], [{ name: "Streak Tracker", path: "/alpha" }, { name: "Beta Corner", path: "/beta" }]));
    const after = await gen(before);
    const r = diffDocs(before, after);
    expect(r.renamed).toEqual([{ key: "nav:/alpha", from: "Study Streaks", to: "Streak Tracker" }]);
    expect(after.docs.find((d: any) => d.key === "nav:/alpha").aliases).toContain("Study Streaks");
  });

  it("lists everything that needs a developer in needsReview", async () => {
    const r = diffDocs(null, await gen());
    expect(r.needsReview.map((x: any) => x.name)).toEqual(["Beta Corner"]);
  });

  it("renders a readable Markdown file with the review list at the top", async () => {
    const set = await gen();
    const md = renderMarkdown(set, diffDocs(null, set));
    expect(md).toMatch(/## Needs developer review[\s\S]*Beta Corner/);
    expect(md).toContain("### Study Streaks");
    expect(md).toContain("GENERATED");
  });
});

// ───────────────────────────── real project ─────────────────────────────
describe("the committed knowledge base matches the real application", () => {
  const cfgReal = ROLE_CONFIGS.student;
  const committed = JSON.parse(fs.readFileSync(path.join(REAL_ROOT, `${cfgReal.out}.features.json`), "utf8"));

  it("is up to date with the code (run `npm run features:generate` if this fails)", async () => {
    const fresh = await buildRoleDocs({ root: REAL_ROOT, cfg: cfgReal, previous: committed });
    const stale = diffDocs(committed, fresh);
    expect({ added: stale.added, removed: stale.removed, renamed: stale.renamed, modified: stale.modified }).toEqual({ added: [], removed: [], renamed: [], modified: [] });
    expect(JSON.stringify(fresh, null, 2) + "\n").toBe(fs.readFileSync(path.join(REAL_ROOT, `${cfgReal.out}.features.json`), "utf8"));
  }, 60000);

  it("has a document for every page in the student menu, and for the hand-written non-menu features", () => {
    const keys = new Set(committed.docs.map((d: any) => d.key));
    for (const k of ["nav:/student-dashboard", "nav:/adaptive-test", "nav:/daily-review", "nav:/forgetting-forecast", "nav:/my-mastery", "nav:/ai-tutor"]) expect(keys.has(k), k).toBe(true);
    for (const k of ["manual:engagement-score", "manual:ask-apas"]) expect(keys.has(k), k).toBe(true);
    expect(committed.docs.some((d: any) => d.key.startsWith("tab:student-profile/"))).toBe(true);
  });

  it("contains no personal data, links or internal identifiers", () => {
    for (const d of committed.docs) {
      const all = `${d.content}\n${d.searchText}`;
      expect(all, d.key).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      expect(all, d.key).not.toMatch(/\d{7,}/);
      expect(all, d.key).not.toMatch(/https?:\/\//);
      expect(all, d.key).not.toMatch(/\b(supabase|service_role|api[_ ]key|secret)\b/i);
    }
  });

  it("only documents features for the student role", () => {
    expect(new Set(committed.docs.map((d: any) => d.role))).toEqual(new Set(["student"]));
    for (const d of committed.docs.filter((x: any) => x.accessRoles)) expect(d.accessRoles, d.key).toContain("student");
  });

  it("every document is complete enough to hand to the assistant", () => {
    for (const d of committed.docs) {
      expect(d.name.length, d.key).toBeGreaterThan(1);
      expect(d.content, d.key).toContain(`Where: `);
      expect(d.contentHash, d.key).toMatch(/^[0-9a-f]{16}$/);
      expect(["high", "medium", "low"]).toContain(d.confidence);
    }
  });

  it("the page-help registry is picked up as a high-confidence source", () => {
    const withHelp = committed.docs.filter((d: any) => d.docOrigin.includes("help"));
    expect(withHelp.length).toBeGreaterThan(5);
  });
});

// ───────────────────────────── sync ─────────────────────────────
const doc = (key: string, hash: string, extra: any = {}) => ({
  key, name: key, aliases: [], keywords: [], route: null, kind: "page", content: "c", searchText: key, confidence: "high", needsReview: false, contentHash: hash, ...extra,
});

describe("planSync - what gets written", () => {
  const MODEL = "m1";
  it("writes new and changed docs, skips unchanged ones, retires removed ones", () => {
    const existing = new Map<string, any>([
      ["a", { content_hash: "1", status: "active", embedding_model: MODEL }],
      ["b", { content_hash: "OLD", status: "active", embedding_model: MODEL }],
      ["gone", { content_hash: "9", status: "active", embedding_model: MODEL }],
      ["alreadyGone", { content_hash: "9", status: "removed", embedding_model: MODEL }],
    ]);
    const p = planSync([doc("a", "1"), doc("b", "2"), doc("c", "3")], existing, { model: MODEL });
    expect(p.upsert.map((u: any) => [u.doc.key, u.why])).toEqual([["b", "changed"], ["c", "new"]]);
    expect(p.retire).toEqual(["gone"]);
    expect(p.unchanged).toBe(1);
  });

  it("re-embeds an unchanged doc when the embedding model changed or the vector is missing", () => {
    const existing = new Map<string, any>([["a", { content_hash: "1", status: "active", embedding_model: null }], ["b", { content_hash: "2", status: "active", embedding_model: "old" }]]);
    const p = planSync([doc("a", "1"), doc("b", "2")], existing, { model: "new" });
    expect(p.upsert.map((u: any) => u.why)).toEqual(["embedding", "embedding"]);
    expect(planSync([doc("a", "1")], existing, { model: "new", embed: false }).upsert).toEqual([]); // --no-embed
  });

  it("brings back a feature that was retired and then returned", () => {
    const existing = new Map<string, any>([["a", { content_hash: "1", status: "removed", embedding_model: "m" }]]);
    expect(planSync([doc("a", "1")], existing, { model: "m" }).upsert[0].why).toBe("changed");
  });
});

function fakeSupabase(existingRows: any[]) {
  const calls: any = { upserts: [], updates: [] };
  const client = {
    calls,
    from: () => ({
      select: () => ({ eq: async () => ({ data: existingRows, error: null }) }),
      upsert: async (rows: any[], opts: any) => { calls.upserts.push({ rows, opts }); return { error: null }; },
      update: (patch: any) => ({ eq: () => ({ in: async (_c: string, keys: string[]) => { calls.updates.push({ patch, keys }); return { error: null }; } }) }),
    }),
  };
  return client;
}
const pg = (v: number[]) => `[${v.join(",")}]`;

describe("runSync - writing to the database", () => {
  it("embeds and upserts changed docs; retires removed ones; leaves unchanged alone", async () => {
    const db = fakeSupabase([{ feature_key: "keep", content_hash: "1", status: "active", embedding_model: "m" }, { feature_key: "gone", content_hash: "5", status: "active", embedding_model: "m" }]);
    const s = await runSync({
      supabase: db, role: "student", model: "m", toPgVector: pg,
      docs: [doc("keep", "1"), doc("new", "2")],
      embedBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2]),
    });
    expect(s).toMatchObject({ upserted: 1, embedded: 1, embeddingPending: 0, retired: 1, unchanged: 1 });
    const row = db.calls.upserts[0].rows[0];
    expect(db.calls.upserts[0].opts).toEqual({ onConflict: "role,feature_key" });
    expect(row).toMatchObject({ role: "student", feature_key: "new", status: "active", embedding: "[0.1,0.2]", embedding_model: "m", content_hash: "2", removed_at: null });
    expect(db.calls.updates[0].keys).toEqual(["gone"]);
    expect(db.calls.updates[0].patch.status).toBe("removed");
  });

  it("if embedding fails, the doc is still written as text (found by name) and any stale vector is cleared", async () => {
    const db = fakeSupabase([{ feature_key: "a", content_hash: "OLD", status: "active", embedding_model: "m" }]);
    const s = await runSync({ supabase: db, role: "student", model: "m", toPgVector: pg, docs: [doc("a", "NEW")], embedBatch: async (t: string[]) => t.map(() => null) });
    expect(s).toMatchObject({ upserted: 1, embedded: 0, embeddingPending: 1 });
    expect(db.calls.upserts[0].rows[0]).toMatchObject({ embedding: null, embedding_model: null, content_hash: "NEW" });
  });

  it("a dry run writes nothing", async () => {
    const db = fakeSupabase([]);
    const s = await runSync({ supabase: db, role: "student", model: "m", toPgVector: pg, docs: [doc("a", "1")], embedBatch: async () => { throw new Error("must not embed"); }, dryRun: true });
    expect(s.plan.upsert).toHaveLength(1);
    expect(db.calls.upserts).toEqual([]);
    expect(db.calls.updates).toEqual([]);
  });

  it("a missing table gives a clear error instead of a silent no-op", async () => {
    const broken = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "relation does not exist" } }) }) }) };
    await expect(runSync({ supabase: broken, role: "student", model: "m", toPgVector: pg, docs: [], embedBatch: async () => [] })).rejects.toThrow(/migration applied/);
  });

  it("toRow carries exactly the columns the table has", () => {
    const cols = Object.keys(toRow(doc("a", "1"), "student", null, "m", pg)).sort();
    const sql = fs.readFileSync(path.join(REAL_ROOT, "supabase/migrations/20261118000000_app_feature_knowledge_base.sql"), "utf8");
    for (const c of cols) expect(sql, c).toMatch(new RegExp(`\\b${c}\\b`));
  });
});
