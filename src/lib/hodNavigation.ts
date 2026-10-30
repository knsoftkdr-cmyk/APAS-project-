import { type NavItem } from "@/components/layout/AppSidebar";
import { createNavigator, type NavDestination, type NavResolution, type ResolveContext } from "@/lib/navigationEngine";

// ---------------------------------------------------------------------------------------------------------------
// HOD Assistant navigation: "Open class mastery", "Take me to the intervention board", "Go to syllabus coverage" ...
//
// The matching rules live in the shared engine (src/lib/navigationEngine.ts). This module is only the HOD
// CONFIGURATION. It never navigates and never calls the network or an AI model.
//
//  * Destinations are built from the sidebar's own `navItems`, filtered by the sidebar's own role rule AND - because a
//    HOD's menu is switched on/off per school - by the sidebar's own permission check (`usePermissions().can`).
//  * A few sidebar rows list "hod" but their route in App.tsx only admits students, so they would bounce to the
//    dashboard. Those are excluded (HOD_BLOCKED_BY_ROUTE); a unit test checks the list against App.tsx both ways.
//  * Only an explicit "go there" request navigates. Questions ("which students are at risk?", "open class mastery for
//    class 8") return { kind: "none" } and continue to the existing HOD assistant, unchanged.
// ---------------------------------------------------------------------------------------------------------------

export type HodDestination = NavDestination;
export type { NavResolution, ResolveContext };

// Titles come from the sidebar; these are only ADDITIONAL ways a HOD might say them.
export const HOD_EXTRA_PHRASES: Record<string, string[]> = {
  "/hod-dashboard": ["dashboard", "hod dashboard", "department dashboard", "head of department", "main dashboard", "home page"],
  "/dashboard": ["homework", "assignment", "assignments", "home work"],
  "/intervention-board": ["intervention", "interventions", "intervention tracker"],
  "/my-sen-students": ["sen students", "sen", "special education", "special needs"],
  "/teacher": ["report", "teacher reports", "department reports"],
  "/admin-communication": ["communications", "message", "messages", "announcement", "announcements", "notices", "circulars", "communication center", "communication centre"],
  "/safeguarding": ["safeguard", "child protection", "child safety", "safeguarding cases"],
  "/requests": ["request", "leave request", "leave requests"],
  "/alerts": ["alert", "my alerts"],
  "/admin": ["admin", "administration"],
  "/school-analytics": ["school analytics", "analytics", "intelligence", "school insights", "insights"],
  "/security": ["security"],
  "/billing": ["bill", "bills", "invoices"],
  "/surveys": ["survey", "feedback", "feedback survey"],
  "/ai-quality-safety": ["ai quality", "ai safety", "quality and safety", "ai quality safety"],
  "/academic-calendar": ["calendar", "school calendar", "holidays"],
  "/houses": ["house", "house points", "house system"],
  "/timetable": ["schedule", "class timetable", "school timetable"],
  "/syllabus-overview": ["syllabus", "syllabus overview", "curriculum coverage", "curriculum progress", "coverage"],
  "/competency-heatmap": ["heatmap", "heat map", "competency map"],
  "/class-mastery": ["mastery", "concept mastery"],
  "/class-velocity": ["velocity", "learning velocity"],
  "/early-warning": ["early warnings", "warning", "at risk", "at risk students"],
  "/concept-dependencies": ["concept dependency", "dependencies", "concept map", "prerequisites"],
  "/item-bank": ["item bank", "question bank"],
  "/competency-definitions": ["definitions", "competency definition"],
  "/settings": ["setting", "preferences", "account settings"],
};

// Tabs of "Item Bank & Mock Exams": real routes (its `alsoActiveOn`) with no sidebar row of their own.
const SUB_DESTINATIONS = [
  { path: "/mock-exams", parentPath: "/item-bank", title: "Mock Exams" },
  { path: "/exam-reviews", parentPath: "/item-bank", title: "Exam Reviews" },
];

/**
 * Sidebar rows that list "hod" in `roles`, but whose route guard in App.tsx admits students only (the route redirects a
 * HOD to /dashboard). Never offered. If App.tsx is fixed to admit HODs, the unit test fails and tells you to delete the entry.
 */
export const HOD_BLOCKED_BY_ROUTE = ["/academic-tests", "/gamification", "/leaderboard", "/predictions", "/ai-tutor", "/ai-tutor?mode=career"];

// Pages of other roles. NOT "hod" (their own) or "admin" ("admin panel" is theirs).
const ROLE_WORDS = ["student", "teacher", "principal", "parent", "driver", "staff", "knsoft", "headmaster", "faculty"];

const navigator = createNavigator({
  role: "hod",
  menuName: "HOD menu",
  extraPhrases: HOD_EXTRA_PHRASES,
  subDestinations: SUB_DESTINATIONS,
  excludePaths: HOD_BLOCKED_BY_ROUTE,
  roleWords: ROLE_WORDS,
  assistantNames: "hod assistant|apas agent|apas|agent|assistant|buddy",
  exampleTitles: ["Timetable", "Class Mastery", "Alerts"],
});

/** The HOD's destinations: the sidebar's menu for the role, then (when given) the sidebar's per-school permission check. */
export function buildHodDestinations(items?: NavItem[], canUseModule?: (module: string) => boolean): HodDestination[] {
  return navigator.buildDestinations(items, { canUseModule });
}

/** Without `canUseModule` this is the role-only list (cached). Pass `can` from usePermissions() for the per-school list. */
export function getHodDestinations(canUseModule?: (module: string) => boolean): HodDestination[] {
  return canUseModule ? buildHodDestinations(undefined, canUseModule) : navigator.getDestinations();
}

export function resolveHodNavigation(text: string, ctx: ResolveContext = {}): NavResolution {
  return navigator.resolve(text, ctx);
}
