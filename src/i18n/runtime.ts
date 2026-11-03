import { createElement, Fragment, type ReactNode } from "react";
import type { Language } from "./translations";

/**
 * Lookup used by every UI string in the app.
 *
 * The Vite plugin in tools/i18n rewrites source text at build time, e.g.
 * `<h1>Upcoming Events</h1>` into `<h1>{__apasT("Upcoming Events")}</h1>`, and
 * `<p>Submitted {date}</p>` into one message `__apasT("Submitted {0}", [date])`.
 * Source files on disk keep their plain English.
 *
 * The language is fixed for the lifetime of a page load: it is read from
 * localStorage before the app is imported (see main.tsx), and changing it
 * reloads the page. That is what lets module-level tables (nav items, option
 * lists) be translated once, when their module is first evaluated.
 */

const STORAGE_KEY = "apas.language";
const SUPPORTED: readonly Language[] = ["en", "hi", "te", "ar"];

function readStoredLanguage(): Language {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.includes(value as Language) ? (value as Language) : "en";
  } catch {
    return "en";
  }
}

const active: Language = typeof window === "undefined" ? "en" : readStoredLanguage();
let dictionary: Record<string, string> | null = null;

/** The language this page load was started in. */
export function activeLanguage(): Language {
  return active;
}

/**
 * Remembers `lang` for the next page load. Returns false when storage is
 * unavailable (private mode, blocked site data), in which case reloading would
 * not change anything and callers must not reload.
 */
export function persistLanguage(lang: Language): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
    return window.localStorage.getItem(STORAGE_KEY) === lang;
  } catch {
    return false;
  }
}

// Generated translations (locales/<lang>.json, written by tools/translate-ui.mjs)
// and reviewed overrides (locales/<lang>.overrides.json, edited by hand). Each is
// a separate chunk, so English users download neither.
const localeFiles = import.meta.glob<{ default: Record<string, string> }>("./locales/*.json");

/** Loads the active language's messages. Call once, before importing the app. */
export async function loadActiveLocale(): Promise<void> {
  if (active === "en") return;
  const generated = localeFiles[`./locales/${active}.json`];
  const overrides = localeFiles[`./locales/${active}.overrides.json`];
  try {
    const [gen, over] = await Promise.all([generated?.(), overrides?.()]);
    // Reviewed wording always wins over machine translation.
    dictionary = { ...(gen?.default ?? {}), ...(over?.default ?? {}) };
  } catch (error) {
    // A missing or broken locale must not take the app down: show English.
    console.error(`[i18n] Could not load "${active}" translations; showing English.`, error);
    dictionary = null;
  }
}

/**
 * An English plural ending chosen in code (`student{n === 1 ? "" : "s"}`).
 * Other languages pluralise inside the translated sentence, so it is dropped.
 */
export function __s(suffix: string): string {
  return active === "en" ? suffix : "";
}

const isPrimitive = (v: unknown) =>
  v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** What React would print for a primitive child. */
const asText = (v: unknown) => (v === null || v === undefined || typeof v === "boolean" ? "" : String(v));

/**
 * Translates `message`, filling `{0}`, `{1}`, ... from `args`.
 * Returns a string when every argument is plain text, so it also works for
 * attributes; otherwise returns a fragment so elements keep rendering.
 */
export function __t(message: string, args?: unknown[]): any {
  const template = dictionary?.[message] ?? message;
  if (!args || args.length === 0) return template;

  const parts = template.split(/\{(\d+)\}/); // odd indexes hold argument numbers
  if (args.every(isPrimitive)) {
    return parts.map((part, i) => (i % 2 ? asText(args[Number(part)]) : part)).join("");
  }
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => (i % 2 ? (args[Number(part)] as ReactNode) : part)),
  );
}
