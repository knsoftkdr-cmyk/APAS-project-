import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Loader2, GraduationCap, UserCog, BookOpen, ClipboardCheck, NotebookPen,
  School, Building2, Clock, X, AlertCircle, RefreshCw, type LucideIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useUniversalSearch } from "@/hooks/useUniversalSearch";
import {
  CATEGORY_META,
  MAX_QUERY_LENGTH,
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  resolveResultRoute,
  splitHighlight,
  type SearchCategory,
  type SearchResult,
} from "@/lib/universalSearch";
import { cn } from "@/lib/utils";

const CATEGORY_ICON: Record<SearchCategory, LucideIcon> = {
  students: GraduationCap,
  staff: UserCog,
  lessons: BookOpen,
  exams: ClipboardCheck,
  homework: NotebookPen,
  classes: School,
  schools: Building2,
};

// The shared CommandItem selects with a solid accent background and white text;
// results use dark text on a subtle tint instead, so override both consistently.
const ITEM_CLS =
  "gap-3 rounded-lg px-2 py-2.5 data-[selected='true']:bg-accent/10 data-[selected=true]:text-foreground";

const PLACEHOLDER = "Search students, lessons, exams, homework...";

function Highlighted({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => splitHighlight(text, query), [text, query]);
  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-accent/15 px-0.5 font-semibold text-foreground">{p.text}</mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function ResultItem({ result, query, onSelect }: { result: SearchResult; query: string; onSelect: (r: SearchResult) => void }) {
  const Icon = CATEGORY_ICON[result.category];
  return (
    <CommandItem
      value={`${result.category}:${result.id}`}
      onSelect={() => onSelect(result)}
      className={ITEM_CLS}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          <Highlighted text={result.title} query={query} />
        </span>
        {result.subtitle && (
          <span className="block truncate text-xs text-muted-foreground">{result.subtitle}</span>
        )}
      </span>
    </CommandItem>
  );
}

/**
 * Header search trigger + command-palette dialog.
 * Ctrl+K / Cmd+K opens it from anywhere in the signed-in app; Esc or clicking
 * outside closes it (Radix Dialog). Authorization is enforced by the database
 * function behind `useUniversalSearch`, not here.
 */
