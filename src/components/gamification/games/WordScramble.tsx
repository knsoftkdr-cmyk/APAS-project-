import { useState, useEffect, useRef } from "react";
import { GameResult } from "../types";
import { AgeGroupId } from "../engine/ageGroups";
import { playCorrectSound, playWrongSound, playNextSound } from "../sounds";

interface CustomScrambleItem {
  word: string;
  hint: string;
}

interface Props {
  onComplete: (result: GameResult) => void;
  studentName: string;
  ageGroup: AgeGroupId;
  subject: string;
  gameIndex: number;
  timeLimit: number;
  customScrambles?: CustomScrambleItem[];
}

export function WordScramble({ onComplete, ageGroup, subject, gameIndex, timeLimit, customScrambles }: Props) {
  const [wordPool, setWordPool] = useState<CustomScrambleItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeItem, setActiveItem] = useState<CustomScrambleItem | null>(null);
  const [scrambledWord, setScrambledWord] = useState("");
  const [userInput, setUserInput] = useState("");
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  
  const startTime = useRef(Date.now());
  const scrambleStart = useRef(Date.now());
  const responseTimes = useRef<number[]>([]);
  
  // CHANGED: Lowered the round cap to exactly 5 unique questions
  const MAX_WORDS = 5; 

  const scrambleString = (word: string) => {
    const letters = word.split("");
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[letters[i] ? i : j]];
    }
    const finalScramble = letters.join("");
    return finalScramble === word ? scrambleString(word) : finalScramble;
  };

  useEffect(() => {
    let initialPool: CustomScrambleItem[] = [];

    if (customScrambles && customScrambles.length > 0) {
      initialPool = [...customScrambles];
    }

    // Baseline fallback vocabulary deck to pad short lists
    const basicBackupDeck = [
      { word: "BRAIN", hint: "The center organ controlling your cognitive thoughts" },
      { word: "GAME", hint: "An interactive challenge built for fun or education" },
      { word: "STUDY", hint: "Devoting time and attention to acquiring knowledge" },
      { word: "LOGIC", hint: "Reasoning conducted according to strict principles" },
      { word: "ROBOT", hint: "A machine capable of carrying out complex actions automatically" }
    ];

    // Filter out backup items that might conflict with custom items, then pad the pool to ensure length >= 5
    const uniqueBackupItems = basicBackupDeck.filter(
      bItem => !initialPool.some(pItem => pItem.word.toUpperCase() === bItem.word.toUpperCase())
    );

    // Combine arrays safely until we hit at least 5 words total
    let finalPool = [...initialPool];
    while (finalPool.length < MAX_WORDS && uniqueBackupItems.length > 0) {
      finalPool.push(uniqueBackupItems.shift()!);
    }

    // Shuffle the final pool completely using Fisher-Yates shuffle
    for (let i = finalPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [finalPool[i], finalPool[j]] = [finalPool[j], finalPool[i]];
    }

    // Slice down to exactly 5 items so the pool size matches MAX_WORDS perfectly
    const finalFivePool = finalPool.slice(0, MAX_WORDS);

    setWordPool(finalFivePool);
    if (finalFivePool.length > 0) {
      setActiveItem(finalFivePool[0]);
      setScrambledWord(scrambleString(finalFivePool[0].word.toUpperCase()));
    }
    
    setIsReady(true); 
    startTime.current = Date.now();
    scrambleStart.current = Date.now();
  }, [customScrambles, subject, ageGroup]);

  useEffect(() => {
    if (!isReady || wordPool.length === 0) return; 

    if (timeLeft <= 0 || currentIndex >= Math.min(MAX_WORDS, wordPool.length)) {
      finishGame();
      return;
    }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, currentIndex, wordPool, isReady]);

  const finishGame = () => {
    const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
    const avgResp = responseTimes.current.length > 0
      ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
      : 0;

    onComplete({
      gameIndex,
      gameName: "Word Scramble",
      rawScore: Math.max(0, score),
      maxScore: Math.min(MAX_WORDS, wordPool.length) * 20, 
      accuracy: currentIndex > 0 ? Math.round((correctCount / currentIndex) * 100) : 0,
      avgResponseTime: avgResp,
      questionsAttempted: currentIndex,
      questionsCorrect: correctCount,
      timeUsed,
      timeLimit,
    });
  };

  const checkAnswer = () => {
    if (!activeItem) return;

    const targetWord = activeItem.word.toUpperCase().trim();
    const cleanGuess = userInput.toUpperCase().trim();
    
    responseTimes.current.push(Date.now() - scrambleStart.current);
    const isCorrect = cleanGuess === targetWord;

    const updatedCorrectCount = isCorrect ? correctCount + 1 : correctCount;
    const updatedScore = isCorrect ? score + 20 : score;

    if (isCorrect) {
      setScore(p => p + 20);
      setCorrectCount(p => p + 1);
      setFeedback("✅ Brilliant!");
      playCorrectSound();
    } else {
      setFeedback(`❌ Incorrect! It was ${targetWord}`);
      playWrongSound();
    }

    setTimeout(() => {
      setFeedback(null);
      setUserInput("");
      const nextIndex = currentIndex + 1;
      
      if (nextIndex >= MAX_WORDS || nextIndex >= wordPool.length) {
        const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
        const avgResp = responseTimes.current.length > 0
          ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
          : 0;

        onComplete({
          gameIndex,
          gameName: "Word Scramble",
          rawScore: Math.max(0, updatedScore),
          maxScore: Math.min(MAX_WORDS, wordPool.length) * 20,
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
      
      // Pull the next pre-shuffled unique word linearly without repeating indices
      const nextItem = wordPool[nextIndex];
      if (nextItem) {
        setActiveItem(nextItem);
        setScrambledWord(scrambleString(nextItem.word.toUpperCase()));
      }
      
      scrambleStart.current = Date.now();
      playNextSound();
    }, 1500);
  };

  const timerColor = timeLeft > timeLimit * 0.5 ? "#22C55E" : timeLeft > timeLimit * 0.2 ? "#F59E0B" : "#EF4444";

  if (!isReady || !activeItem) {
    return <div className="text-center text-white font-bold">Loading puzzle elements...</div>;
  }

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-lg mx-auto">
      <div className="flex items-center justify-between w-full">
        <span className="text-sm font-medium text-pink-400">
          Word {currentIndex + 1}/{Math.min(MAX_WORDS, wordPool.length)}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">Score: {score}</span>
          <span className="text-sm font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: timerColor }}>
            {timeLeft}s
          </span>
        </div>
      </div>

      <div className="w-full min-h-[160px] p-6 rounded-2xl flex flex-col items-center justify-center gap-4 border"
        style={{ background: "rgba(244,114,182,0.05)", borderColor: "rgba(244,114,182,0.25)" }}>
        
        {feedback ? (
          <p className="text-xl font-bold animate-pulse" style={{ color: feedback.includes("✅") ? "#22C55E" : "#EF4444" }}>
            {feedback}
          </p>
        ) : (
          <>
            <div className="flex gap-2 justify-center flex-wrap">
              {scrambledWord.split("").map((char, index) => (
                <span key={index} className="w-12 h-12 rounded-xl text-xl font-black bg-white/10 text-white border border-white/20 flex items-center justify-center shadow-lg transform hover:scale-105 transition-transform">
                  {char}
                </span>
              ))}
            </div>
            <p className="text-xs text-gray-400 text-center italic mt-2">
              💡 Hint: {activeItem.hint}
            </p>
          </>
        )}
      </div>

      {!feedback && (
        <div className="flex gap-2 w-full">
          <input
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && userInput.trim() && checkAnswer()}
            placeholder="Type your unscrambled answer here..."
            className="flex-1 px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white outline-none font-semibold focus:border-pink-500/50 transition-colors"
          />
          <button
            onClick={checkAnswer}
            disabled={!userInput.trim()}
            className="px-6 rounded-xl font-black text-sm text-slate-900 bg-pink-400 hover:bg-pink-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95 shadow-[0_0_20px_rgba(244,114,182,0.3)]"
          >
            SUBMIT
          </button>
        </div>
      )}
    </div>
  );
}