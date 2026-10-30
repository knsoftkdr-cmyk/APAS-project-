import { type NavItem } from "@/components/layout/AppSidebar";
import {
  createNavigator,
  type NavDestination,
  type NavResolution,
  type ResolveContext,
} from "@/lib/navigationEngine";

// ---------------------------------------------------------------------------------------------------------------
// Study Buddy navigation: "Open Gamification", "Take me to My Mastery", "Open my timetable" ...
//
// The matching rules live in the shared engine (src/lib/navigationEngine.ts), which the teacher's APAS Agent uses
// too. This module is only the STUDENT configuration: the student's synonyms, the student's tabs, and the words that
// mean "another role's page". Behaviour and exports are unchanged.
//
//  * Destinations are built from the sidebar's own `navItems`, filtered by the sidebar's own role rule, so the Study
//    Buddy can open exactly what the student sees in their sidebar - nothing else.
//  * A sentence is only treated as navigation when it starts with an explicit "go there" request. Everything else
//    returns { kind: "none" } and continues to the existing student-self-assistant, exactly as before.
// ---------------------------------------------------------------------------------------------------------------

export type StudentDestination = NavDestination;
export type { NavResolution, ResolveContext };

// ─────────────────────────────────────── synonyms (keyed by route) ───────────────────────────────────────
// Titles come from the sidebar; these are only ADDITIONAL ways a student might say them.
export const EXTRA_PHRASES: Record<string, string[]> = {
  "/student-dashboard": ["dashboard", "student dashboard"],
  "/student-profile": ["profile", "profile 360", "my details"],
  "/academic-tests": ["academic test", "class test", "school test"],
  "/diagnostic": ["assessment", "diagnostic", "diagnostic test", "diagnostic assessment"],
  "/my-mastery": ["mastery", "mastery page", "concept mastery", "mastery report"],
  "/exam-readiness": ["exam readiness", "readiness", "exam preparation", "exam prep"],
  "/my-exams": ["exam", "online exam"],
  "/adaptive-test": ["adaptive", "adaptive testing", "adaptive assessment"],
  "/daily-review": ["review", "daily revision", "revision", "spaced repetition"],
  "/forgetting-forecast": ["forecast", "forgetting curve", "memory forecast", "retention forecast"],
  "/learning-path": ["study path", "learning plan"],
  "/worksheets": ["worksheet", "practice worksheets"],
  "/dashboard": ["homework", "assignment", "home work"],
  "/gamification": ["game", "games", "adaptive round", "rewards"],
  "/leaderboard": ["leader board", "ranking", "rank", "scoreboard", "top students"],
  "/pronunciation": ["pronunciation practice", "pronunciation assessment", "speaking practice"],
  "/ai-tutor": ["tutor", "tutoring", "ai tutoring"],
  "/ai-tutor?mode=career": ["career coach", "career guidance", "career counselling", "career counseling", "career advice", "career"],
  "/attendance": ["attendance record", "attendance records"],
  "/timetable": ["class schedule", "schedule", "class timetable", "class routine"],
  "/academic-calendar": ["calendar", "school calendar"],
  "/electives": ["elective", "elective subjects"],
  "/student/credentials": ["credential", "certificate", "digital credentials"],
  "/student-communication": ["communications", "message", "messaging", "communication center", "communication centre"],
  "/virtual-classroom": ["virtual class", "online class", "live class", "live classroom"],
  "/my-classroom": ["classroom", "digital classroom"],
  "/student/group-projects": ["group project", "project", "team projects", "group work"],
  "/settings": ["setting", "preferences", "account settings"],
  "/surveys": ["survey", "feedback survey", "feedback"],
  "/semester-engine": ["semester"],
  "/report-cards": ["report card", "report", "result", "marks card", "grade card"],
  "/marketplace": ["market place", "store"],
  "/hall-tickets": ["hall ticket", "admit card", "exam ticket"],
  "/houses": ["house", "house points", "house system"],
  "/my-accommodations": ["accommodation", "learning accommodations"],
};

const navigator = createNavigator({
  role: "student",
  menuName: "student menu",
  extraPhrases: EXTRA_PHRASES,
  // Tabs that are real routes of a sidebar item (the sidebar lists them under that item's `alsoActiveOn`), but have
  // no sidebar row of their own. Only offered when their parent item is itself visible to the student.
  subDestinations: [
    { path: "/exam-readiness", parentPath: "/my-mastery", title: "Exam Readiness" }, // 2nd tab of StudentMasteryReadiness
  ],
  roleWords: ["teacher", "principal", "admin", "administrator", "hod", "parent", "driver", "staff", "knsoft", "faculty", "headmaster"],
  assistantNames: "study buddy|buddy|apas",
  exampleTitles: ["Homework", "Timetable", "Gamification"],
});

/** The student's destinations, built from the sidebar's own menu + visibility rule. */
export function buildStudentDestinations(items?: NavItem[]): StudentDestination[] {
  return navigator.buildDestinations(items);
}

export function getStudentDestinations(): StudentDestination[] {
  return navigator.getDestinations();
}

export function resolveStudentNavigation(text: string, ctx: ResolveContext = {}): NavResolution {
  return navigator.resolve(text, ctx);
}
