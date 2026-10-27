// Detailed "Help with This Page" entries: full workflows, what each status/message means, common problems and
// where to go next. Every sentence here was written from the page's actual source (field labels, validations,
// toast and error messages, role checks). Anything the code does not make clear is deliberately left out.
//
// src/test/pageHelp.test.ts checks that: the route exists, the listed roles pass that route's RoleGuard, every
// control label and every `quote` appears in the listed source files, and every `next` route is real and open to
// the entry's roles.

import { btn, tab, sec } from "./helpTypes";
import type { PageHelpEntry } from "./helpTypes";

const ACADEMIC_TESTS: PageHelpEntry = {
  route: "/academic-tests",
  roles: ["student"],
  name: "Academic Tests",
  purpose:
    "Practise with a test made for your class and subject. You choose the setup, answer the questions one at a time, see right away whether each answer was correct, and finish with a score. Your results are kept under Recent Tests.",
  controls: [
    sec("Start a New Test", "The setup form: class, section, subject, topic, number of questions and difficulty."),
    sec("Recent Tests", "Your earlier tests with their scores."),
    btn("Generate & Start Test", "Creates the test from your choices. It needs a class and a subject."),
    btn("Confirm Answer", "Locks in your answer for the current question and shows whether it was correct. It stays greyed out until you have answered."),
    btn("Next Question", "Moves to the next question after you have confirmed your answer. On the last question it reads View Results."),
    btn("View Results", "Shows your final score and a review of every question."),
    btn("Take Another Test", "Returns to the setup form so you can start a new test."),
    btn("Back to Tests", "Returns to the test setup screen."),
  ],
  tasks: [
    {
      title: "Take a practice test from start to finish",
      before: [
        "Your school must have subjects set up for your class.",
        "Class and Section are greyed out and already filled in when your profile has them; you cannot change those two here.",
      ],
      steps: [
        "In Start a New Test, choose your Class (marked with a red star, so it is required). If it is greyed out it is already set from your profile.",
        "Choose a Section if the field is not already filled in. It is optional.",
        "Choose a Subject. The list loads from the subjects your school has for that class, and it stays disabled until a class is chosen.",
        "Optionally type a Topic to focus the questions on one area.",
        "Set Number of Questions (the default is 10) and Level of Difficulty (the default is medium).",
        "Press Generate & Start Test. A loading screen appears while the questions are prepared.",
        "For each question, pick an option (or type your answer if the question is a written one), then press Confirm Answer.",
        "Read the feedback: you see Correct! or Incorrect with an explanation. For written questions that you got wrong, the correct answer is shown too.",
        "Press Next Question. On the last question press View Results.",
      ],
      result:
        "You see your score out of the total, the number correct and incorrect, your percentage, an encouraging message (Outstanding!, Great Job!, Good Effort! or Keep Practicing!) and a review of each question. The test also appears under Recent Tests. If you score below 50%, APAS sends a Performance Alert to your parent.",
    },
  ],
  problems: [
    {
      problem: "The Subject list is empty.",
      quote: "No subjects available for this class at your school",
      fix: "Your school has no subjects set up for that class yet. Try a different class if you picked the wrong one, otherwise tell your teacher or school admin.",
    },
    {
      problem: "The Subject box is greyed out.",
      quote: "Select a class first",
      fix: "Choose a Class first. The subjects depend on it.",
    },
    {
      problem: "The Subject box says your profile has no school.",
      quote: "No school linked to your profile",
      fix: "Your account is not linked to a school, so subjects cannot load. Ask your school admin to check your account.",
    },
    {
      problem: "A message says you must pick a class and subject.",
      quote: "Please select class and subject",
      fix: "Choose both a Class and a Subject, then press Generate & Start Test again.",
    },
    {
      problem: "The test could not be created.",
      quote: "Failed to generate questions",
      fix: "You are returned to the setup screen with your choices still there. Press Generate & Start Test again. If it keeps failing, tell your teacher what the message says.",
    },
    {
      problem: "Confirm Answer will not press.",
      fix: "It stays disabled until you choose an option, or type something for a written question.",
    },
  ],
  next: [
    { label: "AI Tutor", route: "/ai-tutor", why: "Ask the tutor to explain any question you got wrong." },
    { label: "Gamification", route: "/gamification", why: "Try an adaptive practice round." },
    { label: "Leaderboard", route: "/leaderboard", why: "See how you rank." },
  ],
  sources: ["src/pages/AcademicTests.tsx"],
};

