// supabase/functions/_shared/differentiationModel.ts
//
// AI-assisted differentiation (sheet row 46): the same lesson material written at different levels and for
// different needs, so one lesson works for the whole class. Pure prompt + validation, shared with the tests.

export const VERSIONS = {
  support: { label: "Support", brief: "for students below grade level: simpler language, worked example first, step-by-step scaffolds, sentence starters, fewer and easier questions" },
  core: { label: "Core", brief: "for students at grade level: the standard version of the material" },
  challenge: { label: "Challenge", brief: "for students above grade level: deeper reasoning, multi-step and open-ended problems, real-world application, no hand-holding" },
  language: { label: "Language support", brief: "for students still learning the language of instruction: short sentences, a key-vocabulary glossary with simple meanings, the core idea also explained in the TEACHING LANGUAGE given" },
  visual: { label: "Visual", brief: "for visual learners: describe diagrams, tables, flowcharts and colour-coding the teacher can draw; use labelled lists and comparisons" },
  sen: { label: "SEN-friendly", brief: "for students with dyslexia / attention needs: very short chunks, one instruction per line, bold key words, checklists, plenty of white space, no dense paragraphs" },
} as const;
export type VersionKey = keyof typeof VERSIONS;
export const VERSION_KEYS = Object.keys(VERSIONS) as VersionKey[];

export const MATERIAL_TYPES = {
  worksheet: "a practice worksheet with a short explanation and questions",
  reading: "a short reading passage with comprehension questions",
  notes: "explanation notes with a worked example and a quick check",
  exit_ticket: "a 3-question exit ticket to check understanding at the end of the lesson",
  homework: "a homework task with clear instructions and questions",
} as const;
export type MaterialType = keyof typeof MATERIAL_TYPES;

export interface DiffQuestion { q: string; answer: string }
export interface DiffVersion {
  key: VersionKey; label: string; for_whom: string; student_instructions: string;
  content: string; questions: DiffQuestion[]; teacher_notes: string;
}
export interface DiffPack { title: string; learning_objective: string; versions: DiffVersion[] }

export interface DiffRequest {
  topic: string; subject?: string | null; grade?: string | null; objective?: string | null;
  materialType: MaterialType; versions: VersionKey[]; language?: string | null;
  groupCounts?: Partial<Record<"remedial" | "regular" | "enrichment", number>> | null;
  curriculumNotes?: string | null;
}

export const DIFF_SYSTEM_PROMPT = [
  "You are an expert teacher who differentiates lesson materials for mixed-ability classes in Indian schools.",
  "You output strict JSON only, no markdown fences around the JSON.",
  "Every version teaches the SAME learning objective; only the level, support and presentation change.",
  "Content must be accurate, age-appropriate and on-curriculum. Write maths in plain text (e.g. 3/4, x^2), never LaTeX.",
  "Inside \"content\" you may use simple markdown (headings, bold, bullet lists, numbered steps, tables).",
].join("\n");

export function buildDiffPrompt(r: DiffRequest): string {
  const groups = r.groupCounts && Object.values(r.groupCounts).some((n) => (n ?? 0) > 0)
    ? `CLASS GROUPS (from mastery data): ${r.groupCounts.remedial ?? 0} need support, ${r.groupCounts.regular ?? 0} at level, ${r.groupCounts.enrichment ?? 0} ready for challenge.`
    : "";
  return [
    `TOPIC: ${r.topic}`,
    r.subject ? `SUBJECT: ${r.subject}` : "",
    r.grade ? `CLASS / GRADE: ${r.grade}` : "",
    r.objective ? `LEARNING OBJECTIVE: ${r.objective}` : "LEARNING OBJECTIVE: write one clear, measurable objective for this topic.",
    `MATERIAL: ${MATERIAL_TYPES[r.materialType]}`,
    r.language && r.language !== "English" ? `TEACHING LANGUAGE (for the language-support version): ${r.language}` : "",
    groups,
    r.curriculumNotes ? `CURRICULUM CONTEXT:\n${r.curriculumNotes}` : "",
    "",
    "Write these versions, in this order:",
    ...r.versions.map((k) => `- "${k}" (${VERSIONS[k].label}): ${VERSIONS[k].brief}`),
    "",
    "Return JSON exactly:",
    "{",
    '  "title": "short title",',
    '  "learning_objective": "one sentence",',
    '  "versions": [ { "key": one of the keys above, "for_whom": "one line", "student_instructions": "1-2 lines",',
    '                  "content": "the material itself (markdown)", "questions": [ { "q": "...", "answer": "..." } ] (3-8),',
    '                  "teacher_notes": "how to use this version in class, 1-3 lines" } ]',
    "}",
  ].filter(Boolean).join("\n");
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Keeps only the requested versions, in the requested order. Null when nothing usable came back. */
export function sanitiseDiffPack(raw: Record<string, unknown> | null, wanted: VersionKey[]): DiffPack | null {
  if (!raw) return null;
  const byKey = new Map<string, Record<string, unknown>>();
  for (const v of Array.isArray(raw.versions) ? raw.versions : []) {
    if (v && typeof v === "object" && typeof (v as Record<string, unknown>).key === "string") byKey.set((v as Record<string, string>).key, v as Record<string, unknown>);
  }
  const versions: DiffVersion[] = [];
  for (const k of wanted) {
    const v = byKey.get(k);
    const content = clip(v?.content, 12000);
    if (!v || !content) continue;
    versions.push({
      key: k, label: VERSIONS[k].label, for_whom: clip(v.for_whom, 200), student_instructions: clip(v.student_instructions, 500),
      content,
      questions: (Array.isArray(v.questions) ? v.questions : [])
        .map((q) => ({ q: clip((q as Record<string, unknown>)?.q, 1000), answer: clip((q as Record<string, unknown>)?.answer, 1500) }))
        .filter((q) => q.q).slice(0, 10),
      teacher_notes: clip(v.teacher_notes, 800),
    });
  }
  if (!versions.length) return null;
  return { title: clip(raw.title, 160) || "Differentiated material", learning_objective: clip(raw.learning_objective, 400), versions };
}

/** What students see when a version is shared to the classroom: no answers, no teacher notes. */
export function studentMarkdown(pack: { title: string; learning_objective: string }, v: DiffVersion): string {
  return [
    `# ${pack.title} (${v.label})`,
    pack.learning_objective ? `**Learning objective:** ${pack.learning_objective}` : "",
    v.student_instructions ? `**Instructions:** ${v.student_instructions}` : "",
    v.content,
    v.questions.length ? "## Questions\n" + v.questions.map((q, i) => `${i + 1}. ${q.q}`).join("\n") : "",
  ].filter(Boolean).join("\n\n");
}
