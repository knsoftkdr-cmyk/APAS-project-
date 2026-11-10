import { motion, useReducedMotion } from "framer-motion";
import { APAS_A_PATH, APAS_STAR_PATH } from "./ApasMark";
import { useUid } from "./useUid";

export type LumoMood = "happy" | "cheer" | "think";

/**
 * Lumo, the APAS sunbeam sprite: a round, glowing little explorer with a leaf-sprout antenna and
 * the APAS guide-star on its tummy. Original artwork, pure SVG, animated with Framer Motion.
 */
export function ApasMascot({ size = 140, mood = "happy" }: { size?: number; mood?: LumoMood }) {
  const reduce = useReducedMotion();
  const id = useUid();
  const INK = "#24135F";

  const bob = reduce
    ? undefined
    : mood === "cheer"
      ? { y: [0, -14, 0], rotate: [0, -4, 4, 0] }
      : { y: [0, -6, 0] };
  const bobTransition = { duration: mood === "cheer" ? 0.9 : 3, repeat: Infinity, ease: "easeInOut" as const };

  const blink = reduce
    ? undefined
    : { ry: [14, 14, 1.5, 14] };
  const pupilBlink = reduce ? undefined : { r: [6, 6, 0, 6] };
  const blinkT = { duration: 4.2, times: [0, 0.9, 0.95, 1], repeat: Infinity };

  const mouth =
    mood === "cheer" ? (
      <>
        <path d="M65 106Q80 132 95 106Z" fill="#7A1F3D" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        <path d="M72 120Q80 126 88 120Q80 114 72 120Z" fill="#FF7A8A" />
      </>
    ) : mood === "think" ? (
      <path d="M70 112Q80 108 92 113" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
    ) : (
      <path d="M67 107Q80 122 93 107" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
    );

  return (
    <motion.div
      aria-hidden="true"
      style={{ width: size, height: size * 1.06, flex: "none" }}
      animate={bob}
      transition={bobTransition}
    >
      <svg viewBox="0 0 160 170" width="100%" height="100%">
        <defs>
          <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFD36B" />
            <stop offset="1" stopColor="#FF9A3C" />
          </linearGradient>
          <radialGradient id={`${id}g`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#FFE9A6" stopOpacity="0.55" />
            <stop offset="1" stopColor="#FFE9A6" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="80" cy="96" r="76" fill={`url(#${id}g)`} />
        <ellipse cx="80" cy="160" rx="38" ry="7" fill="rgba(0,0,0,0.2)" />
        <ellipse cx="60" cy="152" rx="15" ry="9" fill="#E8742A" stroke={INK} strokeWidth="3.5" />
        <ellipse cx="100" cy="152" rx="15" ry="9" fill="#E8742A" stroke={INK} strokeWidth="3.5" />
        <ellipse cx="17" cy="106" rx="9" ry="13" fill="#FF9A3C" stroke={INK} strokeWidth="3.5" />
        <ellipse cx="143" cy="106" rx="9" ry="13" fill="#FF9A3C" stroke={INK} strokeWidth="3.5" />
        <path
          d="M80 30C122 30 140 66 140 98C140 134 114 152 80 152C46 152 20 134 20 98C20 66 38 30 80 30Z"
          fill={`url(#${id}b)`}
          stroke={INK}
          strokeWidth="4"
        />
        <path d="M80 30C80 20 82 14 88 8" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        <path d="M88 8C100 0 112 6 114 16C102 21 92 19 88 8Z" fill="#2EE6A6" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <ellipse cx="62" cy="62" rx="14" ry="8" fill="#fff" opacity="0.35" transform="rotate(-25 62 62)" />
        <circle cx="42" cy="106" r="8" fill="#FF7A8A" opacity="0.55" />
        <circle cx="118" cy="106" r="8" fill="#FF7A8A" opacity="0.55" />
        <motion.ellipse cx="60" cy="84" rx="12" ry="14" fill="#fff" stroke={INK} strokeWidth="3" animate={blink} transition={blinkT} />
        <motion.ellipse cx="100" cy="84" rx="12" ry="14" fill="#fff" stroke={INK} strokeWidth="3" animate={blink} transition={blinkT} />
        <motion.circle cx="62" cy="86" r="6" fill={INK} animate={pupilBlink} transition={blinkT} />
        <motion.circle cx="98" cy="86" r="6" fill={INK} animate={pupilBlink} transition={blinkT} />
        <circle cx="64" cy="83" r="2" fill="#fff" />
        <circle cx="100" cy="83" r="2" fill="#fff" />
        {mouth}
        <g transform="translate(62 116) scale(0.37)">
          <path d={APAS_STAR_PATH} fill="#FFF3B0" stroke={INK} strokeWidth="3.4" strokeLinejoin="round" />
          <path d={APAS_A_PATH} fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </motion.div>
  );
}
