// supabase/functions/_shared/handlers/hrPayroll.ts
//
// HR & Payroll server logic (ERP > People > Payroll). Routed from `get-mastery-history` (see mergedRouter / CONSOLIDATION.md)
// to avoid a new edge function. Data: migration 20261113000000_hr_payroll.sql. Maths: ../payrollModel.ts (unit-tested).
//
//   hr_config_save   { scheme, effective_from, params, source_note? }   add / replace a statutory-settings version for the school
//   hr_generate      { year, month }                                   (re)build the DRAFT payroll for the month from attendance + salary structures
//   hr_finalize      { run_id }                                         lock the month (salary slips become final)
//   hr_reopen        { run_id }                                         unlock a finalized month (refused once any salary is marked paid)
//   hr_delete_run    { run_id }                                         delete a DRAFT run
//   hr_mark_paid     { run_id, item_ids?, status, paid_on?, mode?, reference? }   record salary payment (tracking only - no money moves)
//
// Browsers can only READ payroll_runs / payroll_items (RLS); every figure is computed here from the database, never trusted
// from the client. Callers must be HR staff of the school: ERP-enabled users, school admins and admins - the same rule as the
// is_hr_staff() SQL helper that protects the tables.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isMissingTable } from "../learningEvents.ts";
import {
  ConfigError, computePayrollItem, daysInMonth, DEFAULT_PRIVATE, esiPeriodMonthsBefore, fyStartYear, isoDate, lastDayOfMonth, maskAccount,
  resolveConfig, runTotals, summarizeAttendance, validateConfigParams, validateStructure,
  type Adjustment, type AttRecord, type ConfigRow, type Mode, type PrivateInput, type Structure,
} from "../payrollModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Row = Record<string, any>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEMES = ["epf", "esi", "tds", "wages", "attendance"];
const PAY_MODES = ["bank_transfer", "cash", "cheque", "upi", "other"];

class Deny extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }
const chunk = <T,>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const uuid = (v: unknown, what: string): string => { if (typeof v !== "string" || !UUID_RE.test(v)) throw new Deny(400, `${what} must be a valid id`); return v; };
const num = (v: unknown, d = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : d; };

export async function handleHrPayroll(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const org = await requireHrStaff(admin, user.id, body?.organization_id);
    const ctx: Ctx = { admin, userId: user.id, org };

    switch (String(body?.action ?? "")) {
      case "config_save": return json(await configSave(ctx, body));
      case "generate": return json(await generate(ctx, body));
      case "finalize": return json(await finalize(ctx, body));
      case "reopen": return json(await reopen(ctx, body));
      case "delete_run": return json(await deleteRun(ctx, body));
      case "mark_paid": return json(await markPaid(ctx, body));
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof Deny) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status);
    if (e instanceof ConfigError) return json({ error: e.message, code: "config_missing" }, 400);
    if (isMissingTable(e)) return json({ error: "HR & Payroll is not set up on this database yet. Apply migration 20261113000000_hr_payroll.sql.", code: "not_installed" }, 503);
    console.error("hr payroll error:", e);
    return json({ error: e instanceof Error ? e.message : (e as any)?.message ?? "Unknown error" }, 500);
  }
}

interface Ctx { admin: any; userId: string; org: string }

/** The school the caller may run payroll for, or 403. Mirrors the is_hr_staff() SQL helper. */
async function requireHrStaff(admin: any, userId: string, requestedOrg?: unknown): Promise<string> {
  const { data: p, error } = await admin.from("profiles").select("role, school_id, erp_access").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!p) throw new Deny(403, "Profile not found");
  const own = p.school_id as string | null;
  const target = typeof requestedOrg === "string" && UUID_RE.test(requestedOrg) ? requestedOrg : own;
  if (!target) throw new Deny(403, "Your account is not linked to a school");
  if (target === own && (p.erp_access === true || p.role === "admin" || p.role === "school_admin")) return target;
  const { data: sas } = await admin.from("school_admin_schools").select("school_id").eq("school_admin_id", userId).eq("school_id", target).maybeSingle();
  if (sas) return target;
  throw new Deny(403, "You do not have access to HR & Payroll");
}

