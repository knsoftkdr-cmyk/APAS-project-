// HR & Payroll client (ERP > People). Server logic: supabase/functions/_shared/handlers/hrPayroll.ts; maths:
// supabase/functions/_shared/payrollModel.ts. Tables are protected by RLS (is_hr_staff); payroll runs are written by the
// edge function only, so everything here that creates or changes a payroll goes through `call`.
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { call } from "@/lib/learningEvents";
import type { Component, Mode, Regime } from "../../supabase/functions/_shared/payrollModel";

export type { Component, Mode, Regime };
const db = supabase as any;

// ── types ────────────────────────────────────────────────────────────────────────────────────────
export interface Employee {
  id: string; organization_id: string; employee_code: string | null; full_name: string; email: string | null; phone: string | null;
  designation: string | null; department: string | null; status: "active" | "inactive"; date_joined: string; date_of_birth: string | null;
  gender: "male" | "female" | "other" | null; address: string | null; emergency_contact: string | null;
  employment_type: "permanent" | "contract" | "part_time" | "probation"; last_working_date: string | null; created_at: string;
}
export interface EmployeePrivate {
  employee_id: string; organization_id: string; pan: string | null; uan: string | null; esic_ip_number: string | null; bank_name: string | null;
  bank_account_number: string | null; ifsc: string | null; tax_regime: Regime; declared_deductions_annual: number; pf_mode: Mode; pf_on_actual_wage: boolean;
  eps_member: boolean; esi_mode: Mode; is_disabled: boolean;
}
export interface SalaryStructure {
  id: string; organization_id: string; employee_id: string; effective_from: string; basic: number; hra: number; da: number; components: Component[]; notes: string | null; created_at: string;
}
export type AttStatus = "present" | "absent" | "half_day" | "leave";
export interface AttendanceRow { id: string; employee_id: string; att_date: string; status: AttStatus; leave_type: string | null; note: string | null }
export interface Adjustment { id: string; employee_id: string; year: number; month: number; kind: "bonus" | "earning" | "deduction"; name: string; amount: number; taxable: boolean; note: string | null }
export interface StatutoryRow { id: string; organization_id: string | null; scheme: "epf" | "esi" | "tds" | "wages" | "attendance"; effective_from: string; params: Record<string, any>; source_note: string | null }

export interface PayrollRun {
  id: string; organization_id: string; year: number; month: number; status: "draft" | "finalized"; working_days: number | null;
  config_snapshot: Record<string, any>; totals: Record<string, any>; warnings: { type: string; employee: string; message: string }[]; generated_at: string; finalized_at: string | null;
}
export interface PayLine { name: string; amount: number; counts_as_wages?: boolean; one_off?: boolean }
export interface PayrollItem {
  id: string; run_id: string; employee_id: string | null; employee_name: string; employee_code: string | null; designation: string | null; department: string | null;
  joining_date: string | null; pan: string | null; uan: string | null; bank_account_masked: string | null;
  attendance: Record<string, number>; earnings: PayLine[]; deduction_lines: PayLine[]; gross: number; epf_employee: number; esi_employee: number; tds: number;
  other_deductions: number; total_deductions: number; net_pay: number; employer: { epf: number; eps: number; edli: number; admin: number; esi: number }; employer_total: number;
  wages: number; details: Record<string, any>; payment_status: "unpaid" | "paid" | "on_hold"; paid_on: string | null; payment_mode: string | null; payment_reference: string | null;
}

const fail = (e: any, what: string): never => { throw new Error(e?.message ? `${what}: ${e.message}` : what); };
const n = (v: any) => Number(v ?? 0);

// ── employees ────────────────────────────────────────────────────────────────────────────────────
const normEmployee = (r: any): Employee => r as Employee;

export async function listEmployees(org: string): Promise<Employee[]> {
  const { data, error } = await db.from("employees").select("*").eq("organization_id", org).order("full_name", { ascending: true }).limit(5000);
  if (error) fail(error, "Couldn't load employees");
  return (data ?? []).map(normEmployee);
}

