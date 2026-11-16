// CRM & Admissions bulk lead import/export: parsing, mapping, validation, duplicate detection and file-safety helpers.
// Pure functions only (no I/O) so they can be unit-tested. A "lead" is an admission_applicants row.
import type { ApplicantGender, ApplicantSource, ApplicantStatus } from "@/types/admission";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_COLUMNS = 60;

export type LeadFieldKey =
  | "student_name" | "parent_name" | "parent_phone" | "parent_email" | "date_of_birth" | "gender" | "class" | "academic_year"
  | "enquiry_date" | "source" | "previous_school" | "previous_grade" | "address" | "status" | "remarks";

export interface LeadFieldDef { key: LeadFieldKey; label: string; required: boolean; aliases: string[]; hint: string }

export const LEAD_FIELDS: LeadFieldDef[] = [
  { key: "student_name", label: "Student Name", required: true, aliases: ["studentname", "name", "childname", "applicantname", "fullname", "student"], hint: "Required" },
  { key: "parent_name", label: "Parent / Guardian Name", required: true, aliases: ["parentname", "guardianname", "parentguardianname", "parent", "guardian", "fathername", "mothername"], hint: "Required" },
  { key: "parent_phone", label: "Parent Phone", required: true, aliases: ["parentphone", "phone", "phonenumber", "mobile", "mobilenumber", "contactnumber", "parentmobile", "guardianphone"], hint: "Required, 7-15 digits" },
  { key: "parent_email", label: "Parent Email", required: false, aliases: ["parentemail", "email", "emailaddress", "guardianemail"], hint: "Optional" },
  { key: "date_of_birth", label: "Student Date of Birth", required: false, aliases: ["dateofbirth", "dob", "birthdate", "studentdob", "studentdateofbirth"], hint: "DD/MM/YYYY or YYYY-MM-DD" },
  { key: "gender", label: "Gender", required: false, aliases: ["gender", "sex"], hint: "Male / Female / Other" },
  { key: "class", label: "Interested Class", required: true, aliases: ["class", "interestedclass", "grade", "classapplyingfor", "gradeappliedfor", "classappliedfor", "applyingfor", "standard"], hint: "Required; must match an admission intake" },
  { key: "academic_year", label: "Academic Year", required: false, aliases: ["academicyear", "year", "session", "intakeyear", "admissionyear"], hint: "e.g. 2026-2027; needed if a class has several intakes" },
  { key: "enquiry_date", label: "Admission Enquiry Date", required: false, aliases: ["enquirydate", "admissionenquirydate", "inquirydate", "meetingdate", "dateofenquiry", "date"], hint: "Defaults to today" },
  { key: "source", label: "Source of Enquiry", required: false, aliases: ["source", "enquirysource", "sourceofenquiry", "leadsource", "inquirysource"], hint: "Walk-in, Referral, Phone Enquiry, Online Enquiry, Other" },
  { key: "previous_school", label: "Previous School", required: false, aliases: ["previousschool", "previousschoolname", "lastschool", "currentschool"], hint: "Optional" },
  { key: "previous_grade", label: "Previous Class", required: false, aliases: ["previousgrade", "previousclass", "lastclass", "currentclass"], hint: "Optional" },
  { key: "address", label: "Address", required: false, aliases: ["address", "homeaddress", "residence"], hint: "Optional" },
  { key: "status", label: "Lead Status", required: false, aliases: ["status", "leadstatus", "applicantstatus"], hint: "Defaults to Under Review" },
  { key: "remarks", label: "Remarks", required: false, aliases: ["remarks", "notes", "comments", "meetingnotes", "note"], hint: "Optional" },
];

export type FieldMapping = Partial<Record<LeadFieldKey, number>>;   // field -> column index in the file

