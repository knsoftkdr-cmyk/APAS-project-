import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, Loader2, ArrowRight, AlertCircle, CheckCircle2, Info, Compass, Zap, ShieldAlert, HelpCircle, CornerDownLeft,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useAuth } from "@/contexts/AuthContext";
import { useCommandBar } from "@/hooks/useCommandBar";
import { isSafeRoute, type CommandParams, type CommandView } from "@/lib/commandBar";
import { MAX_COMMAND_LENGTH, type IntentKind } from "../../../supabase/functions/_shared/commandModel";
import { cn } from "@/lib/utils";

const PROMPT = "What would you like to do in APAS?";

const KIND_STYLE: Record<IntentKind, { label: string; cls: string; Icon: typeof Info }> = {
  info: { label: "Information", cls: "bg-accent/10 text-accent", Icon: Info },
  navigate: { label: "Navigation", cls: "bg-secondary text-foreground", Icon: Compass },
  action: { label: "Action", cls: "bg-amber-100 text-amber-800", Icon: Zap },
  unsupported: { label: "Not available", cls: "bg-secondary text-muted-foreground", Icon: HelpCircle },
};

const ITEM_CLS =
  "gap-3 rounded-lg px-2 py-2.5 data-[selected='true']:bg-accent/10 data-[selected=true]:text-foreground";

function KindBadge({ kind }: { kind: IntentKind }) {
  const { label, cls, Icon } = KIND_STYLE[kind];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>
      <Icon className="h-3 w-3" aria-hidden="true" /> {label}
    </span>
  );
}

