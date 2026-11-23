import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ROLE_PROFILES, roleMenuRows, allRoleFeatures, buildRoleFeatureGuidePrompt, builtInKnows, appHelpRules,
  type StaffRole,
} from "../../supabase/functions/_shared/roleFeatureGuide";
import { TEACHER_FEATURES, teacherMenuRows } from "../../supabase/functions/_shared/teacherFeatureGuide";
import { HOD_FEATURES, hodMenuRows } from "../../supabase/functions/_shared/hodFeatureGuide";
import { PRINCIPAL_FEATURES, principalMenuRows } from "../../supabase/functions/_shared/principalFeatureGuide";
import { SCHOOL_ADMIN_FEATURES, schoolAdminMenuRows } from "../../supabase/functions/_shared/schoolAdminFeatureGuide";
import { GENERATED_ROUTE_ROLES } from "../../supabase/functions/_shared/featureRouteRoles.generated";
import { GENERATED_NAV } from "../../supabase/functions/_shared/featureManifest.generated";
import { buildKnowledgePrompt, clearFeatureNamesCache } from "../../supabase/functions/_shared/featureRetrieval";
import { embedText, embedBatch } from "../../supabase/functions/_shared/featureEmbeddings";
import { getRoleFeatureSection } from "../../supabase/functions/_shared/roleFeatureSection";
import { buildRouteRoles, render as renderRouteRoles } from "../../tools/generate-route-roles.mjs";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const STAFF: StaffRole[] = ["teacher", "hod", "principal", "school_admin"];
const GUIDES = {
  teacher: { features: TEACHER_FEATURES, rows: teacherMenuRows },
  hod: { features: HOD_FEATURES, rows: hodMenuRows },
  principal: { features: PRINCIPAL_FEATURES, rows: principalMenuRows },
  school_admin: { features: SCHOOL_ADMIN_FEATURES, rows: schoolAdminMenuRows },
} as const;

describe("role menus come from the real sidebar and route guards", () => {
  for (const role of STAFF) {
    it(`${role}: every row is in that role's sidebar and its route allows the role`, () => {
      const rows = GUIDES[role].rows();
      expect(rows.length).toBeGreaterThan(10);
      for (const r of rows) {
        const base = r.path.split("?")[0];
        const allowed = GENERATED_ROUTE_ROLES[base];
        if (allowed) expect(allowed, `${role} cannot open ${base}`).toContain(role);
        const inNav = GENERATED_NAV.some((n) => n.roles?.includes(role) && (n.path === r.path || n.subItem?.path === r.path));
        expect(inNav, `${r.path} is not in the ${role} sidebar`).toBe(true);
      }
    });
  }

  it("a teacher is never told about student-only pages the sidebar lists but the router blocks", () => {
    const paths = teacherMenuRows().map((r) => r.path.split("?")[0]);
    for (const blocked of ["/gamification", "/leaderboard", "/predictions", "/academic-tests"]) expect(paths).not.toContain(blocked);
  });

  it("each role's built-in guide never lists another role's pages", () => {
    const own = (role: StaffRole) => new Set(GUIDES[role].rows().map((r) => r.path));
    const prompt = buildRoleFeatureGuidePrompt("hod", HOD_FEATURES, "hello");
    const teacherOnly = [...own("teacher")].filter((p) => !own("hod").has(p));
    for (const p of teacherOnly) {
      const name = teacherMenuRows().find((r) => r.path === p)!.name;
      const hodHasSameName = hodMenuRows().some((r) => r.name === name);
      if (!hodHasSameName) expect(prompt).not.toContain(`${name}:`);
    }
  });

  it("written entries are used for header tools and every other page gets an automatic entry", () => {
    for (const role of STAFF) {
      const all = allRoleFeatures(role, GUIDES[role].features);
      expect(all.some((f) => f.id === "global-search")).toBe(true);
      expect(all.filter((f) => f.auto).length).toBeGreaterThan(5);
    }
  });

  it("the HOD is never pointed to a Help button (the role has no guided tour)", () => {
    expect(HOD_FEATURES.some((f) => f.id === "help-menu")).toBe(false);
    expect(ROLE_PROFILES.hod.escalateTo).not.toMatch(/help button/i);
    expect(appHelpRules("hod")).not.toMatch(/Help button/);
  });
});

