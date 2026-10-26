// "Help with This Page" content.
//
// Rules this file follows (and src/test/pageHelp.test.ts enforces):
//   - An entry is keyed by the real route path from App.tsx and lists the PROFILE roles (the same strings the
//     <RoleGuard allowedRoles> uses) that the page is written for. A role the router would redirect away is never listed.
//   - Every control/section label an entry names must appear as literal text in one of the entry's `sources` files,
//     so help can never describe a button or tab that does not exist.
//   - Only a few sentences of plain description are written by hand. Anything not covered here is NOT guessed:
//     the panel falls back to a generic card plus a live list of the controls actually on screen.
//   - No data lives here: no user, school or student information, no keys. It is static text shipped with the app.

import { ALL_SCHOOL_ROLES, btn, tab, sec } from "./helpTypes";
import type { PageHelpEntry } from "./helpTypes";
import { DETAILED_PAGE_HELP } from "./pageHelpDetails";

export type { HelpRole, HelpControl, HelpTask, HelpProblem, HelpNext, PageHelpEntry } from "./helpTypes";

const STUDENT_HOME: Omit<PageHelpEntry, "route"> = {
  roles: ["student"],
  name: "Home",
  purpose: "Your learning summary: the diagnostic assessment you can take, your assessment results, and your pending homework.",
  controls: [
    sec("Write Your Diagnostic Assessment", "A card that takes you to your assessment."),
    btn("Start Assessment", "Opens the Assessments page (/diagnostic)."),
    sec("Your Assessment Results", "Your results once you have finished an assessment."),
    sec("Homework Overview", "A summary of your homework."),
    btn("View All", "Opens the full homework list from the Pending Homework card."),
  ],
  tasks: [
    {
      title: "Start your diagnostic assessment",
      steps: [
        "Find the card called Write Your Diagnostic Assessment.",
        "Press Start Assessment. You are taken to the Assessments page.",
      ],
    },
  ],
  sources: ["src/pages/StudentDashboard.tsx"],
};

