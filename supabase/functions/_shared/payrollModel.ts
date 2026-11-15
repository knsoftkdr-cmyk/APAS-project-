// supabase/functions/_shared/payrollModel.ts
//
// Pure payroll maths for HR & Payroll (no I/O; unit-tested in src/test/payrollModel.test.ts).
// Used by the edge function (authoritative) and by the browser (live preview of a salary structure).
//
// NOTHING statutory is hard-coded here: every rate, ceiling, slab and rule comes from the effective-dated
// `statutory_config` rows (see resolveConfig). This file only knows HOW to apply them.
//
//   wages        labour-code "wages" (basic + DA + wage-type allowances; if the excluded pay is more than 50% of
//                total remuneration the excess is added back). Basis for EPF and (by default) ESI.
//   EPF          employee % and employer % of PF wages (capped at the ceiling unless the employee contributes on actual
//                wages); employer % splits into EPS (capped) and EPF; EDLI and admin charges on top.
//   ESI          rates on ESI wages for employees whose wages are within the ceiling; stays covered to the end of the
//                Apr-Sep / Oct-Mar contribution period; amounts rounded UP to the next rupee.
//   TDS          income-tax on salary: projected annual salary - standard deduction (- declared deductions, old regime)
//                -> slabs -> 87A rebate (+ marginal relief) -> cess; spread over the months left in the financial year.
//                Salary income only, no surcharge: an estimate for payroll deduction, not a tax return.

export type Regime = "new" | "old";
export type Mode = "auto" | "enrolled" | "exempt";

export interface Slab { upto: number | null; rate: number }
export interface TdsRegime { standard_deduction: number; rebate_limit: number; rebate_max: number; marginal_relief: boolean; slabs: Slab[] }
export interface EpfParams {
  enabled: boolean; wage_ceiling: number; employee_rate: number; employer_rate: number; eps_rate: number; eps_wage_cap: number;
  edli_rate: number; edli_wage_cap: number; admin_rate: number; admin_min_per_establishment: number;
}
export interface EsiParams {
  enabled: boolean; wage_ceiling: number; wage_ceiling_disabled: number; employee_rate: number; employer_rate: number;
  employee_exempt_daily_wage: number; wage_basis: "code_wages" | "gross";
}
export interface TdsParams { enabled: boolean; cess_rate: number; new: TdsRegime; old: TdsRegime }
export interface WagesParams { apply_fifty_percent_rule: boolean; minimum_wage_share_pct: number }
export interface AttendanceParams { weekly_off_days: number[]; leave_is_paid: boolean; unmarked_days: "present" | "absent" }

export interface ResolvedConfig { epf: EpfParams; esi: EsiParams; tds: TdsParams; wages: WagesParams; attendance: AttendanceParams; as_of: string; versions: Record<string, string> }

export interface ConfigRow { organization_id: string | null; scheme: string; effective_from: string; params: Record<string, unknown> }

// ── small helpers ────────────────────────────────────────────────────────────────────────────────
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const rupee = (n: number): number => Math.round(n + 1e-9);
export const rupeeUp = (n: number): number => Math.ceil(n - 1e-9);
/** amount x rate% without floating-point drift on the usual 2-decimal rates (8.33, 0.75, 3.25...). */
export const pctOf = (amount: number, ratePct: number): number => (amount * Math.round(ratePct * 100)) / 10000;

export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const isoDate = (y: number, m: number, d: number): string => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export const lastDayOfMonth = (year: number, month: number): string => isoDate(year, month, daysInMonth(year, month));
const weekday = (y: number, m: number, d: number): number => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** Financial year helpers (April to March). */
export const monthsRemainingInFY = (month: number): number => (month >= 4 ? 12 - (month - 4) : 4 - month);
export const fyStartYear = (year: number, month: number): number => (month >= 4 ? year : year - 1);
/** The months of the current ESI contribution period (Apr-Sep or Oct-Mar) that come BEFORE this month. */
export function esiPeriodMonthsBefore(year: number, month: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = year, m = month;
  const inSameHalf = (yy: number, mm: number) => (month >= 4 && month <= 9 ? yy === year && mm >= 4 && mm <= 9 : month >= 10 ? yy === year && mm >= 10 : (yy === year && mm <= 3) || (yy === year - 1 && mm >= 10));
  for (let i = 0; i < 6; i++) {
    m -= 1; if (m === 0) { m = 12; y -= 1; }
    if (!inSameHalf(y, m)) break;
    out.push({ year: y, month: m });
  }
  return out;
}

