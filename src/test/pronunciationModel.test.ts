import { describe, it, expect } from "vitest";
import {
  assessPronunciation, normaliseWord, tokenise, similarity, paceScore, bandOf, summariseHistory,
} from "../../supabase/functions/_shared/pronunciationModel";

const REF = "The quick brown fox jumps over the lazy dog";

describe("text handling", () => {
  it("normalises case, punctuation and apostrophes", () => {
    expect(normaliseWord("Don't!")).toBe("dont");
    expect(normaliseWord("DOG,")).toBe("dog");
  });
  it("keeps Indic letters and vowel signs", () => {
    expect(normaliseWord("నమస్కారం.")).toBe("నమస్కారం");
    expect(tokenise("నమస్కారం, ఎలా ఉన్నారు?").map((t) => t.norm)).toEqual(["నమస్కారం", "ఎలా", "ఉన్నారు"]);
  });
  it("similarity is 1 for equal, 0 for empty, and between otherwise", () => {
    expect(similarity("cat", "cat")).toBe(1);
    expect(similarity("cat", "")).toBe(0);
    const s = similarity("three", "tree");
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
  });
});

describe("assessPronunciation", () => {
  it("scores a perfect reading 100", () => {
    const r = assessPronunciation({ reference: REF, transcript: "the quick brown fox jumps over the lazy dog" });
    expect(r.overall).toBe(100);
    expect(r.accuracy).toBe(100);
    expect(r.completeness).toBe(100);
    expect(r.band).toBe("excellent");
    expect(r.counts.correct).toBe(9);
    expect(r.extra_words).toEqual([]);
  });
  it("ignores case and punctuation differences", () => {
    const r = assessPronunciation({ reference: "Hello, world!", transcript: "HELLO WORLD" });
    expect(r.overall).toBe(100);
  });
  it("marks a skipped word as missed without ruining the rest", () => {
    const r = assessPronunciation({ reference: REF, transcript: "the quick brown jumps over the lazy dog" });
    const fox = r.words.find((w) => w.ref === "fox")!;
    expect(fox.status).toBe("missed");
    expect(r.words.filter((w) => w.status === "correct")).toHaveLength(8);
    expect(r.completeness).toBe(89);
  });
  it("marks a near match as close and a different word as mispronounced", () => {
    const r = assessPronunciation({ reference: "three green trees", transcript: "tree green cheese" });
    expect(r.words[0].status).toBe("close");
    expect(r.words[0].heard).toBe("tree");
    expect(r.words[1].status).toBe("correct");
    expect(r.words[2].status).toBe("mispronounced");
    expect(r.words[2].score).toBeLessThan(35);
  });
  it("reports extra words and penalises them", () => {
    const clean = assessPronunciation({ reference: "good morning everyone", transcript: "good morning everyone" });
    const extra = assessPronunciation({ reference: "good morning everyone", transcript: "um good morning to everyone" });
    expect(extra.extra_words).toEqual(["um", "to"]);
    expect(extra.overall).toBeLessThan(clean.overall);
  });
  it("returns zeros and a note when nothing was heard", () => {
    const r = assessPronunciation({ reference: REF, transcript: "   " });
    expect(r.overall).toBe(0);
    expect(r.counts.missed).toBe(9);
    expect(r.notes.join(" ")).toMatch(/No speech/);
  });
  it("handles an empty reference without throwing", () => {
    const r = assessPronunciation({ reference: "", transcript: "hello" });
    expect(r.overall).toBe(0);
    expect(r.words).toEqual([]);
  });
  it("scores pace only when there is enough speech and time", () => {
    const base = { reference: REF, transcript: "the quick brown fox jumps over the lazy dog" };
    expect(assessPronunciation(base).fluency).toBeNull();
    const ok = assessPronunciation({ ...base, durationSeconds: 4 });     // 135 wpm
    expect(ok.words_per_minute).toBe(135);
    expect(ok.fluency).toBe(100);
    const slow = assessPronunciation({ ...base, durationSeconds: 30 }); // 18 wpm
    expect(slow.fluency!).toBeLessThan(40);
    expect(slow.overall).toBeLessThan(ok.overall);
    const short = assessPronunciation({ reference: "hi there", transcript: "hi there", durationSeconds: 5 });
    expect(short.fluency).toBeNull();
  });
  it("uses clarity only when a confidence is supplied", () => {
    const base = { reference: REF, transcript: "the quick brown fox jumps over the lazy dog" };
    expect(assessPronunciation(base).clarity).toBeNull();
    const low = assessPronunciation({ ...base, confidence: 0.4 });
    expect(low.clarity).toBe(40);
    expect(low.overall).toBeLessThan(100);
  });
  it("works for Telugu text", () => {
    const r = assessPronunciation({ reference: "నమస్కారం ఎలా ఉన్నారు", transcript: "నమస్కారం ఎలా ఉన్నారు" });
    expect(r.overall).toBe(100);
    const miss = assessPronunciation({ reference: "నమస్కారం ఎలా ఉన్నారు", transcript: "నమస్కారం ఉన్నారు" });
    expect(miss.words[1].status).toBe("missed");
  });
});

describe("helpers", () => {
  it("paceScore is 100 in range and falls off outside", () => {
    expect(paceScore(120)).toBe(100);
    expect(paceScore(35)).toBe(50);
    expect(paceScore(340)).toBe(0);
  });
  it("bandOf thresholds", () => {
    expect([bandOf(90), bandOf(75), bandOf(55), bandOf(20)]).toEqual(["excellent", "good", "developing", "needs_practice"]);
  });
});

describe("summariseHistory", () => {
  const row = (overall: number, words: { ref: string; status: "correct" | "missed" | "mispronounced" | "close" }[] = []) =>
    ({ language: "en", overall, created_at: "2026-10-01T00:00:00Z", words });
  it("is empty-safe", () => {
    expect(summariseHistory([]).attempts).toBe(0);
  });
  it("computes averages, direction and tricky words", () => {
    const rows = [
      row(80, [{ ref: "Thought", status: "mispronounced" }]),
      row(78, [{ ref: "thought", status: "missed" }]),
      row(76), row(75), row(74),
      row(60), row(58), row(55), row(57), row(59),
    ];
    const s = summariseHistory(rows);
    expect(s.attempts).toBe(10);
    expect(s.best).toBe(80);
    expect(s.direction).toBe("improving");
    expect(s.tricky_words[0]).toEqual({ word: "thought", times_missed: 2, attempts_seen: 2 });
  });
  it("needs 2+ misses to call a word tricky", () => {
    const s = summariseHistory([row(70, [{ ref: "once", status: "missed" }])]);
    expect(s.tricky_words).toEqual([]);
    expect(s.direction).toBeNull();
  });
});
