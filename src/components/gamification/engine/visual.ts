import type { CSSProperties } from "react";

// Picture helpers for the games. Nursery / LKG / UKG content is emoji pictures (see
// supabase/functions/_shared/preprimaryVisualContent.ts); these make them big and let a child hear the words.

const EMOJI = /\p{Extended_Pictographic}/u;
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u;

/** Big for a picture on its own, a bit bigger for picture + word, untouched for ordinary text. */
export function visualSize(text: string): CSSProperties | undefined {
  if (EMOJI_ONLY.test(text)) return { fontSize: "2.75rem", lineHeight: 1.1 };
  if (EMOJI.test(text)) return { fontSize: "1.5rem", lineHeight: 1.25 };
  return undefined;
}

/** Read text aloud (pictures stripped) with the browser's speech synthesis. Silent where unsupported. */
export function speak(text: string): void {
  try {
    const clean = text.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ").replace(/\s+/g, " ").trim();
    if (!clean || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 0.85; u.pitch = 1.1;
    window.speechSynthesis.speak(u);
  } catch { /* speech is a nicety, never a blocker */ }
}
