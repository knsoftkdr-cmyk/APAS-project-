import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  retrieveFeatureKnowledge,
  classifyMatch,
  rewriteQuery,
  wordCoverage,
  nameIsInQuestion,
  buildKnowledgePrompt,
  clearFeatureNamesCache,
  DEFAULT_THRESHOLDS,
  type FeatureHit,
} from "../../supabase/functions/_shared/featureRetrieval";
import { embedText, embedBatch, normalizeVector, toPgVector, buildEmbedBody, EMBED_DIMS, EMBED_MODEL } from "../../supabase/functions/_shared/featureEmbeddings";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const hit = (name: string, o: Partial<FeatureHit> = {}): FeatureHit => ({
  feature_key: `nav:/${name.toLowerCase().replace(/ /g, "-")}`, name, aliases: [], route: null, kind: "page",
  content: `${name}\nWhere: Left menu, ${name}.\nWhat it is: about ${name}.`, confidence: "high", needs_review: false,
  name_score: 0, text_score: 0, vector_score: null, score: 0.03, ...o,
});

const NAMES = ["Adaptive Test", "Daily Review", "Flashcards", "Forgetting Forecast", "Learning Path", "My Doubts", "Timetable"];

function fakeDb(o: { names?: string[]; hits?: FeatureHit[] | ((a: any) => FeatureHit[]); rpcError?: string; namesError?: string } = {}) {
  const rpcCalls: any[] = [];
  const nameQueries: any[] = [];
  return {
    rpcCalls, nameQueries,
    from: (table: string) => ({
      select: () => ({
        eq: (c1: string, v1: string) => ({
          eq: (c2: string, v2: string) => {
            nameQueries.push({ table, [c1]: v1, [c2]: v2 });
            return Promise.resolve({ data: o.namesError ? null : (o.names ?? NAMES).map((name) => ({ name })), error: o.namesError ? { message: o.namesError } : null });
          },
        }),
      }),
    }),
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      if (o.rpcError) return { data: null, error: { message: o.rpcError } };
      return { data: typeof o.hits === "function" ? o.hits(args) : o.hits ?? [], error: null };
    },
  };
}

beforeEach(() => clearFeatureNamesCache());

// ───────────────────────────── matching a name inside a question ─────────────────────────────
describe("wordCoverage / nameIsInQuestion - a name must really be in the question", () => {
  it("accepts the whole name, with small typos in longer words", () => {
    expect(wordCoverage("Adaptive Test", "what is the adaptive test")).toBe(1);
    expect(wordCoverage("Adaptive Test", "how do i use the adaptiv test")).toBe(1);
    expect(wordCoverage("Daily Review", "what is daily reveiw")).toBe(1); // swapped letters
    expect(wordCoverage("Forgetting Forecast", "the forgeting forcast")).toBe(1);
  });
  it("rejects a partly similar name (the false positive found on real data)", () => {
    expect(wordCoverage("study path", "what is the quantum study portal")).toBe(0.5);
    expect(wordCoverage("Learning Twin", "how do i use the learning path")).toBe(0.5);
  });
  it("short words must match exactly, and the profile-tab suffix is ignored", () => {
    expect(wordCoverage("Home", "what is homework")).toBe(0);
    expect(wordCoverage("Learning Twin (profile tab)", "what is the learning twin")).toBe(1);
  });
  it("an alias counts as the name", () => {
    expect(nameIsInQuestion(hit("Forgetting Forecast", { aliases: ["forgetting curve"] }), "what is the forgetting curve")).toBe(true);
    expect(nameIsInQuestion(hit("Learning Path", { aliases: ["study path"] }), "what is the quantum study portal")).toBe(false);
  });
});

