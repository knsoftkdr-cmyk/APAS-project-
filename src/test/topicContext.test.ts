import { describe, expect, it } from "vitest";
import { topicContextDirective } from "../../supabase/functions/_shared/topicContext";

describe("topicContextDirective", () => {
  it("returns nothing without a topic", () => {
    expect(topicContextDirective(null)).toBe("");
    expect(topicContextDirective({})).toBe("");
  });
  it("builds the academic path, lesson text, next topic and support hints", () => {
    const out = topicContextDirective({
      academic_year: "2026-2027", semester: "Semester 1", subject: "Mathematics", module: "Algebra", chapter: "Intro",
      topic: { title: "Variables", objectives: "Use letters for numbers", content: "A variable is a letter." },
      materials: [{ title: "Notes", type: "notes", notes: "x stands for any number" }],
      next_topic: { title: "Expressions" }, needs_support: ["Basic Concepts"], completed: false, time_spent_seconds: 600,
    });
    expect(out).toContain("2026-2027 > Semester 1 > Mathematics > Algebra > Intro > Variables");
    expect(out).toContain("A variable is a letter.");
    expect(out).toContain("Recommended next topic: Expressions");
    expect(out).toContain("Basic Concepts");
    expect(out).toContain("about 10 min");
  });
  it("caps very long lesson text", () => {
    const out = topicContextDirective({ topic: { title: "T", content: "x".repeat(20000) } });
    expect(out.length).toBeLessThan(6000);
  });
});
