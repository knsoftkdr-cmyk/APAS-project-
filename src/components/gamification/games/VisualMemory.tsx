import { useState, useEffect, useRef } from "react";
import { GameResult } from "../types";
import { AgeGroupId } from "../engine/ageGroups";
import { getVisualMemorySets, VisualMemorySet } from "../engine/contentPools";
import { playCorrectSound, playWrongSound, playNextSound, playLevelUpSound } from "../sounds";

interface Props {
  onComplete: (result: GameResult) => void;
  studentName: string;
  ageGroup: AgeGroupId;
  subject: string;
  gameIndex: number;
  timeLimit: number;
}

export function VisualMemory({ onComplete, ageGroup, subject, gameIndex, timeLimit }: Props) {
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

  const memorizeTime = ageGroup === 'early_learners' ? 8000 : ageGroup === 'explorers' ? 6000 : 4000;

  useEffect(() => {
    const s = getVisualMemorySets(subject, ageGroup);
    sets.current = s;
    startTime.current = Date.now();

    // Show items then switch to questions
    const timer = setTimeout(() => {
      setPhase('question');
      qStart.current = Date.now();
    }, memorizeTime);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (timeLeft <= 0 || totalQ >= MAX_QUESTIONS) { finishGame(); return; }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, totalQ]);

  const currentSet = setIndex < sets.current.length ? sets.current[setIndex] : sets.current[0];

  const finishGame = () => {
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
    setTotalQ(p => p + 1);

    if (selectedIndex === q.correctIndex) {
      setScore(p => p + 10);
      setCorrect(p => p + 1);
      setFeedback("✅ Correct!");
      playCorrectSound();
    } else {
      setFeedback("❌ Wrong!");
      playWrongSound();
    }

    setPhase('feedback');

    setTimeout(() => {
      setFeedback(null);
      const nextQ = qIndex + 1;
      if (nextQ >= currentSet.questions.length) {
        // Move to next set
        const nextSet = setIndex + 1;
        setSetIndex(nextSet);
        setQIndex(0);
        setPhase('memorize');
        playNextSound();
        // Show new items
        setTimeout(() => {
          setPhase('question');
          qStart.current = Date.now();
        }, memorizeTime);
      } else {
        setQIndex(nextQ);
        setPhase('question');
        qStart.current = Date.now();
      }
    }, 1000);
  };

  if (!currentSet) return <div style={{ color: "#F1F5F9" }}>Loading...</div>;

  const timerColor = timeLeft > timeLimit * 0.5 ? "#22C55E" : timeLeft > timeLimit * 0.2 ? "#F59E0B" : "#EF4444";

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-lg mx-auto">
      <div className="flex items-center justify-between w-full">
        <span className="text-sm font-medium" style={{ color: "#FF6B6B" }}>Round {setIndex + 1} · Q {totalQ}/{MAX_QUESTIONS}</span>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: "#F1F5F9" }}>Score: {score}</span>
          <span className="text-sm font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: timerColor }}>
            {timeLeft}s
          </span>
        </div>
      </div>

      {phase === 'memorize' && (
        <div className="text-center space-y-4">
          <p className="text-sm animate-pulse" style={{ color: "#FF6B6B" }}>👀 Memorize these items!</p>
          <div className="flex flex-wrap gap-3 justify-center p-6 rounded-2xl"
            style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)" }}>
            {currentSet.items.map((item, i) => (
              <div key={i} className="px-4 py-3 rounded-xl text-lg font-bold"
                style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#F1F5F9" }}>
                {item}
              </div>
            ))}
          </div>
          <p className="text-xs" style={{ color: "rgba(241,245,249,0.4)" }}>They will disappear soon...</p>
        </div>
      )}

      {phase === 'question' && currentSet.questions[qIndex] && (
        <div className="text-center space-y-4 w-full">
          <div className="p-5 rounded-2xl" style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)" }}>
            <p className="text-base font-bold" style={{ color: "#F1F5F9" }}>{currentSet.questions[qIndex].question}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {currentSet.questions[qIndex].options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(i)}
                className="py-3 px-4 rounded-xl font-semibold text-sm transition-all hover:scale-105 active:scale-95"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,107,107,0.25)", color: "#F1F5F9" }}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'feedback' && (
        <div className="text-2xl font-bold" style={{ color: feedback?.includes("✅") ? "#22C55E" : "#EF4444" }}>
          {feedback}
        </div>
      )}
    </div>
  );
}