function ResultView({
  view, onNavigate, onConfirm, onCancel, onPick, onRun,
}: {
  view: CommandView;
  onNavigate: (route: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onPick: (o: { intent_id: string; params?: CommandParams }) => void;
  onRun: (text: string) => void;
}) {
  const kind = (view.intent?.kind as IntentKind | undefined) ?? (view.kind === "confirm" ? "action" : view.kind === "preview" ? "action" : undefined);
  const tone =
    view.kind === "error" ? "text-danger" : view.kind === "done" ? "text-green-600" : view.kind === "forbidden" ? "text-amber-700" : "text-foreground";
  const Icon = view.kind === "error" ? AlertCircle : view.kind === "done" ? CheckCircle2 : view.kind === "forbidden" ? ShieldAlert : null;

  return (
    <div className="space-y-3 p-4" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        {kind && <KindBadge kind={kind} />}
        {view.interpreted_by === "ai" && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">Command interpreted by AI</span>
        )}
      </div>

      <p className={cn("flex items-start gap-2 text-sm font-medium", tone)}>
        {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
        <span>{view.message}</span>
      </p>

      {view.facts && view.facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {view.facts.map((f) => (
            <div key={f.label} className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{f.label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {view.rows && view.rows.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {view.rows.map((r, i) => (
            <li key={`${r.title}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.title}</p>
                {r.subtitle && <p className="truncate text-xs text-muted-foreground">{r.subtitle}</p>}
              </div>
              {isSafeRoute(r.route) && (
                <button type="button" onClick={() => onNavigate(r.route!)} className="shrink-0 rounded-button p-1.5 text-accent hover:bg-accent/10" aria-label={`Open ${r.title}`}>
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {view.preview && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-sm font-semibold">{view.preview.title}</p>
          <dl className="space-y-1">
            {view.preview.lines.map((l) => (
              <div key={l.label} className="flex flex-wrap gap-x-2 text-sm">
                <dt className="text-muted-foreground">{l.label}:</dt>
                <dd className="font-medium">{l.value}</dd>
              </div>
            ))}
          </dl>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {view.preview.consequences.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            {view.kind === "confirm" && (
              <>
                <button type="button" onClick={onConfirm} className="rounded-button bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90">
                  Confirm
                </button>
                <button type="button" onClick={onCancel} className="rounded-button border border-border px-3 py-1.5 text-sm hover:bg-secondary">
                  Cancel
                </button>
              </>
            )}
            {view.preview.handoff && isSafeRoute(view.preview.handoff.route) && (
              <button type="button" onClick={() => onNavigate(view.preview!.handoff!.route)} className="inline-flex items-center gap-1.5 rounded-button bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90">
                {view.preview.handoff.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      {view.followUp && (
        <div className="space-y-2">
          <p className="text-sm">{view.followUp.question}</p>
          <div className="flex flex-wrap gap-2">
            {view.followUp.options.map((o) => (
              <button key={`${o.intent_id}-${o.label}`} type="button" onClick={() => onPick(o)} className="rounded-full border border-border px-3 py-1 text-sm hover:bg-secondary">
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {view.suggestions && view.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {view.suggestions.map((s) => (
            <button key={s.label} type="button" onClick={() => (s.text ? onRun(s.text) : s.route && onNavigate(s.route))} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
              {s.label}
            </button>
          ))}
        </div>
      )}

      {view.note && <p className="text-xs text-muted-foreground">{view.note}</p>}

      {view.links && view.links.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {view.links.filter((l) => isSafeRoute(l.route)).map((l) => (
            <button key={l.route} type="button" onClick={() => onNavigate(l.route)} className="inline-flex items-center gap-1.5 rounded-button border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
              {l.label} <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * AI Command Bar: header button + dialog. Ctrl/Cmd+J opens it (Ctrl/Cmd+K stays with Universal Search).
 * Interpretation and every data lookup happen on the server; this component only renders.
 */
export function CommandBar() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const onNavigate = useCallback((route: string) => {
    setOpen(false);
    navigate(route);
  }, [navigate]);

  const bar = useCommandBar(onNavigate);
  const userId = user?.id ?? null;
  const isMac = useMemo(
    () => typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || ""),
    [],
  );

  useEffect(() => {
    if (!userId) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "j") { e.preventDefault(); setOpen((v) => !v); }
      // Universal Search owns Ctrl/Cmd+K; step aside rather than stacking two dialogs.
      if (k === "k") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [userId]);

  useEffect(() => { setOpen(false); }, [userId]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) bar.reset();
  };

  if (!userId || !profile) return null;
  const thinking = bar.phase === "thinking";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask APAS (AI command bar)"
        aria-keyshortcuts="Control+J Meta+J"
        className="hidden h-9 items-center gap-1.5 rounded-button border border-accent/30 bg-accent/10 px-3 text-sm font-medium text-accent transition-colors hover:bg-accent/20 md:flex"
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" /> Ask APAS
        <kbd className="hidden rounded border border-accent/30 bg-background px-1.5 py-0.5 font-sans text-[10px] lg:inline">{isMac ? "⌘J" : "Ctrl J"}</kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask APAS (AI command bar)"
        className="rounded-button p-2 text-accent transition-colors hover:bg-accent/10 md:hidden"
      >
        <Sparkles className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="top-[calc(env(safe-area-inset-top,0px)+0.75rem)] max-h-[88dvh] translate-y-0 gap-0 overflow-hidden p-0 sm:top-[10%] sm:max-w-xl sm:p-0">
          <DialogTitle className="sr-only">Ask APAS</DialogTitle>
          <DialogDescription className="sr-only">
            Type a command in plain language. Examples are listed below the box. Press Enter to run it.
          </DialogDescription>

          <Command shouldFilter={false} loop className="bg-transparent">
            <CommandInput
              value={bar.text}
              onValueChange={bar.setText}
              placeholder={PROMPT}
              maxLength={MAX_COMMAND_LENGTH}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              className="pr-8"
              aria-label={PROMPT}
              disabled={thinking}
              onKeyDown={(e) => {
                // With text typed, Enter runs the typed command (not a highlighted example).
                if (e.key === "Enter" && bar.text.trim()) {
                  e.preventDefault();
                  void bar.submit(bar.text);
                }
              }}
            />

            <CommandList className="max-h-[min(65dvh,460px)] p-0">
              {thinking && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status" aria-live="polite">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Working on it…
                </div>
              )}

              {!thinking && bar.view && (
                <ResultView
                  view={bar.view}
                  onNavigate={onNavigate}
                  onConfirm={bar.confirm}
                  onCancel={bar.cancel}
                  onPick={(o) => void bar.submit(bar.text, { intentId: o.intent_id, params: o.params })}
                  onRun={(t) => { bar.setText(t); void bar.submit(t); }}
                />
              )}

              {!thinking && !bar.view && !bar.text.trim() && (
                <CommandGroup heading="Try saying" className="p-2">
                  {bar.examples.map((ex) => {
                    const { Icon, label } = KIND_STYLE[ex.kind];
                    return (
                      <CommandItem key={ex.text} value={ex.text} onSelect={() => { bar.setText(ex.text); void bar.submit(ex.text); }} className={ITEM_CLS}>
                        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <span className="flex-1 text-sm">{ex.text}</span>
                        <span className="hidden text-[11px] text-muted-foreground sm:inline">{label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {!thinking && !bar.view && bar.text.trim() && (
                <p className="flex items-center justify-center gap-1.5 px-4 py-8 text-xs text-muted-foreground">
                  Press <CornerDownLeft className="h-3 w-3" aria-hidden="true" /> Enter to run
                </p>
              )}
            </CommandList>

            <div className="hidden items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground sm:flex">
              <span></span>
              <span>Esc to close</span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default CommandBar;
