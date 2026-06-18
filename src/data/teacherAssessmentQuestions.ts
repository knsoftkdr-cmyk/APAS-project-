export interface TeacherAssessmentQuestion {
  id: number;
  text: string;
}

export interface TeacherAgeGroupConfig {
  ageGroup: number;
  label: string;
  options: { label: string; emoji: string; value: number }[];
  questions: TeacherAssessmentQuestion[];
}

const FIVE_POINT_FREQUENCY = [
  { label: "Always", emoji: "✅", value: 5 },
  { label: "Often", emoji: "👍", value: 4 },
  { label: "Sometimes", emoji: "😐", value: 3 },
  { label: "Rarely", emoji: "👎", value: 2 },
  { label: "Never", emoji: "❌", value: 1 },
];

const FIVE_POINT_LIKERT = [
  { label: "Strongly Agree", emoji: "✅", value: 5 },
  { label: "Agree", emoji: "👍", value: 4 },
  { label: "Neutral", emoji: "😐", value: 3 },
  { label: "Disagree", emoji: "👎", value: 2 },
  { label: "Strongly Disagree", emoji: "❌", value: 1 },
];

export const TEACHER_AGE_GROUPS: TeacherAgeGroupConfig[] = [
  {
    ageGroup: 3,
    label: "Teacher Assessment — 3 Years",
    options: FIVE_POINT_FREQUENCY,
    questions: [
      { id: 1, text: "Participates in group play." },
      { id: 2, text: "Follows classroom rules." },
      { id: 3, text: "Recognizes colors." },
      { id: 4, text: "Recognizes shapes." },
      { id: 5, text: "Engages in pretend play." },
      { id: 6, text: "Shows motor control." },
      { id: 7, text: "Holds crayons properly." },
      { id: 8, text: "Listens to instructions." },
      { id: 9, text: "Responds to name." },
      { id: 10, text: "Displays curiosity." },
      { id: 11, text: "Shares with peers." },
      { id: 12, text: "Expresses needs verbally." },
      { id: 13, text: "Shows autonomy." },
      { id: 14, text: "Transitions smoothly." },
      { id: 15, text: "Engages in music." },
      { id: 16, text: "Responds to rhythm." },
      { id: 17, text: "Shows empathy." },
      { id: 18, text: "Maintains eye contact." },
      { id: 19, text: "Shows confidence." },
      { id: 20, text: "Climbs safely." },
      { id: 21, text: "Sorts objects." },
      { id: 22, text: "Identifies pictures." },
      { id: 23, text: "Recognizes animals." },
      { id: 24, text: "Imitates teacher actions." },
      { id: 25, text: "Shows attention span." },
      { id: 26, text: "Engages in storytelling." },
      { id: 27, text: "Follows simple routines." },
      { id: 28, text: "Responds to praise." },
      { id: 29, text: "Manages frustration." },
      { id: 30, text: "Interacts positively." },
    ],
  },
  {
    ageGroup: 5,
    label: "Teacher Assessment — 5 Years",
    options: FIVE_POINT_FREQUENCY,
    questions: [
      { id: 1, text: "Demonstrates linguistic skills." },
      { id: 2, text: "Shows logical reasoning." },
      { id: 3, text: "Participates in music." },
      { id: 4, text: "Displays bodily coordination." },
      { id: 5, text: "Engages socially." },
      { id: 6, text: "Shows intrapersonal awareness." },
      { id: 7, text: "Observes nature carefully." },
      { id: 8, text: "Completes assignments." },
      { id: 9, text: "Maintains classroom discipline." },
      { id: 10, text: "Participates in discussions." },
      { id: 11, text: "Solves puzzles independently." },
      { id: 12, text: "Understands instructions clearly." },
      { id: 13, text: "Shows creativity." },
      { id: 14, text: "Identifies numbers correctly." },
      { id: 15, text: "Reads basic words." },
      { id: 16, text: "Writes simple words." },
      { id: 17, text: "Maintains focus." },
      { id: 18, text: "Participates in storytelling." },
      { id: 19, text: "Engages in teamwork." },
      { id: 20, text: "Expresses ideas confidently." },
      { id: 21, text: "Recognizes patterns quickly." },
      { id: 22, text: "Demonstrates curiosity." },
      { id: 23, text: "Shows empathy." },
      { id: 24, text: "Shares materials." },
      { id: 25, text: "Adapts to transitions." },
      { id: 26, text: "Enjoys art activities." },
      { id: 27, text: "Responds to rhythm." },
      { id: 28, text: "Participates in games." },
      { id: 29, text: "Follows multi-step commands." },
      { id: 30, text: "Shows memory recall." },
    ],
  },
  {
    ageGroup: 10,
    label: "Teacher Assessment — 10 Years",
    options: FIVE_POINT_LIKERT,
    questions: [
      { id: 1, text: "The student enjoys reading academic material." },
      { id: 2, text: "The student grasps new concepts quickly." },
      { id: 3, text: "The student solves mathematical problems accurately." },
      { id: 4, text: "The student retains learned information effectively." },
      { id: 5, text: "The student participates in science-based activities." },
      { id: 6, text: "The student writes structured and clear answers." },
      { id: 7, text: "The student understands visual learning aids well." },
      { id: 8, text: "The student collaborates effectively in group work." },
      { id: 9, text: "The student submits assignments on time." },
      { id: 10, text: "The student manages classroom time efficiently." },
      { id: 11, text: "The student participates actively in physical education." },
      { id: 12, text: "The student shows talent in music or arts." },
      { id: 13, text: "The student demonstrates logical reasoning skills." },
      { id: 14, text: "The student asks relevant academic questions." },
      { id: 15, text: "The student maintains attention during lessons." },
      { id: 16, text: "The student revises and prepares consistently." },
      { id: 17, text: "The student engages in classroom discussions." },
      { id: 18, text: "The student follows multi-step instructions accurately." },
      { id: 19, text: "The student shows improvement after feedback." },
      { id: 20, text: "The student appears confident during tests." },
      { id: 21, text: "The student responds well to visual presentations." },
      { id: 22, text: "The student explains ideas clearly to peers." },
      { id: 23, text: "The student follows structured routines." },
      { id: 24, text: "The student contributes meaningfully to group tasks." },
      { id: 25, text: "The student shows intrinsic motivation to learn." },
      { id: 26, text: "The student analyzes questions before answering." },
      { id: 27, text: "The student interprets charts and graphs correctly." },
      { id: 28, text: "The student remembers processes and steps." },
      { id: 29, text: "The student takes accountability for work." },
      { id: 30, text: "The student demonstrates leadership potential." },
    ],
  },
];

export function getTeacherAgeGroupConfig(ageGroup: number): TeacherAgeGroupConfig | undefined {
  return TEACHER_AGE_GROUPS.find((g) => g.ageGroup === ageGroup);
}
