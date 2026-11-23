// supabase/functions/_shared/roleFeatureGuide.ts
//
// The role-generic part of the "app feature awareness" system. The Study Buddy proved the design
// (studentFeatureGuide.ts + featureRetrieval.ts + the app_feature_docs table); this file lets the TEACHER, HOD,
// PRINCIPAL and SCHOOL ADMIN assistants (and, as a fallback, the parent assistant) reuse it without copying it.
//
// What lives here (pure data + pure helpers, no I/O, unit-tested in src/test/roleFeatureAwareness.test.ts):
//   * roleMenuRows()            the sidebar rows ONE role can open (same rule as isNavItemAllowedForRole in AppSidebar.tsx)
//   * allRoleFeatures()         written entries + an automatic entry for every other menu page of that role
//   * buildRoleFeatureGuidePrompt()  the built-in fallback guide, used when the knowledge base cannot be reached
//   * appHelpRules()            the prompt block that tells an assistant HOW to explain the app (and what never to do)
//
// Reused, not copied: the feature shape, the name/keyword matcher and the prompt line formats all come from
// studentFeatureGuide.ts. Nothing in that file changed.
//
// ROLE ISOLATION (why a teacher can never be told about a principal-only page)
//   1. The menu rows are filtered by role from the real sidebar, so the built-in guide of one role never lists a
//      page that is not in that role's menu.
//   2. The knowledge base is read with the CALLER'S OWN session; row-level security only returns documents whose
//      role equals the caller's profile role (see migration 20261118000000_app_feature_knowledge_base.sql).
//   3. The role passed to retrieval is the server-verified profile role, never a request parameter.

import { GENERATED_NAV, type GeneratedNavRow } from "./featureManifest.generated.ts";
import { GENERATED_ROUTE_ROLES } from "./featureRouteRoles.generated.ts";
import { selectFeatures, featureIndex, describeFeature, type StudentFeature } from "./studentFeatureGuide.ts";

/** Same shape as a Study Buddy entry: id, name, routes?, where, keywords, summary, howTo?, notes?, auto? */
export type RoleFeature = StudentFeature;

/** Staff roles served by this file. (Student has studentFeatureGuide.ts, parent has parentFeatureGuide.ts.) */
export type StaffRole = "teacher" | "hod" | "principal" | "school_admin";

export interface RoleProfile {
  /** profiles.role value: also the `role` column of app_feature_docs. */
  role: string;
  /** How the assistant refers to the person it talks to ("a teacher"). */
  label: string;
  /** Where the assistant sends someone for something the guide does not cover. Role-specific on purpose. */
  escalateTo: string;
}

export const ROLE_PROFILES: Record<StaffRole | "parent", RoleProfile> = {
  teacher: { role: "teacher", label: "teacher", escalateTo: "the Help button at the top of the page or their school administrator" },
  // The HOD has no guided tour, so the header Help button is not shown to them: never point an HOD to it.
  hod: { role: "hod", label: "head of department", escalateTo: "their school administrator or principal" },
  principal: { role: "principal", label: "principal", escalateTo: "the Help button at the top of the page or their school administrator" },
  school_admin: { role: "school_admin", label: "school administrator", escalateTo: "the Help button at the top of the page" },
  parent: { role: "parent", label: "parent", escalateTo: "the Help button at the top of the page or the school office" },
};

const norm = (s: string) => (s ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * The rows this role can really open. Two rules, both from the real app:
 *   1. the sidebar's role rule: `item.roles` includes the role (the per-module allow-list only applies to students
 *      and parents - AppSidebar.tsx, isNavItemAllowedForRole - so staff have none);
 *   2. the route's own <RoleGuard>: a row the sidebar shows but whose route does not allow the role is dropped,
 *      because explaining it would describe another role's screen (e.g. the student Gamification page to a teacher).
 */
export function roleMenuRows(
  role: string,
  nav: GeneratedNavRow[] = GENERATED_NAV,
  routeRoles: Record<string, string[]> = GENERATED_ROUTE_ROLES,
): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  const seen = new Set<string>();
  const add = (name: string, path: string) => {
    const allowed = routeRoles[path.split("?")[0]];
    if (allowed && !allowed.includes(role)) return; // the router would turn this role away from this page
    const k = `${path}|${norm(name)}`;
    if (!seen.has(k)) { seen.add(k); out.push({ name, path }); }
  };
  for (const it of nav) {
    if (!it.roles || !it.roles.includes(role)) continue; // a row with no `roles` is not shown to staff by this rule either
    add(it.title, it.path);
    if (it.subItem) add(it.subItem.title, it.subItem.path);
  }
  return out;
}

/** Does this written entry already describe that menu row? (same page, or the same name) */
function covers(f: RoleFeature, row: { path: string; name: string }): boolean {
  if (f.routes?.includes(row.path)) return true;
  return norm(f.name.replace(/\s*\(.*\)\s*$/, "")) === norm(row.name);
}

