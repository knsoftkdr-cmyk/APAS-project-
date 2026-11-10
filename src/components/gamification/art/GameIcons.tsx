import { motion, useReducedMotion } from "framer-motion";
import { useUid } from "./useUid";

/** Original APAS flame. Lit = filled warm gradient; unlit = quiet outline in the current text colour. */
export function StreakFlame({ lit, size = 28 }: { lit: boolean; size?: number }) {
  const id = useUid();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD54A" />
          <stop offset="1" stopColor="#FF5E3A" />
        </linearGradient>
      </defs>
      <path
        d="M16 2c1.5 5.5 9 8.5 9 17a9 9 0 0 1-18 0c0-4 2.2-6 4-8.5.8 2 1.8 3 3 3C14.5 10 14.5 6 16 2Z"
        fill={lit ? `url(#${id}f)` : "none"}
        stroke={lit ? "#B3361C" : "currentColor"}
        strokeWidth="1.8"
        strokeLinejoin="round"
        opacity={lit ? 1 : 0.55}
      />
      {lit && <path d="M16 17c.8 2.5 4 3.6 4 6.6a4 4 0 0 1-8 0c0-1.8 1-2.8 2-4 .5.9 1.2 1.4 2 1.4Z" fill="#FFF3B0" />}
    </svg>
  );
}

/** Circular level meter: the ring fills to the student's progress through the current level. */
export function LevelRing({
  level,
  pct,
  size = 56,
  from,
  to,
  track,
  textColor,
  fontFamily,
}: {
  level: number;
  pct: number;
  size?: number;
  from: string;
  to: string;
  track: string;
  textColor: string;
  fontFamily?: string;
}) {
  const id = useUid();
  const reduce = useReducedMotion();
  const C = 2 * Math.PI * 26;
  const target = C * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ flex: "none" }}>
      <defs>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="26" fill="none" stroke={track} strokeWidth="7" />
      <motion.circle
        cx="32"
        cy="32"
        r="26"
        fill="none"
        stroke={`url(#${id}r)`}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={C}
        initial={{ strokeDashoffset: reduce ? target : C }}
        animate={{ strokeDashoffset: target }}
        transition={{ duration: reduce ? 0 : 0.9, ease: "easeOut" }}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="39" textAnchor="middle" fontSize="22" fontWeight="800" fill={textColor} style={{ fontFamily }}>
        {level}
      </text>
    </svg>
  );
}
