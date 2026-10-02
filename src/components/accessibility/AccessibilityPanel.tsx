import { Accessibility, Minus, Plus, Square, Volume2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN, isDefaultPrefs, type AccessibilityPrefs } from "@/lib/accessibility";

type SwitchKey = Exclude<keyof AccessibilityPrefs, "textScale">;

const OPTIONS: { key: SwitchKey; title: string; description: string }[] = [
  {
    key: "dyslexiaMode",
    title: "Dyslexia-friendly mode",
    description: "Easier-to-read font, wider spacing, a soft background, and simpler AI answers.",
  },
  {
    key: "screenReaderMode",
    title: "Screen reader mode",
    description: "Announces page changes, tidies up icons for assistive tech, calms animation, and makes AI answers plain text.",
  },
  {
    key: "keyboardNavigation",
    title: "Keyboard navigation",
    description: "Large, clear focus outline so you can always see where you are when using Tab.",
  },
];

const SHORTCUTS: [string, string][] = [
  ["Alt + Shift + A", "Open or close this panel"],
  ["Alt + Shift + M", "Jump to the main content"],
  ["Alt + Shift + D", "Turn dyslexia-friendly mode on or off"],
  ["Alt + Shift + + / -", "Make text larger or smaller"],
  ["Alt + Shift + 0", "Reset text size"],
  ["Alt + Shift + R", "Read the page (or selected text) aloud"],
];

export function AccessibilityPanel() {
  const {
    prefs, update, reset, increaseText, decreaseText, savedTo, panelOpen, setPanelOpen,
    suggestion, applySuggestion, dismissSuggestion, canReadAloud, reading, toggleReadAloud,
  } = useAccessibility();

  return (
    <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Accessibility className="h-5 w-5" /> Accessibility settings
          </SheetTitle>
          <SheetDescription>
            {savedTo === "account"
              ? "Changes apply right away and are saved to your account."
              : "Changes apply right away and are saved on this device."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          {suggestion && (
            <div role="region" aria-label="Suggested settings" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Suggested for you</p>
              <p className="mt-1 text-muted-foreground">
                Based on supports your school has set up{suggestion.reasons.length ? ` (${suggestion.reasons.join(", ")})` : ""}.
                Nothing changes unless you choose.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={applySuggestion}>Turn on</Button>
                <Button size="sm" variant="outline" onClick={dismissSuggestion}>No thanks</Button>
              </div>
            </div>
          )}

          {/* Text size */}
          <section aria-labelledby="a11y-text-size">
            <h3 id="a11y-text-size" className="text-sm font-semibold">Text size</h3>
            <div className="mt-2 flex items-center gap-3">
              <Button
                variant="outline" size="icon" onClick={decreaseText}
                disabled={prefs.textScale <= TEXT_SCALE_MIN} aria-label="Decrease text size"
              >
                <Minus />
              </Button>
              <output aria-live="off" className="min-w-[4.5rem] text-center text-lg font-semibold tabular-nums">
                {prefs.textScale}%
              </output>
              <Button
                variant="outline" size="icon" onClick={increaseText}
                disabled={prefs.textScale >= TEXT_SCALE_MAX} aria-label="Increase text size"
              >
                <Plus />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => update({ textScale: 100 })} disabled={prefs.textScale === 100}>
                Reset size
              </Button>
            </div>
          </section>

          {/* Modes */}
          <section aria-labelledby="a11y-modes" className="space-y-4">
            <h3 id="a11y-modes" className="text-sm font-semibold">Display and navigation</h3>
            {OPTIONS.map((o) => (
              <div key={o.key} className="flex items-start justify-between gap-4">
                <div>
                  <label htmlFor={`a11y-${o.key}`} className="text-sm font-medium">{o.title}</label>
                  <p id={`a11y-${o.key}-desc`} className="mt-0.5 text-xs text-muted-foreground">{o.description}</p>
                </div>
                <Switch
                  id={`a11y-${o.key}`}
                  checked={prefs[o.key]}
                  onCheckedChange={(v) => update({ [o.key]: v } as Partial<AccessibilityPrefs>)}
                  aria-describedby={`a11y-${o.key}-desc`}
                />
              </div>
            ))}
          </section>

          {/* Read aloud */}
          {canReadAloud && (
            <section aria-labelledby="a11y-read">
              <h3 id="a11y-read" className="text-sm font-semibold">Read aloud</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Reads the text you have selected, or the main part of this page. This uses your browser's voice and is
                not a replacement for a full screen reader.
              </p>
              <Button className="mt-2" variant="outline" size="sm" onClick={toggleReadAloud}>
                {reading ? <Square /> : <Volume2 />} {reading ? "Stop reading" : "Read this page"}
              </Button>
            </section>
          )}

          {/* Shortcuts */}
          <section aria-labelledby="a11y-shortcuts">
            <h3 id="a11y-shortcuts" className="text-sm font-semibold">Keyboard shortcuts</h3>
            <dl className="mt-2 space-y-1.5 text-sm">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{what}</dt>
                  <dd><kbd className="whitespace-nowrap rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium">{keys}</kbd></dd>
                </div>
              ))}
            </dl>
          </section>

          <Button variant="outline" onClick={reset} disabled={isDefaultPrefs(prefs)} className="w-full">
            Reset all accessibility settings
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Opens the panel. `header` fits inside AppHeader; `floating` is for pages that have no header (login, landing). */
export function AccessibilityLauncher({ variant = "header" }: { variant?: "header" | "floating" }) {
  const { setPanelOpen, panelOpen, suggestion } = useAccessibility();
  const label = `Accessibility settings${suggestion ? ", suggestions available" : ""}`;
  const base = variant === "floating"
    ? "fixed bottom-4 left-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg hover:bg-secondary"
    : "relative rounded-button p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";
  return (
    <button
      type="button"
      onClick={() => setPanelOpen(true)}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={panelOpen}
      title="Accessibility settings (Alt+Shift+A)"
      className={base}
    >
      <Accessibility className={variant === "floating" ? "h-6 w-6" : "h-5 w-5"} />
      {suggestion && <span aria-hidden="true" className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-blue-500" />}
    </button>
  );
}

/** Floating launcher for signed-out pages; signed-in pages use the one in AppHeader. */
export function SignedOutAccessibilityLauncher() {
  const { user, loading } = useAuth();
  if (loading || user) return null;
  return <AccessibilityLauncher variant="floating" />;
}