/** Menu rows of this role with no written entry: the assistant still knows them by name and place. */
export function uncuratedRoleRows(role: string, curated: RoleFeature[], nav: GeneratedNavRow[] = GENERATED_NAV): { name: string; path: string }[] {
  return roleMenuRows(role, nav).filter((r) => !curated.some((f) => covers(f, r)));
}

/** Everything the assistant knows: the written entries, plus an automatic one for every other page in the role's menu. */
export function allRoleFeatures(role: string, curated: RoleFeature[], nav: GeneratedNavRow[] = GENERATED_NAV): RoleFeature[] {
  const auto: RoleFeature[] = uncuratedRoleRows(role, curated, nav).map((r) => ({
    id: `auto-${norm(r.name).replace(/ /g, "-")}`,
    name: r.name,
    routes: [r.path],
    where: `Left menu, ${r.name}.`,
    keywords: [r.name],
    summary: `A page in your left menu called ${r.name}. Its full details are not in my notes yet.`,
    auto: true,
  }));
  return [...curated, ...auto];
}

/**
 * Built-in fallback guide for one role (used only when the knowledge base is empty / unreachable / slow).
 * Lists every feature of THIS role and gives full detail for the few the message is about.
 */
export function buildRoleFeatureGuidePrompt(
  role: StaffRole,
  curated: RoleFeature[],
  message: string,
  history: { role: string; text: string }[] = [],
  nav: GeneratedNavRow[] = GENERATED_NAV,
): string {
  const label = ROLE_PROFILES[role].label;
  const features = allRoleFeatures(role, curated, nav);
  const focus = selectFeatures(message, history, 3, features);
  const detail = focus.length
    ? `\n\nFULL DETAILS for what the ${label} seems to be asking about:\n${focus.map(describeFeature).join("\n\n")}`
    : "";
  return `APP FEATURE GUIDE (everything a ${label} can open in APAS; this is your knowledge of the app itself):\n${featureIndex(features)}${detail}`;
}

/** True when the built-in guide has an entry for this message (used to decide whether the fallback can answer). */
export function builtInKnows(role: StaffRole, curated: RoleFeature[], message: string, history: { role: string; text: string }[] = []): boolean {
  return selectFeatures(message, history, 3, allRoleFeatures(role, curated)).length > 0;
}

/**
 * The prompt block that teaches an assistant how to explain the app. It is added to the data-backed assistants
 * (HOD, principal, school admin, teacher), whose old rules said "answer ONLY from CURRENT DATA" and "redirect anything
 * unrelated": without this block a question like "what is the Intervention Board?" was refused.
 */
export function appHelpRules(role: StaffRole | "parent"): string {
  const p = ROLE_PROFILES[role];
  return `HOW TO EXPLAIN THE APP: you also help the ${p.label} use the APAS app itself - what a page, tab or button is for, where to find it, and how to use it (for example "what is the Intervention Board?", "where do I find report cards?", "how do I use Attendance?"). These are NOT unrelated questions and they are answered from the APP FEATURE GUIDE below, not from the school data you are given.
- Use ONLY the APP FEATURE GUIDE. It lists exactly what a ${p.label} can open. If the ${p.label} asks about a page or feature that is not in the guide (for example one that belongs to another role such as a student, a parent or a platform admin), say plainly that it is not part of their menu and that you can only explain the pages they can open. Never describe, guess or hint at what other roles see or do.
- NEVER say "I don't know this feature" or "I can't help with that" for anything in the guide, and never assume the ${p.label} means a different page: if the name they used is in the guide (even loosely), explain THAT page. Use the exact names from the guide. If FULL DETAILS are there, use the steps from them.
- Layout: one short sentence saying what it is for; then the steps, one per line, each starting with "Step 1:", "Step 2:" and so on (use the steps in the guide, trimmed, never invent steps); when it helps, one line starting "Tip:" using only what the guide says. If the guide has no steps, say what is on the screen (tabs, buttons, sections) and do not invent how they work.
- Some guide lines say "details not written yet". For those, say the page exists and where it is in the left menu. You may say what the name suggests, plainly marked as a guess, but never invent buttons, steps or numbers. If something is in neither the guide nor the app list, say honestly you do not have details on it yet and suggest ${p.escalateTo}.
- A page can be switched off for a role by the school, so if the ${p.label} cannot see a page that is in the guide, tell them it may be turned off for their account and to ask ${role === "school_admin" ? "their platform support contact" : "their school administrator"}.
- If a question mixes the app and their data ("how do I mark attendance and who is absent today?"), give the steps from the guide and the facts from the school data you are given.
- Your answers may be read aloud: plain words only, no markdown, asterisks, hash signs, tables or emoji.`;
}
