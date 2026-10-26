import { describe, expect, it } from "vitest";
import {
  buildSheetRows,
  filterByClass,
  sheetClasses,
  toCsv,
  type SheetChild,
  type SheetConsent,
  type SheetLink,
  type SheetParent,
} from "../lib/consentSheetModel";

const children: SheetChild[] = [
  { studentId: "s1", fullName: "Varun Gupta", className: "Class 6", section: "A" },
  { studentId: "s2", fullName: "Pooja Patel", className: "Class 1", section: "B" },
];
const parents: SheetParent[] = [
  { id: "p1", fullName: "Tejarani" },
  { id: "p2", fullName: "=Evil Parent" },
];
const links: SheetLink[] = [
  { parentId: "p1", studentId: "s1" },
  { parentId: "p2", studentId: "s2" },
  { parentId: "p1", studentId: "other-school-child" },
];
const consents: SheetConsent[] = [
  { parent_id: "p1", student_id: "s1", category: "photos", status: "granted" },
  { parent_id: "p1", student_id: "s1", category: "field_trips", status: "denied" },
];

describe("consent sheet", () => {
  it("gives a row to every link, even with no saved answer", () => {
    const rows = buildSheetRows(children, links, parents, consents);
    expect(rows).toHaveLength(2);
    const pooja = rows.find((r) => r.childName === "Pooja Patel")!;
    expect(Object.values(pooja.statuses).every((s) => s === "pending")).toBe(true);
  });

  it("shows Allowed, Denied and No response correctly", () => {
    const varun = buildSheetRows(children, links, parents, consents).find((r) => r.childName === "Varun Gupta")!;
    expect(varun.statuses.photos).toBe("granted");
    expect(varun.statuses.field_trips).toBe("denied");
    expect(varun.statuses.activities).toBe("pending");
    expect(varun.statuses.data_use).toBe("pending");
  });

  it("skips children that are not in this school", () => {
    const rows = buildSheetRows(children, links, parents, consents);
    expect(rows.some((r) => r.studentId === "other-school-child")).toBe(false);
  });

  it("sorts by class and filters by class", () => {
    const rows = buildSheetRows(children, links, parents, consents);
    expect(rows[0].className).toBe("Class 1");
    expect(sheetClasses(rows)).toEqual(["Class 1", "Class 6"]);
    expect(filterByClass(rows, "Class 6")).toHaveLength(1);
    expect(filterByClass(rows, "")).toHaveLength(2);
  });

  it("makes a safe CSV", () => {
    const csv = toCsv(buildSheetRows(children, links, parents, consents));
    expect(csv.split("\n")[0]).toContain("Parent,Child,Class,Section");
    expect(csv).toContain("'=Evil Parent");
    expect(csv).toContain("Allowed");
    expect(csv).toContain("Denied");
    expect(csv).toContain("No response");
  });
});