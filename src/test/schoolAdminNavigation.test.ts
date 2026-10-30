import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "school_admin" } }) }));

import { navItems, isNavItemAllowedForRole } from "@/components/layout/AppSidebar";
import {
  SCHOOL_ADMIN_EXTRA_PHRASES,
  buildSchoolAdminDestinations,
  getSchoolAdminDestinations,
  resolveSchoolAdminNavigation as resolve,
} from "@/lib/schoolAdminNavigation";

const dests = getSchoolAdminDestinations();
const nav = (t: string, ctx = {}) => resolve(t, ctx);
const pathOf = (t: string, ctx = {}) => {
  const r = nav(t, ctx);
  return r.kind === "navigate" ? r.destination.path : r.kind;
};

const app = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
const admitsSchoolAdmin = (p: string): boolean | "no-route" => {
  const m = [...app.matchAll(/<Route path="([^"]+)" element=\{([\s\S]*?)\} \/>/g)].find((x) => x[1] === p.split("?")[0]);
  if (!m) return "no-route";
  const g = m[2].match(/allowedRoles=\{\[([^\]]*)\]\}/);
  return g ? /["']school_admin["']/.test(g[1]) : true;
};

describe("school admin navigation - what a school admin would say", () => {
  it("Open admissions", () => expect(pathOf("Open admissions")).toBe("/admissions"));
  it("Take me to student transfers", () => expect(pathOf("Take me to student transfers")).toBe("/student-transfers"));
  it("Go to ID cards", () => expect(pathOf("Go to ID cards")).toBe("/id-cards"));
  it("Open transport", () => expect(pathOf("Open transport")).toBe("/transport"));
  it("Open the alumni page", () => expect(pathOf("open the alumni page")).toBe("/alumni"));
  it("Open the admin panel", () => expect(pathOf("Open the admin panel")).toBe("/super-admin"));
  it("Open executive reports", () => expect(pathOf("open executive reports")).toBe("/executive-reporting"));
  it("Open analytics", () => expect(pathOf("open analytics")).toBe("/executive-reporting"));
  it("'executive' is Executive Reporting, not a fuzzy match to Electives", () => expect(pathOf("open executive")).toBe("/executive-reporting"));
  it("Open TC", () => expect(pathOf("open tc")).toBe("/student-transfers"));
  it("Open admin dashboard", () => expect(pathOf("open admin dashboard")).toBe("/dashboard"));
  it("Open the dashboard", () => expect(pathOf("Open the dashboard")).toBe("/dashboard"));
  it("go home", () => expect(pathOf("go home")).toBe("/dashboard"));
  it("Open the lifecycle timeline", () => expect(pathOf("open the lifecycle timeline")).toBe("/lifecycle-timeline"));
  it("Open the hall tickets", () => expect(pathOf("open hall tickets")).toBe("/hall-tickets"));
  it("Hey APAS, open branches", () => expect(pathOf("Hey APAS, open branches")).toBe("/admin/branches"));
});

describe("destinations come from the sidebar, not a second menu", () => {
  it("are exactly the sidebar items a school admin can see", () => {
    const expected = new Set<string>(["/mock-exams", "/exam-reviews"]); // the Item Bank tabs
    for (const it of navItems) {
      if (!isNavItemAllowedForRole(it, "school_admin")) continue;
      expected.add(it.path);
      if (it.subItem) expected.add(it.subItem.path);
    }
    expect(new Set(dests.map((d) => d.path))).toEqual(expected);
  });
  it("every synonym key is a real school-admin destination", () => {
    const paths = new Set(dests.map((d) => d.path));
    for (const k of Object.keys(SCHOOL_ADMIN_EXTRA_PHRASES)) expect(paths.has(k), k).toBe(true);
  });
  it("every destination is a route in App.tsx that admits school admins", () => {
    for (const d of dests) expect(admitsSchoolAdmin(d.path), d.path).toBe(true);
  });
  it("school admins bypass the per-school permission check, so the permission-filtered list is the same list", () => {
    const withBypass = buildSchoolAdminDestinations(undefined, () => true);
    expect(withBypass.map((d) => d.path)).toEqual(dests.map((d) => d.path));
  });
});

describe("every supported page opens, however it is phrased", () => {
  for (const d of dests) {
    it(d.title, () => {
      for (const phrase of [`Open ${d.title}`, `take me to ${d.title}`, `go to the ${d.title} page`, `can you please navigate to ${d.title}?`]) {
        expect(pathOf(phrase), phrase).toBe(d.path);
      }
    });
  }
  it("reaches the Item Bank tabs", () => {
    expect(pathOf("open mock exams")).toBe("/mock-exams");
    expect(pathOf("open exam reviews")).toBe("/exam-reviews");
  });
  it("a word that fits several pages asks", () => expect(nav("open competency").kind).toBe("clarify"));
});

describe("only school-admin pages", () => {
  it.each([
    "open gamification",
    "open lesson plan generator",
    "open my mastery",
    "open assessment builder",
    "open student dashboard",
    "open teacher dashboard",
    "open parent dashboard",
    "open student profile",
    "open billing",
    "open hod dashboard",
  ])("%s does not navigate", (t) => {
    const r = nav(t);
    if (r.kind === "navigate" && !/mastery/.test(t)) throw new Error(`navigated to ${r.destination.path}`);
    expect(["blocked", "clarify", "not-found", "navigate"]).toContain(r.kind);
  });
  it("replies say 'school admin menu'", () => {
    const r = nav("open gamification");
    expect(r.kind === "blocked" && r.reply).toMatch(/school admin menu/);
  });
});

describe("data questions stay with the school-admin assistant", () => {
  it.each([
    "how many admissions this month",
    "show pending transfers",
    "open admissions for class 5",
    "how many id cards are pending",
    "which buses are running late",
    "summarise the executive report",
    "hello",
  ])("%s", (t) => expect(nav(t).kind).toBe("none"));
  it('"show me the transport page" is explicit navigation', () => expect(pathOf("show me the transport page")).toBe("/transport"));
});

describe("unclear requests", () => {
  it("no page named", () => {
    for (const t of ["open", "open it", "take me somewhere"]) expect(nav(t).kind, t).toBe("vague");
  });
  it("unknown page", () => expect(nav("open the zebra").kind).toBe("not-found"));
  it("already there", () => expect(nav("open transport", { currentPath: "/transport" }).kind).toBe("already"));
  it("several pages at once ask which first", () => expect(nav("open admissions and transport").kind).toBe("clarify"));
});