export type EmployeeInput = Partial<Omit<Employee, "id" | "organization_id" | "created_at">> & { full_name: string };

export async function saveEmployee(org: string, userId: string | null, input: EmployeeInput, id?: string): Promise<string> {
  const row = {
    full_name: input.full_name.trim(), employee_code: input.employee_code?.trim() || null, email: input.email?.trim() || null, phone: input.phone?.trim() || null,
    designation: input.designation?.trim() || null, department: input.department?.trim() || null, status: input.status ?? "active",
    date_joined: input.date_joined || undefined, date_of_birth: input.date_of_birth || null, gender: input.gender || null, address: input.address?.trim() || null,
    emergency_contact: input.emergency_contact?.trim() || null, employment_type: input.employment_type ?? "permanent", last_working_date: input.last_working_date || null,
  };
  if (id) {
    const { error } = await db.from("employees").update(row).eq("id", id).eq("organization_id", org);
    if (error) fail(error.code === "23505" ? { message: "That employee ID is already used" } : error, "Couldn't save the employee");
    return id;
  }
  const { data, error } = await db.from("employees").insert({ ...row, organization_id: org, created_by: userId }).select("id").single();
  if (error) fail(error.code === "23505" ? { message: "That employee ID is already used" } : error, "Couldn't add the employee");
  return data.id;
}

/** Next free "EMP-0001" style code. */
export function nextEmployeeCode(employees: readonly Pick<Employee, "employee_code">[]): string {
  let max = 0;
  for (const e of employees) { const m = /^EMP-(\d+)$/i.exec(e.employee_code ?? ""); if (m) max = Math.max(max, Number(m[1])); }
  return `EMP-${String(max + 1).padStart(4, "0")}`;
}

export async function getEmployeePrivate(employeeId: string): Promise<EmployeePrivate | null> {
  const { data, error } = await db.from("employee_hr_private").select("*").eq("employee_id", employeeId).maybeSingle();
  if (error) fail(error, "Couldn't load statutory details");
  return data ? { ...data, declared_deductions_annual: n(data.declared_deductions_annual) } : null;
}

export async function saveEmployeePrivate(org: string, userId: string | null, employeeId: string, p: Partial<EmployeePrivate>): Promise<void> {
  const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);
  const row = {
    employee_id: employeeId, organization_id: org, pan: clean(p.pan)?.toUpperCase() ?? null, uan: clean(p.uan), esic_ip_number: clean(p.esic_ip_number),
    bank_name: clean(p.bank_name), bank_account_number: clean(p.bank_account_number), ifsc: clean(p.ifsc)?.toUpperCase() ?? null,
    tax_regime: p.tax_regime ?? "new", declared_deductions_annual: Math.max(0, n(p.declared_deductions_annual)), pf_mode: p.pf_mode ?? "auto",
    pf_on_actual_wage: !!p.pf_on_actual_wage, eps_member: p.eps_member !== false, esi_mode: p.esi_mode ?? "auto", is_disabled: !!p.is_disabled,
    updated_by: userId, updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("employee_hr_private").upsert(row, { onConflict: "employee_id" });
  if (error) {
    const hint = /pan/i.test(error.message) ? "PAN must look like ABCDE1234F" : /uan/i.test(error.message) ? "UAN must be 12 digits" : /ifsc/i.test(error.message) ? "IFSC must look like HDFC0001234" : /bank_account/i.test(error.message) ? "Account number must be 6 to 20 digits" : /esic/i.test(error.message) ? "ESIC number must be 10 to 17 digits" : null;
    fail(hint ? { message: hint } : error, "Couldn't save statutory details");
  }
}

// ── salary structures ────────────────────────────────────────────────────────────────────────────
const normStructure = (r: any): SalaryStructure => ({ ...r, basic: n(r.basic), hra: n(r.hra), da: n(r.da), components: Array.isArray(r.components) ? r.components : [] });