const DIAGNOSTIC: PageHelpEntry = {
  route: "/diagnostic",
  roles: ["student"],
  name: "Assessments",
  purpose:
    "Take your diagnostic assessment. You first confirm a few details about yourself, then answer the questions in sections. Your results show up in Your Assessment Results on Home.",
  controls: [
    btn("Start Assessment", "Begins the assessment. It stays greyed out until every detail in the form is filled in."),
    btn("OK, Continue", "Closes the Before You Begin note and starts the questions."),
    btn("Previous", "Goes back to the previous question. It is disabled on the first question."),
    btn("Next", "Moves to the next question."),
    btn("Submit Assessment", "Sends your answers. The button shows how many questions you have answered, for example 10/20."),
    btn("Yes, Submit", "Confirms the submission in the check-before-sending box."),
  ],
  tasks: [
    {
      title: "Complete your diagnostic assessment",
      before: ["You need to know your Class Teacher, because choosing a teacher is required."],
      steps: [
        "Fill in Full Name and Age.",
        "Choose your Class (already filled in and greyed out if your profile has it) and type your Section, for example A, B or C (also locked if your profile has it).",
        "Choose your Curriculum: CBSE, IB, Cambridge or SCERT.",
        "Choose your Class Teacher from the list (it says Loading teachers while it fetches them).",
        "Press Start Assessment. All six details are required; the button stays greyed out until they are all filled.",
        "Read the Before You Begin note and press OK, Continue. For the youngest age group the note is addressed to the parent or teacher who will help.",
        "Answer each question. Press Next to move on and Previous to go back; the page shows how many questions you have answered and which question of the section you are on.",
        "When you are done press Submit Assessment. A box asks Are you sure you want to submit? and tells you how many questions are still unanswered.",
        "Press Yes, Submit to send it, or Cancel to go back and finish the unanswered questions.",
      ],
      result:
        "You see a message that you have successfully completed the Assessment. Your results then appear in Your Assessment Results on your Home page.",
    },
  ],
  problems: [
    {
      problem: "Start Assessment is greyed out.",
      fix: "One of the six details is still empty: Full Name, Age, Class, Section, Curriculum or Class Teacher. Fill in all of them.",
    },
    {
      problem: "You cannot change Class or Section.",
      fix: "They are taken from your profile and locked. If they are wrong, ask your school admin to correct your profile.",
    },
    {
      problem: "Your submission was marked for review because it was very quick.",
      quote: "Your submission was completed very quickly and has been flagged for review.",
      fix: "The assessment still goes through, but it is flagged. Take your time on the questions next time.",
    },
    {
      problem: "Your submission was flagged for possible tampering.",
      quote: "Test submission flagged: Possible tampering detected. Please contact your teacher.",
      fix: "Do what the message says and contact your teacher.",
    },
    {
      problem: "The submission failed.",
      quote: "Failed to submit assessment",
      fix: "Press Yes, Submit again. If it keeps failing, tell your teacher the message shown.",
    },
  ],
  next: [
    { label: "Home", route: "/student-dashboard", why: "See Your Assessment Results and your homework." },
    { label: "AI Tutor", route: "/ai-tutor", why: "Get help with topics you found hard." },
    { label: "Academic Tests", route: "/academic-tests", why: "Keep practising with a test." },
  ],
  sources: ["src/pages/Diagnostic.tsx"],
};

const AI_TUTOR: PageHelpEntry = {
  route: "/ai-tutor",
  roles: ["student"],
  name: "AI Tutor",
  purpose:
    "Chat with an AI study companion. In AI Tutor mode you ask about your subjects; in Career Coach mode you talk about careers and subject choices. Your chat is saved, so you can come back to it.",
  controls: [
    btn("Enrichment", "Opens the Enrichment page for extra challenge material."),
    btn("Adaptive Practice", "Opens a box where you choose a subject and a chapter to practise."),
    btn("Explain", "Teaching style: clear explanations and examples."),
    btn("Socratic", "Teaching style: the tutor guides you with questions instead of giving the answer."),
    btn("Hints", "Teaching style: when you are stuck on a problem you get one small hint at a time."),
    btn("Clear chat", "Deletes your saved chat history with the tutor, after asking you to confirm. This cannot be undone."),
    btn("Give me the next hint", "In Hints style, asks for the next hint. After the fourth hint it becomes Show me the full solution."),
    btn("New problem", "In Hints style, starts the hint count again from hint 1."),
  ],
  tasks: [
    {
      title: "Ask the tutor a question",
      steps: [
        "Make sure the AI Tutor mode is selected (the other mode is Career Coach).",
        "Pick a Teaching style: Explain, Socratic or Hints.",
        "If you want the answers in another language, change Tutor language.",
        "Click the box and type your question, or tap one of the starter questions shown on an empty chat to put it in the box. Then press the send button.",
        "Read the answer. Keep chatting in the same box to ask follow-up questions.",
      ],
      result: "The tutor replies in the chat. While it is answering, the style, language and Clear chat controls are disabled.",
    },
    {
      title: "Work through a problem with hints",
      steps: [
        "Choose the Hints teaching style.",
        "Type the problem you are stuck on and send it. You get the first hint.",
        "Try an answer in the box, or press Give me the next hint. The page shows which hint number comes next, out of 4.",
        "After the fourth hint the button changes to Show me the full solution.",
        "Press New problem when you want to start a different problem from hint 1.",
      ],
    },
    {
      title: "Practise a chapter with Adaptive Practice",
      before: ["Your school must have active subjects (books) for the list to show anything."],
      steps: [
        "Press Adaptive Practice at the top of the page.",
        "In the box choose a subject (Choose a subject).",
        "Then choose a chapter (Choose a chapter). The chapter box stays disabled until you choose a subject.",
        "Follow the practice questions that appear in the box.",
      ],
    },
  ],
  problems: [
    {
      problem: "The tutor says you are sending too many messages.",
      quote: "Rate limit exceeded. Please wait a moment.",
      fix: "Wait a short while and send your message again.",
    },
    {
      problem: "The tutor says AI credits have run out.",
      quote: "AI credits exhausted. Please contact your administrator.",
      fix: "This is a school-level limit, so tell your teacher or school admin.",
    },
    {
      problem: "The tutor could not answer.",
      quote: "Sorry, I couldn't answer just now.",
      fix: "Send your message again. The error shown after the message says what went wrong.",
    },
    {
      problem: "Career Coach cannot be selected.",
      quote: "Career Coach is available from Class 1 onward",
      fix: "It is only open from Class 1 upward. Use the AI Tutor mode instead.",
    },
    {
      problem: "The send button is greyed out.",
      fix: "It is disabled while the box is empty or while the tutor is still answering.",
    },
    {
      problem: "You want to remove your old conversation.",
      fix: "Press Clear chat and confirm. The saved history is deleted and cannot be brought back.",
    },
  ],
  next: [
    { label: "Enrichment", route: "/enrichment", why: "Try extra challenge material." },
    { label: "Academic Tests", route: "/academic-tests", why: "Test what you just learned." },
    { label: "Gamification", route: "/gamification", why: "Play an adaptive practice round." },
  ],
  sources: ["src/pages/AITutor.tsx"],
};

