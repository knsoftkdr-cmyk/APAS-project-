import { type NavItem } from "@/components/layout/AppSidebar";
import { createNavigator, normaliseSentence, type NavDestination, type NavResolution, type ResolveContext } from "@/lib/navigationEngine";

// ---------------------------------------------------------------------------------------------------------------
// APAS Agent navigation for PARENTS: "Open my child's report card", "Take me to attendance", "Go to appointments" ...
//
// The matching rules live in the shared engine (src/lib/navigationEngine.ts). This module is only the PARENT
// configuration. It never navigates and never calls the network or an AI model.
//
//  * Destinations are built from the sidebar's own `navItems`, filtered by the sidebar's own role rule. Parents (like
//    students) are not subject to the per-school module permission check in the sidebar, so neither is this list.
//  * Only an explicit "go there" request navigates. Questions about the child ("what is my child's attendance?",
//    "show fee status") return { kind: "none" } and continue to the existing parent-assistant flow, unchanged.
// ---------------------------------------------------------------------------------------------------------------

export type ParentDestination = NavDestination;
export type { NavResolution, ResolveContext };

// Titles come from the sidebar; these are only ADDITIONAL ways a parent might say them. Parents say "my child's ...".
export const PARENT_EXTRA_PHRASES: Record<string, string[]> = {
  "/parent-dashboard": ["dashboard", "parent dashboard", "home page", "main page", "overview"],
  "/student-profile": ["child profile", "childs profile", "child details", "kids profile", "ward profile", "student details"],
  "/report-cards": ["report card", "childs report card", "marks card", "grade card", "result", "results", "progress report", "grades", "marks"],
  "/attendance": ["childs attendance", "attendance record", "attendance report"],
  "/parent-communication": ["communications", "message", "messages", "messaging", "message school", "teacher messages", "school messages", "inbox"],
  "/appointments": ["appointment", "book appointment", "meeting", "meetings", "parent teacher meeting", "ptm", "book meeting"],
  "/academic-calendar": ["calendar", "school calendar", "holidays", "school events"],
  "/surveys": ["survey", "feedback", "feedback survey"],
  "/hall-tickets": ["hall ticket", "admit card", "exam ticket", "exam tickets", "exam admit card"],
  "/parent/safeguarding": ["safeguard", "child safety", "child protection", "report concern", "safeguarding concern"],
  "/settings": ["setting", "preferences", "account settings"],
};

// Pages of other roles. NOT "student": a parent's "student profile" is their own child's page.
const ROLE_WORDS = ["teacher", "principal", "admin", "administrator", "hod", "driver", "staff", "knsoft", "headmaster", "faculty"];

const navigator = createNavigator({
  role: "parent",
  menuName: "parent menu",
  extraPhrases: PARENT_EXTRA_PHRASES,
  roleWords: ROLE_WORDS,
  assistantNames: "apas agent|apas|agent|assistant|buddy",
  exampleTitles: ["Report Cards", "Attendance", "Appointments"],
});

export function buildParentDestinations(items?: NavItem[]): ParentDestination[] {
  return navigator.buildDestinations(items);
}

export function getParentDestinations(): ParentDestination[] {
  return navigator.getDestinations();
}

// The parent assistant answers fee and bus/transport questions itself (they are not menu pages for a parent). So "open
// fees" / "open transport" is a request for THAT, not for a missing page: leave it to the assistant instead of saying
// "not found" or "not available".
const ASSISTANT_TOPICS_RE = /\b(?:fees?|bus(?:es)?|transport(?:ation)?|routes?|pick ?ups?|drop ?offs?|driver)\b/;

export function resolveParentNavigation(text: string, ctx: ResolveContext = {}): NavResolution {
  const r = navigator.resolve(text, ctx);
  if ((r.kind === "not-found" || r.kind === "blocked") && ASSISTANT_TOPICS_RE.test(normaliseSentence(text))) return { kind: "none" };
  return r;
}
