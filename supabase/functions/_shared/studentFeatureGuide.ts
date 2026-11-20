// supabase/functions/_shared/studentFeatureGuide.ts
//
// What the Study Buddy (text AND voice - they share the student-self-assistant function) knows about the
// STUDENT APP ITSELF: every page, dashboard card and profile tab a student can open, what it is for, and how to
// use it. Pure data + pure helpers (no I/O), unit-tested in src/test/studentFeatureGuide.test.ts.
//
// WHY THIS FILE EXISTS
//   student-self-assistant only knew 18 hard-coded "data areas" (homework, attendance, ...). Anything added to
//   the student dashboard later (Adaptive Test, Daily Review, Forgetting Forecast, Learning Path, My Exams,
//   Engagement Score, ...) was unknown to it, so it answered "I don't know this feature". This guide is the
//   place that knowledge now lives.
//
// KEEPING IT CURRENT - TWO LAYERS
//   1. AUTOMATIC. featureManifest.generated.ts is generated from the real sidebar (tools/generate-feature-manifest.mjs,
//      run by `npm run features:generate` and before every `npm run build`). Every page a student can see in the menu
//      is therefore known to the Study Buddy by name and place, even before anyone writes a word about it. A test
//      fails if that file is out of date, so it cannot silently drift.
//   2. WRITTEN. The entries below add what a page is for, how to use it and what the labels mean. Add one when you
//      add a student page, dashboard card or Student 360 tab. A page with no entry still gets an automatic one
//      (name + where to find it), and the assistant is told not to invent details for those.
//
// WRITING RULES (the descriptions are read aloud in voice mode)
//   - Say only what the screen really does. Every sentence was written from the page's source. If you are not
//     sure of a detail, leave it out - the assistant is told never to invent beyond this text.
//   - Plain, short sentences. No markdown, no tables. Use the exact on-screen names for buttons and tabs.

import { GENERATED_NAV, GENERATED_STUDENT_MODULES, type GeneratedNavRow } from "./featureManifest.generated.ts";

export interface StudentFeature {
  /** Stable id (also used by the tests). */
  id: string;
  /** The name exactly as the student sees it. */
  name: string;
  /** Sidebar route(s) this entry covers. Omit for things that are not a sidebar page (cards, tabs, header buttons). */
  routes?: string[];
  /** How to find it. */
  where: string;
  /** Other words a student might use for it (matched case-insensitively, whole words/phrases). */
  keywords: string[];
  /** What it is, in one or two plain sentences. */
  summary: string;
  /** How to use it, in order. */
  howTo?: string[];
  /** Extra useful facts: what the numbers or labels mean, what to do when something looks wrong. */
  notes?: string[];
  /** Student 360 Profile tab names this entry describes (the test checks every tab is covered). */
  profileTabs?: string[];
  /** True for an entry made automatically from the sidebar (name and place only, no written details yet). */
  auto?: boolean;
}

