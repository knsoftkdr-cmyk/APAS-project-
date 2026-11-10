import { Compass, Flag, Flame, Gamepad2, Rocket, Target, TrendingUp, Trophy, type LucideIcon } from "lucide-react";
import { useUid } from "./useUid";

const GLYPHS: Record<string, LucideIcon> = {
  gamepad: Gamepad2, target: Target, flame: Flame, flag: Flag, rocket: Rocket, trophy: Trophy, "trending-up": TrendingUp, compass: Compass,
};
const METAL: Record<string, [string, string]> = {
  bronze: ["#E8A26B", "#9A5320"],
  silver: ["#E2E8F0", "#7C8CA3"],
  gold: ["#FFE08A", "#C98A0B"],
  brand: ["#FFD166", "#FF8A3C"],
};

/** Original APAS badge: a shield medal in bronze / silver / gold (or APAS orange) with a line glyph on it. Greyed when locked. */
export function BadgeEmblem({ icon, earned, tierLabel, size = 52 }: { icon: string; earned: boolean; tierLabel?: string; size?: number }) {
  const id = useUid();
  const [a, b] = earned ? METAL[(tierLabel ?? "").toLowerCase()] ?? METAL.brand : (["#CBD5E1", "#94A3B8"] as [string, string]);
  const Glyph = GLYPHS[icon] ?? Trophy;
  return (
    <span aria-hidden="true" style={{ position: "relative", display: "inline-grid", placeItems: "center", width: size, height: size, opacity: earned ? 1 : 0.8 }}>
      <svg width={size} height={size} viewBox="0 0 56 56" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id={`${id}m`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
        </defs>
        <path d="M28 3L50 15V37C50 45 40 51 28 54C16 51 6 45 6 37V15Z" fill={`url(#${id}m)`} stroke="#24135F" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M28 9L44 18V36C44 42 36 46 28 48.5C20 46 12 42 12 36V18Z" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
      </svg>
      <Glyph size={Math.round(size * 0.42)} color={earned ? "#24135F" : "#475569"} strokeWidth={2.4} style={{ position: "relative" }} />
    </span>
  );
}
