// Guided tour definitions, one list per tour role.
//
// Every step points at something that already exists in the app:
//   - a sidebar item, found by its route:   nav("/attendance")  ->  [data-tour-nav="/attendance"]
//   - a header control or dashboard block tagged with data-tour="..."
// Steps are NOT hard-coded to what a role "should" see. When the tour starts, any step whose target is not on
// screen is dropped (see resolveSteps). Sidebar items are already filtered by role and by the school's
// permission matrix, so a feature the user may not access is never highlighted or described.

export interface TourStep {
  id: string;
  /** CSS selector of the element to highlight. Omit for a centered card (welcome / finish). */
  target?: string;
  title: string;
  description: string;
}

export type TourRole = "student" | "teacher" | "parent" | "school_admin" | "platform_admin";

/** Which tour a profile role gets. null = no tour (hod and driver are not covered by this guide). */
export function tourRoleFor(role: string | null | undefined): TourRole | null {
  switch (role) {
    case "student":
      return "student";
    case "teacher":
      return "teacher";
    case "parent":
      return "parent";
    case "admin":
    case "principal":
    case "school_admin":
      return "school_admin";
    case "knsoft_admin":
      return "platform_admin";
    default:
      return null;
  }
}

export const isNavSelector = (selector?: string) => !!selector && selector.includes("data-tour-nav");

const nav = (path: string) => `[data-tour-nav="${path}"]`;
const tag = (name: string) => `[data-tour="${name}"]`;

// Shared by every role, shown near the end of each tour.
const headerSteps: TourStep[] = [
  {
    id: "header-search",
    target: tag("header-search"),
    title: "Search",
    description: "Look things up across APAS from anywhere. You only see results you are allowed to access.",
  },
  {
    id: "header-bell",
    target: tag("header-bell"),
    title: "Notifications",
    description: "New messages, alerts and updates show up here. The red badge counts what you have not read yet.",
  },
  {
    id: "header-profile",
    target: tag("header-profile"),
    title: "Your account",
    description: "Open your profile or settings, or log out, from this menu.",
  },
  {
    id: "header-help",
    target: tag("header-help"),
    title: "Take the tour again",
    description: "Press this help button whenever you want to replay this guide.",
  },
];

const settingsStep: TourStep = {
  id: "nav-settings",
  target: nav("/settings"),
  title: "Settings",
  description: "Manage your profile, preferences and account settings.",
};

const finish = (description: string): TourStep => ({
  id: "finish",
  title: "You are all set",
  description,
});

const REPLAY = "You can replay this tour any time from the help button at the top of the screen.";

const STUDENT: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to APAS",
    description: "Here is a quick look at where everything is. It takes about a minute, and you can skip it at any time.",
  },
  {
    id: "dashboard-hero",
    target: tag("dashboard-hero"),
    title: "Your home page",
    description: "Your dashboard opens with a summary of your learning, so you can see where you stand at a glance.",
  },
  {
    id: "nav-diagnostic",
    target: nav("/diagnostic"),
    title: "Assessments",
    description: "Take assessments here to find your strengths and the areas that need more attention.",
  },
  {
    id: "nav-academic-tests",
    target: nav("/academic-tests"),
    title: "Academic Tests",
    description: "Subject-based tests and academic evaluations from your teachers.",
  },
  {
    id: "nav-homework",
    target: nav("/dashboard"),
    title: "Homework",
    description: "Homework assigned to you by your teachers, with its status.",
  },
  {
    id: "nav-worksheets",
    target: nav("/worksheets"),
    title: "Worksheets",
    description: "Worksheets assigned to you appear here, ready to complete and submit.",
  },
  {
    id: "nav-ai-tutor",
    target: nav("/ai-tutor"),
    title: "AI Tutor",
    description: "Ask questions and get help with your subjects from the AI Tutor.",
  },
  {
    id: "nav-gamification",
    target: nav("/gamification"),
    title: "Gamification",
    description: "Play learning games, earn rewards and stay motivated.",
  },
  {
    id: "nav-attendance",
    target: nav("/attendance"),
    title: "Attendance",
    description: "Check your attendance record.",
  },
  {
    id: "nav-communication",
    target: nav("/student-communication"),
    title: "Communication",
    description: "Messages from your teachers and your school arrive here.",
  },
  ...headerSteps,
  settingsStep,
  finish(REPLAY),
];