const ATTENDANCE_SELF: PageHelpEntry = {
  route: "/attendance",
  roles: ["student", "parent"],
  name: "Attendance",
  purpose:
    "See attendance records on a calendar. Students see their own record; parents see their child's after choosing the child.",
  controls: [
    tab("My Attendance", "Your own attendance calendar and monthly summary."),
    sec("Monthly Summary", "The totals for the month you are looking at, shown when no day is selected."),
  ],
  tasks: [
    {
      title: "Check attendance for a day or a month",
      before: ["Parents: your child must be linked to your account."],
      steps: [
        "The page opens on My Attendance.",
        "Parents: open the Select child list and choose the child.",
        "Look at the calendar. Click a day to see that day's status on the right-hand card.",
        "To go back, click the small X on that card. The card returns to the Monthly Summary.",
      ],
      result: "A selected day shows its status, for example Present, Absent or Late. A day with no record says that no attendance was marked.",
    },
  ],
  problems: [
    {
      problem: "A parent sees no children.",
      quote: "No linked children found.",
      fix: "No child is linked to your account. Ask the school admin to link your child.",
    },
    {
      problem: "A day shows no status.",
      quote: "No attendance marked on this day.",
      fix: "The teacher has not saved attendance for that day (for example a holiday or a day not yet marked). Nothing is wrong with your account.",
    },
    {
      problem: "The month shows no data.",
      quote: "No attendance records for this month yet.",
      fix: "No attendance has been saved for that month yet.",
    },
  ],
  next: [
    { label: "Alerts", route: "/alerts", why: "Read your alerts." },
    { label: "Report Cards", route: "/report-cards", why: "Look at report cards." },
  ],
  sources: ["src/pages/AttendanceMarking.tsx"],
};

const ATTENDANCE_TEACHER: PageHelpEntry = {
  route: "/attendance",
  roles: ["teacher"],
  name: "Attendance",
  purpose:
    "Mark attendance for a class, look back at saved records, and see your own attendance on My Attendance. Teachers also get an Attendance Risk tab.",
  controls: [
    tab("Student Attendance", "Where you mark a class for a date. It opens first for teachers."),
    tab("Attendance View", "Where you review attendance that has been saved."),
    tab("My Attendance", "Your own attendance."),
    tab("Attendance Risk", "Attendance risk information."),
    btn("Mark all present", "Sets every student in the list to Present so you only change the exceptions."),
    btn("Save Attendance", "Saves what you marked."),
    btn("Early Pickup", "Opens a form to record that a student is leaving early and who is collecting them."),
    btn("Log Pickup", "Saves the early pickup."),
  ],
  tasks: [
    {
      title: "Mark attendance for a class",
      before: ["You need a class to appear in the Select class list."],
      steps: [
        "Open the Student Attendance tab.",
        "Choose the class from Select class. Each choice shows the class name and its section.",
        "Choose the date in the date box.",
        "If a Period box appears, choose the period (Period 1, Period 2 and so on). It only appears when your school marks attendance by period.",
        "Wait for the student list to load. Each student shows their name and roll number.",
        "Set a status for each student: Present, Absent, Late, Half Day or Excused. To save time press Mark all present first and then change the exceptions.",
        "Check the counter showing how many students you have marked out of the total.",
        "Press Save Attendance.",
      ],
      result:
        "You see Attendance saved. If you left students unmarked it says, for example, that attendance was saved for some of the students and that some are still unmarked. Unmarked students are skipped, never assumed present. Parents of the students you marked receive an Attendance Update notification. If you save the same class and date again, the existing records are updated.",
    },
    {
      title: "Record an early pickup",
      steps: [
        "In the Student Attendance list find the student and press Early Pickup.",
        "Choose who is collecting the student: Parent (on file), or Other — enter name. For Other, type their Full name and their Relation to student.",
        "Choose the Reason: Half day, Early leave or Other.",
        "Add Notes (optional) and press Log Pickup. Press Cancel to close without saving.",
      ],
    },
  ],
  problems: [
    {
      problem: "The student list is empty.",
      quote: "No active students found for this class/section.",
      fix: "That class and section has no active students. Check that you picked the right class, otherwise ask your school admin.",
    },
    {
      problem: "Some students were not saved.",
      fix: "A student you did not mark is skipped on purpose. Mark the remaining students and press Save Attendance again.",
    },
    {
      problem: "Saving shows an error.",
      quote: "Error:",
      fix: "The message after Error says what failed. Press Save Attendance again and, if it keeps failing, give the message to your school admin.",
    },
    {
      problem: "There is no Period box.",
      fix: "It only appears when your school's attendance setting is by period. Otherwise attendance is marked once per day.",
    },
    {
      problem: "Early pickup will not save without a name.",
      quote: "Enter the pickup person's name",
      fix: "When the pickup person is someone other than the parent on file, type their name first.",
    },
  ],
  next: [
    { label: "Dashboard", route: "/teacher-workspace", why: "See At-Risk Students and recent submissions." },
    { label: "Analytics", route: "/analytics", why: "Look at how your classes are doing." },
  ],
  sources: ["src/pages/AttendanceMarking.tsx"],
};

