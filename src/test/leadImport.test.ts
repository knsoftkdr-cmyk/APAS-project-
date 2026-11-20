import { describe, expect, it } from "vitest";
import {
  autoMapColumns, buildCsv, classKey, csvSafe, detectDuplicates, exportFileName, failedReportCsv, missingRequiredMappings, normalizePhone,
  parseLeadDate, safeUpdatePatch, shapeSheet, templateCsv, validateImportFile, validateLeadRow, yearKey, type FieldMapping, type IntakeRef, type RowResult,
} from "@/lib/leadImport";

const intakes: IntakeRef[] = [
  { id: "i1", grade: "Class 1", academic_year: "2026-2027" },
  { id: "i2", grade: "Class 5", academic_year: "2026-2027" },
  { id: "i3", grade: "Class 5", academic_year: "2027-2028" },
];
const headers = ["Student Name", "Parent Name", "Phone", "Email", "DOB", "Gender", "Class", "Academic Year", "Enquiry Date", "Source", "Status", "Remarks"];
const map = autoMapColumns(headers);
const TODAY = "2026-11-12";
const row = (o: Partial<Record<string, string>> = {}, n = 2) => {
  const base: Record<string, string> = { "Student Name": "Asha Rao", "Parent Name": "Ravi Rao", Phone: "98765 43210", Email: "ravi@x.com", DOB: "15/06/2019", Gender: "Female", Class: "1", "Academic Year": "2026-27", "Enquiry Date": "10/11/2026", Source: "Walk-in", Status: "", Remarks: "" };
  return validateLeadRow(headers.map((h) => ({ ...base, ...o })[h] ?? ""), n, map, intakes, TODAY);
};

describe("file checks", () => {
  it("rejects bad files", () => {
    expect(validateImportFile({ name: "a.xls", size: 10 })).toMatch(/\.xlsx or \.csv/);
    expect(validateImportFile({ name: "a.pdf", size: 10 })).toMatch(/Unsupported/);
    expect(validateImportFile({ name: "a.csv", size: 0 })).toMatch(/empty/);
    expect(validateImportFile({ name: "a.csv", size: 6 * 1024 * 1024 })).toMatch(/too large/);
    expect(validateImportFile({ name: "A.CSV", size: 100 })).toBeNull();
    expect(validateImportFile({ name: "a.xlsx", size: 100 })).toBeNull();
  });
  it("shapes sheets and rejects empty ones", () => {
    expect(shapeSheet([]).error).toMatch(/No data/);
    expect(shapeSheet([["A", "B"]]).error).toMatch(/no data rows/);
    expect(shapeSheet([[], ["A", "B"], ["1", ""], ["", ""], [2, null]]).sheet?.rows).toEqual([["1", ""], ["2", ""]]);
    expect(shapeSheet([["A"], ...Array.from({ length: 5001 }, () => ["x"])]).error).toMatch(/Too many rows/);
  });
});

describe("column mapping", () => {
  it("maps common headings automatically", () => {
    expect(map.student_name).toBe(0); expect(map.parent_phone).toBe(2); expect(map.class).toBe(6); expect(map.academic_year).toBe(7);
    expect(missingRequiredMappings(map)).toHaveLength(0);
    expect(missingRequiredMappings(autoMapColumns(["Name", "Foo"])).map((f) => f.key)).toEqual(["parent_name", "parent_phone", "class"]);
  });
  it("uses each column once", () => {
    const m = autoMapColumns(["Name", "Parent Name"]);
    expect(m.student_name).toBe(0); expect(m.parent_name).toBe(1);
  });
});

describe("normalisers", () => {
  it("class and year keys", () => {
    expect(classKey("Class 05")).toBe("5"); expect(classKey("5th")).toBe("5"); expect(classKey("Grade V")).toBe("v"); expect(classKey("UKG")).toBe("ukg");
    expect(yearKey("2026-27")).toBe("2026"); expect(yearKey("AY 2027/2028")).toBe("2027"); expect(yearKey("next")).toBe("");
  });
  it("phones", () => {
    expect(normalizePhone("98765 43210")).toEqual({ value: "9876543210", ok: true });
    expect(normalizePhone("+91-98765-43210").value).toBe("+919876543210");
    expect(normalizePhone("12345").ok).toBe(false);
    expect(normalizePhone("abcdefghij").ok).toBe(false);
    expect(normalizePhone("98765x43210").ok).toBe(false);
  });
  it("dates", () => {
    expect(parseLeadDate("15/06/2019")).toBe("2019-06-15");
    expect(parseLeadDate("2019-06-15")).toBe("2019-06-15");
    expect(parseLeadDate("15.6.2019")).toBe("2019-06-15");
    expect(parseLeadDate("31/02/2019")).toBeNull();
    expect(parseLeadDate("43831")).toBe("2020-01-01");
    expect(parseLeadDate("soon")).toBeNull();
  });
});

