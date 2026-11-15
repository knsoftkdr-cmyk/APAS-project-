import { describe, it, expect } from "vitest";
import {
  computeEpf, computeEsi, computePayrollItem, computeTds, computeWages, esiPeriodMonthsBefore, DEFAULT_PRIVATE, maskAccount, monthsRemainingInFY,
  resolveConfig, runTotals, slabTax, structureLines, summarizeAttendance, validateConfigParams, validateStructure, ConfigError,
  type ConfigRow, type ResolvedConfig,
} from "../../supabase/functions/_shared/payrollModel";

// Mirrors the platform defaults seeded by migration 20261113000000_hr_payroll.sql.
const epf = (ceiling: number) => ({ enabled: true, wage_ceiling: ceiling, employee_rate: 12, employer_rate: 12, eps_rate: 8.33, eps_wage_cap: ceiling, edli_rate: 0.5, edli_wage_cap: ceiling, admin_rate: 0.5, admin_min_per_establishment: 500 });
const NEW = { standard_deduction: 75000, rebate_limit: 1200000, rebate_max: 60000, marginal_relief: true, slabs: [{ upto: 400000, rate: 0 }, { upto: 800000, rate: 5 }, { upto: 1200000, rate: 10 }, { upto: 1600000, rate: 15 }, { upto: 2000000, rate: 20 }, { upto: 2400000, rate: 25 }, { upto: null, rate: 30 }] };
const OLD = { standard_deduction: 50000, rebate_limit: 500000, rebate_max: 12500, marginal_relief: false, slabs: [{ upto: 250000, rate: 0 }, { upto: 500000, rate: 5 }, { upto: 1000000, rate: 20 }, { upto: null, rate: 30 }] };
const ROWS: ConfigRow[] = [
  { organization_id: null, scheme: "epf", effective_from: "2014-09-01", params: epf(15000) },
  { organization_id: null, scheme: "epf", effective_from: "2026-09-17", params: epf(25000) },
  { organization_id: null, scheme: "esi", effective_from: "2019-07-01", params: { enabled: true, wage_ceiling: 21000, wage_ceiling_disabled: 25000, employee_rate: 0.75, employer_rate: 3.25, employee_exempt_daily_wage: 176, wage_basis: "code_wages" } },
  { organization_id: null, scheme: "wages", effective_from: "2025-11-21", params: { apply_fifty_percent_rule: true, minimum_wage_share_pct: 50 } },
  { organization_id: null, scheme: "tds", effective_from: "2025-04-01", params: { enabled: true, cess_rate: 4, new: NEW, old: OLD } },
  { organization_id: null, scheme: "attendance", effective_from: "2020-01-01", params: { weekly_off_days: [0], leave_is_paid: true, unmarked_days: "present" } },
];
const ORG = "org-1";
const cfgFor = (asOf: string): ResolvedConfig => resolveConfig(ROWS, ORG, asOf);
const cfg = cfgFor("2026-11-30");

describe("configuration is effective-dated, never hard-coded", () => {
  it("uses the ceiling in force on the last day of the month", () => {
    expect(cfgFor("2026-08-31").epf.wage_ceiling).toBe(15000);
    expect(cfgFor("2026-09-30").epf.wage_ceiling).toBe(25000);
  });
  it("a school's own row beats the default on the same date, and a later default beats an older school row", () => {
    const own = { organization_id: ORG, scheme: "esi", effective_from: "2019-07-01", params: { ...(ROWS[2].params as object), wage_ceiling: 30000 } };
    expect(resolveConfig([...ROWS, own], ORG, "2026-11-30").esi.wage_ceiling).toBe(30000);
    expect(resolveConfig([...ROWS, own], "other-school", "2026-11-30").esi.wage_ceiling).toBe(21000);
  });
  it("fails clearly when a scheme is missing", () => expect(() => resolveConfig(ROWS.slice(0, 2), ORG, "2026-11-30")).toThrow(ConfigError));
  it("rejects bad settings", () => {
    expect(validateConfigParams("epf", { ...epf(25000), employee_rate: 120 }).length).toBeGreaterThan(0);
    expect(validateConfigParams("epf", { ...epf(25000), eps_rate: 13 }).length).toBeGreaterThan(0);
    expect(validateConfigParams("epf", epf(25000))).toEqual([]);
    expect(validateConfigParams("tds", { enabled: true, cess_rate: 4, new: { ...NEW, slabs: [{ upto: 800000, rate: 5 }, { upto: 400000, rate: 0 }, { upto: null, rate: 30 }] }, old: OLD }).length).toBeGreaterThan(0);
    expect(validateConfigParams("tds", { enabled: true, cess_rate: 4, new: NEW, old: OLD })).toEqual([]);
    expect(validateConfigParams("attendance", { weekly_off_days: [9], leave_is_paid: true, unmarked_days: "present" }).length).toBeGreaterThan(0);
  });
});