const TEACHER: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to APAS",
    description: "Here is a quick look at the tools you use most. It takes about a minute, and you can skip it at any time.",
  },
  {
    id: "dashboard-hero",
    target: tag("dashboard-hero"),
    title: "Your home page",
    description: "Your dashboard gives you a summary of your classes and quick shortcuts.",
  },
  {
    id: "dashboard-stats",
    target: tag("dashboard-stats"),
    title: "At a glance",
    description: "Key numbers for your teaching at a glance.",
  },
  {
    id: "nav-workspace",
    target: nav("/teacher-workspace"),
    title: "Dashboard",
    description: "Your teacher workspace, with today's classes and the work that needs your attention.",
  },
  {
    id: "nav-curative",
    target: nav("/curative"),
    title: "Lesson Plan Generator",
    description: "Build lesson plans for your classes with AI assistance.",
  },
  {
    id: "nav-teacher-reports",
    target: nav("/teacher"),
    title: "Reports",
    description: "Student and class performance reports.",
  },
  {
    id: "nav-analytics",
    target: nav("/analytics"),
    title: "Analytics",
    description: "Learning analytics and insights for your classes.",
  },
  {
    id: "nav-attendance",
    target: nav("/attendance"),
    title: "Attendance",
    description: "Mark and review attendance for your classes.",
  },
  {
    id: "nav-timetable",
    target: nav("/timetable"),
    title: "Timetable",
    description: "Your teaching schedule.",
  },
  {
    id: "nav-at-risk",
    target: nav("/teacher-at-risk"),
    title: "At-Risk Students",
    description: "Students who may need extra support.",
  },
  {
    id: "nav-communication",
    target: nav("/teacher-communication"),
    title: "Communication",
    description: "Message students and parents, one to one or to a whole class.",
  },
  {
    id: "nav-requests",
    target: nav("/requests"),
    title: "Requests",
    description: "Submit requests to your school admin and track their status.",
  },
  {
    id: "nav-report-cards",
    target: nav("/report-cards"),
    title: "Report Cards",
    description: "Prepare and review report cards.",
  },
  ...headerSteps,
  settingsStep,
  finish(REPLAY),
];

const PARENT: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to APAS",
    description: "Here is a quick look at how to follow your child's progress. It takes about a minute, and you can skip it at any time.",
  },
  {
    id: "dashboard-hero",
    target: tag("dashboard-hero"),
    title: "Your home page",
    description: "A summary of your child's learning and school activity.",
  },
  {
    id: "nav-student-profile",
    target: nav("/student-profile"),
    title: "Student Profile",
    description: "Your child's profile and details.",
  },
  {
    id: "nav-academic-tests",
    target: nav("/academic-tests"),
    title: "Academic Tests",
    description: "Your child's subject tests and results.",
  },
  {
    id: "nav-report-cards",
    target: nav("/report-cards"),
    title: "Report Cards",
    description: "View your child's report cards.",
  },
  {
    id: "nav-attendance",
    target: nav("/attendance"),
    title: "Attendance",
    description: "See your child's attendance record.",
  },
  {
    id: "nav-communication",
    target: nav("/parent-communication"),
    title: "Communication",
    description: "Messages from your child's teachers appear here, and you can reply.",
  },
  {
    id: "nav-appointments",
    target: nav("/appointments"),
    title: "Appointments",
    description: "Book and manage meetings with teachers.",
  },
  {
    id: "nav-calendar",
    target: nav("/academic-calendar"),
    title: "Academic Calendar",
    description: "School events, holidays and exam dates.",
  },
  {
    id: "nav-hall-tickets",
    target: nav("/hall-tickets"),
    title: "Hall Tickets",
    description: "View exam hall tickets.",
  },
  {
    id: "nav-safeguarding",
    target: nav("/parent/safeguarding"),
    title: "Safeguarding",
    description: "Child-protection updates the school shares with you.",
  },
  ...headerSteps,
  settingsStep,
  finish(REPLAY),
];

