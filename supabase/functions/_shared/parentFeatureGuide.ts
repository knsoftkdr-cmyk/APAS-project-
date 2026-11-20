// supabase/functions/_shared/parentFeatureGuide.ts
//
// What the parent's APAS Agent (text AND voice - both go through the parent-assistant function) knows about the
// PARENT APP ITSELF: every menu page, dashboard tab, payment screen and shortcut a parent can use, what it is for,
// and how to use it. Pure data + pure helpers (no I/O), unit-tested in src/test/parentFeatureGuide.test.ts.
//
// WHY THIS FILE EXISTS
//   parent-assistant only knew its child's records (fees, attendance, report cards ...), never the app itself. So a
//   parent asking "what is the Safeguarding page?" or "how do I pay fees?" got a guess or "I don't know".
//
// KEEPING IT CURRENT - TWO LAYERS (same as the Study Buddy)
//   1. AUTOMATIC. featureManifest.generated.ts is generated from the real sidebar (tools/generate-feature-manifest.mjs,
//      `npm run features:generate`, also run before every `npm run build`). Every page a parent can see in the menu is
//      therefore known by name and place even before anyone writes about it. A test fails if that file is stale.
//   2. WRITTEN. The entries below add what a page is for, how to use it and what the labels mean. Add one when you add
//      a parent page, dashboard tab or payment screen. A page with no entry still gets an automatic one, and the
//      assistant is told not to invent details for those.
//
// WRITING RULES (the text is read aloud in voice mode)
//   - Say only what the screen really does. Every sentence was written from the page's source. If unsure, leave it out.
//   - Plain, short sentences. No markdown, no tables. Use the exact on-screen names for tabs and buttons.

import { GENERATED_NAV, GENERATED_PARENT_MODULES, type GeneratedNavRow } from "./featureManifest.generated.ts";

export interface ParentFeature {
  id: string;
  /** The name exactly as the parent sees it. */
  name: string;
  /** Menu route(s) this entry covers. Omit for things that are not a menu page (tabs, buttons, header tools). */
  routes?: string[];
  where: string;
  /** Other words a parent might use for it (matched case-insensitively, whole words/phrases). */
  keywords: string[];
  summary: string;
  howTo?: string[];
  notes?: string[];
  /** Student 360 Profile tab names this entry describes (a test checks every tab is covered). */
  profileTabs?: string[];
  /** True for an entry made automatically from the menu (name and place only, no written details yet). */
  auto?: boolean;
}