// ── configuration ────────────────────────────────────────────────────────────────────────────────
export class ConfigError extends Error {}

/** For each scheme: the row in force on `asOf` - latest effective date wins, a school's own row beats the platform default on a tie. */
export function resolveConfig(rows: readonly ConfigRow[], orgId: string, asOf: string): ResolvedConfig {
  const pick = (scheme: string) => {
    const c = rows.filter((r) => r.scheme === scheme && r.effective_from <= asOf && (r.organization_id === null || r.organization_id === orgId));
    c.sort((a, b) => (a.effective_from === b.effective_from ? Number(b.organization_id !== null) - Number(a.organization_id !== null) : b.effective_from.localeCompare(a.effective_from)));
    return c[0];
  };
  const out: Record<string, ConfigRow | undefined> = {};
  const missing: string[] = [];
  for (const s of ["epf", "esi", "tds", "wages", "attendance"]) { out[s] = pick(s); if (!out[s]) missing.push(s); }
  if (missing.length) throw new ConfigError(`Statutory settings are missing for: ${missing.join(", ")}. Add them under Payroll > Statutory settings.`);
  const p = (s: string) => out[s]!.params as never;
  const versions: Record<string, string> = {};
  for (const s of Object.keys(out)) versions[s] = out[s]!.effective_from;
  return { epf: p("epf"), esi: p("esi"), tds: p("tds"), wages: p("wages"), attendance: p("attendance"), as_of: asOf, versions };
}

const isNum = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** Reject nonsense before it is saved: a wrong rate silently corrupts every later payroll. */
export function validateConfigParams(scheme: string, params: unknown): string[] {
  const e: string[] = [];
  if (!params || typeof params !== "object" || Array.isArray(params)) return ["Settings must be an object"];
  const p = params as Record<string, any>;
  const pct = (k: string, o = p) => { if (!isNum(o[k], 0, 100)) e.push(`${k} must be a percentage between 0 and 100`); };
  const amt = (k: string, o = p) => { if (!isNum(o[k], 0, 1e9)) e.push(`${k} must be a number, zero or more`); };
  if (scheme === "epf") {
    if (typeof p.enabled !== "boolean") e.push("enabled must be on or off");
    ["employee_rate", "employer_rate", "eps_rate", "edli_rate", "admin_rate"].forEach((k) => pct(k));
    ["wage_ceiling", "eps_wage_cap", "edli_wage_cap", "admin_min_per_establishment"].forEach((k) => amt(k));
    if (isNum(p.eps_rate) && isNum(p.employer_rate) && p.eps_rate > p.employer_rate) e.push("EPS rate cannot be more than the employer rate");
  } else if (scheme === "esi") {
    if (typeof p.enabled !== "boolean") e.push("enabled must be on or off");
    ["employee_rate", "employer_rate"].forEach((k) => pct(k));
    ["wage_ceiling", "wage_ceiling_disabled", "employee_exempt_daily_wage"].forEach((k) => amt(k));
    if (!["code_wages", "gross"].includes(p.wage_basis)) e.push("wage_basis must be code_wages or gross");
  } else if (scheme === "wages") {
    if (typeof p.apply_fifty_percent_rule !== "boolean") e.push("apply_fifty_percent_rule must be on or off");
    pct("minimum_wage_share_pct");
  } else if (scheme === "attendance") {
    if (!Array.isArray(p.weekly_off_days) || p.weekly_off_days.some((d: unknown) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)) e.push("weekly_off_days must be days 0 (Sunday) to 6 (Saturday)");
    if (typeof p.leave_is_paid !== "boolean") e.push("leave_is_paid must be on or off");
    if (!["present", "absent"].includes(p.unmarked_days)) e.push("unmarked_days must be present or absent");
  } else if (scheme === "tds") {
    if (typeof p.enabled !== "boolean") e.push("enabled must be on or off");
    pct("cess_rate");
    for (const r of ["new", "old"] as const) {
      const o = p[r];
      if (!o || typeof o !== "object") { e.push(`${r} regime settings are missing`); continue; }
      ["standard_deduction", "rebate_limit", "rebate_max"].forEach((k) => amt(k, o));
      const slabs: Slab[] = Array.isArray(o.slabs) ? o.slabs : [];
      if (slabs.length < 2) { e.push(`${r} regime needs at least two slabs`); continue; }
      let prev = 0;
      slabs.forEach((s, i) => {
        if (!isNum(s?.rate, 0, 100)) e.push(`${r} slab ${i + 1}: rate must be 0 to 100`);
        const last = i === slabs.length - 1;
        if (last) { if (s.upto !== null) e.push(`${r} regime: the last slab must have no upper limit`); }
        else if (!isNum(s?.upto, 1) || (s.upto as number) <= prev) e.push(`${r} slab ${i + 1}: upper limits must increase`); else prev = s.upto as number;
      });
    }
  } else e.push("Unknown scheme");
  return e;
}

