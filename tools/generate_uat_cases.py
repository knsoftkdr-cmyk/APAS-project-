"""Build the APAS UAT test-case workbook.

Usage: python tools/generate_uat_cases.py docs/APAS_UAT_Test_Cases.xlsx src/App.tsx
"""
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule
from openpyxl.utils import get_column_letter

OUT = sys.argv[1]

# (module code, module name) -> list of cases
# case: (feature, role, route, scenario, precondition, steps "a|b|c", test data, expected, priority, type)
M = {}

def add(code, name, *cases):
    M[(code, name)] = list(cases)

H, MED, L = "High", "Medium", "Low"
P, N, S, UI = "Positive", "Negative", "Security", "UI/UX"

add("AUTH", "Authentication & Access",
    ("Landing page", "Guest", "/", "Landing page loads for an unauthenticated visitor", "User is logged out", "Open the application URL|Review hero, features and navigation", "-", "Landing page renders with Login and Request Demo actions; no console errors", H, P),
    ("Request demo", "Guest", "/request-demo", "Submit a demo request with valid details", "User is logged out", "Open /request-demo|Fill name, school, email, phone|Submit", "Valid school details", "Success confirmation shown and request is stored", MED, P),
    ("Request demo", "Guest", "/request-demo", "Demo request form validates mandatory fields", "User is logged out", "Open /request-demo|Leave mandatory fields blank|Submit", "Blank fields / invalid email", "Inline validation errors shown; form is not submitted", MED, N),
    ("Student login", "Student", "/login", "Student logs in with Student ID and password", "Active student account exists", "Open /login|Select role 'Student'|Enter Student ID and password|Click Login", "Valid Student ID + password", "Splash screen shows, then student lands on /student-dashboard", H, P),
    ("Student login", "Student", "/login", "Student logs in with Student ID and Date of Birth (DDMMYYYY)", "Student has not changed default password", "Select role 'Student'|Enter Student ID|Enter DOB as DDMMYYYY|Click Login", "Student ID + DOB e.g. 15082012", "Login succeeds and student lands on /student-dashboard", H, P),
    ("Student login", "Student", "/login", "Student login with wrong password is rejected", "Active student account exists", "Select role 'Student'|Enter valid Student ID and wrong password|Click Login", "Wrong password", "Error toast: invalid login, hint about Student ID and DOB format; user stays on login page", H, N),
    ("Student login", "Student", "/login", "Student login with non-existent Student ID", "-", "Select role 'Student'|Enter an unknown Student ID|Click Login", "STU-000000", "Error toast shown; no session created", MED, N),
    ("Staff login", "Teacher", "/login", "Teacher logs in with email and password", "Active teacher account", "Select role 'Teacher'|Enter email and password|Click Login", "Valid teacher credentials", "Teacher lands on /dashboard; login is recorded in login history", H, P),
    ("Staff login", "Parent", "/login", "Parent logs in and is routed to parent dashboard", "Active parent account linked to a child", "Select role 'Parent'|Enter credentials|Login", "Valid parent credentials", "Parent lands on /parent-dashboard", H, P),
    ("Staff login", "HOD", "/login", "HOD logs in and is routed to HOD dashboard", "Active HOD account", "Select role 'HOD'|Enter credentials|Login", "Valid HOD credentials", "HOD lands on /hod-dashboard", H, P),
    ("Staff login", "Principal", "/login", "Principal logs in", "Active principal account", "Select role 'Principal'|Enter credentials|Login", "Valid principal credentials", "Principal lands on /dashboard with leadership widgets", H, P),
    ("Staff login", "School Admin", "/login", "School Admin logs in and is routed to Super Admin panel", "Active school_admin account", "Select role 'School Admin'|Enter credentials|Login", "Valid school admin credentials", "User lands on /super-admin", H, P),
    ("Staff login", "Driver", "/login", "Driver logs in and is routed to tracking view", "Active driver account", "Select role 'Driver'|Enter credentials|Login", "Valid driver credentials", "Driver lands on /driver/tracking", H, P),
    ("Staff login", "ERP Staff", "/login", "ERP staff with ERP access logs in", "Profile has erp_access = true", "Select role 'ERP'|Enter credentials|Login", "Valid ERP credentials", "User lands on /erp/dashboard", H, P),
    ("Staff login", "ERP Staff", "/login", "User without ERP access cannot log in as ERP", "Profile has erp_access = false", "Select role 'ERP'|Enter credentials of a non-ERP user|Login", "Teacher credentials", "'Role mismatch' toast; user is signed out and stays on login", H, S),
    ("Staff login", "Platform Admin", "/login", "KNSOFT admin logs in", "Active knsoft_admin account", "Log in with KNSOFT admin credentials", "Valid credentials", "User lands on /knsoft-admin", H, P),
    ("Role check", "Any", "/login", "Login with a role that does not match the account is blocked", "Teacher account exists", "Select role 'Parent'|Enter teacher credentials|Login", "Teacher credentials, Parent role", "'Role mismatch: This account is not registered as Parent' toast; session is signed out; failed-login security event logged", H, S),
    ("Login UI", "Any", "/login", "Changing selected role clears the identifier field and changes placeholder", "-", "Type a value in identifier|Switch role between Student and Teacher", "-", "Identifier is cleared; placeholder switches between 'Student ID' and 'Username or Email'", L, UI),
    ("Login UI", "Any", "/login", "Show/hide password toggle works", "-", "Type a password|Click the eye icon", "-", "Password toggles between masked and plain text", L, UI),
    ("Forgot password", "Teacher", "/forgot-password", "Request a password reset link", "Registered email exists", "Click 'Forgot password?'|Enter email|Submit", "Registered email", "Confirmation message; reset email received", H, P),
    ("Forgot password", "Teacher", "/forgot-password", "Reset request with invalid email format", "-", "Enter malformed email|Submit", "abc@", "Validation error shown; no request sent", MED, N),
    ("Update password", "Teacher", "/update-password", "Set a new password from reset link", "Valid reset link opened", "Open reset link|Enter new password and confirm|Submit", "Strong password", "Password updated; user can log in with new password", H, P),
    ("Update password", "Teacher", "/update-password", "Mismatched new/confirm passwords are rejected", "Valid reset link opened", "Enter different values in new and confirm|Submit", "Pass@123 / Pass@124", "Error shown; password not changed", MED, N),
    ("Registration", "Guest", "/register", "Register a new account", "-", "Open /register|Complete the form|Submit", "Valid details", "Account created; verification email sent / verify-email screen shown", MED, P),
    ("Email verification", "Guest", "/register", "Unverified email cannot access protected pages", "Account registered but not verified", "Try logging in before verification", "-", "User is asked to verify email; protected pages are not accessible", MED, S),
    ("Route protection", "Guest", "/dashboard", "Protected route redirects unauthenticated user", "User is logged out", "Open /dashboard directly in the browser", "-", "User is redirected to /login", H, S),
    ("Role guard", "Student", "/teacher", "Student cannot open teacher-only pages", "Logged in as student", "Type /teacher in the address bar", "-", "User is redirected to /dashboard; teacher content never renders", H, S),
    ("Role guard", "Teacher", "/knsoft-admin", "Teacher cannot open platform admin pages", "Logged in as teacher", "Open /knsoft-admin, /billing-dashboard, /multi-tenant", "-", "Each redirects to /dashboard", H, S),
    ("Role guard", "Parent", "/erp/fees", "Parent cannot open ERP admin pages", "Logged in as parent", "Open /safeguarding and /exam-seating", "-", "Redirected to /dashboard", H, S),
    ("Data isolation", "Teacher", "-", "User of School A cannot see School B data", "Two schools with data exist", "Log in as School A teacher|Browse students, classes, search", "-", "Only School A records appear anywhere in the app (RLS enforced)", H, S),
    ("Logout", "Any", "-", "Logout ends the session", "Logged in", "Click profile menu > Logout|Press browser Back", "-", "User returns to login; protected pages are no longer accessible", H, S),
    ("Session", "Any", "-", "Session persists across page refresh", "Logged in", "Refresh the browser on any page", "-", "User remains logged in on the same page", MED, P),
    ("Unknown route", "Any", "/xyz-unknown", "Unknown URL shows Not Found page", "-", "Open a non-existent URL", "/xyz-unknown", "404 Not Found page with link back to home", L, N),
)

