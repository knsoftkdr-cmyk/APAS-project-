import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/learningEvents", () => ({ call: vi.fn() }));

import { jsPDF } from "jspdf";
import { amountInWords, drawSalarySlip, nextEmployeeCode, toCsv, monthLabel, monthRange, type PayrollItem } from "@/lib/hr";

describe("hr helpers", () => {
  it("amount in words uses Indian grouping", () => {
    expect(amountInWords(0)).toBe("Zero Rupees Only");
    expect(amountInWords(25000)).toBe("Twenty Five Thousand Rupees Only");
    expect(amountInWords(123456)).toBe("One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only");
    expect(amountInWords(12500000)).toBe("One Crore Twenty Five Lakh Rupees Only");
  });
  it("neutralises spreadsheet formulas and escapes CSV", () => {
    expect(toCsv([["=SUM(A1)", "a,b", 'say "hi"', "+91 98", -5, null]])).toBe(`'=SUM(A1),"a,b","say ""hi""",+91 98,-5,`.replace("+91 98", "'+91 98"));
  });
  it("suggests the next free employee code", () => {
    expect(nextEmployeeCode([])).toBe("EMP-0001");
    expect(nextEmployeeCode([{ employee_code: "EMP-0007" }, { employee_code: "X1" }, { employee_code: null }])).toBe("EMP-0008");
  });
  it("month helpers", () => {
    expect(monthLabel(2026, 11)).toBe("November 2026");
    expect(monthRange(2026, 2)).toMatchObject({ from: "2026-02-01", to: "2026-02-28", days: 28 });
    expect(monthRange(2028, 2).days).toBe(29);
  });
  it("renders a salary slip PDF", () => {
    const item = {
      id: "1", run_id: "r", employee_id: "e", employee_name: "A Teacher", employee_code: "EMP-0001", designation: "Teacher", department: "Primary", joining_date: "2020-06-01",
      pan: "ABCDE1234F", uan: "123456789012", bank_account_masked: "XXXXXXXX9012", attendance: { working_days: 25, paid_days: 25, lop_days: 0 },
      earnings: [{ name: "Basic", amount: 20000 }, { name: "HRA", amount: 8000 }], deduction_lines: [{ name: "Prof. tax", amount: 200 }], gross: 28000, epf_employee: 2400,
      esi_employee: 150, tds: 0, other_deductions: 200, total_deductions: 2750, net_pay: 25250, employer: { epf: 734, eps: 1666, edli: 100, admin: 100, esi: 650 }, employer_total: 3250,
      wages: 20000, details: {}, payment_status: "unpaid", paid_on: null, payment_mode: null, payment_reference: null,
    } as unknown as PayrollItem;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    expect(() => drawSalarySlip(doc, item, { year: 2026, month: 11, status: "finalized" }, "Test School")).not.toThrow();
    expect(doc.getNumberOfPages()).toBe(1);
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(1500);
  });
});
