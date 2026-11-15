// Keeps the client in step with the database scoring migration (the calculation itself is tested in
// supabase/tests/admission_lead_scoring.test.sql against a real Postgres).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  scoreCategory, DEFAULT_THRESHOLDS, CATEGORY_RANGES, INTERACTION_TYPES, INTEREST_LEVELS, AFFORDABILITY, TIMELINES, TRIGGER_LABELS, FACTOR_ORDER,
} from "@/lib/leadScoring";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261114000000_admission_lead_scoring.sql"), "utf8");
const listIn = (re: RegExp) => [...(sql.match(re)?.[1] ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1]);

describe("category boundaries (Hot 70-100, Warm 40-69, Cold 0-39)", () => {
  it.each([[0, "cold"], [39, "cold"], [40, "warm"], [69, "warm"], [70, "hot"], [100, "hot"]] as const)("%i -> %s", (n, c) => {
    expect(scoreCategory(n)).toBe(c);
  });
  it("defaults match the displayed ranges and the database defaults", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ hot: 70, warm: 40 });
    expect(CATEGORY_RANGES).toEqual({ hot: "70–100", warm: "40–69", cold: "0–39" });
    expect(sql).toContain("coalesce(c.hot_min, 70)");
    expect(sql).toContain("coalesce(c.warm_min, 40)");
  });
  it("honours custom thresholds", () => { expect(scoreCategory(85, { hot: 90, warm: 50 })).toBe("warm"); });
});

describe("defaults and factors", () => {
  it("default weights in SQL are 30/25/25/20 and the client knows the same four factors", () => {
    expect(sql).toContain(`'{"interest":30,"engagement":25,"readiness":25,"budget":20}'`);
    expect(FACTOR_ORDER).toEqual(["interest", "engagement", "readiness", "budget"]);
  });
});

describe("client options vs database constraints", () => {
  it("every interaction the UI can log is allowed by the event constraint AND the insert policy", () => {
    const constraint = listIn(/event_type in \(\s*('lead_created'[\s\S]*?)\)\);/);
    const policy = listIn(/event_type in \(('follow_up_note'[\s\S]*?)\)\s*\n\s*and \(created_by/);
    for (const t of INTERACTION_TYPES) { expect(constraint).toContain(t.value); expect(policy).toContain(t.value); }
    // system-only events must NOT be writable by staff
    for (const sys of ["lead_created", "repeat_enquiry", "status_changed"]) expect(policy).not.toContain(sys);
  });
  it("qualification dropdown values equal the table check constraints", () => {
    expect(listIn(/interest_level\s+text check \(interest_level in \(([^)]*)\)/)).toEqual(INTEREST_LEVELS.map((o) => o.value));
    expect(listIn(/fee_affordability text check \(fee_affordability in \(([^)]*)\)/)).toEqual(AFFORDABILITY.map((o) => o.value));
    expect(listIn(/admission_timeline text check \(admission_timeline in \(([^)]*)\)/)).toEqual(TIMELINES.map((o) => o.value));
  });
  it("every recalculation trigger source has a human label in the history view", () => {
    const sources = [...sql.matchAll(/adm_score(?:_intake)?_trigger\('(\w+)'\)/g)].map((m) => m[1]);
    const direct = [...sql.matchAll(/'(scheduled_refresh|config_changed|backfill|intake_fee_changed|before_manual_change)'/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThanOrEqual(6);
    for (const s of [...sources, ...direct]) expect(TRIGGER_LABELS[s], s).toBeTruthy();
  });
  it("clients cannot write scores, history or config (no write policies, writes revoked)", () => {
    expect(sql).toMatch(/revoke insert, update, delete, truncate on public\.admission_lead_qualification, public\.admission_score_config,\s*public\.admission_lead_scores, public\.admission_lead_score_history from anon, authenticated/);
    expect(sql).not.toMatch(/create policy \w+ on public\.admission_lead_scores\s+for (insert|update|delete)/);
  });
});