add("NAV", "Navigation, Search & Onboarding",
    ("Sidebar", "Any", "-", "Sidebar shows only modules allowed for the role", "Logged in per role", "Log in as each role|Review sidebar menu items", "Student, Teacher, Parent, HOD, Admin", "Sidebar items match role permissions; no links to forbidden pages", H, S),
    ("Module permissions", "School Admin", "-", "Disabled module is hidden for the school", "Module disabled for school", "Disable a module (e.g. Transport)|Log in as a user of that school", "-", "Module is hidden from sidebar and its route is not usable", H, S),
    ("Universal search", "Teacher", "-", "Open universal search with Ctrl+K", "Logged in", "Press Ctrl+K (Cmd+K on Mac)", "-", "Search dialog opens with focus on the input", MED, P),
    ("Universal search", "Teacher", "-", "Search returns pages and records", "Logged in", "Open search|Type a student name / page name|Select a result", "Student name, 'Timetable'", "Matching results grouped by type; selecting navigates to the item", H, P),
    ("Universal search", "Student", "-", "Search results respect role access", "Logged in as student", "Search for an admin page name (e.g. 'Fee management')", "-", "Admin-only pages are not shown in results", H, S),
    ("Universal search", "Any", "-", "Search with no matches", "Logged in", "Type a random string", "zzqxy", "'No results' empty state shown", L, N),
    ("AI command bar", "Teacher", "-", "Open AI command bar with Ctrl+J", "Logged in", "Press Ctrl+J|Type a command and press Enter", "'Show my at-risk students'", "Command bar opens; AI answers or navigates to the right page", MED, P),
    ("AI command bar", "Teacher", "-", "Ctrl+K closes command bar and opens search instead", "Command bar open", "Press Ctrl+K while command bar is open", "-", "Command bar closes; only universal search is shown (no stacked dialogs)", L, UI),
    ("AI command bar", "Teacher", "-", "Empty command is not submitted", "Command bar open", "Press Enter with empty input", "-", "Nothing is sent; no error", L, N),
    ("Guided tour", "Teacher", "-", "First-time user sees onboarding flow / product tour", "New user, first login", "Log in for the first time", "-", "Onboarding flow and role-specific guided tour start; steps highlight correct UI elements", MED, P),
    ("Guided tour", "Teacher", "-", "Tour can be skipped and restarted", "Tour running", "Click Skip|Restart tour from help/settings", "-", "Tour closes on skip; restarts from step 1 on request; not shown again automatically", L, UI),
    ("Responsive", "Any", "-", "App is usable on mobile width", "-", "Open key pages at 360px width / on Android app", "-", "Layout adapts; sidebar collapses to menu; no horizontal scroll", MED, UI),
    ("Language", "Any", "/settings", "Switch interface language", "i18n languages configured", "Open Settings|Change language", "Hindi / Telugu", "UI labels change to selected language; preference persists", MED, P),
    ("Theme", "Any", "/settings", "Toggle light / dark theme", "-", "Change theme in Settings or header", "-", "Theme applies across pages and persists after reload", L, UI),
)

add("NOTIF", "Notifications & Alerts",
    ("Notification inbox", "Student", "/notifications", "View notification inbox", "User has notifications", "Click bell icon|Open /notifications", "-", "Notifications listed newest first with unread markers", H, P),
    ("Notification inbox", "Student", "/notifications", "Mark notification as read", "Unread notification exists", "Click a notification", "-", "Notification marked read; unread badge count decreases; navigates to linked item", MED, P),
    ("Notification inbox", "Student", "/notifications", "Mark all as read", "Several unread", "Click 'Mark all read'", "-", "All marked read; badge cleared", L, P),
    ("Real-time", "Student", "-", "New notification arrives in real time", "Logged in on two sessions", "Teacher publishes a test result for the student", "-", "Student sees badge increment / toast without refreshing", H, P),
    ("Push notification", "Parent", "-", "Android push notification is received", "Android app installed, permission granted", "Trigger an event (e.g. fee receipt, new message)", "-", "Push notification appears; tapping opens the relevant screen", H, P),
    ("Alerts centre", "Teacher", "/alerts", "View and filter alerts", "Alerts exist", "Open /alerts|Filter by type / severity", "-", "Alerts list filters correctly", MED, P),
    ("Notification dashboard", "Platform Admin", "/notification-dashboard", "Monitor notification delivery", "Logged in as KNSOFT admin", "Open dashboard|Review sent / failed counts", "-", "Delivery statistics are shown and match records", MED, P),
)

add("STU", "Student Dashboard & Profile",
    ("Student dashboard", "Student", "/student-dashboard", "Dashboard shows homework, tests, timetable and progress", "Student has assigned work", "Log in as student|Review dashboard widgets", "-", "Pending homework, upcoming tests, today's timetable and progress are shown and accurate", H, P),
    ("Student dashboard", "Parent", "/student-dashboard", "Parent views child's dashboard", "Parent linked to child", "Log in as parent|Open child dashboard", "-", "Child's data is shown read-only; no other student's data visible", H, S),
    ("Student profile", "Student", "/student-profile", "View own profile", "Logged in", "Open /student-profile", "-", "Personal, class and academic details are correct", MED, P),
    ("Student 360", "Teacher", "-", "Teacher views Student Profile 360", "Teacher teaches the student", "Open a student from class list", "-", "360 view shows academics, attendance, behaviour, mastery", MED, P),
    ("Skills passport", "Student", "/skills-passport", "View skills passport", "Competency data exists", "Open /skills-passport", "-", "Skills and competencies earned are listed with evidence", MED, P),
    ("Accommodations", "Student", "/my-accommodations", "SEN student views accommodations", "Student has SEN accommodations", "Open /my-accommodations", "-", "Accommodations (e.g. extra time) are listed and applied in exams", MED, P),
    ("Accessibility", "Student", "/settings", "Set accessibility preferences", "-", "Open Settings > Accessibility|Change font size / contrast", "Large font", "Preferences apply across app and persist", MED, P),
)

add("LEARN", "Personalised Learning",
    ("AI Tutor (text)", "Student", "/ai-tutor", "Ask the AI tutor a subject question", "Logged in as student", "Open /ai-tutor|Type a curriculum question|Send", "'Explain photosynthesis'", "Tutor replies with an age-appropriate, curriculum-aligned answer", H, P),
    ("AI Tutor (text)", "Student", "/ai-tutor", "Tutor keeps conversation context", "Conversation in progress", "Ask a follow-up 'Give me an example'", "-", "Answer relates to the previous question", MED, P),
    ("AI Tutor safety", "Student", "/ai-tutor", "Sensitive / unsafe message triggers safe response", "Logged in as student", "Send a message about self-harm or bullying", "Sensitive phrase", "Tutor responds safely with support guidance; safeguarding concern is flagged to the school", H, S),
    ("AI Tutor safety", "Student", "/ai-tutor", "Off-topic or inappropriate request is declined", "-", "Ask for inappropriate content", "-", "Tutor politely declines and redirects to learning", H, S),
    ("Voice tutor", "Student", "/ai-tutor", "Two-way voice conversation with tutor", "Mic permission granted", "Click mic|Speak a question|Listen to reply", "Spoken question", "Speech transcribed correctly; tutor answers aloud (TTS); transcript shown", H, P),
    ("Voice tutor", "Student", "/ai-tutor", "Microphone permission denied", "Mic permission blocked", "Click mic", "-", "Clear message asking to allow microphone; text chat still works", MED, N),
    ("Mastery", "Student", "/my-mastery", "View mastery per learning objective", "Student has answered questions", "Open /my-mastery|Expand mastery tree", "-", "Mastery level per objective is shown; values update after new attempts", H, P),
    ("Daily review", "Student", "/daily-review", "Complete spaced-repetition daily review", "Due review items exist", "Open /daily-review|Answer items", "-", "Due items presented; next review dates rescheduled based on answers", H, P),
    ("Forgetting forecast", "Student", "/forgetting-forecast", "View forgetting forecast", "Mastery history exists", "Open /forgetting-forecast", "-", "Concepts at risk of being forgotten shown with predicted dates and revise action", MED, P),
    ("Learning path", "Student", "/learning-path", "View personalised learning path", "-", "Open /learning-path", "-", "Ordered path of objectives shown, starting with prerequisites", MED, P),
    ("Next best action", "Student", "/next-best-action", "Get recommended next activity", "-", "Open /next-best-action|Click the recommendation", "-", "Relevant recommendation shown; clicking opens the activity", MED, P),
    ("Adaptive homework", "Student", "/adaptive-homework", "Complete adaptive homework", "Homework assigned", "Open /adaptive-homework|Answer questions", "-", "Difficulty adapts to answers; submission recorded; mastery updated", H, P),
    ("Enrichment", "Student", "/enrichment", "Access enrichment activities", "Student has mastered objectives", "Open /enrichment", "-", "Challenge/enrichment content shown for mastered topics", L, P),
    ("Misconceptions", "Student", "/misconceptions", "View personal misconceptions", "Wrong-answer patterns exist", "Open /misconceptions", "-", "Misconceptions listed with explanation and practice", MED, P),
    ("Pronunciation", "Student", "/pronunciation", "Reading & pronunciation practice", "Mic permission granted", "Open /pronunciation|Read passage aloud|Submit", "Practice passage", "Score and improvement tips displayed; passage in teaching language", MED, P),
    ("Learning velocity", "Student", "/learning-velocity", "View learning velocity", "-", "Open /learning-velocity", "-", "Rate of mastery shown over time", L, P),
    ("Diagnostic", "Student", "/diagnostic", "Take a diagnostic test", "Diagnostic available", "Open /diagnostic|Complete it", "-", "Results identify gaps and seed mastery levels", MED, P),
    ("Worksheets", "Student", "/worksheets", "Submit worksheet with image upload", "Worksheet assigned", "Open worksheet|Upload answer photo|Submit", "JPG/PNG < 10MB", "Upload succeeds (image compressed); submission status 'Submitted'; AI evaluation appears", H, P),
    ("Worksheets", "Student", "/worksheets", "Upload unsupported file type", "Worksheet assigned", "Upload .exe or oversized file", "file.exe / 50MB", "Validation error; upload rejected", MED, N),
    ("Gamification", "Student", "/gamification", "XP, streaks, badges and missions update", "Student completes activities", "Complete an activity|Open /gamification", "-", "XP added, streak updated, badges/missions progress shown", MED, P),
    ("Leaderboard", "Student", "/leaderboard", "View leaderboard", "-", "Open /leaderboard", "-", "Ranks shown correctly within the class/school; only allowed info visible", L, P),
    ("Predictions", "Student", "/predictions", "View performance prediction", "-", "Open /predictions", "-", "Predicted performance with confidence shown", L, P),
    ("Courses", "Student", "/student/courses", "Browse and open a course", "Courses published", "Open /student/courses|Open a course|Open a learning path", "-", "Course detail and path view load; progress tracked", MED, P),
    ("Credentials", "Student", "/student/credentials", "View earned credentials", "Course completed", "Open /student/credentials", "-", "Earned credentials listed", L, P),
    ("Electives", "Student", "/electives", "Choose an elective", "Elective window open", "Open /electives|Select elective|Confirm", "-", "Choice saved; seat count decreases; confirmation shown", H, P),
    ("Electives", "Student", "/electives", "Cannot choose a full elective / after deadline", "Elective full or window closed", "Try to select it", "-", "Selection blocked with reason", MED, N),
    ("Virtual classroom", "Student", "/virtual-classroom", "Join a live class", "Teacher has started a class", "Open /virtual-classroom|Join", "-", "Student joins; sees shared whiteboard and teacher", H, P),
    ("Digital classroom", "Student", "/my-classroom", "Student views class stream, materials, assignments", "Teacher posted content", "Open /my-classroom|Browse tabs|Post a question", "-", "Stream, materials and assignments visible; question posted", H, P),
    ("Group projects", "Student", "/student/group-projects", "Work in a group project workspace", "Student is in a group", "Open group project|Open workspace|Post update / file", "-", "Group workspace loads; contributions visible to group members only", MED, P),
    ("Student communication", "Student", "/student-communication", "Message a teacher", "-", "Open communication|Send message to teacher", "-", "Message delivered; teacher receives notification", MED, P),
)

