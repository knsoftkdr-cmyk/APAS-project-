import { useState, useEffect, useRef } from "react";
import { GameProps, GameResult } from "./types";
import { playCorrectSound, playWrongSound, playNextSound, playLevelUpSound } from "./sounds";

interface SequenceQuestion {
  sequence: (string | number)[];
  options: (string | number)[];
  answer: string | number;
}

const SHAPES = ["▲", "●", "■", "◆", "★", "⬟", "⬠", "▼"];
const LABELS = ["Very Easy", "Easy", "Medium", "Hard", "Very Hard", "Expert"];

function generateSequenceQuestion(difficulty: number): SequenceQuestion {
  if (difficulty <= 0) {
    // Very Easy: simple +1 or +2 sequences with small numbers
    const step = Math.random() > 0.5 ? 1 : 2;
    const start = Math.floor(Math.random() * 5) + 1;
    const seq = Array.from({ length: 4 }, (_, i) => start + step * i);
    const answer = start + step * 4;
    const options = [answer, answer + 1, answer - 1, answer + step].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
    while (options.length < 4) options.push(answer + options.length + 2);
    return { sequence: [...seq, "?"], options: options.sort(() => Math.random() - 0.5), answer };
  }

  if (difficulty === 1) {
    // Easy: alternating two shapes or +2/+3 number sequences
    if (Math.random() > 0.5) {
      const s1 = SHAPES[Math.floor(Math.random() * 4)];
      let s2 = SHAPES[Math.floor(Math.random() * 4)];
      while (s2 === s1) s2 = SHAPES[Math.floor(Math.random() * 4)];
      const seq = Array.from({ length: 5 }, (_, i) => (i % 2 === 0 ? s1 : s2));
      const answer = s1;
      const wrong = SHAPES.filter((s) => s !== s1).slice(0, 3);
      return { sequence: [...seq, "?"], options: [answer, ...wrong].sort(() => Math.random() - 0.5), answer };
    }
    const step = Math.floor(Math.random() * 2) + 2;
    const start = Math.floor(Math.random() * 5) + 1;
    const seq = Array.from({ length: 5 }, (_, i) => start + step * i);
    const answer = start + step * 5;
    const options = [answer, answer + step, answer - step, answer + 1].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
    while (options.length < 4) options.push(answer + options.length + 3);
    return { sequence: [...seq, "?"], options: options.sort(() => Math.random() - 0.5), answer };
  }

  // Medium and above: original logic
  const type = Math.floor(Math.random() * 4);

  if (type === 0) {
    const start = Math.floor(Math.random() * 10) + 1;
    const step = Math.floor(Math.random() * (3 + difficulty)) + 1;
    const seq = Array.from({ length: 5 }, (_, i) => start + step * i);
    const answer = start + step * 5;
    const options = [answer, answer + step, answer - step, answer + 2].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
    while (options.length < 4) options.push(answer + options.length + 2);
    return { sequence: [...seq, "?"], options: options.sort(() => Math.random() - 0.5), answer };
  }

  if (type === 1 && difficulty >= 3) {
    const start = Math.floor(Math.random() * 3) + 1;
    const factor = 2;
    const seq = Array.from({ length: 5 }, (_, i) => start * Math.pow(factor, i));
    const answer = start * Math.pow(factor, 5);
    const options = [answer, answer * 2, answer / 2, answer + start].map(Math.round).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
    while (options.length < 4) options.push(answer + options.length * 5);
    return { sequence: [...seq, "?"], options: options.sort(() => Math.random() - 0.5), answer };
  }

  if (type === 2) {
    const s1 = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    let s2 = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    while (s2 === s1) s2 = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    const seq = Array.from({ length: 5 }, (_, i) => (i % 2 === 0 ? s1 : s2));
    const answer = s1;
    const wrong = SHAPES.filter((s) => s !== s1).slice(0, 3);
    return { sequence: [...seq, "?"], options: [answer, ...wrong].sort(() => Math.random() - 0.5), answer };
  }

  // Fibonacci-like (difficulty 3+)
  const a = Math.floor(Math.random() * 5) + 1;
  const b = Math.floor(Math.random() * 5) + 1;
  const seq = [a, b];
  for (let i = 2; i < 5; i++) seq.push(seq[i - 1] + seq[i - 2]);
  const answer = seq[3] + seq[4];
  const options = [answer, answer + 1, answer - 1, seq[4]].filter((v, i, a2) => a2.indexOf(v) === i).slice(0, 4);
  while (options.length < 4) options.push(answer + options.length + 2);
  return { sequence: [...seq, "?"], options: options.sort(() => Math.random() - 0.5), answer };
}

