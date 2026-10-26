import { describe, it, expect } from "vitest";
import { rubricScore, sanitiseTeacherRubric } from "../../supabase/functions/_shared/rubricGradingModel";
import { buildDiffPrompt, sanitiseDiffPack, studentMarkdown } from "../../supabase/functions/_shared/differentiationModel";

describe("rubricGradingModel", () => {
  it("accepts a valid rubric and computes a rescaled score", () => {
    const r = sanitiseTeacherRubric([
      { criterion: "Correct formula", max_marks: 2, awarded: 2, comment: " good ", evidence: "a = b" },
      { criterion: "Working shown", max_marks: 2, awarded: 1 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.rows) throw new Error("expected rows");
    expect(r.rows[0].comment).toBe("good");
    expect(r.rows[1].evidence).toBeNull();
    expect(rubricScore(r.rows, 5)).toBe(3.75); // 3 of 4 rubric points on a 5-mark question
  });

  it("rejects marks above a criterion's max and allows no rubric", () => {
    expect(sanitiseTeacherRubric([{ criterion: "x", max_marks: 2, awarded: 3 }]).ok).toBe(false);
    expect(sanitiseTeacherRubric([]).ok).toBe(false);
    expect(sanitiseTeacherRubric(undefined)).toEqual({ ok: true, rows: null });
  });
});

describe("differentiationModel", () => {
  it("asks only for the requested versions and passes class groups", () => {
    const p = buildDiffPrompt({ topic: "Fractions", materialType: "worksheet", versions: ["support", "challenge"], groupCounts: { remedial: 6, regular: 20, enrichment: 4 } });
    expect(p).toContain('"support"');
    expect(p).toContain('"challenge"');
    expect(p).not.toContain('"visual"');
    expect(p).toContain("6 need support");
  });

  it("keeps requested versions in order, drops empty ones and hides answers from students", () => {
    const pack = sanitiseDiffPack({
      title: "Fractions", learning_objective: "Add fractions",
      versions: [
        { key: "challenge", content: "Hard stuff", questions: [{ q: "Q1", answer: "A1" }] },
        { key: "support", content: "Easy stuff", questions: [] },
        { key: "visual", content: "" },
        { key: "bogus", content: "x" },
      ],
    }, ["support", "challenge", "visual"]);
    expect(pack?.versions.map((v) => v.key)).toEqual(["support", "challenge"]);
    const md = studentMarkdown(pack!, pack!.versions[1]);
    expect(md).toContain("Q1");
    expect(md).not.toContain("A1");
    expect(sanitiseDiffPack({ versions: [] }, ["core"])).toBeNull();
  });
});
