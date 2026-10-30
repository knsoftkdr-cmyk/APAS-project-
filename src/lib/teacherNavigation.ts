import { type NavItem } from "@/components/layout/AppSidebar";
import {
  createNavigator,
  normaliseSentence,
  type NavDestination,
  type NavResolution,
  type ResolveContext,
} from "@/lib/navigationEngine";

// ---------------------------------------------------------------------------------------------------------------
// APAS Agent navigation for teachers: "Open my timetable", "Take me to attendance", "Go to the lesson plan generator" ...
//
// The matching rules live in the shared engine (src/lib/navigationEngine.ts), the same one the Study Buddy uses. This
// module is only the TEACHER configuration. It never navigates and never calls the network or an AI model.
//
//  * Destinations are built from the sidebar's own `navItems`, filtered by the sidebar's own role rule AND - because
//    teachers' menus are switched on/off per school - by the sidebar's own permission check (`usePermissions().can`).
//    So the agent can open exactly what THIS teacher sees in THEIR sidebar, and "open billing" is answered with
//    "not available" in a school that has not enabled it.
//  * A few sidebar rows list "teacher" but their route in App.tsx only admits students, so they would bounce to the
//    dashboard. Those are excluded (TEACHER_BLOCKED_BY_ROUTE). A unit test checks the list against App.tsx both ways.
//  * Only an explicit "go there" request navigates. Lesson-plan requests ("create a lesson plan on fractions for class
//    5"), questions and everything else return { kind: "none" } and continue to the existing lesson-plan flow.
// ---------------------------------------------------------------------------------------------------------------

export type TeacherDestination = NavDestination;
export type { NavResolution, ResolveContext };

// ─────────────────────────────────────── synonyms (keyed by route) ───────────────────────────────────────
// Titles come from the sidebar; these are only ADDITIONAL ways a teacher might say them.
export const TEACHER_EXTRA_PHRASES: Record<string, string[]> = {
  "/dashboard": ["homework", "assignment", "home work", "home page"],
  "/teacher-workspace": ["workspace", "teacher workspace", "teacher dashboard", "main dashboard", "my dashboard"],
  "/classroom": ["digital classroom", "class room", "my class"],
  "/assessment-builder": ["builder", "test builder", "exam builder", "paper builder", "assessment creator", "create assessment"],
  "/exam-reviews": ["exam review", "review exams", "exam marking"],
  "/differentiation": ["differentiation", "differentiated learning"],
  "/intervention-board": ["intervention", "interventions", "intervention tracker"],
  "/curative": ["lesson plan", "lesson plans", "lesson planner", "lesson planning", "lesson generator", "plan generator", "lesson", "curative"],
  "/teacher": ["report", "teacher reports", "class reports"],
  "/entry-ticket": ["entry tickets", "exit ticket", "exit tickets"],
  "/submissions": ["submission", "worksheet submission", "worksheets"],
  "/assessment-evaluation": ["evaluation", "evaluate", "evaluate assessments", "assessment grading", "grading", "marking"],
  "/analytics": ["analytic", "class analytics", "performance analytics", "insights"],
  "/class-mastery": ["mastery", "concept mastery", "class insights"],
  "/class-velocity": ["velocity", "learning velocity", "class pace"],
  "/item-bank": ["item bank", "question bank", "questions bank"],
  "/attendance": ["mark attendance", "take attendance", "attendance marking", "attendance register"],
  "/academic-calendar": ["calendar", "school calendar"],
  "/requests": ["request", "leave request", "leave requests", "apply leave"],
  "/timetable": ["class schedule", "schedule", "class timetable", "class routine", "my schedule"],
  "/teacher-communication": ["communications", "message", "messages", "messaging", "communication center", "communication centre", "parent messages"],
  "/teacher/appointments": ["appointment", "meetings", "parent meetings", "parent teacher meeting", "ptm"],
  "/report-cards": ["report card", "marks card", "grade card", "result", "results"],
  "/my-sen-students": ["sen students", "sen", "special education", "special needs students"],
  "/teacher-electives": ["elective", "electives", "my electives"],
  "/teacher-at-risk": ["at risk", "at risk students", "students at risk", "struggling students", "student watch"],
  "/teacher-behaviour": ["behavior", "behaviour", "behavior dashboard", "student behaviour", "student behavior", "discipline"],
  "/virtual-classrooms": ["virtual class", "online class", "live class", "live classroom"],
  "/teacher/group-projects": ["group project", "project", "projects", "team projects", "group work"],
  "/teacher/safeguarding-report": ["safeguarding report", "report safeguarding", "child protection", "incident report", "report incident"],
  "/alerts": ["alert", "my alerts"],
  "/admin": ["admin", "administration"],
  "/school-analytics": ["school analytics", "school insights", "intelligence"],
  "/security": ["security", "security settings"],
  "/billing": ["bill", "bills", "invoices"],
  "/surveys": ["survey", "feedback survey", "feedback"],
  "/semester-engine": ["semester"],
  "/marketplace": ["market place", "store"],
  "/invigilation": ["invigilate", "invigilator", "exam duty", "invigilation duty"],
  "/houses": ["house", "house points", "house system"],
  "/competency-assessment": ["competency", "competencies"],
  "/settings": ["setting", "preferences", "account settings"],
};

