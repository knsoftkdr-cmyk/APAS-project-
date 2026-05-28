import { useState, useEffect, useRef } from "react";
import { GameResult } from "../types";
import { AgeGroupId } from "../engine/ageGroups";
import { getVisualMemorySets, VisualMemorySet } from "../engine/contentPools";
import { playCorrectSound, playWrongSound, playNextSound } from "../sounds";

// Matching structural contract from your database content pools
interface CustomVisualSet {
  items: string[];
  questions: {
    question: string;
    options: string[];
    answer: string;
  }[];
}

interface Props {
  onComplete: (result: GameResult) => void;
  studentName: string;
  ageGroup: AgeGroupId;
  subject: string;
  gameIndex: number;
  timeLimit: number;
  customVisuals?: CustomVisualSet[]; // Dynamic pool input prop
}

export function VisualMemory({ onComplete, ageGroup, subject, gameIndex, timeLimit, customVisuals }: Props) {
  const sets = useRef<VisualMemorySet[]>([]);
  const [setIndex, setSetIndex] = useState(0);
  const [phase, setPhase] = useState<'memorize' | 'question' | 'feedback'>('memorize');
  const [qIndex, setQIndex] = useState(0);
  const MAX_QUESTIONS = 10;
  const [score, setScore] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [totalQ, setTotalQ] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [feedback, setFeedback] = useState<string | null>(null);
  
  const startTime = useRef(Date.now());
  const responseTimes = useRef<number[]>([]);
  const qStart = useRef(Date.now());
  const phaseTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Tracks unique set histories to avoid repetition patterns
  const usedSetIndicesRef = useRef<number[]>([]); 

  const memorizeTime = ageGroup === 'early_learners' ? 8000 : ageGroup === 'explorers' ? 6000 : 4000;

  // Selects an unplayed random set index securely
  const getNextRandomSetIndex = (availableSets: VisualMemorySet[]) => {
    if (availableSets.length === 0) return 0;
    
    if (usedSetIndicesRef.current.length >= availableSets.length) {
      usedSetIndicesRef.current = []; // Wipe history if all sets have been exhausted
    }

    const validIndices = availableSets
      .map((_, idx) => idx)
      .filter(idx => !usedSetIndicesRef.current.includes(idx));

    const randomPick = validIndices[Math.floor(Math.random() * validIndices.length)];
    usedSetIndicesRef.current.push(randomPick);
    return randomPick;
  };

  // Initialize and parse question pools on mounting cycles
  useEffect(() => {
    let parsedSets: VisualMemorySet[] = [];

    if (customVisuals && customVisuals.length > 0) {
      parsedSets = customVisuals.map((v, sIdx) => ({
        id: sIdx,
        items: v.items,
        questions: v.questions.map((q, qIdx) => {
          let correctIdx = q.options.indexOf(q.answer);
          if (correctIdx === -1) correctIdx = 0; 

          return {
            id: qIdx,
            question: q.question,
            options: q.options,
            correctIndex: correctIdx
          };
        })
      }));
    } else {
      parsedSets = getVisualMemorySets(subject, ageGroup);
    }

    sets.current = parsedSets;
    usedSetIndicesRef.current = [];
    startTime.current = Date.now();
    
    // Pick the very first unique random set out of the pool
    const firstSetIdx = getNextRandomSetIndex(parsedSets);
    setSetIndex(firstSetIdx);
    setQIndex(0);
    setPhase('memorize');

    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    phaseTimerRef.current = setTimeout(() => {
      setPhase('question');
      qStart.current = Date.now();
    }, memorizeTime);

    return () => {
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    };
  }, [customVisuals, subject, ageGroup]);

  // Master countdown tracking loop configuration
  useEffect(() => {
    if (sets.current.length === 0) return;

    if (timeLeft <= 0 || totalQ >= MAX_QUESTIONS) { 
      finishGame(); 
      return; 
    }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, totalQ]);

  // Point runtime references to the state index directly
  const currentSet = sets.current.length > 0 
    ? sets.current[setIndex] 
    : null;

  const finishGame = () => {
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
    const avgResp = responseTimes.current.length > 0
      ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
      : 0;
    onComplete({
      gameIndex,
      gameName: "Visual Memory",
      rawScore: Math.max(0, score),
      maxScore: totalQ * 10,
      accuracy: totalQ > 0 ? Math.round((correct / totalQ) * 100) : 0,
      avgResponseTime: avgResp,
      questionsAttempted: totalQ,
      questionsCorrect: correct,
      timeUsed,
      timeLimit,
    });
  };

  const handleAnswer = (selectedIndex: number) => {
    if (!currentSet) return;
    const q = currentSet.questions[qIndex];
    if (!q) return;

    responseTimes.current.push(Date.now() - qStart.current);
    const nextTotalQ = totalQ + 1;
    setTotalQ(nextTotalQ);

    const isCorrect = selectedIndex === q.correctIndex;
    const updatedScore = isCorrect ? score + 10 : score;
    const updatedCorrect = isCorrect ? correct + 1 : correct;

    if (isCorrect) {
      setScore(p => p + 10);
      setCorrect(p => p + 1);
      setFeedback("✅ Correct!");
      playCorrectSound();
    } else {
      setFeedback("❌ Wrong!");
      playWrongSound();
    }

    setPhase('feedback');

    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    
    phaseTimerRef.current = setTimeout(() => {
      setFeedback(null);
      
      if (nextTotalQ >= MAX_QUESTIONS) {
        const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
        const avgResp = responseTimes.current.length > 0
          ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
          : 0;
        onComplete({
          gameIndex,
          gameName: "Visual Memory",
          rawScore: Math.max(0, updatedScore),
          maxScore: nextTotalQ * 10,
          accuracy: nextTotalQ > 0 ? Math.round((updatedCorrect / nextTotalQ) * 100) : 0,
          avgResponseTime: avgResp,
          questionsAttempted: nextTotalQ,
          questionsCorrect: updatedCorrect,
          timeUsed,
          timeLimit,
        });
        return;
      }

      const nextQ = qIndex + 1;
      if (nextQ >= currentSet.questions.length) {
        // Shuffle and choose a brand-new random unplayed card index
        const randomNextSetIdx = getNextRandomSetIndex(sets.current);
        setSetIndex(randomNextSetIdx);
        setQIndex(0);
        setPhase('memorize');
        playNextSound();

        if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = setTimeout(() => {
          setPhase('question');
          qStart.current = Date.now();
        }, memorizeTime);
      } else {
        setQIndex(nextQ);
        setPhase('question');
        qStart.current = Date.now();
      }
    }, 1200);
  };

  if (!currentSet) return <div className="text-center p-5 text-white font-bold">Loading visual sets...</div>;

  const timerColor = timeLeft > timeLimit * 0.5 ? "#22C55E" : timeLeft > timeLimit * 0.2 ? "#F59E0B" : "#EF4444";

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-lg mx-auto">
      <div className="flex items-center justify-between w-full">
        <span className="text-sm font-medium" style={{ color: "#FF6B6B" }}>
          Round {setIndex + 1} · Q {totalQ}/{MAX_QUESTIONS}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: "#F1F5F9" }}>Score: {score}</span>
          <span className="text-sm font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: timerColor }}>
            {timeLeft}s
          </span>
        </div>
      </div>

      {phase === 'memorize' && (
        <div className="text-center space-y-4 w-full animate-fadeIn">
          <p className="text-sm font-bold animate-pulse" style={{ color: "#FF6B6B" }}>👀 Memorize these items!</p>
          <div className="flex flex-wrap gap-3 justify-center p-6 rounded-2xl shadow-inner min-h-[100px]"
            style={{ background: "rgba(255,107,107,0.06)", border: "1px solid rgba(255,107,107,0.25)" }}>
            {currentSet.items.map((item, i) => (
              <div key={i} className="px-4 py-2.5 rounded-xl text-sm sm:text-base font-bold transition-transform transform hover:scale-105 shadow-md"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#F1F5F9" }}>
                {item.toUpperCase()}
              </div>
            ))}
          </div>
          <p className="text-xs italic" style={{ color: "rgba(241,245,249,0.4)" }}>They will disappear soon...</p>
        </div>
      )}

      {phase === 'question' && currentSet.questions[qIndex] && (
        <div className="text-center space-y-4 w-full animate-fadeIn">
          <div className="p-5 rounded-2xl shadow-md" style={{ background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.25)" }}>
            <p className="text-sm sm:text-base font-bold" style={{ color: "#F1F5F9" }}>{currentSet.questions[qIndex].question}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 w-full">
            {currentSet.questions[qIndex].options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(i)}
                className="py-3.5 px-4 rounded-xl font-bold text-xs sm:text-sm transition-all hover:scale-102 hover:bg-white/10 active:scale-98 shadow-md text-center break-words"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,107,107,0.2)", color: "#F1F5F9" }}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'feedback' && (
        <div className="w-full min-h-[150px] flex items-center justify-center rounded-2xl" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="text-3xl font-black tracking-wide animate-bounce" style={{ color: feedback?.includes("✅") ? "#22C55E" : "#EF4444" }}>
            {feedback}
          </div>
        </div>
      )}
    </div>
  );
}