add("EXAM-S", "Student Exams & Tests",
    ("My exams", "Student", "/my-exams", "View assigned exams", "Assessment assigned to class", "Open /my-exams", "-", "Upcoming, active and completed exams listed with dates", H, P),
    ("Take exam", "Student", "/exam/:assignmentId", "Start and submit an exam", "Exam active", "Open exam|Answer MCQ and written questions|Submit", "-", "Answers saved; submission confirmed; MCQs auto-marked", H, P),
    ("Take exam", "Student", "/exam/:assignmentId", "Timer auto-submits at time end", "Timed exam", "Start exam|Wait for timer to expire", "-", "Exam auto-submits; server-validated timer cannot be extended by client", H, S),
    ("Take exam", "Student", "/exam/:assignmentId", "Answers survive refresh / connection loss", "Exam in progress", "Answer questions|Refresh page / go offline briefly", "-", "Saved answers restored; exam continues", H, N),
    ("Take exam", "Student", "/exam/:assignmentId", "Cannot open exam not assigned or not yet open", "-", "Open URL of another class's exam / future exam", "-", "Access denied or 'not available yet' message", H, S),
    ("Take exam", "Student", "/exam/:assignmentId", "Cannot resubmit a completed exam", "Exam submitted", "Open the exam URL again", "-", "Read-only / result view; no resubmission", MED, N),
    ("SEN accommodation", "Student", "/exam/:assignmentId", "Extra-time accommodation applied", "Student has extra-time accommodation", "Start a timed exam", "25% extra time", "Timer reflects extended duration", MED, P),
    ("Adaptive test", "Student", "/adaptive-test", "Adaptive test adjusts difficulty", "Item bank calibrated", "Start adaptive test|Answer correctly then incorrectly", "-", "Next question difficulty rises after correct and drops after incorrect; ability estimate shown", H, P),
    ("Academic tests", "Student", "/academic-tests", "View academic test results", "Results published", "Open /academic-tests", "-", "Scores and feedback shown after teacher confirmation only", MED, P),
    ("Exam readiness", "Student", "/exam-readiness", "View exam readiness", "Mastery data exists", "Open /exam-readiness", "-", "Readiness per subject/topic with suggested revision", MED, P),
    ("Hall ticket", "Student", "/hall-tickets", "Download hall ticket", "Hall tickets generated", "Open /hall-tickets|Download", "-", "Hall ticket PDF with correct details, photo and seat downloads", H, P),
)

