import { type NavItem } from "@/components/layout/AppSidebar";
import { createNavigator, type NavDestination, type NavResolution, type ResolveContext } from "@/lib/navigationEngine";

// ---------------------------------------------------------------------------------------------------------------
// Principal Assistant navigation: "Open school intelligence", "Take me to attendance", "Go to admissions" ...
//
// The matching rules live in the shared engine (src/lib/navigationEngine.ts). This module is only the PRINCIPAL
// configuration. It never navigates and never calls the network or an AI model.
//
//  * Destinations are built from the sidebar's own `navItems`, filtered by the sidebar's own role rule AND - because a
//    principal's menu is switched on/off per school - by the sidebar's own permission check (`usePermissions().can`).
//    So the assistant opens exactly what THIS principal sees in THEIR sidebar, and answers "not available" otherwise.
//  * Only an explicit "go there" request navigates. Data questions ("how is attendance today?", "open attendance for
//    class 5") return { kind: "none" } and continue to the existing principal assistant, unchanged.
// ---------------------------------------------------------------------------------------------------------------

export type PrincipalDestination = NavDestination;
export type { NavResolution, ResolveContext };

// Titles come from the sidebar; these are only ADDITIONAL ways a principal might say them.
export const PRINCIPAL_EXTRA_PHRASES: Record<string, string[]> = {
  "/dashboard": ["dashboard", "principal dashboard", "main dashboard", "overview", "home page"],
  "/admin": ["admin", "administration"],
  "/teacher": ["report", "teacher reports", "school reports"],
  "/admin-communication": ["communications", "message", "messages", "announcement", "announcements", "notices", "circulars", "communication center", "communication centre"],
  "/syllabus-overview": ["syllabus", "syllabus overview", "curriculum coverage", "curriculum progress", "coverage"],
  "/surveys": ["survey", "feedback", "feedback survey"],
  "/academic-calendar": ["calendar", "school calendar", "holidays"],
  "/timetable": ["schedule", "school timetable", "master timetable"],
  "/intervention-board": ["intervention", "interventions"],
  "/rotation-schedules": ["rotation", "rotations", "rotation schedule"],
  "/admissions": ["admission", "enrolment", "enrollment", "new admissions"],
  "/sen-management": ["sen", "special education", "special needs", "sen students"],
  "/admin/electives": ["elective", "electives management"],
  "/transport": ["bus", "buses", "transportation", "school bus"],
  "/safeguarding": ["safeguard", "child protection", "child safety", "safeguarding cases"],
  "/alerts": ["alert", "notifications"],
  "/school-analytics": ["school analytics", "analytics", "intelligence", "school insights", "insights"],
  "/security": ["security"],
  "/ai-quality-safety": ["ai quality", "ai safety", "quality and safety", "ai quality safety"],
  "/semester-engine": ["semester"],
  "/report-cards": ["report card", "marks card", "results"],
  "/marketplace": ["market place", "store"],
  "/exam-seating": ["seating", "seating plan", "seat plan", "exam seats"],
  "/hall-tickets": ["hall ticket", "admit card", "exam tickets"],
  "/invigilation": ["invigilate", "invigilator", "exam duty", "invigilation duty"],
  "/houses": ["house", "house points", "house system"],
  "/school-quality-index": ["quality index", "sqi", "school quality", "school index"],
  "/competency-heatmap": ["heatmap", "heat map", "competency map"],
  "/class-mastery": ["mastery", "concept mastery"],
  "/class-velocity": ["velocity", "learning velocity"],
  "/early-warning": ["early warnings", "warning", "at risk", "at risk students"],
  "/concept-dependencies": ["concept dependency", "dependencies", "concept map", "prerequisites"],
  "/item-bank": ["item bank", "question bank"],
  "/competency-definitions": ["definitions", "competency definition"],
  "/admin/branches": ["branch", "branches", "campus", "campuses", "branch management"],
  "/admin/facilities": ["facilities", "facility", "resources", "resource"],
  "/settings": ["setting", "preferences", "account settings"],
};

// Tabs of "Item Bank & Mock Exams": real routes (its `alsoActiveOn`) with no sidebar row of their own.
const SUB_DESTINATIONS = [
  { path: "/mock-exams", parentPath: "/item-bank", title: "Mock Exams" },
  { path: "/exam-reviews", parentPath: "/item-bank", title: "Exam Reviews" },
];

// Pages of other roles. NOT "principal" or "admin": "principal dashboard" and "admin panel" are the principal's own.
const ROLE_WORDS = ["student", "teacher", "parent", "hod", "driver", "staff", "knsoft", "headmaster", "faculty"];

const navigator = createNavigator({
  role: "principal",
  menuName: "principal menu",
  extraPhrases: PRINCIPAL_EXTRA_PHRASES,
  subDestinations: SUB_DESTINATIONS,
  roleWords: ROLE_WORDS,
  assistantNames: "principal assistant|apas agent|apas|agent|assistant|buddy",
  exampleTitles: ["Attendance", "Timetable", "Alerts"],
});

/** The principal's destinations: the sidebar's menu for the role, then (when given) the sidebar's per-school permission check. */
export function buildPrincipalDestinations(items?: NavItem[], canUseModule?: (module: string) => boolean): PrincipalDestination[] {
  return navigator.buildDestinations(items, { canUseModule });
}

/** Without `canUseModule` this is the role-only list (cached). Pass `can` from usePermissions() for the per-school list. */
export function getPrincipalDestinations(canUseModule?: (module: string) => boolean): PrincipalDestination[] {
  return canUseModule ? buildPrincipalDestinations(undefined, canUseModule) : navigator.getDestinations();
}

export function resolvePrincipalNavigation(text: string, ctx: ResolveContext = {}): NavResolution {
  return navigator.resolve(text, ctx);
}
