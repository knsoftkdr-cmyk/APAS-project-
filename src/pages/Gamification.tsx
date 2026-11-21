import { useState, useEffect, useRef, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useGamification } from "@/hooks/useGamification";
import { useGamification2 } from "@/hooks/useGamification2";
import { recordGameRound, G2Awarded } from "@/lib/gamification2";
import {
  Gamification2Header, Gamification2Tabs, Gamification2Panel, RoundRewardsCard, HubTab,
} from "@/components/gamification/hub/Gamification2Hub";
import {
  GamePhase, GameResult, TIER_BADGES,
} from "@/components/gamification/types";
import { MatchPairs } from "@/components/gamification/games/MatchPairs";
import { QuickQuiz } from "@/components/gamification/games/QuickQuiz";
import { WordScramble } from "@/components/gamification/games/WordScramble";
import { CategorySort } from "@/components/gamification/games/CategorySort";
import { SpeedTap } from "@/components/gamification/games/SpeedTap";
import { VisualMemory } from "@/components/gamification/games/VisualMemory";
import { GameSetupScreen } from "@/components/gamification/setup/GameSetupScreen";
import { LittleGame } from "@/components/gamification/games/little/LittleGame";
import { isLittleGame, littleLevel } from "@/components/gamification/engine/littleGames";
import { SelectedGame, GameMode } from "@/components/gamification/engine/gameSelector";
import { AgeGroup } from "@/components/gamification/engine/ageGroups";
import { serveGameContent, type GameType, type GameItemMap, type ServedContent } from "@/lib/gamificationQuestions";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import {
  Brain, Zap, Timer, ChevronRight,
  ArrowRight, X, Shield, Eye, BarChart3,
  Sparkles, Target, Flame, Gamepad2, Rocket,
} from "lucide-react";
import { playCountdownBeep, playGoSound, playVictorySound, playClickSound, playMascotSound, playCelebrationSound, resetAnswerStreak, duckMusic, setMusicStyle, activateGamificationAudio, deactivateGamificationAudio } from "@/components/gamification/sounds";
import { SoundToggle } from "@/components/gamification/SoundToggle";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { GamificationThemeProvider, useGamificationTheme } from "@/components/gamification/theme/GamificationTheme";
import { getVisualTier, readCachedTier, cacheTier, type VisualTier } from "@/components/gamification/theme/visualTier";
import { AdventureBackdrop, ArenaBackdrop, EliteBackdrop } from "@/components/gamification/art/Backdrops";

/* ═══════════════════════════════════════════════════════════
   KIDS LOOK (LKG - Class 5): the page sits on a bright teal sky, so text never goes straight on it in a faded
   colour. Cards are cream with APAS-ink outlines and dark text; headings on the sky are white with an ink shadow;
   game colours are deepened so they stay readable on cream. Class 6+ keeps the dark look unchanged.
   ═══════════════════════════════════════════════════════════ */
const KID_INK = "#24135F";
const KID_MUTED = "#4B3A8F";
const KID_CARD: React.CSSProperties = { background: "#FFFDF5", border: `3px solid ${KID_INK}`, boxShadow: `0 5px 0 ${KID_INK}` };
const KID_ON_SKY: React.CSSProperties = { color: "#FFFFFF", textShadow: `0 3px 0 ${KID_INK}, 0 0 3px ${KID_INK}` };
function mixHex(hex: string, target: string, amt: number): string {
  const parse = (h: string) => {
    const m = h.trim().replace("#", "");
    const full = m.length === 3 ? m.split("").map(c => c + c).join("") : m.slice(0, 6);
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  };
  const a = parse(hex), b = parse(target);
  if (a.some(n => Number.isNaN(n)) || b.some(n => Number.isNaN(n))) return hex;
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * amt).toString(16).padStart(2, "0")).join("");
}
/** A game / group colour made dark enough to read on a cream card. */
const kidDeep = (c: string) => mixHex(c, KID_INK, 0.4);
/** A light, cheerful tint of a colour for kid tiles. */
const kidSoft = (c: string) => mixHex(c, "#FFFFFF", 0.82);
const kidTile = (c: string): React.CSSProperties => ({ background: kidSoft(c), border: `3px solid ${KID_INK}`, boxShadow: `0 4px 0 ${KID_INK}` });

/* ═══════════════════════════════════════════════════════════
   ANIMATED BACKGROUND — floating orbs + grid
   ═══════════════════════════════════════════════════════════ */
function AnimatedBackground() {
  const orbs = useMemo(() => Array.from({ length: 6 }, (_, i) => ({
    id: i,
    size: 200 + Math.random() * 300,
    x: Math.random() * 100,
    y: Math.random() * 100,
    color: ["#6366F1", "#A855F7", "#38BDF8", "#F472B6", "#84CC16", "#F59E0B"][i],
    duration: 15 + Math.random() * 20,
    delay: Math.random() * -20,
  })), []);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
      {orbs.map(o => (
        <div key={o.id} className="absolute rounded-full orb-float" style={{
          width: o.size, height: o.size,
          left: `${o.x}%`, top: `${o.y}%`,
          background: `radial-gradient(circle, ${o.color}15, transparent 70%)`,
          filter: "blur(40px)",
          animationDuration: `${o.duration}s`,
          animationDelay: `${o.delay}s`,
        }} />
      ))}
      <div className="shooting-star" style={{ top: "15%", animationDelay: "0s" }} />
      <div className="shooting-star" style={{ top: "45%", animationDelay: "4s" }} />
      <div className="shooting-star" style={{ top: "75%", animationDelay: "8s" }} />
    </div>
  );
}

function FloatingParticles() {
  const particles = useMemo(() => Array.from({ length: 30 }, (_, i) => ({
    id: i, size: 2 + Math.random() * 3, x: Math.random() * 100,
    delay: Math.random() * 8, duration: 6 + Math.random() * 8, opacity: 0.2 + Math.random() * 0.5,
  })), []);
  return (
    <div className="fixed inset-0 pointer-events-none z-[1] overflow-hidden">
      {particles.map(p => (
        <div key={p.id} className="absolute rounded-full particle-rise" style={{
          width: p.size, height: p.size, left: `${p.x}%`, bottom: "-10px",
          background: "#fff", opacity: p.opacity,
          animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s`,
        }} />
      ))}
    </div>
  );
}

const FLOWERS = ["🌸", "🌺", "🌼", "🌻", "🌷", "💐", "🏵️", "🌹"];
const RIBBONS = ["🎀", "🎗️", "🎊", "🎉", "✨", "⭐", "🎆", "🎇"];

function Confetti({ show }: { show: boolean }) {
  if (!show) return null;
  const pieces = Array.from({ length: 50 }, (_, i) => {
    const colors = ["#38BDF8", "#A855F7", "#84CC16", "#F59E0B", "#F472B6", "#22C55E", "#6366F1"];
    return { id: `c-${i}`, color: colors[i % colors.length], left: `${Math.random() * 100}%`, delay: Math.random() * 2, duration: 2.5 + Math.random() * 2, size: 6 + Math.random() * 10, round: Math.random() > 0.5 };
  });
  const flowers = Array.from({ length: 20 }, (_, i) => ({ id: `f-${i}`, emoji: FLOWERS[i % FLOWERS.length], left: `${Math.random() * 100}%`, delay: Math.random() * 2.5, duration: 3 + Math.random() * 2.5, size: 20 + Math.random() * 16, sway: (Math.random() - 0.5) * 120 }));
  const ribbons = Array.from({ length: 16 }, (_, i) => ({ id: `r-${i}`, emoji: RIBBONS[i % RIBBONS.length], left: `${Math.random() * 100}%`, delay: Math.random() * 1.5, duration: 2.8 + Math.random() * 2, size: 22 + Math.random() * 14, sway: (Math.random() - 0.5) * 80 }));
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {pieces.map(p => (<div key={p.id} className="absolute celebration-fall" style={{ left: p.left, top: "-20px", width: p.size, height: p.size, backgroundColor: p.color, borderRadius: p.round ? "50%" : "2px", animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s` }} />))}
      {flowers.map(f => (<div key={f.id} className="absolute celebration-sway-fall" style={{ left: f.left, top: "-40px", fontSize: f.size, animationDelay: `${f.delay}s`, animationDuration: `${f.duration}s`, ["--sway" as string]: `${f.sway}px` }}>{f.emoji}</div>))}
      {ribbons.map(r => (<div key={r.id} className="absolute celebration-sway-fall" style={{ left: r.left, top: "-40px", fontSize: r.size, animationDelay: `${r.delay}s`, animationDuration: `${r.duration}s`, ["--sway" as string]: `${r.sway}px` }}>{r.emoji}</div>))}
    </div>
  );
}

