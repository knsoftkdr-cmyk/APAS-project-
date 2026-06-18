import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import translations, { Language } from "./translations";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: typeof translations["en"];
}

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  setLanguage: async () => {},
  t: translations.en,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [language, setLang] = useState<Language>("en");

  useEffect(() => {
    if (profile && (profile as any).preferred_language) {
      setLang((profile as any).preferred_language as Language);
    }
  }, [profile]);

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
    <LanguageContext.Provider value={{ language, setLanguage, t: translations[language] }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
