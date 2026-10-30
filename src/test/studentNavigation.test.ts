import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// AppSidebar (the menu definitions we reuse) pulls in app services; none are exercised here.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "student" } }) }));

import { navItems, isNavItemAllowedForRole } from "@/components/layout/AppSidebar";
import {
  EXTRA_PHRASES,
  getStudentDestinations,
  resolveStudentNavigation as resolve,
} from "@/lib/studentNavigation";

const dests = getStudentDestinations();
const nav = (text: string, ctx = {}) => resolve(text, ctx);
const pathOf = (text: string, ctx = {}) => {
  const r = nav(text, ctx);
  return r.kind === "navigate" ? r.destination.path : r.kind;
};

describe("Study Buddy navigation - the requests from the brief", () => {
  it("Open Gamification", () => expect(pathOf("Open Gamification")).toBe("/gamification"));
  it("Take me to My Mastery", () => expect(pathOf("Take me to My Mastery")).toBe("/my-mastery"));
  it("Open my timetable", () => expect(pathOf("Open my timetable")).toBe("/timetable"));
});

describe("destinations come from the sidebar, not a second menu", () => {
  it("are exactly the sidebar items a student can see (+ the Exam Readiness tab)", () => {
    const fromSidebar = new Set<string>();
    for (const it of navItems) {
      if (!isNavItemAllowedForRole(it, "student")) continue;
      fromSidebar.add(it.path);
      if (it.subItem) fromSidebar.add(it.subItem.path);
    }
    fromSidebar.add("/exam-readiness");
    expect(new Set(dests.map((d) => d.path))).toEqual(fromSidebar);
  });

  it("every synonym key is a real student destination", () => {
    const paths = new Set(dests.map((d) => d.path));
    for (const key of Object.keys(EXTRA_PHRASES)) expect(paths.has(key), key).toBe(true);
  });

  it("every destination is a route in App.tsx that admits students (so it never bounces to /dashboard)", () => {
    const app = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
    for (const d of dests) {
      const p = d.path.split("?")[0];
      const m = [...app.matchAll(/<Route path="([^"]+)" element=\{([\s\S]*?)\} \/>/g)].find((x) => x[1] === p);
      expect(m, `no route for ${p}`).toBeTruthy();
      const guard = m![2].match(/allowedRoles=\{\[([^\]]*)\]\}/);
      if (guard) expect(/["']student["']/.test(guard[1]), `${p} blocks students`).toBe(true);
    }
  });
});

describe("every supported page opens, however the student phrases it", () => {
  for (const d of dests) {
    it(d.title, () => {
      for (const phrase of [`Open ${d.title}`, `take me to ${d.title}`, `go to the ${d.title} page`, `can you please navigate to ${d.title}?`]) {
        expect(pathOf(phrase), phrase).toBe(d.path);
      }
    });
  }
  it("understands how speech recognition writes things", () => {
    expect(pathOf("open time table")).toBe("/timetable");
    expect(pathOf("open leader board")).toBe("/leaderboard");
    expect(pathOf("open home work")).toBe("/dashboard");
    expect(pathOf("take me to my mastry")).toBe("/my-mastery");
    expect(pathOf("go home")).toBe("/student-dashboard");
  });
  it("reaches the two tabs that have their own route", () => {
    expect(pathOf("open exam readiness")).toBe("/exam-readiness");
    expect(pathOf("open my ai career coach")).toBe("/ai-tutor?mode=career");
  });
});

describe("only student pages", () => {
  it.each(["open admin panel", "open teacher dashboard", "open billing", "open analytics", "open courses", "open alerts", "take me to teacher timetable", "open parent dashboard"])(
    "%s does not navigate to a page outside the student menu",
    (text) => {
      const r = nav(text);
      if (r.kind === "navigate") throw new Error(`navigated to ${r.destination.path}`);
      expect(["blocked", "clarify", "not-found"]).toContain(r.kind);
    },
  );
  it("offers the student's own page when a teacher page is asked for", () => {
    const r = nav("open teacher timetable");
    expect(r.kind).toBe("clarify");
    expect(nav("yes", { pending: r.kind === "clarify" ? r.options : null })).toMatchObject({ kind: "navigate" });
  });
});

describe("unclear requests are handled gracefully", () => {
  it("no page named", () => {
    for (const t of ["open", "open it", "take me somewhere", "go to"]) expect(nav(t).kind, t).toBe("vague");
  });
  it("ambiguous names ask which one, then accept a short answer", () => {
    const r = nav("open test");
    expect(r.kind).toBe("clarify");
    const options = r.kind === "clarify" ? r.options : [];
    expect(options.map((o) => o.title)).toEqual(["Academic Tests", "Assessments", "Adaptive Test"]);
    expect(pathOf("the second one", { pending: options })).toBe("/diagnostic");
    expect(pathOf("last one", { pending: options })).toBe("/adaptive-test");
    expect(pathOf("adaptive test", { pending: options })).toBe("/adaptive-test");
    expect(nav("never mind", { pending: options }).kind).toBe("cancel");
  });
  it("unknown page", () => expect(nav("open the zebra").kind).toBe("not-found"));
  it("already there", () => expect(nav("open timetable", { currentPath: "/timetable" }).kind).toBe("already"));
  it("several pages at once ask which first", () => expect(nav("open gamification and timetable").kind).toBe("clarify"));
});

describe("everything else is left to the existing assistant", () => {
  it.each([
    "what is my timetable today",
    "show my homework",
    "show me my timetable",
    "check my attendance",
    "how do I open gamification",
    "where is the leaderboard",
    "don't open gamification",
    "explain gamification",
    "take me through fractions",
    "open homework and tell me what is due",
    "hello",
  ])("%s", (text) => expect(nav(text).kind).toBe("none"));
  it('"show me the timetable page" is explicit navigation', () => expect(pathOf("show me the timetable page")).toBe("/timetable"));
});
