// Teaching languages offered by the AI Tutor and Enrichment pages.
// Keep in sync with supabase/functions/_shared/languages.ts (the server only honours these codes).

export interface TutorLanguage {
  code: string;
  name: string;
  native: string;
}

export const TUTOR_LANGUAGES: TutorLanguage[] = [
  { code: "en", name: "English", native: "English" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml", name: "Malayalam", native: "മലയാളം" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
];

/** Falls back to English for anything unknown (e.g. a stored preference we don't offer). */
export function normaliseTutorLanguage(code: string | null | undefined): string {
  return TUTOR_LANGUAGES.some((l) => l.code === code) ? (code as string) : "en";
}