export const PARENT_FEATURES: ParentFeature[] = [
  // ───────────────────────────── Home ─────────────────────────────
  {
    id: "home",
    name: "Home (parent dashboard)",
    routes: ["/parent-dashboard"],
    where: "First item in the left menu (Home).",
    keywords: ["home", "dashboard", "parent dashboard", "home page", "main page", "overview", "my childs progress", "child progress", "homework", "my childs homework", "homework status", "pending homework", "homework graded", "test scores", "assessment results", "diagnostic results", "view report"],
    summary:
      "Your starting page for following your child's progress. At the top you choose which child you are looking at, and there are tabs for Test Scores, Homework, Pickup Guardians and, if your child uses the school bus, Bus Tracking. There is also a Pay Fees button.",
    howTo: [
      "Open Home from the left menu.",
      "If you have more than one child, choose the child where it says Viewing data for.",
      "Tap Test Scores to see your child's assessment results, or Homework to see each homework with its due date and status.",
      "Once a homework is Graded, press View Report beside it to read the answer, the score out of 100 and the teacher's feedback.",
    ],
    notes: [
      "Homework status shows as Pending, Submitted or Graded.",
      "If no child is linked to your account it says No Students Linked. Please contact the school admin to link your child.",
    ],
  },
  {
    id: "pickup-guardians",
    name: "Pickup Guardians",
    where: "Home, Pickup Guardians tab.",
    keywords: ["pickup guardian", "pickup guardians", "authorized guardian", "authorised guardian", "authorized pickup", "authorised pickup", "who can pick up", "early pickup", "add guardian", "pick up my child", "collect my child", "pickup person"],
    summary:
      "The list of people other than you who are allowed to pick up your child early. Only you and the people on this list are recognised for early pickup.",
    howTo: [
      "Open Home and tap the Pickup Guardians tab.",
      "Press Add Guardian.",
      "Fill in the Full name and the Relation, for example grandparent or uncle. The Phone number is optional.",
      "Save it. The person now shows in the list.",
    ],
    notes: ["If no one is added, the page says No alternate guardians on file. Only you will be recognized for early pickup."],
  },
  {
    id: "bus-tracking",
    name: "Bus Tracking",
    where: "Home, Bus Tracking tab. It shows only if your child uses school transport.",
    keywords: ["bus tracking", "track bus", "bus", "school bus", "where is the bus", "bus location", "live bus", "bus map", "driver", "rate driver", "driver rating", "transport", "bus route", "bus timing"],
    summary:
      "Shows where the school bus is on a map for your child's route, with details about the route and the driver. Below it you can rate your child's driver.",
    howTo: [
      "Open Home and tap the Bus Tracking tab.",
      "Look at the map to see the bus on your child's route.",
      "To rate the driver, scroll down to Rate your driver this semester, choose your rating, add an optional comment and send it.",
    ],
    notes: [
      "If you do not see a Bus Tracking tab, your child does not have a transport route set up. The school's transport office can add it.",
      "Driver ratings open once the current semester is active.",
      "You can also ask me about your child's bus in this chat.",
    ],
  },

  // ───────────────────────────── Fees ─────────────────────────────
  {
    id: "fee-payment",
    name: "Fee Payment",
    where: "Press the Pay Fees button on your Home page. It is not a separate row in the left menu.",
    keywords: ["fee payment", "pay fees", "pay fee", "pay school fees", "fees", "fee", "school fees", "pay online", "due amount", "fee particulars", "fee status", "fee receipt", "receipt", "payment history", "payment gateway", "proceed for payment", "payment failed", "payment pending", "payment stuck", "payment is stuck", "stuck payment", "payment is pending", "payment not going through", "money deducted", "amount deducted", "paid but not updated", "payment not showing"],
    summary:
      "Where you see your child's fee details and pay the school fees online.",
    howTo: [
      "Open Home and press Pay Fees.",
      "There are two options at the top. Payment Gateway is for paying what is due now. Finance (Easy Monthly Installments) is for paying in smaller parts.",
      "On Payment Gateway, check the Student Information, so you know the fees are for the right child.",
      "Under Fee Particulars you see the Due Amount and the fee items, such as Course, Transport, Uniform, Material and Other amounts. For an exam fee, choose the exam with Select Exam.",
      "Enter the amount you want to pay, then press Proceed For Payment and finish the payment in the secure window.",
      "When it works you see Payment successful, and a receipt is emailed to you. Your payments are listed under Payment history.",
    ],
    notes: [
      "You must enter at least one amount before you can proceed.",
      "If it says Payment is being confirmed, your bank is still processing it. Do not pay again. The record updates as soon as it is confirmed, and you can press Check on that payment to look again.",
      "If it says Payment failed, no money was recorded, so you can safely try again.",
      "If you cancel, your fee request is saved as pending and you can finish paying later from your dashboard.",
      "Card details are handled by the payment gateway. The school never sees or stores them.",
      "If online payment is not available, it tells you to contact the school office.",
    ],
  },
  {
    id: "fee-instalments",
    name: "Pay in instalments",
    where: "On the Fee Payment page, the Finance (Easy Monthly Installments) option next to Payment Gateway. It works if your school has turned instalment plans on.",
    keywords: ["pay in instalments", "pay in installments", "instalment", "instalments", "installment", "installments", "emi", "easy monthly installments", "finance", "instalment plan", "installment plan", "monthly instalments", "monthly installments", "split payment", "pay in parts", "request instalments", "instalment request", "plan progress", "next due", "pay now"],
    summary:
      "If your school allows it, you can ask to pay a fee in smaller parts instead of all at once.",
    howTo: [
      "On Fee Payment choose Finance (Easy Monthly Installments). Fee summary shows your fee overview, what is paid so far, and the next due date.",
      "Next to a fee that is eligible, press Request instalments and add your request.",
      "Your requests are listed under Instalment requests. If the school declines, it shows the reason from the school.",
      "Once a plan is active you see the Payment schedule and Plan progress. Press Pay Now beside an instalment to pay it, and use Receipt to get its receipt.",
    ],
    notes: [
      "An instalment is marked paid only after the payment is confirmed.",
      "If your school has not turned instalment plans on, it says so, and you can still pay your fees in full from the Payment Gateway option.",
    ],
  },
  {
    id: "profile-fees",
    name: "Fee Plan (profile tab)",
    where: "Student Profile, Fees tab.",
    keywords: ["my childs fee plan", "fee structure", "concession", "discount", "outstanding balance", "balance", "tuition", "fee plan tab", "fees tab", "fees in the profile"],
    summary:
      "Shows the fee plan the school assigned when your child's admission was confirmed: the fee structure, class, academic year and due date, a breakdown of each fee, the total fee, any concession or discount, how much is paid so far, and the outstanding balance. A badge shows whether it is Paid, Part paid, Pending or Overdue.",
    notes: [
      "This tab is for viewing. To pay, use Pay Fees on your Home page.",
      "If it says No admission fee plan linked, the plan appears once the admission is confirmed and the plan is linked to your child.",
      "Questions about an amount are best asked to the school's fee office.",
    ],
    profileTabs: ["Fees"],
  },

  // ───────────────────────────── Child's school life ─────────────────────────────
  {
    id: "student-profile",
    name: "Student Profile",
    routes: ["/student-profile"],
    where: "Left menu, Student Profile.",
    keywords: ["student profile", "child profile", "childs profile", "my childs profile", "profile", "profile 360", "child details", "kids profile", "ward profile", "student details", "my childs information"],
    summary:
      "Your child's whole profile in one place, split into tabs: Overview, Parents, Medical, Transport, Documents, Behaviour, Improvement Plan, Learning Twin, Live Activity, Learning Support, Emergency, Goals and Fees.",
    howTo: ["Open Student Profile from the left menu.", "Tap a tab to see that part of the profile."],
    notes: ["You can update some of the details yourself, and upload certificates and files under Documents."],
    profileTabs: ["Overview", "Parents", "Medical", "Transport", "Documents", "Behaviour", "Emergency"],
  },
  {
    id: "profile-improvement-plan",
    name: "Improvement Plan (profile tab)",
    where: "Student Profile, Improvement Plan tab.",
    keywords: ["improvement plan", "growth plan", "personalised plan", "personalized plan"],
    summary: "A personalised growth plan built from your child's predictions, attendance and competencies, showing what to work on.",
    profileTabs: ["Improvement Plan"],
  },
  {
    id: "profile-learning-twin",
    name: "Learning Twin (profile tab)",
    where: "Student Profile, Learning Twin tab.",
    keywords: ["learning twin", "twin", "digital twin", "learning style", "learning preferences", "how does my child learn"],
    summary:
      "A picture of how your child learns: their ability, learning preferences and progression, kept up to date from their tests, adaptive sessions and mastery. It also shows why their risk level is what it is and gives suggested next steps.",
    profileTabs: ["Learning Twin"],
  },
  {
    id: "profile-live-activity",
    name: "Live Activity (profile tab)",
    where: "Student Profile, Live Activity tab.",
    keywords: ["live activity", "childs activity", "activity log", "time on platform", "what is my child doing"],
    summary: "Your child's real-time learning activity: answers, tutor use, tests and time spent on the platform.",
    profileTabs: ["Live Activity"],
  },
  {
    id: "profile-learning-support",
    name: "Learning Support (profile tab)",
    where: "Student Profile, Learning Support tab.",
    keywords: ["learning support", "iep", "support plan", "support plans", "accommodations"],
    summary: "Your child's support plans and accommodations, such as an IEP, if they have one.",
    profileTabs: ["Learning Support"],
  },
  {
    id: "profile-goals",
    name: "Goals (profile tab)",
    where: "Student Profile, Goals tab.",
    keywords: ["goals", "my childs goals", "goal tracking"],
    summary: "Your child's goals and their progress towards them.",
    profileTabs: ["Goals"],
  },
  {
    id: "report-cards",
    name: "Report Cards",
    routes: ["/report-cards"],
    where: "Left menu, Report Cards.",
    keywords: ["report card", "report cards", "childs report card", "marks card", "grade card", "result", "results", "progress report", "grades", "marks"],
    summary: "Your child's report cards, with their marks and grades.",
    howTo: ["Open Report Cards from the left menu.", "If you have more than one child, choose the child first."],
  },
  {
    id: "attendance",
    name: "Attendance",
    routes: ["/attendance"],
    where: "Left menu, Attendance.",
    keywords: ["attendance", "childs attendance", "attendance record", "attendance report", "absent", "present", "leave", "how many days absent"],
    summary: "Your child's attendance record.",
    howTo: ["Open Attendance from the left menu.", "Choose your child where it says Select child."],
  },
  {
    id: "hall-tickets",
    name: "Hall Tickets",
    routes: ["/hall-tickets"],
    where: "Left menu, Hall Tickets.",
    keywords: ["hall ticket", "hall tickets", "admit card", "exam ticket", "exam tickets", "exam admit card", "seat number", "exam seat", "exam hall"],
    summary: "Your child's exam hall tickets, with the exam, hall and seat once the school has assigned them.",
  },
  {
    id: "academic-calendar",
    name: "Academic Calendar",
    routes: ["/academic-calendar"],
    where: "Left menu, Academic Calendar.",
    keywords: ["academic calendar", "calendar", "school calendar", "holidays", "school events", "events", "exam dates", "homework deadlines", "when is the holiday"],
    summary: "School events, holidays, exam dates and homework deadlines for the year.",
  },

  // ───────────────────────────── Talking to the school ─────────────────────────────
  {
    id: "communication",
    name: "Communication",
    routes: ["/parent-communication"],
    where: "Left menu, Communication.",
    keywords: ["communication", "communication center", "communications", "message", "messages", "messaging", "message school", "message teacher", "teacher messages", "school messages", "inbox", "chat with teacher", "talk to teacher", "send message"],
    summary: "Messages with your child's teachers. It is called the Communication Center.",
    howTo: [
      "Open Communication from the left menu.",
      "Choose a teacher from the list. You can use Search teachers to find one.",
      "Type your message at the bottom. You can attach a file or a photo or video, and add an emoji.",
      "Press send. Your conversation with that teacher appears on the right.",
    ],
    notes: [
      "A Write a message or attach a file reminder means you tried to send an empty message.",
      "To meet a teacher in person or online instead, use Appointments in the left menu.",
    ],
  },
  {
    id: "appointments",
    name: "Appointments",
    routes: ["/appointments"],
    where: "Left menu, Appointments.",
    keywords: ["appointment", "appointments", "book appointment", "book a meeting", "meeting", "meetings", "parent teacher meeting", "ptm", "book meeting", "meet teacher", "cancel appointment", "virtual meeting"],
    summary: "Book a meeting with your child's teacher, or manage meetings you already booked.",
    howTo: [
      "Open Appointments from the left menu.",
      "Choose your Child, then the Teacher.",
      "Pick one of the Available slots (the next 14 days).",
      "Write a Reason, and add Notes if there is anything specific to discuss.",
      "Choose the Meeting mode: In person or Virtual. For virtual you may add a meeting link, or the teacher can add it when confirming.",
      "Send the request. It says Appointment requested, waiting for teacher confirmation.",
    ],
    notes: [
      "The teacher either confirms or declines your request, and if they decline, the reason is shown to you.",
      "If a teacher books a meeting with you, you can Confirm it or Decline it. When you decline you may add a reason, and the teacher sees it.",
      "You can Cancel a meeting you booked.",
      "If someone else just took that slot, it asks you to pick another.",
    ],
  },
  {
    id: "surveys",
    name: "Surveys",
    routes: ["/surveys"],
    where: "Left menu, Surveys.",
    keywords: ["survey", "surveys", "feedback", "feedback survey", "questionnaire", "to respond", "school survey"],
    summary: "Feedback surveys from the school that are waiting for your answer.",
    notes: ["On a survey marked anonymous, the school cannot see who answered."],
  },
  {
    id: "safeguarding",
    name: "Safeguarding",
    routes: ["/parent/safeguarding"],
    where: "Left menu, Safeguarding.",
    keywords: ["safeguarding", "safeguard", "child safety", "child protection", "safeguarding report", "safeguarding reports", "report concern", "safeguarding concern", "incident", "incident reports"],
    summary:
      "Shows any safeguarding reports the school has filed about your child. You only ever see reports about your own child.",
    notes: [
      "If nothing has been filed it says No reports on file. Nothing has been filed about your child.",
      "For any concern, contact the school directly.",
    ],
  },
  {
    id: "settings",
    name: "Settings",
    routes: ["/settings"],
    where: "Left menu, Settings, or your account menu at the top.",
    keywords: ["settings", "setting", "preferences", "account settings", "my account", "my profile", "language", "change password", "edit my details"],
    summary: "Your own profile, preferences and account settings. Press Edit to change a section and Save to keep it.",
  },

  // ───────────────────────────── Around the app ─────────────────────────────
  {
    id: "global-search",
    name: "Search",
    where: "The search box at the top of every page. The keyboard shortcut is Ctrl and K.",
    keywords: ["search", "search box", "global search", "ctrl k", "find something", "look something up"],
    summary: "Looks things up across APAS. You only see things you are allowed to open.",
    howTo: ["Click the search box at the top, or press Ctrl and K.", "Type what you are looking for and pick a result."],
  },
  {
    id: "ask-apas",
    name: "Ask APAS (command bar)",
    where: "The Ask APAS button at the top of every page. The keyboard shortcut is Ctrl and J.",
    keywords: ["ask apas", "command bar", "ai command bar", "ctrl j", "quick command", "type a command"],
    summary:
      "A quick way to get around and check things by typing a normal sentence, like Open my child's report card. It can open pages, show your child's attendance this month, and show or clear your unread notifications.",
    howTo: ["Press Ask APAS, or press Ctrl and J.", "Type a sentence such as Show my attendance this month, then press Enter."],
    notes: ["It only opens pages and shows your own information. If it needs to change something it asks you to confirm first."],
  },
  {
    id: "header-tools",
    name: "Notifications and the Help button",
    where: "The top bar of every page.",
    keywords: ["notifications", "notification", "bell", "help button", "guided tour", "take the tour", "tour", "alerts"],
    summary:
      "The bell shows new messages, alerts and updates from the school, with a red number for the ones you have not read. The help button replays the guided tour of the app.",
  },
  {
    id: "apas-agent",
    name: "APAS Agent",
    where: "The round assistant button at the bottom corner of your pages. You can type, or use the microphone to talk to it.",
    keywords: ["apas agent", "agent", "voice mode", "voice assistant", "what can you do", "what can you help", "video mode", "find a video", "text mode", "talk to you"],
    summary:
      "That is me. I can answer questions about your child's fees, bus and transport, report card, attendance, appointments, the school calendar, hall tickets, surveys, safeguarding updates and messages. I can explain a school topic so you can help your child, and I can open a page for you if you say, for example, open Attendance.",
  },
];

