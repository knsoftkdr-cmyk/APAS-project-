import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "hod" } }) }));

import { navItems, isNavItemAllowedForRole } from "@/components/layout/AppSidebar";
import {
  HOD_EXTRA_PHRASES,
  HOD_BLOCKED_BY_ROUTE,
  buildHodDestinations,
  getHodDestinations,
  resolveHodNavigation as resolve,
} from "@/lib/hodNavigation";

const dests = getHodDestinations();
const nav = (t: string, ctx = {}) => resolve(t, ctx);
const pathOf = (t: string, ctx = {}) => {
  const r = nav(t, ctx);
  return r.kind === "navigate" ? r.destination.path : r.kind;
};

// What a HOD gets in a school that has not changed the defaults (src/hooks/usePermissions.ts).
const DEFAULT_HOD_MODULES = ["Home", "Reports", "Assessments", "Analytics", "Academic Calendar", "Houses", "Safeguarding & Child Protection"];

const app = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
const admitsHod = (p: string): boolean | "no-route" => {
  const m = [...app.matchAll(/<Route path="([^"]+)" element=\{([\s\S]*?)\} \/>/g)].find((x) => x[1] === p.split("?")[0]);
  if (!m) return "no-route";
  const g = m[2].match(/allowedRoles=\{\[([^\]]*)\]\}/);
  return g ? /["']hod["']/.test(g[1]) : true;
};
const hodSidebarPaths = () => {
  const s = new Set<string>();
  for (const it of navItems) {
    if (!isNavItemAllowedForRole(it, "hod")) continue;
    s.add(it.path);
    if (it.subItem) s.add(it.subItem.path);
  }
  return s;
};

describe("HOD navigation - what a head of department would say", () => {
  it("Open class mastery", () => expect(pathOf("Open class mastery")).toBe("/class-mastery"));
  it("Take me to the intervention board", () => expect(pathOf("Take me to the intervention board")).toBe("/intervention-board"));
  it("Go to syllabus coverage", () => expect(pathOf("Go to syllabus coverage")).toBe("/syllabus-overview"));
  it("Open my timetable", () => expect(pathOf("Open my timetable")).toBe("/timetable"));
  it("Open the dashboard", () => expect(pathOf("Open the dashboard")).toBe("/hod-dashboard"));
  it("go home", () => expect(pathOf("go home")).toBe("/hod-dashboard"));
  it("Open the heat map", () => expect(pathOf("open the heat map")).toBe("/competency-heatmap"));
  it("Open early warning", () => expect(pathOf("open early warning")).toBe("/early-warning"));
  it("Open the admin panel", () => expect(pathOf("open the admin panel")).toBe("/admin"));
  it("Hey APAS, open alerts", () => expect(pathOf("Hey APAS, open alerts")).toBe("/alerts"));
  it("Open homework", () => expect(pathOf("open homework")).toBe("/dashboard"));
});

describe("destinations come from the sidebar, not a second menu", () => {
  it("are exactly the sidebar items a HOD can see, minus routes that would bounce them", () => {
    const expected = new Set([...hodSidebarPaths()].filter((p) => !HOD_BLOCKED_BY_ROUTE.includes(p)));
    expected.add("/mock-exams").add("/exam-reviews"); // the Item Bank tabs
    expect(new Set(dests.map((d) => d.path))).toEqual(expected);
  });
  it("every synonym key is a real HOD destination", () => {
    const paths = new Set(dests.map((d) => d.path));
    for (const k of Object.keys(HOD_EXTRA_PHRASES)) expect(paths.has(k), k).toBe(true);
  });
});

describe("a HOD is never sent to a page that would bounce them", () => {
  it("every destination is a route in App.tsx that admits HODs", () => {
    for (const d of dests) expect(admitsHod(d.path), d.path).toBe(true);
  });
  it("every excluded path is really blocked for HODs and really is on the HOD sidebar (so the list never goes stale)", () => {
    const side = hodSidebarPaths();
    for (const p of HOD_BLOCKED_BY_ROUTE) {
      expect(side.has(p), `${p} is not a HOD sidebar row any more - remove it from HOD_BLOCKED_BY_ROUTE`).toBe(true);
      expect(admitsHod(p), `${p} now admits HODs - remove it from HOD_BLOCKED_BY_ROUTE`).toBe(false);
    }
  });
  it.each(["open gamification", "open leaderboard", "open predictions", "open ai tutor", "open ai career coach", "open academic tests"])(
    "%s is 'not available', never a navigation",
    (t) => {
      const r = nav(t);
      if (r.kind === "navigate") throw new Error(`navigated to ${r.destination.path}`);
      expect(["blocked", "clarify", "not-found"]).toContain(r.kind);
    },
  );
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

describe("only the pages this HOD's school lets them see", () => {
  const defaults = buildHodDestinations(undefined, (m) => DEFAULT_HOD_MODULES.includes(m));
  const withDefaults = (t: string) => resolve(t, { destinations: defaults });
  it("modules the school has not enabled are not destinations", () => {
    const paths = new Set(defaults.map((d) => d.path));
    expect(paths.has("/hod-dashboard")).toBe(true); // "Home"
    expect(paths.has("/timetable")).toBe(true); // module "Home"
    expect(paths.has("/houses")).toBe(true);
    expect(paths.has("/billing")).toBe(false); // off by default for HODs
    expect(paths.has("/admin")).toBe(false);
    expect(paths.has("/security")).toBe(false);
    expect(paths.has("/class-mastery")).toBe(true); // no module = always shown
  });
  it("an off page is 'not available'; the same page opens in a school that has it", () => {
    expect(withDefaults("open billing").kind).toBe("blocked");
    expect(resolve("open billing", { destinations: getHodDestinations(() => true) }).kind).toBe("navigate");
  });
  it("replies say 'HOD menu'", () => {
    const r = withDefaults("open billing");
    expect(r.kind === "blocked" && r.reply).toMatch(/HOD menu/);
  });
});

describe("only HOD pages", () => {
  it.each([
    "open admissions",
    "open transport",
    "open lesson plan generator",
    "open student dashboard",
    "open teacher dashboard",
    "open principal dashboard",
    "open parent dashboard",
    "open student profile",
    "open id cards",
    "open student transfers",
  ])("%s does not navigate", (t) => {
    const r = nav(t);
    if (r.kind === "navigate") throw new Error(`navigated to ${r.destination.path}`);
    expect(["blocked", "clarify", "not-found"]).toContain(r.kind);
  });
});

describe("data questions stay with the HOD assistant", () => {
  it.each([
    "which students are at risk in my department",
    "show class mastery for class 8",
    "open class mastery for class 8",
    "how is attendance today",
    "summarise this week's alerts",
    "compare class 8 and class 9 results",
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