export function UniversalSearch() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const s = useUniversalSearch(open);

  const userId = user?.id ?? null;
  const isMac = useMemo(
    () => typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || ""),
    [],
  );

  // Ctrl+K / Cmd+K toggles the dialog from anywhere.
  useEffect(() => {
    if (!userId) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [userId]);

  // Recents are read per user each time the dialog opens; the query box always starts empty.
  useEffect(() => {
    if (open) setRecents(getRecentSearches(userId));
  }, [open, userId]);

  // Never carry a dialog (or its text) over to a different account.
  useEffect(() => {
    setOpen(false);
    s.setQuery("");
    s.setCategory("all");
    setRecents([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      s.setQuery("");
      s.setCategory("all");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (result: SearchResult) => {
    const route = resolveResultRoute(result, profile?.role);
    if (!route) {
      toast({
        title: "No page available",
        description: "This result can't be opened from your account.",
        variant: "destructive",
      });
      return;
    }
    addRecentSearch(userId, s.query);
    handleOpenChange(false);
    navigate(route);
  };

  const handleClearRecents = () => {
    clearRecentSearches(userId);
    setRecents([]);
  };

  if (!userId || !profile) return null;

  const showIdle = !s.wantsSearch;
  const showEmpty = s.hasSearched && !s.isSearching && !s.isError && s.results.length === 0;

  return (
    <>
      {/* Desktop / tablet: search field look-alike. Mobile: icon button. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        aria-keyshortcuts="Control+K Meta+K"
        className="hidden h-9 w-56 items-center gap-2 rounded-button border border-border bg-secondary/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:flex lg:w-80"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate text-left">{PLACEHOLDER}</span>
        <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 font-sans text-[10px] font-medium lg:inline">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="rounded-button p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
      >
        <Search className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="top-[calc(env(safe-area-inset-top,0px)+0.75rem)] max-h-[85dvh] translate-y-0 gap-0 overflow-hidden p-0 sm:top-[12%] sm:max-w-xl sm:p-0"
        >
          <DialogTitle className="sr-only">Search APAS</DialogTitle>
          <DialogDescription className="sr-only">
            Search students, lessons, exams, homework and more. Use the arrow keys to move and Enter to open a result.
          </DialogDescription>

          <Command shouldFilter={false} loop className="bg-transparent">
            <CommandInput
              value={s.query}
              onValueChange={s.setQuery}
              placeholder={PLACEHOLDER}
              maxLength={MAX_QUERY_LENGTH}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              className="pr-8"
              aria-label="Search"
            />

            {s.availableCategories.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2" role="group" aria-label="Filter by category">
                {(["all", ...s.availableCategories] as const).map((c) => {
                  const active = s.category === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={active}
                      onClick={() => s.setCategory(c)}
                      className={cn(
                        "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        active
                          ? "border-accent bg-accent text-accent-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      {c === "all" ? "All" : CATEGORY_META[c].label}
                    </button>
                  );
                })}
              </div>
            )}

            <CommandList className="max-h-[min(60dvh,420px)] p-2">
              {/* Idle: recent searches + examples */}
              {showIdle && (
                <>
                  {recents.length > 0 && (
                    <CommandGroup
                      heading={
                        <span className="flex items-center justify-between">
                          <span>Recent searches</span>
                          <button
                            type="button"
                            onClick={handleClearRecents}
                            className="rounded px-1 text-[11px] font-medium text-accent hover:underline"
                          >
                            Clear
                          </button>
                        </span>
                      }
                    >
                      {recents.map((r) => (
                        <CommandItem
                          key={r}
                          value={`recent:${r}`}
                          onSelect={() => s.setQuery(r)}
                          className={ITEM_CLS}
                        >
                          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate text-sm">{r}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {s.availableCategories.length > 0 && (
                    <CommandGroup heading="Try searching for">
                      {s.availableCategories.map((c) => {
                        const Icon = CATEGORY_ICON[c];
                        return (
                          <CommandItem
                            key={c}
                            value={`suggest:${c}`}
                            onSelect={() => s.setCategory(c)}
                            className={ITEM_CLS}
                          >
                            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            <span className="text-sm">
                              {CATEGORY_META[c].label}
                              <span className="text-muted-foreground"> — {CATEGORY_META[c].hint}</span>
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}
                  {s.query.trim().length > 0 && (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">Type at least 2 characters to search.</p>
                  )}
                </>
              )}

              {/* Loading */}
              {!showIdle && s.isSearching && s.results.length === 0 && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status" aria-live="polite">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Searching…
                </div>
              )}

              {/* Error + retry */}
              {!showIdle && s.isError && (
                <div className="flex flex-col items-center gap-3 px-4 py-8 text-center" role="alert">
                  <AlertCircle className="h-6 w-6 text-danger" aria-hidden="true" />
                  <p className="text-sm text-foreground">{s.errorMessage}</p>
                  <button
                    type="button"
                    onClick={s.retry}
                    className="inline-flex items-center gap-1.5 rounded-button border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
                  </button>
                </div>
              )}

              {/* Empty */}
              {!showIdle && showEmpty && (
                <div className="px-4 py-10 text-center" role="status" aria-live="polite">
                  <p className="text-sm font-medium text-foreground">No results for “{s.query.trim()}”</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Check the spelling, try fewer words{s.category !== "all" ? ", or switch the filter to All" : ""}.
                  </p>
                </div>
              )}

              {/* Results */}
              {!showIdle && !s.isError &&
                s.groups.map((g) => (
                  <CommandGroup key={g.category} heading={CATEGORY_META[g.category].label}>
                    {g.items.map((r) => (
                      <ResultItem key={`${r.category}:${r.id}`} result={r} query={s.query} onSelect={handleSelect} />
                    ))}
                  </CommandGroup>
                ))}
            </CommandList>

            <div className="hidden items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground sm:flex">
              <span>↑↓ to navigate · Enter to open</span>
              <span className="inline-flex items-center gap-1"><X className="h-3 w-3" aria-hidden="true" /> Esc to close</span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default UniversalSearch;