// ── attendance ───────────────────────────────────────────────────────────────────────────────────
export type AttStatus = "present" | "absent" | "half_day" | "leave";
export interface AttRecord { att_date: string; status: AttStatus }
export interface AttendanceSummary {
  working_days: number; counted_days: number; present: number; absent: number; half_day: number; leave: number; unmarked: number;
  lop_days: number; paid_days: number; ratio: number;
}

/**
 * Month attendance -> pay days. Weekly offs are not working days. Days before the joining date / after the last working
 * day are outside the employee's window (they reduce what is payable but are not counted as absence).
 */
export function summarizeAttendance(
  records: readonly AttRecord[], year: number, month: number, cfg: AttendanceParams, window: { from?: string | null; to?: string | null } = {},
): AttendanceSummary {
  const byDate = new Map(records.map((r) => [r.att_date, r.status]));
  const off = new Set(cfg.weekly_off_days);
  const n = daysInMonth(year, month);
  let working = 0, counted = 0, present = 0, absent = 0, half = 0, leave = 0, unmarked = 0;
  for (let d = 1; d <= n; d++) {
    if (off.has(weekday(year, month, d))) continue;
    working++;
    const iso = isoDate(year, month, d);
    if ((window.from && iso < window.from) || (window.to && iso > window.to)) continue;
    counted++;
    const s = byDate.get(iso);
    if (s === "present") present++;
    else if (s === "absent") absent++;
    else if (s === "half_day") half++;
    else if (s === "leave") leave++;
    else unmarked++;
  }
  const unmarkedPaid = cfg.unmarked_days === "present";
  const lop = absent + half * 0.5 + (cfg.leave_is_paid ? 0 : leave) + (unmarkedPaid ? 0 : unmarked);
  const paid = counted - lop;
  return { working_days: working, counted_days: counted, present, absent, half_day: half, leave, unmarked, lop_days: lop, paid_days: paid, ratio: working > 0 ? Math.max(0, paid) / working : 0 };
}

// ── salary structure ─────────────────────────────────────────────────────────────────────────────
export interface Component { name: string; kind: "earning" | "deduction"; type: "fixed" | "percent_basic"; value: number; counts_as_wages?: boolean; taxable?: boolean }
export interface Structure { basic: number; hra: number; da: number; components: Component[] }
export interface Line { name: string; amount: number; counts_as_wages?: boolean; taxable?: boolean; one_off?: boolean }