// ── statutory settings ───────────────────────────────────────────────────────────────────────────
async function configSave(ctx: Ctx, body: Row) {
  const scheme = String(body.scheme ?? "");
  if (!SCHEMES.includes(scheme)) throw new Deny(400, "Unknown settings group");
  const eff = String(body.effective_from ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eff) || Number.isNaN(Date.parse(eff))) throw new Deny(400, "Enter a valid effective date");
  const errors = validateConfigParams(scheme, body.params);
  if (errors.length) throw new Deny(400, errors.slice(0, 4).join(". "), "invalid_config");
  const note = typeof body.source_note === "string" ? body.source_note.trim().slice(0, 600) : null;

  // A finalized month must never change underneath its slips: only allow dates after the last finalized month.
  const { data: fin } = await ctx.admin.from("payroll_runs").select("year, month").eq("organization_id", ctx.org).eq("status", "finalized").order("year", { ascending: false }).order("month", { ascending: false }).limit(1);
  if (fin?.[0] && eff <= lastDayOfMonth(fin[0].year, fin[0].month)) {
    throw new Deny(409, `The new settings must start after the last finalized month (${fin[0].month}/${fin[0].year}). Reopen that month first if it was wrong.`, "after_finalized");
  }
  const { data: existing, error: lookupErr } = await ctx.admin.from("statutory_config").select("id").eq("organization_id", ctx.org).eq("scheme", scheme).eq("effective_from", eff).maybeSingle();
  if (lookupErr) throw lookupErr;
  const r = existing
    ? await ctx.admin.from("statutory_config").update({ params: body.params, source_note: note, created_by: ctx.userId }).eq("id", existing.id)
    : await ctx.admin.from("statutory_config").insert({ organization_id: ctx.org, scheme, effective_from: eff, params: body.params, source_note: note, created_by: ctx.userId });
  if (r.error) throw r.error;
  return { ok: true };
}

