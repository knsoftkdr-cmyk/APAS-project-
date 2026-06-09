import { useState, useEffect, useRef } from "react";
import { GameResult } from "../types";
import { AgeGroupId } from "../engine/ageGroups";
import { getWordEntries, WordEntry } from "../engine/contentPools";
import { playCorrectSound, playWrongSound, playNextSound, playLevelUpSound } from "../sounds";

interface Props {
  onComplete: (result: GameResult) => void;
  studentName: string;
  ageGroup: AgeGroupId;
  subject: string;
  gameIndex: number;
  timeLimit: number;
}

function shuffleWord(word: string): string[] {
  const letters = word.split('');
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  // Ensure it's not the same as original
  if (letters.join('') === word && letters.length > 1) {
    [letters[0], letters[1]] = [letters[1], letters[0]];
  }
  return letters;
}

export function WordScramble({ onComplete, ageGroup, subject, gameIndex, timeLimit }: Props) {
  const words = useRef<WordEntry[]>([]);
  const [wordIndex, setWordIndex] = useState(0);
  const [scrambled, setScrambled] = useState<string[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const MAX_QUESTIONS = 10;
  const [score, setScore] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const startTime = useRef(Date.now());
  const responseTimes = useRef<number[]>([]);
  const wordStart = useRef(Date.now());

  useEffect(() => {
    const w = getWordEntries(subject, ageGroup);
    for (let i = w.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [w[i], w[j]] = [w[j], w[i]];
    }
    words.current = w;
    if (w.length > 0) setScrambled(shuffleWord(w[0].word));
    startTime.current = Date.now();
    wordStart.current = Date.now();
  }, [subject, ageGroup]);

  useEffect(() => {
    if (timeLeft <= 0 || wordIndex >= MAX_QUESTIONS) { finishGame(); return; }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, wordIndex]);

  const currentWord = wordIndex < words.current.length ? words.current[wordIndex] : null;

  const finishGame = () => {
    const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
    const avgResp = responseTimes.current.length > 0
      ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
      : 0;
    onComplete({
      gameIndex,
      gameName: "Word Scramble",
      rawScore: Math.max(0, score),
      maxScore: wordIndex * 15,
      accuracy: wordIndex > 0 ? Math.round((correct / wordIndex) * 100) : 0,
      avgResponseTime: avgResp,
      questionsAttempted: wordIndex,
      questionsCorrect: correct,
      timeUsed,
      timeLimit,
    });
  };

  const handleLetterClick = (idx: number) => {
    if (feedback || selected.includes(idx)) return;
    const newSelected = [...selected, idx];
    setSelected(newSelected);

    const builtWord = newSelected.map(i => scrambled[i]).join('');
    
    if (builtWord.length === currentWord!.word.length) {
      responseTimes.current.push(Date.now() - wordStart.current);
      
      if (builtWord === currentWord!.word) {
        const bonus = showHint ? 0 : 5;
        setScore(p => p + 15 + bonus);
        setCorrect(p => p + 1);
        setFeedback("✅ Correct!");
        playCorrectSound();
      } else {
        setFeedback("❌ Wrong order!");
        playWrongSound();
      }

      setTimeout(() => {
        setFeedback(null);
        setSelected([]);
        setShowHint(false);
        const nextIdx = wordIndex + 1;
        if (nextIdx >= MAX_QUESTIONS) {
          finishGame();
          return;
        }
        setWordIndex(nextIdx);
        if (nextIdx < words.current.length && words.current[nextIdx]) {
          setScrambled(shuffleWord(words.current[nextIdx].word));
        }
        wordStart.current = Date.now();
        playNextSound();
      }, 1000);
    }
  };

  const handleReset = () => setSelected([]);
  const handleHint = () => { setShowHint(true); setScore(p => p - 3); };

  if (!currentWord) return <div style={{ color: "#F1F5F9" }}>Loading...</div>;

  const builtWord = selected.map(i => scrambled[i]).join('');
  const timerColor = timeLeft > timeLimit * 0.5 ? "#22C55E" : timeLeft > timeLimit * 0.2 ? "#F59E0B" : "#EF4444";

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-lg mx-auto">
      <div className="flex items-center justify-between w-full">
        <span className="text-sm font-medium" style={{ color: "#EC4899" }}>Word {wordIndex + 1}/{MAX_QUESTIONS}</span>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: "#F1F5F9" }}>Score: {score}</span>
          <span className="text-sm font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: timerColor }}>
            {timeLeft}s
          </span>
        </div>
      </div>

      {/* Renders the hint when requested */}
      {showHint && currentWord.hint && (
        <p className="text-sm text-center px-4 py-2 rounded-lg max-w-md transition-all" style={{ background: "rgba(236,72,153,0.15)", color: "#EC4899", border: "1px solid rgba(236,72,153,0.3)" }}>
          💡 <strong>Hint:</strong> {currentWord.hint}
        </p>
      )}

      {feedback ? (
        <div className="text-2xl font-bold" style={{ color: feedback.includes("✅") ? "#22C55E" : "#EF4444" }}>{feedback}</div>
      ) : (
        <>
          <div className="flex gap-1 justify-center flex-wrap">
            {currentWord.word.split('').map((_, i) => (
              <div key={i} className="w-10 h-12 rounded-lg flex items-center justify-center text-lg font-bold"
                style={{ background: builtWord[i] ? "rgba(236,72,153,0.3)" : "rgba(255,255,255,0.05)", border: `1px solid ${builtWord[i] ? "rgba(236,72,153,0.5)" : "rgba(255,255,255,0.15)"}`, color: "#F1F5F9" }}>
                {builtWord[i] || '_'}
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-center flex-wrap">
            {scrambled.map((letter, i) => (
              <button key={i} onClick={() => handleLetterClick(i)}
                disabled={selected.includes(i)}
                className={`w-12 h-12 rounded-xl text-lg font-bold transition-all ${selected.includes(i) ? 'opacity-20' : 'hover:scale-110 active:scale-95'}`}
                style={{ background: selected.includes(i) ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.1)", border: "1px solid rgba(236,72,153,0.3)", color: "#F1F5F9" }}>
                {letter}
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            <button onClick={handleReset} className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
              style={{ background: "rgba(255,255,255,0.08)", color: "rgba(241,245,249,0.6)" }}>
              🔄 Reset
            </button>
            
            {/* Removed the early_learners check so hints are available to everyone */}
            {!showHint && (
              <button onClick={handleHint} className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
                style={{ background: "rgba(236,72,153,0.15)", color: "#EC4899" }}>
                💡 Hint (-3pts)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}