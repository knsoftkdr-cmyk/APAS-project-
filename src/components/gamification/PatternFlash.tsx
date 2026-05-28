import { useState, useEffect, useCallback, useRef } from "react";
import { GameProps, GameResult } from "./types";
import { playCorrectSound, playWrongSound, playNextSound, playLevelUpSound } from "./sounds";

const GRID_SIZE = 4;

// Difficulty levels: start super easy, gradually increase
const LEVELS = [
  { tiles: 2, memorizeTime: 6000, label: "Very Easy" },
  { tiles: 3, memorizeTime: 5000, label: "Easy" },
  { tiles: 4, memorizeTime: 4500, label: "Medium" },
  { tiles: 5, memorizeTime: 4000, label: "Hard" },
  { tiles: 6, memorizeTime: 3500, label: "Very Hard" },
  { tiles: 7, memorizeTime: 3000, label: "Expert" },
];

export function PatternFlash({ onComplete }: GameProps) {
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState<"memorize" | "recall" | "feedback">("memorize");
  const [targetTiles, setTargetTiles] = useState<number[]>([]);
  const [selectedTiles, setSelectedTiles] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(0);
  const [totalCorrect, setTotalCorrect] = useState(0);
  const [totalAttempted, setTotalAttempted] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [roundsPlayed, setRoundsPlayed] = useState(0);
  const [streak, setStreak] = useState(0);
  const [diffLabel, setDiffLabel] = useState("Very Easy");
  const responseTimes = useRef<number[]>([]);
  const roundStart = useRef(Date.now());
  const startTime = useRef(Date.now());

  const generateTargets = useCallback((count: number) => {
    const tiles: number[] = [];
    while (tiles.length < count) {
      const t = Math.floor(Math.random() * (GRID_SIZE * GRID_SIZE));
      if (!tiles.includes(t)) tiles.push(t);
    }
    return tiles;
  }, []);

  const startRound = useCallback(() => {
    const lvl = LEVELS[Math.min(level, LEVELS.length - 1)];
    setDiffLabel(lvl.label);
    const targets = generateTargets(lvl.tiles);
    setTargetTiles(targets);
    setSelectedTiles([]);
    setPhase("memorize");

    setTimeout(() => {
      setPhase("recall");
      roundStart.current = Date.now();
    }, lvl.memorizeTime);
  }, [level, generateTargets]);

  useEffect(() => {
    startTime.current = Date.now();
    startRound();
  }, []);

  useEffect(() => {
    if (timeLeft <= 0) { finishGame(); return; }
    const t = setTimeout(() => setTimeLeft((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft]);

  const finishGame = () => {
    const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
    const avgResp = responseTimes.current.length > 0
      ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
      : 0;
    onComplete({
      gameIndex: 0,
      gameName: "Pattern Flash",
      rawScore: Math.max(0, score),
      maxScore: roundsPlayed * LEVELS[Math.min(level, LEVELS.length - 1)].tiles * 10,
      accuracy: totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0,
      avgResponseTime: avgResp,
      questionsAttempted: totalAttempted,
      questionsCorrect: totalCorrect,
      timeUsed,
      timeLimit: 60,
    });
  };

  const handleTileClick = (idx: number) => {
    if (phase !== "recall" || selectedTiles.includes(idx)) return;

    responseTimes.current.push(Date.now() - roundStart.current);
    const newSelected = [...selectedTiles, idx];
    setSelectedTiles(newSelected);
    setTotalAttempted((p) => p + 1);

    if (targetTiles.includes(idx)) {
      setScore((p) => p + 10);
      setTotalCorrect((p) => p + 1);
      playCorrectSound();
    } else {
      setScore((p) => p - 5);
      playWrongSound();
    }

    const correctSelected = newSelected.filter((t) => targetTiles.includes(t)).length;
    if (correctSelected >= targetTiles.length || newSelected.length >= targetTiles.length + 2) {
      setPhase("feedback");
      setRoundsPlayed((p) => p + 1);

      const roundAccuracy = correctSelected / targetTiles.length;

      setTimeout(() => {
        if (roundAccuracy >= 0.8) {
          // Good round — increase streak, maybe level up
          const newStreak = streak + 1;
          setStreak(newStreak);
          if (newStreak >= 2) {
            setLevel((p) => Math.min(p + 1, LEVELS.length - 1));
            setStreak(0);
            playLevelUpSound();
          }
        } else {
          // Poor round — decrease difficulty
          setStreak(0);
          setLevel((p) => Math.max(p - 1, 0));
        }
        setRound((p) => p + 1);
        playNextSound();
        startRound();
      }, 1200);
    }
  };

  const timerColor = timeLeft > 30 ? "#22C55E" : timeLeft > 10 ? "#F59E0B" : "#EF4444";

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex items-center justify-between w-full max-w-md">
        <div className="flex flex-col">
          <span className="text-sm font-medium" style={{ color: "#38BDF8" }}>
            Round {round + 1}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full mt-1" style={{ background: "rgba(56,189,248,0.2)", color: "#38BDF8" }}>
            {diffLabel}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold" style={{ color: "#F1F5F9" }}>Score: {score}</span>
          <span className="text-sm font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: timerColor }}>
            {timeLeft}s
          </span>
        </div>
      </div>

      <div className="text-center">
        {phase === "memorize" && (
          <p className="text-sm animate-pulse" style={{ color: "#38BDF8" }}>
            👀 Memorize the highlighted tiles...
          </p>
        )}
        {phase === "recall" && (
          <p className="text-sm" style={{ color: "#F1F5F9" }}>
            🎯 Now click the tiles you remember!
          </p>
        )}
        {phase === "feedback" && (
          <p className="text-sm" style={{ color: "#22C55E" }}>
            ✅ Round complete!
          </p>
        )}
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)` }}>
        {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, idx) => {
          const isTarget = targetTiles.includes(idx);
          const isSelected = selectedTiles.includes(idx);
          const showHighlight = phase === "memorize" && isTarget;
          const showCorrect = phase === "feedback" && isTarget;
          const showWrong = phase === "feedback" && isSelected && !isTarget;

          let bg = "rgba(255,255,255,0.06)";
          let border = "1px solid rgba(255,255,255,0.1)";
          let shadow = "none";

          if (showHighlight) {
            bg = "rgba(56,189,248,0.5)";
            border = "1px solid #38BDF8";
            shadow = "0 0 20px rgba(56,189,248,0.4)";
          } else if (isSelected && phase === "recall") {
            bg = isTarget ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)";
            border = isTarget ? "1px solid #22C55E" : "1px solid #EF4444";
          } else if (showCorrect) {
            bg = "rgba(34,197,94,0.3)";
            border = "1px solid #22C55E";
          } else if (showWrong) {
            bg = "rgba(239,68,68,0.3)";
            border = "1px solid #EF4444";
          }

          return (
            <button
              key={idx}
              onClick={() => handleTileClick(idx)}
              disabled={phase !== "recall"}
              className="w-16 h-16 md:w-20 md:h-20 rounded-xl transition-all duration-300 cursor-pointer hover:scale-105 active:scale-95"
              style={{ background: bg, border, boxShadow: shadow }}
            />
          );
        })}
      </div>
    </div>
  );
}