export const normHeader = (h: unknown) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Best-effort automatic mapping; each file column is used at most once. */
export function autoMapColumns(headers: string[]): FieldMapping {
  const used = new Set<number>();
  const map: FieldMapping = {};
  const norm = headers.map(normHeader);
  for (const f of LEAD_FIELDS) {                       // exact label/key first, then aliases
    const keys = [normHeader(f.label), normHeader(f.key), ...f.aliases];
    const idx = norm.findIndex((h, i) => !used.has(i) && h !== "" && keys.includes(h));
    if (idx >= 0) { map[f.key] = idx; used.add(idx); }
  }
  return map;
}

export function missingRequiredMappings(map: FieldMapping): LeadFieldDef[] {
  return LEAD_FIELDS.filter((f) => f.required && map[f.key] == null);
}

// ---------------------------------------------------------------- file checks
export function validateImportFile(file: { name: string; size: number }): string | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "xls") return "Old .xls files aren't supported. Open it in Excel and save as .xlsx or .csv, then upload again.";
  if (!["csv", "xlsx"].includes(ext)) return "Unsupported file type. Upload a .csv or .xlsx file.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_IMPORT_BYTES) return `File is too large (limit ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB).`;
  return null;
}

export interface ParsedSheet { headers: string[]; rows: string[][] }