describe("EPF", () => {
  it("matches the published split at the Rs 25,000 ceiling", () => {
    const r = computeEpf(25000, "auto", false, true, epf(25000));
    expect(r).toMatchObject({ employee: 3000, eps: 2083, employer_epf: 917, edli: 125, admin: 125, employer_total: 3250 });
  });
  it("matches the old Rs 15,000 ceiling", () => {
    expect(computeEpf(15000, "auto", false, true, epf(15000))).toMatchObject({ employee: 1800, eps: 1250, employer_epf: 550, edli: 75, admin: 75 });
  });
  it("caps at the ceiling for higher wages when enrolled, or uses actual wages if chosen", () => {
    expect(computeEpf(40000, "enrolled", false, true, epf(25000)).employee).toBe(3000);
    expect(computeEpf(40000, "enrolled", true, true, epf(25000))).toMatchObject({ employee: 4800, eps: 2083, employer_epf: 4800 - 2083, edli: 125, admin: 200 });
  });
  it("does not enrol above the ceiling on auto, or when exempt / switched off", () => {
    expect(computeEpf(40000, "auto", false, true, epf(25000)).applies).toBe(false);
    expect(computeEpf(10000, "exempt", false, true, epf(25000)).applies).toBe(false);
    expect(computeEpf(10000, "auto", false, true, { ...epf(25000), enabled: false }).applies).toBe(false);
  });
  it("non-EPS members put the whole employer share into EPF", () => {
    expect(computeEpf(20000, "auto", false, false, epf(25000))).toMatchObject({ eps: 0, employer_epf: 2400 });
  });
});

describe("ESI", () => {
  const e = cfg.esi;
  it("rounds contributions UP to the next rupee", () => {
    expect(computeEsi(21000, "auto", false, false, 30, e)).toMatchObject({ applies: true, employee: 158, employer: 683 });
    expect(computeEsi(15000, "auto", false, false, 30, e)).toMatchObject({ employee: 113, employer: 488 });
  });
  it("is not applied above the ceiling, higher ceiling for disability", () => {
    expect(computeEsi(21001, "auto", false, false, 30, e).applies).toBe(false);
    expect(computeEsi(24000, "auto", true, false, 30, e).applies).toBe(true);
  });
  it("stays covered to the end of the contribution period", () => {
    expect(computeEsi(22000, "auto", false, true, 30, e).applies).toBe(true);
  });
  it("waives the employee share on a very low daily wage", () => {
    const r = computeEsi(5000, "auto", false, false, 30, e);   // ~Rs 167 a day
    expect(r.employee).toBe(0);
    expect(r.employer).toBeGreaterThan(0);
  });
});

describe("period helpers", () => {
  it("financial-year months remaining", () => {
    expect([4, 11, 1, 3].map(monthsRemainingInFY)).toEqual([12, 5, 3, 1]);
  });
  it("ESI period months before", () => {
    expect(esiPeriodMonthsBefore(2026, 4)).toEqual([]);
    expect(esiPeriodMonthsBefore(2026, 11)).toEqual([{ year: 2026, month: 10 }]);
    expect(esiPeriodMonthsBefore(2026, 2).map((x) => `${x.year}-${x.month}`)).toEqual(["2026-1", "2025-12", "2025-11", "2025-10"]);
    expect(esiPeriodMonthsBefore(2026, 9).map((x) => x.month)).toEqual([8, 7, 6, 5, 4]);
  });
});

describe("TDS", () => {
  it("is nil up to Rs 12.75 lakh of salary on the new regime (std deduction + rebate)", () => {
    expect(computeTds("new", 0, 0, 0, 106250, 106250, 12, cfg.tds).annual_tax).toBe(0);
  });
  it("applies marginal relief just above Rs 12 lakh taxable", () => {
    // 13,00,000 - 75,000 = 12,25,000 taxable: slab tax 63,750 but relief caps it at 25,000; +4% cess = 26,000.
    const r = computeTds("new", 0, 0, 0, 1300000 / 12, 1300000 / 12, 12, cfg.tds);
    expect(r.projected_taxable).toBe(1225000);
    expect(r.annual_tax).toBe(26000);
    expect(r.tds).toBe(2167);
  });
  it("old regime uses declared deductions and its own slabs", () => {
    expect(slabTax(750000, OLD.slabs)).toBe(62500);
    const r = computeTds("old", 0, 0, 0, 800000 / 12, 800000 / 12, 12, cfg.tds);
    expect(r.projected_taxable).toBe(750000);
    expect(r.annual_tax).toBe(65000);
    expect(computeTds("old", 150000, 0, 0, 800000 / 12, 800000 / 12, 12, cfg.tds).projected_taxable).toBe(600000);
  });
  it("spreads the remaining tax over the remaining months and credits tax already deducted", () => {
    const first = computeTds("new", 0, 0, 0, 200000, 200000, 12, cfg.tds);   // 24 lakh a year
    const later = computeTds("new", 0, 200000 * 7, first.tds * 7, 200000, 200000, 5, cfg.tds);
    expect(later.tds).toBe(first.tds);                                         // steady salary -> steady TDS
    const none = computeTds("new", 0, 200000 * 7, first.annual_tax, 200000, 200000, 5, cfg.tds);
    expect(none.tds).toBe(0);                                                  // already fully deducted
  });
  it("is switched off by configuration", () => expect(computeTds("new", 0, 0, 0, 500000, 500000, 12, { ...cfg.tds, enabled: false }).tds).toBe(0));
});

