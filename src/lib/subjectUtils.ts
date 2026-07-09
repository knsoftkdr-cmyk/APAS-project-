// Known spelling/casing variants seen across class_teachers, teacher_subjects,
// etc. (e.g. "maths" vs "Mathematics") get folded into one canonical name.
// Keep this in sync wherever subject names are compared across tables.
export const SUBJECT_ALIASES: Record<string, string> = {
  maths: "Mathematics",
  math: "Mathematics",
  mathematics: "Mathematics",
  science: "Science",
  social: "Social Studies",
  "social studies": "Social Studies",
  english: "English",
  "computer science": "Computer Science",
  computers: "Computer Science",
  hindi: "Hindi",
  telugu: "Telugu",
};

export function normalizeSubject(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (SUBJECT_ALIASES[lower]) return SUBJECT_ALIASES[lower];
  return trimmed.replace(
    /\w\S*/g,
    (t) => t.charAt(0).toUpperCase() + t.substring(1).toLowerCase()
  );
}