const ATTENDANCE_ADMIN: PageHelpEntry = {
  route: "/attendance",
  roles: ["admin", "principal"],
  name: "Attendance",
  purpose:
    "Mark and review student attendance, and also staff attendance for teachers, drivers and bus attendants. Admins also get Attendance Risk. The tabs you see depend on your role.",
  controls: [
    tab("Student Attendance", "Mark a class for a date."),
    tab("Attendance View", "Review saved student attendance."),
    tab("Teacher View", "Review teacher attendance."),
    tab("Driver Attendance", "Mark driver attendance."),
    tab("Driver View", "Review driver attendance."),
    tab("Attendance Risk", "Attendance risk information. Shown to teachers and admins."),
    btn("Mark all present", "Sets every person in the list to Present."),
    btn("Save Attendance", "Saves student attendance."),
  ],
  tasks: [
    {
      title: "Mark student attendance",
      steps: [
        "Open the Student Attendance tab and choose the class from Select class.",
        "Choose the date, and the period if a Period box appears.",
        "Set each student's status (Present, Absent, Late, Half Day or Excused), or press Mark all present and change the exceptions.",
        "Press Save Attendance. Students you did not mark are skipped, and parents of marked students get an Attendance Update notification.",
      ],
      result: "You see Attendance saved, or a count of how many students were saved and how many are still unmarked.",
    },
    {
      title: "Mark staff attendance",
      steps: [
        "Open the tab for the group you want: the teacher, driver or attendant tab.",
        "Set each person's status. Staff statuses include Present, Absent and On Leave.",
        "Save the page using the save button shown on that tab.",
      ],
    },
  ],
  problems: [
    {
      problem: "No teachers, drivers or attendants are listed.",
      quote: "No drivers found for this school.",
      fix: "The list is empty because no such staff exist for your school yet (the teacher and attendant tabs show matching messages).",
    },
    {
      problem: "The student list is empty.",
      quote: "No active students found for this class/section.",
      fix: "That class and section has no active students. Check the class you chose.",
    },
    {
      problem: "You cannot see the Attendance Risk tab.",
      fix: "It is shown to teachers and admins only, so principals do not see it.",
    },
  ],
  next: [
    { label: "Admin Panel", route: "/admin", why: "Check classes and people." },
    { label: "Reports", route: "/teacher", why: "Look at student and class reports." },
  ],
  sources: ["src/pages/AttendanceMarking.tsx"],
};

const ASSESSMENT_EVALUATION: PageHelpEntry = {
  route: "/assessment-evaluation",
  roles: ["teacher", "admin", "principal", "school_admin"],
  name: "Assessment Evaluation",
  purpose:
    "Upload a question paper and students' answer sheets, then have AI evaluate them. Files move through three statuses so you can see what still needs attention.",
  controls: [
    btn("Upload Assessment", "Opens the Upload Assessment Files box."),
    tab("Pending", "Files waiting to be evaluated."),
    tab("AI Reviewed", "Files the AI has evaluated."),
    tab("Reviewed", "Files marked as reviewed."),
    tab("All", "Every file together."),
    btn("Evaluate Selected with AI", "Sends the ticked files to the AI. It is disabled until at least one file is ticked, or while an evaluation is running."),
    btn("Select all", "Ticks every pending file in the current view."),
  ],
  tasks: [
    {
      title: "Upload answer sheets and evaluate them",
      before: [
        "You need the question paper file (PDF or image) for the assessment, or one you uploaded earlier.",
        "You need the students' answer sheets as files on your device.",
      ],
      steps: [
        "Press Upload Assessment. The Upload Assessment Files box opens.",
        "Under Question Paper, choose an earlier paper from Choose a question paper, or upload a new one (PDF or image) and give it a title such as Mid-Term Maths. If there are none yet the list says No question papers uploaded yet.",
        "Under Answer Sheets click to browse, or drag your answer sheet files in.",
        "Optionally fill in Class, Section, Subject and Student Name. These can be filled in later. Student Name is available once Class and Section are chosen.",
        "Press the upload button at the bottom of the box. It stays disabled until you have added at least one answer sheet and chosen or added a question paper. Cancel closes the box.",
        "Open the Pending tab. Tick the files you want evaluated (Select all ticks all of them), then press Evaluate Selected with AI. You can also use the evaluate button on a single file.",
        "When evaluation finishes the files move to the AI Reviewed tab. Use the view button on a file to preview it.",
      ],
      result: "You see Uploaded followed by the number of files, and later an AI evaluation complete message with how many files succeeded. Any that failed are reported with the reason.",
    },
  ],
  problems: [
    {
      problem: "Upload says you need to add an answer sheet.",
      quote: "Select at least one answer sheet to upload",
      fix: "Add at least one answer sheet file before uploading.",
    },
    {
      problem: "Upload says to choose the question paper.",
      quote: "Select the question paper for this assessment first",
      fix: "Choose an existing question paper from the list.",
    },
    {
      problem: "Upload says to upload the question paper.",
      quote: "Upload the question paper for this assessment first",
      fix: "Switch to uploading a new question paper and add the file, then upload again.",
    },
    {
      problem: "A file is rejected as unclear.",
      quote: "This file looks unclear. Please upload a clearer copy.",
      fix: "Scan or photograph the sheet again so it is sharp and well lit, then upload the new copy.",
    },
    {
      problem: "Evaluation failed for some files.",
      quote: "AI evaluation failed",
      fix: "The message names the file and the reason. Select the failed files again and press Evaluate Selected with AI.",
    },
    {
      problem: "The list is empty.",
      quote: "No files in this view yet. Upload one to get started.",
      fix: "The current tab or the class, section and question paper filters show no files. Try the All tab or reset the filters to All Classes, All Sections and All Question Papers.",
    },
  ],
  next: [
    { label: "Reports", route: "/teacher", why: "View student and class reports." },
    { label: "Analytics", route: "/analytics", why: "See how your classes are doing." },
  ],
  sources: ["src/pages/AssessmentEvaluation.tsx"],
};