describe("classifyMatch", () => {
  const T = DEFAULT_THRESHOLDS;
  it("STRONG when the question contains the name; only that feature is chosen", () => {
    const r = classifyMatch([hit("Adaptive Test", { name_score: 1 }), hit("Gamification", { name_score: 0.7, aliases: ["adaptive round"] })], "what is the adaptive test", T);
    expect(r.level).toBe("strong");
    expect(r.chosen.map((h) => h.name)).toEqual(["Adaptive Test"]);
  });
  it("STRONG by meaning when the vector similarity is high and no name was used", () => {
    const r = classifyMatch([hit("Daily Review", { vector_score: 0.82 })], "something to help me remember before exams", T);
    expect(r).toMatchObject({ level: "strong" });
  });
  it("WEAK for a partial name or a moderate meaning match: offered as 'maybe'", () => {
    expect(classifyMatch([hit("Learning Path", { name_score: 0.7, aliases: ["study path"] })], "what is the quantum study portal", T).level).toBe("weak");
    expect(classifyMatch([hit("Daily Review", { vector_score: 0.6 })], "how do i revise", T).level).toBe("weak");
  });
  it("NONE when nothing is credible, so the assistant must not guess", () => {
    expect(classifyMatch([hit("Study Buddy", { name_score: 0.1, text_score: 0.4 })], "explain photosynthesis", T).level).toBe("none");
    expect(classifyMatch([], "anything", T).level).toBe("none");
  });
});

// ───────────────────────────── follow-ups ─────────────────────────────
describe("rewriteQuery - follow-up questions", () => {
  const history = [{ role: "user", text: "What is Daily Review?" }, { role: "assistant", text: "Daily Review is a short set of questions each day." }];
  it("adds the feature named in the last turns to a short follow-up", () => {
    expect(rewriteQuery("how do I use it?", history, NAMES)).toContain("Daily Review");
    expect(rewriteQuery("and what are the steps", history, NAMES)).toContain("Daily Review");
    expect(rewriteQuery("tell me more", history, NAMES)).toContain("Daily Review");
  });
  it("a new, self-contained question is left alone (the old topic must not leak in)", () => {
    expect(rewriteQuery("what is the forgetting forecast and how does it work", history, NAMES)).toBe("what is the forgetting forecast and how does it work");
  });
  it("falls back to the last user message when no known name was mentioned", () => {
    const h = [{ role: "user", text: "tell me about the thing with the streaks" }, { role: "assistant", text: "Sure." }];
    expect(rewriteQuery("how do I use it", h, NAMES)).toContain("streaks");
  });
  it("without history, nothing changes", () => {
    expect(rewriteQuery("how do I use it?", [], NAMES)).toBe("how do I use it?");
  });
});

