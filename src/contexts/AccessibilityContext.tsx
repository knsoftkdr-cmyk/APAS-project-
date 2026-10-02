import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  DEFAULT_PREFS, TEXT_SCALE_MAX, TEXT_SCALE_MIN, TEXT_SCALE_STEP,
  applyPrefsToDocument, clampTextScale, fetchServerPrefs, isDefaultPrefs, loadLocalPrefs, prefsEqual,
  sanitizePrefs, saveLocalPrefs, saveServerPrefs,
  type AccessibilityPrefs, type AccessibilitySuggestion,
} from "@/lib/accessibility";
import {
  focusMainContent, readAloud, speechSupported, startScreenReaderEnhancer, stopReading, textToRead,
} from "@/lib/accessibilityDom";

// Accessibility Engine - dyslexia mode, screen-reader mode, keyboard navigation, text size.
// Settings apply instantly (classes on <html>, see src/index.css), are cached on the device, and follow the
// signed-in user across devices through the existing `get-mastery-history` edge function.

interface AccessibilityContextValue {
  prefs: AccessibilityPrefs;
  update: (patch: Partial<AccessibilityPrefs>) => void;
  reset: () => void;
  increaseText: () => void;
  decreaseText: () => void;
  /** "account" = saved to the signed-in user's account; "device" = this browser only. */
  savedTo: "account" | "device";
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  announce: (message: string) => void;
  suggestion: AccessibilitySuggestion | null;
  applySuggestion: () => void;
  dismissSuggestion: () => void;
  canReadAloud: boolean;
  reading: boolean;
  toggleReadAloud: () => void;
}

const noop = () => {};
const AccessibilityContext = createContext<AccessibilityContextValue>({
  prefs: DEFAULT_PREFS, update: noop, reset: noop, increaseText: noop, decreaseText: noop, savedTo: "device",
  panelOpen: false, setPanelOpen: noop, announce: noop, suggestion: null, applySuggestion: noop,
  dismissSuggestion: noop, canReadAloud: false, reading: false, toggleReadAloud: noop,
});

export const useAccessibility = () => useContext(AccessibilityContext);

const SAVE_DEBOUNCE_MS = 800;
const SUGGESTION_DISMISSED_KEY = "apas.a11y.suggestion-dismissed";

const LABELS: Record<keyof AccessibilityPrefs, string> = {
  dyslexiaMode: "Dyslexia-friendly mode",
  screenReaderMode: "Screen reader mode",
  keyboardNavigation: "Keyboard navigation",
  textScale: "Text size",
};