const SCHOOL_ADMIN: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to APAS",
    description: "Here is a quick look at the school management tools available to you. It takes about a minute, and you can skip it at any time.",
  },
  {
    id: "dashboard-hero",
    target: tag("dashboard-hero"),
    title: "Your home page",
    description: "A school-level summary and shortcuts to the main areas.",
  },
  {
    id: "dashboard-stats",
    target: tag("dashboard-stats"),
    title: "School at a glance",
    description: "Key numbers for your school, such as classes, students, teachers and active alerts.",
  },
  {
    id: "admin-tabs",
    target: tag("admin-tabs"),
    title: "School administration",
    description: "Switch between the overview, user accounts, role permissions and your school's information.",
  },
  {
    id: "nav-super-admin",
    target: nav("/super-admin"),
    title: "School Admin",
    description: "Create accounts, set what each role can access, and manage school details.",
  },
  {
    id: "nav-admin-panel",
    target: nav("/admin"),
    title: "Admin Panel",
    description: "Manage the school's classes, teachers and students.",
  },
  {
    id: "nav-reports",
    target: nav("/teacher"),
    title: "Reports",
    description: "Student and class performance reports across the school.",
  },
  {
    id: "nav-executive",
    target: nav("/executive-reporting"),
    title: "Analytics",
    description: "Executive reports and analytics for the school.",
  },
  {
    id: "nav-attendance",
    target: nav("/attendance"),
    title: "Attendance",
    description: "Review attendance across the school.",
  },
  {
    id: "nav-timetable",
    target: nav("/timetable"),
    title: "Timetable",
    description: "The school timetable.",
  },
  {
    id: "nav-calendar",
    target: nav("/academic-calendar"),
    title: "Academic Calendar",
    description: "School events, holidays and exam dates.",
  },
  {
    id: "nav-admissions",
    target: nav("/admissions"),
    title: "Admissions",
    description: "Manage admission intakes and applicants.",
  },
  {
    id: "nav-transport",
    target: nav("/transport"),
    title: "Transport",
    description: "Manage buses, routes and live tracking.",
  },
  {
    id: "nav-safeguarding",
    target: nav("/safeguarding"),
    title: "Safeguarding",
    description: "Review safeguarding and child-protection incident reports.",
  },
  {
    id: "nav-communication",
    target: nav("/admin-communication"),
    title: "Communication",
    description: "Message teachers, parents and students.",
  },
  {
    id: "nav-alerts",
    target: nav("/alerts"),
    title: "Alerts",
    description: "Alerts that need your attention.",
  },
  ...headerSteps,
  settingsStep,
  finish(REPLAY),
];

const PLATFORM_ADMIN: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to APAS",
    description: "Here is a quick look at the platform administration tools. It takes about a minute, and you can skip it at any time.",
  },
  {
    id: "platform-tabs",
    target: tag("platform-tabs"),
    title: "Platform overview",
    description: "Switch between the platform overview, schools, school-admin assignment and billing.",
  },
  {
    id: "nav-platform",
    target: nav("/knsoft-admin"),
    title: "Platform Admin",
    description: "Your main console: schools on the platform and who administers them.",
  },
  {
    id: "nav-billing",
    target: nav("/billing-dashboard"),
    title: "Billing",
    description: "Subscriptions and billing across schools.",
  },
  {
    id: "nav-security",
    target: nav("/security-dashboard"),
    title: "Security",
    description: "Security monitoring for the platform.",
  },
  {
    id: "nav-ai-cost",
    target: nav("/ai-cost-monitoring"),
    title: "AI Cost Monitor",
    description: "Track AI usage and its cost.",
  },
  {
    id: "nav-notifications",
    target: nav("/notification-dashboard"),
    title: "Notifications",
    description: "Platform notifications and delivery.",
  },
  {
    id: "nav-automations",
    target: nav("/automation-dashboard"),
    title: "Automations",
    description: "Automated jobs that run on the platform.",
  },
  {
    id: "nav-multi-tenant",
    target: nav("/multi-tenant"),
    title: "Multi-Tenant",
    description: "Manage how schools are separated and configured on the platform.",
  },
  ...headerSteps,
  settingsStep,
  finish(REPLAY),
];

export const TOUR_BY_ROLE: Record<TourRole, TourStep[]> = {
  student: STUDENT,
  teacher: TEACHER,
  parent: PARENT,
  school_admin: SCHOOL_ADMIN,
  platform_admin: PLATFORM_ADMIN,
};

export function getTourSteps(role: TourRole): TourStep[] {
  return TOUR_BY_ROLE[role];
}

/**
 * Keep only the steps whose target is on screen right now (centered steps always stay). A target that exists in
 * the page but is hidden (display: none, e.g. a control that is desktop-only) has no size and is dropped too.
 * Sidebar items count as on screen even when the phone drawer is closed: the drawer is laid out, just slid off.
 */
export function resolveSteps(steps: TourStep[], root: ParentNode = document): TourStep[] {
  const laidOut = (selector: string) =>
    Array.from(root.querySelectorAll<HTMLElement>(selector)).some((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  return steps.filter((s) => !s.target || laidOut(s.target));
}