// ───────────────────────────── the ten scenarios ─────────────────────────────
describe("retrieveFeatureKnowledge - scenarios", () => {
  it("1. an EXISTING feature: only its documentation is sent, plus the names list", async () => {
    const db = fakeDb({ hits: [hit("Timetable", { name_score: 1 })] });
    const r = await retrieveFeatureKnowledge({ supabase: db, role: "student", message: "where is my timetable" });
    expect(r).toMatchObject({ usable: true, level: "strong", matched: ["Timetable"] });
    expect(r.section).toContain("FULL DETAILS");
    expect(r.section).toContain("Where: Left menu, Timetable.");
    expect(r.section).toContain("Features: Adaptive Test; Daily Review;"); // names only, not every document
    expect(r.section).not.toContain("about Daily Review"); // other features' documentation is NOT sent
  });

  it("2. a NEWLY ADDED feature is found as soon as it is in the knowledge base (no code change)", async () => {
    const names = [...NAMES, "AI Career Guidance"];
    const db = fakeDb({ names, hits: [hit("AI Career Guidance", { name_score: 1, content: "AI Career Guidance\nWhere: Left menu, AI Career Guidance.\nWhat it is: explores careers that suit you." })] });
    const r = await retrieveFeatureKnowledge({ supabase: db, role: "student", message: "What is AI Career Guidance?" });
    expect(r.level).toBe("strong");
    expect(r.section).toContain("explores careers that suit you");
    expect(r.section).toContain("AI Career Guidance;");
  });

  it("3. a NAVIGATION question gets the 'Where:' line of the right feature", async () => {
    const db = fakeDb({ hits: [hit("Forgetting Forecast", { name_score: 1 })] });
    const r = await retrieveFeatureKnowledge({ supabase: db, role: "student", message: "how can I access the forgetting forecast" });
    expect(r.section).toContain("Where: Left menu, Forgetting Forecast.");
  });

  it("4. a MISSPELT name is still understood; a worse misspelling is offered as a maybe, not asserted", async () => {
    const db = fakeDb({ hits: [hit("Adaptive Test", { name_score: 0.8 })] });
    expect((await retrieveFeatureKnowledge({ supabase: db, role: "student", message: "how do i use the adaptiv test" })).level).toBe("strong");
    clearFeatureNamesCache();
    const r = await retrieveFeatureKnowledge({ supabase: db, role: "student", message: "how do i use the adaptve tst" });
    expect(r.level).toBe("weak");
    expect(r.section).toContain("POSSIBLY RELEVANT");
    expect(r.section).toContain("ask");
  });

  it("5. a FOLLOW-UP question is searched with the feature from the conversation", async () => {
    const db = fakeDb({ hits: [hit("Flashcards", { name_score: 1 })] });
    await retrieveFeatureKnowledge({
      supabase: db, role: "student", message: "how do I use it?",
      history: [{ role: "user", text: "what are flashcards" }, { role: "assistant", text: "Flashcards are quick revision cards." }],
    });
    expect(db.rpcCalls[0].args.p_query).toContain("Flashcards");
  });

  it("6. a MODIFIED feature: the new documentation is used immediately (documents are never cached, only names)", async () => {
    let content = "Daily Review\nWhat it is: the OLD description.";
    const db = fakeDb({ hits: () => [hit("Daily Review", { name_score: 1, content })] });
    expect((await retrieveFeatureKnowledge({ supabase: db, role: "student", message: "what is daily review" })).section).toContain("OLD description");
    content = "Daily Review\nWhat it is: the NEW description.";
    expect((await retrieveFeatureKnowledge({ supabase: db, role: "student", message: "what is daily review" })).section).toContain("NEW description");
  });

  it("7. a REMOVED feature disappears from the names list once the cache expires, and is never explained", async () => {
    const withOld = fakeDb({ names: [...NAMES, "Old Thing"], hits: [] });
    const t0 = 1_000_000;
    expect((await retrieveFeatureKnowledge({ supabase: withOld, role: "student", message: "hello", now: t0 })).section).toContain("Old Thing");
    const without = fakeDb({ names: NAMES, hits: [] }); // the sync marked it removed
    expect((await retrieveFeatureKnowledge({ supabase: without, role: "student", message: "what is old thing", now: t0 + 60_000 })).section).toContain("Old Thing"); // cached for a few minutes
    const r = await retrieveFeatureKnowledge({ supabase: without, role: "student", message: "what is old thing", now: t0 + 6 * 60_000 });
    expect(r.section).not.toContain("Old Thing");
    expect(r.level).toBe("none");
    expect(r.section).toContain("don't have details");
  });

  it("8. ROLE: the role is passed from the server and filters both queries; nothing from the user decides it", async () => {
    const db = fakeDb({ hits: [hit("Timetable", { name_score: 1 })] });
    await retrieveFeatureKnowledge({ supabase: db, role: "student", message: "where is my timetable" });
    expect(db.nameQueries[0]).toMatchObject({ table: "app_feature_docs", role: "student", status: "active" });
    expect(db.rpcCalls.every((c) => c.fn === "match_feature_docs" && c.args.p_role === "student")).toBe(true);
    // roles have separate caches: a teacher's list never serves a student
    const t = fakeDb({ names: ["Gradebook"], hits: [] });
    expect((await retrieveFeatureKnowledge({ supabase: t, role: "teacher", message: "hello" })).section).toContain("Gradebook");
    expect((await retrieveFeatureKnowledge({ supabase: db, role: "student", message: "hello" })).section).not.toContain("Gradebook");
  });

  it("9. INCOMPLETE documentation is passed on with its warning, so the assistant does not fill the gap", async () => {
    const low = hit("Brain Gym", {
      name_score: 1, confidence: "low", needs_review: true,
      content: "Brain Gym\nWhere: Left menu, Brain Gym.\nWhat it is: (not documented yet)\nDocumentation status: incomplete. Only the screen text above is known. Say what is visible there, and do not guess what the feature does beyond it.",
    });
    const r = await retrieveFeatureKnowledge({ supabase: fakeDb({ names: [...NAMES, "Brain Gym"], hits: [low] }), role: "student", message: "what is brain gym" });
    expect(r.level).toBe("strong");
    expect(r.section).toContain("do not guess what the feature does beyond it");
  });

  it("10a. when NOTHING relevant is found, the assistant is told to say so and not to invent a feature", async () => {
    const r = await retrieveFeatureKnowledge({ supabase: fakeDb({ hits: [] }), role: "student", message: "what is the quantum study portal" });
    expect(r).toMatchObject({ usable: true, level: "none", matched: [] });
    expect(r.section).toContain("No feature in this guide matched");
    expect(r.section).toContain("Do not guess or invent a feature");
    expect(r.section).toContain("ignore this note"); // own-records / school-topic questions are not blocked by it
  });

  it("10b. embeddings unavailable: text search still answers (the embedding failing must not matter)", async () => {
    const db = fakeDb({ hits: [hit("Daily Review", { name_score: 0.7 })] });
    const r = await retrieveFeatureKnowledge({ supabase: db, role: "student", message: "daily review please", embed: async () => { throw new Error("embedding service down"); } });
    expect(r.usable).toBe(true);
    expect(db.rpcCalls.every((c) => c.args.p_embedding === null)).toBe(true);
  });

  it("10c. database error or empty knowledge base: reported as not usable, so the caller falls back to the built-in guide", async () => {
    expect(await retrieveFeatureKnowledge({ supabase: fakeDb({ rpcError: "function does not exist" }), role: "student", message: "x y z" })).toMatchObject({ usable: false, section: null });
    clearFeatureNamesCache();
    expect(await retrieveFeatureKnowledge({ supabase: fakeDb({ namesError: "relation app_feature_docs does not exist" }), role: "student", message: "x" })).toMatchObject({ usable: false });
    clearFeatureNamesCache();
    expect(await retrieveFeatureKnowledge({ supabase: fakeDb({ names: [] }), role: "student", message: "x" })).toMatchObject({ usable: false, reason: expect.stringContaining("empty") });
  });

  it("never throws, whatever the database does", async () => {
    const exploding = { from: () => { throw new Error("boom"); }, rpc: () => { throw new Error("boom"); } };
    await expect(retrieveFeatureKnowledge({ supabase: exploding, role: "student", message: "x" })).resolves.toMatchObject({ usable: false });
  });
});

