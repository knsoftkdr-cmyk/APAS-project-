import { motion, useReducedMotion } from "framer-motion";
import { APAS_STAR_PATH } from "./ApasMark";

const CSS = `
@keyframes apas-cloud { from { transform: translateX(-30vw); } to { transform: translateX(115vw); } }
@keyframes apas-bob { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-12px) rotate(8deg); } }
@keyframes apas-sun { to { transform: rotate(360deg); } }
.apas-cloud { animation: apas-cloud linear infinite; }
.apas-bob { animation: apas-bob ease-in-out infinite; }
.apas-sun { animation: apas-sun 90s linear infinite; }
@keyframes apas-floor { to { background-position: 0 56px, 0 0; } }
.apas-floor { animation: apas-floor 2.6s linear infinite; }
@media (prefers-reduced-motion: reduce) { .apas-cloud, .apas-bob, .apas-sun, .apas-floor { animation: none !important; } }
`;

const CLOUD = "M10 42a14 14 0 0 1 4-27 18 18 0 0 1 34-3 15 15 0 0 1 24 8 12 12 0 0 1-2 22Z";

const CLOUDS = [
  { top: "9%", w: 150, dur: 95, delay: -20, o: 0.9 },
  { top: "22%", w: 100, dur: 130, delay: -80, o: 0.7 },
  { top: "34%", w: 130, dur: 110, delay: -45, o: 0.55 },
];

const SPARKS: { x: string; y: string; s: number; c: string; dur: number; delay: number; kind: "star" | "dot" | "ring" }[] = [
  { x: "8%", y: "18%", s: 26, c: "#FFB830", dur: 5, delay: 0, kind: "star" },
  { x: "20%", y: "44%", s: 14, c: "#FF5E73", dur: 6, delay: -2, kind: "dot" },
  { x: "33%", y: "12%", s: 18, c: "#2EE6A6", dur: 7, delay: -1, kind: "ring" },
  { x: "62%", y: "30%", s: 22, c: "#B77CFF", dur: 6.5, delay: -3, kind: "star" },
  { x: "78%", y: "52%", s: 16, c: "#FFB830", dur: 5.5, delay: -4, kind: "dot" },
  { x: "90%", y: "38%", s: 24, c: "#4DA8FF", dur: 7.5, delay: -2.5, kind: "star" },
  { x: "12%", y: "66%", s: 20, c: "#2EE6A6", dur: 6, delay: -1.5, kind: "star" },
  { x: "70%", y: "70%", s: 14, c: "#FF5E73", dur: 5, delay: -3.5, kind: "ring" },
];

