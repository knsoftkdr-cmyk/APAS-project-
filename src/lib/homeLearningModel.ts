// Home Learning Guidance - pure model (no network, no React). Unit-tested in src/test/homeLearningModel.test.ts.
//
// Version 1 gives general, class-appropriate suggestions for parents. It does NOT use the child's marks or any
// personal data, so it needs no database tables.

export type GradeBand = "early_years" | "lower_primary" | "upper_primary" | "middle" | "secondary" | "senior" | "general";

export type TipArea = "reading" | "maths" | "routine" | "study" | "wellbeing" | "screens" | "exams";

export interface GuidanceTip {
  id: string;
  area: TipArea;
  title: string;
  action: string;
  time: string;
  link?: { label: string; path: string };
}

export const AREA_LABELS: Record<TipArea, string> = {
  reading: "Reading and language",
  maths: "Maths",
  routine: "Daily routine",
  study: "Study habits",
  wellbeing: "Feelings and wellbeing",
  screens: "Screens and devices",
  exams: "Exams and the future",
};

export const AREA_ORDER: TipArea[] = ["reading", "maths", "study", "exams", "routine", "wellbeing", "screens"];

export const BAND_LABELS: Record<GradeBand, string> = {
  early_years: "Early years (Nursery to UKG)",
  lower_primary: "Lower primary (classes 1 to 3)",
  upper_primary: "Upper primary (classes 4 and 5)",
  middle: "Middle school (classes 6 to 8)",
  secondary: "Secondary (classes 9 and 10)",
  senior: "Senior secondary (classes 11 and 12)",
  general: "All classes",
};

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

/**
 * Turns a class label into a number. Nursery/pre-primary = -2, LKG = -1, UKG = 0, classes 1 to 12 = 1 to 12.
 * Returns null when the label cannot be understood (the page then shows general guidance).
 */
