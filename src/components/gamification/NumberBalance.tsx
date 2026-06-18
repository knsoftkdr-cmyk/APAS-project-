import { useState, useEffect, useRef } from "react";
import { GameProps, GameResult } from "./types";
import { playCorrectSound, playWrongSound, playNextSound, playLevelUpSound } from "./sounds";

interface Question {
  left: { value: number; multiplier: number }[];
  right: { value: number; multiplier: number }[];
  answer: "left" | "right" | "equal";
}

// Difficulty 0: single-digit, 2 items, no multipliers
// Difficulty 1: single-digit, 2 items
// Difficulty 2: up to 15, 2-3 items
// Difficulty 3+: bigger numbers, multipliers
function generateQuestion(difficulty: number): Question {
  const maxVal = difficulty <= 0 ? 5 : difficulty === 1 ? 9 : 5 + difficulty * 3;
  const count = difficulty <= 1 ? 2 : Math.min(2 + Math.floor(difficulty / 2), 4);
  const useMultiplier = difficulty >= 3;

  const makeItems = () =>
    Array.from({ length: count }, () => ({
      value: Math.floor(Math.random() * maxVal) + 1,
      multiplier: useMultiplier && Math.random() > 0.7 ? 2 : 1,
    }));

  const left = makeItems();
  const right = makeItems();

  const leftSum = left.reduce((s, i) => s + i.value * i.multiplier, 0);
  const rightSum = right.reduce((s, i) => s + i.value * i.multiplier, 0);

  if (Math.random() > 0.75) {
    const diff = leftSum - rightSum;
    if (diff > 0 && right.length > 0) {
      right[0].value += diff;
    } else if (diff < 0 && left.length > 0) {
      left[0].value += Math.abs(diff);
    }
  }

  const lSum = left.reduce((s, i) => s + i.value * i.multiplier, 0);
  const rSum = right.reduce((s, i) => s + i.value * i.multiplier, 0);

  return {
    left,
    right,
    answer: lSum > rSum ? "left" : lSum < rSum ? "right" : "equal",
  };
}

// Per-question time based on difficulty
function getQuestionTime(difficulty: number): number {
  if (difficulty <= 0) return 15;
  if (difficulty === 1) return 12;
  if (difficulty === 2) return 10;
  return 8;
}

