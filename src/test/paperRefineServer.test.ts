// Server side of Chat to Refine Questions: the Copilot refine path (runPaperRefine) and the paper-save path (build_paper "custom" items).
// The model and the database are faked; everything else is the real handler code.
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState: { admin: unknown } = { admin: null };
vi.mock("../../supabase/functions/_shared/learningGroupsData.ts", () => ({
  corsHeaders: {},
  json: (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } }),
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  authenticateStaff: async () => ({ ok: true, ctx: { admin: authState.admin, userId: "teacher-1" } }),
}));

import { runPaperRefine } from "../../supabase/functions/_shared/handlers/paperRefine";
import { handleBuildManualPaper } from "../../supabase/functions/_shared/handlers/buildManualPaper";

const q = (n: number, over: Record<string, unknown> = {}) => ({
  key: `mcq:00000000-0000-4000-8000-00000000000${n}`, type: "mcq", stem: `Question ${n} on fractions and decimals`, options: { A: "1", B: "2", C: "3", D: "4" },
  correct_option: "A", explanation: "e", difficulty: "easy", bloom_level: "apply", marks: 2, learning_objective_id: 11, ...over,
});
const paper = (qs = [q(1), q(2), q(3)], over: Record<string, unknown> = {}) => ({
  title: "T", class_name: "Class 8", subject: "Maths", chapter: "Fractions", target_total_marks: null, duration_minutes: 60, instructions: [],
  objectives: [{ id: 11, text: "Add fractions" }], questions: qs, ...over,
});
const goodQ = { type: "mcq", stem: "Which is largest?", options: { A: "1/2", B: "1/3", C: "1/4", D: "1/5" }, correct_option: "A", explanation: "e", difficulty: "hard", bloom_level: "apply", marks: 2, learning_objective_id: 11 };
const adminWithObjectives = { from: () => ({ select: () => ({ in: async () => ({ data: [{ id: 11 }], error: null }) }) }) };
const ctx = { admin: adminWithObjectives } as never;
const run = (callModel: (...a: never[]) => Promise<string>, p: unknown = paper(), message = "Make question 1 harder") =>
  runPaperRefine({ ctx, message, history: [], rawPaper: p, callModel: callModel as never });