function CircularTimer({ timeLeft, total, size = 80 }: { timeLeft: number; total: number; size?: number }) {
  const kid = useGamificationTheme().tier === "playful";
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = timeLeft / total;
  const color = kid
    ? (pct > 0.5 ? "#15803D" : pct > 0.2 ? "#B45309" : "#DC2626")
    : (pct > 0.5 ? "#22C55E" : pct > 0.2 ? "#F59E0B" : "#EF4444");
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={kid ? "#E9E2FF" : "rgba(255,255,255,0.1)"} strokeWidth={kid ? 8 : 4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={kid ? 8 : 4}
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round" className="transition-all duration-1000" />
      <g className="transform rotate-90" style={{ transformOrigin: "center" }}>
        <text x={size / 2} y={(size / 2) + 5} textAnchor="middle" fill={color} fontSize={size / 4} fontWeight="bold">{timeLeft}</text>
      </g>
    </svg>
  );
}

function ScoreTicker({ score }: { score: number }) {
  const [pop, setPop] = useState(false);
  const prevScore = useRef(score);
  useEffect(() => {
    if (score !== prevScore.current) { setPop(true); setTimeout(() => setPop(false), 400); prevScore.current = score; }
  }, [score]);
  return (
    <div className={`fixed top-4 end-4 z-40 px-5 py-2.5 rounded-2xl shadow-2xl transition-transform duration-300 ${pop ? "scale-125" : "scale-100"}`}
      style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.9), rgba(168,85,247,0.9))", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.2)" }}>
      <div className="flex items-center gap-2">
        <Flame className="h-4 w-4 text-yellow-400 animate-pulse" />
        <span className="text-xl font-black tabular-nums" style={{ color: "#F1F5F9" }}>{score}</span>
        <span className="text-xs font-medium" style={{ color: "rgba(241,245,249,0.6)" }}>pts</span>
      </div>
    </div>
  );
}

