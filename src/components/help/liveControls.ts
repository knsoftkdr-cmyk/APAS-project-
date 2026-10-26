// Reads the controls that are actually on screen, so "Help with This Page" can list real buttons and tabs even on a
// page that has no hand-written entry. It only looks at the page content area (#main-content) in the browser:
// nothing is sent anywhere. Buttons that live inside tables, lists or rows are skipped because their text is
// usually a person's name or a record, not a control.

export interface LiveControls {
  heading: string | null;
  tabs: string[];
  buttons: string[];
}

const SKIP_INSIDE = "table, ul, ol, [role='row'], [role='listitem'], [role='option'], [role='grid'], [data-help-ignore]";

function visible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function nameOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  const raw = aria && aria.trim() ? aria : (el as HTMLElement).innerText || el.textContent || "";
  return raw.replace(/\s+/g, " ").trim();
}

const usable = (n: string) => n.length >= 2 && n.length <= 32 && /^[A-Za-z]/.test(n);

export function scanLiveControls(root: ParentNode | null = document.getElementById("main-content"), max = 14): LiveControls {
  if (!root) return { heading: null, tabs: [], buttons: [] };

  const h = root.querySelector("h1, h2");
  const heading = h ? nameOf(h).slice(0, 80) || null : null;

  const tabs: string[] = [];
  root.querySelectorAll("[role='tab']").forEach((el) => {
    const n = nameOf(el);
    if (usable(n) && visible(el) && !tabs.includes(n)) tabs.push(n);
  });

  const buttons: string[] = [];
  root.querySelectorAll("button, [role='button']").forEach((el) => {
    if (el.getAttribute("role") === "tab" || el.closest(SKIP_INSIDE)) return;
    const n = nameOf(el);
    if (usable(n) && visible(el) && !buttons.includes(n) && !tabs.includes(n)) buttons.push(n);
  });

  return { heading, tabs: tabs.slice(0, max), buttons: buttons.slice(0, max) };
}