describe("runPaperRefine (Copilot refine path)", () => {
  it("returns validated, paper-scoped suggestions (identifies Question 1 from the active paper)", async () => {
    const call = vi.fn().mockResolvedValue(JSON.stringify({ reply: "Done", suggestions: [{ action: "revise", question_number: 1, reason: "harder", question: goodQ }] }));
    const out = await run(call);
    expect(out.status).toBe(200);
    const b = out.body as { suggestions: Array<{ target_key: string; target_number: number }>; mode: string };
    expect(b.mode).toBe("paper_refine");
    expect(b.suggestions[0]).toMatchObject({ target_number: 1, target_key: q(1).key });
    // the model was given the real paper
    const system = call.mock.calls[0][0] as string;
    expect(system).toContain("Question 2 on fractions"); expect(system).toContain("Fractions");
  });
  it("retries once on malformed output and then succeeds", async () => {
    const call = vi.fn().mockResolvedValueOnce("Sorry, here is some prose {").mockResolvedValueOnce(JSON.stringify({ reply: "ok", suggestions: [{ action: "add", reason: "r", question: goodQ }] }));
    const out = await run(call);
    expect(call).toHaveBeenCalledTimes(2); expect(out.status).toBe(200);
  });
  it("fails safely when the output stays malformed - nothing is returned to apply", async () => {
    const call = vi.fn().mockResolvedValue("totally not json");
    const out = await run(call);
    expect(out.status).toBe(502); expect(out.body.code).toBe("ai_malformed"); expect(out.body.suggestions).toBeUndefined();
  });
  it("retries transient network/timeouts, then reports a clear error", async () => {
    const err = Object.assign(new Error("Could not reach the AI service. Please try again."), { status: 502, retryable: true });
    const call = vi.fn().mockRejectedValue(err);
    const out = await run(call);
    expect(call).toHaveBeenCalledTimes(2); expect(out.status).toBe(502); expect(String(out.body.error)).toMatch(/Could not reach/);
  });
  it("passes rate-limit / credit errors straight through without retrying", async () => {
    const call = vi.fn().mockRejectedValue(Object.assign(new Error("busy"), { status: 429 }));
    const out = await run(call); expect(call).toHaveBeenCalledTimes(1); expect(out.status).toBe(429);
  });
  it("discards suggestions that point outside the paper", async () => {
    const call = vi.fn().mockResolvedValue(JSON.stringify({ reply: "ok", suggestions: [{ action: "revise", question_number: 7, reason: "x", question: goodQ }, { action: "add", reason: "r", question: goodQ }] }));
    const out = await run(call);
    expect((out.body.suggestions as unknown[]).length).toBe(1); expect(String(out.body.warnings)).toMatch(/discarded/);
  });
  it("makes the model fix a total-marks breach, and preserves the total when it does", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ reply: "added", suggestions: [{ action: "add", reason: "r", question: goodQ }] }))
      .mockResolvedValueOnce(JSON.stringify({ reply: "balanced", suggestions: [{ action: "add", reason: "r", question: goodQ }, { action: "marks", question_number: 1, marks: 1, reason: "make room" }, { action: "marks", question_number: 2, marks: 1, reason: "make room" }] }));
    const out = await run(call, paper([q(1), q(2), q(3)], { target_total_marks: 6 }), "add one more question, keep 6 marks");
    expect(call).toHaveBeenCalledTimes(2);
    expect((out.body.total_check as { ok: boolean }).ok).toBe(true);
  });
  it("surfaces a total-marks conflict honestly when the model cannot resolve it", async () => {
    const call = vi.fn().mockResolvedValue(JSON.stringify({ reply: "added", suggestions: [{ action: "add", reason: "r", question: goodQ }] }));
    const out = await run(call, paper([q(1), q(2), q(3)], { target_total_marks: 6 }));
    expect((out.body.total_check as { ok: boolean; projected: number }).ok).toBe(false);
    expect(String(out.body.warnings)).toMatch(/total from 6 to 8/);
  });
  it("returns a clarification (conflicting instructions) with no changes", async () => {
    const call = vi.fn().mockResolvedValue(JSON.stringify({ reply: "", clarification: "Which marks should shrink?", suggestions: [] }));
    const out = await run(call);
    expect(out.body.clarification).toBe("Which marks should shrink?"); expect(out.body.suggestions).toEqual([]);
  });
  it("rejects a malformed paper payload before calling the model", async () => {
    const call = vi.fn();
    const out = await run(call, { questions: "nope" });
    expect(out.status).toBe(400); expect(call).not.toHaveBeenCalled();
  });
  it("unknown learning-objective ids are not trusted", async () => {
    const call = vi.fn().mockResolvedValue(JSON.stringify({ reply: "ok", suggestions: [{ action: "add", reason: "r", question: { ...goodQ, learning_objective_id: 11 } }] }));
    const out = await run(call, paper([q(1)], { objectives: [{ id: 11, text: "a" }, { id: 5555, text: "fake" }] }));
    expect(String(call.mock.calls[0][0])).not.toContain("5555"); expect(out.status).toBe(200);
  });
});