describe("prompt rules", () => {
  it("tell the assistant to explain only its own role's pages and to refuse other roles' features", () => {
    for (const role of [...STAFF, "parent"] as const) {
      const t = appHelpRules(role);
      expect(t).toContain("HOW TO EXPLAIN THE APP");
      expect(t).toMatch(/Never describe, guess or hint at what other roles see/);
      expect(t).toContain(ROLE_PROFILES[role].label);
    }
  });

  it("the fallback guide knows the page names of its own role", () => {
    const row = principalMenuRows()[3];
    expect(builtInKnows("principal", PRINCIPAL_FEATURES, `how do I use ${row.name}?`)).toBe(true);
    const prompt = buildRoleFeatureGuidePrompt("principal", PRINCIPAL_FEATURES, `how do I use ${row.name}?`);
    expect(prompt).toContain("APP FEATURE GUIDE");
    expect(prompt).toContain(row.name);
  });

  it("the Study Buddy wording is unchanged by default; other roles get their own hand-off", () => {
    const base = buildKnowledgePrompt(["Timetable"], "none", []);
    expect(base).toContain("suggest the Help button at the top of the page or their teacher.");
    const hod = buildKnowledgePrompt(["Reports"], "none", [], ROLE_PROFILES.hod.label, ROLE_PROFILES.hod.escalateTo);
    expect(hod).toContain("suggest their school administrator or principal.");
    expect(hod).not.toContain("their teacher");
  });
});

describe("getRoleFeatureSection (retrieval with built-in fallback)", () => {
  beforeEach(() => clearFeatureNamesCache());
  const base = (over: Record<string, unknown>) => ({
    tag: "t", supabase: {}, role: "teacher" as const, message: "what is x", history: [], keys: [],
    builtIn: () => "BUILT-IN", builtInKnows: () => false, ...over,
  });
  (globalThis as any).Deno ??= { env: { get: () => undefined } };

  it("uses the knowledge base when it answers", async () => {
    const out = await getRoleFeatureSection(base({ retrieve: async () => ({ section: "KB", usable: true, level: "strong", matched: ["A"] }) }) as any);
    expect(out).toBe("KB");
  });
  it("passes the role-specific label and hand-off to retrieval, and the server role", async () => {
    let seen: any = null;
    await getRoleFeatureSection(base({ role: "hod", retrieve: async (a: any) => { seen = a; return { section: null, usable: false, level: "none", matched: [] }; } }) as any);
    expect(seen.role).toBe("hod");
    expect(seen.roleLabel).toBe("head of department");
    expect(seen.escalateTo).toBe(ROLE_PROFILES.hod.escalateTo);
  });
  it("falls back when the knowledge base is empty, throws, or is too slow", async () => {
    expect(await getRoleFeatureSection(base({ retrieve: async () => ({ section: null, usable: false, level: "none", matched: [], reason: "empty" }) }) as any)).toBe("BUILT-IN");
    expect(await getRoleFeatureSection(base({ retrieve: async () => { throw new Error("db down"); } }) as any)).toBe("BUILT-IN");
    expect(await getRoleFeatureSection(base({ timeoutMs: 20, retrieve: () => new Promise(() => {}) }) as any)).toBe("BUILT-IN");
  });
  it("prefers the built-in guide when the knowledge base found nothing but the built-in guide knows the answer", async () => {
    const out = await getRoleFeatureSection(base({ builtInKnows: () => true, retrieve: async () => ({ section: "KB-NONE", usable: true, level: "none", matched: [] }) }) as any);
    expect(out).toBe("BUILT-IN");
  });
});

describe("generated knowledge bases", () => {
  for (const role of [...STAFF, "parent"]) {
    const doc = JSON.parse(read(`docs/feature-kb/${role}.features.json`));
    it(`${role}: unique keys, role-correct, no developer noise, nothing from another role's route`, () => {
      expect(doc.role).toBe(role);
      const keys = doc.docs.map((d: any) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const d of doc.docs) {
        if (d.accessRoles) expect(d.accessRoles, `${d.name}`).toContain(role);
        expect(d.content).not.toMatch(/sheet row \d+/i);
        expect(d.content).not.toMatch(/&amp;|&lt;|&gt;/);
      }
    });
  }

  it("a teacher knowledge base has no entry for pages the router blocks for teachers", () => {
    const doc = JSON.parse(read("docs/feature-kb/teacher.features.json"));
    const routes = doc.docs.map((d: any) => d.route).filter(Boolean);
    for (const blocked of ["/gamification", "/leaderboard", "/predictions", "/academic-tests"]) expect(routes).not.toContain(blocked);
  });

  it("shared screens are described only from role-scoped sources (no other roles' controls leak in)", () => {
    const doc = JSON.parse(read("docs/feature-kb/teacher.features.json"));
    const att = doc.docs.find((d: any) => d.route === "/attendance");
    expect(att).toBeTruthy();
    expect(att.content).not.toMatch(/Select child|Early Pickup|Driver Attendance/i);
  });

  it("featureRouteRoles.generated.ts is up to date with src/App.tsx", () => {
    expect(read("supabase/functions/_shared/featureRouteRoles.generated.ts")).toBe(renderRouteRoles(buildRouteRoles(read("src/App.tsx"))));
  });

  it("every role is registered with the sync tool", () => {
    const cfg = read("tools/feature-docs/config.mjs");
    for (const role of [...STAFF, "parent", "student"]) expect(cfg).toContain(`role: "${role}"`);
  });
});

