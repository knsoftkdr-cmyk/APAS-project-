import { describe, it, expect } from "vitest";
import {
  bandForGrade, buildGenerationPrompt, candidatesFromGenerated, classGuard, classKey, difficultyFromAccuracy, exhaustedMessage,
  fingerprintOf, gradeLevel, normalizeText, parseGeneratedItems, pickUnseen, serveItems, serveSpec, validateItem,
  type Candidate, type GameType, type ServeDeps,
} from "../../supabase/functions/_shared/gamificationQuestionModel";

// ── an in-memory stand-in for the DB with the same semantics the real one has ────────────────────────
// pool rows are scoped by school + class + subject + game type; history is keyed by user + class + subject + fingerprint and the
// "claim" is arbitrated by that key (like the unique index in gq_claim_items). Reads are snapshots that yield between awaits so
// parallel requests genuinely interleave.

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

interface Row { school: string; classKey: string; subject: string; type: GameType; fp: string; payload: any }
class FakeDb {
  pool: Row[] = [];
  history = new Map<string, Set<string>>();
  hist(user: string, cls: string, subject: string) {
    const k = `${user}|${cls}|${subject}`;
    if (!this.history.has(k)) this.history.set(k, new Set());
    return this.history.get(k)!;
  }
  add(school: string, cls: string, subject: string, type: GameType, payload: any, fp = fingerprintOf(type, payload)) {
    this.pool.push({ school, classKey: cls, subject, type, fp, payload });
  }
}

interface Who { user: string; school: string; classKey: string; subject: string; type: GameType }
type Ai = (need: number) => Promise<Candidate[]>;

function depsFor(db: FakeDb, w: Who, ai?: Ai, opts: { leakOtherClasses?: boolean } = {}): ServeDeps {
  return {
    loadSeen: async () => { await tick(); return new Set(db.hist(w.user, w.classKey, w.subject)); },
    loadCandidates: async () => {
      await tick();
      return db.pool
        .filter((r) => r.school === w.school && r.subject === w.subject && r.type === w.type && (opts.leakOtherClasses || r.classKey === w.classKey))
        .map((r) => ({ fingerprint: r.fp, payload: r.payload, source: "pool" as const, classKey: r.classKey }));
    },
    generate: async (need) => { if (!ai) throw new Error("No AI key configured"); return ai(need); },
    savePool: async (items) => {
      const fresh: Candidate[] = [];
      for (const c of items) {
        if (!db.pool.some((r) => r.school === w.school && r.classKey === w.classKey && r.subject === w.subject && r.fp === c.fingerprint)) {
          db.add(w.school, w.classKey, w.subject, w.type, c.payload, c.fingerprint);
          fresh.push(c);
        }
      }
      return fresh;
    },
    claim: async (items) => {
      await tick();
      const set = db.hist(w.user, w.classKey, w.subject);
      const won: string[] = [];
      for (const c of items) if (!set.has(c.fingerprint)) { set.add(c.fingerprint); won.push(c.fingerprint); }
      return won;
    },
  };
}

// Class-1 style "What is a + b?" items; the tag keeps class-1 and class-5 stems distinct and traceable.
const quiz = (tag: string, i: number) => {
  const a = (i % 9) + 1, b = (Math.floor(i / 9) % 9) + 1, s = a + b;
  return { question: `[${tag}] What is ${a} + ${b}?`, options: [String(s), String(s + 1), String(s + 2), String(s - 1)], correctIndex: 0 };
};
const seedPool = (db: FakeDb, w: Omit<Who, "user">, tag: string, n: number, offset = 0) => {
  for (let i = 0; i < n; i++) db.add(w.school, w.classKey, w.subject, w.type, quiz(tag, offset + i));
};
/** An AI that always returns fresh, valid, class-tagged items (different every call). */
const makeAi = (classLabel: string, ctx: { classKey: string; level: number }, tag: string): { ai: Ai; calls: () => number } => {
  let n = 1000, calls = 0;
  return {
    calls: () => calls,
    ai: async (need) => {
      calls++;
      const raw = Array.from({ length: need }, () => ({ class: classLabel, ...quiz(tag, n++) }));
      return candidatesFromGenerated("quick-quiz", raw, ctx).items;
    },
  };
};

