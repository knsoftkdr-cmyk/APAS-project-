import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "principal" } }) }));

import { navItems, isNavItemAllowedForRole } from "@/components/layout/AppSidebar";
import {
  PRINCIPAL_EXTRA_PHRASES,
  buildPrincipalDestinations,
  getPrincipalDestinations,
  resolvePrincipalNavigation as resolve,
} from "@/lib/principalNavigation";

const dests = getPrincipalDestinations();
const nav = (t: string, ctx = {}) => resolve(t, ctx);
const pathOf = (t: string, ctx = {}) => {
  const r = nav(t, ctx);
  return r.kind === "navigate" ? r.destination.path : r.kind;
};

// What a principal gets in a school that has not changed the defaults (src/hooks/usePermissions.ts).
const DEFAULT_PRINCIPAL_MODULES = ["Home", "Reports", "Alerts", "Admin Panel", "AI Tutor", "School Intelligence", "Security Center", "Billing", "Academic Calendar", "Houses", "Semester Engine", "Report Cards", "Invigilation", "Exam Seating", "Hall Tickets", "Attendance", "Safeguarding & Child Protection", "Rotation Schedules", "SEN Management", "School Quality Index"];

const app = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
const admitsPrincipal = (p: string) => {
  const m = [...app.matchAll(/<Route path="([^"]+)" element=\{([\s\S]*?)\} \/>/g)].find((x) => x[1] === p.split("?")[0]);
  if (!m) return "no-route";
  const g = m[2].match(/allowedRoles=\{\[([^\]]*)\]\}/);
  return g ? /["']principal["']/.test(g[1]) : true;
};

describe("principal navigation - what a principal would say", () => {
  it("Open school intelligence", () => expect(pathOf("Open school intelligence")).toBe("/school-analytics"));
  it("Take me to attendance", () => expect(pathOf("Take me to attendance")).toBe("/attendance"));
  it("Go to admissions", () => expect(pathOf("Go to admissions")).toBe("/admissions"));
  it("Open the admin panel", () => expect(pathOf("Open the admin panel")).toBe("/admin"));
  it("Open my timetable", () => expect(pathOf("Open my timetable")).toBe("/timetable"));
  it("Open the principal dashboard", () => expect(pathOf("Open the principal dashboard")).toBe("/dashboard"));
  it("Open syllabus", () => expect(pathOf("open syllabus")).toBe("/syllabus-overview"));
  it("Open the school quality index", () => expect(pathOf("open the school quality index")).toBe("/school-quality-index"));
  it("Open the heat map", () => expect(pathOf("open the heat map")).toBe("/competency-heatmap"));
  it("Open branches", () => expect(pathOf("open branches")).toBe("/admin/branches"));
  it("Open the bus page", () => expect(pathOf("take me to transportation")).toBe("/transport"));
  it("Hey APAS, open alerts", () => expect(pathOf("Hey APAS, open alerts")).toBe("/alerts"));
  it("go home", () => expect(pathOf("go home")).toBe("/dashboard"));
});

describe("destinations come from the sidebar, not a second menu", () => {
  it("are exactly the sidebar items a principal can see (+ the two Item Bank tabs)", () => {
    const expected = new Set<string>(["/mock-exams", "/exam-reviews"]);
    for (const it of navItems) {
      if (!isNavItemAllowedForRole(it, "principal")) continue;
      expected.add(it.path);
      if (it.subItem) expected.add(it.subItem.path);
    }
    expect(new Set(dests.map((d) => d.path))).toEqual(expected);
  });
  it("every synonym key is a real principal destination", () => {
    const paths = new Set(dests.map((d) => d.path));
    for (const k of Object.keys(PRINCIPAL_EXTRA_PHRASES)) expect(paths.has(k), k).toBe(true);
  });
  it("every destination is a route in App.tsx that admits principals", () => {
    for (const d of dests) expect(admitsPrincipal(d.path), d.path).toBe(true);
  });
});

describe("every principal page opens, however it is phrased", () => {
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
  it("a word that fits several pages asks", () => {
    expect(nav("open competency").kind).toBe("clarify");
  });
});

describe("only the pages this principal's school lets them see", () => {
  const defaults = buildPrincipalDestinations(undefined, (m) => DEFAULT_PRINCIPAL_MODULES.includes(m));
  const withDefaults = (t: string) => resolve(t, { destinations: defaults });
  it("modules the school has not enabled are not destinations", () => {
    const paths = new Set(defaults.map((d) => d.path));
    expect(paths.has("/attendance")).toBe(true); // "Attendance"
    expect(paths.has("/school-analytics")).toBe(true); // "School Intelligence"
    expect(paths.has("/admin/branches")).toBe(false); // "Branch Management" - off by default
    expect(paths.has("/marketplace")).toBe(false);
    expect(paths.has("/admissions")).toBe(true); // no module = always shown
  });
  it("an off page is 'not available'; the same page opens in a school that has it", () => {
    expect(withDefaults("open branches").kind).toBe("blocked");
    expect(resolve("open branches", { destinations: getPrincipalDestinations(() => true) }).kind).toBe("navigate");
  });
  it("replies say 'principal menu'", () => {
    const r = withDefaults("open branches");
    expect(r.kind === "blocked" && r.reply).toMatch(/principal menu/);
  });
});

describe("only principal pages", () => {
  it.each([
    "open gamification",
    "open lesson plan generator",
    "open assessment builder",
    "open student dashboard",
    "open teacher dashboard",
    "open parent dashboard",
    "open student profile",
    "open billing",
  ])("%s does not navigate", (t) => {
    const r = nav(t);
    if (r.kind === "navigate") throw new Error(`navigated to ${r.destination.path}`);
    expect(["blocked", "clarify", "not-found"]).toContain(r.kind);
  });
});

describe("data questions stay with the principal assistant", () => {
  it.each([
    "how is attendance today",
    "show me today's attendance",
    "show attendance for class 5",
    "open attendance for class 5",
    "which students are at risk",
    "how many teachers are absent",
    "summarise this week's alerts",
    "compare class 5 and class 6 results",
    "hello",
  ])("%s", (t) => expect(nav(t).kind).toBe("none"));
  it('"show me the alerts page" is explicit navigation', () => expect(pathOf("show me the alerts page")).toBe("/alerts"));
});

describe("unclear requests", () => {
  it("no page named", () => {
    for (const t of ["open", "open it", "take me somewhere"]) expect(nav(t).kind, t).toBe("vague");
  });
  it("unknown page", () => expect(nav("open the zebra").kind).toBe("not-found"));
  it("already there", () => expect(nav("open alerts", { currentPath: "/alerts" }).kind).toBe("already"));
});