export async function listStructures(employeeId: string): Promise<SalaryStructure[]> {
  const { data, error } = await db.from("salary_structures").select("*").eq("employee_id", employeeId).order("effective_from", { ascending: false });
  if (error) fail(error, "Couldn't load salary structures");
  return (data ?? []).map(normStructure);
}

/** Latest structure per employee that is in force today (for the directory's salary column). */
export async function listCurrentStructures(org: string): Promise<Map<string, SalaryStructure>> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db.from("salary_structures").select("*").eq("organization_id", org).lte("effective_from", today).order("effective_from", { ascending: false }).limit(10000);
  if (error) fail(error, "Couldn't load salary structures");
  const m = new Map<string, SalaryStructure>();
  for (const r of data ?? []) if (!m.has(r.employee_id)) m.set(r.employee_id, normStructure(r));
  return m;
}

export async function saveStructure(org: string, userId: string | null, employeeId: string, s: Pick<SalaryStructure, "effective_from" | "basic" | "hra" | "da" | "components" | "notes">): Promise<void> {
  const { error } = await db.from("salary_structures").upsert(
    { organization_id: org, employee_id: employeeId, effective_from: s.effective_from, basic: s.basic, hra: s.hra, da: s.da, components: s.components, notes: s.notes?.trim() || null, created_by: userId },
    { onConflict: "employee_id,effective_from" },
  );
  if (error) fail(error, "Couldn't save the salary structure");
}

export async function deleteStructure(id: string): Promise<void> {
  const { error } = await db.from("salary_structures").delete().eq("id", id);
  if (error) fail(error, "Couldn't delete the salary structure");
}

