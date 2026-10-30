import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// AppSidebar (the menu definitions we reuse) pulls in app services; none are exercised here.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "teacher" } }) }));

import { navItems, isNavItemAllowedForRole } from "@/components/layout/AppSidebar";
import {
  TEACHER_EXTRA_PHRASES,
  TEACHER_BLOCKED_BY_ROUTE,
  buildTeacherDestinations,
  getTeacherDestinations,
  resolveTeacherNavigation as resolve,
} from "@/lib/teacherNavigation";
import { resolveStudentNavigation } from "@/lib/studentNavigation";

const dests = getTeacherDestinations();
const nav = (text: string, ctx = {}) => resolve(text, ctx);
const pathOf = (text: string, ctx = {}) => {
  const r = nav(text, ctx);
  return r.kind === "navigate" ? r.destination.path : r.kind;
};

// The modules a teacher gets in a school that has not changed the defaults (src/hooks/usePermissions.ts).
const DEFAULT_TEACHER_MODULES = ["Home", "Reports", "Lesson Plans", "Analytics", "Requests", "Academic Calendar", "Houses", "Semester Engine", "Attendance", "Group Projects", "Safeguarding & Child Protection"];

const app = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
const routeFor = (p: string) => [...app.matchAll(/<Route path="([^"]+)" element=\{([\s\S]*?)\} \/>/g)].find((x) => x[1] === p.split("?")[0]);
const guardAdmitsTeacher = (p: string): boolean | "no-route" => {
  const m = routeFor(p);
  if (!m) return "no-route";
  const guard = m[2].match(/allowedRoles=\{\[([^\]]*)\]\}/);
  return guard ? /["']teacher["']/.test(guard[1]) : true; // no RoleGuard = open to every signed-in role
};

describe("APAS Agent navigation - the requests a teacher would make", () => {
  it("Open my timetable", () => expect(pathOf("Open my timetable")).toBe("/timetable"));
  it("Take me to attendance", () => expect(pathOf("Take me to attendance")).toBe("/attendance"));
  it("Open the lesson plan generator", () => expect(pathOf("Open the lesson plan generator")).toBe("/curative"));
  it("Go to class mastery", () => expect(pathOf("Go to class mastery")).toBe("/class-mastery"));
  it("Open my classroom", () => expect(pathOf("Open my classroom")).toBe("/classroom"));
  it("Open the assessment builder", () => expect(pathOf("Open the assessment builder")).toBe("/assessment-builder"));
  it("Take me to report cards", () => expect(pathOf("Take me to report cards")).toBe("/report-cards"));
  it("Hey APAS, open the intervention board", () => expect(pathOf("Hey APAS, open the intervention board")).toBe("/intervention-board"));
});

describe("destinations come from the sidebar, not a second menu", () => {
  it("are exactly the sidebar items a teacher can see, minus routes that would bounce them (+ the two tabs)", () => {
    const fromSidebar = new Set<string>();
    for (const it of navItems) {
      if (!isNavItemAllowedForRole(it, "teacher")) continue;
      if (TEACHER_BLOCKED_BY_ROUTE.includes(it.path)) continue;
      fromSidebar.add(it.path);
      if (it.subItem) fromSidebar.add(it.subItem.path);
    }
    fromSidebar.add("/mock-exams").add("/class-velocity");
    expect(new Set(dests.map((d) => d.path))).toEqual(fromSidebar);
  });

  it("every synonym key is a real teacher destination", () => {
    const paths = new Set(dests.map((d) => d.path));
    for (const key of Object.keys(TEACHER_EXTRA_PHRASES)) expect(paths.has(key), key).toBe(true);
  });

  it("two sidebar rows that open the same route (Home / Homework) become one destination that answers to both names", () => {
    expect(dests.filter((d) => d.path === "/dashboard")).toHaveLength(1);
    expect(pathOf("open home")).toBe("/dashboard");
    expect(pathOf("open homework")).toBe("/dashboard");
  });
});