// ── generate ─────────────────────────────────────────────────────────────────────────────────────
async function generate(ctx: Ctx, body: Row) {
  const year = Math.round(num(body.year)), month = Math.round(num(body.month));
  if (year < 2000 || year > 2100 || month < 1 || month > 12) throw new Deny(400, "Choose a valid month");
  const monthStart = isoDate(year, month, 1), monthEnd = lastDayOfMonth(year, month);

  const { data: existing, error: exErr } = await ctx.admin.from("payroll_runs").select("id, status").eq("organization_id", ctx.org).eq("year", year).eq("month", month).maybeSingle();
  if (exErr) throw exErr;
  if (existing?.status === "finalized") throw new Deny(409, "This month is finalized. Reopen it to regenerate.", "finalized");

  const { data: cfgRows, error: cErr } = await ctx.admin.from("statutory_config").select("organization_id, scheme, effective_from, params").or(`organization_id.is.null,organization_id.eq.${ctx.org}`).limit(500);
  if (cErr) throw cErr;
  const cfg = resolveConfig((cfgRows ?? []) as ConfigRow[], ctx.org, monthEnd);

  // Employees who could be paid this month.
  const { data: emps, error: eErr } = await ctx.admin.from("employees")
    .select("id, full_name, employee_code, designation, department, date_joined, last_working_date, status")
    .eq("organization_id", ctx.org).lte("date_joined", monthEnd).limit(5000);
  if (eErr) throw eErr;
  const employees = (emps ?? []).filter((e: Row) => (e.status === "active" || (e.last_working_date && e.last_working_date >= monthStart)) && (!e.last_working_date || e.last_working_date >= monthStart));
  if (!employees.length) throw new Deny(400, "There are no active employees to pay for this month.");
  const ids: string[] = employees.map((e: Row) => e.id);

  const privMap = new Map<string, Row>(), structMap = new Map<string, Row>(), attMap = new Map<string, AttRecord[]>(), adjMap = new Map<string, Adjustment[]>();
  for (const part of chunk(ids, 100)) {
    const [{ data: pr, error: e1 }, { data: st, error: e2 }, { data: at, error: e3 }, { data: ad, error: e4 }] = await Promise.all([
      ctx.admin.from("employee_hr_private").select("*").in("employee_id", part),
      ctx.admin.from("salary_structures").select("*").in("employee_id", part).lte("effective_from", monthEnd).order("effective_from", { ascending: false }),
      ctx.admin.from("staff_attendance").select("employee_id, att_date, status").in("employee_id", part).gte("att_date", monthStart).lte("att_date", monthEnd).limit(10000),
      ctx.admin.from("payroll_adjustments").select("employee_id, kind, name, amount, taxable").in("employee_id", part).eq("year", year).eq("month", month),
    ]);
    for (const e of [e1, e2, e3, e4]) if (e) throw e;
    for (const r of pr ?? []) privMap.set(r.employee_id, r);
    for (const r of st ?? []) if (!structMap.has(r.employee_id)) structMap.set(r.employee_id, r);   // newest effective structure first
    for (const r of at ?? []) attMap.set(r.employee_id, [...(attMap.get(r.employee_id) ?? []), { att_date: r.att_date, status: r.status }]);
    for (const r of ad ?? []) adjMap.set(r.employee_id, [...(adjMap.get(r.employee_id) ?? []), { kind: r.kind, name: r.name, amount: Number(r.amount), taxable: r.taxable !== false }]);
  }

  // Earlier months of this financial year (for TDS) and of this ESI contribution period.
  const fyY = fyStartYear(year, month);
  const earlier: { year: number; month: number }[] = [];
  for (let y = fyY, m = 4; !(y === year && m === month) && earlier.length < 12;) { earlier.push({ year: y, month: m }); m++; if (m === 13) { m = 1; y++; } }
  const esiMonths = new Set(esiPeriodMonthsBefore(year, month).map((x) => `${x.year}-${x.month}`));
  const ytdTaxable = new Map<string, number>(), ytdTds = new Map<string, number>(), esiCovered = new Set<string>();
  if (earlier.length) {
    const { data: runs, error: rErr } = await ctx.admin.from("payroll_runs").select("id, year, month").eq("organization_id", ctx.org).in("year", [...new Set(earlier.map((x) => x.year))]);
    if (rErr) throw rErr;
    const wanted = (runs ?? []).filter((r: Row) => earlier.some((x) => x.year === r.year && x.month === r.month) && r.id !== existing?.id);
    if (wanted.length) {
      const { data: prev, error: pErr } = await ctx.admin.from("payroll_items").select("run_id, employee_id, gross, tds, esi_employee, employer, details").in("run_id", wanted.map((r: Row) => r.id)).limit(60000);
      if (pErr) throw pErr;
      const runKey = new Map<string, string>(wanted.map((r: Row) => [r.id, `${r.year}-${r.month}`]));
      for (const it of prev ?? []) {
        if (!it.employee_id) continue;
        ytdTaxable.set(it.employee_id, (ytdTaxable.get(it.employee_id) ?? 0) + Number(it.details?.taxable_this_month ?? it.gross));
        ytdTds.set(it.employee_id, (ytdTds.get(it.employee_id) ?? 0) + Number(it.tds));
        if (esiMonths.has(runKey.get(it.run_id) ?? "") && (Number(it.esi_employee) > 0 || Number(it.employer?.esi ?? 0) > 0)) esiCovered.add(it.employee_id);
      }
    }
  }

  const items: Row[] = [], skipped: { employee: string; reason: string }[] = [];
  for (const e of employees) {
    const s = structMap.get(e.id);
    if (!s) { skipped.push({ employee: e.full_name, reason: "No salary structure" }); continue; }
    const structure: Structure = { basic: Number(s.basic), hra: Number(s.hra), da: Number(s.da), components: Array.isArray(s.components) ? s.components : [] };
    const bad = validateStructure(structure);
    if (bad.length) { skipped.push({ employee: e.full_name, reason: `Salary structure invalid: ${bad[0]}` }); continue; }
    const p = privMap.get(e.id);
    const priv: PrivateInput = p ? {
      pan: p.pan, uan: p.uan, bank_account_number: p.bank_account_number, tax_regime: p.tax_regime === "old" ? "old" : "new",
      declared_deductions_annual: Number(p.declared_deductions_annual ?? 0), pf_mode: p.pf_mode as Mode, pf_on_actual_wage: p.pf_on_actual_wage === true,
      eps_member: p.eps_member !== false, esi_mode: p.esi_mode as Mode, is_disabled: p.is_disabled === true,
    } : DEFAULT_PRIVATE;
    const r = computePayrollItem({
      employee: { id: e.id, name: e.full_name, code: e.employee_code, designation: e.designation, department: e.department, joining_date: e.date_joined, last_working_date: e.last_working_date },
      priv, structure, attendance: attMap.get(e.id) ?? [], adjustments: adjMap.get(e.id) ?? [], year, month, cfg,
      prior: { ytd_taxable: ytdTaxable.get(e.id) ?? 0, ytd_tds: ytdTds.get(e.id) ?? 0, esi_covered_this_period: esiCovered.has(e.id) },
    });
    if (r.attendance.counted_days === 0) { skipped.push({ employee: e.full_name, reason: "Not employed on any working day this month" }); continue; }
    items.push({
      organization_id: ctx.org, employee_id: e.id, employee_name: e.full_name, employee_code: e.employee_code, designation: e.designation, department: e.department,
      joining_date: e.date_joined, pan: priv.pan, uan: priv.uan, bank_account_masked: maskAccount(priv.bank_account_number),
      attendance: r.attendance, earnings: r.earnings, deduction_lines: r.deduction_lines, gross: r.gross, epf_employee: r.epf_employee, esi_employee: r.esi_employee,
      tds: r.tds, other_deductions: r.other_deductions, total_deductions: r.total_deductions, net_pay: r.net_pay, employer: r.employer, employer_total: r.employer_total,
      wages: r.wages, details: { ...r.details, bank_name: p?.bank_name ?? null, ifsc: p?.ifsc ?? null },
    });
  }
  if (!items.length) throw new Deny(400, `No salary could be generated. ${skipped.slice(0, 3).map((s) => `${s.employee}: ${s.reason}`).join("; ")}`, "nothing_to_generate");

  const totals = runTotals(items as any, cfg.epf);
  const workingDays = summarizeAttendance([], year, month, cfg.attendance).working_days;
  const warnings = [
    ...skipped.map((s) => ({ type: "skipped", employee: s.employee, message: s.reason })),
    ...items.flatMap((i) => (i.details.warnings as string[]).map((m) => ({ type: "warning", employee: i.employee_name, message: m }))),
  ].slice(0, 200);

  const runFields = {
    organization_id: ctx.org, year, month, status: "draft", working_days: workingDays, config_snapshot: { as_of: cfg.as_of, versions: cfg.versions, epf: cfg.epf, esi: cfg.esi, tds: cfg.tds, wages: cfg.wages, attendance: cfg.attendance },
    totals, warnings, generated_by: ctx.userId, generated_at: new Date().toISOString(),
  };
  let runId = existing?.id as string | undefined;
  if (runId) {
    const { error } = await ctx.admin.from("payroll_runs").update(runFields).eq("id", runId);
    if (error) throw error;
    const { error: dErr } = await ctx.admin.from("payroll_items").delete().eq("run_id", runId);
    if (dErr) throw dErr;
  } else {
    const { data, error } = await ctx.admin.from("payroll_runs").insert(runFields).select("id").single();
    if (error) throw error;
    runId = data.id;
  }
  for (const part of chunk(items, 100)) {
    const { error } = await ctx.admin.from("payroll_items").insert(part.map((i) => ({ ...i, run_id: runId })));
    if (error) throw error;
  }
  return { ok: true, run_id: runId, employees: items.length, skipped, totals, days_in_month: daysInMonth(year, month) };
}