// ── attendance ───────────────────────────────────────────────────────────────────────────────────
export const monthRange = (year: number, month: number) => {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`, days: last };
};

export async function listAttendance(org: string, from: string, to: string): Promise<AttendanceRow[]> {
  const { data, error } = await db.from("staff_attendance").select("id, employee_id, att_date, status, leave_type, note").eq("organization_id", org).gte("att_date", from).lte("att_date", to).limit(20000);
  if (error) fail(error, "Couldn't load attendance");
  return data ?? [];
}

export async function setAttendance(org: string, userId: string | null, rows: { employee_id: string; att_date: string; status: AttStatus; leave_type?: string | null; note?: string | null }[]): Promise<void> {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200).map((r) => ({ organization_id: org, employee_id: r.employee_id, att_date: r.att_date, status: r.status, leave_type: r.leave_type ?? null, note: r.note ?? null, marked_by: userId, updated_at: new Date().toISOString() }));
    const { error } = await db.from("staff_attendance").upsert(part, { onConflict: "employee_id,att_date" });
    if (error) fail(error, "Couldn't save attendance");
  }
}

export async function clearAttendance(employeeId: string, date: string): Promise<void> {
  const { error } = await db.from("staff_attendance").delete().eq("employee_id", employeeId).eq("att_date", date);
  if (error) fail(error, "Couldn't clear attendance");
}

// ── one-off adjustments ──────────────────────────────────────────────────────────────────────────
export async function listAdjustments(org: string, year: number, month: number): Promise<Adjustment[]> {
  const { data, error } = await db.from("payroll_adjustments").select("*").eq("organization_id", org).eq("year", year).eq("month", month).order("created_at");
  if (error) fail(error, "Couldn't load adjustments");
  return (data ?? []).map((r: any) => ({ ...r, amount: n(r.amount) }));
}
export async function addAdjustment(org: string, userId: string | null, a: Omit<Adjustment, "id">): Promise<void> {
  const { error } = await db.from("payroll_adjustments").insert({ organization_id: org, created_by: userId, ...a, note: a.note?.trim() || null });
  if (error) fail(error, "Couldn't add the adjustment");
}
export async function deleteAdjustment(id: string): Promise<void> {
  const { error } = await db.from("payroll_adjustments").delete().eq("id", id);
  if (error) fail(error, "Couldn't remove the adjustment");
}

// ── statutory settings ───────────────────────────────────────────────────────────────────────────
export async function listStatutory(org: string): Promise<StatutoryRow[]> {
  const { data, error } = await db.from("statutory_config").select("*").or(`organization_id.is.null,organization_id.eq.${org}`).order("effective_from", { ascending: false });
  if (error) fail(error, "Couldn't load statutory settings");
  return data ?? [];
}
export const saveStatutory = (org: string, scheme: StatutoryRow["scheme"], effective_from: string, params: Record<string, any>, source_note?: string) =>
  call<{ ok: boolean }>({ action: "hr_config_save", organization_id: org, scheme, effective_from, params, source_note });

// ── payroll ──────────────────────────────────────────────────────────────────────────────────────
const normRun = (r: any): PayrollRun => r as PayrollRun;
const normItem = (r: any): PayrollItem => ({
  ...r, gross: n(r.gross), epf_employee: n(r.epf_employee), esi_employee: n(r.esi_employee), tds: n(r.tds), other_deductions: n(r.other_deductions),
  total_deductions: n(r.total_deductions), net_pay: n(r.net_pay), employer_total: n(r.employer_total), wages: n(r.wages),
  employer: { epf: n(r.employer?.epf), eps: n(r.employer?.eps), edli: n(r.employer?.edli), admin: n(r.employer?.admin), esi: n(r.employer?.esi) },
  earnings: Array.isArray(r.earnings) ? r.earnings : [], deduction_lines: Array.isArray(r.deduction_lines) ? r.deduction_lines : [],
});

export async function listRuns(org: string): Promise<PayrollRun[]> {
  const { data, error } = await db.from("payroll_runs").select("*").eq("organization_id", org).order("year", { ascending: false }).order("month", { ascending: false }).limit(60);
  if (error) fail(error, "Couldn't load payroll runs");
  return (data ?? []).map(normRun);
}
export async function listRunItems(runId: string): Promise<PayrollItem[]> {
  const { data, error } = await db.from("payroll_items").select("*").eq("run_id", runId).order("employee_name").limit(5000);
  if (error) fail(error, "Couldn't load salary slips");
  return (data ?? []).map(normItem);
}
/** Salary history of one employee across months (only finalized months are official). */
export async function listEmployeeHistory(org: string, employeeId: string): Promise<(PayrollItem & { year: number; month: number; status: string })[]> {
  const { data, error } = await db.from("payroll_items").select("*, payroll_runs!inner(year, month, status)").eq("organization_id", org).eq("employee_id", employeeId).limit(200);
  if (error) fail(error, "Couldn't load salary history");
  return (data ?? []).map((r: any) => ({ ...normItem(r), year: r.payroll_runs.year, month: r.payroll_runs.month, status: r.payroll_runs.status }))
    .sort((a: any, b: any) => b.year * 12 + b.month - (a.year * 12 + a.month));
}

export const generatePayroll = (org: string, year: number, month: number) =>
  call<{ ok: boolean; run_id: string; employees: number; skipped: { employee: string; reason: string }[] }>({ action: "hr_generate", organization_id: org, year, month });
export const finalizePayroll = (org: string, runId: string) => call<{ ok: boolean }>({ action: "hr_finalize", organization_id: org, run_id: runId });
export const reopenPayroll = (org: string, runId: string) => call<{ ok: boolean }>({ action: "hr_reopen", organization_id: org, run_id: runId });
export const deletePayrollRun = (org: string, runId: string) => call<{ ok: boolean }>({ action: "hr_delete_run", organization_id: org, run_id: runId });
export const markSalaryPaid = (org: string, runId: string, o: { itemIds?: string[]; status: "paid" | "unpaid" | "on_hold"; paidOn?: string; mode?: string; reference?: string }) =>
  call<{ ok: boolean }>({ action: "hr_mark_paid", organization_id: org, run_id: runId, item_ids: o.itemIds, status: o.status, paid_on: o.paidOn, mode: o.mode, reference: o.reference });

// ── formatting & export ──────────────────────────────────────────────────────────────────────────
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;
export const inr = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const money = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Integer rupees in words, Indian grouping (e.g. "Twenty Five Thousand Rupees Only"). */
export function amountInWords(amount: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ""}`);
  const three = (x: number) => (x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ` ${two(x % 100)}` : ""}` : two(x));
  let r = Math.round(Math.abs(amount));
  if (r === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  const crore = Math.floor(r / 1e7); r %= 1e7;
  const lakh = Math.floor(r / 1e5); r %= 1e5;
  const thousand = Math.floor(r / 1e3); r %= 1e3;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (r) parts.push(three(r));
  return `${parts.join(" ")} Rupees Only`;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;        // spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const downloadCsv = (rows: (string | number | null | undefined)[][], filename: string) => download(new Blob(["\ufeff", toCsv(rows)], { type: "text/csv;charset=utf-8" }), filename);
export function downloadXlsx(sheets: { name: string; rows: (string | number | null | undefined)[][] }[], filename: string) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

// ── salary slip PDF ──────────────────────────────────────────────────────────────────────────────
// Built-in PDF fonts cannot draw the rupee sign, so the slip uses "Rs.".
export function drawSalarySlip(doc: jsPDF, item: PayrollItem, run: Pick<PayrollRun, "year" | "month" | "status">, orgName: string) {
  const W = doc.internal.pageSize.getWidth();
  const L = 14, R = W - 14;
  let y = 16;
  const text = (s: string, x: number, yy: number, o: { bold?: boolean; size?: number; align?: "left" | "right" | "center"; color?: [number, number, number] } = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(o.size ?? 9.5); doc.setTextColor(...(o.color ?? [30, 41, 59]));
    doc.text(s, x, yy, { align: o.align ?? "left" });
  };

  doc.setFillColor(30, 64, 175); doc.rect(0, 0, W, 26, "F");
  text(orgName, L, 12, { bold: true, size: 15, color: [255, 255, 255] });
  text(`Salary Slip - ${monthLabel(run.year, run.month)}`, L, 20, { size: 10.5, color: [219, 234, 254] });
  if (run.status !== "finalized") text("DRAFT", R, 16, { bold: true, size: 12, align: "right", color: [253, 230, 138] });
  y = 36;

  const info: [string, string][] = [
    ["Employee", item.employee_name], ["Employee ID", item.employee_code ?? "-"], ["Designation", item.designation ?? "-"], ["Department", item.department ?? "-"],
    ["Date of joining", item.joining_date ?? "-"], ["PAN", item.pan ? `${item.pan.slice(0, 2)}XXXXX${item.pan.slice(-3)}` : "-"], ["UAN", item.uan ?? "-"], ["Bank A/c", item.bank_account_masked ?? "-"],
  ];
  info.forEach(([k, v], i) => {
    const col = i % 2, row = Math.floor(i / 2), x = col ? W / 2 + 2 : L, yy = y + row * 6;
    text(`${k}:`, x, yy, { color: [100, 116, 139] }); text(String(v).slice(0, 34), x + 30, yy, { bold: true });
  });
  y += 4 * 6 + 3;

  const a = item.attendance;
  doc.setDrawColor(226, 232, 240); doc.line(L, y - 2, R, y - 2);
  text(`Working days: ${a.working_days ?? "-"}`, L, y + 3); text(`Paid days: ${a.paid_days ?? "-"}`, L + 50, y + 3); text(`Loss of pay days: ${a.lop_days ?? 0}`, L + 100, y + 3);
  y += 9;

  // two tables: earnings | deductions
  const colW = (R - L - 6) / 2, xE = L, xD = L + colW + 6;
  const head = (label: string, x: number) => { doc.setFillColor(241, 245, 249); doc.rect(x, y - 4.5, colW, 7, "F"); text(label, x + 2, y, { bold: true }); text("Amount (Rs.)", x + colW - 2, y, { bold: true, align: "right" }); };
  head("Earnings", xE); head("Deductions", xD);
  const ded: PayLine[] = [];
  if (item.epf_employee) ded.push({ name: "Provident Fund (EPF) - employee", amount: item.epf_employee });
  if (item.esi_employee) ded.push({ name: "ESI - employee", amount: item.esi_employee });
  if (item.tds) ded.push({ name: "Income tax (TDS)", amount: item.tds });
  ded.push(...item.deduction_lines);
  const rows = Math.max(item.earnings.length, ded.length, 1);
  let yy = y + 7;
  for (let i = 0; i < rows; i++) {
    const e = item.earnings[i], d = ded[i];
    if (e) { text(e.name.slice(0, 34), xE + 2, yy); text(money(e.amount), xE + colW - 2, yy, { align: "right" }); }
    if (d) { text(d.name.slice(0, 34), xD + 2, yy); text(money(d.amount), xD + colW - 2, yy, { align: "right" }); }
    yy += 6;
  }
  doc.line(L, yy - 3, R, yy - 3);
  text("Gross earnings", xE + 2, yy + 1, { bold: true }); text(money(item.gross), xE + colW - 2, yy + 1, { bold: true, align: "right" });
  text("Total deductions", xD + 2, yy + 1, { bold: true }); text(money(item.total_deductions), xD + colW - 2, yy + 1, { bold: true, align: "right" });
  yy += 9;

  doc.setFillColor(220, 252, 231); doc.roundedRect(L, yy - 5, R - L, 11, 2, 2, "F");
  text("Net salary payable", L + 3, yy + 1.5, { bold: true, size: 11 }); text(`Rs. ${money(item.net_pay)}`, R - 3, yy + 1.5, { bold: true, size: 11, align: "right" });
  yy += 12;
  text(amountInWords(item.net_pay), L, yy, { size: 8.5, color: [71, 85, 105] });
  yy += 10;

  const er = item.employer;
  if (item.employer_total > 0) {
    text("Employer contributions (for information, not deducted from your salary)", L, yy, { bold: true, size: 8.5, color: [71, 85, 105] }); yy += 5;
    const parts = [["EPF", er.epf], ["EPS", er.eps], ["EDLI", er.edli], ["EPF admin", er.admin], ["ESI", er.esi]].filter((p) => (p[1] as number) > 0).map((p) => `${p[0]}: Rs. ${money(p[1] as number)}`);
    text(parts.join("   "), L, yy, { size: 8.5, color: [71, 85, 105] }); yy += 8;
  }
  if (item.payment_status === "paid") { text(`Paid on ${item.paid_on ?? ""}${item.payment_mode ? ` by ${item.payment_mode.replace("_", " ")}` : ""}${item.payment_reference ? ` (ref ${item.payment_reference})` : ""}`, L, yy, { size: 8.5, color: [22, 101, 52] }); yy += 6; }
  text("This is a computer-generated salary slip and does not require a signature.", W / 2, doc.internal.pageSize.getHeight() - 10, { size: 8, align: "center", color: [148, 163, 184] });
}

export function downloadSalarySlip(item: PayrollItem, run: Pick<PayrollRun, "year" | "month" | "status">, orgName: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  drawSalarySlip(doc, item, run, orgName);
  doc.save(`SalarySlip_${(item.employee_code ?? item.employee_name).replace(/[^\w-]+/g, "_")}_${run.year}-${String(run.month).padStart(2, "0")}.pdf`);
}

export function downloadAllSalarySlips(items: readonly PayrollItem[], run: Pick<PayrollRun, "year" | "month" | "status">, orgName: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  items.forEach((it, i) => { if (i) doc.addPage(); drawSalarySlip(doc, it, run, orgName); });
  doc.save(`SalarySlips_${run.year}-${String(run.month).padStart(2, "0")}.pdf`);
}