export function validateStructure(s: Structure): string[] {
  const e: string[] = [];
  if (!isNum(s.basic, 0, 1e8)) e.push("Basic salary must be a number, zero or more");
  if (!isNum(s.hra, 0, 1e8)) e.push("HRA must be a number, zero or more");
  if (!isNum(s.da, 0, 1e8)) e.push("DA must be a number, zero or more");
  if (isNum(s.basic) && s.basic === 0) e.push("Basic salary is required");
  const names = new Set<string>();
  (s.components ?? []).forEach((c, i) => {
    const n = String(c?.name ?? "").trim();
    if (!n) e.push(`Row ${i + 1}: name is required`);
    else if (names.has(n.toLowerCase())) e.push(`Row ${i + 1}: "${n}" is repeated`);
    names.add(n.toLowerCase());
    if (!["earning", "deduction"].includes(c?.kind)) e.push(`Row ${i + 1}: choose earning or deduction`);
    if (!["fixed", "percent_basic"].includes(c?.type)) e.push(`Row ${i + 1}: choose fixed or % of basic`);
    if (!isNum(c?.value, 0, c?.type === "percent_basic" ? 1000 : 1e8)) e.push(`Row ${i + 1}: amount must be zero or more`);
  });
  return e;
}

/** Full-month earning lines of a structure (before attendance). */
export function structureLines(s: Structure): { earnings: Line[]; deductions: Line[] } {
  const amt = (c: Component) => round2(c.type === "percent_basic" ? pctOf(s.basic, c.value) : c.value);
  const earnings: Line[] = [{ name: "Basic", amount: round2(s.basic), counts_as_wages: true, taxable: true }];
  if (s.da > 0) earnings.push({ name: "Dearness Allowance", amount: round2(s.da), counts_as_wages: true, taxable: true });
  if (s.hra > 0) earnings.push({ name: "HRA", amount: round2(s.hra), counts_as_wages: false, taxable: true });
  const deductions: Line[] = [];
  for (const c of s.components ?? []) {
    const a = amt(c);
    if (a <= 0) continue;
    if (c.kind === "earning") earnings.push({ name: c.name.trim(), amount: a, counts_as_wages: c.counts_as_wages === true, taxable: c.taxable !== false });
    else deductions.push({ name: c.name.trim(), amount: a });
  }
  return { earnings, deductions };
}

/** Labour-code wages: what counts as wages, with the 50% rule applied to RECURRING pay (one-off bonuses are not remuneration here). */
export function computeWages(lines: readonly Line[], cfg: WagesParams): { wages: number; remuneration: number; uplifted: boolean } {
  const recurring = lines.filter((l) => !l.one_off);
  const remuneration = round2(recurring.reduce((s, l) => s + l.amount, 0));
  let wages = round2(recurring.filter((l) => l.counts_as_wages).reduce((s, l) => s + l.amount, 0));
  let uplifted = false;
  if (cfg.apply_fifty_percent_rule) {
    const floor = round2(pctOf(remuneration, cfg.minimum_wage_share_pct));
    if (wages < floor) { wages = floor; uplifted = true; }
  }
  return { wages, remuneration, uplifted };
}

// ── EPF ──────────────────────────────────────────────────────────────────────────────────────────
export interface EpfResult { applies: boolean; pf_wage: number; employee: number; employer_epf: number; eps: number; edli: number; admin: number; employer_total: number; note?: string }
const NO_EPF: EpfResult = { applies: false, pf_wage: 0, employee: 0, employer_epf: 0, eps: 0, edli: 0, admin: 0, employer_total: 0 };

export function computeEpf(wages: number, mode: Mode, onActual: boolean, epsMember: boolean, cfg: EpfParams): EpfResult {
  if (!cfg.enabled || mode === "exempt") return { ...NO_EPF, note: mode === "exempt" ? "PF exempt" : undefined };
  const within = wages <= cfg.wage_ceiling;
  if (mode === "auto" && !within) return { ...NO_EPF, note: `Wages above the PF ceiling (${cfg.wage_ceiling}): not enrolled. Set PF to "Enrolled" if this employee is a member.` };
  const pfWage = onActual ? wages : Math.min(wages, cfg.wage_ceiling);
  const employee = rupee(pctOf(pfWage, cfg.employee_rate));
  const employer12 = rupee(pctOf(pfWage, cfg.employer_rate));
  const eps = epsMember ? Math.min(employer12, rupee(pctOf(Math.min(pfWage, cfg.eps_wage_cap), cfg.eps_rate))) : 0;
  const edli = rupee(pctOf(Math.min(pfWage, cfg.edli_wage_cap), cfg.edli_rate));
  const admin = rupee(pctOf(pfWage, cfg.admin_rate));
  const employerEpf = employer12 - eps;
  return { applies: true, pf_wage: round2(pfWage), employee, employer_epf: employerEpf, eps, edli, admin, employer_total: employerEpf + eps + edli + admin };
}