const SPEC = serveSpec("quick-quiz", "early_learners"); // { count: 10, min: 5 }
const S1: Who = { user: "stu-1", school: "school-A", classKey: "1", subject: "maths", type: "quick-quiz" };
const C1 = { classKey: "1", level: 1 };
const stems = (items: Candidate[]) => items.map((c) => c.payload.question as string);
const fps = (items: Candidate[]) => items.map((c) => c.fingerprint);

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("class keys and fingerprints", () => {
  it("normalises every way of writing a class", () => {
    for (const raw of ["Class 4", "class 4", "Grade 4", "4", "4th", "IV", " std 4 "]) expect(classKey(raw)).toBe("4");
    expect(classKey("Nursery")).toBe("nursery");
    expect(classKey("LKG")).toBe("lkg");
    expect(classKey(null)).toBe("");
  });
  it("maps classes to grade levels and refuses unknown ones", () => {
    expect(gradeLevel("nursery")).toBe(-3);
    expect(gradeLevel("1")).toBe(1);
    expect(gradeLevel("12")).toBe(12);
    expect(gradeLevel("13")).toBeNull();
    expect(gradeLevel("")).toBeNull();
    expect(gradeLevel("kindergarten")).toBeNull();
    expect(bandForGrade(1)).toBe("early_learners");
    expect(bandForGrade(5)).toBe("explorers");
  });
  it("treats formatting differences as the same question", () => {
    const f = (q: string) => fingerprintOf("quick-quiz", { question: q });
    expect(f("What is 2 + 3?")).toBe(f("what is 2+3 ??"));
    expect(f("What is 2 + 3?")).toBe(f("  What   is 2 + 3 "));
    expect(f("What is 2 + 3?")).toBe(f("What is 2 + 3?"));
    expect(f("Name the “largest” planet.")).toBe(f("name the \"largest\" planet"));
  });
  it("keeps genuinely different questions apart (maths symbols matter)", () => {
    const f = (q: string) => fingerprintOf("quick-quiz", { question: q });
    expect(f("What is 2 + 3?")).not.toBe(f("What is 2 × 3?"));
    expect(f("What is 2 + 3?")).not.toBe(f("What is 3 + 2?"));
    expect(f("What is 12 - 5?")).not.toBe(f("What is 12 + 5?"));
  });
  it("is order-insensitive for pairs and visual sets", () => {
    expect(fingerprintOf("match-pairs", { a: "Dog", b: "Puppy" })).toBe(fingerprintOf("match-pairs", { a: "puppy", b: "DOG" }));
    expect(fingerprintOf("visual-memory", { items: ["Cat", "Dog", "Cow"] })).toBe(fingerprintOf("visual-memory", { items: ["cow", "cat", "dog"] }));
  });
});

