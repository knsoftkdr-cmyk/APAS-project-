import { useCallback, useState } from "react";
import { HelpCircle, Compass, FileQuestion, Sparkles } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { startProductTour } from "@/components/onboarding/tourEvents";
import { PageHelpPanel } from "./PageHelpPanel";
import { openAskApas } from "./helpEvents";

interface Props {
  /** True for roles that have a guided tour (tourRoleFor(role) !== null). */
  canTakeTour: boolean;
}

/**
 * The existing header (?) button, now opening a small menu instead of starting the tour straight away:
 *   Take a Guided Tour    -> the unchanged role-based tour (startProductTour)
 *   Help with This Page   -> contextual help for the current route
 *   Ask APAS              -> opens the existing AI command bar
 */
export function HelpMenu({ canTakeTour }: Props) {
  const [panelOpen, setPanelOpen] = useState(false);

  const takeTour = useCallback(() => {
    setPanelOpen(false);
    startProductTour();
  }, []);

  const askApas = useCallback(() => {
    setPanelOpen(false);
    openAskApas();
  }, []);

  return (
    <>
      {/* modal={false}: the page behind stays interactive-safe and the help panel can open as the menu closes. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded-button p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Help"
            title="Help"
          >
            <HelpCircle className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">How can we help?</DropdownMenuLabel>
          {canTakeTour && (
            <DropdownMenuItem onSelect={takeTour} className="gap-2">
              <Compass className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Take a Guided Tour
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setPanelOpen(true)} className="gap-2">
            <FileQuestion className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Help with This Page
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={askApas} className="gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Ask APAS
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PageHelpPanel open={panelOpen} onOpenChange={setPanelOpen} canTakeTour={canTakeTour} onTakeTour={takeTour} onAskApas={askApas} />
    </>
  );
}