add("TCH", "Teacher Workspace & Teaching",
    ("Teacher dashboard", "Teacher", "/teacher", "Teacher panel loads with classes and tasks", "Teacher has classes", "Log in as teacher|Open /teacher", "-", "Assigned classes, subjects and pending tasks displayed", H, P),
    ("AI Class Briefing", "Teacher", "/teacher-workspace", "View AI class briefing", "Classes, submissions, at-risk data exist", "Open /teacher-workspace|Read AI Class Briefing card", "-", "Briefing lists today's classes, pending marking, attendance to mark and learning issues; counts match data", H, P),
    ("AI Class Briefing", "Teacher", "/teacher-workspace", "Briefing privacy: no student names sent to AI", "Briefing generated", "Inspect briefing request (dev tools / logs)", "-", "AI prompt contains aggregated counts only, no student names", H, S),
    ("AI Class Briefing", "Teacher", "/teacher-workspace", "Briefing when AI service is unavailable", "AI service down", "Open workspace", "-", "Graceful fallback message; rest of workspace works", MED, N),
    ("AI teacher assistant", "Teacher", "/ai-teacher-assistant", "Generate a lesson plan with AI", "Syllabus loaded", "Open AI Teacher Assistant|Choose class, subject, chapter|Generate lesson plan", "Class 8 Science, Ch 3", "Structured lesson plan generated against school syllabus; can save/edit", H, P),
    ("Period plans", "Teacher", "/ai-teacher-assistant", "Generate period plans", "Timetable and syllabus exist", "Generate period plans for a chapter", "-", "Plans split across periods; saved and visible later", MED, P),
    ("Entry ticket", "Teacher", "/entry-ticket", "Create and launch an entry ticket", "-", "Open /entry-ticket|Generate questions|Assign to class", "-", "Entry ticket created; students can answer; results summary shown", MED, P),
    ("Digital classroom", "Teacher", "/classroom", "Post announcement / material / assignment", "Teacher has a class", "Open /classroom|Post announcement|Upload material|Create assignment", "PDF material", "Items appear in class stream for enrolled students only", H, P),
    ("Digital classroom", "Teacher", "/classroom", "Mark attendance from classroom", "-", "Open Attendance tab|Mark students|Save", "-", "Attendance saved and reflected on attendance pages", H, P),
    ("Digital board tasks", "Teacher", "/classroom", "Create and track board tasks", "-", "Add a task on the digital board|Change its status", "-", "Task created and status changes persist", MED, P),
    ("Virtual classroom", "Teacher", "/virtual-classrooms", "Start a live class with whiteboard", "-", "Open /virtual-classrooms|Start session|Draw on whiteboard", "-", "Session starts; students can join and see whiteboard updates live", H, P),
    ("AI whiteboard", "Teacher", "/virtual-classrooms", "AI draws a textbook-style picture (Picture mode)", "Whiteboard open", "Click AI Draw|Keep 'Picture' selected|Enter a topic|Generate drawing|Click Next step until done", "'Parts of a plant cell', Class 7", "Labelled diagram appears step by step; labels sit outside the drawing with pointer lines; words are not split; captions explain each step", H, P),
    ("AI whiteboard", "Teacher", "/virtual-classrooms", "AI draws editable shapes (Editable shapes mode)", "Whiteboard open", "Click AI Draw|Select 'Editable shapes'|Enter an equation|Generate|Click Draw all", "'Solve 2x + 3 = 11 step by step'", "Working lines appear left-aligned, one per step, final answer highlighted; shapes can be moved and edited; title shown once", MED, P),
    ("AI whiteboard", "Student", "/virtual-classroom", "Students see AI drawing build live", "Teacher and student both have the board open", "Teacher generates an AI picture and clicks Next step", "-", "Each step appears on the student's board within a second or two", H, P),
    ("AI whiteboard", "Teacher", "/virtual-classrooms", "AI Draw validation and errors", "Whiteboard open", "Open AI Draw|Enter fewer than 3 characters|Try to generate", "'ab'", "Generate button disabled; errors (if AI fails) shown inside the AI Draw card", L, N),
    ("Whiteboard full screen", "Teacher", "/virtual-classrooms", "Enter and exit full screen", "Whiteboard open", "Click the full-screen button|Draw something|Use AI Draw and Export in full screen|Press Esc", "-", "Board fills the screen and drawing fits the view; AI Draw and Export menus work in full screen; Esc exits full screen without closing the whiteboard", H, P),
    ("Whiteboard autosave", "Teacher", "/virtual-classrooms", "Board saves automatically", "Whiteboard open", "Draw a shape|Wait 2 seconds|Close and reopen the whiteboard", "-", "Toolbar shows 'Saving…' then 'Saved'; drawing is still there after reopening", H, P),
    ("Whiteboard sync", "Student", "/virtual-classroom", "Teacher and student draw at the same time", "Teacher clicked 'Allow students'", "Teacher and student draw different shapes at the same moment", "-", "Both drawings appear on both boards; neither erases the other; Ctrl+Z undoes only your own strokes", H, P),
    ("Whiteboard mode", "Student", "/virtual-classroom", "Allow students / Lock to teacher applies live", "Student has the board open", "Teacher clicks 'Allow students'|Student draws|Teacher clicks 'Lock to teacher'", "-", "Student can draw immediately without refreshing; after lock the student's board becomes view only", H, S),
    ("Whiteboard Esc key", "Teacher", "/virtual-classrooms", "Esc does not close the whiteboard", "Shape selected on board", "Press Esc", "-", "Selection is cleared; whiteboard dialog stays open (closes only with the X button)", MED, UI),
    ("Whiteboard export", "Teacher", "/virtual-classrooms", "Export board as PDF", "Board has a drawing made with AI Draw", "Click Export|Choose PDF", "-", "PDF downloads named after the session, with title, date, sharp board picture and an Explanation page listing the AI steps", H, P),
    ("Whiteboard export", "Teacher", "/virtual-classrooms", "Export board as Word document", "Board has a drawing", "Click Export|Choose Word (.docx)|Open the file in Word", "-", ".docx opens in Word with title, date, board picture and explanation; text is editable", H, P),
    ("Whiteboard export", "Teacher", "/virtual-classrooms", "Export board as PNG image", "Board has a drawing", "Click Export|Choose Image (.png)", "-", "PNG of the board with a white background downloads", MED, P),
    ("Whiteboard export", "Teacher", "/virtual-classrooms", "Ctrl+S opens the Export menu", "Whiteboard open", "Press Ctrl+S on the board", "-", "APAS Export menu opens; the Excalidraw 'Save to...' dialog and browser 'Save page' do not appear", MED, UI),
    ("Whiteboard export", "Teacher", "/virtual-classrooms", "Export an empty board", "Board is empty", "Click Export|Choose PDF", "-", "Message 'The board is empty - draw something first'; no file downloaded", L, N),
    ("Whiteboard export", "Teacher", "-", "Export on the Android app", "Android app, board has a drawing", "Click Export|Choose PDF", "-", "Android share sheet opens; file can be saved or shared (e.g. WhatsApp, Drive)", MED, P),
    ("Save to lesson", "Teacher", "/virtual-classrooms", "Save board snapshot to lesson notes", "Board has a drawing", "Click Save to Lesson", "-", "'Saved to lesson notes' message; snapshot stored with the session", MED, P),
    ("Differentiation studio", "Teacher", "/differentiation", "Create differentiated versions of a lesson", "Lesson/material exists", "Open /differentiation|Select source|Generate versions", "-", "Support, core, challenge, language-friendly, visual and SEN versions generated", H, P),
    ("Differentiation studio", "Teacher", "/differentiation", "Share differentiated material to students", "Versions generated", "Choose version per student group|Share", "-", "Each student receives the assigned version only", MED, P),
    ("Intervention board", "Teacher", "/intervention-board", "Create an intervention for a student", "At-risk student exists", "Open /intervention-board|New intervention|Set goal, plan, dates|Save", "-", "Intervention card created in 'Planned' column with baseline score", H, P),
    ("Intervention board", "Teacher", "/intervention-board", "Add check-in and close intervention with outcome", "Active intervention", "Add check-in notes|Close as Improved/No change", "-", "Before/after result shown; status updated; history retained", H, P),
    ("At-risk students", "Teacher", "/teacher-at-risk", "View at-risk students", "Risk predictions exist", "Open /teacher-at-risk", "-", "At-risk students listed with reasons and confidence", H, P),
    ("Behaviour", "Teacher", "/teacher-behaviour", "Record positive and negative behaviour", "-", "Open /teacher-behaviour|Record entry for a student", "-", "Entry saved; analytics update; parent notified if configured", MED, P),
    ("SEN students", "Teacher", "/my-sen-students", "View SEN students and accommodations", "SEN students in class", "Open /my-sen-students", "-", "Only own SEN students shown with accommodations and IEP", MED, S),
    ("Safeguarding report", "Teacher", "/teacher/safeguarding-report", "Report a safeguarding concern", "-", "Open form|Fill details|Submit", "-", "Incident created confidentially; DSL/principal notified; teacher cannot see others' cases", H, S),
    ("Group projects", "Teacher", "/teacher/group-projects", "Create group project and auto-group students", "-", "Create project|Use grouping support|Publish", "-", "Groups created; students see their group", MED, P),
    ("Electives", "Teacher", "/teacher-electives", "View elective enrolments", "-", "Open /teacher-electives", "-", "Enrolled students per elective listed", L, P),
    ("Appointments", "Teacher", "/teacher/appointments", "Manage parent appointment slots", "-", "Create slots|Accept/decline a booking", "-", "Slots visible to parents; status updates notify parent", MED, P),
    ("Teacher communication", "Teacher", "/teacher-communication", "Message parents/students", "-", "Compose message to a class parent group|Send", "-", "Message delivered to correct recipients", MED, P),
    ("Communities", "Teacher", "/teacher-communities", "Post in teacher community", "-", "Open communities|Create post / reply", "-", "Post visible to community members", L, P),
    ("Professional development", "Teacher", "/teacher-professional-development", "View PD resources and track progress", "-", "Open page|Mark a module complete", "-", "Progress saved", L, P),
    ("Watchlist", "Teacher", "-", "Add student to watch list", "-", "Open Teacher Student Watch|Add a student", "-", "Student appears in watch list with alerts", L, P),
)

add("ASSESS", "Assessment & Evaluation",
    ("Item bank", "Teacher", "/item-bank", "Generate questions with AI for a learning objective", "Learning objectives exist", "Open /item-bank|Select objective|Generate items", "MCQ, short, long, case-based", "Draft items created with quality score and difficulty", H, P),
    ("Item bank", "Teacher", "/item-bank", "Review and approve / reject draft items", "Draft items exist", "Open draft review|Edit an item|Approve one, reject one", "-", "Approved items available in builder; rejected not available; edits saved", H, P),
    ("Item bank", "Teacher", "/item-bank", "Filter items by type, difficulty, objective", "Items exist", "Apply filters", "-", "List shows only matching items", MED, P),
    ("Assessment builder", "Teacher", "/assessment-builder", "Build assessment on one screen and assign", "Approved items exist", "Open builder|Pick questions|Set marks and order|Preview|Assign to class with dates", "-", "Assessment saved; total marks correct; students see it in My Exams", H, P),
    ("Assessment builder", "Teacher", "/assessment-builder", "Cannot assign with no questions / no class / invalid dates", "-", "Try to assign an empty assessment or end date before start", "-", "Validation error; not assigned", H, N),
    ("Assessment builder", "Teacher", "/assessment-builder", "Reorder questions and change marks", "Assessment in draft", "Drag questions to reorder|Change marks", "-", "Order and total update in preview", MED, P),
    ("Paper print", "Teacher", "/assessment-paper-print", "Print assessment paper", "Assessment exists", "Open paper print|Print / save PDF", "-", "Formatted paper with header, sections and marks", MED, P),
    ("Mock exams", "Teacher", "/mock-exams", "Generate a board-pattern mock exam", "Item bank populated", "Open /mock-exams|Choose pattern|Generate", "CBSE pattern", "Multi-section paper generated matching pattern and marks", MED, P),
    ("Exam reviews", "Teacher", "/exam-reviews", "Review AI-marked written answers", "Students submitted written answers", "Open /exam-reviews|Open a submission", "-", "AI marks shown as provisional with rationale", H, P),
    ("Rubric grading", "Teacher", "/exam-reviews", "Grade with interactive rubric", "Submission open", "Set criteria to Not met/Partly/Met|Add comments|Confirm", "-", "Score computed from criteria; quoted evidence shown; marks become final", H, P),
    ("Rubric grading", "Teacher", "/exam-reviews", "Teacher override of AI mark is recorded", "Submission open", "Change AI mark|Save", "-", "Override saved and logged; student sees teacher mark", H, P),
    ("Bulk actions", "Teacher", "/exam-reviews", "Bulk-confirm AI marks with preview", "Several pending sheets", "Select sheets|Open bulk action|Review preview|Tick confirmation|Confirm", "-", "Preview shows count; selected sheets confirmed; toast with Undo", H, P),
    ("Bulk actions", "Teacher", "/exam-reviews", "Undo a bulk batch within 24 hours", "Batch confirmed < 24h ago", "Click Undo in toast or in 'Recent batches'", "-", "All sheets in batch revert to provisional", H, P),
    ("Bulk actions", "Teacher", "/exam-reviews", "Undo not allowed after 24 hours", "Batch older than 24h", "Try to undo from Recent batches", "-", "Undo disabled / error message", MED, N),
    ("Bulk actions", "Teacher", "/exam-reviews", "Confirm button disabled until preview acknowledged", "Bulk dialog open", "Try to confirm without ticking the checkbox", "-", "Confirm button disabled", MED, UI),
    ("Mastery update", "Teacher", "/exam-reviews", "Confirmed marks update mastery", "Marks confirmed", "Open student mastery after confirming", "-", "Mastery for related objectives updated", H, P),
    ("Assessment evaluation", "Teacher", "/assessment-evaluation", "Evaluate assessment submissions", "Submissions exist", "Open /assessment-evaluation|Evaluate", "-", "Scores saved and visible to student", MED, P),
    ("Submissions", "Teacher", "/submissions", "Review worksheet / homework submissions", "Submissions exist", "Open /submissions|Open a submission|Grade", "-", "AI evaluation suggestions shown; final grade saved", H, P),
    ("Adaptive homework generator", "Teacher", "/adaptive-homework/generate", "Generate adaptive homework for a class", "Mastery data exists", "Open generator|Choose class/topic|Generate & assign", "-", "Homework assigned; per-student variants match mastery", MED, P),
    ("Competency", "Teacher", "/competency-assessment", "Record competency assessment", "Competencies defined", "Open /competency-assessment|Rate students|Save", "-", "Ratings saved; heatmap updates", MED, P),
    ("Competency", "HOD", "/competency-definitions", "Define competencies", "-", "Open definitions|Add / edit competency", "-", "Competency saved and available to teachers", MED, P),
    ("Competency", "HOD", "/competency-heatmap", "View competency heatmap", "Ratings exist", "Open /competency-heatmap|Filter class", "-", "Heatmap reflects ratings", MED, P),
    ("Report cards", "Teacher", "/report-cards", "Generate report cards", "Marks finalised", "Open /report-cards|Select class/term|Generate", "-", "Report cards generated with correct marks, grades, remarks", H, P),
    ("Report cards", "Parent", "/report-cards", "Parent views/downloads child's report card", "Report card published", "Log in as parent|Open report cards|Download", "-", "Only own child's report card available; PDF correct", H, S),
    ("BKT calibration", "Teacher", "/bkt-calibration", "Run mastery model calibration", "Enough response data", "Open /bkt-calibration|Run calibration", "-", "Parameters updated; status/result displayed", L, P),
    ("Assessment hub", "Teacher", "-", "Assessment hub links to all assessment tools", "-", "Open Assessment Hub|Click each tile", "-", "Each tile navigates to the correct page", L, UI),
)

