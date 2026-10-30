import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "parent" } }) }));

import { navItems, isNavItemAllowedForRole } from "@/components/layout/AppSidebar";
import { PARENT_EXTRA_PHRASES, getParentDestinations, resolveParentNavigation as resolve } from "@/lib/parentNavigation";
import { resolveTeacherNavigation } from "@/lib/teacherNavigation";

const dests = getParentDestinations();
const nav = (t: string, ctx = {}) => resolve(t, ctx);
const pathOf = (t: string, ctx = {}) => {
  const r = nav(t, ctx);
  return r.kind === "navigate" ? r.destination.path : r.kind;
};

const app = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
const admitsParent = (p: string) => {
  const m = [...app.matchAll(/<Route path="([^"]+)" element=\{([\s\S]*?)\} \/>/g)].find((x) => x[1] === p.split("?")[0]);
  if (!m) return "no-route";
  const g = m[2].match(/allowedRoles=\{\[([^\]]*)\]\}/);
  return g ? /["']parent["']/.test(g[1]) : true;
};

describe("parent navigation - what a parent would say", () => {
  it("Open my child's report card", () => expect(pathOf("Open my child's report card")).toBe("/report-cards"));
  it("Take me to attendance", () => expect(pathOf("Take me to attendance")).toBe("/attendance"));
  it("Go to appointments", () => expect(pathOf("Go to appointments")).toBe("/appointments"));
  it("Open my child's attendance", () => expect(pathOf("Open my child's attendance")).toBe("/attendance"));
  it("Open my child's results", () => expect(pathOf("Open my child's results")).toBe("/report-cards"));
  it("Open the dashboard", () => expect(pathOf("Open the dashboard")).toBe("/parent-dashboard"));
  it("go home", () => expect(pathOf("go home")).toBe("/parent-dashboard"));
  it("Open my child's profile", () => expect(pathOf("Open my child's profile")).toBe("/student-profile"));
  it("Open student profile is the parent's own page", () => expect(pathOf("open student profile")).toBe("/student-profile"));
  it("Take me to messages", () => expect(pathOf("Take me to messages")).toBe("/parent-communication"));
  it("Open the hall ticket", () => expect(pathOf("open the hall ticket")).toBe("/hall-tickets"));
  it("Open the school calender", () => expect(pathOf("open the school calender")).toBe("/academic-calendar"));
  it("Book a parent teacher meeting page", () => expect(pathOf("go to parent teacher meeting")).toBe("/appointments"));
  it("Hey APAS, open safeguarding", () => expect(pathOf("Hey APAS, open safeguarding")).toBe("/parent/safeguarding"));
});

describe("destinations come from the sidebar, not a second menu", () => {
  it("are exactly the sidebar items a parent can see (no permission filter for parents)", () => {
    const expected = new Set<string>();
    for (const it of navItems) {
      if (!isNavItemAllowedForRole(it, "parent")) continue;
      expected.add(it.path);
      if (it.subItem) expected.add(it.subItem.path);
    }
    expect(new Set(dests.map((d) => d.path))).toEqual(expected);
  });
  it("every synonym key is a real parent destination", () => {
    const paths = new Set(dests.map((d) => d.path));
    for (const k of Object.keys(PARENT_EXTRA_PHRASES)) expect(paths.has(k), k).toBe(true);
  });
  it("every destination is a route in App.tsx that admits parents", () => {
    for (const d of dests) expect(admitsParent(d.path), d.path).toBe(true);
  });
});

describe("every parent page opens, however it is phrased", () => {
  for (const d of dests) {
    it(d.title, () => {
      for (const phrase of [`Open ${d.title}`, `take me to ${d.title}`, `go to the ${d.title} page`, `can you please navigate to ${d.title}?`]) {
        expect(pathOf(phrase), phrase).toBe(d.path);
      }
    });
  }
});

describe("only parent pages", () => {
  it.each([
    "open gamification",
    "open lesson plan generator",
    "open timetable",
    "open admissions",
    "open teacher dashboard",
    "open principal dashboard",
    "open admin panel",
    "open homework",
    "open my mastery",
  ])("%s does not navigate", (t) => {
    const r = nav(t);
    if (r.kind === "navigate") throw new Error(`navigated to ${r.destination.path}`);
    expect(["blocked", "clarify", "not-found"]).toContain(r.kind);
  });
  it("replies say 'parent menu'", () => {
    const r = nav("open gamification");
    expect(r.kind === "blocked" && r.reply).toMatch(/parent menu/);
  });
  it("the teacher's resolver is unaffected: it still opens a teacher page a parent cannot", () => {
    expect(resolveTeacherNavigation("open lesson plan generator").kind).toBe("navigate");
  });
});

describe("questions about the child stay with the parent assistant", () => {
  it.each([
    "what is my child's attendance",
    "show my child's attendance",
    "show fee status",
    "when is the next exam",
    "how is my child doing in maths",
    "open attendance for last month",
    "is there a bus delay today",
    "tell me about the report card",
    "hello",
    "show me the bus status",
    "open fees",
    "open transport",
    "take me to the bus tracking",
  ])("%s", (t) => expect(nav(t).kind).toBe("none"));
  it('"show me the report cards page" is explicit navigation', () => expect(pathOf("show me the report cards page")).toBe("/report-cards"));
});

describe("unclear requests", () => {
  it("no page named", () => {
    for (const t of ["open", "open it", "take me somewhere"]) expect(nav(t).kind, t).toBe("vague");
  });
  it("unknown page", () => expect(nav("open the zebra").kind).toBe("not-found"));
  it("already there", () => expect(nav("open attendance", { currentPath: "/attendance" }).kind).toBe("already"));
  it("several pages at once ask which first", () => expect(nav("open attendance and report cards").kind).toBe("clarify"));
});