export function parseGrade(label: string | null | undefined): number | null {
  if (!label) return null;
  const text = label.trim().toLowerCase();
  if (!text) return null;
  if (/nursery|pre[-\s]?(k|primary|school)|playgroup|play\s?group/.test(text)) return -2;
  if (/\blkg\b|lower\s+kg|junior\s+kg/.test(text)) return -1;
  if (/\bukg\b|upper\s+kg|senior\s+kg/.test(text)) return 0;
  const digits = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (digits) {
    const n = Number(digits[1]);
    return n >= 1 && n <= 12 ? n : null;
  }
  const roman = text.match(/^(?:class|grade|std|standard)?\s*(xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b/);
  if (roman) return ROMAN[roman[1]] ?? null;
  return null;
}

export function bandForGrade(grade: number | null): GradeBand {
  if (grade === null) return "general";
  if (grade <= 0) return "early_years";
  if (grade <= 3) return "lower_primary";
  if (grade <= 5) return "upper_primary";
  if (grade <= 8) return "middle";
  if (grade <= 10) return "secondary";
  return "senior";
}

const MEETING_LINK = { label: "Book a meeting with the teacher", path: "/appointments" };

const TIPS: Record<GradeBand, GuidanceTip[]> = {
  early_years: [
    { id: "ey-read", area: "reading", title: "Read a picture book together", action: "Read one picture book aloud each day. Point at the pictures and ask what might happen next.", time: "10 to 15 minutes a day" },
    { id: "ey-maths", area: "maths", title: "Count things you see", action: "Count stairs, fruits or steps. Sort toys by colour or size and ask which group has more.", time: "5 to 10 minutes a day" },
    { id: "ey-study", area: "study", title: "Play with your hands", action: "Draw, use clay or build with blocks. These games build the finger control needed for writing.", time: "20 minutes, a few times a week" },
    { id: "ey-routine", area: "routine", title: "Keep the same sleep and wake-up times", action: "A steady bedtime routine, such as a bath, a story and lights out, helps your child feel ready for school.", time: "Every day" },
    { id: "ey-well", area: "wellbeing", title: "Talk about the day", action: "Ask what made them smile today and what was hard. Listen first and fix later.", time: "5 minutes at bedtime" },
    { id: "ey-screen", area: "screens", title: "Keep screen time short and shared", action: "Watch together and talk about what you saw. Switch screens off during meals.", time: "Short and supervised" },
  ],
  lower_primary: [
    { id: "lp-read", area: "reading", title: "Take turns reading aloud", action: "Let your child read one page and you read the next. Ask them to tell you the story in their own words.", time: "15 minutes a day" },
    { id: "lp-maths", area: "maths", title: "Practise number facts through games", action: "Use dice, playing cards or a shop game at home to practise adding, subtracting and tables.", time: "10 minutes a day" },
    { id: "lp-study", area: "study", title: "Ask your child to teach you", action: "Ask them to explain one thing they learned today. Explaining it shows what they understand.", time: "5 minutes a day" },
    { id: "lp-routine", area: "routine", title: "Set a fixed homework time and place", action: "Choose a quiet spot with good light and the same time each day, away from the TV.", time: "20 to 30 minutes a day" },
    { id: "lp-well", area: "wellbeing", title: "Praise effort, not only marks", action: "Say what they worked hard on, for example 'You kept trying that sum'. This builds confidence.", time: "Whenever it happens" },
    { id: "lp-screen", area: "screens", title: "Agree on screen rules together", action: "Decide how long and when screens are allowed, and keep devices in a shared room.", time: "Set once, review monthly" },
  ],
  upper_primary: [
    { id: "up-read", area: "reading", title: "Let them choose what to read", action: "Let your child pick books or magazines on topics they enjoy, then talk about what they read.", time: "20 minutes a day" },
    { id: "up-maths", area: "maths", title: "Use maths in real life", action: "Ask them to measure ingredients, work out change in a shop or plan a small budget.", time: "10 minutes, a few times a week" },
    { id: "up-study", area: "study", title: "Break homework into small parts", action: "Do one part, take a short break, then do the next. Start with the hardest subject while they are fresh.", time: "30 to 45 minutes a day" },
    { id: "up-routine", area: "routine", title: "Pack the school bag the night before", action: "Use a simple weekly planner so your child learns to track homework and tests themselves.", time: "10 minutes each evening" },
    { id: "up-well", area: "wellbeing", title: "Listen without fixing", action: "When your child shares a problem with friends or school, listen and ask what they think they could do.", time: "Whenever they want to talk" },
    { id: "up-screen", area: "screens", title: "Keep devices in a shared space", action: "Keep tablets and phones out of the bedroom at night and agree on a stop time.", time: "Every evening" },
  ],
  middle: [
    { id: "mi-read", area: "reading", title: "Read and discuss something together", action: "Share a news article or story and ask what they think. This builds understanding and opinions.", time: "15 minutes, a few times a week" },
    { id: "mi-maths", area: "maths", title: "Ask them to show their working", action: "When they get a sum wrong, ask them to talk you through the steps and find the mistake themselves.", time: "10 minutes when needed" },
    { id: "mi-study", area: "study", title: "Revise in short rounds, not one long night", action: "After each chapter, ask them to write a short summary from memory. Review it again after a few days.", time: "20 minutes, 3 times a week", link: MEETING_LINK },
    { id: "mi-routine", area: "routine", title: "Make a weekly timetable together", action: "List tests and homework on one page and leave time for sport and rest as well.", time: "15 minutes each Sunday" },
    { id: "mi-well", area: "wellbeing", title: "Check in about friends and pressure", action: "Ask open questions such as 'How are things with your friends?' Changes in mood or sleep are worth a gentle conversation.", time: "A few minutes each week" },
    { id: "mi-screen", area: "screens", title: "Set phone-free times", action: "Agree that phones stay away at meals and for an hour before sleep. Follow the rule yourself too.", time: "Every day" },
  ],
  secondary: [
    { id: "se-exam", area: "exams", title: "Plan revision weeks ahead", action: "Work backwards from the exam dates. Give each subject its own slots and keep one rest day a week.", time: "Plan once, review weekly" },
    { id: "se-study", area: "study", title: "Practise with timed past papers", action: "Ask your child to try a past paper in exam conditions, then go through the mistakes together.", time: "1 to 3 hours, once a week" },
    { id: "se-help", area: "study", title: "Get help early in difficult subjects", action: "Ask your child which subject feels hardest. Talk to that teacher before the exams get close.", time: "As soon as you notice", link: MEETING_LINK },
    { id: "se-routine", area: "routine", title: "Protect sleep during exams", action: "Late-night cramming usually hurts memory. Keep fixed sleep times and regular meals.", time: "Every night" },
    { id: "se-well", area: "wellbeing", title: "Talk about stress and avoid comparisons", action: "Ask how they feel about exams. Avoid comparing them with cousins or classmates.", time: "A few minutes each week" },
    { id: "se-future", area: "exams", title: "Start talking about interests and streams", action: "Ask what they enjoy and what they are good at before choosing a stream after class 10.", time: "One relaxed talk a month" },
  ],
  senior: [
    { id: "sn-exam", area: "exams", title: "Build a steady daily study routine", action: "Set fixed study hours with short breaks, and revisit weak chapters every week.", time: "Daily, with one rest day a week" },
    { id: "sn-mock", area: "exams", title: "Use mock tests to find weak spots", action: "After each mock test, list the topics that lost marks and plan when to revise them.", time: "After every mock test", link: MEETING_LINK },
    { id: "sn-study", area: "study", title: "Ask what support they want", action: "Ask whether they want you to quiz them, arrange a tutor or simply give them quiet time.", time: "One conversation, then review" },
    { id: "sn-routine", area: "routine", title: "Keep sleep, meals and movement regular", action: "Exercise or a walk helps focus. Keep meals and sleep at regular times, especially near exams.", time: "Every day" },
    { id: "sn-well", area: "wellbeing", title: "Watch for signs of heavy stress", action: "Look for changes in sleep, appetite or mood. If it continues, talk to the school counsellor or teacher.", time: "Ongoing", link: MEETING_LINK },
    { id: "sn-future", area: "exams", title: "Talk about colleges and careers", action: "Look at course options together and let your child lead the discussion about what they want.", time: "One conversation a month" },
  ],
  general: [
    { id: "ge-read", area: "reading", title: "Read together every day", action: "Choose something your child enjoys, take turns reading and talk about it afterwards.", time: "15 minutes a day" },
    { id: "ge-study", area: "study", title: "Ask your child to explain what they learned", action: "Explaining a lesson in their own words shows what they understand and what needs more practice.", time: "5 to 10 minutes a day" },
    { id: "ge-routine", area: "routine", title: "Keep a regular homework time and place", action: "A quiet spot at the same time each day makes studying a habit.", time: "Every day" },
    { id: "ge-well", area: "wellbeing", title: "Praise effort and listen", action: "Notice how hard your child tries, and listen to worries before offering solutions.", time: "Every day", link: MEETING_LINK },
  ],
};

export interface ChildGuidance {
  grade: number | null;
  band: GradeBand;
  bandLabel: string;
  tips: GuidanceTip[];
}

/** Guidance for one child, based only on their class label. Unknown labels get general guidance. */
export function guidanceForClass(classLabel: string | null | undefined): ChildGuidance {
  const grade = parseGrade(classLabel);
  const band = bandForGrade(grade);
  return { grade, band, bandLabel: BAND_LABELS[band], tips: TIPS[band].map((t) => ({ ...t })) };
}

export interface TipGroup {
  area: TipArea;
  label: string;
  tips: GuidanceTip[];
}

/** Groups tips under their area heading, in a fixed order. Areas with no tips are left out. */
export function groupTipsByArea(tips: GuidanceTip[]): TipGroup[] {
  return AREA_ORDER.map((area) => ({ area, label: AREA_LABELS[area], tips: tips.filter((t) => t.area === area) })).filter(
    (g) => g.tips.length > 0,
  );
}

export function allBands(): GradeBand[] {
  return Object.keys(TIPS) as GradeBand[];
}
