import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

type Call = { op: string; rows?: unknown; patch?: unknown; id?: string };
const calls: Call[] = [];
let failRowNames = new Set<string>();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (rows: unknown) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        calls.push({ op: "insert", rows: arr });
        const bad = arr.some((r: { full_name: string }) => failRowNames.has(r.full_name));
        return Promise.resolve({ error: bad ? { message: "new row violates row-level security policy" } : null });
      },
      update: (patch: unknown) => ({ eq: (_c: string, id: string) => ({ eq: () => { calls.push({ op: "update", patch, id }); return Promise.resolve({ error: null }); } }) }),
    }),
  },
}));
vi.mock("@/hooks/useCourseStructure", () => ({ sb: {} }));

import { executeLeadImport } from "@/hooks/useLeadImport";
import { readLeadFile } from "@/lib/leadFiles";
import { autoMapColumns, validateLeadRow, type LeadPayload } from "@/lib/leadImport";

const payload = (n: string): LeadPayload => ({ intake_id: "i1", full_name: n, parent_name: "P", parent_phone: "9876543210", parent_email: null, date_of_birth: null, gender: null, source: "other", meeting_date: "2026-11-12", previous_school_name: null, previous_grade: null, address: null, status: "under_review", meeting_notes: null });
const fileOf = (parts: (string | Uint8Array | ArrayBuffer)[], name: string): File => {
  const chunks = parts.map((p) => (typeof p === "string" ? new TextEncoder().encode(p) : p instanceof Uint8Array ? p : new Uint8Array(p)));
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0; for (const c of chunks) { bytes.set(c, o); o += c.length; }
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as unknown as File;
};

beforeEach(() => { calls.length = 0; failRowNames = new Set(); });

describe("executeLeadImport", () => {
  it("inserts 250 rows in batches of 100 and reports progress", async () => {
    const inserts = Array.from({ length: 250 }, (_, i) => ({ rowNum: i + 2, payload: payload(`S${i}`) }));
    const prog: number[] = [];
    const out = await executeLeadImport({ userId: "u1", schoolId: "s1", inserts, updates: [], onProgress: (d) => prog.push(d) });
    expect(out).toMatchObject({ imported: 250, updated: 0, failed: [] });
    expect(calls.filter((c) => c.op === "insert")).toHaveLength(3);
    expect(prog.at(-1)).toBe(250);
    expect((calls[0].rows as { recorded_by: string }[])[0].recorded_by).toBe("u1");
  });
  it("retries a failed batch row by row so only the bad row fails", async () => {
    failRowNames = new Set(["BAD"]);
    const inserts = ["A", "BAD", "C"].map((n, i) => ({ rowNum: i + 2, payload: payload(n) }));
    const out = await executeLeadImport({ userId: "u1", schoolId: "s1", inserts, updates: [], onProgress: () => {} });
    expect(out.imported).toBe(2);
    expect(out.failed).toEqual([{ rowNum: 3, message: "Not allowed to add leads for this school" }]);
  });
  it("updates only blank fields and never status", async () => {
    const existing = { id: "e1", intake_id: "i1", full_name: "A", parent_phone: "9876543210", date_of_birth: null, parent_name: "Keep", parent_email: null, gender: null, previous_school_name: null, previous_grade: null, address: null, meeting_notes: null };
    const out = await executeLeadImport({ userId: "u1", schoolId: "s1", inserts: [], updates: [{ rowNum: 2, existing, payload: { ...payload("A"), parent_name: "Overwrite?", parent_email: "a@b.com", status: "rejected" } }], onProgress: () => {} });
    expect(out.updated).toBe(1);
    expect(calls[0]).toMatchObject({ op: "update", id: "e1", patch: { parent_email: "a@b.com" } });
    expect(calls[0].patch).not.toHaveProperty("parent_name");
    expect(calls[0].patch).not.toHaveProperty("status");
  });
});

describe("readLeadFile (real CSV and XLSX parsing)", () => {
  const intakes = [{ id: "i1", grade: "Class 1", academic_year: "2026-2027" }];
  it("reads a CSV with a BOM, quoted commas and formulas kept as text", async () => {
    const csv = "﻿Student Name,Parent Name,Phone,Class\r\n\"Rao, Asha\",Ravi,98765 43210,1\r\n=cmd|' /C calc'!A0,P2,9876543211,1\r\n";
    const { sheet, error } = await readLeadFile(fileOf([csv], "leads.csv"));
    expect(error).toBeUndefined();
    expect(sheet!.headers[0]).toBe("Student Name");
    expect(sheet!.rows[0][0]).toBe("Rao, Asha");
    expect(sheet!.rows[1][0]).toBe("=cmd|' /C calc'!A0");     // not evaluated
    const map = autoMapColumns(sheet!.headers);
    expect(validateLeadRow(sheet!.rows[0], 2, map, intakes, "2026-11-12").errors).toEqual([]);
  });
  it("reads an XLSX with numeric phones and Excel date serials", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["Student Name", "Parent Name", "Phone", "Class", "DOB"], ["Asha", "Ravi", 9876543210, "Class 1", 43631]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "S");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const { sheet, error } = await readLeadFile(fileOf([bytes], "leads.xlsx"));
    expect(error).toBeUndefined();
    const map = autoMapColumns(sheet!.headers);
    const r = validateLeadRow(sheet!.rows[0], 2, map, intakes, "2026-11-12");
    expect(r.errors).toEqual([]);
    expect(r.payload).toMatchObject({ parent_phone: "9876543210", date_of_birth: "2019-06-15" });
  });
  it("rejects empty, wrong-type and fake files", async () => {
    expect((await readLeadFile(fileOf([""], "e.csv"))).error).toMatch(/empty/);
    expect((await readLeadFile(fileOf(["x"], "a.pdf"))).error).toMatch(/Unsupported/);
    expect((await readLeadFile(fileOf(["not a zip"], "fake.xlsx"))).error).toMatch(/real \.xlsx/);
    expect((await readLeadFile(fileOf([new Uint8Array([0, 1, 2, 3])], "bin.csv"))).error).toMatch(/text CSV/);
    expect((await readLeadFile(fileOf(["Name,Phone\n"], "h.csv"))).error).toMatch(/no data rows/);
  });
  it("handles a 3,000-row file", async () => {
    const lines = ["Student Name,Parent Name,Phone,Class", ...Array.from({ length: 3000 }, (_, i) => `Student ${i},Parent ${i},98${String(10000000 + i)},1`)];
    const { sheet } = await readLeadFile(fileOf([lines.join("\n")], "big.csv"));
    expect(sheet!.rows).toHaveLength(3000);
  });
});
