// Accessibility Engine - DOM helpers that can't be done with CSS alone.

// ── screen-reader mode: tidy the accessibility tree ─────────────────────────────────────────────
// Conservative on purpose. It only (a) hides purely decorative lucide icons from assistive tech (charts and
// illustrations are left alone), (b) gives
// icon-only buttons/links a name when they already carry a `title`, and (c) marks the page's <main>.
// It never invents descriptions and never touches an element that already has its own label.
function enhance(root: ParentNode): void {
  root.querySelectorAll<SVGElement>("svg.lucide:not([aria-hidden]):not([aria-label]):not([role])").forEach((svg) => {
    if (svg.querySelector("title")) return; // has its own text alternative
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
  });

  root.querySelectorAll<HTMLElement>("button:not([aria-label]):not([aria-labelledby]), a[href]:not([aria-label]):not([aria-labelledby])").forEach((el) => {
    const title = el.getAttribute("title");
    if (title && !el.textContent?.trim()) el.setAttribute("aria-label", title);
  });

  const main = document.querySelector("main");
  if (main && !main.id) main.id = "main-content";
  if (main && !main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
}

/** Starts keeping the accessibility tree tidy as React renders. Returns a stop function. */
export function startScreenReaderEnhancer(): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  enhance(document);
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhance(document);
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

// ── focus ───────────────────────────────────────────────────────────────────────────────────────
/** Moves keyboard/screen-reader focus to the page's main content (or its first heading). */
export function focusMainContent(): boolean {
  const target =
    document.getElementById("main-content") ??
    document.querySelector<HTMLElement>("main") ??
    document.querySelector<HTMLElement>("h1");
  if (!target) return false;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: false });
  return true;
}

// ── read aloud (browser speech synthesis) ───────────────────────────────────────────────────────
const MAX_SPOKEN_CHARS = 6000;

export const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

export function stopReading(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}

/** Text to read: the current selection if there is one, otherwise the visible main content. */
export function textToRead(): string {
  const selected = window.getSelection()?.toString().trim();
  if (selected) return selected.slice(0, MAX_SPOKEN_CHARS);
  const main = document.getElementById("main-content") ?? document.querySelector("main");
  return (main?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SPOKEN_CHARS);
}

export function readAloud(text: string, opts: { lang?: string; onEnd?: () => void } = {}): boolean {
  if (!speechSupported() || !text) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = opts.lang || document.documentElement.lang || "en";
  u.rate = 0.95;
  u.onend = () => opts.onEnd?.();
  u.onerror = () => opts.onEnd?.();
  window.speechSynthesis.speak(u);
  return true;
}