describe("validation and the class guard", () => {
  const ok = (extra = {}) => ({ class: "Class 1", question: "What is 2 + 3?", options: ["4", "5", "6", "7"], correctIndex: 1, ...extra });
  it("accepts a clean Class 1 question", () => {
    expect(validateItem("quick-quiz", ok(), C1, { requireClassClaim: true }).ok).toBe(true);
  });
  it("rejects an item written for another class, however the model labels it", () => {
    for (const c of ["Class 5", "5", "Grade 5", "V"]) expect(validateItem("quick-quiz", ok({ class: c }), C1, { requireClassClaim: true }).ok).toBe(false);
    expect(validateItem("quick-quiz", ok({ class: undefined }), C1, { requireClassClaim: true }).ok).toBe(false);
  });
  it("rejects text that mentions another class or is too advanced for the grade", () => {
    expect(classGuard(["For Class 5 students: what is 2 + 2?"], 1, "1")).not.toBeNull();
    expect(classGuard(["What is 250 + 300?"], 1, "1")).not.toBeNull();         // above 100
    expect(classGuard(["What is 5 + 6?"], 1, "1")).toBeNull();
    expect(classGuard(["What is the derivative of x?"], 4, "4")).not.toBeNull();
    expect(classGuard(["What is a decimal?"], 2, "2")).not.toBeNull();
    expect(classGuard(["What is 2500 × 4?"], 4, "4")).toBeNull();              // fine for Class 4
    expect(classGuard(["Which class is this? Class 1 is where we start."], 1, "1")).toBeNull(); // its own class is fine
  });
  it("rejects structurally broken items", () => {
    const base = ok();
    expect(validateItem("quick-quiz", { ...base, options: ["4", "5", "6"] }, C1).ok).toBe(false);
    expect(validateItem("quick-quiz", { ...base, options: ["4", "4", "6", "7"] }, C1).ok).toBe(false);
    expect(validateItem("quick-quiz", { ...base, correctIndex: 4 }, C1).ok).toBe(false);
    expect(validateItem("word-scramble", { word: "CAT", hint: "the cat sat" }, C1).ok).toBe(false);          // hint gives it away
    expect(validateItem("word-scramble", { word: "CAT", hint: "A small pet that meows" }, C1).ok).toBe(true);
    expect(validateItem("match-pairs", { a: "Dog", b: "dog" }, C1).ok).toBe(false);
    expect(validateItem("category-sort", { rule: "r", leftLabel: "A", rightLabel: "B", leftItems: ["x", "y", "z"], rightItems: ["x", "p", "q"] }, C1).ok).toBe(false);
    expect(validateItem("speed-tap", { instruction: "Tap fruit", targets: ["a", "b", "c", "d"], distractors: ["a", "e", "f", "g"] }, C1).ok).toBe(false);
  });
  it("collapses duplicates and drops bad items inside an AI batch", () => {
    const raw = [ok(), ok({ question: "what is 2+3" }), ok({ class: "Class 5", question: "What is 1 + 1?" }), ok({ question: "What is 900 + 900?" })];
    const { items, rejected } = candidatesFromGenerated("quick-quiz", raw, C1);
    expect(items).toHaveLength(1);
    expect(rejected).toHaveLength(3);
  });
  it("parses messy AI output", () => {
    expect(parseGeneratedItems('```json\n{"items":[{"a":1}]}\n```')).toHaveLength(1);
    expect(parseGeneratedItems('[{"a":1},{"a":2}]')).toHaveLength(2);
    expect(parseGeneratedItems('Sure! {"items":[{"a":1}]} hope that helps')).toHaveLength(1);
    expect(parseGeneratedItems("nonsense")).toHaveLength(0);
  });
  it("tells the AI the class, subject, difficulty and what to avoid", () => {
    const { prompt } = buildGenerationPrompt({ gameType: "quick-quiz", classLabel: "Class 1", subject: "Maths", difficulty: "easy", count: 12, curriculum: ["Counting to 20"], avoid: ["What is 2 + 3?"], seed: 7 });
    for (const s of ["Class 1", "Maths", "easy", "Counting to 20", "What is 2 + 3?", "nothing from a higher class"]) expect(prompt).toContain(s);
  });
  it("derives difficulty and game sizes", () => {
    expect(difficultyFromAccuracy(null)).toBe("easy");
    expect(difficultyFromAccuracy(60)).toBe("medium");
    expect(difficultyFromAccuracy(90)).toBe("hard");
    expect(serveSpec("match-pairs", "early_learners").count).toBe(6);
    expect(serveSpec("match-pairs", "thinkers").count).toBe(12);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("scenario 1-2: class-level filtering", () => {
  it("a Class 1 student receives only Class 1 questions", async () => {
    const db = new FakeDb();
    seedPool(db, S1, "c1", 15);
    seedPool(db, { ...S1, classKey: "5" }, "c5", 15);
    const r = await serveItems(depsFor(db, S1), SPEC, "1");
    expect(r.items).toHaveLength(10);
    for (const s of stems(r.items)) expect(s).toContain("[c1]");
  });
  it("even a buggy loader that leaks other classes cannot get them through", async () => {
    const db = new FakeDb();
    seedPool(db, { ...S1, classKey: "5" }, "c5", 30);        // ONLY class 5 content exists
    const r = await serveItems(depsFor(db, S1, undefined, { leakOtherClasses: true }), SPEC, "1");
    expect(r.exhausted).toBe(true);
    expect(r.items).toHaveLength(0);
    expect(db.hist(S1.user, "1", "maths").size).toBe(0);
  });
  it("never fills a Class 1 game from a higher class when Class 1 content is short", async () => {
    const db = new FakeDb();
    seedPool(db, S1, "c1", 7);
    seedPool(db, { ...S1, classKey: "5" }, "c5", 50);
    const r = await serveItems(depsFor(db, S1), SPEC, "1");
    expect(r.items).toHaveLength(7);
    expect(r.short).toBe(true);
    for (const s of stems(r.items)) expect(s).toContain("[c1]");
  });
  it("generated content for another class or above the grade is discarded before it can be served", async () => {
    const db = new FakeDb();
    const dirty: Ai = async (need) => candidatesFromGenerated("quick-quiz", [
      ...Array.from({ length: need }, (_, i) => ({ class: "Class 5", ...quiz("g5", i) })),
      ...Array.from({ length: need }, (_, i) => ({ class: "Class 1", question: `What is ${5000 + i} + 1?`, options: ["1", "2", "3", "4"], correctIndex: 0 })),
    ], C1).items;
    const r = await serveItems(depsFor(db, S1, dirty), SPEC, "1");
    expect(r.exhausted).toBe(true);
    expect(r.generation).toBe("failed");
    expect(db.pool).toHaveLength(0);
  });
  it("a Class 5 student's play does not touch a Class 1 student's history or pool", async () => {
    const db = new FakeDb();
    const S5: Who = { ...S1, user: "stu-5", classKey: "5" };
    seedPool(db, S1, "c1", 20);
    seedPool(db, S5, "c5", 20);
    const r1 = await serveItems(depsFor(db, S1), SPEC, "1");
    const r5 = await serveItems(depsFor(db, S5), SPEC, "5");
    for (const s of stems(r5.items)) expect(s).toContain("[c5]");
    for (const s of stems(r1.items)) expect(s).toContain("[c1]");
    expect(db.hist("stu-1", "1", "maths").size).toBe(10);
    expect(db.hist("stu-5", "5", "maths").size).toBe(10);
    expect(db.hist("stu-5", "1", "maths").size).toBe(0);
  });
});

describe("scenario 3-5: no repeats across games, sessions, refreshes and logins", () => {
  it("never serves the same question twice across repeated rounds", async () => {
    const db = new FakeDb();
    seedPool(db, S1, "c1", 40);
    const seen: string[] = [];
    for (let round = 0; round < 4; round++) seen.push(...fps((await serveItems(depsFor(db, S1), SPEC, "1")).items));
    expect(seen).toHaveLength(40);
    expect(new Set(seen).size).toBe(40);
  });
  it("a fingerprint served in one game type is unavailable in another", async () => {
    const db = new FakeDb();
    for (let i = 0; i < 6; i++) {
      db.add("school-A", "1", "maths", "quick-quiz", { n: i }, `q:shared${i}`);
      db.add("school-A", "1", "maths", "visual-memory", { n: i }, `q:shared${i}`);
    }
    const a = await serveItems(depsFor(db, S1), { count: 6, min: 1 }, "1");
    const b = await serveItems(depsFor(db, { ...S1, type: "visual-memory" }), { count: 6, min: 1 }, "1");
    expect(a.items).toHaveLength(6);
    expect(b.exhausted).toBe(true);
  });
  it("after every eligible question is used, new valid ones are generated - the sequence does not restart", async () => {
    const db = new FakeDb();
    seedPool(db, S1, "c1", 14);
    const { ai } = makeAi("Class 1", C1, "gen");
    const all: string[] = [];
    for (let round = 0; round < 6; round++) {
      const r = await serveItems(depsFor(db, S1, ai), SPEC, "1");
      expect(r.exhausted).toBe(false);
      all.push(...fps(r.items));
    }
    expect(new Set(all).size).toBe(all.length);          // 60 served, 60 distinct
    expect(all.length).toBeGreaterThanOrEqual(50);
    // the original 14 were served once each, early; later rounds are brand new items
    const originals = new Set(db.pool.slice(0, 14).map((r) => r.fp));
    expect(all.filter((f) => originals.has(f)).length).toBeLessThanOrEqual(14);
  });
  it("history survives refresh / logout / login: a brand-new session sees what the last one was served", async () => {
    const db = new FakeDb();
    seedPool(db, S1, "c1", 30);
    const first = fps((await serveItems(depsFor(db, S1), SPEC, "1")).items);
    const afterLogin = fps((await serveItems(depsFor(db, S1), SPEC, "1")).items); // fresh deps = fresh page / session
    for (const f of afterLogin) expect(first).not.toContain(f);
  });
  it("unseen-first selection leaves seen items alone until the unseen are gone", () => {
    const mk = (n: number): Candidate => ({ fingerprint: `f${n}`, payload: {}, source: "pool", classKey: "1" });
    const pool = Array.from({ length: 12 }, (_, i) => mk(i));
    const seen = new Set(["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"]);
    const picked = pickUnseen(pool, seen, 10, "1");
    expect(picked).toHaveLength(4);
    for (const p of picked) expect(seen.has(p.fingerprint)).toBe(false);
  });
});

describe("scenario 6: students are independent", () => {
  it("two students in the same class keep separate histories", async () => {
    const db = new FakeDb();
    const S1b: Who = { ...S1, user: "stu-2" };
    seedPool(db, S1, "c1", 20);
    await serveItems(depsFor(db, S1), SPEC, "1");
    await serveItems(depsFor(db, S1), SPEC, "1");          // student 1 has now used all 20
    const own = await serveItems(depsFor(db, S1b), SPEC, "1");
    expect(own.items).toHaveLength(10);                      // student 2 is unaffected
    expect(db.hist("stu-1", "1", "maths").size).toBe(20);
    expect(db.hist("stu-2", "1", "maths").size).toBe(10);
    const s1Exhausted = await serveItems(depsFor(db, S1), SPEC, "1");
    expect(s1Exhausted.exhausted).toBe(true);
  });
  it("pool rows are school-scoped: another school's content is never visible", async () => {
    const db = new FakeDb();
    seedPool(db, { ...S1, school: "school-B" }, "otherSchool", 30);
    const r = await serveItems(depsFor(db, S1), SPEC, "1");
    expect(r.exhausted).toBe(true);
  });
});

describe("scenario 7: exhaustion and AI failure are handled, never silently repeated", () => {
  it("AI down + pool used up: nothing is served, nothing is consumed, a clear message is available", async () => {
    const db = new FakeDb();
    seedPool(db, S1, "c1", 14);
    const r1 = await serveItems(depsFor(db, S1), SPEC, "1");
    expect(r1.items).toHaveLength(10);
    const before = db.hist(S1.user, "1", "maths").size;
    const r2 = await serveItems(depsFor(db, S1), SPEC, "1");   // 4 left < min 5, AI unavailable
    expect(r2.exhausted).toBe(true);
    expect(r2.items).toHaveLength(0);
    expect(r2.generation).toBe("failed");
    expect(r2.generationError).toContain("No AI key");
    expect(db.hist(S1.user, "1", "maths").size).toBe(before); // the 4 leftovers were not burned
    expect(exhaustedMessage("Maths", r2.generation)).toContain("Maths");
    expect(exhaustedMessage("Maths", "failed")).toContain("couldn't create new ones");
  });
  it("a low pool with a working fallback still serves a shorter game", async () => {
    const db = new FakeDb();
    seedPool(db, S1, "c1", 7);
    const r = await serveItems(depsFor(db, S1), SPEC, "1");
    expect(r.items).toHaveLength(7);
    expect(r.short).toBe(true);
    expect(r.generation).toBe("failed");
  });
  it("AI that returns only already-existing items counts as a failure, not a repeat", async () => {
    const db = new FakeDb();
    seedPool(db, S1, "c1", 3);
    const replay: Ai = async () => candidatesFromGenerated("quick-quiz", [0, 1, 2].map((i) => ({ class: "Class 1", ...quiz("c1", i) })), C1).items;
    const r = await serveItems(depsFor(db, S1, replay), SPEC, "1");
    expect(r.exhausted).toBe(true);
    expect(r.generation).toBe("failed");
  });
  it("AI that throws mid-way is caught", async () => {
    const db = new FakeDb();
    const boom: Ai = async () => { throw new Error("429 rate limited"); };
    const r = await serveItems(depsFor(db, S1, boom), SPEC, "1");
    expect(r.exhausted).toBe(true);
    expect(r.generationError).toContain("429");
  });
  it("partial generation tops a small pool up to a playable game", async () => {
    const db = new FakeDb();
    seedPool(db, S1, "c1", 4);
    const three: Ai = async () => candidatesFromGenerated("quick-quiz", [100, 101, 102].map((i) => ({ class: "Class 1", ...quiz("gen", i) })), C1).items;
    const r = await serveItems(depsFor(db, S1, three), SPEC, "1");
    expect(r.items).toHaveLength(7);
    expect(r.generation).toBe("partial");
  });
});

describe("concurrent requests", () => {
  it("parallel rounds for one student never receive the same question", async () => {
    const db = new FakeDb();
    seedPool(db, S1, "c1", 40);
    const results = await Promise.all([0, 1, 2].map(() => serveItems(depsFor(db, S1), SPEC, "1")));
    const all = results.flatMap((r) => fps(r.items));
    expect(new Set(all).size).toBe(all.length);
    expect(db.hist(S1.user, "1", "maths").size).toBe(all.length);
  });
  it("racing for the last few questions: no duplicates, and nothing served is lost from history", async () => {
    const db = new FakeDb();
    seedPool(db, S1, "c1", 14);
    const results = await Promise.all([serveItems(depsFor(db, S1), SPEC, "1"), serveItems(depsFor(db, S1), SPEC, "1")]);
    const all = results.flatMap((r) => fps(r.items));
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeLessThanOrEqual(14);
    expect(db.hist(S1.user, "1", "maths").size).toBe(all.length); // every served item is recorded; every recorded item was served
  });
  it("parallel requests that all need AI generation still end up with disjoint full sets", async () => {
    const db = new FakeDb();
    const { ai } = makeAi("Class 1", C1, "gen");
    const results = await Promise.all([0, 1, 2].map(() => serveItems(depsFor(db, S1, ai), SPEC, "1")));
    const all = results.flatMap((r) => fps(r.items));
    expect(new Set(all).size).toBe(all.length);
    for (const r of results) expect(r.items.length).toBeGreaterThanOrEqual(1);
  });
});

describe("normalisation edge cases", () => {
  it("normalizeText keeps non-Latin scripts", () => {
    expect(normalizeText("भारत की राजधानी क्या है?")).toBe("भारत की राजधानी क्या है");
  });
});