/** Turns a raw 2-D array (from CSV/XLSX) into trimmed strings, drops fully empty rows and enforces size limits. */
export function shapeSheet(raw: unknown[][]): { sheet?: ParsedSheet; error?: string } {
  const grid = raw.map((r) => (Array.isArray(r) ? r : []));
  const firstIdx = grid.findIndex((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (firstIdx < 0) return { error: "No data found in this file." };
  const headers = grid[firstIdx].map((c) => String(c ?? "").trim());
  if (headers.length > MAX_IMPORT_COLUMNS) return { error: `Too many columns (limit ${MAX_IMPORT_COLUMNS}).` };
  const body = grid.slice(firstIdx + 1)
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .map((r) => headers.map((_, i) => cellToString(r[i])));
  if (body.length === 0) return { error: "The file has headings but no data rows." };
  if (body.length > MAX_IMPORT_ROWS) return { error: `Too many rows (${body.length}). Split the file into parts of at most ${MAX_IMPORT_ROWS} rows.` };
  return { sheet: { headers, rows: body } };
}

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isFinite(v) ? (Number.isInteger(v) ? String(v) : String(v)) : "";
  // eslint-disable-next-line no-control-regex
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}

// ---------------------------------------------------------------- normalisers
export const classKey = (v: string) =>
  v.toLowerCase().replace(/(class|grade|standard|std)/g, "").replace(/[^a-z0-9]/g, "").replace(/^0+(?=\d)/, "").replace(/^(\d+)(st|nd|rd|th)$/, "$1");

/** First 4-digit year found: "2026-27", "2026/2027", "AY 2026" all become "2026". */
export const yearKey = (v: string) => (v.match(/(19|20)\d{2}/)?.[0] ?? "");

export const nameKey = (v: string) => v.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export function normalizePhone(v: string): { value: string; ok: boolean } {
  const s = v.trim();
  if (!s) return { value: "", ok: false };
  if (/[a-df-wyz]/i.test(s.replace(/e\+?\d+$/i, ""))) return { value: s, ok: false };   // letters (extensions like "x" are rejected)
  const digits = s.replace(/\D/g, "");
  const ok = digits.length >= 7 && digits.length <= 15 && /^\+?[\d\s().-]+$/.test(s);
  return { value: ok ? (s.startsWith("+") ? "+" : "") + digits : s, ok };
}
export const phoneKey = (v: string) => v.replace(/\D/g, "").slice(-10);

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;

/** Parses DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD and Excel serial numbers. Returns ISO yyyy-mm-dd or null. */
export function parseLeadDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/))) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) { d = +r[1]; m = +r[2]; y = +r[3]; }
  else if (/^\d{5}(\.\d+)?$/.test(s) && +s > 1 && +s < 80000) {          // Excel serial (1900 date system)
    const dt = new Date(Math.round((+s - 25569) * 86400000));
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const GENDER: Record<string, ApplicantGender> = { m: "male", male: "male", boy: "male", f: "female", female: "female", girl: "female", o: "other", other: "other" };
const SOURCE: Record<string, ApplicantSource> = {
  walkin: "walk_in", walkins: "walk_in", visit: "walk_in", referral: "referral", referred: "referral", reference: "referral",
  phone: "phone_enquiry", phoneenquiry: "phone_enquiry", call: "phone_enquiry", telephone: "phone_enquiry",
  online: "online_enquiry", onlineenquiry: "online_enquiry", website: "online_enquiry", web: "online_enquiry", other: "other",
};
const STATUS: Record<string, ApplicantStatus> = {
  underreview: "under_review", new: "under_review", open: "under_review", shortlisted: "shortlisted", selected: "selected",
  waitlisted: "waitlisted", waitlist: "waitlisted", rejected: "rejected", admitted: "admitted", withdrawn: "withdrawn",
};

// ---------------------------------------------------------------- row validation
export interface IntakeRef { id: string; grade: string; academic_year: string }
export interface LeadPayload {
  intake_id: string; full_name: string; parent_name: string; parent_phone: string; parent_email: string | null;
  date_of_birth: string | null; gender: ApplicantGender | null; source: ApplicantSource; meeting_date: string;
  previous_school_name: string | null; previous_grade: string | null; address: string | null; status: ApplicantStatus; meeting_notes: string | null;
}
export interface RowResult {
  rowNum: number;                 // 1-based row number as the user sees it in the file (header = row 1)
  cells: string[];
  errors: string[]; warnings: string[];
  payload?: LeadPayload;
}

const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

export function validateLeadRow(cells: string[], rowNum: number, map: FieldMapping, intakes: IntakeRef[], todayIso: string): RowResult {
  const get = (k: LeadFieldKey) => (map[k] == null ? "" : (cells[map[k]!] ?? "").trim());
  const errors: string[] = [], warnings: string[] = [];

  const name = clip(get("student_name"), 200);
  const parent = clip(get("parent_name"), 200);
  if (!name) errors.push("Student name is required");
  else if (/^sample\b/i.test(name)) errors.push("This is the sample row from the template - remove it");
  if (!parent) errors.push("Parent/guardian name is required");

  const ph = normalizePhone(get("parent_phone"));
  if (!get("parent_phone")) errors.push("Parent phone is required");
  else if (!ph.ok) errors.push("Invalid phone number (use 7-15 digits)");

  const email = get("parent_email");
  if (email && !isEmail(email)) errors.push("Invalid email address");

  let dob: string | null = null;
  if (get("date_of_birth")) {
    dob = parseLeadDate(get("date_of_birth"));
    if (!dob) errors.push("Invalid date of birth (use DD/MM/YYYY or YYYY-MM-DD)");
    else if (dob >= todayIso) errors.push("Date of birth must be in the past");
    else if (+todayIso.slice(0, 4) - +dob.slice(0, 4) > 25) errors.push("Date of birth is not plausible for a student");
  }

  let gender: ApplicantGender | null = null;
  if (get("gender")) {
    gender = GENDER[normHeader(get("gender"))] ?? null;
    if (!gender) errors.push("Gender must be Male, Female or Other");
  }

  let meeting = todayIso;
  if (get("enquiry_date")) {
    const d = parseLeadDate(get("enquiry_date"));
    if (!d) errors.push("Invalid enquiry date (use DD/MM/YYYY or YYYY-MM-DD)");
    else if (d > addDays(todayIso, 365)) errors.push("Enquiry date is too far in the future");
    else meeting = d;
  }

  let source: ApplicantSource = "other";
  if (get("source")) {
    const s = SOURCE[normHeader(get("source"))];
    if (s) source = s; else warnings.push(`Unknown source "${clip(get("source"), 30)}" - saved as Other`);
  } else warnings.push("No source given - saved as Other");

  let status: ApplicantStatus = "under_review";
  if (get("status")) {
    const s = STATUS[normHeader(get("status"))];
    if (s) status = s; else errors.push("Unknown lead status");
  }

  // class + academic year -> an existing admission intake
  let intakeId = "";
  const cls = get("class"), yr = get("academic_year");
  if (!cls) errors.push("Interested class is required");
  else {
    const byClass = intakes.filter((i) => classKey(i.grade) === classKey(cls));
    if (byClass.length === 0) errors.push(`No admission intake exists for class "${clip(cls, 30)}"`);
    else if (yr) {
      const hit = byClass.filter((i) => yearKey(i.academic_year) === yearKey(yr) && yearKey(yr) !== "");
      if (hit.length === 1) intakeId = hit[0].id;
      else if (yearKey(yr) === "") errors.push(`Invalid academic year "${clip(yr, 20)}"`);
      else errors.push(`No intake for class "${clip(cls, 30)}" in academic year "${clip(yr, 20)}"`);
    } else if (byClass.length === 1) { intakeId = byClass[0].id; warnings.push(`No academic year given - using ${byClass[0].academic_year}`); }
    else errors.push(`Academic year is needed: class "${clip(cls, 30)}" has several intakes (${byClass.map((i) => i.academic_year).join(", ")})`);
  }

  const res: RowResult = { rowNum, cells, errors, warnings };
  if (errors.length === 0) {
    res.payload = {
      intake_id: intakeId, full_name: name, parent_name: parent, parent_phone: ph.value, parent_email: email || null,
      date_of_birth: dob, gender, source, meeting_date: meeting, status,
      previous_school_name: clip(get("previous_school"), 200) || null, previous_grade: clip(get("previous_grade"), 50) || null,
      address: clip(get("address"), 500) || null, meeting_notes: clip(get("remarks"), 1000) || null,
    };
  }
  return res;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- duplicates
export interface ExistingLead { id: string; intake_id: string; full_name: string; parent_phone: string; date_of_birth: string | null }
export type DupKind = "none" | "in_file" | "existing";
export interface DupInfo { kind: DupKind; existingId?: string; firstRow?: number }

/** Same normalised student name + same parent phone (last 10 digits) + same academic year. Siblings share a phone but
 *  have different names, so they are never treated as duplicates. Two records whose dates of birth are both present and
 *  differ are different children. */
export function detectDuplicates(valid: RowResult[], existing: ExistingLead[], intakes: IntakeRef[]): Map<number, DupInfo> {
  const yearOf = new Map(intakes.map((i) => [i.id, yearKey(i.academic_year)]));
  const key = (name: string, phone: string, intake: string) => `${nameKey(name)}|${phoneKey(phone)}|${yearOf.get(intake) ?? intake}`;
  const existingBy = new Map<string, ExistingLead[]>();
  for (const e of existing) {
    const k = key(e.full_name, e.parent_phone, e.intake_id);
    existingBy.set(k, [...(existingBy.get(k) ?? []), e]);
  }
  const seen = new Map<string, { row: number; dob: string | null }[]>();
  const out = new Map<number, DupInfo>();
  const sameChild = (a: string | null, b: string | null) => !a || !b || a === b;
  for (const r of valid) {
    const p = r.payload!;
    const k = key(p.full_name, p.parent_phone, p.intake_id);
    const ex = (existingBy.get(k) ?? []).find((e) => sameChild(e.date_of_birth, p.date_of_birth));
    if (ex) { out.set(r.rowNum, { kind: "existing", existingId: ex.id }); continue; }
    const prior = (seen.get(k) ?? []).find((s) => sameChild(s.dob, p.date_of_birth));
    if (prior) { out.set(r.rowNum, { kind: "in_file", firstRow: prior.row }); continue; }
    seen.set(k, [...(seen.get(k) ?? []), { row: r.rowNum, dob: p.date_of_birth }]);
    out.set(r.rowNum, { kind: "none" });
  }
  return out;
}

/** Update mode only fills fields that are empty on the existing lead; it never overwrites a value and never touches
 *  status or decision fields. Returns the patch (empty object = nothing to update). */
export function safeUpdatePatch(existing: Record<string, unknown>, p: LeadPayload): Record<string, unknown> {
  const candidates: Record<string, unknown> = {
    parent_name: p.parent_name, parent_email: p.parent_email, date_of_birth: p.date_of_birth, gender: p.gender,
    previous_school_name: p.previous_school_name, previous_grade: p.previous_grade, address: p.address, meeting_notes: p.meeting_notes,
  };
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidates)) {
    const cur = existing[k];
    if (v != null && v !== "" && (cur == null || String(cur).trim() === "")) patch[k] = v;
  }
  return patch;
}