// ── ESI ──────────────────────────────────────────────────────────────────────────────────────────
export interface EsiResult { applies: boolean; esi_wage: number; employee: number; employer: number; note?: string }

export function computeEsi(
  esiWage: number, mode: Mode, isDisabled: boolean, coveredEarlierInPeriod: boolean, calendarDays: number, cfg: EsiParams,
): EsiResult {
  if (!cfg.enabled || mode === "exempt" || esiWage <= 0) return { applies: false, esi_wage: 0, employee: 0, employer: 0, note: mode === "exempt" ? "ESI exempt" : undefined };
  const ceiling = isDisabled ? cfg.wage_ceiling_disabled : cfg.wage_ceiling;
  const within = esiWage <= ceiling;
  const covered = mode === "enrolled" || within || coveredEarlierInPeriod;
  if (!covered) return { applies: false, esi_wage: 0, employee: 0, employer: 0, note: `Wages above the ESI ceiling (${ceiling}): not covered.` };
  const employer = rupeeUp(pctOf(esiWage, cfg.employer_rate));
  const dailyWage = esiWage / Math.max(1, calendarDays);
  const exempt = dailyWage <= cfg.employee_exempt_daily_wage;
  const employee = exempt ? 0 : rupeeUp(pctOf(esiWage, cfg.employee_rate));
  const notes: string[] = [];
  if (!within && coveredEarlierInPeriod && mode !== "enrolled") notes.push("Still covered: wages crossed the ceiling during this contribution period.");
  if (exempt) notes.push("Employee share waived: average daily wage is within the exemption limit.");
  return { applies: true, esi_wage: round2(esiWage), employee, employer, note: notes.join(" ") || undefined };
}

// ── TDS ──────────────────────────────────────────────────────────────────────────────────────────
export function slabTax(taxable: number, slabs: readonly Slab[]): number {
  let tax = 0, lower = 0;
  for (const s of slabs) {
    const upper = s.upto === null ? Infinity : s.upto;
    if (taxable > lower) tax += (Math.min(taxable, upper) - lower) * (s.rate / 100);
    lower = upper;
    if (taxable <= upper) break;
  }
  return tax;
}

export interface TdsResult { tds: number; annual_tax: number; projected_taxable: number; annual_income: number; note?: string }

export function computeTds(
  regime: Regime, declaredDeductions: number, ytdTaxable: number, ytdTds: number, monthTaxable: number, monthRecurringTaxable: number,
  monthsLeftIncludingThis: number, cfg: TdsParams,
): TdsResult {
  if (!cfg.enabled) return { tds: 0, annual_tax: 0, projected_taxable: 0, annual_income: 0, note: "TDS is switched off in statutory settings" };
  const r = cfg[regime];
  const months = Math.max(1, monthsLeftIncludingThis);
  const annualIncome = ytdTaxable + monthTaxable + monthRecurringTaxable * (months - 1);
  const taxable = Math.max(0, annualIncome - r.standard_deduction - (regime === "old" ? declaredDeductions : 0));
  let tax = slabTax(taxable, r.slabs);
  if (taxable <= r.rebate_limit) tax = Math.max(0, tax - r.rebate_max);
  else if (r.marginal_relief) tax = Math.min(tax, taxable - r.rebate_limit);
  tax += tax * (cfg.cess_rate / 100);
  const annualTax = rupee(tax);
  const tds = Math.max(0, rupee((annualTax - ytdTds) / months));
  return {
    tds, annual_tax: annualTax, projected_taxable: round2(taxable), annual_income: round2(annualIncome),
    note: taxable > 5_000_000 ? "Projected income is above Rs 50 lakh: surcharge is not calculated here." : undefined,
  };
}

