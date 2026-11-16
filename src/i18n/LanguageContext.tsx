import { createContext, useContext, useLayoutEffect, useState, ReactNode } from "react";
import { DirectionProvider } from "@radix-ui/react-direction";
import translations, { ENABLE_RTL_LAYOUT, Language, isRtlLanguage } from "./translations";
import { activeLanguage, persistLanguage } from "./runtime";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: typeof translations["en"];
  /** "rtl" for Arabic, "ltr" otherwise. */
  dir: "ltr" | "rtl";
}

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  setLanguage: () => {},
  t: translations.en,
  dir: "ltr",
});

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

/**
 * The language is chosen in the popup shown when the site opens
 * (LanguageSelectionDialog) and kept in this browser's storage, so it applies
 * before login and on every screen. English is the default.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  // The language this page load was started in; it only changes via reloadInto.
  const [language, setLang] = useState<Language>(activeLanguage);

  // Mirror the language onto <html> before paint, so CSS picks the Arabic font
  // and the layout direction without a visible flip.
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = layoutDir(language);
  }, [language]);

  const setLanguage = (lang: Language) => {
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