const BASIC_PAGE_HELP: PageHelpEntry[] = [
  // ───────── Student ─────────
  { route: "/student-dashboard", ...STUDENT_HOME },
  { route: "/dashboard", ...STUDENT_HOME },
  {
    route: "/diagnostic",
    roles: ["student"],
    name: "Assessments",
    purpose: "Take your assessment and see your assessment results.",
    controls: [
      btn("Start Assessment", "Begins the assessment."),
      btn("Next", "Moves to the next question."),
      btn("Submit Assessment", "Sends in your answers when you have finished."),
    ],
    tasks: [
      {
        title: "Take an assessment",
        steps: [
          "Press Start Assessment.",
          "Answer each question, then press Next to move on.",
          "On the last question press Submit Assessment.",
        ],
      },
    ],
    sources: ["src/pages/Diagnostic.tsx"],
  },
  {
    route: "/academic-tests",
    roles: ["student"],
    name: "Academic Tests",
    purpose: "Practise with a subject test for your class. APAS prepares the test when you start it.",
    controls: [
      btn("Generate & Start Test", "Prepares a test from the options you chose and starts it."),
      btn("Confirm Answer", "Locks in your answer to the current question."),
      btn("Take Another Test", "Starts a new test after you finish one."),
      btn("Back to Tests", "Returns to the test setup screen."),
    ],
    tasks: [
      {
        title: "Take a test",
        steps: [
          "Choose your class (a section and a topic are optional where the page offers them).",
          "Press Generate & Start Test.",
          "Answer the question, then press Confirm Answer.",
          "When you finish, press Take Another Test or Back to Tests.",
        ],
      },
    ],
    sources: ["src/pages/AcademicTests.tsx"],
  },
  {
    route: "/worksheets",
    roles: ["student"],
    name: "Worksheets",
    purpose: "Open the worksheets prepared for you and write your answers.",
    controls: [sec("Worksheets", "The list of your worksheets.")],
    sources: ["src/pages/Worksheets.tsx"],
  },
  {
    route: "/ai-tutor",
    roles: ["student"],
    name: "AI Tutor",
    purpose: "Chat with the AI study companion about a subject and chapter. You can change how it teaches and the language it uses.",
    controls: [
      btn("Clear chat", "Empties the current conversation."),
      btn("Enrichment", "Opens the enrichment page for extra challenge material."),
      btn("New problem", "Starts a fresh problem when you are working with hints."),
    ],
    tasks: [
      {
        title: "Ask the tutor a question",
        steps: [
          "Choose a subject, then choose a chapter.",
          "Type your question in the chat box and send it.",
          "Use the Teaching style and Tutor language choices if you want it explained differently.",
        ],
      },
    ],
    sources: ["src/pages/AITutor.tsx"],
  },
  {
    route: "/gamification",
    roles: ["student"],
    name: "Gamification",
    purpose: "Play adaptive practice rounds and see your results at the end.",
    controls: [
      btn("Ready? Let's Go!", "Starts a round."),
      sec("Adaptive Round", "The question screen while you play."),
      sec("Final Results", "Your score when the round ends."),
    ],
    sources: ["src/pages/Gamification.tsx"],
  },
  {
    route: "/leaderboard",
    roles: ["student"],
    name: "Leaderboard",
    purpose: "See how students rank.",
    controls: [tab("Global Ranking", "Ranking across students."), tab("Class Ranking", "Ranking within your class.")],
    sources: ["src/pages/Leaderboard.tsx"],
  },
  {
    route: "/student-profile",
    roles: ["student", "parent"],
    name: "Student Profile",
    purpose: "A single page that brings together the student's profile.",
    controls: [sec("My 360° Profile", "The profile overview.")],
    sources: ["src/pages/StudentProfile360.tsx"],
  },

  // ───────── Shared by several roles ─────────
  {
    route: "/dashboard",
    roles: ["teacher"],
    name: "Home",
    purpose: "Your starting page with shortcut cards to the main teaching tools.",
    controls: [
      sec("Student Reports", "A card that opens student reports."),
      sec("AI Lesson Plan Generator", "A card that opens the lesson plan generator."),
      sec("Analytics & Insights", "A card that opens analytics."),
    ],
    sources: ["src/pages/Dashboard.tsx"],
  },
  {
    route: "/dashboard",
    roles: ["admin", "principal", "school_admin"],
    name: "Home",
    purpose: "Your starting page with shortcut cards for overseeing the school.",
    controls: [
      sec("Student Reports", "A card that opens student reports."),
      sec("Real-time Alerts", "A card that opens alerts."),
      sec("Master User Panel", "A card that opens the Admin Panel."),
      sec("Setup Classes", "Step in the admin workflow shown on the page."),
      sec("Assign Teachers", "Step in the admin workflow shown on the page."),
      sec("Monitor Reports", "Step in the admin workflow shown on the page."),
      sec("Manage Alerts", "Step in the admin workflow shown on the page."),
    ],
    sources: ["src/pages/Dashboard.tsx"],
  },
  {
    route: "/attendance",
    roles: ["student", "parent"],
    name: "Attendance",
    purpose: "See attendance records.",
    controls: [tab("My Attendance", "Your own attendance record.")],
    tasks: [
      {
        title: "Check attendance",
        steps: [
          "Parents: choose your child where it says Select child.",
          "Students: open the My Attendance tab.",
        ],
      },
    ],
    sources: ["src/pages/AttendanceMarking.tsx"],
  },
  {
    route: "/attendance",
    roles: ["teacher", "admin", "principal"],
    name: "Attendance",
    purpose: "Mark student attendance for a class and look back at attendance records. The tabs you see depend on your role.",
    controls: [
      tab("Student Attendance", "Where you mark a class."),
      tab("Attendance View", "Where you review saved attendance."),
      btn("Mark all present", "Marks every student present so you only change the absentees."),
      btn("Save Attendance", "Saves what you marked."),
    ],
    tasks: [
      {
        title: "Mark attendance",
        steps: [
          "Open the Student Attendance tab.",
          "Choose the class (and the period if it is shown).",
          "Press Mark all present if that saves you time, then change any student who was absent.",
          "Press Save Attendance.",
        ],
      },
    ],
    sources: ["src/pages/AttendanceMarking.tsx"],
  },
  {
    route: "/academic-calendar",
    roles: ALL_SCHOOL_ROLES,
    name: "Academic Calendar",
    purpose: "See school events and holidays by date.",
    controls: [btn("Add Event", "Adds an event. It is only shown to roles that can edit the calendar.")],
    sources: ["src/pages/AcademicCalendar.tsx"],
  },
  {
    route: "/timetable",
    roles: ["student", "teacher", "admin", "principal", "school_admin"],
    name: "Timetable",
    purpose: "See your timetable. Roles that manage timetables see extra management sections.",
    controls: [
      sec("My Timetable", "Your own timetable."),
      sec("Timetable Overview", "An overview of timetables."),
      btn("Upload Class Timetable", "Uploads a class timetable. Shown to roles that manage timetables."),
      btn("Upload Teacher Timetable", "Uploads a teacher timetable. Shown to roles that manage timetables."),
    ],
    sources: ["src/pages/TimetablePage.tsx"],
  },
  {
    route: "/report-cards",
    roles: ALL_SCHOOL_ROLES,
    name: "Report Cards",
    purpose: "View report cards you are allowed to see.",
    controls: [sec("Report Cards", "The report card list.")],
    sources: ["src/pages/ReportCards.tsx"],
  },
  {
    route: "/alerts",
    roles: ["student", "teacher", "parent", "admin", "principal"],
    name: "Alerts",
    purpose: "Read your alerts. Roles that manage alerts also get tools for resolving and exporting them.",
    controls: [
      btn("Mark All Read", "Marks every alert as read."),
      btn("Bulk Resolve", "Resolves several alerts at once. Shown to roles that manage alerts."),
      btn("Export CSV", "Downloads the alerts as a spreadsheet file. Shown to roles that manage alerts."),
    ],
    sources: ["src/pages/Alerts.tsx"],
  },
  {
    route: "/notifications",
    roles: ALL_SCHOOL_ROLES.concat("knsoft_admin"),
    name: "Notifications",
    purpose: "Your full notification inbox, the same notifications as the bell in the header.",
    controls: [
      btn("Mark all as read", "Marks every notification as read."),
      btn("Clear filters", "Removes the filters and search so you see everything again."),
    ],
    sources: ["src/pages/NotificationInbox.tsx"],
  },
  {
    route: "/requests",
    roles: ["student", "teacher", "parent", "admin", "principal"],
    name: "Requests",
    purpose: "Send and follow diagnostic requests.",
    controls: [sec("Diagnostic Requests", "The requests list.")],
    sources: ["src/pages/Requests.tsx"],
  },
  {
    route: "/surveys",
    roles: ["student", "teacher", "parent", "admin", "principal", "school_admin"],
    name: "Surveys",
    purpose: "Answer surveys. Roles that create surveys can add questions.",
    controls: [btn("Add Question", "Adds a question while creating a survey.")],
    sources: ["src/pages/Surveys.tsx"],
  },
  {
    route: "/settings",
    roles: ["student", "teacher", "parent", "admin", "principal", "school_admin", "knsoft_admin"],
    name: "Settings",
    purpose: "Manage your profile and preferences.",
    controls: [btn("Edit", "Lets you change a section."), btn("Save", "Saves your changes.")],
    sources: ["src/pages/Settings.tsx"],
  },
  {
    route: "/hall-tickets",
    roles: ["student", "parent", "admin", "principal", "school_admin"],
    name: "Hall Tickets",
    purpose: "View hall tickets. School admins can generate them.",
    controls: [btn("Generate All Tickets", "Creates tickets for everyone. Shown to school staff who manage exams.")],
    sources: ["src/pages/HallTicketEngine.tsx"],
  },

  // ───────── Teacher ─────────
  {
    route: "/teacher-workspace",
    roles: ["teacher"],
    name: "Dashboard",
    purpose: "Your teaching dashboard: recommendations, students needing attention, recent submissions and upcoming events.",
    controls: [
      sec("AI Recommendations", "Suggestions for your classes."),
      sec("At-Risk Students", "Students who may need support."),
      sec("Behaviour Alerts", "Recent behaviour alerts."),
      sec("Recent Submissions", "Work students recently handed in."),
      sec("Upcoming Events", "What is coming up."),
      btn("Generate Lesson", "Shortcut for creating a lesson."),
      btn("Calendar", "Shortcut to the calendar."),
      btn("View AI Suggestions", "Shows the AI suggestions."),
    ],
    sources: ["src/pages/TeacherWorkspaceDashboard.tsx"],
  },
  {
    route: "/curative",
    roles: ["teacher"],
    name: "Lesson Plan Generator",
    purpose: "Create lesson plans with the AI Teaching Assistant, then assign homework or worksheets and find your saved lessons.",
    controls: [
      tab("Lesson Plan", "Create a lesson plan."),
      tab("Assign Homework", "Give homework to a class."),
      tab("Worksheets", "Prepare worksheets."),
      tab("My Lessons", "Your saved lesson plans."),
      btn("Download PDF", "Saves a lesson plan as a PDF."),
      btn("New Chat", "Starts a new conversation with the AI Teaching Assistant."),
    ],
    tasks: [
      {
        title: "Find a lesson you made earlier",
        steps: ["Open the My Lessons tab.", "Pick the lesson; use Download PDF if you want a copy."],
      },
    ],
    sources: ["src/pages/Curative.tsx"],
  },
  {
    route: "/teacher",
    roles: ["teacher", "admin", "principal", "school_admin"],
    name: "Reports",
    purpose: "Student reports and class reports from assessments.",
    controls: [
      tab("Student Reports", "Reports for individual students."),
      tab("Class Reports", "Reports for a whole class."),
      btn("Download Report", "Downloads the report you are viewing."),
    ],
    tasks: [
      {
        title: "Download a class report",
        steps: [
          "Open the Class Reports tab.",
          "Choose a class when the page says Select a Class.",
          "Press Download Report.",
        ],
      },
    ],
    sources: ["src/pages/TeacherPanel.tsx"],
  },
  {
    route: "/analytics",
    roles: ["teacher", "admin", "principal", "school_admin"],
    name: "Analytics",
    purpose: "Learning Analytics & Insights for your classes.",
    controls: [
      sec("AI Suggestions for the Class", "AI advice for the selected class."),
      sec("Average Score by Assignment", "Chart of scores per assignment."),
      sec("Score Distribution", "How scores are spread."),
      sec("Homework Completion", "How much homework is completed."),
      sec("Weekly Improvement", "Change over the weeks."),
      btn("Submissions", "Opens submissions."),
    ],
    sources: ["src/pages/Analytics.tsx"],
  },
  {
    route: "/submissions",
    roles: ["teacher", "admin", "principal"],
    name: "Worksheet Submissions",
    purpose: "Review the answers students submitted on worksheets.",
    controls: [
      btn("AI Review All Pending", "Asks the AI to review every pending submission."),
      btn("Download Report", "Downloads a report."),
    ],
    sources: ["src/pages/Submissions.tsx"],
  },
  {
    route: "/entry-ticket",
    roles: ["teacher"],
    name: "Entry Ticket",
    purpose: "Create entry tickets for a lesson and review how students improved.",
    controls: [
      sec("Create Entry Ticket", "Where you set up a ticket."),
      sec("Past Ticket Sessions", "Your earlier sessions."),
      sec("Normalized Gain Results", "How much students improved."),
    ],
    sources: ["src/pages/EntryTicket.tsx"],
  },
  {
    route: "/assessment-evaluation",
    roles: ["teacher", "admin", "principal", "school_admin"],
    name: "Assessment Evaluation",
    purpose: "Upload assessments and review them. Tabs separate what is pending from what is reviewed.",
    controls: [
      btn("Upload Assessment", "Adds an assessment for evaluation."),
      tab("Pending", "Assessments waiting for review."),
      tab("AI Reviewed", "Assessments the AI has reviewed."),
      tab("Reviewed", "Assessments that are finished."),
      tab("All", "Everything together."),
    ],
    sources: ["src/pages/AssessmentEvaluation.tsx"],
  },

  // ───────── Parent ─────────
  {
    route: "/parent-dashboard",
    roles: ["parent"],
    name: "Home",
    purpose: "Follow your child's progress: test scores, homework, pickup guardians and, where available, bus tracking.",
    controls: [
      tab("Test Scores", "Your child's test results."),
      tab("Homework", "Your child's homework status."),
      tab("Pickup Guardians", "People allowed to collect your child."),
      tab("Bus Tracking", "Where the school bus is. Shown only when transport applies."),
    ],
    tasks: [{ title: "Check homework", steps: ["Open the Homework tab."] }],
    sources: ["src/pages/ParentDashboard.tsx"],
  },
  {
    route: "/parent/fee-payment",
    roles: ["parent"],
    name: "Fee Payment",
    purpose: "See your child's fee details.",
    controls: [sec("Student Information", "Which student the fees are for."), sec("Fee Particulars", "The fee items.")],
    sources: ["src/pages/ParentFeePayment.tsx"],
  },
  {
    route: "/appointments",
    roles: ["parent"],
    name: "Appointments",
    purpose: "Book and manage appointments with school staff.",
    controls: [btn("Cancel", "Cancels an appointment you booked.")],
    sources: ["src/pages/AppointmentBooking.tsx"],
  },

  // ───────── School admin / principal ─────────
  {
    route: "/admin",
    roles: ["admin", "principal", "school_admin"],
    name: "Admin Panel",
    purpose: "Master User Panel for setting up classes and people and reviewing school-wide settings.",
    controls: [
      tab("Classes", "Create and manage classes."),
      tab("Students", "Student allotment."),
      tab("Teachers", "Teacher-to-class assignment."),
      tab("Approvals", "Items waiting for approval."),
      tab("Questions", "Diagnostic question allotment."),
      tab("Config", "Diagnostic configuration."),
      btn("New Class", "Starts creating a class."),
      btn("Create Class", "Saves the new class."),
    ],
    tasks: [
      {
        title: "Create a class",
        steps: ["Open the Classes tab.", "Press New Class.", "Fill in the details and press Create Class."],
      },
    ],
    sources: ["src/pages/AdminPanel.tsx"],
  },
  {
    route: "/super-admin",
    roles: ["school_admin"],
    name: "School Admin",
    purpose: "Manage your school: stats, user accounts, which roles can open which modules, and school information.",
    controls: [
      tab("Overview", "Quick stats for the school."),
      tab("Accounts", "School accounts."),
      tab("Permissions", "The Role Permission Matrix."),
      tab("School Info", "School information."),
      btn("Create Account", "Creates a user account for your school."),
      btn("Grant ERP Access", "Gives ERP access to a user."),
    ],
    tasks: [{ title: "Create an account", steps: ["Open the Accounts tab.", "Press Create Account and fill in the form."] }],
    sources: ["src/pages/SuperAdminPanel.tsx"],
  },
  {
    route: "/transport",
    roles: ["admin", "principal", "school_admin"],
    name: "Transport",
    purpose: "Manage school transport: vehicles, drivers, attendants, routes, stops and trips.",
    controls: [
      tab("Vehicles", "Your vehicles."),
      tab("Driver & Attendant", "Drivers and attendants."),
      tab("Routes & Stops", "Routes and their stops."),
      btn("Add Vehicle", "Adds a vehicle."),
      btn("Add Driver", "Adds a driver."),
      btn("Add Attendant", "Adds an attendant."),
      btn("Add Route", "Adds a route."),
      btn("Add Stop", "Adds a stop."),
    ],
    tasks: [{ title: "Add a vehicle", steps: ["Open the Vehicles tab.", "Press Add Vehicle and fill in the form."] }],
    sources: ["src/pages/TransportManagement.tsx"],
  },
  {
    route: "/executive-reporting",
    roles: ["school_admin"],
    name: "Analytics",
    purpose: "Executive Reporting for the school.",
    controls: [btn("Refresh", "Reloads the figures.")],
    sources: ["src/pages/ExecutiveReporting.tsx"],
  },

  // ───────── Platform admin ─────────
  {
    route: "/knsoft-admin",
    roles: ["knsoft_admin"],
    name: "Platform Admin",
    purpose: "Manage schools on the platform and who administers them.",
    controls: [
      tab("Overview", "Platform overview."),
      tab("Schools", "All schools."),
      tab("Assign Admins", "Choose who administers a school."),
      tab("Billing", "Subscription overview."),
      btn("Create School", "Adds a school."),
      btn("Assign Admin", "Makes a user the admin of a school."),
    ],
    tasks: [
      { title: "Create a school", steps: ["Open the Schools tab.", "Press Create School and fill in the form."] },
      { title: "Assign a school admin", steps: ["Open the Assign Admins tab.", "Choose the school and user, then press Assign Admin."] },
    ],
    sources: ["src/pages/KNSoftAdminPanel.tsx"],
  },
  {
    route: "/billing-dashboard",
    roles: ["knsoft_admin"],
    name: "Billing",
    purpose: "See school subscriptions and invoice history.",
    controls: [sec("School Subscriptions", "Each school's subscription."), sec("Invoice History", "Past invoices.")],
    sources: ["src/pages/BillingDashboard.tsx"],
  },
  {
    route: "/security-dashboard",
    roles: ["knsoft_admin"],
    name: "Security",
    purpose: "Monitor platform security.",
    controls: [
      sec("Security Alerts", "Security alerts."),
      sec("Login Sessions", "Login sessions."),
      sec("Audit Logs", "Audit logs."),
      sec("Role Permissions Audit", "Role permission changes."),
    ],
    sources: ["src/pages/SecurityDashboard.tsx"],
  },
  {
    route: "/ai-cost-monitoring",
    roles: ["knsoft_admin"],
    name: "AI Cost Monitor",
    purpose: "Track what the platform's AI usage costs.",
    controls: [
      tab("Token Graphs", "Charts of usage."),
      tab("Model Usage", "Usage by AI model."),
      tab("Recent Logs", "Recent AI calls."),
      tab("Model Pricing", "Pricing per model."),
    ],
    sources: ["src/pages/AICostMonitoringDashboard.tsx"],
  },
  {
    route: "/cache-management",
    roles: ["knsoft_admin"],
    name: "Cache Management",
    purpose: "See what the platform has cached.",
    controls: [tab("Analytics", "Cache statistics."), tab("Cache Entries", "Individual cache entries."), btn("Refresh", "Reloads the figures.")],
    sources: ["src/pages/CacheManagementDashboard.tsx"],
  },
  {
    route: "/multi-tenant",
    roles: ["knsoft_admin"],
    name: "Multi-Tenant",
    purpose: "Compare schools on the platform.",
    controls: [
      sec("Storage Usage by School", "Storage per school."),
      sec("Usage Analytics", "Usage figures."),
      btn("Refresh", "Reloads the figures."),
    ],
    sources: ["src/pages/MultiTenantDashboard.tsx"],
  },
];