// ── lifecycle ────────────────────────────────────────────────────────────────────────────────────
async function loadRun(ctx: Ctx, id: unknown): Promise<Row> {
  const runId = uuid(id, "run_id");
  const { data, error } = await ctx.admin.from("payroll_runs").select("*").eq("id", runId).eq("organization_id", ctx.org).maybeSingle();
  if (error) throw error;
  if (!data) throw new Deny(404, "Payroll run not found");
  return data;
}

async function finalize(ctx: Ctx, body: Row) {
  const run = await loadRun(ctx, body.run_id);
  if (run.status === "finalized") return { ok: true };
  const { count } = await ctx.admin.from("payroll_items").select("id", { count: "exact", head: true }).eq("run_id", run.id);
  if (!count) throw new Deny(400, "This payroll has no salary slips to finalize.");
  const { error } = await ctx.admin.from("payroll_runs").update({ status: "finalized", finalized_by: ctx.userId, finalized_at: new Date().toISOString() }).eq("id", run.id);
  if (error) throw error;
  return { ok: true };
}

async function reopen(ctx: Ctx, body: Row) {
  const run = await loadRun(ctx, body.run_id);
  if (run.status !== "finalized") return { ok: true };
  const { count } = await ctx.admin.from("payroll_items").select("id", { count: "exact", head: true }).eq("run_id", run.id).eq("payment_status", "paid");
  if (count) throw new Deny(409, "Some salaries in this month are already marked paid. Mark them unpaid first if you need to reopen.", "has_payments");
  const { data: later } = await ctx.admin.from("payroll_runs").select("id").eq("organization_id", ctx.org).eq("status", "finalized").or(`year.gt.${run.year},and(year.eq.${run.year},month.gt.${run.month})`).limit(1);
  if (later?.length) throw new Deny(409, "A later month is already finalized. Reopen the latest month first: tax is carried forward month to month.", "later_finalized");
  const { error } = await ctx.admin.from("payroll_runs").update({ status: "draft", finalized_by: null, finalized_at: null }).eq("id", run.id);
  if (error) throw error;
  return { ok: true };
}