describe("row validation", () => {
  it("accepts a good row and builds the payload", () => {
    const r = row();
    expect(r.errors).toEqual([]);
    expect(r.payload).toMatchObject({ intake_id: "i1", full_name: "Asha Rao", parent_phone: "9876543210", date_of_birth: "2019-06-15", gender: "female", source: "walk_in", status: "under_review", meeting_date: "2026-11-10" });
  });
  it("flags each kind of problem", () => {
    expect(row({ "Student Name": "" }).errors).toContain("Student name is required");
    expect(row({ Phone: "123" }).errors.join()).toMatch(/Invalid phone/);
    expect(row({ Phone: "" }).errors.join()).toMatch(/phone is required/);
    expect(row({ Email: "nope" }).errors).toContain("Invalid email address");
    expect(row({ DOB: "99/99/2019" }).errors.join()).toMatch(/date of birth/);
    expect(row({ DOB: "01/01/2030" }).errors.join()).toMatch(/in the past/);
    expect(row({ Gender: "x" }).errors.join()).toMatch(/Gender/);
    expect(row({ Class: "9" }).errors.join()).toMatch(/No admission intake exists/);
    expect(row({ "Academic Year": "2030-31" }).errors.join()).toMatch(/No intake for class/);
    expect(row({ "Academic Year": "soon" }).errors.join()).toMatch(/Invalid academic year/);
    expect(row({ Status: "maybe" }).errors).toContain("Unknown lead status");
    expect(row({ "Enquiry Date": "01/01/2099" }).errors.join()).toMatch(/future/);
    expect(row({ "Student Name": "SAMPLE - delete this row" }).errors.join()).toMatch(/sample row/);
  });
  it("needs an academic year only when a class has several intakes", () => {
    expect(row({ Class: "1", "Academic Year": "" }).payload?.intake_id).toBe("i1");
    expect(row({ Class: "5", "Academic Year": "" }).errors.join()).toMatch(/several intakes/);
    expect(row({ Class: "Grade 5", "Academic Year": "2027-28" }).payload?.intake_id).toBe("i3");
  });
  it("warns on unknown source but still imports", () => {
    const r = row({ Source: "billboard" });
    expect(r.errors).toEqual([]); expect(r.payload?.source).toBe("other"); expect(r.warnings.join()).toMatch(/Unknown source/);
  });
});

describe("duplicates", () => {
  const ok = (rowNum: number, over: Partial<Record<string, string>> = {}): RowResult => ({ ...row(over, rowNum) });
  it("catches duplicates inside the file but allows siblings", () => {
    const rows = [ok(2), ok(3), ok(4, { "Student Name": "Anu Rao" }), ok(5, { "Student Name": " ASHA  rao. " })];
    const d = detectDuplicates(rows, [], intakes);
    expect(d.get(2)?.kind).toBe("none");
    expect(d.get(3)).toEqual({ kind: "in_file", firstRow: 2 });
    expect(d.get(4)?.kind).toBe("none");          // sibling: same phone, different name
    expect(d.get(5)?.kind).toBe("in_file");       // same name after normalising
  });
  it("catches existing leads (same year) but not other years or other children", () => {
    const existing = [{ id: "e1", intake_id: "i1", full_name: "asha rao", parent_phone: "+919876543210", date_of_birth: null }];
    expect(detectDuplicates([ok(2)], existing, intakes).get(2)).toEqual({ kind: "existing", existingId: "e1" });
    expect(detectDuplicates([ok(2, { Class: "5", "Academic Year": "2026-27" })], existing, intakes).get(2)?.kind).toBe("existing"); // same year, other class
    expect(detectDuplicates([ok(2, { Class: "5", "Academic Year": "2027-28" })], existing, intakes).get(2)?.kind).toBe("none");
    expect(detectDuplicates([ok(2)], [{ ...existing[0], date_of_birth: "2018-01-01" }], intakes).get(2)?.kind).toBe("none");     // different DOB
  });
  it("update mode only fills empty fields", () => {
    const p = row().payload!;
    const patch = safeUpdatePatch({ parent_name: "Existing Parent", parent_email: null, address: "", date_of_birth: "2019-06-15", gender: null }, p);
    expect(patch).toEqual({ parent_email: "ravi@x.com", gender: "female" });
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("parent_name");
  });
});

describe("CSV safety", () => {
  it("neutralises formulas but keeps phones and numbers", () => {
    expect(csvSafe("=HYPERLINK(\"http://evil\")")).toBe("'=HYPERLINK(\"http://evil\")");
    expect(csvSafe("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvSafe("+cmd|' /C calc'!A0")).toMatch(/^'\+/);
    expect(csvSafe("-2+3")).toBe("'-2+3");   // arithmetic-looking text is neutralised too
    expect(csvSafe("-1+cmd")).toMatch(/^'/);
    expect(csvSafe("+91 98765 43210")).toBe("+91 98765 43210");
    expect(csvSafe("-5")).toBe("-5");
    expect(csvSafe("Asha")).toBe("Asha");
    expect(csvSafe(null)).toBe("");
  });
  it("builds quoted CSV with BOM", () => {
    const csv = buildCsv(["A", "B"], [["x,y", "=1+1"], ['q"t', "ok"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"x,y",\'=1+1');
    expect(csv).toContain('"q""t",ok');
  });
  it("template has a flagged sample row, and failed report carries errors", () => {
    expect(templateCsv()).toContain("SAMPLE - delete this row");
    expect(failedReportCsv(["Name"], [{ rowNum: 3, cells: ["Bob"], messages: ["Invalid phone", "No class"] }])).toContain("Invalid phone; No class");
  });
  it("names export files clearly", () => {
    expect(exportFileName("all", "xlsx")).toBe("APAS_All_Admission_Leads.xlsx");
    expect(exportFileName("selected", "csv")).toBe("APAS_Selected_Leads.csv");
    expect(exportFileName("filtered", "xlsx", { status: "Under Review", year: "2026-2027" })).toBe("APAS_Under_Review_2026_2027_Leads.xlsx");
    expect(exportFileName("filtered", "csv")).toBe("APAS_Filtered_Leads.csv");
  });
});
