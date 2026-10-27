import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Compass, Sparkles, Info, ArrowRight } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { getPageHelp, ROLE_LABEL, type HelpControl } from "./pageHelp";
import { scanLiveControls, type LiveControls } from "./liveControls";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only roles that have a guided tour get the "back to the tour" button. */
  canTakeTour: boolean;
  onTakeTour: () => void;
  onAskApas: () => void;
}

const KIND_LABEL: Record<HelpControl["kind"], string> = { button: "Button", tab: "Tab", section: "Section" };

export function PageHelpPanel({ open, onOpenChange, canTakeTour, onTakeTour, onAskApas }: Props) {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [live, setLive] = useState<LiveControls>({ heading: null, tabs: [], buttons: [] });

  const role = profile?.role ?? null;
  const entry = getPageHelp(pathname, role);

  // Read the screen whenever the panel opens or the page changes while it is open.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setLive(scanLiveControls()), 150);
    return () => window.clearTimeout(t);
  }, [open, pathname]);

  const pageName = entry?.name ?? live.heading ?? "This page";
  const roleLabel = role ? ROLE_LABEL[role] ?? role : "";
  const hasLive = live.tabs.length > 0 || live.buttons.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <SheetHeader className="space-y-1 border-b border-border px-5 py-4 text-left">
          <SheetTitle className="pr-6 text-base">Help with this page</SheetTitle>
          <SheetDescription>
            {pageName}
            {roleLabel ? ` · ${roleLabel}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
          {entry ? (
            <>
              <section aria-labelledby="ph-purpose">
                <h3 id="ph-purpose" className="mb-1 font-semibold text-foreground">What this page is for</h3>
                <p className="text-muted-foreground">{entry.purpose}</p>
              </section>

              {entry.tasks && entry.tasks.length > 0 && (
                <section aria-labelledby="ph-tasks">
                  <h3 id="ph-tasks" className="mb-2 font-semibold text-foreground">How to…</h3>
                  <div className="space-y-2">
                    {entry.tasks.map((t, i) => (
                      <details key={t.title} open={i === 0} className="rounded-lg border border-border bg-card px-3 py-2">
                        <summary className="cursor-pointer font-medium text-foreground">{t.title}</summary>
                        {t.before && t.before.length > 0 && (
                          <p className="mt-2 text-muted-foreground">
                            <span className="font-medium text-foreground">Before you start: </span>
                            {t.before.join(" ")}
                          </p>
                        )}
                        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
                          {t.steps.map((s) => <li key={s}>{s}</li>)}
                        </ol>
                        {t.result && (
                          <p className="mt-2 text-muted-foreground">
                            <span className="font-medium text-foreground">What you should see: </span>
                            {t.result}
                          </p>
                        )}
                      </details>
                    ))}
                  </div>
                </section>
              )}

              {entry.controls && entry.controls.length > 0 && (
                <section aria-labelledby="ph-controls">
                  <h3 id="ph-controls" className="mb-2 font-semibold text-foreground">Main buttons and sections</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {entry.controls.map((c) => (
                      <li key={`${c.kind}-${c.label}`} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{c.label}</span>
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{KIND_LABEL[c.kind]}</span>
                        </div>
                        <p className="mt-0.5 text-muted-foreground">{c.what}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {entry.problems && entry.problems.length > 0 && (
                <section aria-labelledby="ph-problems">
                  <h3 id="ph-problems" className="mb-2 font-semibold text-foreground">Common problems</h3>
                  <div className="space-y-2">
                    {entry.problems.map((p) => (
                      <details key={p.problem} className="rounded-lg border border-border bg-card px-3 py-2">
                        <summary className="cursor-pointer font-medium text-foreground">{p.problem}</summary>
                        {p.quote && <p className="mt-2 text-xs italic text-muted-foreground">Message: “{p.quote}”</p>}
                        <p className="mt-2 text-muted-foreground">{p.fix}</p>
                      </details>
                    ))}
                  </div>
                </section>
              )}

              {entry.next && entry.next.length > 0 && (
                <section aria-labelledby="ph-next">
                  <h3 id="ph-next" className="mb-2 font-semibold text-foreground">What to do next</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {entry.next.map((n) => (
                      <li key={n.route}>
                        <button
                          type="button"
                          onClick={() => { onOpenChange(false); navigate(n.route); }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-secondary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <span>
                            <span className="block font-medium text-foreground">{n.label}</span>
                            <span className="block text-muted-foreground">{n.why}</span>
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <section className="flex gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                Step-by-step help for this page has not been written yet, so nothing is guessed here. Below are the buttons and tabs
                that are on your screen right now. You can also take the guided tour or ask Ask APAS to open another page.
              </p>
            </section>
          )}

          {hasLive && (
            <section aria-labelledby="ph-live">
              <h3 id="ph-live" className="mb-1 font-semibold text-foreground">On your screen right now</h3>
              <p className="mb-2 text-xs text-muted-foreground">Read from this page in your browser. Nothing is sent anywhere.</p>
              {live.tabs.length > 0 && (
                <p className="mb-1 text-muted-foreground"><span className="font-medium text-foreground">Tabs: </span>{live.tabs.join(", ")}</p>
              )}
              {live.buttons.length > 0 && (
                <p className="text-muted-foreground"><span className="font-medium text-foreground">Buttons: </span>{live.buttons.join(", ")}</p>
              )}
            </section>
          )}
        </div>

        <div className="space-y-2 border-t border-border px-5 py-4">
          {canTakeTour && (
            <Button type="button" className="w-full justify-center gap-2" onClick={onTakeTour}>
              <Compass className="h-4 w-4" aria-hidden="true" /> Take a Guided Tour
            </Button>
          )}
          <Button type="button" variant="outline" className="w-full justify-center gap-2" onClick={onAskApas}>
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Ask APAS
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