describe("retrieveFeatureKnowledge - cost control", () => {
  it("an exact name needs one database call and ignores the embedding", async () => {
    const db = fakeDb({ hits: [hit("Timetable", { name_score: 1 })] });
    await retrieveFeatureKnowledge({ supabase: db, role: "student", message: "what is the timetable", embed: async () => [0.1, 0.2] });
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.rpcCalls[0].args.p_embedding).toBeNull();
  });
  it("without an exact name, the question's embedding is used for a second, meaning-based search", async () => {
    const db = fakeDb({ hits: (a: any) => (a.p_embedding ? [hit("Daily Review", { vector_score: 0.8 })] : []) });
    const r = await retrieveFeatureKnowledge({ supabase: db, role: "student", message: "something to help me remember before exams", embed: async () => [0.5, 0.5] });
    expect(db.rpcCalls).toHaveLength(2);
    expect(db.rpcCalls[1].args.p_embedding).toBe("[0.5,0.5]");
    expect(r).toMatchObject({ level: "strong", matched: ["Daily Review"] });
  });
  it("the prompt never carries more than 3 documents, each clipped", () => {
    const many = Array.from({ length: 6 }, (_, i) => hit(`F${i}`, { name_score: 1, content: "x".repeat(5000) }));
    const { chosen } = classifyMatch(many, "f0 f1 f2 f3 f4 f5", DEFAULT_THRESHOLDS);
    expect(chosen.length).toBeLessThanOrEqual(3);
    expect(buildKnowledgePrompt(NAMES, "strong", chosen).length).toBeLessThan(3 * 1810 + 1000);
  });
});