// ───────────────────────────── helpers ─────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const norm = (s: string) =>
  (s ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** True when `phrase` appears in `text` as whole words (a trailing s / es is allowed: "survey" matches "surveys"). */
function hasPhrase(text: string, phrase: string): boolean {
  const p = norm(phrase);
  if (!p) return false;
  return new RegExp(`(^| )${escapeRe(p)}(s|es)?( |$)`).test(text);
}

/** Edit distance (a swap of neighbouring letters counts as one), used only to forgive a one-letter slip. */
function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  return dp[a.length][b.length];
}

/** Like hasPhrase, but each word of 5+ letters may have one wrong, missing or extra letter (typing and speech slips). */
function hasPhraseLoosely(text: string, phrase: string): boolean {
  const pw = norm(phrase).split(" ").filter(Boolean);
  if (!pw.some((w) => w.length >= 5)) return false;
  const tw = text.split(" ");
  outer: for (let i = 0; i + pw.length <= tw.length; i++) {
    for (let j = 0; j < pw.length; j++) {
      const a = pw[j], b = tw[i + j];
      if (a === b) continue;
      if (a.length >= 5 && b.length >= 5 && lev(a, b) <= 1) continue;
      continue outer;
    }
    return true;
  }
  return false;
}

function scoreFeature(f: ParentFeature, text: string): number {
  if (!text) return 0;
  let score = 0;
  const base = f.name.replace(/\s*\(.*\)\s*$/, "");
  if (hasPhrase(text, base)) score += 4;
  else if (hasPhraseLoosely(text, base)) score += 2;
  for (const k of f.keywords) {
    const weight = k.includes(" ") ? 3 : 2;
    if (hasPhrase(text, k)) score += weight;
    else if (hasPhraseLoosely(text, k)) score += weight - 1;
  }
  return score;
}