describe("the five assistants are wired and the Study Buddy is untouched", () => {
  const wired: [string, string][] = [
    ["extract-lesson-intent", "teacher"], ["hod-assistant", "hod"], ["principal-assistant", "principal"],
    ["school-admin-assistant", "school_admin"], ["parent-assistant", "parent"],
  ];
  for (const [fn, role] of wired) {
    it(`${fn} retrieves the ${role} knowledge base with a built-in fallback`, () => {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src).toContain("getRoleFeatureSection");
      expect(src).toContain(`role: "${role}"`);
      expect(src).toMatch(/builtIn: \(\) =>/);
    });
  }
  it("data-backed assistants keep their privacy and data rules", () => {
    for (const fn of ["hod-assistant", "principal-assistant", "school-admin-assistant"]) {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src).toContain("STRICT PRIVACY RULES");
      expect(src).toContain("CURRENT DATA");
      expect(src).toContain("Never invent numbers, dates, names, or percentages");
      expect(src).toContain("profile.role !==");
    }
  });
  it("the teacher assistant only gets the role guide after a verified teacher profile", () => {
    const src = read("supabase/functions/extract-lesson-intent/index.ts");
    expect(src).toContain('roleProfile?.role === "teacher"');
    expect(src).toContain("ABOUT APAS");
  });
  it("student-self-assistant does not use the role helper", () => {
    const src = read("supabase/functions/student-self-assistant/index.ts");
    expect(src).not.toContain("getRoleFeatureSection");
    expect(src).toContain('role: "student"');
  });
});

describe("vector backfill through an existing edge function (no new function, no local Gemini key)", () => {
  const handler = read("supabase/functions/_shared/handlers/featureKbEmbed.ts");
  it("is routed through generate-item-bank as the feature_kb_embed action", () => {
    const src = read("supabase/functions/generate-item-bank/index.ts");
    expect(src).toContain("feature_kb_embed: { handler: handleFeatureKbEmbed }");
    expect(src).toContain("handlers/featureKbEmbed.ts");
  });
  it("only accepts the service role or a platform admin, and only fills rows that have no vector", () => {
    expect(handler).toContain("authHeader === `Bearer ${serviceKey}`");
    expect(handler).toContain('ADMIN_ROLES = ["admin", "knsoft_admin"]');
    expect(handler).toContain('.is("embedding", null)');
    expect(handler).not.toMatch(/\.update\(\{[^}]*(content|search_text)/);
  });
  it("never returns a Gemini key", () => {
    expect(handler).not.toMatch(/json\(\{[^)]*keys\[/);
    expect(handler).toContain("Never returns a key");
  });
});

describe("embedding falls through keys whose billing is exhausted", () => {
  const vec = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
  const o = { taskType: "RETRIEVAL_DOCUMENT" as const };
  it("moves past a 402 (credits depleted) to the next working key", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_u: string, init: any) => {
      const k = init.headers["x-goog-api-key"]; calls.push(k);
      return k === "dead" ? new Response("{}", { status: 402 }) : new Response(JSON.stringify({ embedding: { values: vec } }), { status: 200 });
    }) as any;
    expect(await embedText("hi", ["dead", "good"], { ...o, fetchImpl })).toBeTruthy();
    expect(calls.join(",")).toBe("dead,good");
  });
  it("batch embedding also moves past a 402 and a 403 to a working key", async () => {
    const fetchImpl = (async (_u: string, init: any) => {
      const k = init.headers["x-goog-api-key"];
      if (k === "a") return new Response("{}", { status: 402 });
      if (k === "b") return new Response("{}", { status: 403 });
      return new Response(JSON.stringify({ embeddings: [{ values: vec }, { values: vec }] }), { status: 200 });
    }) as any;
    const out = await embedBatch(["x", "y"], ["a", "b", "c"], { ...o, fetchImpl });
    expect(out.every((v) => Array.isArray(v) && v.length === 768)).toBe(true);
  });
});