// ───────────────────────────── embeddings ─────────────────────────────
describe("Gemini embeddings helper", () => {
  const vec = (n: number, v = 1) => Array.from({ length: n }, () => v);
  const okResponse = (values: number[]) => new Response(JSON.stringify({ embedding: { values } }), { status: 200 });

  it("normalises to unit length and renders a pgvector literal", () => {
    const n = normalizeVector([3, 4]);
    expect(n[0]).toBeCloseTo(0.6);
    expect(Math.hypot(...n)).toBeCloseTo(1);
    expect(normalizeVector([0, 0])).toEqual([0, 0]);
    expect(toPgVector([0.5, 1])).toBe("[0.5,1]");
  });

  it("asks for the model and dimension the database column expects", () => {
    expect(EMBED_DIMS).toBe(768);
    expect(read("supabase/migrations/20261118000000_app_feature_knowledge_base.sql")).toContain(`vector(${EMBED_DIMS})`);
    const b = buildEmbedBody("hello", "RETRIEVAL_QUERY", EMBED_MODEL, EMBED_DIMS);
    expect(b).toMatchObject({ model: `models/${EMBED_MODEL}`, taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 });
  });

  it("sends the key in a header, never in the URL", async () => {
    let seen: any;
    await embedText("hi", ["SECRET-KEY"], { taskType: "RETRIEVAL_QUERY", fetchImpl: (async (url: string, init: any) => { seen = { url, init }; return okResponse(vec(EMBED_DIMS)); }) as any });
    expect(seen.url).not.toContain("SECRET-KEY");
    expect(seen.url).toContain(":embedContent");
    expect(seen.init.headers["x-goog-api-key"]).toBe("SECRET-KEY");
  });

  it("returns a unit vector on success", async () => {
    const v = await embedText("hi", ["k"], { taskType: "RETRIEVAL_QUERY", fetchImpl: (async () => okResponse(vec(EMBED_DIMS, 2))) as any });
    expect(v).toHaveLength(EMBED_DIMS);
    expect(Math.hypot(...(v as number[]))).toBeCloseTo(1);
  });

  it("rotates to the next key when one is rate-limited", async () => {
    const used: string[] = [];
    const v = await embedText("hi", ["k1", "k2"], {
      taskType: "RETRIEVAL_QUERY",
      fetchImpl: (async (_u: string, init: any) => { used.push(init.headers["x-goog-api-key"]); return used.length === 1 ? new Response("", { status: 429 }) : okResponse(vec(EMBED_DIMS)); }) as any,
    });
    expect(used).toEqual(["k1", "k2"]);
    expect(v).not.toBeNull();
  });

  it("returns null (never throws) on errors, timeouts, empty input, no keys or a wrong-sized vector", async () => {
    const o = { taskType: "RETRIEVAL_QUERY" as const };
    expect(await embedText("hi", ["k"], { ...o, fetchImpl: (async () => new Response("bad", { status: 400 })) as any })).toBeNull();
    expect(await embedText("hi", ["k"], { ...o, fetchImpl: (async () => { throw new Error("network"); }) as any })).toBeNull();
    expect(await embedText("hi", ["k"], { ...o, timeoutMs: 5, fetchImpl: ((_u: string, init: any) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))))) as any })).toBeNull();
    expect(await embedText("   ", ["k"], o)).toBeNull();
    expect(await embedText("hi", [], o)).toBeNull();
    expect(await embedText("hi", ["k"], { ...o, fetchImpl: (async () => okResponse(vec(10))) as any })).toBeNull();
  });

  it("batch: one entry per text, null where a vector was missing, split into chunks", async () => {
    let calls = 0;
    const out = await embedBatch(["a", "b", "c"], ["k"], {
      taskType: "RETRIEVAL_DOCUMENT", batchSize: 2,
      fetchImpl: (async (url: string, init: any) => {
        calls++;
        expect(url).toContain(":batchEmbedContents");
        const n = JSON.parse(init.body).requests.length;
        return new Response(JSON.stringify({ embeddings: Array.from({ length: n }, (_, i) => ({ values: calls === 1 && i === 1 ? [1] : vec(EMBED_DIMS) })) }), { status: 200 });
      }) as any,
    });
    expect(calls).toBe(2);
    expect(out.map((v) => v !== null)).toEqual([true, false, true]);
  });
});

