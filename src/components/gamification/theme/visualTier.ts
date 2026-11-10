export type VisualTier = "playful" | "arena" | "elegant";

const STORAGE_KEY = "apas.gamification.visualTier";

/**
 * Which APAS look a student gets.
 *  - "playful": Nursery / LKG / UKG and Class 1-5  (colourful adventure look)
 *  - "arena":   Class 6-10                          (vibrant, energetic, still polished)
 *  - "elegant": Class 11-12                         (calm, sophisticated, premium)
 * Unknown or missing class keys fall back to "elegant" (the previous dark look).
 */
export function getVisualTier(classKey?: string | null): VisualTier {
  const k = (classKey ?? "")
    .toLowerCase()
    .replace(/\b(class|grade|std)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (!k) return "elegant";
  if (/^(pre)?nursery|^pp\d?$|^lkg|^ukg|^kg\d?$|^prekg/.test(k)) return "playful";
  const n = parseInt(k.replace(/\D/g, ""), 10);
  if (!Number.isNaN(n)) return n <= 5 ? "playful" : n <= 10 ? "arena" : "elegant";
  return "elegant";
}

/** Remembered between visits so the page doesn't flash the wrong look while the class loads. */
export function readCachedTier(): VisualTier | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "playful" || v === "arena" || v === "elegant" ? v : null;
  } catch {
    return null;
  }
}

export function cacheTier(tier: VisualTier): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, tier);
  } catch {
    /* storage unavailable: harmless */
  }
}