// ---------------------------------------------------------------- CSV / export safety
/** Neutralises spreadsheet formula injection: values that start with = @ tab or CR, or with +/- followed by anything
 *  other than a plain number/phone, get a leading apostrophe so Excel/Sheets show them as text. */
export function csvSafe(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/^[=@\t\r]/.test(s)) return `'${s}`;
  if (/^[+-]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s)) return `'${s}`;
  return s;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV text with a UTF-8 BOM so Excel opens Hindi/Telugu names correctly. Every cell passes through csvSafe. */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  return "﻿" + [headers, ...rows].map((r) => r.map((c) => csvCell(csvSafe(c))).join(",")).join("\r\n");
}

export const TEMPLATE_HEADERS = LEAD_FIELDS.map((f) => f.label);
export function templateCsv(): string {
  const example = ["SAMPLE - delete this row", "Parent Name", "9876543210", "parent@example.com", "15/06/2019", "Female", "Class 1", "2026-2027", "10/11/2026", "Walk-in", "ABC Public School", "UKG", "12 Main Road", "Under Review", "Interested in school bus"];
  return buildCsv(TEMPLATE_HEADERS, [example]);
}

export function failedReportCsv(headers: string[], failed: { rowNum: number; cells: string[]; messages: string[] }[]): string {
  return buildCsv(["Row", ...headers, "Error"], failed.map((f) => [f.rowNum, ...f.cells, f.messages.join("; ")]));
}

