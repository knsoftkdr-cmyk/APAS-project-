import { describe, it, expect } from "vitest";
import { navItems, isNavItemAllowedForRole } from "@/components/layout/AppSidebar";

const visible = (role: string) => navItems.filter((i) => isNavItemAllowedForRole(i, role));
const titles = (role: string) => visible(role).map((i) => i.title);

// What a principal gets by default from usePermissions (DEFAULT_PERMISSIONS.principal). The sidebar hides any item whose `module`
// isn't in this list - which is exactly why a module on this entry would make it vanish.
const PRINCIPAL_MODULES = ["Home", "Reports", "Alerts", "Admin Panel", "AI Tutor", "School Intelligence", "Security Center", "Billing", "Academic Calendar", "Houses", "Semester Engine", "Report Cards", "Invigilation", "Exam Seating", "Hall Tickets", "Attendance", "Safeguarding & Child Protection", "Rotation Schedules", "SEN Management", "School Quality Index"];
const COMBINED = "Adaptive Test & Daily Review";

describe("the principal's single 'Adaptive Test & Daily Review' menu entry", () => {
  it("is ONE entry for both (not two), leading to the Adaptive Test tab and highlighting on the Daily Review tab", () => {
    const entries = visible("principal").filter((i) => i.path === "/adaptive-test" || i.path === "/daily-review");
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe(COMBINED);
    expect(entries[0].path).toBe("/adaptive-test");
    expect(entries[0].alsoActiveOn).toEqual(["/daily-review"]);
  });
  it("a principal with default permissions actually sees it (no module requirement)", () => {
    const item = visible("principal").find((i) => i.title === COMBINED)!;
    expect(item.module).toBeUndefined();
    expect(!item.module || PRINCIPAL_MODULES.includes(item.module)).toBe(true);
    expect(item.roles).toEqual(["principal"]);
  });
  it("the student entries are exactly as before: separate, students only, still gated by the Assessments module", () => {
    for (const title of ["Adaptive Test", "Daily Review"]) {
      const item = navItems.find((i) => i.title === title && i.roles?.includes("student"))!;
      expect(item.roles).toEqual(["student"]);
      expect(item.module).toBe("Assessments");
      expect(titles("student").filter((t) => t === title)).toHaveLength(1);
    }
    expect(titles("student")).not.toContain(COMBINED);
  });
  it.each(["teacher", "admin", "school_admin", "hod", "parent", "student"])("%s does not get the combined entry", (role) => {
    expect(titles(role)).not.toContain(COMBINED);
  });
  it.each(["teacher", "admin", "school_admin", "hod", "parent"])("%s gets neither Adaptive Test nor Daily Review", (role) => {
    expect(titles(role)).not.toContain("Adaptive Test");
    expect(titles(role)).not.toContain("Daily Review");
  });
  it("the principal no longer has separate Adaptive Test / Daily Review rows", () => {
    expect(titles("principal")).not.toContain("Adaptive Test");
    expect(titles("principal")).not.toContain("Daily Review");
  });
});
