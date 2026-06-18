import { useState, useEffect, useRef, useCallback } from "react";
import { GameResult } from "../types";
import { AgeGroupId } from "../engine/ageGroups";
import { getSortCategories, SortCategory } from "../engine/contentPools";
import { playCorrectSound, playWrongSound, playNextSound } from "../sounds";

interface Props {
  onComplete: (result: GameResult) => void;
  studentName: string;
  ageGroup: AgeGroupId;
  subject: string;
  gameIndex: number;
  timeLimit: number;
}

export function CategorySort({ onComplete, ageGroup, subject, gameIndex, timeLimit }: Props) {
  const categories = useRef<SortCategory[]>([]);
  const [catIndex, setCatIndex] = useState(0);
  const [currentItem, setCurrentItem] = useState('');
  const [correctSide, setCorrectSide] = useState<'left' | 'right'>('left');
  const MAX_QUESTIONS = 10;
  const [score, setScore] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [attempted, setAttempted] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [feedback, setFeedback] = useState<string | null>(null);
  const startTime = useRef(Date.now());
  const responseTimes = useRef<number[]>([]);
  const itemStart = useRef(Date.now());

  const spawnItem = useCallback((cat: SortCategory) => {
    const allItems = [
      ...cat.leftItems.map(i => ({ item: i, side: 'left' as const })),
      ...cat.rightItems.map(i => ({ item: i, side: 'right' as const })),
    ];
    const pick = allItems[Math.floor(Math.random() * allItems.length)];
    setCurrentItem(pick.item);
    setCorrectSide(pick.side);
    itemStart.current = Date.now();
  }, []);

  useEffect(() => {
    const cats = getSortCategories(subject, ageGroup);
    categories.current = cats;
    if (cats.length > 0) spawnItem(cats[0]);
    startTime.current = Date.now();
  }, []);

  useEffect(() => {
    if (timeLeft <= 0 || attempted >= MAX_QUESTIONS) { finishGame(); return; }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, attempted]);

  const cat = catIndex < categories.current.length ? categories.current[catIndex] : categories.current[0];

  const finishGame = () => {
    const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
    const avgResp = responseTimes.current.length > 0
      ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
      : 0;
    onComplete({
      gameIndex,
      gameName: "Category Sort",
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

  const handleSort = (side: 'left' | 'right') => {
    if (feedback || !cat) return;
    responseTimes.current.push(Date.now() - itemStart.current);
    setAttempted(p => p + 1);

    if (side === correctSide) {
      setScore(p => p + 10);
      setCorrect(p => p + 1);
      setFeedback("✅");
      playCorrectSound();
    } else {
      if (ageGroup !== 'early_learners') setScore(p => p - 5);
      setFeedback("❌");
      playWrongSound();
    }

    setTimeout(() => {
      setFeedback(null);
      // Check if we've reached max after state update
      const nextAttempted = attempted + 1;
      if (nextAttempted >= MAX_QUESTIONS) {
        return; // useEffect will trigger finishGame
      }
      playNextSound();
      spawnItem(cat);
    }, 500);
  };

  if (!cat) return <div style={{ color: "#F1F5F9" }}>Loading...</div>;

  const timerColor = timeLeft > timeLimit * 0.5 ? "#22C55E" : timeLeft > timeLimit * 0.2 ? "#F59E0B" : "#EF4444";

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-lg mx-auto">
      <div className="flex items-center justify-between w-full">
        <span className="text-sm font-medium" style={{ color: "#22C55E" }}>Sorted: {attempted}/{MAX_QUESTIONS}</span>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: "#F1F5F9" }}>Score: {score}</span>
          <span className="text-sm font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: timerColor }}>
            {timeLeft}s
          </span>
        </div>
      </div>

      <div className="w-full text-center p-3 rounded-xl" style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}>
        <p className="text-xs mb-1" style={{ color: "rgba(34,197,94,0.7)" }}>SORTING RULE</p>
        <p className="text-sm font-bold" style={{ color: "#22C55E" }}>{cat.rule}</p>
      </div>

      <div className="w-36 h-36 flex items-center justify-center rounded-2xl text-2xl font-bold"
        style={{ background: "rgba(255,255,255,0.08)", border: "2px solid rgba(34,197,94,0.4)", color: "#F1F5F9" }}>
        {feedback ? <span className="text-4xl">{feedback}</span> : currentItem}
      </div>

      <div className="flex gap-4 w-full">
        <button onClick={() => handleSort('left')}
          className="flex-1 py-5 rounded-xl font-bold text-base transition-all hover:scale-105 active:scale-95"
          style={{ background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.4)", color: "#A855F7" }}>
          ⬅ {cat.leftLabel}
        </button>
        <button onClick={() => handleSort('right')}
          className="flex-1 py-5 rounded-xl font-bold text-base transition-all hover:scale-105 active:scale-95"
          style={{ background: "rgba(56,189,248,0.2)", border: "1px solid rgba(56,189,248,0.4)", color: "#38BDF8" }}>
          {cat.rightLabel} ➡
        </button>
      </div>
    </div>
  );
}