import { useState, useEffect, useRef, useCallback } from "react";
import { GameResult } from "../types";
import { AgeGroupId } from "../engine/ageGroups";
import { playCorrectSound, playWrongSound } from "../sounds";

// Matching structural contract dynamically prepared by your parent state
interface CustomSpeedItem {
  id: string;
  question: string;
  options: string[];
  answer: string;
}

interface Props {
  onComplete: (result: GameResult) => void;
  studentName: string;
  ageGroup: AgeGroupId;
  subject: string;
  gameIndex: number;
  timeLimit: number;
  customSpeedElements?: CustomSpeedItem[]; // Added missing receiver prop layout link
}

interface DisplayItem {
  id: number;
  text: string;
  isTarget: boolean;
  x: number;
  y: number;
}

export function SpeedTap({ onComplete, ageGroup, gameIndex, timeLimit, customSpeedElements }: Props) {
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [currentRuleText, setCurrentRuleText] = useState("Tap the correct items!");
  const MAX_QUESTIONS = 5; // Matches the strict 5-round wrapper cap perfectly
  const [score, setScore] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [attempted, setAttempted] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  
  const startTime = useRef(Date.now());
  const responseTimes = useRef<number[]>([]);
  const itemCounter = useRef(0);
  const spawnInterval = useRef<ReturnType<typeof setInterval>>();
  const localPoolRef = useRef<CustomSpeedItem[]>([]);

  const getSpawnRate = () => ageGroup === 'early_learners' ? 2000 : ageGroup === 'explorers' ? 1500 : 1200;

  const spawnItem = useCallback(() => {
    if (localPoolRef.current.length === 0) return;

    // Pick a random question asset block from our class-wise content array
    const randomQuestionBlock = localPoolRef.current[Math.floor(Math.random() * localPoolRef.current.length)];
    if (!randomQuestionBlock) return;

    // Set the flying item text objective prompt globally
    setCurrentRuleText(randomQuestionBlock.question);

    // Decouple options array to spawn targets or wrong answers randomly
    const optionsArray = randomQuestionBlock.options || [];
    const textSelection = optionsArray[Math.floor(Math.random() * optionsArray.length)] || randomQuestionBlock.answer;
    const isTarget = textSelection === randomQuestionBlock.answer;

    const newItem: DisplayItem = {
      id: itemCounter.current++,
      text: textSelection,
      isTarget,
      // Grid positioning layout configurations to prevent screen clipping overflow
      x: 10 + Math.random() * 70,
      y: 15 + Math.random() * 65,
    };

    setItems(prev => [...prev.slice(-6), newItem]); // Safely cap flying elements on screen at once
  }, []);

  // Primary Initialization and Data Loading Cycle Hook
  useEffect(() => {
    if (customSpeedElements && customSpeedElements.length > 0) {
      localPoolRef.current = [...customSpeedElements];
    } else {
      // Fallback base local initialization pool context
      localPoolRef.current = [
        { id: "1", question: "Tap the prime number", options: ["2", "4", "6", "8"], answer: "2" },
        { id: "2", question: "Tap the vowel character", options: ["A", "X", "Z", "K"], answer: "A" }
      ];
    }

    startTime.current = Date.now();
    
    // Kick off interval loop ticks instantly
    if (spawnInterval.current) clearInterval(spawnInterval.current);
    spawnInterval.current = setInterval(spawnItem, getSpawnRate());

    return () => {
      if (spawnInterval.current) clearInterval(spawnInterval.current);
    };
  }, [customSpeedElements, spawnItem]);

  // Master Game Execution & Termination Check Hook
  useEffect(() => {
    if (timeLeft <= 0 || attempted >= MAX_QUESTIONS) { 
      finishGame(); 
      return; 
    }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, attempted]);

  // Self-cleaning hook prevents old elements from over-cluttering screen fields
  useEffect(() => {
    const cleaner = setInterval(() => {
      setItems(prev => prev.filter(item => item.id > itemCounter.current - 5));
    }, 2500);
    return () => clearInterval(cleaner);
  }, []);

  const finishGame = () => {
    if (spawnInterval.current) clearInterval(spawnInterval.current);
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
    const nextAttempted = attempted + 1;
    setAttempted(nextAttempted);
    
    // Remove target element from state rendering immediately on tap trigger
    setItems(prev => prev.filter(i => i.id !== item.id));

    if (item.isTarget) {
      const nextScore = score + 10;
      setScore(nextScore);
      setCorrect(p => p + 1);
      playCorrectSound();

      // Programmatic short-circuit to bypass async batch delay lags at the final target tap
      if (nextAttempted >= MAX_QUESTIONS) {
        if (spawnInterval.current) clearInterval(spawnInterval.current);
        const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
        const avgResp = Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length);
        onComplete({
          gameIndex,
          gameName: "Speed Tap",
          rawScore: Math.max(0, nextScore),
          maxScore: nextAttempted * 10,
          accuracy: Math.round(((correct + 1) / nextAttempted) * 100),
          avgResponseTime: avgResp,
          questionsAttempted: nextAttempted,
          questionsCorrect: correct + 1,
          timeUsed,
          timeLimit,
        });
      }
    } else {
      if (ageGroup !== 'early_learners') setScore(p => p - 5);
      playWrongSound();
    }
  };

  const timerColor = timeLeft > timeLimit * 0.5 ? "#22C55E" : timeLeft > timeLimit * 0.2 ? "#F59E0B" : "#EF4444";

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-lg mx-auto">
      <div className="flex items-center justify-between w-full">
        <span className="text-sm font-medium" style={{ color: "#EF4444" }}>
          Progress: {attempted}/{MAX_QUESTIONS}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: "#F1F5F9" }}>Score: {score}</span>
          <span className="text-sm font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: timerColor }}>
            {timeLeft}s
          </span>
        </div>
      </div>

      <div className="w-full text-center p-3 rounded-xl shadow-md min-h-[50px] flex items-center justify-center transition-all" 
        style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
        <p className="text-xs sm:text-sm font-black tracking-wide" style={{ color: "#F87171" }}>
          🎯 OBJECTIVE: {currentRuleText}
        </p>
      </div>

      <div className="relative w-full rounded-2xl overflow-hidden shadow-inner bg-slate-950/40 border border-white/10" style={{ height: 320 }}>
        {items.map(item => (
          <button 
            key={item.id} 
            onClick={() => handleTap(item)}
            className="absolute px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all hover:scale-110 active:scale-90 shadow-md break-words max-w-[150px]"
            style={{
              left: `${item.x}%`,
              top: `${item.y}%`,
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#F1F5F9",
              zIndex: 10,
            }}
          >
            {item.text.toUpperCase()}
          </button>
        ))}

        {items.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500">
            <div className="w-5 h-5 rounded-full border-2 border-t-transparent border-slate-500 animate-spin" />
            <p className="text-xs italic tracking-wider">Spawning flying items...</p>
          </div>
        )}
      </div>
    </div>
  );
}