// ── build_paper with refined ("custom") questions ───────────────────────────────────────────────────────
function fakeDb(opts: { dupExisting?: Record<string, unknown> } = {}) {
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
  const deleted: Array<{ table: string; id: string }> = [];
  let n = 0;
  const bankRows = new Map<string, Record<string, unknown>>([["00000000-0000-4000-8000-000000000001", { status: "active", quality_flag: null }]]);
  const admin = {
    from(table: string) {
      return {
        select: (_c: string) => ({
          in: async (_col: string, ids: unknown[]) => {
            if (table === "learning_objectives") return { data: ids.filter((i) => i === 11).map((id) => ({ id })), error: null, eq: undefined };
            return { data: ids.filter((i) => bankRows.has(String(i))).map((id) => ({ id, ...bankRows.get(String(id)) })), error: null };
          },
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.dupExisting ?? null }) }) }),
        }),
        insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
          if (table === "generated_assessment_papers") return { select: () => ({ single: async () => ({ data: { id: "paper-1" }, error: null }) }) };
          if (table === "generated_assessment_paper_items") { inserted.push({ table, row: row as never }); return Promise.resolve({ error: null }); }
          if (opts.dupExisting) return { select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "dup" } }) }) };
          return { select: () => ({ single: async () => { inserted.push({ table, row: row as never }); return { data: { id: `new-${++n}` }, error: null }; } }) };
        },
        delete: () => ({ eq: async (_c: string, id: string) => { deleted.push({ table, id }); return { error: null }; } }),
      };
    },
  };
  return { admin, inserted, deleted };
}
// `.in("id", ids)` on learning_objectives is followed by `.eq("status","active")` in the handler
function patchLo(admin: { from: (t: string) => Record<string, unknown> }) {
  const orig = admin.from;
  admin.from = (t: string) => {
    const base = orig(t) as { select: (c: string) => { in: (c: string, ids: unknown[]) => Promise<unknown> } };
    if (t !== "learning_objectives") return base;
    return { ...base, select: () => ({ in: () => ({ eq: async () => ({ data: [{ id: 11 }], error: null }) }) }) };
  };
}
const call = async (items: unknown[]) => {
  const res = await handleBuildManualPaper(new Request("http://x", { method: "POST", body: JSON.stringify({ title: "Test", items }) }));
  return { status: res.status, body: await res.json() };
};

describe("build_paper with refined questions", () => {
  beforeEach(() => { authState.admin = null; });
  it("stores an approved AI question as a NEW bank row and never edits the original", async () => {
    const db = fakeDb(); patchLo(db.admin as never); authState.admin = db.admin;
    const r = await call([{ kind: "mcq", id: "00000000-0000-4000-8000-000000000001", marks: 1 }, { kind: "custom", question: goodQ, marks: 2 }]);
    expect(r.status).toBe(200); expect(r.body.total_marks).toBe(3); expect(r.body.item_count).toBe(2);
    const bank = db.inserted.find((i) => i.table === "question_bank")!;
    expect(bank.row).toMatchObject({ learning_objective_id: 11, correct_option: "A", status: "active", created_by: "teacher-1", generation_model: "teacher-refine", irt_b: 1 });
    expect(db.deleted).toEqual([]);
  });
  it("validates custom questions on the server (malformed AI/edited content can't be saved)", async () => {
    const db = fakeDb(); patchLo(db.admin as never); authState.admin = db.admin;
    const bad = await call([{ kind: "custom", question: { ...goodQ, options: { A: "x", B: "x", C: "y", D: "z" } }, marks: 2 }]);
    expect(bad.status).toBe(400); expect(db.inserted.filter((i) => i.table === "question_bank")).toHaveLength(0);
    const noLo = await call([{ kind: "custom", question: { ...goodQ, learning_objective_id: null }, marks: 2 }]);
    expect(noLo.status).toBe(400);
  });
  it("refuses a same-wording-different-answer collision rather than reusing the wrong row", async () => {
    const db = fakeDb({ dupExisting: { id: "old", status: "active", options: { A: "9" }, correct_option: "B" } }); patchLo(db.admin as never); authState.admin = db.admin;
    const r = await call([{ kind: "custom", question: goodQ, marks: 2 }]);
    expect(r.status).toBe(409);
  });
  it("legacy bank-id items still work exactly as before", async () => {
    const db = fakeDb(); authState.admin = db.admin;
    const r = await call([{ kind: "mcq", id: "00000000-0000-4000-8000-000000000001", marks: 2 }]);
    expect(r.status).toBe(200); expect(r.body.total_marks).toBe(2);
  });
});
