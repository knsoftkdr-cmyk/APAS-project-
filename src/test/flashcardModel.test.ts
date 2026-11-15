import { describe, it, expect } from "vitest";
import {
  MAX_INTERVAL_DAYS, NEW_CARDS_PER_SESSION, NEW_SCHEDULE, RELEARN_MINUTES,
  answerSupport, buildPrompt, buildSource, cardState, dueUrgency, evidenceInSource, intervalLabel, nextSchedule, norm,
  orderStudyQueue, parseGenerated, pullForwardDays, questionHash, requeueAfterRating, summarizeDeck, validateBatch, validateCard,
  type CardSchedule, type Progress, type ValidateCtx,
} from "../../supabase/functions/_shared/flashcardModel";

const NOW = new Date("2026-11-10T09:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

// A realistic passage of textbook text (Class 7 science).
const TEXT =
  "Photosynthesis is the process by which green plants make their own food using sunlight, water and carbon dioxide. " +
  "The green pigment chlorophyll, found in the chloroplasts of leaves, absorbs sunlight. " +
  "During photosynthesis plants release oxygen into the air. The food made is stored as starch. " +
  "Stomata are tiny pores on the surface of leaves that allow gases to enter and leave. " +
  "Plants that make their own food are called autotrophs, while animals that depend on others for food are called heterotrophs.";

const source = buildSource([{ page: 12, text: TEXT, content_type: "LESSON_CONCEPT" }], "")!;
const ctx: ValidateCtx = { source, allowedTypes: ["definition", "concept", "fact", "qa"], objectiveIds: new Set([7, 8]) };

const good = {
  type: "definition",
  question: "What is photosynthesis?",
  answer: "The process by which green plants make their own food using sunlight, water and carbon dioxide.",
  evidence: "Photosynthesis is the process by which green plants make their own food using sunlight, water and carbon dioxide.",
  difficulty: "easy", hint: "Plants do it with light", objective_id: 7,
};

describe("source material", () => {
  it("builds a textbook source with page markers", () => {
    expect(source.grounding).toBe("textbook");
    expect(source.pages).toEqual([12]);
    expect(source.text).toContain("[p.12]");
  });

  it("prefers teaching text over worksheets / exercises", () => {
    const s = buildSource([
      { page: 3, text: "Fill in the blanks: Plants make ____ using sunlight. Answer the following questions about plants and leaves.", content_type: "WORKSHEET" },
      { page: 2, text: TEXT, content_type: "LESSON_CONCEPT" },
    ], "")!;
    expect(s.text).toContain("Photosynthesis is the process");
    expect(s.text).not.toContain("Fill in the blanks");
  });

  it("falls back to the syllabus outline (and says so) when a topic has no textbook text", () => {
    const outline = "Topic: Photosynthesis\n" + "Learning objective: Explain how plants make food using sunlight, water and carbon dioxide. ".repeat(4);
    const s = buildSource([], outline)!;
    expect(s.grounding).toBe("syllabus");
    expect(s.pages).toEqual([]);
  });

  it("returns null when there is not enough real material - never invent cards", () => {
    expect(buildSource([], "")).toBeNull();
    expect(buildSource([{ page: 1, text: "Short." }], "Topic: Plants")).toBeNull();
  });

  it("respects the character budget", () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ page: i + 1, text: TEXT, content_type: "LESSON_CONCEPT" }));
    expect(buildSource(big, "", 3000)!.text.length).toBeLessThanOrEqual(3000 + 200);
  });
});

