import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import translations, { ENABLE_RTL_LAYOUT, Language, isRtlLanguage, languages } from "./translations";
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

/**
 * Layout direction for <html dir>. Stays "ltr" for Arabic while
 * ENABLE_RTL_LAYOUT is off — Arabic text still reads right-to-left on its own.
 */
const layoutDir = (lang: Language): "ltr" | "rtl" =>
  ENABLE_RTL_LAYOUT && isRtlLanguage(lang) ? "rtl" : "ltr";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [language, setLang] = useState<Language>("en");

  useEffect(() => {
    if (profile && (profile as any).preferred_language) {
      setLang(normaliseLanguage((profile as any).preferred_language));
    }
  }, [profile]);

  // Mirror the active language onto <html> so CSS can pick the Arabic font.
  // Direction stays LTR until the layout is ready for the flip.
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = layoutDir(language);
  }, [language]);

  const setLanguage = async (lang: Language) => {
    setLang(lang);
    if (user) {
      await supabase
        .from("profiles")
        .update({ preferred_language: lang } as any)
        .eq("id", user.id);
    }
  };

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t: translations[language],
        dir: layoutDir(language),
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