describe("a teacher is never sent to a page that would bounce them", () => {
  it("every destination is a route in App.tsx that admits teachers", () => {
    for (const d of dests) expect(guardAdmitsTeacher(d.path), d.path).toBe(true);
  });

  it("every excluded path is really blocked for teachers, and really is on the teacher sidebar (so the list never goes stale)", () => {
    const teacherPaths = new Set<string>();
    for (const it of navItems) {
      if (!isNavItemAllowedForRole(it, "teacher")) continue;
      teacherPaths.add(it.path);
      if (it.subItem) teacherPaths.add(it.subItem.path);
    }
    for (const p of TEACHER_BLOCKED_BY_ROUTE) {
      expect(teacherPaths.has(p), `${p} is not a teacher sidebar row any more - remove it from TEACHER_BLOCKED_BY_ROUTE`).toBe(true);
      expect(guardAdmitsTeacher(p), `${p} now admits teachers - remove it from TEACHER_BLOCKED_BY_ROUTE`).toBe(false);
    }
  });

  it.each(["open gamification", "open leaderboard", "open predictions", "open ai tutor", "open ai career coach", "open academic tests"])(
    "%s is answered with 'not available', never a navigation",
    (text) => {
      const r = nav(text);
      if (r.kind === "navigate") throw new Error(`navigated to ${r.destination.path}`);
      expect(["blocked", "clarify", "not-found"]).toContain(r.kind);
    },
  );
});

describe("every supported page opens, however the teacher phrases it", () => {
  for (const d of dests) {
    it(d.title, () => {
      for (const phrase of [`Open ${d.title}`, `take me to ${d.title}`, `go to the ${d.title} page`, `can you please navigate to ${d.title}?`]) {
        const r = nav(phrase);
        // the one place a sentence may be handed to the lesson-plan flow instead is a lesson plan with class/topic details
        expect(r.kind === "navigate" ? r.destination.path : r.kind, phrase).toBe(d.path);
      }
    });
  }
  it("understands how speech recognition writes things", () => {
    expect(pathOf("open time table")).toBe("/timetable");
    expect(pathOf("open home work")).toBe("/dashboard");
    expect(pathOf("open the academic calender")).toBe("/academic-calendar");
    expect(pathOf("take me to attendence")).toBe("/attendance");
    expect(pathOf("go home")).toBe("/dashboard");
  });
  it("answers to everyday words", () => {
    expect(pathOf("open lesson plans")).toBe("/curative");
    expect(pathOf("open my schedule")).toBe("/timetable");
    expect(pathOf("take me to messages")).toBe("/teacher-communication");
    expect(pathOf("open behavior")).toBe("/teacher-behaviour");
    expect(pathOf("open struggling students")).toBe("/teacher-at-risk");
    expect(pathOf("open question bank")).toBe("/item-bank");
    expect(pathOf("open leave requests")).toBe("/requests");
    expect(pathOf("open sen students")).toBe("/my-sen-students");
    expect(pathOf("open teacher dashboard")).toBe("/teacher-workspace");
    expect(pathOf("open the workspace")).toBe("/teacher-workspace");
  });
  it("reaches the two tabs that have their own route", () => {
    expect(pathOf("open mock exams")).toBe("/mock-exams");
    expect(pathOf("open class velocity")).toBe("/class-velocity");
  });
});

describe("only the pages this teacher's school lets them see", () => {
  const defaults = buildTeacherDestinations(undefined, (m) => DEFAULT_TEACHER_MODULES.includes(m));
  const withDefaults = (text: string, ctx = {}) => resolve(text, { destinations: defaults, ...ctx });

  it("uses the sidebar's own permission check: modules the school has not enabled are not destinations", () => {
    const paths = new Set(defaults.map((d) => d.path));
    expect(paths.has("/timetable")).toBe(true); // module "Home"
    expect(paths.has("/attendance")).toBe(true); // module "Attendance"
    expect(paths.has("/curative")).toBe(true); // module "Lesson Plans"
    expect(paths.has("/billing")).toBe(false); // module "Billing" - off by default for teachers
    expect(paths.has("/admin")).toBe(false); // module "Admin Panel"
    expect(paths.has("/marketplace")).toBe(false);
    expect(paths.has("/invigilation")).toBe(false);
    // rows with no module are always shown
    expect(paths.has("/settings")).toBe(true);
    expect(paths.has("/teacher-communication")).toBe(true);
  });

  it("a page the school has not enabled is 'not available' - the same page opens in a school that has", () => {
    expect(withDefaults("open billing").kind).toBe("blocked");
    expect(withDefaults("open admin panel").kind).toBe("blocked");
    expect(resolve("open billing", { destinations: getTeacherDestinations(() => true) }).kind).toBe("navigate");
  });

  it("enabled pages still open", () => {
    const r = withDefaults("open attendance");
    expect(r.kind === "navigate" && r.destination.path).toBe("/attendance");
  });

  it("with no permission check supplied (still loading) the role-only list is used", () => {
    expect(getTeacherDestinations().some((d) => d.path === "/billing")).toBe(true);
  });
});

