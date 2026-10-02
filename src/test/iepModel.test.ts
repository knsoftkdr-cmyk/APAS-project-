import { describe, it, expect } from "vitest";
import {
  addMonths, buildAiUserPrompt, buildFallbackIep, clampDuration, defaultDomains, draftToText,
  parseAiJson, parseFocusDomains, sanitiseAiIep, type IepInput,
} from "../../supabase/functions/_shared/iepModel";

const base = (over: Partial<IepInput> = {}): IepInput => ({
  today: "2026-10-02",
  category: "ADHD",
  diagnosis_notes: "Priya finds it hard to stay seated.",
  review_cycle_months: 6,
  grade: "Class 6-A",
  duration_months: 12,
  focus_domains: [],
  teacher_notes: null,
  attendance_rate: 92,
  marks: [{ subject: "Maths", pct: 38 }, { subject: "English", pct: 71 }],
  weak_topics: null,
  behaviour: null,
  prior_plans: [],
  accommodations: [],
  therapy: [],
  ...over,
});

const restore = (t: string) => t.replace(/STU_\d{2,3}/g, "Priya");

describe("date + option helpers", () => {
  it("adds months and clamps the day", () => {
    expect(addMonths("2026-10-02", 12)).toBe("2027-10-02");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
  it("clamps duration to 3-12 and defaults to 12", () => {
    expect(clampDuration(1)).toBe(3);
    expect(clampDuration(99)).toBe(12);
    expect(clampDuration("abc")).toBe(12);
    expect(clampDuration(6)).toBe(6);
  });
  it("keeps only known focus domains, de-duplicated, case-insensitive", () => {
    expect(parseFocusDomains(["academic", "Social", "SOCIAL", "Magic"])).toEqual(["Academic", "Social"]);
    expect(parseFocusDomains("nope")).toEqual([]);
  });
  it("has default domains for every category", () => {
    for (const c of ["Autism Spectrum", "ADHD", "Dyslexia / Learning Disability", "Speech-Language", "Physical / Motor", "Intellectual Disability", "Other"]) {
      expect(defaultDomains(c).length).toBeGreaterThan(1);
    }
  });
});

describe("buildFallbackIep", () => {
  it("builds goals from the category domains with computed dates", () => {
    const d = buildFallbackIep(base());
    expect(d.goals.map((g) => g.domain)).toEqual(["Behavioral", "Academic", "Self-Help", "Social"]);
    expect(d.start_date).toBe("2026-10-02");
    expect(d.end_date).toBe("2027-10-02");
    expect(d.next_review_date).toBe("2027-04-02");
    expect(d.goals.every((g) => g.target_date === d.end_date)).toBe(true);
  });
  it("targets the weakest subject in the academic goal", () => {
    const d = buildFallbackIep(base({ focus_domains: ["Academic"] }));
    expect(d.goals[0].goal_description).toContain("Maths");
  });
  it("does not invent baselines", () => {
    const d = buildFallbackIep(base());
    expect(d.goals.every((g) => g.baseline.startsWith("Not on record"))).toBe(true);
  });
  it("carries over an unmet goal as the baseline, but not an achieved one", () => {
    const prior = (status: string) => [{
      title: "IEP 2025", status: "completed", start_date: null, end_date: null, last_review_summary: null,
      goals: [{ domain: "Academic", goal_description: "Read a grade-level passage", progress_status: status }],
    }];
    const open = buildFallbackIep(base({ focus_domains: ["Academic"], prior_plans: prior("in_progress") }));
    expect(open.goals[0].baseline).toContain("Carried over");
    const done = buildFallbackIep(base({ focus_domains: ["Academic"], prior_plans: prior("achieved") }));
    expect(done.goals[0].baseline).toContain("Not on record");
  });
  it("skips accommodations that are already active", () => {
    const d = buildFallbackIep(base({ accommodations: [{ accommodation_type: "Preferential Seating", applies_to: "classroom", description: null, active: true }] }));
    expect(d.accommodations.some((a) => a.accommodation_type === "Preferential Seating" && a.applies_to === "classroom")).toBe(false);
    expect(d.accommodations.length).toBeGreaterThan(0);
  });
  it("only uses allowed vocab", () => {
    const d = buildFallbackIep(base({ category: "Something new" }));
    for (const a of d.accommodations) expect(["classroom", "exam", "both"]).toContain(a.applies_to);
  });
  it("does not claim strengths or needs it has no data for", () => {
    const d = buildFallbackIep(base({ marks: null, attendance_rate: null }));
    expect(d.strengths).toEqual([]);
    expect(d.needs).toEqual([]);
    expect(d.present_levels).toContain("too little recorded data");
  });
});

describe("AI prompt", () => {
  it("scrubs the student's name from free text", () => {
    const scrub = (t: string) => t.replace(/Priya/g, "STU_01");
    const p = buildAiUserPrompt(base({ teacher_notes: "Priya likes drawing" }), scrub);
    expect(p).not.toContain("Priya");
    expect(p).toContain("STU_01");
  });
});

describe("parseAiJson / sanitiseAiIep", () => {
  it("parses JSON wrapped in fences and chatter", () => {
    expect(parseAiJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseAiJson("no json")).toBeNull();
    expect(parseAiJson("[1,2]")).toBeNull();
  });
  it("returns null with no usable goal so the caller falls back", () => {
    const i = base();
    expect(sanitiseAiIep({ goals: [{ domain: "Nonsense", goal_description: "Do something long enough" }] }, i, buildFallbackIep(i), restore)).toBeNull();
    expect(sanitiseAiIep(null, i, buildFallbackIep(i), restore)).toBeNull();
  });
  it("computes dates in code, clamps months, restores the name and fixes vocab", () => {
    const i = base();
    const out = sanitiseAiIep({
      present_levels: "STU_01 is strong in English.",
      goals: [
        { domain: "academic", goal_description: "STU_01 will solve 2-step word problems.", baseline: "", target_criteria: "4 of 5 trials", target_months: 99 },
        { domain: "Social", goal_description: "Join a group activity weekly.", baseline: "Joins rarely", target_criteria: "3 of 4", target_months: 3 },
      ],
      accommodations: [
        { accommodation_type: "extra time", applies_to: "EXAM", description: "Extra 25% time." },
        { accommodation_type: "Telepathy", applies_to: "moon", description: "Odd one." },
      ],
    }, i, buildFallbackIep(i), restore)!;
    expect(out.present_levels).toBe("Priya is strong in English.");
    expect(out.goals[0].goal_description).toContain("Priya");
    expect(out.goals[0].target_date).toBe("2027-10-02"); // clamped to the plan length
    expect(out.goals[1].target_date).toBe("2027-01-02");
    expect(out.goals[0].baseline).toContain("Not on record");
    expect(out.accommodations[0]).toMatchObject({ accommodation_type: "Extra Time", applies_to: "exam" });
    expect(out.accommodations[1]).toMatchObject({ accommodation_type: "Other", applies_to: "both" });
  });
  it("drops suggested accommodations that are already active", () => {
    const i = base({ accommodations: [{ accommodation_type: "Extra Time", applies_to: "exam", description: null, active: true }] });
    const out = sanitiseAiIep({
      goals: [{ domain: "Academic", goal_description: "Improve reading fluency steadily." }],
      accommodations: [{ accommodation_type: "Extra Time", applies_to: "exam", description: "dup" }],
    }, i, buildFallbackIep(i), restore)!;
    expect(out.accommodations).toEqual([]);
  });
  it("keeps the fallback lists when the model returns none", () => {
    const i = base();
    const fb = buildFallbackIep(i);
    const out = sanitiseAiIep({ goals: [{ domain: "Academic", goal_description: "Improve reading fluency steadily." }] }, i, fb, restore)!;
    expect(out.strategies).toEqual(fb.strategies);
    expect(out.strengths).toEqual(fb.strengths);
  });
});

describe("draftToText", () => {
  it("includes the goals and the student name", () => {
    const d = buildFallbackIep(base());
    const t = draftToText(d, "Priya Rao");
    expect(t).toContain("Priya Rao");
    expect(t).toContain("GOALS");
    expect(t).toContain("1. [Behavioral]");
  });
});
