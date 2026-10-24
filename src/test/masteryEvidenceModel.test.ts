import { describe, it, expect } from "vitest";
import {
  MAX_DAYS, MAX_OBJECTIVES, buildNarrationPrompt, cleanRows, clampDays, explainSummary, groupByObjective,
  overallStats, parseNarration, rankSummaries, summariseObjective, toPercent, type EvidenceRow,
} from "../../supabase/functions/_shared/masteryEvidenceModel";

let t = 0;
const row = (objective: number, ok: boolean, before: number, after: number, source = "mcq"): EvidenceRow => ({
  learning_objective_id: objective, is_correct: ok, source, p_mastery_before: before, p_mastery_after: after,
  responded_at: new Date(Date.UTC(2026, 9, 1, 10, t++)).toISOString(),
});

describe("clampDays / toPercent", () => {
  it("keeps days between 1 and 90 and defaults to 30", () => {
    expect(clampDays(undefined)).toBe(30);
    expect(clampDays("abc")).toBe(30);
    expect(clampDays(0)).toBe(1);
    expect(clampDays(500)).toBe(MAX_DAYS);
    expect(clampDays(7)).toBe(7);
    expect(clampDays(7.6)).toBe(8);
  });
  it("turns estimates into whole percents and ignores odd values", () => {
    expect(toPercent(0.3)).toBe(30);
    expect(toPercent(0.856)).toBe(86);
    expect(toPercent(2)).toBe(100);
    expect(toPercent(-1)).toBe(0);
    expect(toPercent("x")).toBe(0);
    expect(toPercent(null)).toBe(0);
  });
});

describe("cleanRows", () => {
  it("drops rows with bad numbers, dates or flags and sorts oldest first", () => {
    const good1 = row(1, true, 0.3, 0.4);
    const good2 = row(1, false, 0.4, 0.3);
    const rows = cleanRows([
      good2, good1,
      { ...good1, learning_objective_id: "x" },
      { ...good1, p_mastery_after: "n/a" },
      { ...good1, responded_at: "not a date" },
      { ...good1, is_correct: "yes" },
      null,
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].responded_at <= rows[1].responded_at).toBe(true);
    expect(cleanRows("nope")).toEqual([]);
  });
});

describe("summariseObjective", () => {
  it("is null with no rows", () => {
    expect(summariseObjective(1, [])).toBeNull();
  });
  it("reports start, end, change and counts for a rising estimate", () => {
    const rows = [row(7, true, 0.3, 0.45), row(7, true, 0.45, 0.6), row(7, true, 0.6, 0.72), row(7, false, 0.72, 0.65)];
    const s = summariseObjective(7, rows)!;
    expect(s.start_pct).toBe(30);
    expect(s.end_pct).toBe(65);
    expect(s.change_pts).toBe(35);
    expect(s.direction).toBe("up");
    expect(s.attempts).toBe(4);
    expect(s.correct).toBe(3);
    expect(s.wrong).toBe(1);
    expect(s.best_run).toBe(3);
    expect(s.trailing_wrong).toBe(1);
    expect(s.recent).toEqual([true, true, true, false]);
    expect(s.top_source).toBe("mcq");
    expect(s.biggest_gain_pts).toBe(15);
    expect(s.biggest_drop_pts).toBe(-7);
  });
  it("reports a falling and a flat estimate", () => {
    const down = summariseObjective(1, [row(1, false, 0.6, 0.5), row(1, false, 0.5, 0.4)])!;
    expect(down.direction).toBe("down");
    expect(down.change_pts).toBe(-20);
    expect(down.trailing_wrong).toBe(2);
    const flat = summariseObjective(1, [row(1, true, 0.5, 0.51), row(1, false, 0.51, 0.5)])!;
    expect(flat.direction).toBe("flat");
  });
  it("keeps only the latest 10 answers in recent and finds the main source", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(2, i % 2 === 0, 0.4, 0.4, i < 8 ? "homework" : "mcq"));
    const s = summariseObjective(2, rows)!;
    expect(s.recent).toHaveLength(10);
    expect(s.top_source).toBe("homework");
  });
});