const SUBMISSIONS: PageHelpEntry = {
  route: "/submissions",
  roles: ["teacher", "admin", "principal"],
  name: "Worksheet Submissions",
  purpose:
    "Review the answers students submitted on worksheets. You can let AI review them, then check, adjust and finalise the score and feedback yourself.",
  controls: [
    btn("AI Review All Pending", "Asks AI to review every pending submission. The number in brackets is how many are pending."),
    btn("AI Review", "Asks AI to review one submission."),
    sec("AI Evaluation Results", "Inside a submission: the score out of 100 and feedback the AI suggested."),
    btn("Approve & Finalize", "Saves your score and feedback and marks the submission Reviewed. It changes to Already Reviewed once done."),
    btn("Download Report", "Creates a PDF report for the submission."),
    btn("Close", "Closes the submission without saving."),
  ],
  tasks: [
    {
      title: "Review and finalise a submission",
      steps: [
        "Find the submission in the list. Its badge says Pending Review, AI Reviewed or Reviewed.",
        "Press AI Review on the submission, or AI Review All Pending to do all of them. Wait for the success message that shows the score.",
        "Open the submission. Under AI Evaluation Results read the suggested score and feedback.",
        "Type the Score you want to give. The box shows the AI's suggestion; leaving it empty saves no score. Use a number that is not negative.",
        "Type the feedback for the student in the feedback box. Its hint text shows the AI's feedback if there is one.",
        "Press Approve & Finalize.",
      ],
      result:
        "You see Marked as reviewed and feedback saved, the badge becomes Reviewed, and the student and the parent are notified that the worksheet has been reviewed.",
    },
  ],
  problems: [
    {
      problem: "The score is rejected.",
      quote: "Please enter a valid score",
      fix: "Type a plain number that is zero or higher, or leave the box empty.",
    },
    {
      problem: "AI Review All Pending does nothing.",
      quote: "No pending submissions to evaluate.",
      fix: "There is nothing waiting. New submissions appear after students hand in worksheets.",
    },
    {
      problem: "AI review failed.",
      quote: "AI evaluation failed",
      fix: "The message after it explains the cause. Press AI Review again. In a bulk review, the success message tells you how many failed so you can retry those.",
    },
    {
      problem: "Approve & Finalize is not available.",
      quote: "Already Reviewed",
      fix: "The submission has already been finalised, so it cannot be approved again.",
    },
    {
      problem: "The page is empty.",
      quote: "No submissions yet",
      fix: "No student has submitted a worksheet yet. Check the status filter too.",
    },
  ],
  next: [
    { label: "Dashboard", route: "/teacher-workspace", why: "See recent submissions and At-Risk Students." },
    { label: "Analytics", route: "/analytics", why: "See scores and homework completion." },
  ],
  sources: ["src/pages/Submissions.tsx"],
};


const PARENT_DASHBOARD: PageHelpEntry = {
  route: "/parent-dashboard",
  roles: ["parent"],
  name: "Home",
  purpose:
    "Follow your child's progress in one place: assessment results, homework and its status, the people allowed to collect your child, and bus tracking when your child uses school transport.",
  controls: [
    tab("Test Scores", "Your child's assessment results in a table."),
    tab("Homework", "Homework assigned to your child, with its status."),
    tab("Pickup Guardians", "The people other than you who are allowed to collect your child."),
    tab("Bus Tracking", "Where the school bus is. This tab only appears when transport applies to your child."),
    btn("Add Guardian", "Opens the Add Authorized Guardian form."),
    btn("View Report", "Opens the report for a homework item. It only appears once the homework is Graded."),
  ],
  tasks: [
    {
      title: "Check your child's homework",
      steps: [
        "Open the Homework tab.",
        "Read the status of each item: Pending (not handed in yet), Submitted (handed in, waiting to be graded) or Graded.",
        "For a Graded item press View Report to see its report.",
      ],
      result: "If nothing has been given you see No homework assigned yet.",
    },
    {
      title: "Add someone who may collect your child",
      before: ["Only you are recognised for early pickup until you add someone."],
      steps: [
        "Open the Pickup Guardians tab and press Add Guardian.",
        "In Add Authorized Guardian type their Full name.",
        "Type their Relation, for example grandparent or uncle. Name and relation are required.",
        "Optionally type a Phone number.",
        "Press Add. Press Cancel to close without saving.",
      ],
      result: "The person appears in the Authorized Pickup Guardians list. Remove them from that list whenever they should no longer collect your child.",
    },
  ],
  problems: [
    {
      problem: "You see no test results.",
      quote: "No test results yet.",
      fix: "Your child has not completed an assessment yet. Results appear here after they do.",
    },
    {
      problem: "You see no homework.",
      quote: "No homework assigned yet.",
      fix: "No homework has been assigned to your child yet.",
    },
    {
      problem: "The guardian form will not save.",
      quote: "Name and relation are required",
      fix: "Fill in both the Full name and the Relation, then press Add again.",
    },
    {
      problem: "You expected to see Bus Tracking.",
      fix: "The tab only appears when transport applies to your child. Ask the school if you think it should be there.",
    },
  ],
  next: [
    { label: "Appointments", route: "/appointments", why: "Book a meeting with your child's teacher." },
    { label: "Attendance", route: "/attendance", why: "See your child's attendance calendar." },
    { label: "Report Cards", route: "/report-cards", why: "Look at report cards." },
  ],
  sources: ["src/pages/ParentDashboard.tsx"],
};

