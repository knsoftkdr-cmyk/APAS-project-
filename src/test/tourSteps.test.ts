import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOUR_BY_ROLE, tourRoleFor, type TourRole } from "@/components/onboarding/tourSteps";

// The tour must only describe things that really exist and that the role is really allowed to open. Rather than
// trust a hand-copied list, read the real sidebar and router source and check every step against them.

const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");
const sidebarSrc = read("src/components/layout/AppSidebar.tsx");
const appSrc = read("src/App.tsx");

// navItems entries: { title: "...", ..., path: "/x", roles: ["a","b"], ... }  (commented-out lines are skipped)
interface NavEntry { path: string; roles: string[] | null }
const navEntries: NavEntry[] = [];
// Only the real sidebar list. The phone bottom bar below it has entries without `roles`, which would read as "everyone".
const navRegion = sidebarSrc.slice(sidebarSrc.indexOf("const navItems"), sidebarSrc.indexOf("const getMobileNavItems"));
for (const line of navRegion.split("\n")) {
  if (line.trim().startsWith("//")) continue;
  const path = line.match(/^\s*\{ title: "[^"]+", icon: \w+, path: "([^"]+)"/)?.[1];
  if (!path) continue;
  const roles = line.match(/roles: \[([^\]]*)\]/)?.[1];
  navEntries.push({ path, roles: roles ? [...roles.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : null });
}

// Which profile roles each tour is shown to
const ROLES_FOR_TOUR: Record<TourRole, string[]> = {
  student: ["student"],
  teacher: ["teacher"],
  parent: ["parent"],
  school_admin: ["admin", "principal", "school_admin"],
  platform_admin: ["knsoft_admin"],
};

const navPathOf = (selector: string) => selector.match(/data-tour-nav="([^"]+)"/)?.[1];

describe("tourRoleFor", () => {
  it.each([
    ["student", "student"],
    ["teacher", "teacher"],
    ["parent", "parent"],
    ["admin", "school_admin"],
    ["principal", "school_admin"],
    ["school_admin", "school_admin"],
    ["knsoft_admin", "platform_admin"],
  ])("%s -> %s tour", (role, tour) => expect(tourRoleFor(role)).toBe(tour));

  it.each(["hod", "driver", "", undefined, null, "something_else"])("%s has no tour", (role) =>
    expect(tourRoleFor(role as string | null | undefined)).toBeNull()
  );
});

describe("sidebar parsing sanity", () => {
  it("found the real nav items", () => {
    expect(navEntries.length).toBeGreaterThan(80);
    expect(navEntries.find((e) => e.path === "/settings")?.roles).toBeNull();
  });
});

describe.each(Object.keys(TOUR_BY_ROLE) as TourRole[])("%s tour", (tourRole) => {
  const steps = TOUR_BY_ROLE[tourRole];

  it("opens with a welcome card and ends with a finish card", () => {
    expect(steps[0].target).toBeUndefined();
    expect(steps[steps.length - 1].target).toBeUndefined();
  });

  it("has unique ids and non-empty copy", () => {
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) {
      expect(s.title.trim()).not.toBe("");
      expect(s.description.trim()).not.toBe("");
    }
  });

  it("only points at sidebar items that exist for at least one role that gets this tour", () => {
    for (const s of steps) {
      const p = s.target && navPathOf(s.target);
      if (!p) continue;
      const allowed = navEntries.some(
        (e) => e.path === p && (e.roles === null || e.roles.some((r) => ROLES_FOR_TOUR[tourRole].includes(r)))
      );
      expect(allowed, `${tourRole}: step "${s.id}" targets ${p}, which no ${ROLES_FOR_TOUR[tourRole].join("/")} sidebar item uses`).toBe(true);
    }
  });

  it("only points at routes that exist in App.tsx", () => {
    for (const s of steps) {
      const p = s.target && navPathOf(s.target);
      if (!p) continue;
      expect(appSrc.includes(`path="${p}"`), `route ${p} is not declared in App.tsx`).toBe(true);
    }
  });
});

describe("dashboard / header targets are present in the source", () => {
  const sources = [
    "src/components/layout/AppHeader.tsx",
    "src/components/dashboard/DashboardHero.tsx",
    "src/pages/TeacherWorkspaceDashboard.tsx",
    "src/pages/Dashboard.tsx",
    "src/pages/SuperAdminPanel.tsx",
    "src/pages/KNSoftAdminPanel.tsx",
  ].map(read).join("\n");

  const tags = new Set<string>();
  for (const steps of Object.values(TOUR_BY_ROLE))
    for (const s of steps) {
      const m = s.target?.match(/data-tour="([^"]+)"/);
      if (m) tags.add(m[1]);
    }

  it.each([...tags])("data-tour=%s is rendered somewhere", (name) => {
    expect(sources.includes(`data-tour="${name}"`)).toBe(true);
  });
});