describe("wages (labour-code definition)", () => {
  it("adds back pay when excluded components exceed 50% of remuneration", () => {
    const lines = [{ name: "Basic", amount: 10000, counts_as_wages: true }, { name: "HRA", amount: 20000, counts_as_wages: false }];
    expect(computeWages(lines, cfg.wages)).toMatchObject({ wages: 15000, remuneration: 30000, uplifted: true });
  });
  it("leaves wages alone when basic is already at least half", () => {
    const lines = [{ name: "Basic", amount: 20000, counts_as_wages: true }, { name: "HRA", amount: 10000, counts_as_wages: false }];
    expect(computeWages(lines, cfg.wages)).toMatchObject({ wages: 20000, uplifted: false });
  });
  it("ignores one-off bonuses when judging the 50% rule", () => {
    const lines = [{ name: "Basic", amount: 20000, counts_as_wages: true }, { name: "Bonus", amount: 50000, one_off: true }];
    expect(computeWages(lines, cfg.wages).wages).toBe(20000);
  });
  it("can be switched off", () => {
    const lines = [{ name: "Basic", amount: 10000, counts_as_wages: true }, { name: "HRA", amount: 20000 }];
    expect(computeWages(lines, { ...cfg.wages, apply_fifty_percent_rule: false }).wages).toBe(10000);
  });
});

describe("attendance", () => {
  const a = cfg.attendance;
  it("Nov 2026 has 25 working days with Sunday off", () => expect(summarizeAttendance([], 2026, 11, a).working_days).toBe(25));
  it("absent = loss of pay, half-day = 0.5, leave is paid, unmarked = present", () => {
    const s = summarizeAttendance([
      { att_date: "2026-11-02", status: "absent" }, { att_date: "2026-11-03", status: "absent" },
      { att_date: "2026-11-04", status: "half_day" }, { att_date: "2026-11-05", status: "leave" },
    ], 2026, 11, a);
    expect(s).toMatchObject({ absent: 2, half_day: 1, leave: 1, lop_days: 2.5, paid_days: 22.5 });
    expect(s.ratio).toBeCloseTo(0.9, 5);
  });
  it("can treat leave as unpaid and unmarked days as absent", () => {
    const s = summarizeAttendance([{ att_date: "2026-11-05", status: "leave" }], 2026, 11, { ...a, leave_is_paid: false, unmarked_days: "absent" });
    expect(s.paid_days).toBe(0);
  });
  it("pays only from the joining date", () => {
    const s = summarizeAttendance([], 2026, 11, a, { from: "2026-11-16" });
    expect(s.counted_days).toBe(13);                  // 16-30 Nov minus Sundays 22 and 29
    expect(s.ratio).toBeCloseTo(13 / 25, 5);
  });
});

describe("salary structure", () => {
  it("validates", () => {
    expect(validateStructure({ basic: 0, hra: 0, da: 0, components: [] })).toContain("Basic salary is required");
    expect(validateStructure({ basic: 1, hra: -1, da: 0, components: [] }).length).toBe(1);
    expect(validateStructure({ basic: 1000, hra: 0, da: 0, components: [{ name: "A", kind: "earning", type: "fixed", value: 1 }, { name: "a", kind: "earning", type: "fixed", value: 1 }] }).length).toBe(1);
  });
  it("builds lines; % of basic and deductions", () => {
    const l = structureLines({ basic: 20000, hra: 8000, da: 0, components: [
      { name: "Transport", kind: "earning", type: "fixed", value: 1600, counts_as_wages: false },
      { name: "Special", kind: "earning", type: "percent_basic", value: 10, counts_as_wages: true },
      { name: "Prof. tax", kind: "deduction", type: "fixed", value: 200 },
    ] });
    expect(l.earnings.map((x) => [x.name, x.amount])).toEqual([["Basic", 20000], ["HRA", 8000], ["Transport", 1600], ["Special", 2000]]);
    expect(l.deductions).toEqual([{ name: "Prof. tax", amount: 200 }]);
  });
});