export const STUDENT_FEATURES: StudentFeature[] = [
  // ───────────────────────────── Home / dashboard ─────────────────────────────
  {
    id: "home",
    name: "Home (student dashboard)",
    routes: ["/student-dashboard"],
    where: "First item in the left menu (Home).",
    keywords: ["home", "dashboard", "home page", "student dashboard", "main page"],
    summary:
      "Your personal learning dashboard. It brings together your assessment, your results, pending homework and worksheets, your daily performance and weekly improvement, your Engagement Score, upcoming live sessions and your group projects.",
    howTo: [
      "Open Home from the left menu.",
      "Use Start Assessment on the diagnostic card to take your assessment.",
      "Use View All on the homework card to see every homework.",
    ],
  },
  {
    id: "engagement-score",
    name: "My Engagement Score",
    where: "A card on your Home dashboard.",
    keywords: ["engagement", "engagement score", "my engagement", "how active", "participation", "engaged"],
    summary:
      "A score out of 100 that shows how actively you take part in learning, with a trend so you can see if it is going up or down.",
    howTo: ["Open Home and find the My Engagement Score card.", "Press the small refresh button on the card to update it."],
    notes: [
      "It is built from five kinds of activity: Video watching, Quiz participation, Assignment submission, Live class attendance, and Doubts and interactions.",
      "The bands are: Highly Engaged 80 to 100, Moderately Engaged 60 to 79, Low Engagement 40 to 59, Very Low Engagement 0 to 39.",
      "To raise it, do more of those five things, for example watch the class videos, join live classes, and hand in assignments on time.",
    ],
  },

  // ───────────────────────────── Tests, assessments, mastery ─────────────────────────────
  {
    id: "assessments",
    name: "Assessments",
    routes: ["/diagnostic"],
    where: "Left menu, Assessments. Also the Start Assessment button on Home.",
    keywords: ["assessment", "assessments", "diagnostic", "diagnostic test", "diagnostic assessment"],
    summary:
      "Your diagnostic assessment. It finds your strengths and the areas that need more attention, and your results then show on Home.",
    howTo: ["Press Start Assessment.", "Answer each question and press Next.", "On the last question press Submit Assessment."],
  },
  {
    id: "academic-tests",
    name: "Academic Tests",
    routes: ["/academic-tests"],
    where: "Left menu, Academic Tests.",
    keywords: ["academic test", "academic tests", "class test", "practice test", "subject test"],
    summary:
      "Practice tests for your class and subject. You choose the setup, answer one question at a time, see straight away whether you were right, and finish with a score. Past tests are listed under Recent Tests.",
    howTo: [
      "In Start a New Test, check your Class and pick a Subject.",
      "Optionally type a Topic, and set the Number of Questions and the Level of Difficulty.",
      "Press Generate & Start Test.",
      "For each question choose an answer and press Confirm Answer, then Next Question. The last one says View Results.",
    ],
  },
  {
    id: "my-mastery",
    name: "My Mastery",
    routes: ["/my-mastery"],
    where: "Left menu, My Mastery (first tab of the My Mastery and Exam Readiness page).",
    keywords: ["mastery", "my mastery", "concept mastery", "mastery tree", "mastery report", "how well do i know"],
    summary:
      "Shows how well you have mastered each concept, organised as a tree by subject, chapter and topic, with a tab for each subject book. Concepts that need attention are highlighted.",
    notes: ["It starts empty and fills in as you take assessments, homework and worksheets."],
  },
  {
    id: "exam-readiness",
    name: "Exam Readiness",
    routes: ["/exam-readiness"],
    where: "Second tab on the My Mastery page, next to My Mastery.",
    keywords: ["exam readiness", "readiness", "exam ready", "am i ready", "exam preparation", "exam prep", "readiness score"],
    summary:
      "Answers 'how ready am I for my exam?'. It shows your predicted readiness by topic, chapter, subject and overall, and how you compare with others.",
    howTo: [
      "Open the My Mastery page and choose the Exam Readiness tab.",
      "My readiness shows your own readiness scores.",
      "How I compare shows where you stand against your section, class, grade and school.",
    ],
    notes: ["Comparisons are anonymous. You only see group figures, never another student's name or marks."],
  },
  {
    id: "my-exams",
    name: "My Exams",
    routes: ["/my-exams"],
    where: "Left menu, My Exams.",
    keywords: ["my exams", "my exam", "online exam", "mock exam", "mock test", "assigned exam", "exam paper"],
    summary:
      "The exam papers and mock exams your teachers have assigned to you, each with a status and, once marked, your score.",
    howTo: [
      "Open My Exams. Each exam shows its time limit (and whether it is timed), when it Opens and when it is Due.",
      "Press Start on an exam that says Not started. It stays greyed out until it opens, or if it has been closed.",
      "If you stopped part-way the button says Resume. Once marked it says View result.",
    ],
    notes: [
      "The statuses are Not started, In progress, Awaiting review (you submitted, the teacher has not marked it yet) and Graded.",
      "A score shown while it is still Awaiting review is provisional.",
      "Mock exams are tagged Mock exam.",
    ],
  },
  {
    id: "adaptive-test",
    name: "Adaptive Test",
    routes: ["/adaptive-test"],
    where: "Left menu, Adaptive Test.",
    keywords: ["adaptive test", "adaptive", "adaptive testing", "adaptive assessment", "smart test", "cat test"],
    summary:
      "A test that adjusts to you. The questions get easier or harder depending on your answers, so it can work out your level in fewer questions.",
    howTo: [
      "Choose how wide the test is: Whole subject, This chapter, This topic, or Just this concept.",
      "Pick the Subject, then the Chapter, Topic and optionally a Concept, and start.",
      "Answer each question and press Next Question. Press See Results at the end.",
    ],
    notes: [
      "If you leave a test part-way it can resume where you stopped. Exit test asks you to confirm first.",
      "The results show Accuracy, Questions, Your marks and a Skill breakdown.",
      "A score can be marked provisional when many of the questions are still new. It becomes more precise over time.",
      "If your school has negative marking on, wrong answers can lose marks, and the test shows you the rules.",
    ],
  },
  {
    id: "daily-review",
    name: "Daily Review",
    routes: ["/daily-review"],
    where: "Left menu, Daily Review (first tab of the Daily Review and Flashcards page).",
    keywords: ["daily review", "review", "revision", "daily revision", "spaced repetition", "revise"],
    summary:
      "A short daily set of questions on things you learned earlier, timed so you practise each concept just before you would forget it. It keeps what you learn in your memory.",
    howTo: [
      "Open Daily Review. The top shows how many are Due now, Later today, in the Next 7 days, and Locked in (21d+).",
      "Choose an answer and press Submit, then Next. The last one says Finish.",
      "When you are done, Check for more looks for any new reviews.",
    ],
    notes: [
      "You're all caught up means nothing is due right now. Come back when the next review is due.",
      "Some concepts can be due but have no practice questions yet. The screen tells you when that is the case.",
    ],
  },
  {
    id: "flashcards",
    name: "Flashcards",
    routes: ["/flashcards"],
    where: "Second tab on the Daily Review page, next to Daily Review.",
    keywords: ["flashcards", "flashcard", "flash cards", "flip cards", "revision cards", "study cards", "cards"],
    summary:
      "Quick exam-style flip cards made from your own textbook, so they match what you learn in class.",
    howTo: [
      "Open the Flashcards tab and pick a subject, then a chapter.",
      "Wait a moment while the cards are made. It can take up to half a minute.",
      "Flip each card, then rate it Easy, Medium or Difficult. On a keyboard the keys 1, 2 and 3 do the same.",
    ],
    notes: [
      "Cards you rate Difficult come back sooner so you can master them.",
      "If a card looks wrong you can report it, and you can stop seeing a card you do not want.",
    ],
  },
  {
    id: "forgetting-forecast",
    name: "Forgetting Forecast",
    routes: ["/forgetting-forecast"],
    where: "Left menu, Forgetting Forecast.",
    keywords: ["forgetting forecast", "forecast", "forgetting curve", "memory forecast", "retention", "will i forget", "recall"],
    summary:
      "Predicts how likely you are to still remember each concept you have learned, based on how well you know it and how long ago you last practised. It lists the concepts that are about to slip below 50 percent recall, so you can revise them first.",
    howTo: ["Open Forgetting Forecast.", "Tap a concept to see its memory curve.", "Concepts under Further out are not at risk yet."],
    notes: ["Only concepts you have actually shown you know are forecast."],
  },
  {
    id: "learning-path",
    name: "Learning Path",
    routes: ["/learning-path"],
    where: "Left menu, Learning Path.",
    keywords: ["learning path", "study path", "learning plan", "study plan", "what should i study", "what next", "whats next"],
    summary:
      "A personal study path for a subject that tells you what to do next. Each step is a Review, a Fix a gap, a New concept, or Practice, and you answer a question for the step.",
    howTo: [
      "Open Learning Path and pick a subject. Only your own class's subjects are listed.",
      "Work through the steps in order.",
      "Press Generate a new path when you want a fresh one.",
    ],
    notes: ["If it says there is nothing due, nothing at risk and everything ready is already attempted, check back later."],
  },

  // ───────────────────────────── Practice & coursework ─────────────────────────────
  {
    id: "worksheets",
    name: "Worksheets",
    routes: ["/worksheets"],
    where: "Left menu, Worksheets. They also appear on Home.",
    keywords: ["worksheet", "worksheets", "practice worksheet", "practice activities"],
    summary:
      "Worksheets your teachers assign to your class. You complete them and submit them to your teacher, and you can edit your answers until the teacher reviews them.",
    notes: ["You can download a worksheet as a PDF. Answer keys are never shown to students."],
  },
  {
    id: "homework",
    name: "Homework",
    routes: ["/dashboard"],
    where: "Left menu, Homework. A summary is on Home too.",
    keywords: ["homework", "assignment", "assignments", "home work", "pending homework"],
    summary: "Homework your teachers assign to you, with its due date and whether you have submitted it.",
  },
  {
    id: "my-classroom",
    name: "My Classroom",
    routes: ["/my-classroom"],
    where: "Left menu, My Classroom.",
    keywords: ["my classroom", "classroom", "digital classroom", "class stream", "class materials"],
    summary:
      "One place for your class. It has a Stream for announcements, discussion and questions with replies, Materials your teachers share, Assignments with your own status, Attendance with your own record, and Live for upcoming virtual classes with their join links.",
    howTo: ["Open My Classroom and choose your class.", "Switch between Stream, Materials, Assignments, Attendance and Live."],
  },
  {
    id: "virtual-classroom",
    name: "Virtual Classroom",
    routes: ["/virtual-classroom"],
    where: "Left menu, Virtual Classroom. Upcoming sessions also show on Home.",
    keywords: ["virtual classroom", "virtual class", "online class", "live class", "live classroom", "join class", "meet link"],
    summary: "Your live online class sessions, with the time, subject and a link to join when the session is scheduled.",
  },
  {
    id: "group-projects",
    name: "Group Projects",
    routes: ["/student/group-projects"],
    where: "Left menu, Group Projects. A summary is on Home too.",
    keywords: ["group project", "group projects", "project", "projects", "team project", "group work"],
    summary: "The projects you work on with a group. Open a project to see your group's workspace and tasks and how many are done.",
  },
  {
    id: "marketplace",
    name: "Marketplace",
    routes: ["/marketplace"],
    where: "Left menu, Marketplace.",
    keywords: ["marketplace", "market place", "store", "courses", "course", "videos", "enroll", "enrol", "drop course"],
    summary:
      "Learning videos and courses made available for your class. The All Videos tab has the videos, and the Courses tab lets you Enroll in a course. Press Drop Course to leave one, and you lose access to its materials until you enroll again.",
  },
  {
    id: "electives",
    name: "Electives",
    routes: ["/electives"],
    where: "Left menu, Electives.",
    keywords: ["elective", "electives", "elective subjects", "choose elective"],
    summary: "The optional subjects your school offers for your grade, where you can see what is available and what you have chosen.",
  },
  {
    id: "surveys",
    name: "Surveys",
    routes: ["/surveys"],
    where: "Left menu, Surveys.",
    keywords: ["survey", "surveys", "feedback", "feedback survey", "questionnaire"],
    summary:
      "Feedback surveys that your school asks you to answer. The To Respond tab lists the ones waiting for you.",
    notes: ["On a survey marked anonymous, the school cannot see who answered."],
  },

  // ───────────────────────────── AI help ─────────────────────────────
  {
    id: "ai-tutor",
    name: "AI Tutor",
    routes: ["/ai-tutor"],
    where: "Left menu, AI Tutor.",
    keywords: ["ai tutor", "tutor", "tutoring", "ai tutoring", "ask tutor", "explain topic", "homework help"],
    summary:
      "A tutor you can chat with about your subjects. It knows your learning style. Pick the style you want: Explain for clear explanations with examples, Socratic where it guides you with questions instead of giving the answer, or Hints where you get one small hint at a time.",
    howTo: [
      "Open AI Tutor and type or speak your question.",
      "You can attach a photo or a document of the problem.",
      "You can choose the language it teaches in.",
    ],
  },
  {
    id: "career-coach",
    name: "AI Career Coach",
    routes: ["/ai-tutor?mode=career"],
    where: "Left menu, under AI Tutor, called AI Career Coach.",
    keywords: ["career coach", "ai career coach", "career", "career guidance", "career counselling", "career counseling", "career advice", "what should i be"],
    summary:
      "A coach for exploring careers, subject choices and skills to build, based on your interests and strengths. It starts by asking about your favourite subjects, and you can say you do not know what you want to be.",
  },
  {
    id: "pronunciation",
    name: "Pronunciation Practice",
    routes: ["/pronunciation"],
    where: "Left menu, Pronunciation.",
    keywords: ["pronunciation", "pronunciation practice", "speaking practice", "read aloud", "reading aloud", "accent"],
    summary:
      "Read a text aloud and see which words came out clearly, plus tips for the rest. You can pick the accent to listen for and type or paste your own text, or use a built-in passage.",
    howTo: [
      "Choose an Accent to listen for.",
      "Choose or type the text to read.",
      "Read it aloud. You then see how close each word was, word by word.",
    ],
    notes: ["Your progress is saved so you can see it improve."],
  },

  {
    id: "my-doubts",
    name: "My Doubts",
    where: "Left menu, My Doubts.",
    keywords: ["my doubts", "doubts", "doubt", "ask a doubt", "ask doubt", "ask my teacher", "ask the teacher", "question for teacher", "teacher answer", "unsolved doubt", "resolved doubts", "doughts", "my doughts", "dowts", "my dowts"],
    // Written from the live screen, not from source code (this page is newer than the code this guide was last
    // checked against). Everything below is what that screen visibly shows. Please confirm against the page.
    summary:
      "The place to ask your teachers about something you did not understand, and to follow their answers.",
    howTo: [
      "Open My Doubts from the left menu.",
      "Press the Ask a doubt button and write your question for your teacher.",
      "Your doubts are listed on the left. Tap one to see the conversation with your teacher on the right.",
      "Use the Search doubts box to find an old doubt.",
    ],
    notes: [
      "The three boxes at the top count your doubts: New, In Progress and Resolved.",
      "If you have not asked anything yet, it says You haven't asked any doubts yet.",
    ],
  },

  // ───────────────────────────── Motivation ─────────────────────────────
  {
    id: "gamification",
    name: "Gamification",
    routes: ["/gamification"],
    where: "Left menu, Gamification.",
    keywords: ["gamification", "game", "games", "rewards", "xp", "level", "achievements", "badges", "adaptive round"],
    summary: "Learning games where you earn XP, level up and unlock achievements. Adaptive practice rounds adjust to your level.",
  },
  {
    id: "leaderboard",
    name: "Leaderboard",
    routes: ["/leaderboard"],
    where: "Left menu, Leaderboard.",
    keywords: ["leaderboard", "leader board", "ranking", "rank", "scoreboard", "top students"],
    summary: "Shows where you rank by XP, in your school and in your class.",
  },
  {
    id: "houses",
    name: "Houses",
    routes: ["/houses"],
    where: "Left menu, Houses.",
    keywords: ["house", "houses", "house points", "house system"],
    summary: "Your school house, its points and where it ranks among the houses.",
  },
  {
    id: "credentials",
    name: "Credentials",
    routes: ["/student/credentials"],
    where: "Left menu, Credentials.",
    keywords: ["credential", "credentials", "certificate", "certificates", "digital credentials", "micro credential"],
    summary: "The digital credentials and certificates you have earned.",
  },

  // ───────────────────────────── School life ─────────────────────────────
  {
    id: "attendance",
    name: "Attendance",
    routes: ["/attendance"],
    where: "Left menu, Attendance.",
    keywords: ["attendance", "attendance record", "present", "absent", "absences"],
    summary: "Your own attendance record.",
  },
  {
    id: "timetable",
    name: "Timetable",
    routes: ["/timetable"],
    where: "Left menu, Timetable.",
    keywords: ["timetable", "schedule", "class schedule", "class timetable", "routine", "periods"],
    summary: "Your class timetable, the period-by-period schedule your school uploaded.",
  },
  {
    id: "academic-calendar",
    name: "Academic Calendar",
    routes: ["/academic-calendar"],
    where: "Left menu, Academic Calendar.",
    keywords: ["academic calendar", "calendar", "school calendar", "holidays", "events"],
    summary: "School events, holidays, exam dates and homework deadlines.",
  },
  {
    id: "communication",
    name: "Communication",
    routes: ["/student-communication"],
    where: "Left menu, Communication.",
    keywords: ["communication", "communications", "message", "messages", "messaging", "inbox", "communication center"],
    summary: "Messages from your teachers and your school.",
  },
  {
    id: "semester-engine",
    name: "Semester Engine",
    routes: ["/semester-engine"],
    where: "Left menu, Semester Engine.",
    keywords: ["semester", "semester engine", "gpa", "semester marks"],
    summary: "Your semester marks and GPA.",
  },
  {
    id: "report-cards",
    name: "Report Cards",
    routes: ["/report-cards"],
    where: "Left menu, Report Cards.",
    keywords: ["report card", "report cards", "result", "results", "marks card", "grade card"],
    summary: "Your report cards with your marks and grades.",
  },
  {
    id: "hall-tickets",
    name: "Hall Tickets",
    routes: ["/hall-tickets"],
    where: "Left menu, Hall Tickets.",
    keywords: ["hall ticket", "hall tickets", "admit card", "exam ticket", "seat number", "exam seat"],
    summary: "Your exam hall tickets, with the exam, the hall and your seat once the school has assigned it.",
  },
  {
    id: "my-accommodations",
    name: "My Accommodations",
    routes: ["/my-accommodations"],
    where: "Left menu, My Accommodations.",
    keywords: ["accommodation", "accommodations", "my accommodations", "learning accommodations", "learning support"],
    summary: "The learning accommodations your school has set up for you, such as extra time or other support.",
  },
  {
    id: "settings",
    name: "Settings",
    routes: ["/settings"],
    where: "Left menu, Settings, or your account menu at the top.",
    keywords: ["settings", "setting", "preferences", "account settings", "language", "dyslexia", "text size", "accessibility"],
    summary: "Your profile, preferences and account settings.",
  },

  // ───────────────────────────── Student Profile (360) and its tabs ─────────────────────────────
  {
    id: "student-profile",
    name: "Student Profile",
    routes: ["/student-profile"],
    where: "Left menu, Student Profile.",
    keywords: ["student profile", "profile", "profile 360", "my profile", "my details", "my information"],
    summary:
      "Your full profile in one place, split into tabs: Overview, Parents, Medical, Transport, Documents, Behaviour, Improvement Plan, Learning Twin, Live Activity, Learning Support, Emergency, Goals and Fees.",
    howTo: ["Open Student Profile.", "Tap a tab to see that part of your profile."],
    profileTabs: ["Overview", "Parents", "Medical", "Transport", "Documents", "Behaviour", "Emergency"],
  },
  {
    id: "profile-improvement-plan",
    name: "Improvement Plan (profile tab)",
    where: "Student Profile, Improvement Plan tab.",
    keywords: ["improvement plan", "growth plan", "personalised plan", "personalized plan"],
    summary:
      "A personalised growth plan built from your predictions, attendance and competencies, to show what to work on.",
    profileTabs: ["Improvement Plan"],
  },
  {
    id: "profile-learning-twin",
    name: "Learning Twin (profile tab)",
    where: "Student Profile, Learning Twin tab.",
    keywords: ["learning twin", "twin", "digital twin", "learning style", "learning preferences"],
    summary:
      "A picture of how you learn: your ability, your learning preferences and your progression, kept up to date from your tests, adaptive sessions and mastery. It also shows why your risk level is what it is and gives suggested next steps.",
    profileTabs: ["Learning Twin"],
  },
  {
    id: "profile-live-activity",
    name: "Live Activity (profile tab)",
    where: "Student Profile, Live Activity tab.",
    keywords: ["live activity", "my activity", "activity log", "time on platform"],
    summary: "Your real-time learning activity: answers, tutor use, tests and time spent on the platform.",
    profileTabs: ["Live Activity"],
  },
  {
    id: "profile-learning-support",
    name: "Learning Support (profile tab)",
    where: "Student Profile, Learning Support tab.",
    keywords: ["iep", "support plan", "support plans"],
    summary: "Your support plans and accommodations, such as an IEP, if you have one.",
    profileTabs: ["Learning Support"],
  },
  {
    id: "profile-goals",
    name: "Goals (profile tab)",
    where: "Student Profile, Goals tab.",
    keywords: ["goals", "my goals", "goal tracking", "set a goal"],
    summary: "Where you keep your goals and track your progress towards them.",
    profileTabs: ["Goals"],
  },
  {
    id: "profile-fees",
    name: "Fees (profile tab)",
    where: "Student Profile, Fees tab.",
    keywords: ["fees", "fee", "fee plan", "my fees", "fee structure", "concession", "outstanding balance", "balance", "tuition", "school fees", "fee payment", "pay fees"],
    summary:
      "Shows the fee plan your school assigned when your admission was confirmed: the fee structure name, class, academic year and due date, a breakdown of each fee, the total fee, any concession or discount, how much is paid so far, and the outstanding balance. A badge shows whether it is Paid, Part paid, Pending or Overdue.",
    notes: [
      "It is view-only. You cannot change or pay from this tab.",
      "Your parents pay from their own fee payment page. Questions about an amount are for the school's fee office.",
      "If it says No admission fee plan linked, the plan appears once your admission is confirmed and the plan is linked to you.",
    ],
    profileTabs: ["Fees"],
  },

  // ───────────────────────────── Around the app ─────────────────────────────
  {
    id: "global-search",
    name: "Search",
    where: "The search box at the top of every page. The keyboard shortcut is Ctrl and K.",
    keywords: ["search", "search box", "global search", "ctrl k", "find something", "look something up"],
    summary:
      "Looks things up across APAS, such as lessons and exams. You only see things you are allowed to open.",
    howTo: ["Click the search box at the top, or press Ctrl and K.", "Type what you are looking for and pick a result."],
  },
  {
    id: "ask-apas",
    name: "Ask APAS (command bar)",
    where: "The Ask APAS button at the top of every page. The keyboard shortcut is Ctrl and J.",
    keywords: ["ask apas", "command bar", "ai command bar", "ctrl j", "quick command", "type a command"],
    summary:
      "A quick way to get around and check things by typing a normal sentence, like Open my timetable. It can open pages, show your attendance this month, show what homework is due, show upcoming exams, show your latest exam results, and show or clear your unread notifications.",
    howTo: ["Press Ask APAS, or press Ctrl and J.", "Type a sentence such as What homework is due, then press Enter."],
    notes: ["It only opens pages and shows your own information. If it needs to change something it asks you to confirm first."],
  },
  {
    id: "header-tools",
    name: "Notifications and the Help button",
    where: "The top bar of every page.",
    keywords: ["notifications", "notification", "bell", "help button", "guided tour", "take the tour", "tour"],
    summary:
      "The bell shows new messages, alerts and updates, with a red number for the ones you have not read. The help button replays the guided tour of the app.",
  },
  {
    id: "study-buddy",
    name: "Study Buddy",
    where: "The Study Buddy button on your pages. You can type, or use the microphone to talk to it.",
    keywords: ["study buddy", "buddy", "voice mode", "voice assistant", "talk to you", "what can you do", "what can you help", "video mode", "text mode"],
    summary:
      "That is me. I can answer questions about your own homework, worksheets, tests, attendance, timetable, calendar, grades, hall tickets, house and more. I can explain a school topic, either in writing or by finding a video. I can also explain any feature of the app, and open a page for you if you say, for example, open Adaptive Test.",
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

/** True when `phrase` appears in `text` as whole words (a trailing s / es is allowed: "worksheet" matches "worksheets"). */
function hasPhrase(text: string, phrase: string): boolean {
  const p = norm(phrase);
  if (!p) return false;
  return new RegExp(`(^| )${escapeRe(p)}(s|es)?( |$)`).test(text);
}

/** Edit distance (a swap of neighbouring letters counts as one), used only to forgive a one-letter slip ("attendence") in words of 5+ letters. */
function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
    {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // two neighbouring letters swapped ("reveiw") is one slip, not two
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  return dp[a.length][b.length];
}

/** Like hasPhrase, but each word of 5+ letters may have one wrong, missing or extra letter (typing and speech slips). */
function hasPhraseLoosely(text: string, phrase: string): boolean {
  const pw = norm(phrase).split(" ").filter(Boolean);
  if (!pw.some((w) => w.length >= 5)) return false; // short words must match exactly: too easy to confuse
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

function scoreFeature(f: StudentFeature, text: string): number {
  if (!text) return 0;
  let score = 0;
  const base = f.name.replace(/\s*\(.*\)\s*$/, "");
  if (hasPhrase(text, base)) score += 4;
  else if (hasPhraseLoosely(text, base)) score += 2;
  for (const k of f.keywords) {
    const weight = k.includes(" ") ? 3 : 2; // multi-word phrases are more specific
    if (hasPhrase(text, k)) score += weight;
    else if (hasPhraseLoosely(text, k)) score += weight - 1; // a near miss counts for less than an exact hit
  }
  return score;
}

/** Does this written entry already describe that menu row? (same page, or the same name) */
function covers(f: StudentFeature, row: { path: string; name: string }): boolean {
  if (f.routes?.includes(row.path)) return true;
  const base = norm(f.name.replace(/\s*\(.*\)\s*$/, ""));
  return base === norm(row.name);
}

/** The rows the student's sidebar shows. Same rule as isNavItemAllowedForRole() in AppSidebar.tsx, for "student". */
export function studentMenuRows(
  nav: GeneratedNavRow[] = GENERATED_NAV,
  modules: string[] = GENERATED_STUDENT_MODULES,
): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  const seen = new Set<string>();
  const add = (name: string, path: string) => {
    const k = `${path}|${norm(name)}`;
    if (!seen.has(k)) { seen.add(k); out.push({ name, path }); }
  };
  for (const it of nav) {
    if (it.roles && !it.roles.includes("student")) continue;
    if (it.module && !modules.includes(it.module)) continue;
    add(it.studentTitle || it.title, it.path);
    if (it.subItem) add(it.subItem.title, it.subItem.path);
  }
  return out;
}

/** Menu rows with no written entry: the Study Buddy still knows them by name and place. */
export function uncuratedStudentRows(
  nav: GeneratedNavRow[] = GENERATED_NAV,
  modules: string[] = GENERATED_STUDENT_MODULES,
): { name: string; path: string }[] {
  return studentMenuRows(nav, modules).filter((r) => !STUDENT_FEATURES.some((f) => covers(f, r)));
}

/** Everything the Study Buddy knows: the written entries, plus an automatic one for every other student menu page. */
export function allStudentFeatures(
  nav: GeneratedNavRow[] = GENERATED_NAV,
  modules: string[] = GENERATED_STUDENT_MODULES,
): StudentFeature[] {
  const auto: StudentFeature[] = uncuratedStudentRows(nav, modules).map((r) => ({
    id: `auto-${norm(r.name).replace(/ /g, "-")}`,
    name: r.name,
    routes: [r.path],
    where: `Left menu, ${r.name}.`,
    keywords: [r.name],
    summary: `A page in your left menu called ${r.name}. Its full details are not in my notes yet.`,
    auto: true,
  }));
  return [...STUDENT_FEATURES, ...auto];
}

/**
 * Which features is this message (and, for short follow-ups like "how do I use it?", the last couple of turns)
 * about? Returns the best matches, most relevant first.
 */
export function selectFeatures(
  message: string,
  history: { role: string; text: string }[] = [],
  max = 3,
  features: StudentFeature[] = allStudentFeatures(),
): StudentFeature[] {
  const now = norm(message);
  const recent = (history || []).slice(-2).map((h) => norm(h?.text ?? "")).join(" ");
  const scored = features
    .map((f) => ({ f, s: scoreFeature(f, now) * 3 + scoreFeature(f, recent) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, max).map((x) => x.f);
}

/** One line per feature: the whole app on a page, so the assistant always knows what exists. */
export function featureIndex(features: StudentFeature[] = allStudentFeatures()): string {
  return features
    .map((f) => (f.auto ? `- ${f.name}: a page in your left menu (details not written yet).` : `- ${f.name}: ${f.summary.split(". ")[0].replace(/\.$/, "")}.`))
    .join("\n");
}

/** The full explanation of one feature, as plain text for the prompt. */
export function describeFeature(f: StudentFeature): string {
  const lines = [`${f.name}`, `Where: ${f.where}`, `What it is: ${f.summary}`];
  if (f.howTo?.length) lines.push(`How to use it: ${f.howTo.map((s, i) => `(${i + 1}) ${s}`).join(" ")}`);
  if (f.notes?.length) lines.push(`Good to know: ${f.notes.join(" ")}`);
  return lines.join("\n");
}

/**
 * The prompt section that teaches the Study Buddy the student app. Always lists every feature; adds full detail
 * for the ones this message is about.
 */
export function buildFeatureGuidePrompt(
  message: string,
  history: { role: string; text: string }[] = [],
  features: StudentFeature[] = allStudentFeatures(),
): string {
  const focus = selectFeatures(message, history, 3, features);
  const detail = focus.length
    ? `\n\nFULL DETAILS for what the student seems to be asking about:\n${focus.map(describeFeature).join("\n\n")}`
    : "";
  return `APP FEATURE GUIDE (everything a student can open in APAS; this is your knowledge of the app itself):\n${featureIndex(features)}${detail}`;
}