/** Does this written entry already describe that menu row? (same page, or the same name) */
function covers(f: ParentFeature, row: { path: string; name: string }): boolean {
  if (f.routes?.includes(row.path)) return true;
  return norm(f.name.replace(/\s*\(.*\)\s*$/, "")) === norm(row.name);
}

/** The rows the parent's sidebar shows. Same rule as isNavItemAllowedForRole() in AppSidebar.tsx, for "parent". */
export function parentMenuRows(
  nav: GeneratedNavRow[] = GENERATED_NAV,
  modules: string[] = GENERATED_PARENT_MODULES,
): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  const seen = new Set<string>();
  const add = (name: string, path: string) => {
    const k = `${path}|${norm(name)}`;
    if (!seen.has(k)) { seen.add(k); out.push({ name, path }); }
  };
  for (const it of nav) {
    if (it.roles && !it.roles.includes("parent")) continue;
    if (it.module && !modules.includes(it.module)) continue;
    add(it.title, it.path);
    if (it.subItem) add(it.subItem.title, it.subItem.path);
  }
  return out;
}

/** Menu rows with no written entry: the assistant still knows them by name and place. */
export function uncuratedParentRows(
  nav: GeneratedNavRow[] = GENERATED_NAV,
  modules: string[] = GENERATED_PARENT_MODULES,
): { name: string; path: string }[] {
  return parentMenuRows(nav, modules).filter((r) => !PARENT_FEATURES.some((f) => covers(f, r)));
}

