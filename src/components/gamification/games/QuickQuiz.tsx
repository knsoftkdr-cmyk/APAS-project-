import { useState, useEffect, useRef } from "react";
import { GameResult } from "../types";
import { AgeGroupId } from "../engine/ageGroups";
import { playCorrectSound, playWrongSound, playNextSound } from "../sounds";

interface CustomQuizItem {
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
  customQuizzes?: CustomQuizItem[];
}

export function QuickQuiz({ onComplete, ageGroup, subject, gameIndex, timeLimit, customQuizzes }: Props) {
  const [quizPool, setQuizPool] = useState<CustomQuizItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false); // CRITICAL: Safety mount flag
  
  const startTime = useRef(Date.now());
  const questionStart = useRef(Date.now());
  const responseTimes = useRef<number[]>([]);

  const MAX_QUESTIONS = 5; // Firm cap of 5 unique questions

  useEffect(() => {
    let initialPool: CustomQuizItem[] = [];

    if (customQuizzes && customQuizzes.length > 0) {
      initialPool = [...customQuizzes];
    }

    // Default top-tier fallback trivia deck if classroom pool is too small
    const fallbackDeck = [
      { question: "Which planet is known as the Red Planet?", options: ["Earth", "Mars", "Jupiter", "Venus"], answer: "Mars" },
      { question: "What is the capital of India?", options: ["Mumbai", "Delhi", "Kolkata", "Chennai"], answer: "Delhi" },
      { question: "How many colors are there in a rainbow?", options: ["5", "6", "7", "8"], answer: "7" },
      { question: "Which animal is known as the King of the Jungle?", options: ["Tiger", "Elephant", "Lion", "Cheetah"], answer: "Lion" },
      { question: "What is the largest ocean on Earth?", options: ["Atlantic Ocean", "Indian Ocean", "Pacific Ocean", "Arctic Ocean"], answer: "Pacific Ocean" }
    ];

    // Pad with fallback questions if custom pool has fewer than 5 items
    let finalPool = [...initialPool];
    const uniqueBackups = fallbackDeck.filter(
      fItem => !finalPool.some(pItem => pItem.question.toLowerCase() === fItem.question.toLowerCase())
    );

    while (finalPool.length < MAX_QUESTIONS && uniqueBackups.length > 0) {
      finalPool.push(uniqueBackups.shift()!);
    }

    // Shuffle the items completely
    for (let i = finalPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [finalPool[i], finalPool[j]] = [finalPool[j], finalPool[i]];
    }

    // Slice down to match our exact boundary count
    const cleanFivePool = finalPool.slice(0, MAX_QUESTIONS);

    setQuizPool(cleanFivePool);
    setIsReady(true); // Flag ready AFTER data structure array is securely set
    startTime.current = Date.now();
    questionStart.current = Date.now();
  }, [customQuizzes, subject, ageGroup]);

  useEffect(() => {
    // TIMING LOCK: Block execution loop if data isn't mounted or initialized
    if (!isReady || quizPool.length === 0) return; 

    if (timeLeft <= 0 || currentIndex >= Math.min(MAX_QUESTIONS, quizPool.length)) {
      finishGame();
      return;
    }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, currentIndex, quizPool, isReady]);

  const finishGame = () => {
    const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
    const avgResp = responseTimes.current.length > 0
      ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
      : 0;

    onComplete({
      gameIndex,
      gameName: "Quick Quiz",
      rawScore: Math.max(0, score),
      maxScore: Math.min(MAX_QUESTIONS, quizPool.length) * 20,
      accuracy: currentIndex > 0 ? Math.round((correctCount / currentIndex) * 100) : 0,
      avgResponseTime: avgResp,
      questionsAttempted: currentIndex,
      questionsCorrect: correctCount,
      timeUsed,
      timeLimit,
    });
  };

  const handleOptionClick = (optionIdx: number) => {
    if (feedback !== null) return; // Prevent double clicking options
    
    const currentQuestion = quizPool[currentIndex];
    if (!currentQuestion) return;

    setSelectedOption(optionIdx);
    responseTimes.current.push(Date.now() - questionStart.current);

    const chosenOptionText = currentQuestion.options[optionIdx];
    const isCorrect = chosenOptionText === currentQuestion.answer;

    const updatedCorrectCount = isCorrect ? correctCount + 1 : correctCount;
    const updatedScore = isCorrect ? score + 20 : score;

    if (isCorrect) {
      setScore(p => p + 20);
      setCorrectCount(p => p + 1);
      setFeedback("✅ Correct!");
      playCorrectSound();
    } else {
      setFeedback(`❌ Incorrect! Answer was: ${currentQuestion.answer}`);
      playWrongSound();
    }

    setTimeout(() => {
      setFeedback(null);
      setSelectedOption(null);
      const nextIndex = currentIndex + 1;

      if (nextIndex >= MAX_QUESTIONS || nextIndex >= quizPool.length) {
        // Direct execution layout bypass prevents race delays
        const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
        const avgResp = responseTimes.current.length > 0
          ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
          : 0;

        onComplete({
          gameIndex,
          gameName: "Quick Quiz",
          rawScore: Math.max(0, updatedScore),
          maxScore: Math.min(MAX_QUESTIONS, quizPool.length) * 20,
          accuracy: nextIndex > 0 ? Math.round((updatedCorrectCount / nextIndex) * 100) : 0,
          avgResponseTime: avgResp,
          questionsAttempted: nextIndex,
          questionsCorrect: updatedCorrectCount,
          timeUsed,
          timeLimit,
        });
        return;
      }

      setCurrentIndex(nextIndex);
      questionStart.current = Date.now();
      playNextSound();
    }, 1500);
  };

  const currentQuestion = quizPool[currentIndex];
  const timerColor = timeLeft > timeLimit * 0.5 ? "#22C55E" : timeLeft > timeLimit * 0.2 ? "#F59E0B" : "#EF4444";

  if (!isReady || !currentQuestion) {
    return <div className="text-center text-white font-bold">Loading quiz challenges...</div>;
  }

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-lg mx-auto">
      <div className="flex items-center justify-between w-full">
        <span className="text-sm font-medium text-purple-400">
          Question {currentIndex + 1}/{Math.min(MAX_QUESTIONS, quizPool.length)}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">Score: {score}</span>
          <span className="text-sm font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: timerColor }}>
            {timeLeft}s
          </span>
        </div>
      </div>

      <div className="w-full min-h-[110px] p-5 rounded-2xl flex items-center justify-center text-center border"
        style={{ background: "rgba(168,85,247,0.05)", borderColor: "rgba(168,85,247,0.25)" }}>
        <p className="text-sm sm:text-base font-bold text-white">{currentQuestion.question}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 w-full">
        {currentQuestion.options.map((option, idx) => {
          const isSelected = selectedOption === idx;
          let btnBg = "rgba(255,255,255,0.05)";
          let btnBorder = "rgba(255,255,255,0.1)";

          if (feedback && isSelected) {
            btnBg = feedback.includes("✅") ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)";
            btnBorder = feedback.includes("✅") ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)";
          }

          return (
            <button
              key={idx}
              onClick={() => handleOptionClick(idx)}
              disabled={feedback !== null}
              className="w-full py-3.5 px-5 rounded-xl font-bold text-xs sm:text-sm text-left transition-all hover:scale-[1.01] hover:bg-white/10 active:scale-[0.99] disabled:opacity-80"
              style={{ background: btnBg, border: `1px solid ${btnBorder}`, color: "#F1F5F9" }}
            >
              <span className="inline-block w-6 text-purple-400">{String.fromCharCode(65 + idx)}.</span>
              {option}
            </button>
          );
        })}
      </div>

      {feedback && (
        <p className="text-base font-bold mt-2 animate-pulse" style={{ color: feedback.includes("✅") ? "#22C55E" : "#EF4444" }}>
          {feedback}
        </p>
      )}
    </div>
  );
}