describe("only teacher pages", () => {
  it.each([
    "open admissions",
    "open transport",
    "open super admin",
    "open platform admin",
    "open exam seating",
    "open parent dashboard",
    "open principal dashboard",
    "open student dashboard",
    "open student profile",
    "open hall tickets",
    "open my exams",
  ])("%s does not navigate to a page outside the teacher menu", (text) => {
    const r = nav(text);
    if (r.kind === "navigate") throw new Error(`navigated to ${r.destination.path}`);
    expect(["blocked", "clarify", "not-found"]).toContain(r.kind);
  });

  it("offers the teacher's own page when another role's version is asked for", () => {
    const r = nav("open parent timetable");
    expect(r.kind).toBe("clarify");
    expect(nav("yes", { pending: r.kind === "clarify" ? r.options : null })).toMatchObject({ kind: "navigate" });
  });

  it("the student's assistant is untouched: it still opens the student's pages and refuses the teacher's", () => {
    const g = resolveStudentNavigation("open gamification");
    expect(g.kind === "navigate" && g.destination.path).toBe("/gamification");
    expect(resolveStudentNavigation("open lesson plan generator").kind).not.toBe("navigate");
    const b = resolveStudentNavigation("open assessment builder");
    expect(b.kind === "navigate" && b.destination.path).not.toBe("/assessment-builder");
  });
});

describe("lesson-plan requests stay with the lesson-plan flow", () => {
  it("opening the generator itself navigates", () => {
    expect(pathOf("open lesson plan generator")).toBe("/curative");
    expect(pathOf("open lesson plan")).toBe("/curative");
    expect(pathOf("go to lesson plans")).toBe("/curative");
  });
  it.each([
    "create a lesson plan on fractions for class 5 section A",
    "make a lesson plan for class 7",
    "open lesson plan for class 5 fractions",
    "take me to lesson plan on photosynthesis",
    "open lesson plan generator for grade 6 science",
    "generate a lesson plan",
  ])("%s", (text) => expect(nav(text).kind).toBe("none"));
});

describe("unclear requests are handled gracefully", () => {
  it("no page named", () => {
    for (const t of ["open", "open it", "take me somewhere", "go to"]) expect(nav(t).kind, t).toBe("vague");
  });
  it("ambiguous names ask which one, then accept a short answer", () => {
    const r = nav("open exams");
    expect(r.kind).toBe("clarify");
    const options = r.kind === "clarify" ? r.options : [];
    expect(options.length).toBeGreaterThan(1);
    expect(pathOf("the first one", { pending: options })).toBe(options[0].path);
    expect(pathOf("the second one", { pending: options })).toBe(options[1].path);
    expect(pathOf(options[options.length - 1].title, { pending: options })).toBe(options[options.length - 1].path);
    expect(nav("never mind", { pending: options }).kind).toBe("cancel");
  });
  it("a word that fits two pages asks, rather than silently picking one", () => {
    const r = nav("open assessment");
    expect(r.kind).toBe("clarify");
    expect(r.kind === "clarify" && r.options.map((o) => o.path)).toEqual(expect.arrayContaining(["/assessment-builder", "/assessment-evaluation"]));
    const s = nav("open students");
    expect(s.kind === "clarify" && s.options.map((o) => o.path)).toEqual(expect.arrayContaining(["/my-sen-students", "/teacher-at-risk"]));
  });
  it("unknown page", () => expect(nav("open the zebra").kind).toBe("not-found"));
  it("already there", () => expect(nav("open timetable", { currentPath: "/timetable" }).kind).toBe("already"));
  it("several pages at once ask which first", () => expect(nav("open attendance and timetable").kind).toBe("clarify"));
  it("the replies say 'teacher menu'", () => {
    const r = nav("open billing", { destinations: buildTeacherDestinations(undefined, () => false) });
    expect(r.kind === "blocked" && r.reply).toMatch(/teacher menu/);
  });
});

describe("everything else is left to the existing assistant", () => {
  it.each([
    "what is my timetable today",
    "show my timetable",
    "show me class 5 attendance",
    "check my attendance",
    "how do I open the assessment builder",
    "where is the intervention board",
    "don't open attendance",
    "explain fractions to class 5",
    "take me through photosynthesis",
    "open timetable and tell me my next period",
    "hello",
    "create a lesson plan on fractions for class 5 section A 45 minutes",
    "which students are at risk",
  ])("%s", (text) => expect(nav(text).kind).toBe("none"));
  it('"show me the timetable page" is explicit navigation', () => expect(pathOf("show me the timetable page")).toBe("/timetable"));
});
