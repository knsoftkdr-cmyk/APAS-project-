import type { ReactNode } from "react";
import { getSoundSettings } from "../../sounds";

export const rnd = (n: number) => Math.floor(Math.random() * n);
export const pick = <T,>(a: readonly T[]): T => a[rnd(a.length)];
export const shuf = <T,>(a: readonly T[]): T[] => a.map(x => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map(x => x[1]);

/**
 * Never repeat a question: remembers what was asked per game and class (in this browser) and only
 * starts repeating after the whole pool has been used once.
 */
const KEY = "apas.little.used";
let used: Record<string, string[]> = {};
try { used = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { /* storage unavailable */ }
export function uniq<T>(k: string, arr: readonly T[], key: (x: T) => string = x => String((x as unknown as unknown[])[0])): T {
  const u = (used[k] = used[k] || []);
  let fresh = arr.filter(x => !u.includes(key(x)));
  if (!fresh.length) { used[k] = []; fresh = [...arr]; }
  const v = pick(fresh);
  used[k].push(key(v));
  try { localStorage.setItem(KEY, JSON.stringify(used)); } catch { /* ignore */ }
  return v;
}

/** Spoken prompts (browser speech). Silent when the student muted sound, and always cancelled on exit. */
export function say(text: string) {
  try {
    if (!getSoundSettings().sfx) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.8; u.pitch = 1.15;
    speechSynthesis.speak(u);
  } catch { /* speech not supported */ }
}
export function cancelSay() { try { speechSynthesis.cancel(); } catch { /* ignore */ } }

/** What a round can do. Created per question by the round runner. */
export interface Ctx {
  say: (t: string) => void;
  /** Change the instruction shown and spoken (e.g. "What is missing?"). */
  prompt: (t: string) => void;
  /** Round solved. Plays the cheer, speaks `sayText` + praise, moves on. */
  ok: (sayText?: string) => void;
  /** Wrong answer. Returns the number of mistakes so far this round (2+ = show a hint). */
  wrong: () => number;
  alive: () => boolean;
}
export interface Q { prompt: string; view: (c: Ctx) => ReactNode }
export interface RoundDef { rounds: number; make: (level: number) => Q }