const APPOINTMENTS: PageHelpEntry = {
  route: "/appointments",
  roles: ["parent"],
  name: "Appointments",
  purpose:
    "Ask for a meeting with your child's teacher, see your upcoming meetings and their status, and cancel or respond to them.",
  controls: [
    tab("History", "Past appointments."),
    sec("Available slots (next 14 days)", "The open times for the teacher you chose."),
    btn("Cancel", "Cancels an appointment that is still Pending or Confirmed."),
  ],
  tasks: [
    {
      title: "Request an appointment with a teacher",
      before: ["Your account must be linked to a child, and that child's class must have teachers."],
      steps: [
        "Under Child, choose your child.",
        "Under Teacher, choose the teacher.",
        "Under Available slots (next 14 days), click a date and time. The Reason section appears after you pick a slot.",
        "Choose the Reason: Academic concern, Behaviour discussion, General check-in or Other.",
        "Optionally add Notes about what you would like to discuss.",
        "Choose the Meeting mode: In person or Virtual. For Virtual you may paste a Meeting link; it is optional and the teacher may add one when confirming.",
        "Press the Request appointment button, which shows the date and time you picked.",
      ],
      result:
        "You see Appointment requested and that it is waiting for teacher confirmation. It appears under Upcoming with the status Pending.",
    },
    {
      title: "Cancel an appointment or answer a teacher's request",
      steps: [
        "Open the Upcoming tab.",
        "To cancel, press Cancel on a Pending or Confirmed appointment.",
        "If the teacher requested the meeting and it is Pending, you are asked to respond instead. You can confirm it, or decline it and type a reason.",
      ],
    },
  ],
  problems: [
    {
      problem: "The page says no student profile is linked.",
      quote: "No student profile is linked to your account yet.",
      fix: "Contact your school admin so your child can be linked to your account.",
    },
    {
      problem: "There are no teachers to pick.",
      quote: "No teachers found for this class yet.",
      fix: "No teacher is assigned to your child's class yet. Try again later or contact the school.",
    },
    {
      problem: "There are no slots to pick.",
      quote: "No open slots in the next 14 days for this teacher.",
      fix: "Choose a different teacher, or come back later when new slots open.",
    },
    {
      problem: "Your booking was refused because the slot was taken.",
      quote: "That slot was just booked by someone else",
      fix: "Pick another slot and press the Request appointment button again.",
    },
    {
      problem: "Booking failed for another reason.",
      quote: "Couldn't book the appointment. Try again.",
      fix: "Press the Request appointment button again.",
    },
  ],
  next: [
    { label: "Home", route: "/parent-dashboard", why: "Check scores, homework and pickup guardians." },
    { label: "Report Cards", route: "/report-cards", why: "Look at report cards before the meeting." },
  ],
  sources: ["src/pages/AppointmentBooking.tsx"],
};

const ADMIN_PANEL: PageHelpEntry = {
  route: "/admin",
  roles: ["admin", "principal", "school_admin"],
  name: "Admin Panel",
  purpose:
    "Set up your school's classes and connect people to them: create classes, put students in classes and assign teachers as primary or subject teachers.",
  controls: [
    tab("Classes", "Class Management: create and manage classes with sections."),
    tab("Students", "Student Allotment: assign students to classes."),
    tab("Teachers", "Assign teachers to classes."),
    btn("New Class", "Opens the Create New Class form."),
    btn("Create Class", "Saves the new class."),
    btn("Import Excel", "Opens the Excel import for adding data in bulk."),
    btn("Assign", "Saves a student or teacher assignment. It stays disabled until the needed choices are made."),
  ],
  tasks: [
    {
      title: "Create a class",
      steps: [
        "Open the Classes tab and press New Class.",
        "Type the Class Name, for example Class 5, Nursery or LKG. This is required; nothing is saved without it.",
        "Type the Section, for example A, B or C. If you leave it empty the section is set to A.",
        "Press Create Class.",
      ],
      result: "You see Class created and the class appears in the list. Until you create one the list says No classes created yet.",
    },
    {
      title: "Put a student in a class",
      before: ["The class and the student must already exist."],
      steps: [
        "Open the Students tab (Student Allotment).",
        "Choose the Class and then the Student.",
        "Press Assign. It stays disabled until both are chosen.",
      ],
      result: "You see Student assigned. If the student is already in that class you see Student already in this class.",
    },
    {
      title: "Assign a teacher to a class",
      steps: [
        "Open the Teachers tab.",
        "Choose the Class and the Teacher.",
        "Choose the Role: Primary Teacher or Subject Teacher.",
        "For a Subject Teacher type the Subject; it is required.",
        "Press Assign.",
      ],
      result: "You see Teacher assigned and the teacher appears for that class.",
    },
  ],
  problems: [
    {
      problem: "Assigning a subject teacher is refused.",
      quote: "Subject is required for subject teachers",
      fix: "Type the Subject, or change the Role to Primary Teacher.",
    },
    {
      problem: "Assigning a student is refused.",
      quote: "Student already in this class",
      fix: "That student is already assigned to that class. Choose a different class if that was a mistake.",
    },
    {
      problem: "The Assign button is greyed out.",
      fix: "Choose a Class and a Student (or a Class and a Teacher) first.",
    },
    {
      problem: "You are about to delete a class.",
      quote: "This will permanently delete the class AND all students enrolled in it, including their accounts.",
      fix: "Read the confirmation carefully. Deleting a class also deletes every student in it and their accounts, and it cannot be undone. Only confirm if that is what you want.",
    },
  ],
  next: [
    { label: "Timetable", route: "/timetable", why: "Check timetables." },
    { label: "Reports", route: "/teacher", why: "See student and class reports." },
  ],
  sources: ["src/pages/AdminPanel.tsx"],
};