/** Playful look: a sunny adventure trail drawn entirely in SVG + CSS (sun, clouds, hills, floating APAS stars). */
export function AdventureBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 overflow-hidden pointer-events-none z-0"
      style={{ background: "linear-gradient(180deg,#0B4F6C 0%,#0E7490 52%,#1496A1 100%)" }}
    >
      <style>{CSS}</style>
      <div className="absolute" style={{ top: "-4%", insetInlineEnd: "-2%", width: "clamp(160px,30vw,360px)", aspectRatio: "1", background: "radial-gradient(circle,rgba(255,214,102,0.5),transparent 68%)" }} />
      <svg className="absolute apas-sun" style={{ top: "4%", insetInlineEnd: "6%", width: "clamp(72px,13vw,150px)" }} viewBox="-60 -60 120 120">
        {Array.from({ length: 12 }).map((_, i) => (
          <rect key={i} x="-3" y="-54" width="6" height="15" rx="3" fill="#FFD166" transform={`rotate(${i * 30})`} />
        ))}
        <circle r="30" fill="#FFB830" />
        <circle r="30" fill="none" stroke="#FFE08A" strokeWidth="4" opacity="0.7" />
      </svg>
      {CLOUDS.map((c, i) => (
        <svg key={i} className="absolute apas-cloud" style={{ top: c.top, left: 0, width: c.w, opacity: c.o, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }} viewBox="0 0 90 50">
          <path d={CLOUD} fill="#fff" />
        </svg>
      ))}
      {SPARKS.map((p, i) => (
        <svg key={i} className="absolute apas-bob" style={{ left: p.x, top: p.y, width: p.s, height: p.s, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`, opacity: 0.9 }} viewBox="0 0 48 48">
          {p.kind === "star" && <path d={APAS_STAR_PATH} fill={p.c} stroke="#24135F" strokeWidth="2" strokeLinejoin="round" />}
          {p.kind === "dot" && <circle cx="24" cy="24" r="16" fill={p.c} stroke="#24135F" strokeWidth="3" />}
          {p.kind === "ring" && <circle cx="24" cy="24" r="15" fill="none" stroke={p.c} strokeWidth="6" />}
        </svg>
      ))}
      <svg className="absolute bottom-0 start-0 w-full" style={{ height: "24vh" }} viewBox="0 0 1440 240" preserveAspectRatio="none">
        <path d="M0 120C240 40 420 60 640 110C860 160 1080 70 1440 100V240H0Z" fill="#1B7F5C" />
        <path d="M0 165C200 105 440 125 700 165C960 205 1160 125 1440 155V240H0Z" fill="#1F9158" />
        <path d="M0 200C300 160 560 190 820 205C1080 220 1260 180 1440 195V240H0Z" fill="#14532D" />
      </svg>
    </div>
  );
}

/** Elegant look: deep navy with two slow aurora glows and a fine grid. No particles, no clutter. */
export function EliteBackdrop() {
  const reduce = useReducedMotion();
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 overflow-hidden pointer-events-none z-0"
      style={{ background: "linear-gradient(135deg,#0A0F1F 0%,#111633 55%,#1B1B45 100%)" }}
    >
      <motion.div
        className="absolute rounded-full"
        style={{ width: "55vmax", height: "55vmax", top: "-22vmax", insetInlineStart: "-12vmax", background: "radial-gradient(circle,rgba(79,70,229,0.34),transparent 65%)", filter: "blur(60px)" }}
        animate={reduce ? undefined : { x: [0, 60, -20, 0], y: [0, 40, 20, 0] }}
        transition={{ duration: 38, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{ width: "48vmax", height: "48vmax", bottom: "-24vmax", insetInlineEnd: "-10vmax", background: "radial-gradient(circle,rgba(20,184,166,0.22),transparent 65%)", filter: "blur(70px)" }}
        animate={reduce ? undefined : { x: [0, -50, 30, 0], y: [0, -30, -10, 0] }}
        transition={{ duration: 44, repeat: Infinity, ease: "easeInOut" }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.035) 1px,transparent 1px)",
          backgroundSize: "64px 64px",
          WebkitMaskImage: "radial-gradient(ellipse at 50% 30%,#000 0%,transparent 75%)",
          maskImage: "radial-gradient(ellipse at 50% 30%,#000 0%,transparent 75%)",
        }}
      />
    </div>
  );
}

const ARENA_SPARKS: { x: string; y: string; s: number; c: string; dur: number; delay: number }[] = [
  { x: "7%", y: "16%", s: 22, c: "#22D3EE", dur: 6, delay: 0 },
  { x: "88%", y: "14%", s: 28, c: "#F472B6", dur: 7, delay: -2 },
  { x: "14%", y: "52%", s: 16, c: "#FBBF24", dur: 5.5, delay: -3 },
  { x: "93%", y: "48%", s: 18, c: "#8B5CF6", dur: 6.5, delay: -1 },
  { x: "50%", y: "6%", s: 14, c: "#34D399", dur: 7.5, delay: -4 },
];

/** Vibrant look for Class 6-10: glowing violet/cyan/magenta light on deep indigo, with a moving arena floor. */
export function ArenaBackdrop() {
  const reduce = useReducedMotion();
  const blob = (size: string, color: string, pos: object, anim: object, dur: number) => (
    <motion.div
      className="absolute rounded-full"
      style={{ width: size, height: size, background: `radial-gradient(circle,${color},transparent 65%)`, filter: "blur(70px)", ...pos }}
      animate={reduce ? undefined : anim}
      transition={{ duration: dur, repeat: Infinity, ease: "easeInOut" }}
    />
  );
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 overflow-hidden pointer-events-none z-0"
      style={{ background: "linear-gradient(160deg,#0B0820 0%,#150F3D 50%,#1F1250 100%)" }}
    >
      <style>{CSS}</style>
      {blob("55vmax", "rgba(139,92,246,0.45)", { top: "-24vmax", insetInlineStart: "-14vmax" }, { x: [0, 70, -20, 0], y: [0, 40, 20, 0] }, 30)}
      {blob("46vmax", "rgba(34,211,238,0.28)", { top: "10vmax", insetInlineEnd: "-18vmax" }, { x: [0, -60, 20, 0], y: [0, 50, -10, 0] }, 36)}
      {blob("44vmax", "rgba(244,114,182,0.26)", { bottom: "-22vmax", insetInlineStart: "18vmax" }, { x: [0, 50, -30, 0], y: [0, -40, -10, 0] }, 40)}
      <div
        className="absolute bottom-0 inset-x-0"
        style={{ height: "44vh", perspective: "520px", WebkitMaskImage: "linear-gradient(to top,#000 0%,transparent 92%)", maskImage: "linear-gradient(to top,#000 0%,transparent 92%)" }}
      >
        <div
          className="absolute apas-floor"
          style={{
            inset: "-70% -60% 0 -60%",
            backgroundImage: "linear-gradient(rgba(167,139,250,0.55) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,0.4) 1px,transparent 1px)",
            backgroundSize: "56px 56px",
            transform: "rotateX(62deg)",
            transformOrigin: "50% 100%",
          }}
        />
      </div>
      {ARENA_SPARKS.map((p, i) => (
        <svg key={i} className="absolute apas-bob" style={{ left: p.x, top: p.y, width: p.s, height: p.s, opacity: 0.75, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }} viewBox="0 0 48 48">
          <path d={APAS_STAR_PATH} fill="none" stroke={p.c} strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      ))}
    </div>
  );
}