export function NumberBalance({ onComplete }: GameProps) {
  const [difficulty, setDifficulty] = useState(0);
  const [question, setQuestion] = useState<Question>(generateQuestion(0));
  const [score, setScore] = useState(0);
  const [qNum, setQNum] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [streak, setStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(90);
  const [qTimeLeft, setQTimeLeft] = useState(15);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [diffLabel, setDiffLabel] = useState("Very Easy");
  const responseTimes = useRef<number[]>([]);
  const qStart = useRef(Date.now());
  const startTime = useRef(Date.now());

  const LABELS = ["Very Easy", "Easy", "Medium", "Hard", "Very Hard", "Expert"];

  useEffect(() => { startTime.current = Date.now(); }, []);

  useEffect(() => {
    if (timeLeft <= 0) { finishGame(); return; }
    const t = setTimeout(() => setTimeLeft((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft]);

  useEffect(() => {
    if (feedback) return;
    if (qTimeLeft <= 0) { handleAnswer("timeout"); return; }
    const t = setTimeout(() => setQTimeLeft((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [qTimeLeft, feedback]);

  const finishGame = () => {
    const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
    const avgResp = responseTimes.current.length > 0
      ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
      : 0;
    onComplete({
      gameIndex: 1,
      gameName: "Number Balance",
      rawScore: Math.max(0, score),
      maxScore: qNum * 15,
      accuracy: qNum > 0 ? Math.round((correct / qNum) * 100) : 0,
      avgResponseTime: avgResp,
      questionsAttempted: qNum,
      questionsCorrect: correct,
      timeUsed,
      timeLimit: 90,
    });
  };

  const handleAnswer = (ans: "left" | "right" | "equal" | "timeout") => {
    const respTime = Date.now() - qStart.current;
    responseTimes.current.push(respTime);

    const isCorrect = ans === question.answer;
    let newDifficulty = difficulty;
    let newStreak = streak;

    if (ans !== "timeout") {
      if (isCorrect) {
        setScore((p) => p + 15);
        setCorrect((p) => p + 1);
        newStreak = streak + 1;
        setStreak(newStreak);
        // Level up after 2 correct in a row
        if (newStreak >= 2) {
          newDifficulty = Math.min(difficulty + 1, 5);
          setDifficulty(newDifficulty);
          setDiffLabel(LABELS[newDifficulty]);
          setStreak(0);
          playLevelUpSound();
        }
        setFeedback("✅ Correct!");
        playCorrectSound();
      } else {
        setScore((p) => p - 5);
        setStreak(0);
        // Level down on wrong answer
        newDifficulty = Math.max(difficulty - 1, 0);
        setDifficulty(newDifficulty);
        setDiffLabel(LABELS[newDifficulty]);
        setFeedback("❌ Wrong!");
        playWrongSound();
      }
    } else {
      setScore((p) => p - 5);
      setStreak(0);
      setFeedback("⏰ Time's up!");
      playWrongSound();
    }

    setQNum((p) => p + 1);

    setTimeout(() => {
      setFeedback(null);
      setQuestion(generateQuestion(newDifficulty));
      setQTimeLeft(getQuestionTime(newDifficulty));
      qStart.current = Date.now();
      playNextSound();
    }, 800);
  };

  const timerColor = timeLeft > 45 ? "#22C55E" : timeLeft > 15 ? "#F59E0B" : "#EF4444";
  const qTimerMax = getQuestionTime(difficulty);

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-lg mx-auto">
      <div className="flex items-center justify-between w-full">
        <div className="flex flex-col">
          <span className="text-sm font-medium" style={{ color: "#A855F7" }}>Q{qNum + 1}</span>
          <span className="text-xs px-2 py-0.5 rounded-full mt-1" style={{ background: "rgba(168,85,247,0.2)", color: "#A855F7" }}>
            {diffLabel}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: "#F1F5F9" }}>Score: {score}</span>
          <span className="text-sm font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: timerColor }}>
            {timeLeft}s
          </span>
        </div>
      </div>

      <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${(qTimeLeft / qTimerMax) * 100}%`, backgroundColor: qTimeLeft > 3 ? "#A855F7" : "#EF4444" }}
        />
      </div>

      {feedback && (
        <div className="text-xl font-bold animate-fade-in" style={{ color: feedback.includes("✅") ? "#22C55E" : "#EF4444" }}>
          {feedback}
        </div>
      )}

      {!feedback && (
        <>
          <div className="flex items-center justify-center gap-4 w-full">
            <div className="flex-1 rounded-2xl p-4 text-center" style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)" }}>
              <p className="text-xs mb-2" style={{ color: "#A855F7" }}>LEFT</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {question.left.map((item, i) => (
                  <div key={i} className="px-3 py-2 rounded-lg text-lg font-bold" style={{ background: "rgba(255,255,255,0.1)", color: "#F1F5F9" }}>
                    {item.value}
                    {item.multiplier > 1 && <span className="text-xs ml-1" style={{ color: "#F59E0B" }}>×{item.multiplier}</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className="text-2xl font-bold" style={{ color: "rgba(255,255,255,0.3)" }}>⚖️</div>

            <div className="flex-1 rounded-2xl p-4 text-center" style={{ background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.3)" }}>
              <p className="text-xs mb-2" style={{ color: "#38BDF8" }}>RIGHT</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {question.right.map((item, i) => (
                  <div key={i} className="px-3 py-2 rounded-lg text-lg font-bold" style={{ background: "rgba(255,255,255,0.1)", color: "#F1F5F9" }}>
                    {item.value}
                    {item.multiplier > 1 && <span className="text-xs ml-1" style={{ color: "#F59E0B" }}>×{item.multiplier}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            {(["left", "right", "equal"] as const).map((ans) => (
              <button
                key={ans}
                onClick={() => handleAnswer(ans)}
                className="px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-wider transition-all duration-200 hover:scale-105 active:scale-95"
                style={{
                  background: ans === "left" ? "rgba(168,85,247,0.3)" : ans === "right" ? "rgba(56,189,248,0.3)" : "rgba(255,255,255,0.1)",
                  border: `1px solid ${ans === "left" ? "rgba(168,85,247,0.5)" : ans === "right" ? "rgba(56,189,248,0.5)" : "rgba(255,255,255,0.2)"}`,
                  color: "#F1F5F9",
                }}
              >
                {ans === "left" ? "⬅ Left Heavier" : ans === "right" ? "Right Heavier ➡" : "= Equal"}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
