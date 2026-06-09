import { useState, useEffect, useRef, useCallback } from "react";
import { GameResult } from "../types";
import { AgeGroupId } from "../engine/ageGroups";
import { getSpeedTapRules, SpeedTapRule } from "../engine/contentPools";
import { playCorrectSound, playWrongSound, playNextSound } from "../sounds";

interface Props {
  onComplete: (result: GameResult) => void;
  studentName: string;
  ageGroup: AgeGroupId;
  subject: string;
  gameIndex: number;
  timeLimit: number;
}

interface DisplayItem {
  id: number;
  text: string;
  isTarget: boolean;
  x: number;
  y: number;
}

export function SpeedTap({ onComplete, ageGroup, subject, gameIndex, timeLimit }: Props) {
  const rules = useRef<SpeedTapRule[]>([]);
  const [ruleIndex, setRuleIndex] = useState(0);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const MAX_QUESTIONS = 10;
  const [score, setScore] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [attempted, setAttempted] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const startTime = useRef(Date.now());
  const responseTimes = useRef<number[]>([]);
  const itemCounter = useRef(0);
  const spawnInterval = useRef<ReturnType<typeof setInterval>>();

  const getSpawnRate = () => ageGroup === 'early_learners' ? 2000 : ageGroup === 'explorers' ? 1500 : 1200;

  const spawnItem = useCallback(() => {
    const rule = ruleIndex < rules.current.length ? rules.current[ruleIndex] : rules.current[0];
    if (!rule) return;
    const allPool = [...rule.targets, ...rule.distractors];
    const text = allPool[Math.floor(Math.random() * allPool.length)];
    const isTarget = rule.targets.includes(text);
    const newItem: DisplayItem = {
      id: itemCounter.current++,
      text,
      isTarget,
      x: 10 + Math.random() * 70,
      y: 10 + Math.random() * 60,
    };
    setItems(prev => [...prev.slice(-8), newItem]); // Keep max 9 items
  }, [ruleIndex]);

  useEffect(() => {
    const r = getSpeedTapRules(subject, ageGroup);
    rules.current = r;
    startTime.current = Date.now();
    spawnInterval.current = setInterval(spawnItem, getSpawnRate());
    return () => clearInterval(spawnInterval.current);
  }, []);

  // Re-setup interval when spawnItem changes
  useEffect(() => {
    clearInterval(spawnInterval.current);
    spawnInterval.current = setInterval(spawnItem, getSpawnRate());
    return () => clearInterval(spawnInterval.current);
  }, [spawnItem]);

  useEffect(() => {
    if (timeLeft <= 0 || attempted >= MAX_QUESTIONS) { finishGame(); return; }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, attempted]);

  // Auto-remove old items
  useEffect(() => {
    const t = setInterval(() => {
      setItems(prev => prev.filter(item => Date.now() - (item.id * 100) < 5000 || prev.indexOf(item) > prev.length - 6));
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const finishGame = () => {
    clearInterval(spawnInterval.current);
    const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
    const avgResp = responseTimes.current.length > 0
      ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
      : 0;
    onComplete({
      gameIndex,
      gameName: "Speed Tap",
      rawScore: Math.max(0, score),
      maxScore: attempted * 10,
      accuracy: attempted > 0 ? Math.round((correct / attempted) * 100) : 0,
      avgResponseTime: avgResp,
      questionsAttempted: attempted,
      questionsCorrect: correct,
      timeUsed,
      timeLimit,
    });
  };

  const handleTap = (item: DisplayItem) => {
    responseTimes.current.push(Date.now() - startTime.current);
    setAttempted(p => p + 1);
    setItems(prev => prev.filter(i => i.id !== item.id));

    if (item.isTarget) {
      setScore(p => p + 10);
      setCorrect(p => p + 1);
      playCorrectSound();
    } else {
      if (ageGroup !== 'early_learners') setScore(p => p - 8);
      playWrongSound();
    }
  };

  const rule = ruleIndex < rules.current.length ? rules.current[ruleIndex] : rules.current[0];
  const timerColor = timeLeft > timeLimit * 0.5 ? "#22C55E" : timeLeft > timeLimit * 0.2 ? "#F59E0B" : "#EF4444";

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-lg mx-auto">
      <div className="flex items-center justify-between w-full">
        <span className="text-sm font-medium" style={{ color: "#EF4444" }}>Tapped: {attempted}/{MAX_QUESTIONS}</span>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: "#F1F5F9" }}>Score: {score}</span>
          <span className="text-sm font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: timerColor }}>
            {timeLeft}s
          </span>
        </div>
      </div>

      {rule && (
        <div className="w-full text-center p-2 rounded-xl" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
          <p className="text-sm font-bold" style={{ color: "#EF4444" }}>{rule.instruction}</p>
        </div>
      )}

      <div className="relative w-full rounded-2xl overflow-hidden" style={{ height: 300, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)" }}>
        {items.map(item => (
          <button key={item.id} onClick={() => handleTap(item)}
            className="absolute px-4 py-2 rounded-xl font-bold text-sm transition-all hover:scale-110 active:scale-90 animate-fade-in"
            style={{
              left: `${item.x}%`,
              top: `${item.y}%`,
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#F1F5F9",
              zIndex: 10,
            }}>
            {item.text}
          </button>
        ))}
        {items.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ color: "rgba(241,245,249,0.3)" }}>
            <p className="text-sm">Items appearing soon...</p>
          </div>
        )}
      </div>
    </div>
  );
}