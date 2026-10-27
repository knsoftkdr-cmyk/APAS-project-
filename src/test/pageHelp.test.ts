import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PAGE_HELP, getPageHelp } from "@/components/help/pageHelp";
import { tourRoleFor } from "@/components/onboarding/tourSteps";

// "Help with This Page" must never describe a page, role or button that does not exist. Like tourSteps.test.ts,
// this reads the real router and page source instead of trusting a hand-copied list.

const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");
const appSrc = read("src/App.tsx");

// route -> allowed roles ([] = any signed-in role)
const guards = new Map<string, string[]>();
for (const m of appSrc.matchAll(/<Route path="([^"]+)" element=\{<ProtectedRoute>(?:<RoleGuard allowedRoles=\{\[([^\]]*)\]\}>)?/g)) {
  guards.set(m[1], m[2] ? [...m[2].matchAll(/"([^"]+)"/g)].map((r) => r[1]) : []);
}

describe("page help registry", () => {
  it("has entries", () => expect(PAGE_HELP.length).toBeGreaterThan(20));

  it.each(PAGE_HELP.map((e) => [`${e.route} (${e.roles.join(",")})`, e] as const))("%s is a real route the listed roles may open", (_n, e) => {
    expect(guards.has(e.route), `route ${e.route} is not declared in App.tsx`).toBe(true);
    const allowed = guards.get(e.route)!;
    if (allowed.length) for (const r of e.roles) expect(allowed, `${r} is redirected away from ${e.route}`).toContain(r);
  });

  it.each(PAGE_HELP.map((e) => [`${e.route} (${e.roles.join(",")})`, e] as const))("%s only names labels found in its source files", (_n, e) => {
    expect(e.sources.length).toBeGreaterThan(0);
    const text = e.sources.map((f) => {
      expect(existsSync(resolve(__dirname, "../../", f)), `${f} does not exist`).toBe(true);
      return read(f);
    }).join("\n");
    for (const c of e.controls ?? []) expect(text.includes(c.label), `"${c.label}" not found in ${e.sources.join(", ")}`).toBe(true);
    for (const p of e.problems ?? []) if (p.quote) expect(text.includes(p.quote), `message "${p.quote}" not found in ${e.sources.join(", ")}`).toBe(true);
  });

  it.each(PAGE_HELP.filter((e) => e.next?.length).map((e) => [`${e.route} (${e.roles.join(",")})`, e] as const))("%s only links to pages its roles can open", (_n, e) => {
    for (const n of e.next!) {
      expect(guards.has(n.route), `next route ${n.route} is not declared in App.tsx`).toBe(true);
      const allowed = guards.get(n.route)!;
      if (allowed.length) for (const r of e.roles) expect(allowed, `${r} cannot open ${n.route}`).toContain(r);
    }
  });

  it("detailed entries are complete and never overlap with another entry for the same route and role", () => {
    const seen = new Set<string>();
    for (const e of PAGE_HELP) for (const r of e.roles) {
      const k = `${e.route}|${r}`;
      expect(seen.has(k), `duplicate help entry for ${k}`).toBe(false);
      seen.add(k);
    }
    for (const e of PAGE_HELP) for (const p of e.problems ?? []) {
      expect(p.problem.trim().length).toBeGreaterThan(0);
      expect(p.fix.trim().length).toBeGreaterThan(0);
    }
  });

  it("every step list has at least one step and no empty text", () => {
    for (const e of PAGE_HELP) for (const t of e.tasks ?? []) {
      expect(t.steps.length).toBeGreaterThan(0);
      for (const s of t.steps) expect(s.trim().length).toBeGreaterThan(0);
    }
  });

  it("never returns help for a role the page is not written for", () => {
    expect(getPageHelp("/super-admin", "student")).toBeNull();
    expect(getPageHelp("/knsoft-admin", "teacher")).toBeNull();
    expect(getPageHelp("/parent-dashboard", "teacher")).toBeNull();
    expect(getPageHelp("/attendance", null)).toBeNull();
  });

  it("picks the right variant per role on shared routes", () => {
    expect(getPageHelp("/dashboard", "student")?.purpose).toMatch(/assessment/i);
    expect(getPageHelp("/dashboard", "teacher")?.purpose).toMatch(/teaching/i);
    expect(getPageHelp("/dashboard", "principal")?.purpose).toMatch(/school/i);
    expect(getPageHelp("/attendance", "teacher")?.tasks?.[0].title).toMatch(/mark/i);
    expect(getPageHelp("/attendance", "parent")?.tasks?.[0].title).toMatch(/check/i);
  });

  it("ignores query strings and trailing slashes", () => {
    expect(getPageHelp("/attendance/?tab=view", "teacher")).not.toBeNull();
  });

  it("covers all five roles that have a guided tour", () => {
    const covered = new Set<string>();
    for (const e of PAGE_HELP) for (const r of e.roles) { const t = tourRoleFor(r); if (t) covered.add(t); }
    expect([...covered].sort()).toEqual(["parent", "platform_admin", "school_admin", "student", "teacher"]);
  });
});

describe("header keeps the existing tour hooks", () => {
  const header = read("src/components/layout/AppHeader.tsx");
  it("still tags the help control for the tour step", () => expect(header.includes('data-tour="header-help"')).toBe(true));
  it("still offers 'Take a tour again' in the profile menu", () => expect(header.includes("Take a tour again")).toBe(true));
  it("only shows help to roles that have a tour (unchanged gate)", () => expect(header.includes("const hasTour = !!tourRoleFor(profile?.role);")).toBe(true));
  it("the help menu starts the tour through the existing event", () => {
    const menu = read("src/components/help/HelpMenu.tsx");
    expect(menu.includes("startProductTour")).toBe(true);
  });
  it("Ask APAS listens for the open event", () => {
    expect(read("src/components/command-bar/CommandBar.tsx").includes("OPEN_COMMAND_BAR_EVENT")).toBe(true);
  });
});