add("ANLY", "Analytics & Early Warning",
    ("Analytics", "Teacher", "/analytics", "View class analytics", "Assessment data exists", "Open /analytics|Change class/subject filters", "-", "Charts and tables update and match underlying data", H, P),
    ("Class mastery", "Teacher", "/class-mastery", "View class mastery dashboard", "-", "Open /class-mastery", "-", "Mastery per objective per student shown", H, P),
    ("Class velocity", "Teacher", "/class-velocity", "View class velocity", "-", "Open /class-velocity", "-", "Velocity trend shown per class", MED, P),
    ("Early warning", "Teacher", "/early-warning", "View early-warning list", "Risk data exists", "Open /early-warning", "-", "Flagged students with falling trends and suggested actions", H, P),
    ("Class insights", "Teacher", "-", "View class insights and misconception hotspots", "-", "Open Class Insights", "-", "Common misconceptions listed with affected student counts", MED, P),
    ("Curative", "Teacher", "/curative", "Use curative assistant for learning gaps", "-", "Open /curative|Pick a gap|Generate remedial plan", "-", "Remedial plan generated", MED, P),
    ("Root cause", "Teacher", "-", "Trace a gap to prerequisite concept", "Knowledge graph exists", "Open Root Cause Analysis for a student/objective", "-", "Prerequisite concept causing the gap identified", MED, P),
    ("Concept dependencies", "Teacher", "/concept-dependencies", "View knowledge graph / concept dependencies", "Graph generated", "Open /concept-dependencies", "-", "Graph renders with prerequisites; nodes clickable", MED, P),
    ("School analytics", "Principal", "/school-analytics", "View school-wide analytics", "-", "Open /school-analytics", "-", "School-level KPIs displayed; data limited to role scope", MED, P),
    ("Syllabus coverage", "HOD", "/syllabus-overview", "View syllabus coverage", "Lesson tracking exists", "Open /syllabus-overview|Filter by class/subject", "-", "Coverage % per class/subject correct", H, P),
    ("School quality index", "Principal", "/school-quality-index", "View School Quality Index", "-", "Open /school-quality-index", "-", "Composite index and trend shown with component breakdown", MED, P),
    ("Executive reporting", "School Admin", "/executive-reporting", "Generate executive report", "-", "Open /executive-reporting|Generate report|Export", "-", "Report generated and exportable", MED, P),
    ("Predictive analytics", "School Admin", "/predictive-analytics", "View predictive analytics", "-", "Open /predictive-analytics", "-", "Forecasts shown with confidence", MED, P),
    ("HOD dashboard", "HOD", "/hod-dashboard", "HOD dashboard shows department data", "HOD assigned department", "Log in as HOD|Review dashboard", "-", "Only department teachers/classes/subjects shown", H, S),
    ("Benchmarking", "Principal", "-", "School benchmarking", "-", "Open School Benchmarking", "-", "Benchmarks displayed", L, P),
)

add("WELL", "Well-being, SEN & Safeguarding",
    ("SEN management", "School Admin", "/sen-management", "Add student to SEN register with accommodations", "-", "Open /sen-management|Add student|Set needs and accommodations|Save", "-", "Student on SEN register; accommodations visible to their teachers", H, P),
    ("IEP", "School Admin", "/sen-management", "Draft an IEP with AI", "SEN student exists", "Open student|Generate IEP draft|Edit|Save", "-", "IEP draft generated, editable and saved", MED, P),
    ("Safeguarding", "Principal", "/safeguarding", "Manage safeguarding cases", "Incidents reported", "Open /safeguarding|Open case|Update status/actions", "-", "Case updates saved with audit trail; access restricted to authorised roles", H, S),
    ("Safeguarding", "Parent", "/parent/safeguarding", "Parent reports a concern", "-", "Open /parent/safeguarding|Submit concern", "-", "Concern submitted confidentially; school notified", H, P),
    ("Surveys", "Principal", "/surveys", "Create and publish a survey", "-", "Open /surveys|Create survey|Target audience|Publish", "Parents of Class 5", "Survey visible only to target audience", MED, P),
    ("Surveys", "Parent", "/surveys", "Respond to a survey", "Survey published", "Open survey|Answer|Submit", "-", "Response saved; cannot submit twice", MED, P),
    ("Houses", "School Admin", "/houses", "Manage houses and points", "-", "Create house|Assign students|Award points", "-", "House standings update", L, P),
)

add("COMM", "Communication & Calendar",
    ("Admin communication", "Principal", "/admin-communication", "Send school-wide announcement", "-", "Open /admin-communication|Compose|Choose audience|Send", "All parents", "Announcement delivered (in-app/push/email) to selected audience", H, P),
    ("Parent communication", "Parent", "/parent-communication", "Parent messages teacher", "-", "Open /parent-communication|Send message", "-", "Teacher receives the message and can reply", H, P),
    ("Appointments", "Parent", "/appointments", "Book a parent-teacher appointment", "Teacher slots available", "Open /appointments|Pick teacher and slot|Book", "-", "Booking confirmed; slot no longer available; AI-prepared discussion points shown", H, P),
    ("Appointments", "Parent", "/appointments", "Cannot double-book a taken slot", "Slot already booked", "Try to book same slot", "-", "Slot unavailable / error", MED, N),
    ("Academic calendar", "Any", "/academic-calendar", "View academic calendar", "Events exist", "Open /academic-calendar|Switch month", "-", "Events, holidays and exams shown correctly", MED, P),
    ("Academic calendar", "School Admin", "/academic-calendar", "Extract events from uploaded document with AI", "-", "Upload calendar PDF|Run extraction|Review|Save", "Calendar PDF", "Events extracted with correct dates; saved after review", MED, P),
    ("Requests", "Student", "/requests", "Raise a request (e.g. leave)", "-", "Open /requests|Create request|Submit", "-", "Request visible to approver; status updates notify requester", MED, P),
    ("Role assistants", "Principal", "-", "Principal AI assistant answers school queries", "-", "Open principal assistant|Ask 'attendance this week'", "-", "Answer based on own school data", MED, P),
    ("Role assistants", "Parent", "-", "Parent AI assistant answers child queries", "-", "Ask about child's attendance / fees / bus", "-", "Answers only about own child", MED, S),
)