const SUPER_ADMIN: PageHelpEntry = {
  route: "/super-admin",
  roles: ["school_admin"],
  name: "School Admin",
  purpose:
    "Run your school's accounts and settings: see quick stats, create accounts, grant or revoke ERP access, link a child to a parent, decide which roles can use which modules, and keep your school's information up to date.",
  controls: [
    tab("Overview", "Quick Stats such as total users, teachers, students and parents."),
    tab("Accounts", "Everyone in your school, with the tools to manage them."),
    tab("Permissions", "The Role Permission Matrix."),
    tab("School Info", "Your school's curriculum, academic year, branch and subscription plan."),
    btn("Create Account", "Opens the Create New Account form."),
    btn("Grant ERP Access", "Gives a user access to the ERP area."),
    btn("Save Permissions", "Saves the matrix."),
    btn("Save Changes", "Saves the School Info tab."),
  ],
  tasks: [
    {
      title: "Create an account",
      steps: [
        "Open the Accounts tab and press Create Account.",
        "Choose the Role: Teacher, Student, Principal, HOD (Head of Department) or Parent.",
        "Type the Full Name.",
        "For a Student also fill in Class and Roll Number / Student ID (both required). Section, Date of Birth and Parent Phone Number are also on the form.",
        "For every role except Student type the Email.",
        "Type a Password (the box says Min 8 characters).",
        "Press the Create Account button at the bottom of the form.",
      ],
      result: "The new account appears in the Accounts list. If anything required is empty you see All fields are required.",
    },
    {
      title: "Choose what each role can use",
      steps: [
        "Open the Permissions tab.",
        "In the Role Permission Matrix, each row is a module and each column a role. Tick the box to allow that role to use that module, or untick to remove it.",
        "Press Save Permissions.",
      ],
      result: "You see Permissions saved successfully. Pages that depend on these permissions follow what you saved.",
    },
    {
      title: "Link a child to a parent",
      steps: [
        "In the Accounts tab find the parent and open Link Child to Parent.",
        "Optionally use Filter by Class to shorten the list.",
        "Pick the child under Select Student (Choose a student), then confirm.",
      ],
      result: "You see Child linked to parent. A link can be removed again, which shows Child unlinked.",
    },
    {
      title: "Update your school's information",
      steps: [
        "Open the School Info tab.",
        "Change Curriculum, Academic Year, Branch / Sections or Subscription Plan as needed.",
        "Press Save Changes.",
      ],
      result: "You see School info saved.",
    },
  ],
  problems: [
    {
      problem: "Creating an account says fields are missing.",
      quote: "All fields are required",
      fix: "Fill in Full Name and Password, plus Email (not needed for Students). For a Student, Class and Roll Number / Student ID are required too.",
    },
    {
      problem: "Granting ERP access asks you to pick someone.",
      quote: "Please select a user",
      fix: "Choose a user in the list before pressing the grant button.",
    },
    {
      problem: "Linking a child asks you to pick a student.",
      quote: "Please select a student",
      fix: "Choose a student under Select Student before confirming.",
    },
    {
      problem: "The page says no school is linked.",
      quote: "No school linked to this account",
      fix: "Your account is not connected to a school, so nothing can load. Contact the platform administrator.",
    },
    {
      problem: "Saving permissions failed.",
      quote: "Error saving permissions",
      fix: "The message under it gives the reason. Try Save Permissions again.",
    },
  ],
  next: [
    { label: "Admin Panel", route: "/admin", why: "Create classes and assign students and teachers." },
    { label: "Executive Reporting", route: "/executive-reporting", why: "See school-level reporting." },
  ],
  sources: ["src/pages/SuperAdminPanel.tsx"],
};