describe("full payroll item", () => {
  const employee = { id: "e1", name: "A Teacher", code: "EMP-0001", designation: "Teacher", department: "Primary", joining_date: "2020-06-01", last_working_date: null };
  const structure = { basic: 20000, hra: 8000, da: 0, components: [{ name: "Prof. tax", kind: "deduction" as const, type: "fixed" as const, value: 200 }] };
  const prior = { ytd_taxable: 0, ytd_tds: 0, esi_covered_this_period: false };
  const base = { employee, priv: { ...DEFAULT_PRIVATE, pan: "ABCDE1234F", uan: "123456789012" }, structure, attendance: [], adjustments: [], prior, year: 2026, month: 11, cfg };

  it("computes gross, statutory and net consistently", () => {
    const r = computePayrollItem(base);
    expect(r.gross).toBe(28000);
    expect(r.wages).toBe(20000);                       // basic is 71% of pay: no uplift
    expect(r.epf_employee).toBe(2400);                 // 12% of 20,000
    expect(r.esi_employee).toBe(150);                  // wages 20,000 are within the ESI ceiling: 0.75%
    expect(r.total_deductions).toBeCloseTo(r.epf_employee + r.esi_employee + r.tds + r.other_deductions, 2);
    expect(r.net_pay).toBeCloseTo(r.gross - r.total_deductions, 2);
    expect(r.employer.eps).toBe(1666);                 // 8.33% of 20,000
    expect(r.employer.epf).toBe(2400 - 1666);
  });
  it("applies ESI to an employee within the ceiling", () => {
    const r = computePayrollItem(base);
    expect(r.employer.esi).toBe(650);                  // 3.25% of 20,000
    expect(r.esi_employee).toBe(150);                  // 0.75% of 20,000
  });
  it("prorates for loss of pay and adds one-off bonus / deduction", () => {
    const r = computePayrollItem({ ...base, attendance: [{ att_date: "2026-11-02", status: "absent" }, { att_date: "2026-11-03", status: "absent" }],
      adjustments: [{ kind: "bonus", name: "Diwali bonus", amount: 5000, taxable: true }, { kind: "deduction", name: "Advance", amount: 1000, taxable: false }] });
    expect(r.attendance.lop_days).toBe(2);
    expect(r.earnings.find((l) => l.name === "Basic")!.amount).toBe(18400);          // 20,000 x 23/25
    expect(r.earnings.some((l) => l.name === "Diwali bonus")).toBe(true);
    expect(r.other_deductions).toBe(1200);                                           // 200 + 1,000
    expect(r.wages).toBe(18400);                                                     // bonus is not wages
  });
  it("generates nothing for someone who has not joined yet", () => {
    const r = computePayrollItem({ ...base, employee: { ...employee, joining_date: "2026-12-01" } });
    expect(r.gross).toBe(0);
    expect(r.net_pay).toBe(0);
    expect(r.details.warnings.join(" ")).toMatch(/Not employed/);
  });
  it("warns about missing PAN when tax is deducted, and missing UAN for PF members", () => {
    const rich = { ...structure, basic: 400000, hra: 0 };   // 40 lakh a year: well above the rebate limit
    const r = computePayrollItem({ ...base, structure: rich, priv: { ...DEFAULT_PRIVATE, pf_mode: "enrolled" as const } });
    expect(r.details.warnings.join(" ")).toMatch(/PAN/);
    expect(r.details.warnings.join(" ")).toMatch(/UAN/);
  });
});

describe("run totals", () => {
  const item = (o: object) => ({ gross: 0, epf_employee: 0, esi_employee: 0, tds: 0, other_deductions: 0, total_deductions: 0, net_pay: 0, employer: { epf: 0, eps: 0, edli: 0, admin: 0, esi: 0 }, employer_total: 0, ...o });
  it("tops the EPF admin charge up to the establishment minimum", () => {
    const t = runTotals([item({ employer: { epf: 0, eps: 0, edli: 0, admin: 125, esi: 0 }, employer_total: 125 })], cfg.epf);
    expect(t.employer.admin).toBe(500);
    expect(t.epf_admin_minimum_topup).toBe(375);
    expect(t.employer_total).toBe(500);
  });
  it("adds up", () => {
    const t = runTotals([item({ gross: 100, net_pay: 90 }), item({ gross: 50, net_pay: 45 })], cfg.epf);
    expect(t).toMatchObject({ gross: 150, net_pay: 135, employees: 2 });
  });
});

describe("masking", () => { it("hides all but the last four digits", () => expect(maskAccount("123456789012")).toBe("XXXXXXXX9012")); });
