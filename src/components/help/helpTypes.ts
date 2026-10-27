// Shared types and tiny builders for the "Help with This Page" content.
// Kept separate from the content files so pageHelp.ts and pageHelpDetails.ts can both use them.

export type HelpRole = "student" | "teacher" | "parent" | "admin" | "principal" | "school_admin" | "knsoft_admin";

export interface HelpControl {
  /** Exact on-screen text (button, tab or section heading). Verified against `sources` by the test. */
  label: string;
  kind: "button" | "tab" | "section";
  what: string;
}

export interface HelpTask {
  title: string;
  /** Things that must be true / ready before starting (roles, setup, required data). */
  before?: string[];
  /** Beginner steps, in order, naming the real fields and buttons. */
  steps: string[];
  /** What the user should see or what happens after finishing. */
  result?: string;
}

export interface HelpProblem {
  problem: string;
  /** An exact message the app shows, when there is one. The test checks it exists in `sources`. */
  quote?: string;
  fix: string;
}

export interface HelpNext {
  label: string;
  /** A real route the entry's roles may open. The test checks it against App.tsx guards. */
  route: string;
  why: string;
}

export interface PageHelpEntry {
  route: string;
  roles: HelpRole[];
  /** The name the user sees (sidebar title / page heading). */
  name: string;
  purpose: string;
  controls?: HelpControl[];
  tasks?: HelpTask[];
  problems?: HelpProblem[];
  next?: HelpNext[];
  /** Files (relative to the project root) that contain the labels and messages above. */
  sources: string[];
}

export const ALL_SCHOOL_ROLES: HelpRole[] = ["student", "teacher", "parent", "admin", "principal", "school_admin"];

export const btn = (label: string, what: string): HelpControl => ({ label, kind: "button", what });
export const tab = (label: string, what: string): HelpControl => ({ label, kind: "tab", what });
export const sec = (label: string, what: string): HelpControl => ({ label, kind: "section", what });
