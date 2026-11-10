import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import type { VisualTier } from "./visualTier";

/**
 * APAS visual identity for Gamification. Every colour, font and surface used by the redesigned
 * screens comes from here, so the two looks stay consistent and can be tuned in one place.
 *  - Playful "Adventure Trail": APAS ink (#24135F) outlines, sun-yellow, coral, mint, sky and grape.
 *  - Vibrant "APAS Arena" (Class 6-10): violet, cyan and magenta glow on deep indigo.
 *  - Elegant "APAS Prestige" (Class 11-12): deep navy glass, indigo + teal accents, champagne-gold hairlines.
 * Fonts are system stacks only (no CDN). Add a self-hosted font later by putting its name first.
 */
export interface ApasTheme {
  tier: VisualTier;
  fontBody: string;
  fontHeading: string;
  /** Text drawn straight on the page background. */
  text: string;
  muted: string;
  /** Brand ink used for outlines on the playful look. */
  ink: string;
  /** Surface used for cards, with the text colours that belong on it. */
  card: CSSProperties;
  cardText: string;
  cardMuted: string;
  ringFrom: string;
  ringTo: string;
  ringTrack: string;
  barTrack: string;
  barFill: string;
  tabStrip: CSSProperties;
  tabActive: CSSProperties;
  tabIdle: string;
  tabRadius: number;
  freeze: string;
  warn: string;
  good: string;
  /** Small labels and icons that sit on a card (tier names, section icons). */
  accent: string;
  /** Badge tile surfaces. */
  badgeEarned: CSSProperties;
  badgeLocked: CSSProperties;
  /** Colours handed out to subject tiles / chips in order. */
  swatches: string[];
}

const INK = "#24135F";
const SYSTEM = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

export const PLAYFUL_THEME: ApasTheme = {
  tier: "playful",
  fontBody: `ui-rounded, "Nunito", "Quicksand", "Trebuchet MS", ${SYSTEM}`,
  fontHeading: `ui-rounded, "Nunito", "Quicksand", "Trebuchet MS", ${SYSTEM}`,
  text: "#FFFFFF",
  muted: "rgba(255,255,255,0.88)",
  ink: INK,
  card: { background: "#FFFDF5", border: `3px solid ${INK}`, boxShadow: `0 5px 0 ${INK}`, borderRadius: 24 },
  cardText: INK,
  cardMuted: "#4B3A8F",
  ringFrom: "#FFB830",
  ringTo: "#FF5E73",
  ringTrack: "#E9E2FF",
  barTrack: "#E9E2FF",
  barFill: "linear-gradient(90deg,#FFB830,#FF5E73)",
  tabStrip: { background: "#FFFDF5", border: `3px solid ${INK}`, boxShadow: `0 4px 0 ${INK}`, borderRadius: 999 },
  tabActive: { background: "#FF5E73", color: INK, boxShadow: `0 3px 0 ${INK}`, border: `2px solid ${INK}` },
  tabIdle: INK,
  tabRadius: 999,
  freeze: "#0369A1",
  warn: "#B45309",
  good: "#15803D",
  accent: "#6D28D9",
  badgeEarned: { background: "#FFF1B8", border: `3px solid ${INK}`, boxShadow: `0 4px 0 ${INK}` },
  badgeLocked: { background: "rgba(255,253,245,0.72)", border: "3px dashed #7C6BC4" },
  swatches: ["#FF5E73", "#FFB830", "#2EE6A6", "#4DA8FF", "#B77CFF"],
};

export const ELEGANT_THEME: ApasTheme = {
  tier: "elegant",
  fontBody: `"DM Sans", ${SYSTEM}`,
  fontHeading: `"Sora", "DM Sans", ${SYSTEM}`,
  text: "#F1F5F9",
  muted: "rgba(241,245,249,0.6)",
  ink: "#0F1530",
  card: {
    background: "rgba(255,255,255,0.045)",
    border: "1px solid rgba(255,255,255,0.12)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    borderRadius: 20,
  },
  cardText: "#F1F5F9",
  cardMuted: "rgba(241,245,249,0.6)",
  ringFrom: "#818CF8",
  ringTo: "#2DD4BF",
  ringTrack: "rgba(255,255,255,0.12)",
  barTrack: "rgba(255,255,255,0.1)",
  barFill: "linear-gradient(90deg,#818CF8,#2DD4BF)",
  tabStrip: {
    background: "rgba(255,255,255,0.045)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 16,
  },
  tabActive: {
    background: "linear-gradient(135deg,#4F46E5,#6D5EF5)",
    color: "#FFFFFF",
    boxShadow: "0 6px 22px rgba(79,70,229,0.4)",
  },
  tabIdle: "rgba(241,245,249,0.62)",
  tabRadius: 12,
  freeze: "#38BDF8",
  warn: "#F59E0B",
  good: "#22C55E",
  accent: "#A5B4FC",
  badgeEarned: { background: "rgba(129,140,248,0.14)", border: "1px solid rgba(129,140,248,0.5)" },
  badgeLocked: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" },
  swatches: ["#818CF8", "#2DD4BF", "#E7C873", "#F0ABFC", "#7DD3FC"],
};

export const ARENA_THEME: ApasTheme = {
  tier: "arena",
  fontBody: `"DM Sans", ${SYSTEM}`,
  fontHeading: `"Sora", "DM Sans", ${SYSTEM}`,
  text: "#F5F3FF",
  muted: "rgba(245,243,255,0.7)",
  ink: "#120D33",
  card: {
    background: "linear-gradient(135deg,rgba(139,92,246,0.18),rgba(34,211,238,0.07))",
    border: "1px solid rgba(167,139,250,0.4)",
    boxShadow: "0 8px 30px rgba(124,58,237,0.2)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    borderRadius: 22,
  },
  cardText: "#F5F3FF",
  cardMuted: "rgba(245,243,255,0.7)",
  ringFrom: "#A78BFA",
  ringTo: "#22D3EE",
  ringTrack: "rgba(255,255,255,0.12)",
  barTrack: "rgba(255,255,255,0.12)",
  barFill: "linear-gradient(90deg,#8B5CF6,#22D3EE,#F472B6)",
  tabStrip: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.32)", borderRadius: 18 },
  tabActive: {
    background: "linear-gradient(135deg,#7C3AED,#C026D3)",
    color: "#FFFFFF",
    boxShadow: "0 6px 24px rgba(192,38,211,0.45)",
  },
  tabIdle: "rgba(245,243,255,0.72)",
  tabRadius: 14,
  freeze: "#67E8F9",
  warn: "#FBBF24",
  good: "#34D399",
  accent: "#C4B5FD",
  badgeEarned: { background: "linear-gradient(135deg,rgba(139,92,246,0.3),rgba(34,211,238,0.14))", border: "1px solid rgba(167,139,250,0.65)", boxShadow: "0 6px 22px rgba(124,58,237,0.3)" },
  badgeLocked: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)" },
  swatches: ["#8B5CF6", "#22D3EE", "#F472B6", "#FBBF24", "#34D399"],
};

const Ctx = createContext<ApasTheme>(ELEGANT_THEME);

export function GamificationThemeProvider({ tier, children }: { tier: VisualTier; children: ReactNode }) {
  const value = useMemo(() => (tier === "playful" ? PLAYFUL_THEME : tier === "arena" ? ARENA_THEME : ELEGANT_THEME), [tier]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGamificationTheme(): ApasTheme {
  return useContext(Ctx);
}
