import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageContext";
import { languages, Language } from "@/i18n/translations";
import { hasTranslations, languagePromptPending, markLanguagePrompted } from "@/i18n/runtime";
import apasLogo from "@/assets/APAS-logo.png";

/**
 * Asks for the display language when the site is opened, once per browser
 * session. It can only be closed by choosing a language: no close button,
 * Escape or outside click. The site behind it still loads in the current
 * language (English by default).
 */
export function LanguageSelectionDialog() {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(languagePromptPending);
  const offered = languages.filter((l) => hasTranslations(l.code));

  // Only English available: nothing to choose.
  if (offered.length < 2) return null;

  const choose = (lang: Language) => {
    markLanguagePrompted();
    setOpen(false);
    setLanguage(lang); // Reloads the page when the language changes.
  };

  const stayOpen = (event: Event) => event.preventDefault();

  return (
    <Dialog open={open}>
      <DialogContent
        // Hides DialogContent's built-in close (X) button.
        className="max-w-md [&>button:last-child]:hidden"
        onEscapeKeyDown={stayOpen}
        onPointerDownOutside={stayOpen}
        onInteractOutside={stayOpen}
      >
        <DialogHeader className="items-center text-center sm:text-center">
          <img src={apasLogo} alt="APAS" className="h-16 w-auto mb-2" />
          <DialogTitle className="text-2xl">Welcome to APAS</DialogTitle>
          <DialogDescription className="text-base">Please select your preferred language.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap justify-center gap-3 border-t pt-4">
          {offered.map((l) => (
            <Button
              key={l.code}
              lang={l.code}
              variant={l.code === language ? "default" : "outline"}
              className="min-w-28 text-base"
              onClick={() => choose(l.code)}
            >
              {l.nativeLabel}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