const sameKey = (a: PageHelpEntry, b: PageHelpEntry) => a.route === b.route && a.roles.some((r) => b.roles.includes(r));

/**
 * Detailed entries (steps, problems, next steps) take priority. A basic entry stays only for the roles
 * that no detailed entry covers on that route, so nothing is shown twice and nothing is lost.
 */
export const PAGE_HELP: PageHelpEntry[] = [
  ...DETAILED_PAGE_HELP,
  ...BASIC_PAGE_HELP.map((b) => {
    const covered = DETAILED_PAGE_HELP.filter((d) => sameKey(d, b)).flatMap((d) => d.roles);
    const roles = b.roles.filter((r) => !covered.includes(r));
    return roles.length ? { ...b, roles } : null;
  }).filter((e): e is PageHelpEntry => e !== null),
];

/** The tour-style group name shown to the user for each profile role. */
export const ROLE_LABEL: Record<string, string> = {
  student: "Student",
  teacher: "Teacher",
  parent: "Parent",
  admin: "School Admin",
  principal: "Principal",
  school_admin: "School Admin",
  knsoft_admin: "Platform Admin",
};

/** Match "/attendance?tab=x" and "/student/group-projects/123" style paths to a registry route. */
function normalise(pathname: string): string {
  const p = pathname.split("?")[0].split("#")[0];
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

export function getPageHelp(pathname: string, role: string | null | undefined): PageHelpEntry | null {
  if (!role) return null;
  const path = normalise(pathname);
  return PAGE_HELP.find((e) => e.route === path && (e.roles as string[]).includes(role)) ?? null;
}
