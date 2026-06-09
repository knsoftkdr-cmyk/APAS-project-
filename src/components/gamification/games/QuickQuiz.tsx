import { useState, useEffect, useRef } from "react";
import { GameResult } from "../types";
import { AgeGroupId } from "../engine/ageGroups";
import { getQuizQuestions, QuizQuestion } from "../engine/contentPools";
import { playCorrectSound, playWrongSound, playNextSound, playLevelUpSound } from "../sounds";

interface Props {
  onComplete: (result: GameResult) => void;
  studentName: string;
  ageGroup: AgeGroupId;
  subject: string;
  gameIndex: number;
  timeLimit: number;
}

export function QuickQuiz({ onComplete, ageGroup, subject, gameIndex, timeLimit }: Props) {
  const questions = useRef<QuizQuestion[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [qTimeLeft, setQTimeLeft] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const startTime = useRef(Date.now());
  const responseTimes = useRef<number[]>([]);
  const qStart = useRef(Date.now());

  const getQTime = () => ageGroup === 'early_learners' ? 20 : ageGroup === 'explorers' ? 15 : ageGroup === 'thinkers' ? 12 : 10;

  const MAX_QUESTIONS = 10;

  useEffect(() => {
    const q = getQuizQuestions(subject, ageGroup);
    // Shuffle
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    questions.current = q;
    setQTimeLeft(getQTime());
    startTime.current = Date.now();
    qStart.current = Date.now();
  }, []);

  useEffect(() => {
    if (timeLeft <= 0 || qIndex >= MAX_QUESTIONS) { finishGame(); return; }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, qIndex]);

  useEffect(() => {
    if (feedback) return;
    if (qTimeLeft <= 0) { handleAnswer(-1); return; }
    const t = setTimeout(() => setQTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [qTimeLeft, feedback]);

  const finishGame = () => {
    const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
    const avgResp = responseTimes.current.length > 0
      ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
      : 0;
    onComplete({
      gameIndex,
      gameName: "Quick Quiz",
      rawScore: Math.max(0, score),
      maxScore: qIndex * 15,
      accuracy: qIndex > 0 ? Math.round((correct / qIndex) * 100) : 0,
      avgResponseTime: avgResp,
      questionsAttempted: qIndex,
      questionsCorrect: correct,
      timeUsed,
      timeLimit,
    });
  };

  const handleAnswer = (selectedIndex: number) => {
    const q = qIndex < questions.current.length ? questions.current[qIndex] : null;
    if (!q) return;
    
    responseTimes.current.push(Date.now() - qStart.current);
    const isCorrect = selectedIndex === q.correctIndex;

    if (isCorrect) {
      setScore(p => p + 15);
      setCorrect(p => p + 1);
      const newStreak = streak + 1;
      setStreak(newStreak);
      if (newStreak >= 3) { playLevelUpSound(); setStreak(0); }
      setFeedback("✅ Correct!");
      playCorrectSound();
    } else {
      if (ageGroup !== 'early_learners') setScore(p => p - 5);
      setStreak(0);
      setFeedback(selectedIndex === -1 ? "⏰ Time's up!" : "❌ Wrong!");
      playWrongSound();
    }

    setTimeout(() => {
      setFeedback(null);
      const nextQ = qIndex + 1;
      if (nextQ >= MAX_QUESTIONS) {
        finishGame();
        return;
      }
      setQIndex(nextQ);
      setQTimeLeft(getQTime());
      qStart.current = Date.now();
      playNextSound();
    }, 1000);
  };

  const q = qIndex < questions.current.length ? questions.current[qIndex] : null;
  const timerColor = timeLeft > timeLimit * 0.5 ? "#22C55E" : timeLeft > timeLimit * 0.2 ? "#F59E0B" : "#EF4444";
  const qTimerMax = getQTime();

  if (!q) { if (qIndex > 0 && !feedback) { finishGame(); } return <div className="text-center" style={{ color: "#F1F5F9" }}>Loading questions...</div>; }

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-lg mx-auto">
      <div className="flex items-center justify-between w-full">
        <div className="flex flex-col">
          <span className="text-sm font-medium" style={{ color: "#6366F1" }}>Q{qIndex + 1}/{MAX_QUESTIONS}</span>
          {streak >= 2 && <span className="text-xs" style={{ color: "#F59E0B" }}>🔥 Streak: {streak}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: "#F1F5F9" }}>Score: {score}</span>
          <span className="text-sm font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: timerColor }}>
            {timeLeft}s
          </span>
        </div>
      </div>

      <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>
        <div className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${(qTimeLeft / qTimerMax) * 100}%`, backgroundColor: qTimeLeft > 3 ? "#6366F1" : "#EF4444" }} />
      </div>

      {feedback ? (
        <div className="text-2xl font-bold animate-fade-in" style={{ color: feedback.includes("✅") ? "#22C55E" : "#EF4444" }}>
          {feedback}
        </div>
      ) : (
        <>
          <div className="w-full p-5 rounded-2xl text-center" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)" }}>
            <p className="text-base md:text-lg font-bold" style={{ color: "#F1F5F9" }}>{q.question}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
            {q.options.map((opt, i) => (
              <button key={i} onClick={() => handleAnswer(i)}
                className="py-4 px-4 rounded-xl font-semibold text-sm transition-all duration-200 hover:scale-105 active:scale-95"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(99,102,241,0.25)", color: "#F1F5F9" }}>
                <span className="mr-2 text-xs font-bold" style={{ color: "#6366F1" }}>{String.fromCharCode(65 + i)}</span>
                {opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}