function GameProgressBar({ current, total, games }: { current: number; total: number; games: SelectedGame[] }) {
  const kid = useGamificationTheme().tier === "playful";
  return (
    <div className={`w-full max-w-md mx-auto ${kid ? "rounded-2xl px-3 py-2" : ""}`} style={kid ? KID_CARD : undefined}>
      <div className="flex justify-between mb-1.5">
        <span className="text-xs font-medium" style={{ color: kid ? KID_MUTED : "rgba(241,245,249,0.5)" }}>Progress</span>
        <span className="text-xs font-bold" style={{ color: kid ? KID_INK : "#F1F5F9" }}>Game {Math.min(current + 1, total)} of {total}</span>
      </div>
      <div className="w-full h-2.5 rounded-full" style={{ background: kid ? "#E9E2FF" : "rgba(255,255,255,0.08)" }}>
        <div className="h-full rounded-full transition-all duration-700 ease-out progress-glow"
          style={{ width: `${(current / total) * 100}%`, background: "linear-gradient(90deg, #6366F1, #A855F7, #F472B6)" }} />
      </div>
      <div className="flex justify-between mt-2 px-1">
        {games.map((g, i) => (
          <div key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition-all duration-500 ${i < current ? "scale-100" : i === current ? "scale-110 ring-2 ring-white/30" : "scale-90 opacity-40"}`}
            style={kid
              ? { background: i <= current ? kidSoft(g.color) : "#F1EEFB", border: `2px solid ${i <= current ? KID_INK : "#B9B0E0"}`, color: KID_INK, fontWeight: 700 }
              : { background: i < current ? g.color : i === current ? `${g.color}90` : "rgba(255,255,255,0.1)", color: i <= current ? "#0F172A" : "rgba(241,245,249,0.3)", fontWeight: 700 }}>
            {i < current ? "✓" : g.icon}
          </div>
        ))}
      </div>
    </div>
  );
}

function GlassCard({ children, className = "", glow = "" }: { children: React.ReactNode; className?: string; glow?: string }) {
  const kid = useGamificationTheme().tier === "playful";
  if (kid) return <div className={`rounded-3xl p-6 relative overflow-hidden ${className}`} style={KID_CARD}>{children}</div>;
  return (
    <div className={`rounded-2xl p-6 relative overflow-hidden ${className}`}
      style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: glow ? `0 0 40px ${glow}20, inset 0 1px 0 rgba(255,255,255,0.1)` : "inset 0 1px 0 rgba(255,255,255,0.1)" }}>
      {children}
    </div>
  );
}

function AnimatedCounter({ value, duration = 1500 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value, duration]);
  return <>{display}</>;
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-sm font-bold" style={{ color: "#F1F5F9" }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

type AdaptivePhase = "SETUP" | GamePhase;

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */
const Gamification = () => {
  const { profile } = useAuth();
  const { awardXp } = useGamification();
  const g2 = useGamification2();
  // Sound belongs to this page only: on while it is open, fully off the moment the student leaves.
  useEffect(() => {
    activateGamificationAudio();
    return () => deactivateGamificationAudio();
  }, []);
  const [hubTab, setHubTab] = useState<HubTab>("play");
  // LKG-Class 5 get the playful APAS look, Class 6+ the elegant one. Cached so there is no flash on return visits.
  const [visualTier, setVisualTier] = useState<VisualTier>(() => readCachedTier() ?? "elegant");
  // Class 6-10 ("arena" look) gets its own energetic track; everyone else keeps the light adventure loop.
  useEffect(() => { setMusicStyle(visualTier === "arena" ? "arena" : "adventure"); }, [visualTier]);
  const kid = visualTier === "playful";
  const handleClassKnown = (classKey: string) => { const t = getVisualTier(classKey); setVisualTier(t); cacheTier(t); };
  const [sessionRewards, setSessionRewards] = useState<G2Awarded[]>([]);
  const roundIdRef = useRef<string>("");
  const studentName = profile?.full_name || "Student";

  // Setup state
  const [selectedGames, setSelectedGames] = useState<SelectedGame[]>([]);
  const [ageGroup, setAgeGroup] = useState<AgeGroup | null>(null);
  const [subject, setSubject] = useState('');
  const [studentClass, setStudentClass] = useState('');
  const [gameMode, setGameMode] = useState<GameMode>('subject');

  // Game Engine state
  const [phase, setPhase] = useState<AdaptivePhase>("SETUP");
  const [currentGame, setCurrentGame] = useState(0);
  const [results, setResults] = useState<GameResult[]>([]);
  const [countdown, setCountdown] = useState(3);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [quitConfirm, setQuitConfirm] = useState(false);
  const timerActive = useRef(false);
  const startTimeRef = useRef<number>(0);

  // Fresh, class-strict questions for the game about to be played. Served (and recorded as seen) by the server per game.
  type ContentState = { status: "idle" | "loading" | "ready" | "empty" | "error"; items: unknown[]; message: string | null };
  const [content, setContent] = useState<ContentState>({ status: "idle", items: [], message: null });
  const [contentRetry, setContentRetry] = useState(0);
  // One request per (round, game): React StrictMode runs effects twice in dev, and a second request would burn a second set of questions.
  const contentRequests = useRef<Map<string, Promise<ServedContent<unknown>>>>(new Map());

  useEffect(() => {
    if (phase !== "PRE_GAME") return;
    const cfg = selectedGames[currentGame];
    if (!cfg) return;
    // Picture games (Nursery / LKG / UKG) carry their own content: nothing to fetch from the server.
    if (isLittleGame(cfg.id)) { setContent({ status: "ready", items: [], message: null }); return; }
    const key = `${roundIdRef.current}:${currentGame}:${contentRetry}`;
    let cancelled = false;
    let req = contentRequests.current.get(key);
    if (!req) {
      req = serveGameContent(cfg.id as GameType, { subject, mode: gameMode, sessionId: roundIdRef.current }) as Promise<ServedContent<unknown>>;
      contentRequests.current.set(key, req);
    }
    setContent({ status: "loading", items: [], message: null });
    req.then(res => {
      if (cancelled) return;
      if (res.meta.exhausted || res.items.length === 0) setContent({ status: "empty", items: [], message: res.message });
      else setContent({ status: "ready", items: res.items, message: null });
    }).catch(err => {
      contentRequests.current.delete(key);
      if (cancelled) return;
      setContent({ status: "error", items: [], message: err instanceof Error ? err.message : "Couldn't load your questions." });
    });
    return () => { cancelled = true; };
  }, [phase, currentGame, contentRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!timerActive.current) return;
    const t = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "COUNTDOWN") return;
    if (countdown <= 0) { playGoSound(); setPhase("PLAYING"); return; }
    playCountdownBeep(countdown);
    const t = setTimeout(() => setCountdown(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, phase]);

  useEffect(() => {
    if (phase === "WELCOME") playMascotSound();
  }, [phase]);

  useEffect(() => {
    if (phase !== "POST_GAME") return;
    playVictorySound();
    duckMusic(2200);
    setShowConfetti(true);
    const t = setTimeout(() => setShowConfetti(false), 4000);
    return () => clearTimeout(t);
  }, [phase]);

  const handleSetupComplete = (games: SelectedGame[], ag: AgeGroup, sub: string, cls: string, mode: GameMode) => {
    setSelectedGames(games);
    setAgeGroup(ag);
    setSubject(sub);
    setStudentClass(cls);
    setGameMode(mode);
    setPhase("WELCOME");
  };

  const startRound = () => {
    roundIdRef.current = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : String(Date.now());
    setSessionRewards([]);
    startTimeRef.current = Date.now();
    timerActive.current = true;
    setElapsedTime(0);
    setPhase("PRE_GAME");
  };

  const startCountdown = () => { resetAnswerStreak(); setCountdown(3); setPhase("COUNTDOWN"); };

  const handleGameComplete = (result: GameResult) => {
    setResults(prev => [...prev, result]);
    setPhase("POST_GAME");

    // Gamification 2.0: report the round. Fire-and-forget - a failure here must never interrupt the game.
    const cfg = selectedGames[result.gameIndex];
    if (cfg) {
      recordGameRound({
        game_id: cfg.id,
        subject: subject || null,
        accuracy: result.accuracy,
        score: result.rawScore,
        max_score: result.maxScore,
        questions_attempted: result.questionsAttempted,
        duration_seconds: result.timeUsed,
      }, `${roundIdRef.current}:${result.gameIndex}`)
        .then(res => {
          g2.applyState(res.state);
          if (res.awarded) {
            setSessionRewards(prev => [...prev, res.awarded!]);
            g2.announce(res.awarded);
          }
        })
        .catch(() => { /* Gamification 2.0 unavailable or offline: the round itself is unaffected */ });
    }
  };

  const goToNextGame = () => {
    if (currentGame + 1 >= selectedGames.length) {
      timerActive.current = false;
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 6000);
      setPhase("RESULTS");
      playCelebrationSound();
      duckMusic(3500);
      if (results.length > 0) awardXp("complete_assessment", "Completed Adaptive Gamification Round");
    } else {
      setContent({ status: "idle", items: [], message: null });
      setCurrentGame(p => p + 1);
      setPhase("PRE_GAME");
    }
  };

  const handleQuit = () => { timerActive.current = false; setPhase("RESULTS"); setQuitConfirm(false); };
  const formatElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const totalScore = results.reduce((s, r) => s + r.rawScore, 0);

  const computeFinalScore = () => {
    if (results.length === 0) return 0;
    let weighted = 0, totalWeight = 0;
    results.forEach(r => {
      const config = selectedGames[r.gameIndex];
      if (!config) return;
      const pct = r.maxScore > 0 ? (r.rawScore / r.maxScore) * 100 : 0;
      weighted += pct * config.weight;
      totalWeight += config.weight;
    });
    return totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;
  };

  const cognitiveScore = computeFinalScore();
  const tier = TIER_BADGES.find(t => cognitiveScore >= t.min && cognitiveScore <= t.max) || TIER_BADGES[0];

  const currentGameConfig = selectedGames[currentGame];

  const renderGame = () => {
    if (!currentGameConfig || !ageGroup) return null;

    if (isLittleGame(currentGameConfig.id)) {
      return <LittleGame key={currentGameConfig.id} gameId={currentGameConfig.id} gameName={currentGameConfig.name}
        gameIndex={currentGame} level={littleLevel(studentClass)} onComplete={handleGameComplete} />;
    }

    const commonProps = {
      studentName,
      ageGroup: ageGroup.id,
      subject,
      gameIndex: currentGame,
      timeLimit: currentGameConfig.timeLimit[ageGroup.id],
    };

    switch (currentGameConfig.id) {
      case 'quick-quiz':
        return (
          <QuickQuiz
            {...commonProps}
            content={content.items as GameItemMap["quick-quiz"][]}
            onComplete={(res) => handleGameComplete(res)}
          />
        );

      case 'word-scramble':
        return (
          <WordScramble
            {...commonProps}
            content={content.items as GameItemMap["word-scramble"][]}
            onComplete={(res) => handleGameComplete(res)}
          />
        );

      case 'match-pairs':
        return (
          <MatchPairs
            {...commonProps}
            content={content.items as GameItemMap["match-pairs"][]}
            onComplete={(res) => handleGameComplete(res)}
          />
        );

      case 'category-sort':
        return (
          <CategorySort
            {...commonProps}
            content={content.items as GameItemMap["category-sort"][]}
            onComplete={(res) => handleGameComplete(res)}
          />
        );

      case 'speed-tap':
        return (
          <SpeedTap
            {...commonProps}
            content={content.items as GameItemMap["speed-tap"][]}
            onComplete={(res) => handleGameComplete(res)}
          />
        );

      case 'visual-memory':
        return (
          <VisualMemory
            {...commonProps}
            content={content.items as GameItemMap["visual-memory"][]}
            onComplete={(res) => handleGameComplete(res)}
          />
        );

      default:
        return (
          <QuickQuiz
            {...commonProps}
            content={content.items as GameItemMap["quick-quiz"][]}
            onComplete={(res) => handleGameComplete(res)}
          />
        );
    }
  };

  const gameWrapper = (
    <div className="min-h-screen relative" style={{ background: visualTier === "playful" ? "#0B4F6C" : visualTier === "arena" ? "#0B0820" : "#0A0F1F" }}>
      {visualTier === "playful" ? <AdventureBackdrop /> : visualTier === "arena" ? <ArenaBackdrop /> : <EliteBackdrop />}
      <Confetti show={showConfetti} />
      <SoundToggle />

      {(phase === "PLAYING" || phase === "PRE_GAME" || phase === "COUNTDOWN" || phase === "POST_GAME") && (
        <div className="fixed top-4 start-4 z-40 flex items-center gap-2 px-4 py-2 rounded-2xl timer-glow"
          style={kid ? KID_CARD : { background: "rgba(15,23,42,0.85)", backdropFilter: "blur(16px)", border: "1px solid rgba(56,189,248,0.2)" }}>
          <Timer className="h-4 w-4 animate-pulse" style={{ color: kid ? "#0369A1" : "#38BDF8" }} />
          <span className="text-sm font-mono font-black tabular-nums" style={{ color: kid ? KID_INK : "#F1F5F9" }}>
            {formatElapsed(elapsedTime)}
          </span>
        </div>
      )}

      {phase === "PLAYING" && <ScoreTicker score={totalScore} />}

      {(phase === "PLAYING" || phase === "PRE_GAME" || phase === "COUNTDOWN" || phase === "POST_GAME") && selectedGames.length > 0 && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 w-72">
          <GameProgressBar current={currentGame} total={selectedGames.length} games={selectedGames} />
        </div>
      )}

      <div className="flex items-center justify-center min-h-screen p-4 pt-24 relative z-10">

        {/* ─── SETUP ─── */}
        {phase === "SETUP" && (
          <div className="w-full max-w-2xl mx-auto space-y-5">
            {!g2.unavailable && (
              <>
                <Gamification2Header state={g2.state} />
                <Gamification2Tabs
                  tab={hubTab}
                  onChange={setHubTab}
                  claimable={g2.state ? [...g2.state.missions.daily, ...g2.state.missions.weekly].filter(m => m.status === "completed").length : 0}
                />
              </>
            )}
            {hubTab === "play" || g2.unavailable ? (
              <GameSetupScreen onStart={handleSetupComplete} onContext={handleClassKnown} />
            ) : (
              <Gamification2Panel
                tab={hubTab}
                state={g2.state}
                loading={g2.loading}
                unavailable={g2.unavailable}
                error={g2.error}
                onClaim={g2.claim}
                claimingId={g2.claimingId}
                onRetry={g2.refresh}
              />
            )}
          </div>
        )}

        {/* ─── WELCOME ─── */}
        {phase === "WELCOME" && ageGroup && (
          <div className="text-center max-w-2xl mx-auto space-y-8 welcome-enter">
            <div className="relative w-40 h-40 mx-auto">
              <div className="absolute inset-0 rounded-full animate-spin-slow" style={{ background: "conic-gradient(from 0deg, #6366F1, #A855F7, #F472B6, #38BDF8, #84CC16, #F59E0B, #6366F1)", padding: 4 }}>
                <div className="w-full h-full rounded-full" style={{ background: "#0F172A" }} />
              </div>
              <div className="absolute inset-3 rounded-full animate-pulse" style={{ background: "radial-gradient(circle, rgba(99,102,241,0.3), transparent 70%)" }} />
              <div className="absolute inset-0 flex items-center justify-center text-6xl game-icon-bounce">🎮</div>
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="absolute w-3 h-3 rounded-full orbit-particle" style={{
                  background: ["#6366F1", "#A855F7", "#38BDF8", "#F59E0B"][i],
                  boxShadow: `0 0 12px ${["#6366F1", "#A855F7", "#38BDF8", "#F59E0B"][i]}`,
                  animationDelay: `${i * -1.5}s`, top: "50%", left: "50%",
                }} />
              ))}
            </div>

            <div className="space-y-4">
              {kid ? (
                <h1 className="text-5xl md:text-7xl font-black tracking-tight" style={{ ...KID_ON_SKY, textShadow: `0 5px 0 ${KID_INK}, 0 0 4px ${KID_INK}` }}>
                  Adaptive Round
                </h1>
              ) : (
                <h1 className="text-5xl md:text-7xl font-black tracking-tight title-glow"
                  style={{ background: "linear-gradient(135deg, #6366F1 0%, #A855F7 25%, #F472B6 50%, #38BDF8 75%, #84CC16 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  Adaptive Round
                </h1>
              )}
              <div className="flex items-center justify-center gap-3">
                <Sparkles className="h-5 w-5 animate-pulse" style={{ color: kid ? "#FFD23F" : "#F59E0B" }} />
                {kid ? (
                  <p className="text-xl font-bold px-5 py-2 rounded-full" style={{ ...KID_CARD, color: KID_INK }}>
                    Welcome, <span className="font-black" style={{ color: "#C2410C" }}>{studentName}</span> 👋
                  </p>
                ) : (
                  <p className="text-xl font-medium" style={{ color: "rgba(241,245,249,0.7)" }}>
                    Welcome, <span className="font-black" style={{ background: "linear-gradient(135deg, #38BDF8, #6366F1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{studentName}</span>
                  </p>
                )}
                <Sparkles className="h-5 w-5 animate-pulse" style={{ color: kid ? "#FFD23F" : "#F59E0B" }} />
              </div>
            </div>

            {/* Age group & subject badge */}
            <div className="flex justify-center gap-4 flex-wrap">
              <div className="px-5 py-3 rounded-2xl flex items-center gap-2" style={kid ? kidTile(ageGroup.color) : { background: `${ageGroup.color}15`, border: `1px solid ${ageGroup.color}30` }}>
                <span className="text-xl">{ageGroup.emoji}</span>
                <div>
                  <p className={kid ? "text-sm font-black" : "text-xs font-bold"} style={{ color: kid ? KID_INK : ageGroup.color }}>{ageGroup.label}</p>
                  <p className={kid ? "text-xs font-semibold" : "text-[10px]"} style={{ color: kid ? KID_MUTED : "rgba(241,245,249,0.4)" }}>Age {ageGroup.ageRange[0]}-{ageGroup.ageRange[1]}</p>
                </div>
              </div>
              <div className="px-5 py-3 rounded-2xl flex items-center gap-2" style={kid ? kidTile(gameMode === 'generic' ? "#38BDF8" : "#A855F7") : { background: gameMode === 'generic' ? "rgba(56,189,248,0.1)" : "rgba(168,85,247,0.1)", border: `1px solid ${gameMode === 'generic' ? "rgba(56,189,248,0.3)" : "rgba(168,85,247,0.3)"}` }}>
                <span className="text-xl">{gameMode === 'generic' ? '🧩' : '📘'}</span>
                <div>
                  <p className={kid ? "text-sm font-black" : "text-xs font-bold"} style={{ color: kid ? KID_INK : gameMode === 'generic' ? "#7DD3FC" : "#A855F7" }}>{gameMode === 'generic' ? 'Generic Mode' : subject}</p>
                  <p className={kid ? "text-xs font-semibold" : "text-[10px]"} style={{ color: kid ? KID_MUTED : "rgba(241,245,249,0.4)" }}>Class {studentClass}</p>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="flex justify-center gap-3 sm:gap-5 flex-wrap">
              {[
                { icon: <Timer className="h-7 w-7" />, color: "#38BDF8", label: "TIMED", value: "Per Game" },
                { icon: <Gamepad2 className="h-7 w-7" />, color: "#A855F7", label: "GAMES", value: "6" },
                { icon: <Brain className="h-7 w-7" />, color: "#F59E0B", label: "ADAPTIVE", value: ageGroup.label.split(' ')[0] },
              ].map((s, i) => (
                <div key={i} className="stat-card group relative px-6 sm:px-7 py-5 rounded-2xl cursor-default transition-all duration-500 hover:scale-110"
                  style={kid ? { ...kidTile(s.color), animationDelay: `${i * 0.15}s` } : { background: `${s.color}10`, border: `1px solid ${s.color}30`, animationDelay: `${i * 0.15}s` }}>
                  <div className="mx-auto mb-3 w-12 h-12 rounded-2xl flex items-center justify-center" style={kid ? { background: "#FFFFFF", color: kidDeep(s.color), border: `2px solid ${KID_INK}` } : { background: `${s.color}20`, color: s.color }}>
                    {s.icon}
                  </div>
                  <p className={`uppercase font-bold ${kid ? "text-xs tracking-wider" : "text-[10px] tracking-[0.2em]"}`} style={{ color: kid ? kidDeep(s.color) : `${s.color}80` }}>{s.label}</p>
                  <p className="text-2xl font-black mt-1" style={{ color: kid ? KID_INK : "#F1F5F9" }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Selected Games Preview */}
            <GlassCard className="text-start">
              <Accordion type="single" collapsible>
                <AccordionItem value="games" className="border-none">
                  <AccordionTrigger className={`${kid ? "text-base font-black" : "text-sm font-bold"} py-2 hover:no-underline`} style={{ color: kid ? KID_INK : "#F1F5F9" }}>
                    <span className="flex items-center gap-2"><Target className="h-4 w-4" style={{ color: kid ? "#0369A1" : "#38BDF8" }} /> Your {selectedGames.length} Games</span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2.5 pt-2">
                      {selectedGames.map((g, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-xl" style={kid ? { background: kidSoft(g.color), border: `2px solid ${KID_INK}` } : { background: `${g.color}08`, border: `1px solid ${g.color}15` }}>
                          <span className={kid ? "text-3xl" : "text-2xl"}>{g.icon}</span>
                          <div>
                            <p className={kid ? "text-base font-black" : "text-sm font-bold"} style={{ color: kid ? kidDeep(g.color) : g.color }}>{g.name}</p>
                            <p className={kid ? "text-sm font-medium" : "text-xs"} style={{ color: kid ? KID_INK : "rgba(241,245,249,0.5)" }}>{g.objective}</p>
                            <p className={kid ? "text-xs font-semibold mt-1" : "text-[10px] mt-1"} style={{ color: kid ? KID_MUTED : "rgba(241,245,249,0.3)" }}>
                              {g.dimension}{isLittleGame(g.id) ? "" : ` · ${g.timeLimit[ageGroup.id]}s`}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </GlassCard>

            {/* T&C */}
            <div className={`flex items-center justify-center gap-3 ${kid ? "mx-auto w-fit px-5 py-3 rounded-full" : ""}`} style={kid ? KID_CARD : undefined}>
              <Checkbox id="terms" checked={termsAccepted} onCheckedChange={c => setTermsAccepted(!!c)}
                className={kid ? "h-5 w-5 border-2 border-[#24135F] data-[state=checked]:bg-[#15803D] data-[state=checked]:border-[#24135F]" : "border-white/30 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500"} />
              <label htmlFor="terms" className={`cursor-pointer ${kid ? "text-base font-semibold" : "text-sm"}`} style={{ color: kid ? KID_INK : "rgba(241,245,249,0.6)" }}>
                I agree to the{" "}
                <button onClick={() => setTermsOpen(true)} className="underline font-semibold" style={{ color: kid ? "#0369A1" : "#38BDF8" }}>
                  Terms & Conditions
                </button>
              </label>
            </div>

            <button onClick={() => { playClickSound(); startRound(); }} disabled={!termsAccepted}
              className={`group relative px-14 py-6 rounded-2xl text-xl font-black tracking-wide transition-all duration-300 disabled:cursor-not-allowed hover:scale-110 active:scale-95 ${kid ? "disabled:opacity-60 rounded-full" : "disabled:opacity-20"}`}
              style={kid ? {
                background: termsAccepted ? "#FFB830" : "#E5E1F5",
                color: KID_INK,
                border: `3px solid ${KID_INK}`,
                boxShadow: `0 6px 0 ${KID_INK}`,
              } : {
                background: termsAccepted ? "linear-gradient(135deg, #6366F1, #A855F7, #F472B6)" : "rgba(255,255,255,0.1)",
                color: "#F1F5F9",
                boxShadow: termsAccepted ? "0 0 60px rgba(99,102,241,0.5), 0 8px 32px rgba(0,0,0,0.3)" : "none",
              }}>
              {termsAccepted && <span className="absolute -top-2 -end-2 text-lg animate-bounce">✨</span>}
              <span className="relative flex items-center gap-3">
                <Rocket className="h-6 w-6" /> START ROUND
              </span>
            </button>

            {/* T&C Modal */}
            <Dialog open={termsOpen} onOpenChange={setTermsOpen}>
              <DialogContent className="max-w-lg" style={{ background: "linear-gradient(135deg, #1E1B4B, #0F172A)", border: "1px solid rgba(255,255,255,0.1)", color: "#F1F5F9" }}>
                <DialogHeader>
                  <DialogTitle className="text-xl font-black flex items-center gap-2" style={{ color: "#F1F5F9" }}>
                    <Shield className="h-5 w-5" style={{ color: "#6366F1" }} /> Terms & Conditions
                  </DialogTitle>
                </DialogHeader>
                <ScrollArea className="max-h-96 pe-4">
                  <div className="space-y-5 text-sm" style={{ color: "rgba(241,245,249,0.7)" }}>
                    <Section icon={<Shield className="h-4 w-4" style={{ color: "#38BDF8" }} />} title="Fair Play Policy">
                      <ul className="list-disc ps-4 space-y-1"><li>Complete independently.</li><li>No external help or calculators.</li></ul>
                    </Section>
                    <Section icon={<Eye className="h-4 w-4" style={{ color: "#A855F7" }} />} title="Data & Privacy">
                      <ul className="list-disc ps-4 space-y-1"><li>Data stored securely for learning analytics.</li><li>Not shared with third parties.</li></ul>
                    </Section>
                    <Section icon={<BarChart3 className="h-4 w-4" style={{ color: "#84CC16" }} />} title="Scoring & Results">
                      <ul className="list-disc ps-4 space-y-1"><li>Scores are final.</li><li>Results available immediately.</li></ul>
                    </Section>
                  </div>
                </ScrollArea>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => { setTermsAccepted(true); setTermsOpen(false); }}
                    className="flex-1 py-3 rounded-xl font-bold text-sm" style={{ background: "linear-gradient(135deg, #6366F1, #A855F7)", color: "#F1F5F9" }}>
                    Accept
                  </button>
                  <button onClick={() => setTermsOpen(false)} className="flex-1 py-3 rounded-xl font-bold text-sm"
                    style={{ background: "rgba(255,255,255,0.08)", color: "rgba(241,245,249,0.6)" }}>
                    Decline
                  </button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* ─── PRE_GAME ─── */}
        {phase === "PRE_GAME" && currentGameConfig && ageGroup && (
          <div className="text-center max-w-md mx-auto space-y-6 pregame-enter">
            <div className="relative w-24 h-24 mx-auto">
              <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ background: currentGameConfig.color }} />
              <div className="absolute inset-0 rounded-full animate-pulse" style={{ background: `${currentGameConfig.color}20`, border: `2px solid ${currentGameConfig.color}40` }} />
              <div className="absolute inset-0 flex items-center justify-center text-5xl game-icon-bounce">{currentGameConfig.icon}</div>
            </div>

            <div>
              <h2 className="text-3xl font-black" style={kid ? KID_ON_SKY : { color: currentGameConfig.color }}>{currentGameConfig.name}</h2>
              <p className={`text-sm mt-1 ${kid ? "font-bold" : "font-medium"}`} style={{ color: kid ? "#FFFFFF" : "rgba(241,245,249,0.5)" }}>{currentGameConfig.dimension}</p>
            </div>

            {kid ? (
              <p className="text-base font-bold px-5 py-3 rounded-2xl" style={{ ...KID_CARD, color: KID_INK }}>{currentGameConfig.objective}</p>
            ) : (
              <p className="text-base font-medium" style={{ color: "#F1F5F9" }}>{currentGameConfig.objective}</p>
            )}

            <GlassCard glow={currentGameConfig.color}>
              <p className={`uppercase tracking-widest font-bold mb-3 ${kid ? "text-xs" : "text-[10px]"}`} style={{ color: kid ? kidDeep(currentGameConfig.color) : "rgba(241,245,249,0.4)" }}>HOW TO PLAY</p>
              {currentGameConfig.rules[ageGroup.id].map((r, i) => (
                <div key={i} className="flex items-start gap-2 mb-2">
                  <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" style={{ color: kid ? kidDeep(currentGameConfig.color) : currentGameConfig.color }} />
                  <span className={`text-start ${kid ? "text-base font-medium" : "text-sm"}`} style={{ color: kid ? KID_INK : "rgba(241,245,249,0.7)" }}>{r}</span>
                </div>
              ))}
            </GlassCard>

            <div className="flex justify-center gap-4">
              <div className="px-5 py-3 rounded-xl text-center" style={kid ? kidTile(currentGameConfig.color) : { background: `${currentGameConfig.color}10`, border: `1px solid ${currentGameConfig.color}20` }}>
                <span className="text-lg">⏱</span>
                <p className="text-sm font-bold mt-1" style={{ color: kid ? KID_INK : "#F1F5F9" }}>{isLittleGame(currentGameConfig.id) ? "No timer" : `${currentGameConfig.timeLimit[ageGroup.id]}s`}</p>
                <p className={`uppercase ${kid ? "text-xs font-semibold" : "text-[10px]"}`} style={{ color: kid ? KID_MUTED : "rgba(241,245,249,0.4)" }}>Time</p>
              </div>
              <div className="px-5 py-3 rounded-xl text-center" style={kid ? kidTile(currentGameConfig.color) : { background: `${currentGameConfig.color}10`, border: `1px solid ${currentGameConfig.color}20` }}>
                <span className="text-lg">📊</span>
                <p className="text-sm font-bold mt-1" style={{ color: kid ? KID_INK : "#F1F5F9" }}>{currentGameConfig.scoring}</p>
                <p className={`uppercase ${kid ? "text-xs font-semibold" : "text-[10px]"}`} style={{ color: kid ? KID_MUTED : "rgba(241,245,249,0.4)" }}>Scoring</p>
              </div>
            </div>

            {(content.status === "empty" || content.status === "error") && (
              <div className="rounded-2xl p-4 text-sm text-start"
                style={kid ? { ...KID_CARD, color: "#92400E" } : { background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "#FCD34D" }}>
                {content.message}
              </div>
            )}

            {content.status === "empty" || content.status === "error" ? (
              <div className="flex justify-center gap-3">
                {content.status === "error" && (
                  <button onClick={() => setContentRetry(n => n + 1)}
                    className="px-6 py-3 rounded-2xl font-bold text-sm transition-all hover:scale-105 active:scale-95"
                    style={kid ? { background: "#FFB830", color: KID_INK, border: `3px solid ${KID_INK}`, boxShadow: `0 4px 0 ${KID_INK}` } : { background: currentGameConfig.color, color: "#0F172A" }}>
                    Try again
                  </button>
                )}
                <button onClick={goToNextGame}
                  className="px-6 py-3 rounded-2xl font-bold text-sm transition-all hover:scale-105 active:scale-95"
                  style={kid ? { ...KID_CARD, color: KID_INK } : { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#F1F5F9" }}>
                  {currentGame + 1 >= selectedGames.length ? "Finish round" : "Skip this game"}
                </button>
              </div>
            ) : (
              <button onClick={startCountdown} disabled={content.status !== "ready"}
                className="group px-10 py-4 rounded-2xl font-black text-lg transition-all duration-300 hover:scale-110 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-wait"
                style={kid ? { background: "#FFB830", color: KID_INK, border: `3px solid ${KID_INK}`, boxShadow: `0 6px 0 ${KID_INK}`, borderRadius: 999 } : { background: currentGameConfig.color, color: "#0F172A", boxShadow: `0 0 40px ${currentGameConfig.color}50` }}>
                <span className="flex items-center gap-2">
                  {content.status === "ready" ? <>Ready? Let's Go! <Zap className="h-5 w-5" /></> : "Preparing your questions…"}
                </span>
              </button>
            )}
          </div>
        )}

        {/* ─── COUNTDOWN ─── */}
        {phase === "COUNTDOWN" && currentGameConfig && (
          <div className="text-center countdown-pop">
            <div className="relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-48 rounded-full animate-ping opacity-10" style={{ background: currentGameConfig.color }} />
              </div>
              <div className="text-[10rem] font-black leading-none" style={kid ? {
                color: countdown > 0 ? "#FFD23F" : "#4ADE80",
                textShadow: `0 8px 0 ${KID_INK}, 0 0 6px ${KID_INK}`,
              } : {
                color: countdown > 0 ? currentGameConfig.color : "#22C55E",
                textShadow: `0 0 80px ${countdown > 0 ? currentGameConfig.color : "#22C55E"}80`,
              }}>
                {countdown > 0 ? countdown : "GO!"}
              </div>
            </div>
          </div>
        )}

        {/* ─── PLAYING ─── */}
        {phase === "PLAYING" && (
          <div className="w-full max-w-2xl mx-auto game-enter">
            <button onClick={() => { playClickSound(); setQuitConfirm(true); }}
              className="fixed bottom-4 end-4 z-40 p-3 rounded-full transition-all hover:scale-110"
              style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", backdropFilter: "blur(8px)" }}>
              <X className="h-5 w-5" style={{ color: "#EF4444" }} />
            </button>
            {renderGame()}
            <Dialog open={quitConfirm} onOpenChange={setQuitConfirm}>
              <DialogContent style={{ background: "linear-gradient(135deg, #1E1B4B, #0F172A)", border: "1px solid rgba(255,255,255,0.1)", color: "#F1F5F9" }}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2" style={{ color: "#F1F5F9" }}>
                    <X className="h-5 w-5" style={{ color: "#EF4444" }} /> Quit Game?
                  </DialogTitle>
                </DialogHeader>
                <p className="text-sm" style={{ color: "rgba(241,245,249,0.6)" }}>Your progress will be saved with partial results.</p>
                <div className="flex gap-3 pt-2">
                  <button onClick={handleQuit} className="flex-1 py-2.5 rounded-xl font-bold text-sm"
                    style={{ background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", color: "#EF4444" }}>Yes, Quit</button>
                  <button onClick={() => setQuitConfirm(false)} className="flex-1 py-2.5 rounded-xl font-bold text-sm"
                    style={{ background: "rgba(255,255,255,0.08)", color: "#F1F5F9" }}>Continue</button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* ─── POST_GAME ─── */}
        {phase === "POST_GAME" && results.length > 0 && currentGameConfig && (
          <div className="text-center max-w-md mx-auto space-y-6 postgame-enter">
            {(() => {
              const r = results[results.length - 1];
              const speedRating = r.avgResponseTime < 1500 ? "Fast ⚡" : r.avgResponseTime < 3000 ? "Average 🏃" : "Slow 🐢";
              return (
                <>
                  <div className="relative w-20 h-20 mx-auto">
                    <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ background: currentGameConfig.color }} />
                    <div className="absolute inset-0 flex items-center justify-center text-5xl trophy-bounce">🏆</div>
                  </div>
                  <div>
                    <h2 className="text-2xl font-black" style={kid ? KID_ON_SKY : { color: currentGameConfig.color }}>{r.gameName}</h2>
                    <p className="text-lg font-bold mt-1" style={kid ? { ...KID_ON_SKY, color: "#FFD23F" } : { color: "#22C55E" }}>Complete! ✨</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Score", value: String(r.rawScore), color: "#6366F1" },
                      { label: "Accuracy", value: `${r.accuracy}%`, color: "#22C55E" },
                      { label: "Speed", value: speedRating, color: "#F59E0B" },
                    ].map((s, i) => (
                      <GlassCard key={i} glow={s.color} className="!p-4">
                        <p className={`uppercase tracking-widest mb-1 ${kid ? "text-xs font-bold" : "text-[10px]"}`} style={{ color: kid ? KID_MUTED : "rgba(241,245,249,0.4)" }}>{s.label}</p>
                        <p className={`font-black ${kid ? "text-xl" : "text-2xl"}`} style={{ color: kid ? kidDeep(s.color) : s.color }}>{s.value}</p>
                      </GlassCard>
                    ))}
                  </div>
                  <button onClick={goToNextGame}
                    className="group px-10 py-4 rounded-2xl font-black text-base transition-all duration-300 hover:scale-110 active:scale-95 flex items-center gap-3 mx-auto"
                    style={kid ? { background: "#FFB830", color: KID_INK, border: `3px solid ${KID_INK}`, boxShadow: `0 6px 0 ${KID_INK}`, borderRadius: 999 } : { background: "linear-gradient(135deg, #6366F1, #A855F7)", color: "#F1F5F9", boxShadow: "0 0 40px rgba(99,102,241,0.4)" }}>
                    {currentGame + 1 >= selectedGames.length ? (
                      <>View Results <BarChart3 className="h-5 w-5" /></>
                    ) : (
                      <>Next Game <ArrowRight className="h-5 w-5" /></>
                    )}
                  </button>
                </>
              );
            })()}
          </div>
        )}

        {/* ─── RESULTS ─── */}
        {phase === "RESULTS" && (
          <div className="w-full max-w-2xl mx-auto space-y-8 pb-8 results-enter">
            <div className="text-center space-y-3">
              <div className="text-5xl mb-2">🏆</div>
              <h1 className="text-3xl md:text-5xl font-black tracking-tight"
                style={kid ? { ...KID_ON_SKY, textShadow: `0 4px 0 ${KID_INK}, 0 0 4px ${KID_INK}` } : { background: "linear-gradient(135deg, #6366F1, #A855F7, #F472B6, #38BDF8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Final Results
              </h1>
              <p className={`text-sm ${kid ? "font-bold" : "font-medium"}`} style={{ color: kid ? "#FFFFFF" : "rgba(241,245,249,0.5)" }}>
                Completed in {formatElapsed(elapsedTime)} · {ageGroup?.label} · {subject}
              </p>
            </div>

            <GlassCard className="text-center" glow="#6366F1">
              <div className="relative inline-block">
                <CircularTimer timeLeft={cognitiveScore} total={100} size={180} />
              </div>
              <p className="text-xl font-black mt-3" style={{ color: kid ? KID_INK : "#F1F5F9" }}>
                Cognitive Score: <AnimatedCounter value={cognitiveScore} />/100
              </p>
              <div className="mt-2 inline-block px-6 py-2 rounded-full text-sm font-black"
                style={kid ? { background: "#FFF1B8", border: `2px solid ${KID_INK}`, color: KID_INK } : { background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.3)", color: "#A855F7" }}>
                {tier.emoji} {tier.label}
              </div>
            </GlassCard>

            {/* Radar Chart */}
            <GlassCard>
              <p className={`uppercase tracking-widest font-bold text-center mb-3 ${kid ? "text-xs" : "text-[10px]"}`} style={{ color: kid ? KID_MUTED : "rgba(241,245,249,0.4)" }}>COGNITIVE PROFILE</p>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={selectedGames.map((g, i) => {
                  const r = results.find(r => r.gameIndex === i);
                  return { dimension: g.dimension.split(" ")[0], score: r ? Math.round((r.rawScore / Math.max(r.maxScore, 1)) * 100) : 0, fullMark: 100 };
                })}>
                  <PolarGrid stroke={kid ? "#D6CFF2" : "rgba(255,255,255,0.08)"} />
                  <PolarAngleAxis dataKey="dimension" tick={{ fill: kid ? KID_INK : "rgba(241,245,249,0.6)", fontSize: kid ? 12 : 11, fontWeight: kid ? 700 : 600 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar dataKey="score" stroke="#6366F1" fill="url(#radarGrad)" strokeWidth={2.5} dot={{ fill: "#A855F7", r: 4 }} />
                  <defs>
                    <linearGradient id="radarGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#6366F1" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#A855F7" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                </RadarChart>
              </ResponsiveContainer>
            </GlassCard>

            {/* Breakdown */}
            <GlassCard className="!p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: kid ? "#FFF1B8" : "rgba(255,255,255,0.05)" }}>
                    {["Game", "Score", "Accuracy", "Time"].map(h => (
                      <th key={h} className={`p-4 font-bold uppercase tracking-widest ${kid ? "text-xs" : "text-[10px]"} ${h === "Game" ? "text-start" : "text-center"}`}
                        style={{ color: kid ? KID_INK : "rgba(241,245,249,0.4)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const gameConf = selectedGames[r.gameIndex];
                    return (
                      <tr key={i} className="transition-colors hover:bg-white/[0.03]" style={{ borderTop: kid ? "2px solid #E9E2FF" : "1px solid rgba(255,255,255,0.05)" }}>
                        <td className="p-4 font-bold" style={{ color: kid ? (gameConf?.color ? kidDeep(gameConf.color) : KID_INK) : (gameConf?.color || "#F1F5F9") }}>
                          <span className="me-2">{gameConf?.icon}</span>{r.gameName}
                        </td>
                        <td className="text-center p-4 font-black" style={{ color: kid ? KID_INK : "#F1F5F9" }}>{r.rawScore}</td>
                        <td className="text-center p-4 font-bold" style={{ color: kid
                          ? (r.accuracy >= 70 ? "#15803D" : r.accuracy >= 40 ? "#B45309" : "#DC2626")
                          : (r.accuracy >= 70 ? "#22C55E" : r.accuracy >= 40 ? "#F59E0B" : "#EF4444") }}>
                          {r.accuracy}%
                        </td>
                        <td className="text-center p-4" style={{ color: kid ? KID_MUTED : "rgba(241,245,249,0.6)" }}>{r.timeUsed}s</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </GlassCard>

            <RoundRewardsCard rewards={sessionRewards} />

            <div className="flex gap-3 justify-center">
              <button onClick={() => { setPhase("SETUP"); setHubTab("play"); setResults([]); setCurrentGame(0); setElapsedTime(0); setTermsAccepted(false); setSelectedGames([]); setSessionRewards([]); g2.refresh(); }}
                className="group px-8 py-4 rounded-2xl font-black text-sm transition-all duration-300 hover:scale-105"
                style={kid ? { background: "#FFB830", color: KID_INK, border: `3px solid ${KID_INK}`, boxShadow: `0 5px 0 ${KID_INK}`, borderRadius: 999 } : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "#F1F5F9" }}>
                <span className="flex items-center gap-2">🔄 New Round</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes celebration-fall { 0% { transform: translateY(0) rotate(0deg); opacity: 1; } 80% { opacity: 1; } 100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }
        .celebration-fall { animation: celebration-fall linear forwards; }
        @keyframes celebration-sway-fall { 0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 1; } 25% { transform: translateY(25vh) translateX(var(--sway, 40px)) rotate(90deg); } 50% { transform: translateY(50vh) translateX(calc(var(--sway, 40px) * -0.5)) rotate(180deg); } 75% { transform: translateY(75vh) translateX(var(--sway, 40px)) rotate(270deg); opacity: 0.8; } 100% { transform: translateY(100vh) translateX(0) rotate(360deg); opacity: 0; } }
        .celebration-sway-fall { animation: celebration-sway-fall ease-in-out forwards; }
        @keyframes orb-float { 0%, 100% { transform: translate(0, 0) scale(1); } 25% { transform: translate(30px, -50px) scale(1.1); } 50% { transform: translate(-20px, 30px) scale(0.9); } 75% { transform: translate(40px, 20px) scale(1.05); } }
        .orb-float { animation: orb-float ease-in-out infinite; }
        @keyframes particle-rise { 0% { transform: translateY(0); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 0.5; } 100% { transform: translateY(-100vh); opacity: 0; } }
        .particle-rise { animation: particle-rise linear infinite; }
        @keyframes shooting-star { 0% { transform: translateX(-100px); opacity: 0; width: 0; } 5% { opacity: 1; } 30% { opacity: 0; width: 200px; } 100% { transform: translateX(100vw); opacity: 0; width: 0; } }
        .shooting-star { position: absolute; height: 1px; background: linear-gradient(90deg, transparent, #38BDF8, transparent); animation: shooting-star 12s linear infinite; }
        @keyframes welcome-enter { 0% { opacity: 0; transform: translateY(40px) scale(0.95); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        .welcome-enter { animation: welcome-enter 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes pregame-enter { 0% { opacity: 0; transform: scale(0.8); } 100% { opacity: 1; transform: scale(1); } }
        .pregame-enter { animation: pregame-enter 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        @keyframes game-enter { 0% { opacity: 0; transform: translateX(60px); } 100% { opacity: 1; transform: translateX(0); } }
        .game-enter { animation: game-enter 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes postgame-enter { 0% { opacity: 0; transform: scale(0.9) translateY(30px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        .postgame-enter { animation: postgame-enter 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        @keyframes results-enter { 0% { opacity: 0; transform: translateY(60px); } 100% { opacity: 1; transform: translateY(0); } }
        .results-enter { animation: results-enter 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes countdown-pop { 0% { opacity: 0; transform: scale(3); } 50% { opacity: 1; transform: scale(0.9); } 100% { opacity: 1; transform: scale(1); } }
        .countdown-pop { animation: countdown-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        @keyframes trophy-bounce { 0%, 100% { transform: translateY(0); } 25% { transform: translateY(-12px) rotate(-5deg); } 75% { transform: translateY(-6px) rotate(5deg); } }
        .trophy-bounce { animation: trophy-bounce 2s ease-in-out infinite; }
        @keyframes game-icon-bounce { 0%, 100% { transform: scale(1); } 25% { transform: scale(1.15) rotate(-5deg); } 75% { transform: scale(1.1) rotate(5deg); } }
        .game-icon-bounce { animation: game-icon-bounce 2.5s ease-in-out infinite; }
        .title-glow { filter: drop-shadow(0 0 30px rgba(99,102,241,0.4)); }
        .timer-glow { box-shadow: 0 0 20px rgba(56,189,248,0.15); }
        .progress-glow { box-shadow: 0 0 12px rgba(99,102,241,0.4); }
        .stat-card { animation: welcome-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }
        @keyframes orbit { 0% { transform: translate(-50%, -50%) rotate(0deg) translateX(80px) rotate(0deg); } 100% { transform: translate(-50%, -50%) rotate(360deg) translateX(80px) rotate(-360deg); } }
        .orbit-particle { animation: orbit 6s linear infinite; }
      `}</style>
    </div>
  );

  return <AppLayout><GamificationThemeProvider tier={visualTier}>{gameWrapper}</GamificationThemeProvider></AppLayout>;
};

export default Gamification;