import { type NavItem } from "@/components/layout/AppSidebar";
import { createNavigator, type NavDestination, type NavResolution, type ResolveContext } from "@/lib/navigationEngine";

// ---------------------------------------------------------------------------------------------------------------
// School Admin Assistant navigation: "Open admissions", "Take me to student transfers", "Go to ID cards" ...
//
// The matching rules live in the shared engine (src/lib/navigationEngine.ts). This module is only the SCHOOL ADMIN
// CONFIGURATION. It never navigates and never calls the network or an AI model.
//
//  * Destinations are built from the sidebar's own `navItems`, filtered by the sidebar's own role rule. School admins are
//    in the permission system's BYPASS_ROLES (every module is on for them), so `usePermissions().can` is always true; it is
//    still applied, so the list can never disagree with the sidebar.
//  * Only an explicit "go there" request navigates. Questions ("how many admissions this month?", "open admissions for
//    class 5") return { kind: "none" } and continue to the existing school-admin assistant, unchanged.
// ---------------------------------------------------------------------------------------------------------------

export type SchoolAdminDestination = NavDestination;
export type { NavResolution, ResolveContext };

// Titles come from the sidebar; these are only ADDITIONAL ways a school admin might say them.
export const SCHOOL_ADMIN_EXTRA_PHRASES: Record<string, string[]> = {
  "/dashboard": ["dashboard", "main dashboard", "overview", "home page"],
  "/admissions": ["admission", "enrolment", "enrollment", "new admissions"],
  "/transport": ["bus", "buses", "transportation", "school bus"],
  "/admin-communication": ["communications", "message", "messages", "announcement", "announcements", "notices", "circulars", "communication center", "communication centre"],
  "/super-admin": ["super admin", "admin panel", "administration", "school administration"],
  "/executive-reporting": ["executive", "executive reporting", "executive reports", "executive analytics", "report", "reports"],
  "/surveys": ["survey", "feedback", "feedback survey"],
  "/ai-quality-safety": ["ai quality", "ai safety", "quality and safety", "ai quality safety"],
  "/academic-calendar": ["calendar", "school calendar", "holidays"],
  "/semester-engine": ["semester"],
  "/report-cards": ["report card", "marks card", "results"],
  "/alumni": ["alumnus", "former students", "old students", "past students"],
  "/marketplace": ["market place", "store"],
  "/exam-seating": ["seating", "seating plan", "seat plan", "exam seats"],
  "/hall-tickets": ["hall ticket", "admit card", "exam tickets"],
  "/invigilation": ["invigilate", "invigilator", "exam duty", "invigilation duty"],
  "/houses": ["house", "house points", "house system"],
  "/student-transfers": ["student transfer", "transfer", "transfers", "transfer certificate", "tc"],
  "/id-cards": ["id card", "identity card", "identity cards", "student id"],
  "/lifecycle-timeline": ["lifecycle", "student lifecycle", "timeline"],
  "/syllabus-overview": ["syllabus", "syllabus overview", "curriculum coverage", "curriculum progress", "coverage"],
  "/school-quality-index": ["quality index", "sqi", "school quality", "school index"],
  "/competency-heatmap": ["heatmap", "heat map", "competency map"],
  "/class-mastery": ["mastery", "concept mastery"],
  "/class-velocity": ["velocity", "learning velocity"],
  "/early-warning": ["early warnings", "warning", "at risk", "at risk students"],
  "/concept-dependencies": ["concept dependency", "dependencies", "concept map", "prerequisites"],
  "/item-bank": ["item bank", "question bank"],
  "/competency-definitions": ["definitions", "competency definition"],
  "/rotation-schedules": ["rotation", "rotations", "rotation schedule"],
  "/sen-management": ["sen", "special education", "special needs", "sen students"],
  "/admin/electives": ["elective", "electives management"],
  "/admin/branches": ["branch", "branches", "campus", "campuses", "branch management"],
  "/admin/facilities": ["facilities", "facility", "resources", "resource"],
  "/settings": ["setting", "preferences", "account settings"],
};

// Tabs of "Item Bank & Mock Exams": real routes (its `alsoActiveOn`) with no sidebar row of their own.
const SUB_DESTINATIONS = [
  { path: "/mock-exams", parentPath: "/item-bank", title: "Mock Exams" },
  { path: "/exam-reviews", parentPath: "/item-bank", title: "Exam Reviews" },
];

// Pages of other roles. NOT "admin" or "school": "admin panel" and "school admin" are this user's own.
const ROLE_WORDS = ["student", "teacher", "principal", "hod", "parent", "driver", "staff", "knsoft", "headmaster", "faculty"];

const navigator = createNavigator({
  role: "school_admin",
  menuName: "school admin menu",
  extraPhrases: SCHOOL_ADMIN_EXTRA_PHRASES,
  subDestinations: SUB_DESTINATIONS,
  roleWords: ROLE_WORDS,
  assistantNames: "school admin assistant|apas agent|apas|agent|assistant|buddy",
  exampleTitles: ["Admissions", "Transport", "Report Cards"],
});

export function buildSchoolAdminDestinations(items?: NavItem[], canUseModule?: (module: string) => boolean): SchoolAdminDestination[] {
  return navigator.buildDestinations(items, { canUseModule });
}

/** Without `canUseModule` this is the role-only list (cached). Pass `can` from usePermissions() for the permission-filtered list. */
export function getSchoolAdminDestinations(canUseModule?: (module: string) => boolean): SchoolAdminDestination[] {
  return canUseModule ? buildSchoolAdminDestinations(undefined, canUseModule) : navigator.getDestinations();
}

export function resolveSchoolAdminNavigation(text: string, ctx: ResolveContext = {}): NavResolution {
  return navigator.resolve(text, ctx);
}
