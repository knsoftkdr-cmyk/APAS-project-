import { describe, it, expect } from "vitest";
import {
  buildGenerationPrompt, candidatesFromGenerated, conceptKeysOf, languageForSubject, matchesLanguage, pickUnseen, serveItems, subjectMatches,
  validateItem, fingerprintOf, type Candidate, type ServeDeps,
} from "../../supabase/functions/_shared/gamificationQuestionModel";

const LKG = { classKey: "lkg", level: -2 };
const C5 = { classKey: "5", level: 5 };

describe("textbooks attach to assigned subjects (reference only)", () => {
  it("matches the same subject by whole words, never by loose substring", () => {
    expect(subjectMatches("Maths", "Maths Part 1")).toBe(true);
    expect(subjectMatches("Social", "Social Science")).toBe(true);
    expect(subjectMatches("Hindi", "hindi")).toBe(true);
    expect(subjectMatches("Science", "Social Science")).toBe(false);
    expect(subjectMatches("English", "Hindi")).toBe(false);
    expect(subjectMatches("Art", "Arts")).toBe(false);
  });
});

describe("subject language", () => {
  it("writes language subjects in their own language, whatever the student's preference", () => {
    expect(languageForSubject("Hindi", "en")).toEqual({ name: "Hindi (Devanagari script)", isLanguageSubject: true });
    expect(languageForSubject("Urdu", "en").isLanguageSubject).toBe(true);
    expect(languageForSubject("Sanskrit").name).toMatch(/Sanskrit/);
  });
  it("leaves other subjects on the configured language (default English), not auto-translated", () => {
    expect(languageForSubject("Maths", null)).toEqual({ name: "English", isLanguageSubject: false });
    expect(languageForSubject("Science", "en").name).toBe("English");
    expect(languageForSubject("Science", "hi").name).toMatch(/Hindi/);
    expect(languageForSubject("English", "hi").name).toMatch(/Hindi|English/); // English is a plain subject: follows the configured rule
  });
  it("does not treat English as a language-subject exception", () => {
    expect(languageForSubject("English", "en").isLanguageSubject).toBe(false);
  });
  it("rejects English items served for a Hindi subject", () => {
    const en = { question: "What colour is the sun?", options: ["Red", "Yellow", "Blue", "Green"], correctIndex: 1 };
    const hi = { question: "सूरज का रंग क्या है?", options: ["लाल", "पीला", "नीला", "हरा"], correctIndex: 1 };
    expect(matchesLanguage("quick-quiz", en, "Hindi (Devanagari script)")).toBe(false);
    expect(matchesLanguage("quick-quiz", hi, "Hindi (Devanagari script)")).toBe(true);
    expect(matchesLanguage("quick-quiz", en, "English")).toBe(true);
  });
  it("accepts Hindi words with vowel signs in word-scramble (marks are not dropped as non-letters)", () => {
    const v = validateItem("word-scramble", { class: "5", word: "विद्यालय", hint: "बच्चे यहाँ पढ़ने जाते हैं" }, C5, { requireClassClaim: true });
    expect(v.ok).toBe(true);
  });
});

describe("generation prompt: textbook is a reference, not a boundary", () => {
  const base = { gameType: "quick-quiz" as const, classLabel: "Class 5", subject: "Hindi", difficulty: "medium" as const, count: 10, avoid: [], seed: 1 };
  it("tells the model to use textbook samples for level only and to write original items", () => {
    const { prompt } = buildGenerationPrompt({ ...base, curriculum: ["Rivers of India"], language: languageForSubject("Hindi") });
    expect(prompt).toMatch(/REFERENCE ONLY/);
    expect(prompt).toMatch(/Do NOT limit items to these topics/i);
    expect(prompt).toMatch(/ORIGINAL/);
    expect(prompt).toMatch(/Hindi \(Devanagari script\)/);
    expect(prompt).not.toMatch(/Base items on these/);
  });
  it("still works with no textbook at all", () => {
    const { prompt } = buildGenerationPrompt({ ...base, curriculum: [], language: languageForSubject("Hindi") });
    expect(prompt).toMatch(/No textbook sample is available/);
  });
  it("lists ideas already met so the model picks different ones", () => {
    const { prompt } = buildGenerationPrompt({ ...base, curriculum: [], avoidIdeas: ["paris", "cat"] });
    expect(prompt).toMatch(/already met/);
    expect(prompt).toMatch(/- paris/);
  });
  it("keeps the class strict", () => {
    const { prompt } = buildGenerationPrompt({ ...base, classLabel: "LKG", curriculum: [], level: -2 });
    expect(prompt).toMatch(/nothing from a higher class/);
  });
});