function getQuestionTime(difficulty: number): number {
  if (difficulty <= 0) return 20;
  if (difficulty === 1) return 15;
  if (difficulty === 2) return 12;
  return 10;
}

export function ShapeSequence({ onComplete }: GameProps) {
  const [difficulty, setDifficulty] = useState(0);
  const [question, setQuestion] = useState<SequenceQuestion>(generateSequenceQuestion(0));
  const [score, setScore] = useState(0);
  const [qNum, setQNum] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [streak, setStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [qTimeLeft, setQTimeLeft] = useState(20);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [diffLabel, setDiffLabel] = useState("Very Easy");
  const responseTimes = useRef<number[]>([]);
  const qStart = useRef(Date.now());
  const startTime = useRef(Date.now());

  useEffect(() => { startTime.current = Date.now(); }, []);

  useEffect(() => {
    if (timeLeft <= 0) { finishGame(); return; }
    const t = setTimeout(() => setTimeLeft((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft]);

  useEffect(() => {
    if (feedback) return;
    if (qTimeLeft <= 0) { nextQuestion(false); return; }
    const t = setTimeout(() => setQTimeLeft((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [qTimeLeft, feedback]);

  const finishGame = () => {
    const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
    const avgResp = responseTimes.current.length > 0
      ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
      : 0;
    onComplete({
      gameIndex: 3,
      gameName: "Shape Sequence",
      rawScore: Math.max(0, score),
      maxScore: qNum * 20,
      accuracy: qNum > 0 ? Math.round((correct / qNum) * 100) : 0,
      avgResponseTime: avgResp,
      questionsAttempted: qNum,
      questionsCorrect: correct,
      timeUsed,
      timeLimit: 60,
    });
  };

  const nextQuestion = (wasCorrect: boolean) => {
    responseTimes.current.push(Date.now() - qStart.current);
    setQNum((p) => p + 1);

    let newDiff = difficulty;
    let newStreak = streak;

    if (wasCorrect) {
      setScore((p) => p + 20);
      setCorrect((p) => p + 1);
      newStreak = streak + 1;
      setStreak(newStreak);
      if (newStreak >= 2) {
        newDiff = Math.min(difficulty + 1, 5);
        setStreak(0);
        playLevelUpSound();
      }
      setFeedback("✅ Correct!");
      playCorrectSound();
    } else {
      setStreak(0);
      newDiff = Math.max(difficulty - 1, 0);
      setFeedback("❌ Wrong!");
      playWrongSound();
    }

    setDifficulty(newDiff);
    setDiffLabel(LABELS[newDiff]);

    setTimeout(() => {
      setFeedback(null);
      setQuestion(generateSequenceQuestion(newDiff));
      setQTimeLeft(getQuestionTime(newDiff));
      qStart.current = Date.now();
      playNextSound();
    }, 800);
  };

  const handleAnswer = (opt: string | number) => {
    nextQuestion(String(opt) === String(question.answer));
  };

  const timerColor = timeLeft > 30 ? "#22C55E" : timeLeft > 10 ? "#F59E0B" : "#EF4444";
  const qTimerMax = getQuestionTime(difficulty);

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-lg mx-auto">
      <div className="flex items-center justify-between w-full">
        <div className="flex flex-col">
          <span className="text-sm font-medium" style={{ color: "#F59E0B" }}>Q{qNum + 1}</span>
          <span className="text-xs px-2 py-0.5 rounded-full mt-1" style={{ background: "rgba(245,158,11,0.2)", color: "#F59E0B" }}>
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
        <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${(qTimeLeft / qTimerMax) * 100}%`, backgroundColor: qTimeLeft > 4 ? "#F59E0B" : "#EF4444" }} />
      </div>

      {feedback && (
        <div className="text-xl font-bold animate-fade-in" style={{ color: feedback.includes("✅") ? "#22C55E" : "#EF4444" }}>{feedback}</div>
      )}

      {!feedback && (
        <>
          <p className="text-xs" style={{ color: "rgba(241,245,249,0.5)" }}>What comes next in the sequence?</p>

          <div className="flex items-center gap-3 flex-wrap justify-center">
            {question.sequence.map((item, i) => (
              <div
                key={i}
                className="w-14 h-14 flex items-center justify-center rounded-xl text-xl font-bold"
                style={{
                  background: item === "?" ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.08)",
                  border: item === "?" ? "2px dashed #F59E0B" : "1px solid rgba(255,255,255,0.1)",
                  color: item === "?" ? "#F59E0B" : "#F1F5F9",
                }}
              >
                {item}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
            {question.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleAnswer(opt)}
                className="py-4 rounded-xl text-lg font-bold transition-all duration-200 hover:scale-105 active:scale-95"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(245,158,11,0.3)", color: "#F1F5F9" }}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