add("PAR", "Parent Portal",
    ("Parent dashboard", "Parent", "/parent-dashboard", "View child progress, attendance and results", "Parent linked to child", "Log in|Review dashboard", "-", "Child's progress, attendance and recent results displayed", H, P),
    ("Multiple children", "Parent", "/parent-dashboard", "Switch between children", "Parent has 2+ children", "Use child switcher", "-", "Data switches to the selected child", MED, P),
    ("Fee payment", "Parent", "/parent/fee-payment", "Pay fees online via Razorpay", "Fee due exists; Razorpay test mode", "Open fee payment|Select due|Pay|Complete in Razorpay", "Razorpay test card", "Payment verified; fee marked paid; receipt generated and emailed", H, P),
    ("Fee payment", "Parent", "/parent/fee-payment", "Failed / cancelled payment", "Fee due exists", "Start payment|Cancel or fail in Razorpay", "Failing test card", "Fee stays unpaid; clear failure message; no receipt", H, N),
    ("Fee payment", "Parent", "/parent/fee-payment", "Tampered payment signature is rejected", "-", "Call verify with invalid signature", "-", "Verification fails; fee not marked paid", H, S),
    ("Bus tracking", "Parent", "-", "Track school bus live", "Driver trip in progress", "Open transport/bus tracking", "-", "Bus location updates on map with ETA", H, P),
    ("Hall ticket", "Parent", "/hall-tickets", "Parent downloads child's hall ticket", "Generated", "Open /hall-tickets", "-", "Child's hall ticket available", MED, P),
)

add("ERP", "School Operations (ERP)",
    ("ERP dashboard", "ERP Staff", "/erp/dashboard", "ERP dashboard loads", "ERP access", "Log in as ERP|Review dashboard", "-", "KPIs for admissions, fees, transport, library, inventory shown", H, P),
    ("People", "ERP Staff", "/erp/people", "Add a student record", "-", "Open /erp/people|Add student|Save", "-", "Student created with Student ID; appears in lists", H, P),
    ("People", "ERP Staff", "/erp/people", "Bulk import students from Excel", "Template downloaded", "Fill template|Upload|Review preview|Import", "Excel with 50 rows incl. 2 invalid", "Valid rows imported; invalid rows reported with reasons", H, P),
    ("People", "ERP Staff", "/erp/people", "Duplicate student ID / email rejected", "Record exists", "Create student with existing ID/email", "-", "Duplicate error shown", MED, N),
    ("People", "School Admin", "-", "Register teacher and driver", "-", "Register a teacher and a driver", "-", "Accounts created with correct roles; can log in", H, P),
    ("Password reset", "School Admin", "-", "Reset student passwords", "-", "Select students|Reset passwords", "-", "Passwords reset to default (DOB); students can log in", MED, P),
    ("Admissions", "ERP Staff", "/erp/admissions", "Process an admission application", "Application exists", "Open application|Review documents|Approve", "-", "Status updated to approved; student record can be created", H, P),
    ("Admissions", "School Admin", "/admissions", "Upload admission documents", "-", "Upload birth certificate etc.", "PDF/JPG", "Documents stored and viewable", MED, P),
    ("Fees", "ERP Staff", "/erp/fees", "Create fee structure and assign", "-", "Create fee heads and structure|Assign to class", "-", "Dues generated for all students in class", H, P),
    ("Fees", "ERP Staff", "/erp/fees", "Record offline payment and resend receipt", "Due exists", "Record cash payment|Resend receipt", "-", "Balance updated; receipt emailed", H, P),
    ("Fees", "ERP Staff", "/erp/fees", "AI fee assistant answers fee queries", "-", "Ask 'list defaulters for Class 6'", "-", "Accurate list returned", MED, P),
    ("Library", "ERP Staff", "/erp/library", "Issue and return a book", "Book in catalogue", "Issue book to student|Return it", "-", "Availability updates; overdue fine calculated if late", MED, P),
    ("Inventory", "ERP Staff", "/erp/inventory", "Add item and update stock", "-", "Add item|Record stock in/out", "-", "Stock levels correct; low-stock alert shown", MED, P),
    ("Transport", "School Admin", "/transport", "Create route, stops and assign students/driver", "-", "Create route|Add stops|Assign vehicle, driver, students", "-", "Route saved; assigned parents can track", H, P),
    ("Transport", "ERP Staff", "/erp/transport", "View delay prediction, traffic ETA and maintenance prediction", "Route data exists", "Open transport analytics", "-", "Predictions shown per route/vehicle", MED, P),
    ("Timetable", "School Admin", "/timetable", "Create timetable with clash check", "Classes, teachers, subjects exist", "Create timetable|Assign a teacher to two classes at the same time", "-", "Clash detected and highlighted; cannot save until resolved", H, N),
    ("Timetable", "School Admin", "/timetable", "Assign substitute for absent teacher", "Teacher absent", "Run assign substitutes", "-", "Free teachers suggested/assigned; substitute notified", MED, P),
    ("Timetable", "School Admin", "/timetable", "What-if timetable simulation", "-", "Run a what-if change", "-", "Impact shown without saving changes", L, P),
    ("Rotation schedules", "School Admin", "/rotation-schedules", "Manage rotation schedule", "-", "Create rotation|Save", "-", "Rotation visible to teachers", L, P),
    ("Attendance", "Teacher", "/attendance", "Mark class attendance", "Class timetable today", "Open /attendance|Mark present/absent/late|Save", "-", "Saved; parents of absentees notified", H, P),
    ("Attendance", "Teacher", "/attendance", "Edit attendance after saving", "Attendance saved", "Change a student status|Save", "-", "Change saved with audit", MED, P),
    ("Attendance", "Parent", "/attendance", "Parent views child attendance", "-", "Open /attendance", "-", "Only own child's attendance shown", MED, S),
    ("Exam seating", "School Admin", "/exam-seating", "Generate exam seating plan", "Rooms and students exist", "Open /exam-seating|Generate", "-", "No two adjacent students from same class (per rule); room capacity not exceeded", H, P),
    ("Hall tickets", "School Admin", "/hall-tickets", "Generate hall tickets", "Seating done", "Generate for exam", "-", "Hall tickets generated for all eligible students", H, P),
    ("Invigilation", "School Admin", "/invigilation", "Plan invigilation duties", "-", "Generate duties", "-", "No teacher double-booked; teachers see their duties", MED, P),
    ("Student transfers", "School Admin", "/student-transfers", "Transfer a student", "-", "Create transfer|Approve", "-", "Student moved; history kept; TC generated", MED, P),
    ("ID cards", "School Admin", "/id-cards", "Generate ID cards with QR", "Student photos exist", "Generate ID cards|Print", "-", "Cards correct; QR opens /verify-student/:id", MED, P),
    ("Student verify", "Teacher", "/verify-student/:id", "Verify a student via QR", "ID card generated", "Scan QR|Open link", "-", "Student details shown to authorised staff only", MED, S),
    ("Lifecycle", "School Admin", "/lifecycle-timeline", "View student lifecycle timeline", "-", "Open timeline for a student", "-", "Admission to current events listed in order", L, P),
    ("Alumni", "School Admin", "/alumni", "Manage alumni records", "-", "Open /alumni|Add / search alumni", "-", "Records saved and searchable", L, P),
    ("Branches", "School Admin", "/admin/branches", "Add a branch", "-", "Open /admin/branches|Add branch|Save", "-", "Branch created; data scoped per branch", MED, P),
    ("Facilities", "School Admin", "/admin/facilities", "Manage facilities and view utilisation", "-", "Add facility|View analytics", "-", "Facility saved; utilisation shown", L, P),
    ("Electives admin", "School Admin", "/admin/electives", "Configure electives and window", "-", "Create elective with seats|Set selection window", "-", "Students can choose within window only", MED, P),
    ("Marketplace", "School Admin", "/marketplace", "Browse marketplace", "-", "Open /marketplace", "-", "Items listed and viewable", L, P),
    ("Super admin panel", "School Admin", "/super-admin", "Manage school users and settings", "-", "Open /super-admin|Create admin user|Delete a test user", "-", "User created/deleted; deleted user cannot log in", H, P),
    ("Admin panel", "Principal", "/admin", "Admin panel functions per role", "-", "Open /admin as principal", "-", "Only functions permitted for role shown", MED, S),
    ("Automation", "School Admin", "/automation", "Create rule-based automation", "-", "Create workflow (e.g. absent 3 days -> notify parent)|Activate|Trigger condition", "-", "Action executes when condition met", MED, P),
)

add("DRV", "Driver App",
    ("Tracking", "Driver", "/driver/tracking", "Start trip and share live location", "Route assigned; location permission", "Log in as driver|Start trip", "-", "Location shared; parents see bus moving", H, P),
    ("Tracking", "Driver", "/driver/tracking", "Location permission denied", "Permission blocked", "Start trip", "-", "Clear prompt to enable location; trip not started silently", MED, N),
    ("Attendance", "Driver", "/driver/attendance", "Mark student boarding/drop", "Trip active", "Mark students boarded / dropped", "-", "Status saved; parents notified", H, P),
    ("Communication", "Driver", "/driver/communication", "Driver sends message to school/parents", "-", "Send delay message", "-", "Message delivered", MED, P),
    ("Documents", "Driver", "/driver/documents", "Upload driver documents", "-", "Upload licence", "PDF/JPG", "Document stored; expiry shown", MED, P),
    ("Ratings", "Driver", "/driver/ratings", "View ratings", "Ratings exist", "Open /driver/ratings", "-", "Ratings and feedback displayed", L, P),
)