// ── one employee's payroll ───────────────────────────────────────────────────────────────────────
export interface EmployeeInput { id: string; name: string; code: string | null; designation: string | null; department: string | null; joining_date: string | null; last_working_date: string | null }
export interface PrivateInput {
  pan: string | null; uan: string | null; bank_account_number: string | null; tax_regime: Regime; declared_deductions_annual: number;
  pf_mode: Mode; pf_on_actual_wage: boolean; eps_member: boolean; esi_mode: Mode; is_disabled: boolean;
}
export const DEFAULT_PRIVATE: PrivateInput = { pan: null, uan: null, bank_account_number: null, tax_regime: "new", declared_deductions_annual: 0, pf_mode: "auto", pf_on_actual_wage: false, eps_member: true, esi_mode: "auto", is_disabled: false };
export interface Adjustment { kind: "bonus" | "earning" | "deduction"; name: string; amount: number; taxable: boolean }
export interface Prior { ytd_taxable: number; ytd_tds: number; esi_covered_this_period: boolean }

export interface ItemInput {
  employee: EmployeeInput; priv: PrivateInput; structure: Structure; attendance: readonly AttRecord[]; adjustments: readonly Adjustment[];
  prior: Prior; year: number; month: number; cfg: ResolvedConfig;
}

export interface PayrollItem {
  attendance: AttendanceSummary; earnings: Line[]; deduction_lines: Line[];
  gross: number; epf_employee: number; esi_employee: number; tds: number; other_deductions: number; total_deductions: number; net_pay: number;
  employer: { epf: number; eps: number; edli: number; admin: number; esi: number }; employer_total: number; wages: number;
  details: { pf_wage: number; esi_wage: number; taxable_this_month: number; tds: TdsResult; epf_note?: string; esi_note?: string; wages_uplifted: boolean; warnings: string[] };
}

export function computePayrollItem(i: ItemInput): PayrollItem {
  const { employee: emp, priv, cfg } = i;
  const warnings: string[] = [];
  const att = summarizeAttendance(i.attendance, i.year, i.month, cfg.attendance, { from: emp.joining_date, to: emp.last_working_date });
  if (att.counted_days === 0) warnings.push("Not employed on any working day of this month: no salary generated.");
  if (att.unmarked > 0) warnings.push(`${att.unmarked} working day${att.unmarked === 1 ? "" : "s"} had no attendance entry and were counted as ${cfg.attendance.unmarked_days}.`);

  const full = structureLines(i.structure);
  const earnings: Line[] = full.earnings.map((l) => ({ ...l, amount: round2(l.amount * att.ratio) }));
  for (const a of i.adjustments) if (a.kind !== "deduction") earnings.push({ name: a.name, amount: round2(a.amount), counts_as_wages: false, taxable: a.taxable, one_off: true });
  const gross = round2(earnings.reduce((s, l) => s + l.amount, 0));

  const { wages, uplifted } = computeWages(earnings, cfg.wages);
  const epf = computeEpf(wages, priv.pf_mode, priv.pf_on_actual_wage, priv.eps_member, cfg.epf);
  const esiWageBase = cfg.esi.wage_basis === "gross" ? gross : wages;
  const esi = computeEsi(esiWageBase, priv.esi_mode, priv.is_disabled, i.prior.esi_covered_this_period, daysInMonth(i.year, i.month), cfg.esi);

  const taxableMonth = round2(earnings.filter((l) => l.taxable !== false).reduce((s, l) => s + l.amount, 0));
  const taxableRecurring = round2(earnings.filter((l) => l.taxable !== false && !l.one_off).reduce((s, l) => s + l.amount, 0));
  const tds = att.counted_days === 0
    ? { tds: 0, annual_tax: 0, projected_taxable: 0, annual_income: 0 } as TdsResult
    : computeTds(priv.tax_regime, priv.declared_deductions_annual, i.prior.ytd_taxable, i.prior.ytd_tds, taxableMonth, taxableRecurring, monthsRemainingInFY(i.month), cfg.tds);

  const deductionLines: Line[] = [...full.deductions.map((l) => ({ ...l })), ...i.adjustments.filter((a) => a.kind === "deduction").map((a) => ({ name: a.name, amount: round2(a.amount) }))];
  const other = att.counted_days === 0 ? 0 : round2(deductionLines.reduce((s, l) => s + l.amount, 0));
  const totalDeductions = round2(epf.employee + esi.employee + tds.tds + other);
  const net = round2(gross - totalDeductions);
  if (net < 0) warnings.push("Deductions are more than gross pay: net pay is negative. Review this salary.");
  if (i.structure.basic > 0 && !priv.pan && tds.tds > 0) warnings.push("PAN is missing: TDS on salary without PAN is deducted at a higher rate. Add the PAN.");
  if (epf.applies && !priv.uan) warnings.push("UAN is missing for a PF member.");
  if (tds.note) warnings.push(tds.note);

  return {
    attendance: att, earnings, deduction_lines: deductionLines, gross, epf_employee: epf.employee, esi_employee: esi.employee, tds: tds.tds,
    other_deductions: other, total_deductions: totalDeductions, net_pay: net,
    employer: { epf: epf.employer_epf, eps: epf.eps, edli: epf.edli, admin: epf.admin, esi: esi.employer },
    employer_total: epf.employer_total + esi.employer, wages,
    details: { pf_wage: epf.pf_wage, esi_wage: esi.esi_wage, taxable_this_month: taxableMonth, tds, epf_note: epf.note, esi_note: esi.note, wages_uplifted: uplifted, warnings },
  };
}