// Tabs of a sidebar item that are real routes but have no row of their own (listed under the item's `alsoActiveOn`).
const SUB_DESTINATIONS = [
  { path: "/mock-exams", parentPath: "/item-bank", title: "Mock Exams" }, // tab of "Item Bank & Mock Exams"
  { path: "/class-velocity", parentPath: "/class-mastery", title: "Class Velocity" }, // tab of "Class Mastery"
];

/**
 * Sidebar rows that list "teacher" in `roles`, but whose route guard in App.tsx admits students only (the route
 * redirects a teacher to /dashboard). Never offered. If App.tsx is fixed to admit teachers, the unit test fails and
 * tells you to delete the entry here.
 */
export const TEACHER_BLOCKED_BY_ROUTE = [
  "/academic-tests",
  "/gamification",
  "/leaderboard",
  "/predictions",
  "/ai-tutor",
  "/ai-tutor?mode=career",
];

// "student" is a role word for a teacher too: "open student profile" is the student's page, not theirs.
const ROLE_WORDS = ["student", "principal", "admin", "administrator", "hod", "parent", "driver", "staff", "knsoft", "headmaster"];

const navigator = createNavigator({
  role: "teacher",
  menuName: "teacher menu",
  extraPhrases: TEACHER_EXTRA_PHRASES,
  subDestinations: SUB_DESTINATIONS,
  excludePaths: TEACHER_BLOCKED_BY_ROUTE,
  roleWords: ROLE_WORDS,
  assistantNames: "apas agent|apas|agent|assistant|study buddy|buddy",
  exampleTitles: ["Timetable", "Attendance", "Lesson Plan Generator"],
});

/**
 * The teacher's destinations: the sidebar's menu for the teacher role, then (when given) the sidebar's per-school
 * permission check - exactly the list the sidebar draws.
 */
export function buildTeacherDestinations(items?: NavItem[], canUseModule?: (module: string) => boolean): TeacherDestination[] {
  return navigator.buildDestinations(items, { canUseModule });
}

/** Without `canUseModule` this is the role-only list (cached). Pass `can` from usePermissions() for the per-school list. */
export function getTeacherDestinations(canUseModule?: (module: string) => boolean): TeacherDestination[] {
  return canUseModule ? buildTeacherDestinations(undefined, canUseModule) : navigator.getDestinations();
}

// The Lesson Plan Generator is also where the agent's own lesson-plan flow ends up. "Open lesson plan for class 5
// fractions" is a request to MAKE a plan (class / chapter / minutes given), not to open an empty page - so when the
// sentence carries those details, leave it to the lesson-plan flow, which asks for what is missing.
const LESSON_DETAIL_RE = /\b(?:class|grade|std|standard|section|chapter|topic|subject|periods?|minutes?|mins?|on|about|regarding)\b|\d/;

export function resolveTeacherNavigation(text: string, ctx: ResolveContext = {}): NavResolution {
  const r = navigator.resolve(text, ctx);
  if ((r.kind === "navigate" || r.kind === "already") && r.destination.path === "/curative" && LESSON_DETAIL_RE.test(normaliseSentence(text))) {
    return { kind: "none" };
  }
  return r;
}