add("PLAT", "Platform Administration (KNSOFT)",
    ("KNSOFT admin", "Platform Admin", "/knsoft-admin", "Onboard a new school", "-", "Open /knsoft-admin|Create school|Enable modules|Create school admin", "-", "School created; school admin can log in; only enabled modules visible", H, P),
    ("Multi-tenant", "Platform Admin", "/multi-tenant", "View tenants overview", "-", "Open /multi-tenant", "-", "All schools with status and usage listed", MED, P),
    ("Billing", "Platform Admin", "/billing-dashboard", "View subscription billing", "-", "Open billing dashboard", "-", "Invoices and subscription status per school", MED, P),
    ("Billing", "School Admin", "/billing", "School views its billing", "-", "Open /billing", "-", "Only own school's billing shown", MED, S),
    ("AI cost", "Platform Admin", "/ai-cost-monitoring", "Monitor AI usage and cost", "AI usage exists", "Open /ai-cost-monitoring|Filter by school/feature", "-", "Usage and cost totals correct per filter", MED, P),
    ("AI quality & safety", "Principal", "/ai-quality-safety", "Review AI quality & safety scores", "AI outputs logged", "Open /ai-quality-safety|Open a flagged item", "-", "Scores for hallucination, bias, curriculum alignment, privacy, age suitability shown", H, P),
    ("Security", "Platform Admin", "/security-dashboard", "Login anomaly detection", "Failed logins recorded", "Perform repeated failed logins|Open security dashboard", "5 failed attempts", "Anomaly flagged with user, time, IP", H, S),
    ("Security centre", "Teacher", "/security", "Sign out other devices", "Logged in on two devices", "Open /security|Sign out other devices", "-", "Other session is logged out", H, S),
    ("Audit log", "Platform Admin", "/security-dashboard", "Sensitive actions are audit logged", "-", "Delete a user / change a mark|Check audit log", "-", "Action logged with actor and timestamp", H, S),
    ("Cache", "Platform Admin", "/cache-management", "Clear cache", "-", "Open cache management|Clear cache", "-", "Cache cleared; stats refreshed", L, P),
    ("OCR", "Platform Admin", "/ocr-processing", "Monitor OCR processing jobs", "Jobs exist", "Open /ocr-processing", "-", "Job statuses shown; failed jobs can be retried", L, P),
    ("Risk prediction", "Platform Admin", "/risk-prediction", "View risk prediction dashboard", "-", "Open page", "-", "Risk scores rendered", L, P),
    ("Knowledge graph", "Platform Admin", "/knowledge-graph", "Generate knowledge graph for a subject", "Chapters loaded", "Generate graph", "-", "Graph generated and viewable", MED, P),
    ("School intelligence", "Platform Admin", "/school-intelligence", "School intelligence & what-if simulation", "-", "Open page|Run what-if scenario", "-", "Forecast changes shown for scenario", MED, P),
    ("Automation dashboard", "Platform Admin", "/automation-dashboard", "Monitor automation runs", "-", "Open page", "-", "Runs and statuses listed", L, P),
    ("AI knowledge hub", "Principal", "/ai-knowledge", "Upload knowledge content for AI", "-", "Upload document|Embed", "-", "Content indexed; AI answers reference it", L, P),
    ("Curriculum setup", "School Admin", "-", "Extract chapters and generate learning objectives from textbook", "Textbook PDF", "Upload textbook|Extract chapters|Generate objectives", "-", "Chapters, topics and objectives created", H, P),
)

add("NFR", "Non-Functional",
    ("Performance", "Any", "-", "Key pages load within acceptable time", "Production-like data", "Measure load of dashboard, my-exams, exam-reviews", "-", "Pages interactive within 3 seconds on 4G/broadband", MED, P),
    ("Performance", "Student", "/exam/:assignmentId", "Concurrent exam load", "200 students", "200 students take the same exam at once", "-", "No errors; answers saved; response time acceptable", H, P),
    ("Browser compatibility", "Any", "-", "Works on supported browsers", "-", "Run smoke tests on Chrome, Edge, Firefox, Safari", "-", "All core flows work; layout correct", MED, P),
    ("Android app", "Any", "-", "Android app install and core flows", "APK installed", "Log in|Navigate key pages|Share a file|Use voice", "-", "App works like web; native features (push, share, speech) work", H, P),
    ("Error handling", "Any", "-", "Graceful handling of network failure", "-", "Disconnect network during an action", "-", "Friendly error toast; no blank screen; retry possible", MED, N),
    ("Security", "Any", "-", "HTTPS enforced", "-", "Open app via http://", "-", "Redirected to HTTPS", H, S),
    ("Security", "Any", "-", "Direct API/table access respects RLS", "Logged in as student", "Query another student's data via API with own token", "-", "No data returned / permission denied", H, S),
    ("Accessibility", "Any", "-", "Keyboard navigation and screen reader labels", "-", "Navigate key pages with keyboard only", "-", "All controls reachable; focus visible; labels present", MED, UI),
)

# ---------------------------------------------------------------- workbook
ARIAL = "Arial"
NAVY = "1F3864"
thin = Side(style="thin", color="BFBFBF")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
HDR_FONT = Font(name=ARIAL, bold=True, color="FFFFFF", size=10)
HDR_FILL = PatternFill("solid", fgColor=NAVY)
BODY = Font(name=ARIAL, size=10)
WRAP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(horizontal="center", vertical="top", wrap_text=True)
INPUT_FILL = PatternFill("solid", fgColor="FFF2CC")

wb = Workbook()

# --- Instructions
ins = wb.active
ins.title = "Instructions"
rows = [
    ("APAS - User Acceptance Testing (UAT) Test Cases", None),
    ("Product", "APAS (Adaptive Pedagogy & Analytics System) by KNSOFT"),
    ("Version", "1.0"),
    ("Prepared on", "27-Oct-2026"),
    ("Scope", "All user-facing modules of the web and Android app across 9 roles: Student, Parent, Teacher, HOD, Principal, School Admin, ERP Staff, Driver, Platform (KNSOFT) Admin."),
    ("", ""),
    ("How to use", None),
    ("1", "Open the 'UAT Test Cases' sheet. Filter by Module or Role to pick the cases for your session."),
    ("2", "Complete the Pre-conditions, then follow the Test Steps using the Test Data given."),
    ("3", "Fill the yellow columns only: Actual Result, Status, Tested By, Test Date, Defect ID, Remarks."),
    ("4", "Status values: Not Run, Pass, Fail, Blocked, N/A (choose from the dropdown)."),
    ("5", "For every Fail, log a defect and enter its ID in 'Defect ID'."),
    ("6", "The 'Summary' sheet updates automatically from the Status column."),
    ("", ""),
    ("Columns", None),
    ("Priority", "High = must pass for go-live; Medium = should pass; Low = nice to have."),
    ("Test Type", "Positive (happy path), Negative (invalid input / error), Security (access & data protection), UI/UX."),
    ("Route", "App URL of the screen under test. ':id' parts are placeholders for real IDs."),
    ("", ""),
    ("Example of a filled row", None),
    ("Actual Result", "Logged in successfully, landed on Student Dashboard in ~2s."),
    ("Status", "Pass"),
    ("Tested By", "QA Tester 1"),
    ("Test Date", "28-Oct-2026"),
    ("Defect ID", "(blank when Pass) e.g. APAS-123 when Fail"),
    ("", ""),
    ("Note", "Test cases were derived from the application routes, role guards (src/App.tsx) and the APAS feature set. Review and adjust test data to your UAT environment."),
]
for r in rows:
    ins.append(list(r))
ins["A1"].font = Font(name=ARIAL, bold=True, size=14, color=NAVY)
for row in ins.iter_rows(min_row=2):
    for c in row:
        c.font = BODY
        c.alignment = WRAP
for r_i, (a, b) in enumerate(rows, start=1):
    if b is None and r_i > 1:
        ins.cell(r_i, 1).font = Font(name=ARIAL, bold=True, size=11, color=NAVY)
    elif a and r_i > 1:
        ins.cell(r_i, 1).font = Font(name=ARIAL, bold=True, size=10)
ins.column_dimensions["A"].width = 20
ins.column_dimensions["B"].width = 110

# --- Test cases
ws = wb.create_sheet("UAT Test Cases")
headers = ["TC ID", "Module", "Feature", "User Role", "Route / Screen", "Test Scenario",
           "Pre-conditions", "Test Steps", "Test Data", "Expected Result", "Priority",
           "Test Type", "Actual Result", "Status", "Tested By", "Test Date", "Defect ID", "Remarks"]
