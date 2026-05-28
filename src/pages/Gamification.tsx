import { useState, useEffect, useRef, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useGamification } from "@/hooks/useGamification";
import { fetchClassWiseContent } from "@/components/gamification/engine/classWiseContentPool";
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
import { SelectedGame, GameMode } from "@/components/gamification/engine/gameSelector";
import { AgeGroup } from "@/components/gamification/engine/ageGroups";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import {
  Brain, Zap, Timer, ChevronRight,
  ArrowRight, X, Shield, Eye, BarChart3,
  Sparkles, Target, Flame, Gamepad2, Rocket,
} from "lucide-react";
import { playCountdownBeep, playGoSound, playVictorySound, playClickSound } from "@/components/gamification/sounds";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";

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
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = timeLeft / total;
  const color = pct > 0.5 ? "#22C55E" : pct > 0.2 ? "#F59E0B" : "#EF4444";
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
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
    <div className={`fixed top-4 right-4 z-40 px-5 py-2.5 rounded-2xl shadow-2xl transition-transform duration-300 ${pop ? "scale-125" : "scale-100"}`}
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
  return (
    <div className="w-full max-w-md mx-auto">
      <div className="flex justify-between mb-1.5">
        <span className="text-xs font-medium" style={{ color: "rgba(241,245,249,0.5)" }}>Progress</span>
        <span className="text-xs font-bold" style={{ color: "#F1F5F9" }}>Game {Math.min(current + 1, total)} of {total}</span>
      </div>
      <div className="w-full h-2.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div className="h-full rounded-full transition-all duration-700 ease-out progress-glow"
          style={{ width: `${(current / total) * 100}%`, background: "linear-gradient(90deg, #6366F1, #A855F7, #F472B6)" }} />
      </div>
      <div className="flex justify-between mt-2 px-1">
        {games.map((g, i) => (
          <div key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition-all duration-500 ${i < current ? "scale-100" : i === current ? "scale-110 ring-2 ring-white/30" : "scale-90 opacity-40"}`}
            style={{ background: i < current ? g.color : i === current ? `${g.color}90` : "rgba(255,255,255,0.1)", color: i <= current ? "#0F172A" : "rgba(241,245,249,0.3)", fontWeight: 700 }}>
            {i < current ? "✓" : g.icon}
          </div>
        ))}
      </div>
    </div>
  );
}

function GlassCard({ children, className = "", glow = "" }: { children: React.ReactNode; className?: string; glow?: string }) {
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

  // NEW CENTRALIZED REPETITION TRACKER
  const [playedHistory, setPlayedHistory] = useState<Record<string, string[]>>({});

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
    playCountdownBeep();
    const t = setTimeout(() => setCountdown(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, phase]);

  useEffect(() => {
    if (phase !== "POST_GAME") return;
    playVictorySound();
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
    startTimeRef.current = Date.now();
    timerActive.current = true;
    setElapsedTime(0);
    setPhase("PRE_GAME");
  };

  const startCountdown = () => { setCountdown(3); setPhase("COUNTDOWN"); };

  const handleGameComplete = (result: GameResult, loggedUniqueKeys: string[] = []) => {
    const activeGameConfig = selectedGames[currentGame];
    if (activeGameConfig) {
      const historyCompositeKey = `${studentClass}_${subject}_${activeGameConfig.id}`.toLowerCase();
      setPlayedHistory(prev => ({
        ...prev,
        [historyCompositeKey]: [...(prev[historyCompositeKey] || []), ...loggedUniqueKeys]
      }));
    }

    setResults(prev => [...prev, result]);
    setPhase("POST_GAME");
  };

  const goToNextGame = () => {
    if (currentGame + 1 >= selectedGames.length) {
      timerActive.current = false;
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 6000);
      setPhase("RESULTS");
      awardXp("complete_assessment", "Completed Adaptive Gamification Round");
    } else {
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

    const classWiseContent = fetchClassWiseContent(studentClass, subject);
    const historyCompositeKey = `${studentClass}_${subject}_${currentGameConfig.id}`.toLowerCase();
    const alreadyPlayedItems = playedHistory[historyCompositeKey] || [];

    const commonProps = {
      studentName,
      ageGroup: ageGroup.id,
      subject,
      gameIndex: currentGame,
      timeLimit: currentGameConfig.timeLimit[ageGroup.id],
    };

    switch (currentGameConfig.id) {
      case 'quick-quiz': {
        const rawPool = classWiseContent.quizzes || [];
        const freshPool = rawPool.filter(q => !alreadyPlayedItems.includes(q.question));
        
        const finalPool = freshPool.length > 0 ? freshPool : rawPool;
        if (freshPool.length === 0 && alreadyPlayedItems.length > 0) {
          setTimeout(() => setPlayedHistory(p => ({ ...p, [historyCompositeKey]: [] })), 0);
        }

        return (
          <QuickQuiz 
            {...commonProps} 
            customQuizzes={finalPool} 
            onComplete={(res) => handleGameComplete(res, finalPool.map(q => q.question))} 
          />
        );
      }
        
      case 'word-scramble': {
        const rawPool = classWiseContent.scrambles || [];
        const freshPool = rawPool.filter(s => !alreadyPlayedItems.includes(s.word));
        
        const finalPool = freshPool.length > 0 ? freshPool : rawPool;
        if (freshPool.length === 0 && alreadyPlayedItems.length > 0) {
          setTimeout(() => setPlayedHistory(p => ({ ...p, [historyCompositeKey]: [] })), 0);
        }

        return (
          <WordScramble 
            {...commonProps} 
            customScrambles={finalPool} 
            onComplete={(res) => handleGameComplete(res, finalPool.map(s => s.word))} 
          />
        );
      }
        
      case 'match-pairs': {
        const rawPool = classWiseContent.pairs || [];
        const freshPool = rawPool.filter(p => !alreadyPlayedItems.includes(p.item1));
        
        const finalPool = freshPool.length > 0 ? freshPool : rawPool;
        if (freshPool.length === 0 && alreadyPlayedItems.length > 0) {
          setTimeout(() => setPlayedHistory(p => ({ ...p, [historyCompositeKey]: [] })), 0);
        }

        return (
          <MatchPairs 
            {...commonProps} 
            customPairs={finalPool} 
            onComplete={(res) => handleGameComplete(res, finalPool.map(p => p.item1))} 
          />
        );
      }
        
      case 'category-sort': {
        const rawPool = classWiseContent.categories || [];
        const freshPool = rawPool.filter(c => !alreadyPlayedItems.includes(c.name || ""));
        
        const finalPool = freshPool.length > 0 ? freshPool : rawPool;
        if (freshPool.length === 0 && alreadyPlayedItems.length > 0) {
          setTimeout(() => setPlayedHistory(p => ({ ...p, [historyCompositeKey]: [] })), 0);
        }

        return (
          <CategorySort 
            {...commonProps} 
            customCategories={finalPool} 
            onComplete={(res) => handleGameComplete(res, finalPool.map(c => c.name || ""))} 
          />
        );
      }
        
      case 'speed-tap': {
        const rawPool = classWiseContent.quizzes || [];
        const freshPool = rawPool.filter(q => !alreadyPlayedItems.includes(q.question || ""));
        
        const finalPool = freshPool.length > 0 ? freshPool : rawPool;
        if (freshPool.length === 0 && alreadyPlayedItems.length > 0) {
          setTimeout(() => setPlayedHistory(p => ({ ...p, [historyCompositeKey]: [] })), 0);
        }

        const speedTapElements = finalPool.map((item, idx) => ({
          id: `speed_${idx}_${item.answer}`,
          question: item.question,
          options: item.options,
          answer: item.answer
        }));

        return (
          <SpeedTap 
            {...commonProps} 
            customSpeedElements={speedTapElements}
            onComplete={(res) => handleGameComplete(res, speedTapElements.map(st => st.id))} 
          />
        );
      }
        
      case 'visual-memory': {
        const rawPool = classWiseContent.scrambles || [];
        const freshPool = rawPool.filter(s => !alreadyPlayedItems.includes(s.word || ""));
        
        const finalPool = freshPool.length > 0 ? freshPool : rawPool;
        if (freshPool.length === 0 && alreadyPlayedItems.length > 0) {
          setTimeout(() => setPlayedHistory(p => ({ ...p, [historyCompositeKey]: [] })), 0);
        }

        const parsedVisualMemorySets = finalPool.map((v) => ({
          items: [v.word, "STUDY", "LEARN", "BRAIN"],
          questions: [
            {
              question: `Which word matched the hint: "${v.hint}"?`,
              options: [v.word, "STUDY", "LEARN", "BRAIN"],
              answer: v.word
            }
          ]
        }));

        return (
          <VisualMemory 
            {...commonProps} 
            customVisuals={parsedVisualMemorySets}
            onComplete={(res) => handleGameComplete(res, finalPool.map(v => v.word))} 
          />
        );
      }
        
      default:
        return <QuickQuiz {...commonProps} onComplete={(res) => handleGameComplete(res, [])} />;
    }
  };

  const gameWrapper = (
    <div className="min-h-screen relative" style={{ background: "linear-gradient(135deg, #0F172A 0%, #1e1147 50%, #312E81 100%)" }}>
      <AnimatedBackground />
      <FloatingParticles />
      <Confetti show={showConfetti} />

      {(phase === "PLAYING" || phase === "PRE_GAME" || phase === "COUNTDOWN" || phase === "POST_GAME") && (
        <div className="fixed top-4 left-4 z-40 flex items-center gap-2 px-4 py-2 rounded-2xl timer-glow"
          style={{ background: "rgba(15,23,42,0.85)", backdropFilter: "blur(16px)", border: "1px solid rgba(56,189,248,0.2)" }}>
          <Timer className="h-4 w-4 animate-pulse" style={{ color: "#38BDF8" }} />
          <span className="text-sm font-mono font-black tabular-nums" style={{ color: "#F1F5F9" }}>
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
          <GameSetupScreen onStart={handleSetupComplete} />
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
              <h1 className="text-5xl md:text-7xl font-black tracking-tight title-glow"
                style={{ background: "linear-gradient(135deg, #6366F1 0%, #A855F7 25%, #F472B6 50%, #38BDF8 75%, #84CC16 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Adaptive Round
              </h1>
              <div className="flex items-center justify-center gap-3">
                <Sparkles className="h-5 w-5 animate-pulse" style={{ color: "#F59E0B" }} />
                <p className="text-xl font-medium" style={{ color: "rgba(241,245,249,0.7)" }}>
                  Welcome, <span className="font-black" style={{ background: "linear-gradient(135deg, #38BDF8, #6366F1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{studentName}</span>
                </p>
                <Sparkles className="h-5 w-5 animate-pulse" style={{ color: "#F59E0B" }} />
              </div>
            </div>

            {/* Age group & subject badge */}
            <div className="flex justify-center gap-4 flex-wrap">
              <div className="px-5 py-3 rounded-2xl flex items-center gap-2" style={{ background: `${ageGroup.color}15`, border: `1px solid ${ageGroup.color}30` }}>
                <span className="text-xl">{ageGroup.emoji}</span>
                <div>
                  <p className="text-xs font-bold" style={{ color: ageGroup.color }}>{ageGroup.label}</p>
                  <p className="text-[10px]" style={{ color: "rgba(241,245,249,0.4)" }}>Age {ageGroup.ageRange[0]}-{ageGroup.ageRange[1]}</p>
                </div>
              </div>
              <div className="px-5 py-3 rounded-2xl flex items-center gap-2" style={{ background: gameMode === 'generic' ? "rgba(56,189,248,0.1)" : "rgba(168,85,247,0.1)", border: `1px solid ${gameMode === 'generic' ? "rgba(56,189,248,0.3)" : "rgba(168,85,247,0.3)"}` }}>
                <span className="text-xl">{gameMode === 'generic' ? '🧩' : '📘'}</span>
                <div>
                  <p className="text-xs font-bold" style={{ color: gameMode === 'generic' ? "#7DD3FC" : "#A855F7" }}>{gameMode === 'generic' ? 'Generic Mode' : subject}</p>
                  <p className="text-[10px]" style={{ color: "rgba(241,245,249,0.4)" }}>Class {studentClass}</p>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="flex justify-center gap-5">
              {[
                { icon: <Timer className="h-7 w-7" />, color: "#38BDF8", label: "TIMED", value: "Per Game" },
                { icon: <Gamepad2 className="h-7 w-7" />, color: "#A855F7", label: "GAMES", value: "6" }, // Updated display count to 6
                { icon: <Brain className="h-7 w-7" />, color: "#F59E0B", label: "ADAPTIVE", value: ageGroup.label.split(' ')[0] },
              ].map((s, i) => (
                <div key={i} className="stat-card group relative px-7 py-5 rounded-2xl cursor-default transition-all duration-500 hover:scale-110"
                  style={{ background: `${s.color}10`, border: `1px solid ${s.color}30`, animationDelay: `${i * 0.15}s` }}>
                  <div className="mx-auto mb-3 w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: `${s.color}20`, color: s.color }}>
                    {s.icon}
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.2em] font-bold" style={{ color: `${s.color}80` }}>{s.label}</p>
                  <p className="text-2xl font-black mt-1" style={{ color: "#F1F5F9" }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Selected Games Preview */}
            <GlassCard className="text-left">
              <Accordion type="single" collapsible>
                <AccordionItem value="games" className="border-none">
                  <AccordionTrigger className="text-sm font-bold py-2 hover:no-underline" style={{ color: "#F1F5F9" }}>
                    {/* Updated header label to 6 Games */}
                    <span className="flex items-center gap-2"><Target className="h-4 w-4" style={{ color: "#38BDF8" }} /> Your 6 Games</span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2.5 pt-2">
                      {selectedGames.map((g, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: `${g.color}08`, border: `1px solid ${g.color}15` }}>
                          <span className="text-2xl">{g.icon}</span>
                          <div>
                            <p className="text-sm font-bold" style={{ color: g.color }}>{g.name}</p>
                            <p className="text-xs" style={{ color: "rgba(241,245,249,0.5)" }}>{g.objective}</p>
                            <p className="text-[10px] mt-1" style={{ color: "rgba(241,245,249,0.3)" }}>
                              {g.dimension} · {g.timeLimit[ageGroup.id]}s
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
            <div className="flex items-center justify-center gap-3">
              <Checkbox id="terms" checked={termsAccepted} onCheckedChange={c => setTermsAccepted(!!c)}
                className="border-white/30 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500" />
              <label htmlFor="terms" className="text-sm cursor-pointer" style={{ color: "rgba(241,245,249,0.6)" }}>
                I agree to the{" "}
                <button onClick={() => setTermsOpen(true)} className="underline font-semibold" style={{ color: "#38BDF8" }}>
                  Terms & Conditions
                </button>
              </label>
            </div>

            <button onClick={() => { playClickSound(); startRound(); }} disabled={!termsAccepted}
              className="group relative px-14 py-6 rounded-2xl text-xl font-black tracking-wide transition-all duration-300 disabled:opacity-20 disabled:cursor-not-allowed hover:scale-110 active:scale-95"
              style={{
                background: termsAccepted ? "linear-gradient(135deg, #6366F1, #A855F7, #F472B6)" : "rgba(255,255,255,0.1)",
                color: "#F1F5F9",
                boxShadow: termsAccepted ? "0 0 60px rgba(99,102,241,0.5), 0 8px 32px rgba(0,0,0,0.3)" : "none",
              }}>
              {termsAccepted && <span className="absolute -top-2 -right-2 text-lg animate-bounce">✨</span>}
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
                <ScrollArea className="max-h-96 pr-4">
                  <div className="space-y-5 text-sm" style={{ color: "rgba(241,245,249,0.7)" }}>
                    <Section icon={<Shield className="h-4 w-4" style={{ color: "#38BDF8" }} />} title="Fair Play Policy">
                      <ul className="list-disc pl-4 space-y-1"><li>Complete independently.</li><li>No external help or calculators.</li></ul>
                    </Section>
                    <Section icon={<Eye className="h-4 w-4" style={{ color: "#A855F7" }} />} title="Data & Privacy">
                      <ul className="list-disc pl-4 space-y-1"><li>Data stored securely for learning analytics.</li><li>Not shared with third parties.</li></ul>
                    </Section>
                    <Section icon={<BarChart3 className="h-4 w-4" style={{ color: "#84CC16" }} />} title="Scoring & Results">
                      <ul className="list-disc pl-4 space-y-1"><li>Scores are final.</li><li>Results available immediately.</li></ul>
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
              <h2 className="text-3xl font-black" style={{ color: currentGameConfig.color }}>{currentGameConfig.name}</h2>
              <p className="text-sm mt-1 font-medium" style={{ color: "rgba(241,245,249,0.5)" }}>{currentGameConfig.dimension}</p>
            </div>

            <p className="text-base font-medium" style={{ color: "#F1F5F9" }}>{currentGameConfig.objective}</p>

            <GlassCard glow={currentGameConfig.color}>
              <p className="text-[10px] uppercase tracking-widest font-bold mb-3" style={{ color: "rgba(241,245,249,0.4)" }}>HOW TO PLAY</p>
              {currentGameConfig.rules[ageGroup.id].map((r, i) => (
                <div key={i} className="flex items-start gap-2 mb-2">
                  <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" style={{ color: currentGameConfig.color }} />
                  <span className="text-sm text-left" style={{ color: "rgba(241,245,249,0.7)" }}>{r}</span>
                </div>
              ))}
            </GlassCard>

            <div className="flex justify-center gap-4">
              <div className="px-5 py-3 rounded-xl text-center" style={{ background: `${currentGameConfig.color}10`, border: `1px solid ${currentGameConfig.color}20` }}>
                <span className="text-lg">⏱</span>
                <p className="text-sm font-bold mt-1" style={{ color: "#F1F5F9" }}>{currentGameConfig.timeLimit[ageGroup.id]}s</p>
                <p className="text-[10px] uppercase" style={{ color: "rgba(241,245,249,0.4)" }}>Time</p>
              </div>
              <div className="px-5 py-3 rounded-xl text-center" style={{ background: `${currentGameConfig.color}10`, border: `1px solid ${currentGameConfig.color}20` }}>
                <span className="text-lg">📊</span>
                <p className="text-sm font-bold mt-1" style={{ color: "#F1F5F9" }}>{currentGameConfig.scoring}</p>
                <p className="text-[10px] uppercase" style={{ color: "rgba(241,245,249,0.4)" }}>Scoring</p>
              </div>
            </div>

            <button onClick={startCountdown}
              className="group px-10 py-4 rounded-2xl font-black text-lg transition-all duration-300 hover:scale-110 active:scale-95"
              style={{ background: currentGameConfig.color, color: "#0F172A", boxShadow: `0 0 40px ${currentGameConfig.color}50` }}>
              <span className="flex items-center gap-2">Ready? Let's Go! <Zap className="h-5 w-5" /></span>
            </button>
          </div>
        )}

        {/* ─── COUNTDOWN ─── */}
        {phase === "COUNTDOWN" && currentGameConfig && (
          <div className="text-center countdown-pop">
            <div className="relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-48 rounded-full animate-ping opacity-10" style={{ background: currentGameConfig.color }} />
              </div>
              <div className="text-[10rem] font-black leading-none" style={{
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
            <button onClick={() => setQuitConfirm(true)}
              className="fixed bottom-4 right-4 z-40 p-3 rounded-full transition-all hover:scale-110"
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
                    <h2 className="text-2xl font-black" style={{ color: currentGameConfig.color }}>{r.gameName}</h2>
                    <p className="text-lg font-bold mt-1" style={{ color: "#22C55E" }}>Complete! ✨</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Score", value: String(r.rawScore), color: "#6366F1" },
                      { label: "Accuracy", value: `${r.accuracy}%`, color: "#22C55E" },
                      { label: "Speed", value: speedRating, color: "#F59E0B" },
                    ].map((s, i) => (
                      <GlassCard key={i} glow={s.color} className="!p-4">
                        <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "rgba(241,245,249,0.4)" }}>{s.label}</p>
                        <p className="text-2xl font-black" style={{ color: s.color }}>{s.value}</p>
                      </GlassCard>
                    ))}
                  </div>
                  <button onClick={goToNextGame}
                    className="group px-10 py-4 rounded-2xl font-black text-base transition-all duration-300 hover:scale-110 active:scale-95 flex items-center gap-3 mx-auto"
                    style={{ background: "linear-gradient(135deg, #6366F1, #A855F7)", color: "#F1F5F9", boxShadow: "0 0 40px rgba(99,102,241,0.4)" }}>
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
                style={{ background: "linear-gradient(135deg, #6366F1, #A855F7, #F472B6, #38BDF8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Final Results
              </h1>
              <p className="text-sm font-medium" style={{ color: "rgba(241,245,249,0.5)" }}>
                Completed in {formatElapsed(elapsedTime)} · {ageGroup?.label} · {subject}
              </p>
            </div>

            <GlassCard className="text-center" glow="#6366F1">
              <div className="relative inline-block">
                <CircularTimer timeLeft={cognitiveScore} total={100} size={180} />
              </div>
              <p className="text-xl font-black mt-3" style={{ color: "#F1F5F9" }}>
                Cognitive Score: <AnimatedCounter value={cognitiveScore} />/100
              </p>
              <div className="mt-2 inline-block px-6 py-2 rounded-full text-sm font-black"
                style={{ background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.3)", color: "#A855F7" }}>
                {tier.emoji} {tier.label}
              </div>
            </GlassCard>

            {/* Radar Chart */}
            <GlassCard>
              <p className="text-[10px] uppercase tracking-widest font-bold text-center mb-3" style={{ color: "rgba(241,245,249,0.4)" }}>COGNITIVE PROFILE</p>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={selectedGames.map((g, i) => {
                  const r = results.find(r => r.gameIndex === i);
                  return { dimension: g.dimension.split(" ")[0], score: r ? Math.round((r.rawScore / Math.max(r.maxScore, 1)) * 100) : 0, fullMark: 100 };
                })}>
                  <PolarGrid stroke="rgba(255,255,255,0.08)" />
                  <PolarAngleAxis dataKey="dimension" tick={{ fill: "rgba(241,245,249,0.6)", fontSize: 11, fontWeight: 600 }} />
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
                  <tr style={{ background: "rgba(255,255,255,0.05)" }}>
                    {["Game", "Score", "Accuracy", "Time"].map(h => (
                      <th key={h} className={`p-4 font-bold text-[10px] uppercase tracking-widest ${h === "Game" ? "text-left" : "text-center"}`}
                        style={{ color: "rgba(241,245,249,0.4)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const gameConf = selectedGames[r.gameIndex];
                    return (
                      <tr key={i} className="transition-colors hover:bg-white/[0.03]" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                        <td className="p-4 font-bold" style={{ color: gameConf?.color || "#F1F5F9" }}>
                          <span className="mr-2">{gameConf?.icon}</span>{r.gameName}
                        </td>
                        <td className="text-center p-4 font-black" style={{ color: "#F1F5F9" }}>{r.rawScore}</td>
                        <td className="text-center p-4 font-bold" style={{ color: r.accuracy >= 70 ? "#22C55E" : r.accuracy >= 40 ? "#F59E0B" : "#EF4444" }}>
                          {r.accuracy}%
                        </td>
                        <td className="text-center p-4" style={{ color: "rgba(241,245,249,0.6)" }}>{r.timeUsed}s</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </GlassCard>

            <div className="flex gap-3 justify-center">
              <button onClick={() => { setPhase("SETUP"); setResults([]); setCurrentGame(0); setElapsedTime(0); setTermsAccepted(false); setSelectedGames([]); }}
                className="group px-8 py-4 rounded-2xl font-black text-sm transition-all duration-300 hover:scale-105"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "#F1F5F9" }}>
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

  return <AppLayout>{gameWrapper}</AppLayout>;
};

export default Gamification;