// ── run totals and report groupings ──────────────────────────────────────────────────────────────
export interface TotalsRow {
  gross: number; epf_employee: number; esi_employee: number; tds: number; other_deductions: number; total_deductions: number; net_pay: number;
  employer: { epf: number; eps: number; edli: number; admin: number; esi: number }; employer_total: number;
}
export const emptyTotals = (): TotalsRow => ({ gross: 0, epf_employee: 0, esi_employee: 0, tds: 0, other_deductions: 0, total_deductions: 0, net_pay: 0, employer: { epf: 0, eps: 0, edli: 0, admin: 0, esi: 0 }, employer_total: 0 });

export function addToTotals(t: TotalsRow, r: Pick<PayrollItem, "gross" | "epf_employee" | "esi_employee" | "tds" | "other_deductions" | "total_deductions" | "net_pay" | "employer" | "employer_total">): TotalsRow {
  t.gross = round2(t.gross + r.gross); t.epf_employee = round2(t.epf_employee + r.epf_employee); t.esi_employee = round2(t.esi_employee + r.esi_employee);
  t.tds = round2(t.tds + r.tds); t.other_deductions = round2(t.other_deductions + r.other_deductions); t.total_deductions = round2(t.total_deductions + r.total_deductions);
  t.net_pay = round2(t.net_pay + r.net_pay); t.employer_total = round2(t.employer_total + r.employer_total);
  for (const k of ["epf", "eps", "edli", "admin", "esi"] as const) t.employer[k] = round2(t.employer[k] + (r.employer[k] ?? 0));
  return t;
}

/** Run totals. EPF admin charges have a minimum per establishment: top it up at run level and say so. */
export function runTotals(items: readonly Pick<PayrollItem, "gross" | "epf_employee" | "esi_employee" | "tds" | "other_deductions" | "total_deductions" | "net_pay" | "employer" | "employer_total">[], cfg: EpfParams) {
  const t = emptyTotals();
  for (const i of items) addToTotals(t, i);
  let adminTopUp = 0;
  if (cfg.enabled && t.employer.admin > 0 && t.employer.admin < cfg.admin_min_per_establishment) {
    adminTopUp = round2(cfg.admin_min_per_establishment - t.employer.admin);
    t.employer.admin = cfg.admin_min_per_establishment;
    t.employer_total = round2(t.employer_total + adminTopUp);
  }
  return { ...t, employees: items.length, epf_admin_minimum_topup: adminTopUp, cost_to_school: round2(t.gross + t.employer_total) };
}

export function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r) || "Unassigned"; m.set(k, [...(m.get(k) ?? []), r]); }
  return m;
}

export const maskAccount = (n: string | null | undefined): string | null => (n ? `${"X".repeat(Math.max(0, n.length - 4))}${n.slice(-4)}` : null);
export const maskPan = (n: string | null | undefined): string | null => (n ? `${n.slice(0, 2)}XXXXX${n.slice(-3)}` : null);