describe("explainSummary", () => {
  it("explains a rise using the real numbers and mentions a streak and the source", () => {
    const s = summariseObjective(7, [row(7, true, 0.3, 0.45, "homework"), row(7, true, 0.45, 0.6, "homework"), row(7, true, 0.6, 0.72, "homework")])!;
    const text = explainSummary(s).join(" ");
    expect(text).toContain("3 of 3 answers were correct");
    expect(text).toContain("from 30% to 72%");
    expect(text).toContain("3 correct answers in a row");
    expect(text).toContain("homework");
  });
  it("explains a fall and a wrong streak at the end", () => {
    const s = summariseObjective(1, [row(1, true, 0.6, 0.7), row(1, false, 0.7, 0.55), row(1, false, 0.55, 0.4), row(1, false, 0.4, 0.3)])!;
    const text = explainSummary(s).join(" ");
    expect(text).toContain("fell from 60% to 30%");
    expect(text).toContain("The last 3 answers were wrong");
    expect(text).not.toContain("in a row gave the biggest boost");
  });
  it("warns when there is very little evidence and says flat honestly", () => {
    const one = explainSummary(summariseObjective(1, [row(1, true, 0.3, 0.31)])!);
    expect(one.join(" ")).toContain("Only 1 answer so far");
    expect(one.join(" ")).toContain("stayed close to 31%");
  });
});

describe("rankSummaries / overallStats", () => {
  it("puts the biggest movers first and caps the list", () => {
    const list = Array.from({ length: 12 }, (_, i) => summariseObjective(i + 1, [row(i + 1, true, 0.3, 0.3 + i / 100 + 0.02)])!);
    const ranked = rankSummaries(list);
    expect(ranked).toHaveLength(MAX_OBJECTIVES);
    expect(Math.abs(ranked[0].change_pts)).toBeGreaterThanOrEqual(Math.abs(ranked[1].change_pts));
  });
  it("counts answers, accuracy and topics", () => {
    const rows = [row(1, true, 0.3, 0.4), row(1, false, 0.4, 0.3), row(2, true, 0.3, 0.4), row(2, true, 0.4, 0.5)];
    expect(overallStats(rows)).toEqual({ attempts: 4, correct: 3, accuracy_pct: 75, objectives: 2 });
    expect(overallStats([])).toEqual({ attempts: 0, correct: 0, accuracy_pct: 0, objectives: 0 });
    expect(groupByObjective(rows).get(2)).toHaveLength(2);
  });
});

describe("AI wording is limited to the facts", () => {
  const s = summariseObjective(7, [row(7, true, 0.3, 0.5), row(7, true, 0.5, 0.7)])!;
  it("the prompt holds numbers and the topic name, not a student name or free text", () => {
    const prompt = buildNarrationPrompt([{ objective_id: 7, objective_text: "Add fractions <b>now</b>", summary: s }], "\nLANGUAGE: Telugu");
    expect(prompt).toContain('"mastery_before_percent":30');
    expect(prompt).toContain('"mastery_now_percent":70');
    expect(prompt).toContain("Add fractions");
    expect(prompt).not.toContain("<b>");
    expect(prompt).toContain("Use ONLY these facts");
    expect(prompt).toContain("LANGUAGE: Telugu");
  });
  it("keeps only sentences for allowed ids, cleaned and capped", () => {
    const text = '```json\n{"summaries":[{"objective_id":7,"text":"Great <i>work</i> see https://x.com now"},{"objective_id":99,"text":"not allowed"},{"objective_id":7,"text":"duplicate"}]}\n```';
    const out = parseNarration(text, [7]);
    expect(Object.keys(out)).toEqual(["7"]);
    expect(out[7]).toBe("Great work see now");
    expect(parseNarration("not json", [7])).toEqual({});
    expect(parseNarration('{"summaries":"x"}', [7])).toEqual({});
    expect(parseNarration(JSON.stringify({ summaries: [{ objective_id: 7, text: "a".repeat(900) }] }), [7])[7]).toHaveLength(300);
  });
});

describe("learning evidence wiring", () => {
  it("the route is for students and parents, the sidebar links to it, and cat-session routes the action", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync("src/App.tsx", "utf8");
    const line = app.split("\n").find((l) => l.includes('path="/learning-evidence"')) ?? "";
    expect(line.includes("ProtectedRoute")).toBe(true);
    expect(line.includes('allowedRoles={["student", "parent"]}')).toBe(true);
    const sidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
    expect(sidebar.includes('path: "/learning-evidence"')).toBe(true);
    const router = readFileSync("supabase/functions/cat-session/index.ts", "utf8");
    expect(router.includes("mastery_evidence: { handler: handleMasteryEvidenceReport }")).toBe(true);
    expect(router.includes('from "../_shared/handlers/masteryEvidenceReport.ts"')).toBe(true);
  });
  it("the handler is read-only and checks who may look", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/_shared/handlers/masteryEvidenceReport.ts", "utf8");
    expect(/\.(insert|update|delete|upsert)\(/.test(src)).toBe(false);
    expect(src.includes('"parent_students"')).toBe(true);
    expect(src.includes('caller.role !== "student" && caller.role !== "parent"')).toBe(true);
  });
});
