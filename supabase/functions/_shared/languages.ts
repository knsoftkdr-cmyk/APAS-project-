// supabase/functions/_shared/languages.ts
//
// Supported teaching languages for the AI Tutor and the Enrichment Content
// Generator. The client sends a short code ("te", "hi", ...); ONLY codes in this
// table are honoured, so the free-text `language` field can never be used to
// smuggle arbitrary text into a prompt. Unknown / missing codes -> English, i.e.
// exactly the pre-existing behaviour.
//
// Keep in sync with src/lib/tutorLanguages.ts (client-side picker).

export interface TeachingLanguage {
  code: string;
  name: string;   // English name
  native: string; // name in its own script
}

export const TEACHING_LANGUAGES: Record<string, TeachingLanguage> = {
  en: { code: "en", name: "English", native: "English" },
  hi: { code: "hi", name: "Hindi", native: "हिन्दी" },
  te: { code: "te", name: "Telugu", native: "తెలుగు" },
  ta: { code: "ta", name: "Tamil", native: "தமிழ்" },
  kn: { code: "kn", name: "Kannada", native: "ಕನ್ನಡ" },
  ml: { code: "ml", name: "Malayalam", native: "മലയാളം" },
  mr: { code: "mr", name: "Marathi", native: "मराठी" },
  bn: { code: "bn", name: "Bengali", native: "বাংলা" },
};

/** Returns a supported non-default language, or null for English / missing / unknown. */
export function resolveTeachingLanguage(code: unknown): TeachingLanguage | null {
  if (typeof code !== "string") return null;
  const key = code.trim().toLowerCase();
  if (key === "en" || !Object.prototype.hasOwnProperty.call(TEACHING_LANGUAGES, key)) return null;
  return TEACHING_LANGUAGES[key];
}

/** Normalised code for caching / storage ("en" when English or unknown). */
export function normaliseLanguageCode(code: unknown): string {
  return resolveTeachingLanguage(code)?.code ?? "en";
}

/**
 * Prompt block appended for non-English teaching. English returns "" so the
 * prompt is byte-for-byte what it was before this feature existed.
 */
export function languageDirective(lang: TeachingLanguage | null): string {
  if (!lang) return "";
  return `

LANGUAGE (overrides any other language preference):
- Write your ENTIRE reply in ${lang.name} (${lang.native}), using the native ${lang.name} script. Do not write ${lang.name} in English letters unless the student themselves typed in English letters.
- This includes polite refusals, encouragement, headings and step-by-step working. The student may ask in English or ${lang.name}; always answer in ${lang.name}.
- Textbooks and exams may use English terms, so the first time you use a technical or scientific term, give the ${lang.name} word followed by the English term in brackets, e.g. term (English term). After that, use whichever is clearer.
- Keep numbers, formulas, chemical symbols, units and mathematical notation in their standard form; do not translate them.
- Use simple, everyday ${lang.name} suited to the student's class; avoid heavy literary vocabulary.`;
}