const TRANSPORT: PageHelpEntry = {
  route: "/transport",
  roles: ["admin", "principal", "school_admin"],
  name: "Transport",
  purpose:
    "Manage school transport. Vehicles, drivers, attendants and routes (with their stops) each have their own tab, and each can be added, edited and deleted.",
  controls: [
    tab("Vehicles", "Your school's vehicles."),
    tab("Driver & Attendant", "Drivers and bus attendants."),
    tab("Routes & Stops", "Routes and the stops on them."),
    btn("Add Vehicle", "Opens the form to add a vehicle."),
    btn("Add Driver", "Opens the form to add a driver."),
    btn("Add Attendant", "Opens the form to add a bus attendant."),
    btn("Add Route", "Opens the form to add a route."),
    btn("Add Stop", "Opens the form to add a stop."),
  ],
  tasks: [
    {
      title: "Add a vehicle, driver, attendant or route",
      before: ["Vehicles, drivers and attendants should exist before you build routes that use them."],
      steps: [
        "Open the tab you need: Vehicles, Driver & Attendant, or Routes & Stops.",
        "Press the matching Add button (Add Vehicle, Add Driver, Add Attendant or Add Route).",
        "Fill in the form that opens and save it.",
      ],
      result: "You see Vehicle added, Driver added, Attendant added or Route added. Editing an existing record shows the same message with updated instead of added.",
    },
  ],
  problems: [
    {
      problem: "A vehicle, driver or attendant cannot be deleted.",
      quote: "may be linked to a route",
      fix: "The record is probably in use by a route. Check the routes that use it before deleting.",
    },
    {
      problem: "Saving failed.",
      quote: "Failed to save vehicle",
      fix: "The page shows the error given by the system (the driver, attendant and route forms show matching messages). Check the form and save again.",
    },
    {
      problem: "A tab is empty.",
      quote: "No vehicles added yet.",
      fix: "Nothing has been added yet. Use the Add button on that tab (drivers and attendants show their own No ... added yet messages).",
    },
  ],
  next: [
    { label: "Admin Panel", route: "/admin", why: "Manage classes and people." },
    { label: "Home", route: "/dashboard", why: "Go back to your starting page." },
  ],
  sources: ["src/pages/TransportManagement.tsx", "src/pages/AttendanceMarking.tsx"],
};

const KNSOFT_ADMIN: PageHelpEntry = {
  route: "/knsoft-admin",
  roles: ["knsoft_admin"],
  name: "Platform Admin",
  purpose:
    "Set up the schools on the platform and decide who administers each one. You can create, edit, activate or deactivate and delete schools, and create a school's first administrator.",
  controls: [
    tab("Overview", "Platform overview."),
    tab("Schools", "All Schools, with School, Admin, Curriculum, Plan and Status columns."),
    tab("Assign Admins", "School administrators and the form to add one."),
    tab("Billing", "Billing information."),
    btn("Create School", "Opens the Create New School form."),
    btn("Edit", "Opens the Edit School form for that school."),
    btn("Deactivate", "Makes an active school Inactive. The button reads Activate for an inactive school."),
    btn("Delete", "Permanently deletes the school after a confirmation."),
    btn("Assign Admin", "Opens the Assign School Admin form."),
    btn("Create & Assign Admin", "Creates the administrator's account and links it to the school."),
  ],
  tasks: [
    {
      title: "Create a school",
      steps: [
        "Open the Schools tab and press Create School.",
        "Type the School Name (required, for example Excellencia School).",
        "Optionally type the Email.",
        "Choose the Curriculum (Select curriculum) and the Subscription Plan: Basic, Standard or Premium.",
        "Press Create School in the form.",
      ],
      result: "You see School created successfully and the school appears under All Schools as Active.",
    },
    {
      title: "Give a school its administrator",
      before: ["The school must already exist."],
      steps: [
        "Open the Assign Admins tab and press Assign Admin.",
        "Choose the School.",
        "Type the Admin Full Name and Admin Email.",
        "Type a Password. The box says Min 8 characters.",
        "Press Create & Assign Admin. Every field marked with a star is required.",
      ],
      result:
        "You see School Admin assigned successfully. A new account is created and linked to the school, and the school's default permissions are set up for it.",
    },
    {
      title: "Pause or remove a school",
      steps: [
        "Open the Schools tab and find the school.",
        "Press Deactivate to switch the school to Inactive (Activate switches it back), or Edit to change its details.",
        "Press Delete only to remove the school for good. You must confirm a warning first.",
      ],
      result: "Deactivating or activating shows School deactivated or School activated.",
    },
  ],
  problems: [
    {
      problem: "Create School or Edit School says the name is missing.",
      quote: "School name is required",
      fix: "Type a School Name and save again.",
    },
    {
      problem: "Assigning an admin says fields are missing.",
      quote: "All fields are required",
      fix: "Fill in School, Admin Full Name, Admin Email and Password (at least 8 characters).",
    },
    {
      problem: "You are about to delete a school.",
      quote: "This will permanently delete all users and data for this school. This cannot be undone.",
      fix: "Deleting removes every user and all data for that school for good. Use Deactivate instead if you only want to stop access.",
    },
    {
      problem: "Creating the school failed.",
      quote: "Error creating school",
      fix: "The message under it gives the reason. Correct it and press Create School again.",
    },
    {
      problem: "The lists are empty.",
      quote: "No admins assigned yet.",
      fix: "Nothing has been added yet. Schools show No schools yet in the same way.",
    },
  ],
  next: [
    { label: "Billing", route: "/billing-dashboard", why: "See school subscriptions and invoices." },
    { label: "Security", route: "/security-dashboard", why: "Check security alerts and audit logs." },
    { label: "AI Cost Monitor", route: "/ai-cost-monitoring", why: "Track AI usage costs." },
  ],
  sources: ["src/pages/KNSoftAdminPanel.tsx"],
};

export const DETAILED_PAGE_HELP: PageHelpEntry[] = [
  ACADEMIC_TESTS,
  DIAGNOSTIC,
  AI_TUTOR,
  ATTENDANCE_SELF,
  ATTENDANCE_TEACHER,
  ATTENDANCE_ADMIN,
  ASSESSMENT_EVALUATION,
  SUBMISSIONS,
  PARENT_DASHBOARD,
  APPOINTMENTS,
  ADMIN_PANEL,
  SUPER_ADMIN,
  TRANSPORT,
  KNSOFT_ADMIN,
];