async function deleteRun(ctx: Ctx, body: Row) {
  const run = await loadRun(ctx, body.run_id);
  if (run.status !== "draft") throw new Deny(409, "Only a draft payroll can be deleted. Reopen it first.");
  const { error } = await ctx.admin.from("payroll_runs").delete().eq("id", run.id);
  if (error) throw error;
  return { ok: true };
}

async function markPaid(ctx: Ctx, body: Row) {
  const run = await loadRun(ctx, body.run_id);
  if (run.status !== "finalized") throw new Deny(409, "Finalize the payroll before recording salary payments.", "not_finalized");
  const status = String(body.status ?? "paid");
  if (!["paid", "unpaid", "on_hold"].includes(status)) throw new Deny(400, "Invalid payment status");
  const patch: Row = { payment_status: status };
  if (status === "paid") {
    const paidOn = String(body.paid_on ?? new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(paidOn))) throw new Deny(400, "Enter a valid payment date");
    if (body.mode && !PAY_MODES.includes(String(body.mode))) throw new Deny(400, "Invalid payment mode");
    patch.paid_on = paidOn; patch.payment_mode = body.mode ? String(body.mode) : null;
    patch.payment_reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 80) || null : null;
  } else { patch.paid_on = null; patch.payment_mode = null; patch.payment_reference = null; }

  let q = ctx.admin.from("payroll_items").update(patch).eq("run_id", run.id);
  if (Array.isArray(body.item_ids) && body.item_ids.length) q = q.in("id", body.item_ids.map((x: unknown) => uuid(x, "item id")).slice(0, 1000));
  const { error } = await q;
  if (error) throw error;
  return { ok: true };
}