widths = [12, 22, 20, 14, 22, 38, 28, 45, 20, 45, 9, 11, 30, 11, 14, 12, 12, 24]
ws.append(headers)
for i, w in enumerate(widths, start=1):
    ws.column_dimensions[get_column_letter(i)].width = w
    c = ws.cell(1, i)
    c.font, c.fill, c.alignment, c.border = HDR_FONT, HDR_FILL, CENTER, BORDER
ws.row_dimensions[1].height = 30

modules = []
r = 2
for (code, name), cases in M.items():
    modules.append(name)
    for n, (feat, role, route, scen, pre, steps, data, exp, pri, typ) in enumerate(cases, start=1):
        step_txt = "\n".join(f"{k}. {s.strip()}" for k, s in enumerate(steps.split("|"), start=1))
        vals = [f"{code}-{n:03d}", name, feat, role, route, scen, pre, step_txt, data, exp,
                pri, typ, None, "Not Run", None, None, None, None]
        for ci, v in enumerate(vals, start=1):
            c = ws.cell(r, ci, v)
            c.font, c.border = BODY, BORDER
            c.alignment = CENTER if ci in (1, 11, 12, 14, 16) else WRAP
            if ci >= 13:
                c.fill = INPUT_FILL
        r += 1
last = r - 1
ws.freeze_panes = "C2"
ws.auto_filter.ref = f"A1:R{last}"

dv = DataValidation(type="list", formula1='"Not Run,Pass,Fail,Blocked,N/A"', allow_blank=False)
dv.add(f"N2:N{last}")
ws.add_data_validation(dv)
dvd = DataValidation(type="date", operator="greaterThan", formula1="DATE(2020,1,1)", allow_blank=True)
dvd.add(f"P2:P{last}")
ws.add_data_validation(dvd)
for col in ("P",):
    for i in range(2, last + 1):
        ws[f"{col}{i}"].number_format = "DD-MMM-YYYY"
status_rng = f"N2:N{last}"
for val, color in (("Pass", "C6EFCE"), ("Fail", "FFC7CE"), ("Blocked", "FFEB9C"), ("N/A", "D9D9D9")):
    ws.conditional_formatting.add(status_rng, CellIsRule(operator="equal", formula=[f'"{val}"'],
                                  fill=PatternFill("solid", fgColor=color)))
for val, color in (("High", "C00000"), ("Medium", "BF8F00"), ("Low", "548235")):
    ws.conditional_formatting.add(f"K2:K{last}", CellIsRule(operator="equal", formula=[f'"{val}"'],
                                  font=Font(name=ARIAL, bold=True, color=color)))

# --- Summary
sm = wb.create_sheet("Summary", 1)
sm["A1"] = "UAT Execution Summary"
sm["A1"].font = Font(name=ARIAL, bold=True, size=14, color=NAVY)
TC = "'UAT Test Cases'"
B = f"{TC}!$B$2:$B${last}"
N_ = f"{TC}!$N$2:$N${last}"
K = f"{TC}!$K$2:$K${last}"
sh = ["Module", "Total", "High Priority", "Pass", "Fail", "Blocked", "Not Run", "N/A", "Executed %", "Pass %"]
sm.append([])
sm.append(sh)
hr = 3
for i, h in enumerate(sh, start=1):
    c = sm.cell(hr, i)
    c.font, c.fill, c.alignment, c.border = HDR_FONT, HDR_FILL, CENTER, BORDER
for j, name in enumerate(modules):
    rr = hr + 1 + j
    sm.cell(rr, 1, name)
    sm.cell(rr, 2, f'=COUNTIF({B},$A{rr})')
    sm.cell(rr, 3, f'=COUNTIFS({B},$A{rr},{K},"High")')
    for ci, st in zip(range(4, 9), ("Pass", "Fail", "Blocked", "Not Run", "N/A")):
        sm.cell(rr, ci, f'=COUNTIFS({B},$A{rr},{N_},"{st}")')
    sm.cell(rr, 9, f'=IF(B{rr}=0,0,(B{rr}-G{rr})/B{rr})')
    sm.cell(rr, 10, f'=IF((D{rr}+E{rr})=0,0,D{rr}/(D{rr}+E{rr}))')
tr = hr + 1 + len(modules)
sm.cell(tr, 1, "TOTAL")
for ci in range(2, 9):
    L_ = get_column_letter(ci)
    sm.cell(tr, ci, f"=SUM({L_}{hr+1}:{L_}{tr-1})")
sm.cell(tr, 9, f'=IF(B{tr}=0,0,(B{tr}-G{tr})/B{tr})')
sm.cell(tr, 10, f'=IF((D{tr}+E{tr})=0,0,D{tr}/(D{tr}+E{tr}))')
for row in sm.iter_rows(min_row=hr + 1, max_row=tr, max_col=10):
    for c in row:
        c.font, c.border = BODY, BORDER
        if c.column >= 2:
            c.alignment = Alignment(horizontal="center")
        if c.column >= 9:
            c.number_format = "0.0%"
for c in sm[tr]:
    c.font = Font(name=ARIAL, bold=True, size=10)
    c.fill = PatternFill("solid", fgColor="D9E1F2")
sm.cell(tr + 2, 1, "Executed % = (Total - Not Run) / Total.  Pass % = Pass / (Pass + Fail). All counts are formulas on the 'UAT Test Cases' sheet.").font = Font(name=ARIAL, italic=True, size=9)

# by role
rr0 = tr + 4
sm.cell(rr0, 1, "By User Role").font = Font(name=ARIAL, bold=True, size=11, color=NAVY)
rh = ["User Role", "Total", "Pass", "Fail", "Blocked", "Not Run"]
for i, h in enumerate(rh, start=1):
    c = sm.cell(rr0 + 1, i, h)
    c.font, c.fill, c.alignment, c.border = HDR_FONT, HDR_FILL, CENTER, BORDER
D = f"{TC}!$D$2:$D${last}"
roles = []
for cases in M.values():
    for cs in cases:
        if cs[1] not in roles:
            roles.append(cs[1])
for j, role in enumerate(roles):
    rr = rr0 + 2 + j
    sm.cell(rr, 1, role)
    sm.cell(rr, 2, f'=COUNTIF({D},$A{rr})')
    for ci, st in zip(range(3, 7), ("Pass", "Fail", "Blocked", "Not Run")):
        sm.cell(rr, ci, f'=COUNTIFS({D},$A{rr},{N_},"{st}")')
    for ci in range(1, 7):
        c = sm.cell(rr, ci)
        c.font, c.border = BODY, BORDER
        if ci > 1:
            c.alignment = Alignment(horizontal="center")
sm.column_dimensions["A"].width = 36
for col in "BCDEFGHIJ":
    sm.column_dimensions[col].width = 13

# --- Role access matrix (from App.tsx RoleGuard)
import re
app = open(sys.argv[2], encoding="utf-8").read()
pairs = re.findall(r'path="([^"]+)"\s+element=\{<ProtectedRoute><RoleGuard allowedRoles=\{\[([^\]]+)\]', app)
role_cols = ["student", "parent", "teacher", "hod", "principal", "admin", "school_admin", "driver", "knsoft_admin"]
rm = wb.create_sheet("Role Access Matrix")
rm.append(["Route", *role_cols, "Verified (Y/N)"])
for i in range(1, len(role_cols) + 3):
    c = rm.cell(1, i)
    c.font, c.fill, c.alignment, c.border = HDR_FONT, HDR_FILL, CENTER, BORDER
YES = PatternFill("solid", fgColor="C6EFCE")
for path, rl in pairs:
    allowed = {x.strip().strip('"') for x in rl.split(",")}
    rm.append([path, *["Allowed" if rc in allowed else "Denied" for rc in role_cols], None])
    rr = rm.max_row
    for ci in range(1, len(role_cols) + 3):
        c = rm.cell(rr, ci)
        c.font, c.border = BODY, BORDER
        if ci > 1:
            c.alignment = Alignment(horizontal="center")
        if c.value == "Allowed":
            c.fill = YES
        if ci == len(role_cols) + 2:
            c.fill = INPUT_FILL
rm.column_dimensions["A"].width = 34
for i in range(2, len(role_cols) + 3):
    rm.column_dimensions[get_column_letter(i)].width = 13
rm.freeze_panes = "B2"
rm.auto_filter.ref = f"A1:{get_column_letter(len(role_cols)+2)}{rm.max_row}"
nr = rm.max_row + 2
rm.cell(nr, 1, "Test: log in as each role and open each route. 'Denied' must redirect to /dashboard; 'Allowed' must load the page. Generated from RoleGuard rules in src/App.tsx.").font = Font(name=ARIAL, italic=True, size=9)
dvy = DataValidation(type="list", formula1='"Y,N"', allow_blank=True)
dvy.add(f"{get_column_letter(len(role_cols)+2)}2:{get_column_letter(len(role_cols)+2)}{nr-2}")
rm.add_data_validation(dvy)

from openpyxl.workbook.properties import CalcProperties
wb.calculation = CalcProperties(fullCalcOnLoad=True)
wb.save(OUT)
print("cases:", last - 1, "modules:", len(modules), "routes:", len(pairs))