/** Everything the assistant knows: the written entries, plus an automatic one for every other parent menu page. */
export function allParentFeatures(
  nav: GeneratedNavRow[] = GENERATED_NAV,
  modules: string[] = GENERATED_PARENT_MODULES,
): ParentFeature[] {
  const auto: ParentFeature[] = uncuratedParentRows(nav, modules).map((r) => ({
    id: `auto-${norm(r.name).replace(/ /g, "-")}`,
    name: r.name,
    routes: [r.path],
    where: `Left menu, ${r.name}.`,
    keywords: [r.name],
    summary: `A page in your left menu called ${r.name}. Its full details are not in my notes yet.`,
    auto: true,
  }));
  return [...PARENT_FEATURES, ...auto];
}

/** Which features is this message (and, for short follow-ups like "how do I use it?", the last couple of turns) about? */
export function selectParentFeatures(
  message: string,
  history: { role: string; text: string }[] = [],
  max = 3,
  features: ParentFeature[] = allParentFeatures(),
): ParentFeature[] {
  const now = norm(message);
  const recent = (history || []).slice(-2).map((h) => norm(h?.text ?? "")).join(" ");
  return features
    .map((f) => ({ f, s: scoreFeature(f, now) * 3 + scoreFeature(f, recent) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.f);
}

/** One line per feature: the whole parent app on a page, so the assistant always knows what exists. */
export function parentFeatureIndex(features: ParentFeature[] = allParentFeatures()): string {
  return features
    .map((f) => (f.auto ? `- ${f.name}: a page in your left menu (details not written yet).` : `- ${f.name}: ${f.summary.split(". ")[0].replace(/\.$/, "")}.`))
    .join("\n");
}

/** The full explanation of one feature, as plain text for the prompt. */
export function describeParentFeature(f: ParentFeature): string {
  const lines = [`${f.name}`, `Where: ${f.where}`, `What it is: ${f.summary}`];
  if (f.howTo?.length) lines.push(`How to use it: ${f.howTo.map((s, i) => `(${i + 1}) ${s}`).join(" ")}`);
  if (f.notes?.length) lines.push(`Good to know: ${f.notes.join(" ")}`);
  return lines.join("\n");
}

/** The prompt section that teaches the assistant the parent app: every feature listed, full detail for the ones asked about. */
export function buildParentFeatureGuidePrompt(
  message: string,
  history: { role: string; text: string }[] = [],
  features: ParentFeature[] = allParentFeatures(),
): string {
  const focus = selectParentFeatures(message, history, 3, features);
  const detail = focus.length
    ? `\n\nFULL DETAILS for what the parent seems to be asking about:\n${focus.map(describeParentFeature).join("\n\n")}`
    : "";
  return `APP FEATURE GUIDE (everything a parent can open or use in APAS; this is your knowledge of the app itself):\n${parentFeatureIndex(features)}${detail}`;
}