function describeChange(patch: Partial<AccessibilityPrefs>, next: AccessibilityPrefs): string {
  return (Object.keys(patch) as (keyof AccessibilityPrefs)[])
    .map((k) => (k === "textScale" ? `${LABELS[k]} ${next.textScale} percent.` : `${LABELS[k]} ${next[k] ? "on" : "off"}.`))
    .join(" ");
}

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  const [prefs, setPrefs] = useState<AccessibilityPrefs>(() => loadLocalPrefs());
  const prefsRef = useRef(prefs);
  const [panelOpen, setPanelOpen] = useState(false);
  const [accountSaving, setAccountSaving] = useState(true); // false once we learn the account can't store settings
  const [suggestion, setSuggestion] = useState<AccessibilitySuggestion | null>(null);
  const [reading, setReading] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const announceCount = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;
  const accountSavingRef = useRef(accountSaving);
  accountSavingRef.current = accountSaving;

  const announce = useCallback((message: string) => {
    // A changing suffix makes screen readers re-announce an identical message.
    announceCount.current += 1;
    setLiveMessage(announceCount.current % 2 ? message : `${message}\u00A0`);
  }, []);

  // ── commit: the single path every change goes through ──────────────────────────────────────────
  const scheduleServerSave = useCallback((next: AccessibilityPrefs) => {
    if (!userIdRef.current || !accountSavingRef.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveServerPrefs(next).catch(() => {
        // Not fatal: the device cache already has it. Stop retrying if the account can't store settings.
        setAccountSaving(false);
      });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const commit = useCallback((next: AccessibilityPrefs, opts: { persistToServer?: boolean } = {}) => {
    prefsRef.current = next;
    setPrefs(next);
    applyPrefsToDocument(next);
    saveLocalPrefs(next);
    if (opts.persistToServer !== false) scheduleServerSave(next);
  }, [scheduleServerSave]);

  const update = useCallback((patch: Partial<AccessibilityPrefs>) => {
    const next = sanitizePrefs({ ...prefsRef.current, ...patch });
    if (prefsEqual(next, prefsRef.current)) return;
    commit(next);
    announce(describeChange(patch, next));
  }, [commit, announce]);

  const reset = useCallback(() => {
    commit(DEFAULT_PREFS);
    announce("Accessibility settings reset to default.");
  }, [commit, announce]);

  const step = useCallback((dir: 1 | -1) => {
    const next = clampTextScale(prefsRef.current.textScale + dir * TEXT_SCALE_STEP);
    if (next === prefsRef.current.textScale) {
      announce(dir > 0 ? `Text size is already at the maximum, ${TEXT_SCALE_MAX} percent.` : `Text size is already at the minimum, ${TEXT_SCALE_MIN} percent.`);
      return;
    }
    update({ textScale: next });
  }, [update, announce]);
  const increaseText = useCallback(() => step(1), [step]);
  const decreaseText = useCallback(() => step(-1), [step]);

  // First paint: make sure the document matches state (main.tsx also does this before React renders).
  useEffect(() => { applyPrefsToDocument(prefsRef.current); }, []);

  // ── sync with the account when someone signs in ────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) { setSuggestion(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchServerPrefs();
        if (cancelled) return;
        setAccountSaving(r.persistence === "available");
        if (r.saved && r.preferences) {
          // The account's settings win over whatever the device had.
          if (!prefsEqual(r.preferences, prefsRef.current)) commit(r.preferences, { persistToServer: false });
        } else if (!isDefaultPrefs(prefsRef.current)) {
          // First sign-in with settings already chosen on this device: keep them and save them to the account.
          if (r.persistence === "available") await saveServerPrefs(prefsRef.current).catch(() => setAccountSaving(false));
        } else if (r.suggestion) {
          let dismissed = false;
          try { dismissed = localStorage.getItem(`${SUGGESTION_DISMISSED_KEY}.${user.id}`) === "1"; } catch { /* ignore */ }
          if (!dismissed) setSuggestion(r.suggestion);
        }
      } catch {
        /* offline or function unavailable: the device cache keeps working */
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, commit]);

  const applySuggestion = useCallback(() => {
    if (!suggestion) return;
    commit(sanitizePrefs({ ...prefsRef.current, ...suggestion.settings }));
    announce("Suggested accessibility settings turned on.");
    setSuggestion(null);
  }, [suggestion, commit, announce]);

  const dismissSuggestion = useCallback(() => {
    try { if (userIdRef.current) localStorage.setItem(`${SUGGESTION_DISMISSED_KEY}.${userIdRef.current}`, "1"); } catch { /* ignore */ }
    setSuggestion(null);
  }, []);

  // ── screen-reader mode ─────────────────────────────────────────────────────────────────────────
  useEffect(() => (prefs.screenReaderMode ? startScreenReaderEnhancer() : undefined), [prefs.screenReaderMode]);

  // Announce the new page and move focus to it on navigation (single-page apps otherwise stay silent).
  const firstRoute = useRef(true);
  useEffect(() => {
    stopReading();
    setReading(false);
    if (firstRoute.current) { firstRoute.current = false; return; }
    if (!prefsRef.current.screenReaderMode) return;
    const t = setTimeout(() => {
      focusMainContent();
      announce(`${document.title.split(/[|\u2013\u2014-]/)[0].trim() || "Page"} loaded.`);
    }, 200); // after AppLayout has set the new document title
    return () => clearTimeout(t);
  }, [location.pathname, announce]);

  // ── read aloud ─────────────────────────────────────────────────────────────────────────────────
  const canReadAloud = speechSupported();
  const toggleReadAloud = useCallback(() => {
    if (!speechSupported()) { announce("Read aloud isn't supported in this browser."); return; }
    if (reading) { stopReading(); setReading(false); return; }
    const text = textToRead();
    if (!text) { announce("There is nothing to read on this page."); return; }
    setReading(readAloud(text, { onEnd: () => setReading(false) }));
  }, [reading, announce]);
  useEffect(() => () => { stopReading(); clearTimeout(saveTimer.current); }, []);

  // ── keyboard shortcuts (Alt+Shift+key; e.code so they work on any keyboard layout) ──────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      const p = prefsRef.current;
      switch (e.code) {
        case "KeyA": setPanelOpen((o) => !o); break;
        case "KeyM": if (!focusMainContent()) announce("No main content found on this page."); break;
        case "KeyD": update({ dyslexiaMode: !p.dyslexiaMode }); break;
        case "KeyR": toggleReadAloud(); break;
        case "Equal": case "NumpadAdd": increaseText(); break;
        case "Minus": case "NumpadSubtract": decreaseText(); break;
        case "Digit0": case "Numpad0": update({ textScale: 100 }); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [update, increaseText, decreaseText, toggleReadAloud, announce]);

  const value = useMemo<AccessibilityContextValue>(() => ({
    prefs, update, reset, increaseText, decreaseText,
    savedTo: user && accountSaving ? "account" : "device",
    panelOpen, setPanelOpen, announce, suggestion, applySuggestion, dismissSuggestion,
    canReadAloud, reading, toggleReadAloud,
  }), [prefs, update, reset, increaseText, decreaseText, user, accountSaving, panelOpen, announce, suggestion,
    applySuggestion, dismissSuggestion, canReadAloud, reading, toggleReadAloud]);

  return (
    <AccessibilityContext.Provider value={value}>
      <a
        href="#main-content"
        className="a11y-skip-link"
        onClick={(e) => { e.preventDefault(); if (!focusMainContent()) announce("No main content found on this page."); }}
      >
        Skip to main content
      </a>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{liveMessage}</div>
    </AccessibilityContext.Provider>
  );
}
