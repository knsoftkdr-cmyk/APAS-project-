// supabase/functions/_shared/hodFeatureGuide.ts
//
// What the HOD assistant knows about the APAS app itself, in words a person wrote. The pages of the head of department's
// menu are NOT listed here: they are read automatically from the sidebar and from each screen's real source by
// `npm run features:generate` (see docs/feature-kb/README.md), so a new page is known as soon as it exists.
// Add an entry HERE only to say something the code cannot (why a page exists, the steps, what a label means). A
// written entry always wins over what is extracted. Only describe what the screen really does; if unsure, leave it out.
//
// Entries below are the header tools a head of department sees on every page. They were written from the components themselves
// (UniversalSearch.tsx, CommandBar.tsx, HelpMenu.tsx).

import { roleMenuRows, allRoleFeatures, buildRoleFeatureGuidePrompt, type RoleFeature } from "./roleFeatureGuide.ts";

export const HOD_FEATURES: RoleFeature[] = [
  {
    id: "global-search",
    name: "Search",
    where: "The search box at the top of every page. The keyboard shortcut is Ctrl and K (Command and K on a Mac).",
    keywords: ["search", "search box", "global search", "ctrl k", "find something", "look something up"],
    summary:
      "Looks things up across APAS, such as students, teachers and staff, lessons, exams, homework and classes. You only see results your role is allowed to open.",
    howTo: ["Click the search box at the top, or press Ctrl and K.", "Type what you are looking for and pick a result."],
  },
  {
    id: "ask-apas",
    name: "Ask APAS (command bar)",
    where: "The Ask APAS button at the top of every page. The keyboard shortcut is Ctrl and J (Command and J on a Mac).",
    keywords: ["ask apas", "command bar", "ai command bar", "ctrl j", "quick command", "type a command"],
    summary:
      "A quick way to get around and check things by typing a normal sentence, such as Open my timetable. It opens pages and shows information for your role and your school. When a command would change something, it asks you to confirm first.",
    howTo: ["Press Ask APAS, or press Ctrl and J.", "Type a sentence such as Open my timetable, then press Enter."],
  },
];

/** Menu rows of the head of department's sidebar (read by tools/feature-docs/build.mjs). */
export const hodMenuRows = () => roleMenuRows("hod");

/** Written entries + an automatic one for every other page in the head of department's menu. */
export const allHodFeatures = () => allRoleFeatures("hod", HOD_FEATURES);

/** Built-in fallback guide, used when the knowledge base cannot be reached. */
export const buildHodFeatureGuidePrompt = (message: string, history: { role: string; text: string }[] = []) =>
  buildRoleFeatureGuidePrompt("hod", HOD_FEATURES, message, history);
