import { useState, useEffect, useRef, useCallback } from "react";
import { GameResult } from "../types";
import { AgeGroupId } from "../engine/ageGroups";
import { getSortCategories, SortCategory } from "../engine/contentPools";
import { playCorrectSound, playWrongSound, playNextSound } from "../sounds";

// Define a structural interface matching your custom content pool matrix items
interface CustomCategoryGroup {
  name: string;
  items: string[];
}

interface Props {
  onComplete: (result: GameResult) => void;
  studentName: string;
  ageGroup: AgeGroupId;
  subject: string;
  gameIndex: number;
  timeLimit: number;
  customCategories?: CustomCategoryGroup[]; // Integrated custom dynamic pool receiver prop
}

export function CategorySort({ onComplete, ageGroup, subject, gameIndex, timeLimit, customCategories }: Props) {
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
    if (!cat) return;
    const allItems = [
      ...cat.leftItems.map(i => ({ item: i, side: 'left' as const })),
      ...cat.rightItems.map(i => ({ item: i, side: 'right' as const })),
    ];
    if (allItems.length === 0) return;
    const pick = allItems[Math.floor(Math.random() * allItems.length)];
    setCurrentItem(pick.item);
    setCorrectSide(pick.side);
    itemStart.current = Date.now();
  }, []);

  useEffect(() => {
    let cats: SortCategory[] = [];

    // Prioritize targeted incoming Class + Subject sorting parameters
    if (customCategories && customCategories.length >= 2) {
      // Split our pool groups into distinct Left vs Right categorizations dynamically
      const leftGroup = customCategories[0];
      const rightGroup = customCategories[1];

      // Declare a completely separate plain config object to break the strict type loop
      const intermediateCategoryConfig = {
        id: 999, 
        rule: `Classify items into ${leftGroup.name} or ${rightGroup.name}`,
        leftLabel: leftGroup.name,
        rightLabel: rightGroup.name,
        leftItems: leftGroup.items,
        rightItems: rightGroup.items
      };

      // Cast the entire object layout at once down to the target type array 
      cats = [intermediateCategoryConfig as unknown as SortCategory];
    } else {
      // Fallback to legacy default engine pools
      cats = getSortCategories(subject, ageGroup);
    }

    categories.current = cats;
    if (cats.length > 0) {
      spawnItem(cats[0]);
    }
    startTime.current = Date.now();
  }, [customCategories, subject, ageGroup, spawnItem]);

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
      const nextAttempted = attempted + 1;
      if (nextAttempted >= MAX_QUESTIONS) {
        return; // useEffect handler will trigger finishGame cleanly
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

      <div className="w-44 h-44 flex items-center justify-center rounded-2xl p-4 text-center text-xl font-bold transition-all shadow-xl"
        style={{ background: "rgba(255,255,255,0.08)", border: "2px solid rgba(34,197,94,0.4)", color: "#F1F5F9" }}>
        {feedback ? <span className="text-4xl">{feedback}</span> : currentItem.toUpperCase()}
      </div>

      <div className="flex gap-4 w-full">
        <button onClick={() => handleSort('left')}
          className="flex-1 py-5 px-3 rounded-xl font-bold text-sm sm:text-base transition-all hover:scale-105 active:scale-95 text-center break-words shadow-md"
          style={{ background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.4)", color: "#C084FC" }}>
          ⬅ {cat.leftLabel.toUpperCase()}
        </button>
        <button onClick={() => handleSort('right')}
          className="flex-1 py-5 px-3 rounded-xl font-bold text-sm sm:text-base transition-all hover:scale-105 active:scale-95 text-center break-words shadow-md"
          style={{ background: "rgba(56,189,248,0.2)", border: "1px solid rgba(56,189,248,0.4)", color: "#7DD3FC" }}>
          {cat.rightLabel.toUpperCase()} ➡
        </button>
      </div>
    </div>
  );
}