// ---------------------------------------------------------------- export
export type ExportColumnKey =
  | "student_name" | "parent_name" | "parent_phone" | "parent_email" | "date_of_birth" | "gender" | "class" | "academic_year"
  | "enquiry_date" | "source" | "previous_school" | "previous_grade" | "address" | "status" | "remarks" | "created_at";

export const EXPORT_COLUMNS: { key: ExportColumnKey; label: string; sensitive?: boolean; default: boolean }[] = [
  { key: "student_name", label: "Student Name", default: true },
  { key: "class", label: "Interested Class", default: true },
  { key: "academic_year", label: "Academic Year", default: true },
  { key: "parent_name", label: "Parent / Guardian Name", default: true },
  { key: "parent_phone", label: "Parent Phone", sensitive: true, default: true },
  { key: "parent_email", label: "Parent Email", sensitive: true, default: true },
  { key: "date_of_birth", label: "Student Date of Birth", sensitive: true, default: false },
  { key: "gender", label: "Gender", default: false },
  { key: "enquiry_date", label: "Admission Enquiry Date", default: true },
  { key: "source", label: "Source of Enquiry", default: true },
  { key: "status", label: "Lead Status", default: true },
  { key: "previous_school", label: "Previous School", default: false },
  { key: "previous_grade", label: "Previous Class", default: false },
  { key: "address", label: "Address", sensitive: true, default: false },
  { key: "remarks", label: "Remarks", default: false },
  { key: "created_at", label: "Date Added", default: false },
];

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
/** e.g. APAS_All_Admission_Leads.xlsx, APAS_Selected_Leads.csv, APAS_Under_Review_Leads_2026-2027.xlsx */
export function exportFileName(scope: "all" | "selected" | "filtered", format: "csv" | "xlsx", parts: { status?: string; year?: string; cls?: string } = {}): string {
  const tag = [parts.status, parts.cls, parts.year].filter(Boolean).map((p) => slug(String(p))).filter(Boolean).join("_");
  const base = scope === "all" ? "APAS_All_Admission_Leads" : scope === "selected" ? "APAS_Selected_Leads" : `APAS_${tag ? tag + "_" : "Filtered_"}Leads`;
  return `${base}.${format}`;
}