// ───────────────────────────── how the edge function uses it ─────────────────────────────
describe("student-self-assistant wiring", () => {
  const src = read("supabase/functions/student-self-assistant/index.ts");

  it("uses the knowledge base first and the built-in guide as the fallback", () => {
    expect(src).toContain('from "../_shared/featureRetrieval.ts"');
    expect(src).toContain('from "../_shared/featureEmbeddings.ts"');
    expect(src).toContain("async function getFeatureSection");
    expect(src).toMatch(/return buildFeatureGuidePrompt\(message, recentHistory\);\s*\}/);
    expect(src).toContain("${featureSection}");
  });

  it("takes the role from the verified profile, never from the request", () => {
    const fn = src.slice(src.indexOf("async function getFeatureSection"), src.indexOf("async function callGemini"));
    expect(fn).toContain('role: "student"');
    expect(fn).not.toMatch(/req\.|body\.|\.json\(\)/);
    expect(src).toMatch(/profile\??\.role/);
  });

  it("falls back when retrieval is slow, fails, or finds nothing for something the built-in guide knows", () => {
    expect(src).toContain("setTimeout(() => resolve(null), 4500)");
    expect(src).toContain('kb.level === "none" && builtInKnows');
  });

  it("logs only the outcome (source, level, matched feature names), never the student's message or any key", () => {
    const logs = src.match(/console\.log\("\[student-self-assistant\] feature-kb"[^\n]*/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      const payload = l.match(/JSON\.stringify\(\{(.*)\}\)\);?\s*$/)?.[1] ?? "";
      const keys = [...payload.matchAll(/(?:^|,\s*)(\w+):/g)].map((m) => m[1]);
      expect(keys.length, l).toBeGreaterThan(0);
      for (const k of keys) expect(["source", "level", "matched", "reason"], `${k} in: ${l}`).toContain(k);
      expect(l).not.toMatch(/\b(keys|history|context|recentHistory)\b/);
    }
    expect(src).toContain('.slice(0, 120)'); // a logged error is capped
  });

  it("keeps the existing student-data answers and rules in place", () => {
    for (const must of ["SECURITY:", "CURRENT DATA", "EXPLAIN THE APAS APP ITSELF", "LAYOUT FOR EXPLAINING A FEATURE", "details not written yet", "attendance", "timetable"]) {
      expect(src.toLowerCase(), must).toContain(must.toLowerCase());
    }
  });
});

describe("migration - security properties", () => {
  const sql = read("supabase/migrations/20261118000000_app_feature_knowledge_base.sql");
  it("turns on row-level security and scopes reads to the caller's own role", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("role = public.get_user_role(auth.uid())");
    expect(sql).toMatch(/USING \(status = 'active' AND role = public\.get_user_role/);
  });
  it("gives signed-in users no write access and anonymous users no access", () => {
    expect(sql).toContain("REVOKE ALL ON public.app_feature_docs FROM anon");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_feature_docs FROM authenticated");
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE)\s+TO authenticated/i);
    expect(sql).toMatch(/FOR ALL\s+TO service_role/);
  });
  it("search runs as the caller (so row-level security applies) and cannot be called anonymously", () => {
    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).not.toMatch(/SECURITY DEFINER/);
    expect(sql).toContain("FROM PUBLIC, anon");
  });
  it("does not store any student data", () => {
    expect(sql).not.toMatch(/student_id|user_id|profiles\(|REFERENCES/i);
  });
  it("is safe to run more than once", () => {
    expect(sql).toContain("IF NOT EXISTS");
    expect(sql).toContain("DROP POLICY IF EXISTS");
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.match_feature_docs");
  });
});
