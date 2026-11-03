import { createContext, useContext, useEffect, useLayoutEffect, useState, ReactNode } from "react";
import { DirectionProvider } from "@radix-ui/react-direction";
import translations, { ENABLE_RTL_LAYOUT, Language, isRtlLanguage, languages } from "./translations";
import { activeLanguage, persistLanguage } from "./runtime";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: typeof translations["en"];
  /** "rtl" for Arabic, "ltr" otherwise. */
  dir: "ltr" | "rtl";
}

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  setLanguage: async () => {},
  t: translations.en,
  dir: "ltr",
});

/**
 * profiles.preferred_language is free-text, so a stored value may be one we no
 * longer offer (or never did). Anything unknown falls back to English rather
 * than leaving `t` undefined.
 */
function normaliseLanguage(value: unknown): Language {
  return languages.some((l) => l.code === value) ? (value as Language) : "en";
}

/** Layout direction for <html dir>: right-to-left for Arabic once ENABLE_RTL_LAYOUT is on. */
const layoutDir = (lang: Language): "ltr" | "rtl" =>
  ENABLE_RTL_LAYOUT && isRtlLanguage(lang) ? "rtl" : "ltr";

/**
 * Switches the UI to `lang` by reloading the page. Most UI text is translated
 * once per page load (see runtime.ts), so a reload is what applies a new
 * language. Returns false when the choice could not be remembered (storage
 * blocked), so the caller does not reload into the same language forever.
 */
function reloadInto(lang: Language): boolean {
  if (!persistLanguage(lang)) return false;
  window.location.reload();
  return true;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  // The language this page load was started in; it only changes via reloadInto.
  const [language, setLang] = useState<Language>(activeLanguage);

  // The profile is the source of truth across devices: if it names a different
  // language than this device last used, switch to it once.
  useEffect(() => {
    const stored = (profile as any)?.preferred_language;
    if (!stored) return;
    const wanted = normaliseLanguage(stored);
    if (wanted !== activeLanguage() && !reloadInto(wanted)) setLang(wanted);
  }, [profile]);

  // Mirror the language onto <html> before paint, so CSS picks the Arabic font
  // and the layout direction without a visible flip.
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = layoutDir(language);
  }, [language]);

  const setLanguage = async (lang: Language) => {
    if (user) {
      const { error } = await supabase
        .from("profiles")
        .update({ preferred_language: lang } as any)
        .eq("id", user.id);
      // Not saved: reloading would only bounce back to the old language when the
      // profile loads, so stay put and let the caller report the failure.
      if (error) throw error;
    }
    if (lang === activeLanguage() || !reloadInto(lang)) setLang(lang);
  };

  const dir = layoutDir(language);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t: translations[language], dir }}>
      <DirectionProvider dir={dir}>{children}</DirectionProvider>
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
