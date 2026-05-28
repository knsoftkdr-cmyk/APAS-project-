import { useState, useEffect, useRef } from "react";
import { GameResult } from "../types";
import { AgeGroupId } from "../engine/ageGroups";
import { getMatchPairs } from "../engine/contentPools";
import { playCorrectSound, playWrongSound, playNextSound, playLevelUpSound } from "../sounds";

// Define a structural interface matching your custom content pool matrix items
interface CustomMatchItem {
  item1: string;
  item2: string;
}

interface Props {
  onComplete: (result: GameResult) => void;
  studentName: string;
  ageGroup: AgeGroupId;
  subject: string;
  gameIndex: number;
  timeLimit: number;
  customPairs?: CustomMatchItem[]; // Integrated custom dynamic pool receiver
}

interface Card {
  id: number;
  content: string;
  pairId: number;
  flipped: boolean;
  matched: boolean;
}

export function MatchPairs({ onComplete, ageGroup, subject, gameIndex, timeLimit, customPairs }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [flippedIds, setFlippedIds] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [matchCount, setMatchCount] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [locked, setLocked] = useState(false);
  const [numPairs, setNumPairs] = useState(0);

  const startTime = useRef(Date.now());
  const responseTimes = useRef<number[]>([]);
  const lastFlip = useRef(Date.now());

  // Initialization and Setup Hook
  useEffect(() => {
    let rawPairs: { a: string; b: string }[] = [];

    // Prioritize targeted incoming Class + Subject content parameters
    if (customPairs && customPairs.length > 0) {
      rawPairs = customPairs.map(p => ({ a: p.item1, b: p.item2 }));
    } else {
      // Fallback to legacy default engine pools
      rawPairs = getMatchPairs(subject, ageGroup);
    }

    // ─── SHUFFLE & SELECT EXACTLY 5 UNIQUE NON-REPEATING ITEMS ───
    // First, shuffle the source pool completely to ensure random select distribution
    const shuffledPool = [...rawPairs].sort(() => Math.random() - 0.5);
    
    // Grab a maximum of 5 pairs (or less if the pool is smaller, though ideal is 5)
    const totalPairsToSelect = Math.min(shuffledPool.length, 5);
    setNumPairs(totalPairsToSelect);

    const selectedPairs = shuffledPool.slice(0, totalPairsToSelect);
    const cardSet: Card[] = [];
    selectedPairs.forEach((pair, idx) => {
      cardSet.push({ id: idx * 2, content: pair.a, pairId: idx, flipped: false, matched: false });
      cardSet.push({ id: idx * 2 + 1, content: pair.b, pairId: idx, flipped: false, matched: false });
    });

    // Shuffle the generated card deck layout completely for the grid interface matrix
    for (let i = cardSet.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cardSet[i], cardSet[j]] = [cardSet[j], cardSet[i]];
    }

    setCards(cardSet);
    startTime.current = Date.now();
    lastFlip.current = Date.now();
  }, [customPairs, subject, ageGroup]);

  // Game Loop Countdown Timer Hook
  useEffect(() => {
    if (cards.length === 0) return;

    if (timeLeft <= 0) { 
      finishGame(); 
      return; 
    }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, cards]);

  // Completion Condition Evaluator Hook
  useEffect(() => {
    if (cards.length > 0 && numPairs > 0 && matchCount >= numPairs) {
      finishGame();
    }
  }, [matchCount, numPairs, cards]);

  const finishGame = () => {
    const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
    const avgResp = responseTimes.current.length > 0
      ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
      : 0;
    
    onComplete({
      gameIndex,
      gameName: "Match Pairs",
      rawScore: Math.max(0, score),
      maxScore: numPairs * 15,
      accuracy: attempts > 0 ? Math.round((matchCount / attempts) * 100) : 0,
      avgResponseTime: avgResp,
      questionsAttempted: attempts,
      questionsCorrect: matchCount,
      timeUsed,
      timeLimit,
    });
  };

  const handleCardClick = (id: number) => {
    if (locked) return;
    const card = cards.find(c => c.id === id);
    if (!card || card.flipped || card.matched) return;

    responseTimes.current.push(Date.now() - lastFlip.current);
    lastFlip.current = Date.now();

    const newCards = cards.map(c => c.id === id ? { ...c, flipped: true } : c);
    setCards(newCards);
    const newFlipped = [...flippedIds, id];
    setFlippedIds(newFlipped);

    if (newFlipped.length === 2) {
      setLocked(true);
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      const [first, second] = newFlipped.map(fid => newCards.find(c => c.id === fid)!);

      if (first.pairId === second.pairId) {
        // Match Found!
        playCorrectSound();
        const nextMatchCount = matchCount + 1;
        setScore(p => p + 15);
        setMatchCount(nextMatchCount);
        
        setTimeout(() => {
          setCards(prev => prev.map(c => c.pairId === first.pairId ? { ...c, matched: true } : c));
          setFlippedIds([]);
          setLocked(false);

          if (nextMatchCount >= numPairs) {
            const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
            const avgResp = responseTimes.current.length > 0
              ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
              : 0;
            onComplete({
              gameIndex,
              gameName: "Match Pairs",
              rawScore: Math.max(0, score + 15),
              maxScore: numPairs * 15,
              accuracy: Math.round((nextMatchCount / nextAttempts) * 100),
              avgResponseTime: avgResp,
              questionsAttempted: nextAttempts,
              questionsCorrect: nextMatchCount,
              timeUsed,
              timeLimit,
            });
          }
        }, 500);
      } else {
        // No match - Flip cards back down safely
        playWrongSound();
        if (ageGroup !== 'early_learners') setScore(p => p - 2);
        setTimeout(() => {
          setCards(prev => prev.map(c => newFlipped.includes(c.id) ? { ...c, flipped: false } : c));
          setFlippedIds([]);
          setLocked(false);
        }, 800);
      }
    }
  };

  // Dynamically size columns to handle a 10-card deck layout seamlessly (e.g., 2 rows of 5 cards or balanced rows)
  const cols = numPairs >= 5 ? 5 : (ageGroup === 'early_learners' ? 3 : 4);
  const timerColor = timeLeft > timeLimit * 0.5 ? "#22C55E" : timeLeft > timeLimit * 0.2 ? "#F59E0B" : "#EF4444";

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between w-full">
        <span className="text-sm font-medium" style={{ color: "#38BDF8" }}>
          Matched: {matchCount}/{numPairs}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: "#F1F5F9" }}>Score: {score}</span>
          <span className="text-sm font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: timerColor }}>
            {timeLeft}s
          </span>
        </div>
      </div>
      <p className="text-xs" style={{ color: "rgba(241,245,249,0.5)" }}>Flip two cards to find matching pairs!</p>
      <div className="grid gap-3 w-full justify-center" style={{ gridTemplateColumns: `repeat(${cols}, minmax(70px, 1fr))` }}>
        {cards.map(card => (
          <button
            key={card.id}
            onClick={() => handleCardClick(card.id)}
            disabled={card.matched || card.flipped}
            className={`h-20 md:h-24 rounded-xl font-bold text-xs md:text-sm transition-all duration-300 ${card.matched ? 'opacity-30' : 'hover:scale-105 active:scale-95'}`}
            style={{
              background: card.flipped || card.matched
                ? card.matched ? "rgba(34,197,94,0.2)" : "rgba(56,189,248,0.2)"
                : "rgba(255,255,255,0.08)",
              border: `1px solid ${card.flipped || card.matched
                ? card.matched ? "rgba(34,197,94,0.4)" : "rgba(56,189,248,0.4)"
                : "rgba(255,255,255,0.15)"}`,
              color: "#F1F5F9",
            }}
          >
            {card.flipped || card.matched ? card.content.toUpperCase() : '?'}
          </button>
        ))}
      </div>
    </div>
  );
}