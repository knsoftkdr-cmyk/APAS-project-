// Consent sheet for the school side - pure model (no network, no React).
// One row per parent + child. A category the parent has not answered shows as "pending" (No response).

import { CONSENT_CATEGORIES, type ConsentCategory, type ConsentStatus } from "@/lib/consentModel";

export interface SheetChild {
  studentId: string; // profiles.id of the child
  fullName: string;
  className: string;
  section: string;
}

export interface SheetLink {
  parentId: string;
  studentId: string;
}

export interface SheetParent {
  id: string;
  fullName: string;
}

export interface SheetConsent {
  parent_id: string;
  student_id: string;
  category: string;
  status: string;
}

export interface SheetRow {
  key: string;
  parentId: string;
  parentName: string;
  studentId: string;
  childName: string;
  className: string;
  section: string;
  statuses: Record<ConsentCategory, ConsentStatus>;
}

export const SHEET_STATUS_LABELS: Record<ConsentStatus, string> = {
  granted: "Allowed",
  denied: "Denied",
  pending: "No response",
};

/** Start from the parent-child links (so parents with no answer still get a row) and attach saved consents. */
export function buildSheetRows(
  children: SheetChild[],
  links: SheetLink[],
  parents: SheetParent[],
  consents: SheetConsent[],
): SheetRow[] {
  const childById = new Map(children.map((c) => [c.studentId, c]));
  const parentById = new Map(parents.map((p) => [p.id, p]));
  const saved = new Map<string, ConsentStatus>();
  for (const c of consents) {
    if (c.status === "granted" || c.status === "denied") {
      saved.set(`${c.parent_id}|${c.student_id}|${c.category}`, c.status);
    }
  }

  const rows: SheetRow[] = [];
  for (const link of links) {
    const child = childById.get(link.studentId);
    if (!child) continue; // child is not in this school, so it is not shown
    const statuses = {} as Record<ConsentCategory, ConsentStatus>;
    for (const cat of CONSENT_CATEGORIES) {
      statuses[cat.key] = saved.get(`${link.parentId}|${link.studentId}|${cat.key}`) ?? "pending";
    }
    rows.push({
      key: `${link.parentId}|${link.studentId}`,
      parentId: link.parentId,
      parentName: parentById.get(link.parentId)?.fullName || "Unknown parent",
      studentId: link.studentId,
      childName: child.fullName,
      className: child.className,
      section: child.section,
      statuses,
    });
  }

  const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  return rows.sort(
    (a, b) =>
      byText(a.className, b.className) || byText(a.section, b.section) || byText(a.childName, b.childName),
  );
}

export function sheetClasses(rows: SheetRow[]): string[] {
  const set = new Set(rows.map((r) => r.className).filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function filterByClass(rows: SheetRow[], className: string): SheetRow[] {
  return className ? rows.filter((r) => r.className === className) : rows;
}

// Names are typed by users, so a leading = + - @ is neutralised to stop spreadsheet formulas running.
function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: SheetRow[]): string {
  const header = ["Parent", "Child", "Class", "Section", ...CONSENT_CATEGORIES.map((c) => c.title)];
  const lines = rows.map((r) => [
    r.parentName,
    r.childName,
    r.className,
    r.section,
    ...CONSENT_CATEGORIES.map((c) => SHEET_STATUS_LABELS[r.statuses[c.key]]),
  ]);
  return [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
}