describe("same idea never returns - across games and wordings", () => {
  it("derives concept keys from the idea, not from numbers", () => {
    expect(conceptKeysOf("word-scramble", { word: "CAT" })).toEqual(["k:cat"]);
    expect(conceptKeysOf("match-pairs", { a: "🐱 Cat", b: "Meow" }).length).toBe(2);
    expect(conceptKeysOf("quick-quiz", { question: "2+2?", options: ["4", "5", "6", "7"], correctIndex: 0 })).toEqual([]);
    expect(conceptKeysOf("quick-quiz", { question: "Capital of France?", options: ["Paris", "Rome", "Oslo", "Bern"], correctIndex: 0 })).toEqual(["k:paris"]);
  });
  const cand = (type: any, payload: any): Candidate => ({ fingerprint: fingerprintOf(type, payload), payload, source: "pool", classKey: "2", concepts: conceptKeysOf(type, payload) });
  it("blocks the same idea in a different game", () => {
    const quizPaid = cand("quick-quiz", { question: "Which animal says meow?", options: ["Cat", "Dog", "Cow", "Hen"], correctIndex: 0 });
    const scramble = cand("word-scramble", { word: "CAT", hint: "Says meow and chases mice" });
    const seen = new Set<string>([quizPaid.fingerprint, ...(quizPaid.concepts ?? [])]);
    expect(pickUnseen([scramble], seen, 1, "2")).toEqual([]);
  });
  it("blocks a reworded question with the same answer, including within one selection", () => {
    const a = cand("quick-quiz", { question: "What is the capital of France?", options: ["Paris", "Rome", "Oslo", "Bern"], correctIndex: 0 });
    const b = cand("quick-quiz", { question: "Eiffel Tower stands in which city?", options: ["Madrid", "Paris", "Vienna", "Lima"], correctIndex: 1 });
    expect(pickUnseen([a, b], new Set(), 2, "2")).toHaveLength(1);
    expect(pickUnseen([b], new Set(a.concepts), 1, "2")).toEqual([]);
  });
  it("does not block distinct ideas, nor maths items that share an answer", () => {
    const m1 = cand("quick-quiz", { question: "3 + 4 = ?", options: ["7", "8", "9", "6"], correctIndex: 0 });
    const m2 = cand("quick-quiz", { question: "10 - 3 = ?", options: ["7", "8", "9", "6"], correctIndex: 0 });
    expect(pickUnseen([m1, m2], new Set(), 2, "2")).toHaveLength(2);
  });
  it("serveItems never serves a concept it already served in the same request, and records it for later games", async () => {
    const make = (type: any, payload: any): Candidate => cand(type, payload);
    const pool = [
      make("word-scramble", { word: "CAT", hint: "Says meow and chases mice" }),
      make("word-scramble", { word: "DOG", hint: "Says woof and wags its tail" }),
    ];
    const seen = new Set<string>(["k:cat"]);
    const deps: ServeDeps = {
      loadSeen: async () => new Set(seen),
      loadCandidates: async () => pool,
      generate: async () => [],
      savePool: async () => [],
      claim: async (items) => { items.forEach((c) => { seen.add(c.fingerprint); c.concepts?.forEach((k) => seen.add(k)); }); return items.map((c) => c.fingerprint); },
    };
    const r = await serveItems(deps, { count: 2, min: 1 }, "2");
    expect(r.items.map((c) => c.payload.word)).toEqual(["DOG"]);
    expect(seen.has("k:dog")).toBe(true);
  });
});

describe("class level is still enforced", () => {
  it("LKG never gets higher-class content", () => {
    const bad = { class: "LKG", question: "What is 45 + 38 ?", options: ["83", "82", "84", "85"], correctIndex: 0 };
    expect(validateItem("quick-quiz", bad, LKG, { requireClassClaim: true }).ok).toBe(false);
  });
});