describe("normalisation and hashing", () => {
  it("folds case, punctuation and spacing", () => {
    expect(norm("  What  IS “Photosynthesis”?  ")).toBe("what is photosynthesis");
    expect(norm("3.5 cm")).toBe("3.5 cm");
  });
  it("gives the same hash to the same question written slightly differently", () => {
    expect(questionHash("What is photosynthesis?")).toBe(questionHash("  what is  Photosynthesis ? "));
    expect(questionHash("What is photosynthesis?")).not.toBe(questionHash("What is respiration?"));
    expect(questionHash("x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("grounding: a card is kept only if the textbook really says it", () => {
  it("accepts a card whose evidence is in the source and links the objective", () => {
    const v = validateCard(good, ctx);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.card.learning_objective_id).toBe(7);
      expect(v.card.card_type).toBe("definition");
      expect(v.card.source_excerpt).toContain("Photosynthesis is the process");
    }
  });

  it("rejects fabricated evidence", () => {
    const v = validateCard({ ...good, evidence: "Photosynthesis happens only at night inside the roots of every plant species." }, ctx);
    expect(v).toEqual({ ok: false, reason: "evidence_not_in_source" });
  });

  it("rejects an answer that is not supported by the material even when the evidence is real", () => {
    const v = validateCard({ ...good, answer: "A chemical reaction in volcanic rocks that produces magma and lava flows." }, ctx);
    expect(v).toEqual({ ok: false, reason: "answer_not_supported" });
  });

  it("rejects a wrong number in the answer", () => {
    const text = TEXT + " A leaf has about 300 stomata per square millimetre.";
    const src = buildSource([{ page: 1, text, content_type: "LESSON_CONCEPT" }], "")!;
    const c: ValidateCtx = { ...ctx, source: src };
    const okCard = { type: "fact", question: "How many stomata does a leaf have per square millimetre?", answer: "About 300 stomata.", evidence: "A leaf has about 300 stomata per square millimetre." };
    expect(validateCard(okCard, c).ok).toBe(true);
    expect(validateCard({ ...okCard, answer: "About 900 stomata." }, c)).toEqual({ ok: false, reason: "answer_not_supported" });
  });

  it("tolerates OCR-style whitespace and the [p.N] markers in the evidence", () => {
    const messy = "Photosynthesis  is the process\nby which green plants make their own food  using sunlight, water and carbon dioxide.";
    expect(evidenceInSource(messy, source.text)).toBe(true);
    expect(evidenceInSource("[p.12] " + messy, source.text)).toBe(true);
  });

  it("does not accept a shuffled bag of the source's words as evidence", () => {
    const shuffled = "water sunlight and carbon dioxide food own their make plants green which by process the is photosynthesis using";
    expect(evidenceInSource(shuffled, source.text)).toBe(false);
  });

  it("rejects cards that only make sense next to the passage", () => {
    expect(validateCard({ ...good, question: "According to the passage, what is photosynthesis?" }, ctx)).toEqual({ ok: false, reason: "not_self_contained" });
  });

  it("rejects give-away cards (answer inside the question) and question == answer", () => {
    expect(validateCard({ ...good, question: "Is photosynthesis the process by which green plants make their own food using sunlight, water and carbon dioxide?" }, ctx))
      .toEqual({ ok: false, reason: "answer_in_question" });
    expect(validateCard({ ...good, question: "chlorophyll absorbs sunlight", answer: "Chlorophyll absorbs sunlight." }, ctx).ok).toBe(false);
  });

  it("drops a hint that gives the answer away but keeps the card", () => {
    const v = validateCard({ ...good, hint: good.answer }, ctx);
    expect(v.ok && v.card.hint).toBeNull();
  });

  it("only links objectives that were offered, never an invented id", () => {
    const v = validateCard({ ...good, objective_id: 999 }, ctx);
    expect(v.ok && v.card.learning_objective_id).toBeNull();
  });

  it("rejects a type the student did not ask for, and bad shapes", () => {
    expect(validateCard(good, { ...ctx, allowedTypes: ["fact"] })).toEqual({ ok: false, reason: "type_not_requested" });
    expect(validateCard({ ...good, type: "riddle" }, ctx)).toEqual({ ok: false, reason: "bad_type" });
    expect(validateCard(null, ctx).ok).toBe(false);
    expect(validateCard({ ...good, answer: "" }, ctx).ok).toBe(false);
  });

  it("answerSupport measures how much of the answer comes from the material", () => {
    expect(answerSupport(good.answer, good.question, source.text)).toBeGreaterThan(0.9);
    expect(answerSupport("Volcanic lava erupts from mountains", "What is it?", source.text)).toBeLessThan(0.3);
  });
});

describe("batch validation", () => {
  const second = {
    type: "fact", question: "Which gas do plants release during photosynthesis?", answer: "Oxygen.",
    evidence: "During photosynthesis plants release oxygen into the air.",
  };

  it("keeps good cards, drops bad and duplicate ones, and reports why", () => {
    const rep = validateBatch([good, second, { ...good }, { ...good, evidence: "made up made up made up made up made up" }, "junk"], ctx, new Set(), 10);
    expect(rep.cards.map((c) => c.card_type)).toEqual(["definition", "fact"]);
    expect(rep.rejected.duplicate).toBe(1);
    expect(rep.rejected.evidence_not_in_source).toBe(1);
    expect(rep.rejected.not_an_object).toBe(1);
  });

  it("does not re-create a card the topic already has", () => {
    const rep = validateBatch([good], ctx, new Set([questionHash(good.question)]), 10);
    expect(rep.cards).toHaveLength(0);
    expect(rep.rejected.duplicate).toBe(1);
  });

  it("never returns more than requested", () => {
    expect(validateBatch([good, second], ctx, new Set(), 1).cards).toHaveLength(1);
  });
});

describe("parsing model output", () => {
  it("reads {cards:[]}, a bare array and fenced JSON", () => {
    expect(parseGenerated('{"cards":[{"a":1}]}')).toHaveLength(1);
    expect(parseGenerated('[{"a":1},{"b":2}]')).toHaveLength(2);
    expect(parseGenerated('```json\n{"cards":[{"a":1}]}\n```')).toHaveLength(1);
    expect(parseGenerated('Sure! Here you go: {"cards":[{"a":1}]} Hope that helps')).toHaveLength(1);
  });
  it("returns [] for rubbish", () => {
    expect(parseGenerated("")).toEqual([]);
    expect(parseGenerated("not json")).toEqual([]);
    expect(parseGenerated('{"foo":1}')).toEqual([]);
  });
});

describe("prompt", () => {
  it("is built from the student's own material and class, and forbids outside knowledge", () => {
    const { system, prompt } = buildPrompt({
      classLabel: "Class 7", level: 7, subject: "Science", chapter: "Plants", topic: "Photosynthesis", source,
      types: ["definition", "fact"], count: 8, objectives: [{ id: 7, text: "Explain photosynthesis" }], avoid: ["What is chlorophyll?"],
    });
    expect(system).toMatch(/never use outside knowledge/i);
    expect(prompt).toContain("Class 7");
    expect(prompt).toContain("Photosynthesis is the process");
    expect(prompt).toContain("7: Explain photosynthesis");
    expect(prompt).toContain("What is chlorophyll?");
    expect(prompt).toContain("definition:");
    expect(prompt).not.toContain("qa:");
  });
  it("adapts the language to the age of the child", () => {
    const base = { classLabel: "x", subject: "s", chapter: "c", topic: "t", source, types: [], count: 5, objectives: [], avoid: [] };
    expect(buildPrompt({ ...base, level: 1 }).prompt).toMatch(/young child/);
    expect(buildPrompt({ ...base, level: 11 }).prompt).toMatch(/senior-school/);
  });
});

describe("scheduler: Easy / Medium / Difficult", () => {
  const mature: CardSchedule = { ease_factor: 2.5, interval_days: 10, repetitions: 4, lapses: 0 };

  it("Difficult comes back in minutes, resets the ladder, lowers ease and counts a lapse", () => {
    const r = nextSchedule(mature, "difficult", NOW);
    expect(r.due_at.getTime() - NOW.getTime()).toBe(RELEARN_MINUTES * 60_000);
    expect(r.repetitions).toBe(0);
    expect(r.interval_days).toBe(0);
    expect(r.ease_factor).toBe(2.3);
    expect(r.lapses).toBe(1);
    expect(r.correct).toBe(false);
  });

  it("first successes: Medium 1 day -> 3 days, Easy 3 days -> 7 days", () => {
    const m1 = nextSchedule(null, "medium", NOW); const m2 = nextSchedule(m1, "medium", NOW);
    expect([m1.interval_days, m2.interval_days]).toEqual([1, 3]);
    const e1 = nextSchedule(null, "easy", NOW); const e2 = nextSchedule(e1, "easy", NOW);
    expect([e1.interval_days, e2.interval_days]).toEqual([3, 7]);
    expect(m1.correct && e1.correct).toBe(true);
  });

  it("well-understood cards go out to longer and longer intervals", () => {
    let s: CardSchedule = NEW_SCHEDULE; const seen: number[] = [];
    for (let i = 0; i < 5; i++) { const r = nextSchedule(s, "easy", NOW); s = r; seen.push(r.interval_days); }   // 3, 7, 25, 96, 180 (cap)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(21);
  });

  it("for the same history, Easy >= Medium >= Difficult - difficult cards always appear more often", () => {
    const histories: (CardSchedule | null)[] = [null, { ease_factor: 2.5, interval_days: 1, repetitions: 1, lapses: 0 }, mature, { ease_factor: 1.4, interval_days: 60, repetitions: 7, lapses: 3 }];
    for (const h of histories) {
      const e = nextSchedule(h, "easy", NOW).due_at.getTime();
      const m = nextSchedule(h, "medium", NOW).due_at.getTime();
      const d = nextSchedule(h, "difficult", NOW).due_at.getTime();
      expect(e).toBeGreaterThanOrEqual(m);
      expect(m).toBeGreaterThan(d);
    }
  });

  it("a Difficult card keeps coming back until it is recalled, then climbs again from 1 day", () => {
    let s: CardSchedule = nextSchedule(mature, "difficult", NOW);
    s = nextSchedule(s, "difficult", NOW);
    expect(s.lapses).toBe(2);
    expect(nextSchedule(s, "medium", NOW).interval_days).toBe(1);
  });

  it("keeps ease within 1.3-3.0 and the interval within the cap", () => {
    let s: CardSchedule = NEW_SCHEDULE;
    for (let i = 0; i < 40; i++) s = nextSchedule(s, "easy", NOW);
    expect(s.ease_factor).toBeLessThanOrEqual(3);
    expect(s.interval_days).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
    let h: CardSchedule = NEW_SCHEDULE;
    for (let i = 0; i < 40; i++) h = nextSchedule(h, "difficult", NOW);
    expect(h.ease_factor).toBeGreaterThanOrEqual(1.3);
  });

  it("labels intervals for the rating buttons", () => {
    expect(intervalLabel(NOW, new Date(NOW.getTime() + 10 * 60_000))).toBe("in 10 min");
    expect(intervalLabel(NOW, days(1))).toBe("tomorrow");
    expect(intervalLabel(NOW, days(3))).toBe("in 3 days");
    expect(intervalLabel(NOW, days(21))).toBe("in 3 weeks");
  });
});

describe("Daily Review integration rule", () => {
  it("only a Difficult card brings Daily Review forward; Easy / Medium never delay or change it", () => {
    expect(pullForwardDays("difficult")).toBe(1);
    expect(pullForwardDays("medium")).toBeNull();
    expect(pullForwardDays("easy")).toBeNull();
  });
});

describe("card state and progress tracking", () => {
  const p = (o: Partial<Progress>): Progress => ({ times_seen: 3, times_correct: 2, interval_days: 3, repetitions: 2, last_rating: "medium", due_at: days(3), ...o });

  it("classifies cards", () => {
    expect(cardState(p({ times_seen: 0, repetitions: 0, times_correct: 0 }))).toBe("new");
    expect(cardState(p({ last_rating: "difficult" }))).toBe("learning");
    expect(cardState(p({ repetitions: 1 }))).toBe("learning");
    expect(cardState(p({}))).toBe("reviewing");
    expect(cardState(p({ interval_days: 30, repetitions: 5 }))).toBe("mastered");
  });

  it("summarises a deck with mutually exclusive due buckets and accuracy", () => {
    const rows: Progress[] = [
      p({ times_seen: 0, times_correct: 0, repetitions: 0, due_at: NOW }),
      p({ due_at: new Date(NOW.getTime() - 3600_000) }),
      p({ due_at: new Date(NOW.getTime() + 3600_000), times_seen: 4, times_correct: 4 }),
      p({ due_at: days(3), times_seen: 2, times_correct: 1 }),
      p({ due_at: days(20), interval_days: 25, repetitions: 5 }),
    ];
    const s = summarizeDeck(rows, new Date("2026-11-10T09:00:00"));
    expect(s.total).toBe(5);
    expect(s.new).toBe(1);
    expect(s.mastered).toBe(1);
    expect(s.due_now + s.due_today + s.due_next_7_days).toBeLessThanOrEqual(s.total);
    expect(s.due_now).toBe(2);               // the "new" card (due now, never seen) and the overdue one
    expect(s.reviews).toBe(0 + 3 + 4 + 2 + 3);   // the new card has never been seen
    expect(s.accuracy).toBe(Math.round((s.correct / s.reviews) * 100));
  });

  it("has no accuracy before the first review", () => {
    expect(summarizeDeck([], NOW).accuracy).toBeNull();
  });
});

describe("study queue", () => {
  const card = (id: string, progress: Progress | null) => ({ id, progress });
  const prog = (o: Partial<Progress>): Progress => ({ times_seen: 2, times_correct: 1, interval_days: 1, repetitions: 1, last_rating: "medium", due_at: new Date(NOW.getTime() - 86_400_000), ease_factor: 2.5, lapses: 0, ...o });

  it("shows due cards before new ones and never future cards", () => {
    const q = orderStudyQueue([
      card("future", prog({ due_at: days(2) })), card("new1", null), card("due", prog({})),
    ], NOW);
    expect(q.map((c) => c.id)).toEqual(["due", "new1"]);
  });

  it("puts struggling cards (difficult / many lapses / low ease) ahead of equally-overdue easy ones", () => {
    const q = orderStudyQueue([
      card("easy", prog({ last_rating: "easy", ease_factor: 2.8, lapses: 0 })),
      card("hard", prog({ last_rating: "difficult", ease_factor: 1.5, lapses: 3 })),
    ], NOW);
    expect(q[0].id).toBe("hard");
    expect(dueUrgency(prog({ last_rating: "difficult", lapses: 3, ease_factor: 1.5 }), NOW)).toBeGreaterThan(dueUrgency(prog({}), NOW));
  });

  it("caps new cards per session so a big deck never feels like a wall", () => {
    const many = Array.from({ length: 20 }, (_, i) => card(`n${i}`, null));
    expect(orderStudyQueue(many, NOW)).toHaveLength(NEW_CARDS_PER_SESSION);
    expect(orderStudyQueue(many, NOW, 30, 12)).toHaveLength(12);
  });

  it("respects the overall limit", () => {
    const due = Array.from({ length: 50 }, (_, i) => card(`d${i}`, prog({})));
    expect(orderStudyQueue(due, NOW, 10)).toHaveLength(10);
  });
});

describe("in-session repeats", () => {
  const q = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id }));

  it("puts a Difficult card back a few cards later, at most twice", () => {
    const repeats = new Map<string, number>();
    let cur = requeueAfterRating(q, 0, "difficult", repeats);
    expect(cur.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e", "a", "f", "g"]);
    cur = requeueAfterRating(cur, 5, "difficult", repeats);
    expect(cur.filter((c) => c.id === "a")).toHaveLength(3);
    const again = requeueAfterRating(cur, cur.length - 1 > 0 ? cur.indexOf(cur.filter((c) => c.id === "a")[2]) : 0, "difficult", repeats);
    expect(again.filter((c) => c.id === "a")).toHaveLength(3);          // capped
  });

  it("leaves the queue alone for Easy and Medium", () => {
    expect(requeueAfterRating(q, 0, "easy", new Map())).toBe(q);
    expect(requeueAfterRating(q, 0, "medium", new Map())).toBe(q);
  });

  it("puts the card at the end when the queue is short", () => {
    const short = [{ id: "a" }, { id: "b" }];
    expect(requeueAfterRating(short, 0, "difficult", new Map()).map((c) => c.id)).toEqual(["a", "b", "a"]);
  });
});
