import { useState, useEffect, useRef } from "react";
import { GameProps, GameResult } from "./types";
import { playCorrectSound, playWrongSound, playNextSound, playLevelUpSound } from "./sounds";

interface Paragraph {
  words: { text: string; isError: boolean }[];
  difficulty: number;
}

// Difficulty 0 (Very Easy): Short sentences, very obvious errors
// Difficulty 1 (Easy): Medium sentences, clear errors
// Difficulty 2 (Medium): Longer sentences, subtler errors
// Difficulty 3+ (Hard): Full paragraphs, tricky errors
const PARAGRAPHS: Paragraph[] = [
  // Very Easy (difficulty 0)
  {
    difficulty: 0,
    words: "The catt sat on the matt and looked at the brd flying in the sky".split(" ").map((w) => ({
      text: w,
      isError: ["catt", "matt", "brd"].includes(w),
    })),
  },
  {
    difficulty: 0,
    words: "I like to eet apples and drinc water evry day after scool".split(" ").map((w) => ({
      text: w,
      isError: ["eet", "drinc", "evry", "scool"].includes(w),
    })),
  },
  // Easy (difficulty 1)
  {
    difficulty: 1,
    words: "The dogg ran fast acros the park and jumped ovr the fense happily".split(" ").map((w) => ({
      text: w,
      isError: ["dogg", "acros", "ovr", "fense"].includes(w),
    })),
  },
  {
    difficulty: 1,
    words: "My frend and I went to the libary to reed books about animels and planetts".split(" ").map((w) => ({
      text: w,
      isError: ["frend", "libary", "reed", "animels", "planetts"].includes(w),
    })),
  },
  // Medium (difficulty 2)
  {
    difficulty: 2,
    words: "The quick brown fox jumps over the lazzy dog in the feild every morining while the sun shines britely across the beautful landscape".split(" ").map((w) => ({
      text: w,
      isError: ["lazzy", "feild", "morining", "britely", "beautful"].includes(w),
    })),
  },
  {
    difficulty: 2,
    words: "Education is the most powerfull weapon wich you can use to chang the world as stated by the famouse leader Nelson Mandela in his speach".split(" ").map((w) => ({
      text: w,
      isError: ["powerfull", "wich", "chang", "famouse", "speach"].includes(w),
    })),
  },
  // Hard (difficulty 3)
  {
    difficulty: 3,
    words: "Scientests have discoverd a new speceis of butterfly in the tropicle forests of South America that has remarkible patterns on it's wings".split(" ").map((w) => ({
      text: w,
      isError: ["Scientests", "discoverd", "speceis", "tropicle", "remarkible", "it's"].includes(w),
    })),
  },
  {
    difficulty: 3,
    words: "The studnets were asked to complet their assigments before the deadlne but many of them forgott to submitt the finnal report on tyme".split(" ").map((w) => ({
      text: w,
      isError: ["studnets", "complet", "assigments", "deadlne", "forgott", "submitt", "finnal", "tyme"].includes(w),
    })),
  },
  // Expert (difficulty 4)
  {
    difficulty: 4,
    words: "The wether forecast predictes heavy rainfal thoughout the weakend so resedents are adviced to stay indoors and prepair for posible flooding".split(" ").map((w) => ({
      text: w,
      isError: ["wether", "predictes", "rainfal", "thoughout", "weakend", "resedents", "adviced", "prepair", "posible"].includes(w),
    })),
  },
];

const LABELS = ["Very Easy", "Easy", "Medium", "Hard", "Expert"];

export function WordProof({ onComplete }: GameProps) {
  const [difficulty, setDifficulty] = useState(0);
  const [paraPool, setParaPool] = useState(() => PARAGRAPHS.filter((p) => p.difficulty === 0));
  const [paraIndex, setParagraphIndex] = useState(0);
  const [clickedWords, setClickedWords] = useState<Set<number>>(new Set());
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(120);
  const [totalCorrect, setTotalCorrect] = useState(0);
  const [totalFalse, setTotalFalse] = useState(0);
  const [parasCompleted, setParagraphsCompleted] = useState(0);
  const [consecutiveGood, setConsecutiveGood] = useState(0);
  const [diffLabel, setDiffLabel] = useState("Very Easy");
  const startTime = useRef(Date.now());
  const responseTimes = useRef<number[]>([]);
  const lastClick = useRef(Date.now());

  // Pick a paragraph from the current difficulty pool
  const para = paraPool[paraIndex % paraPool.length];
  const totalErrors = para.words.filter((w) => w.isError).length;
  const foundErrors = Array.from(clickedWords).filter((i) => para.words[i]?.isError).length;

  useEffect(() => {
    startTime.current = Date.now();
    lastClick.current = Date.now();
  }, []);

  useEffect(() => {
    if (timeLeft <= 0) { finishGame(); return; }
    const t = setTimeout(() => setTimeLeft((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft]);

  const finishGame = () => {
    const timeUsed = Math.round((Date.now() - startTime.current) / 1000);
    const avgResp = responseTimes.current.length > 0
      ? Math.round(responseTimes.current.reduce((a, b) => a + b, 0) / responseTimes.current.length)
      : 0;
    const totalAttempted = totalCorrect + totalFalse;
    onComplete({
      gameIndex: 2,
      gameName: "Word Proof",
      rawScore: Math.max(0, score),
      maxScore: (parasCompleted + 1) * totalErrors * 10,
      accuracy: totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0,
      avgResponseTime: avgResp,
      questionsAttempted: totalAttempted,
      questionsCorrect: totalCorrect,
      timeUsed,
      timeLimit: 120,
    });
  };

  const advanceParagraph = (wasGoodRound: boolean) => {
    setParagraphsCompleted((p) => p + 1);

    let newDiff = difficulty;
    let newGood = consecutiveGood;

    if (wasGoodRound) {
      newGood = consecutiveGood + 1;
      if (newGood >= 2) {
        newDiff = Math.min(difficulty + 1, 4);
        newGood = 0;
      }
    } else {
      newGood = 0;
      newDiff = Math.max(difficulty - 1, 0);
    }

    setDifficulty(newDiff);
    setConsecutiveGood(newGood);
    setDiffLabel(LABELS[newDiff]);

    const newPool = PARAGRAPHS.filter((p) => p.difficulty <= newDiff);
    // Prefer paragraphs at the current difficulty
    const preferred = newPool.filter((p) => p.difficulty === newDiff);
    const pool = preferred.length > 0 ? preferred : newPool;
    setParaPool(pool);

    setTimeout(() => {
      setParagraphIndex((p) => p + 1);
      setClickedWords(new Set());
    }, 800);
  };

  const handleWordClick = (idx: number) => {
    if (clickedWords.has(idx)) return;

    responseTimes.current.push(Date.now() - lastClick.current);
    lastClick.current = Date.now();

    const newClicked = new Set(clickedWords);
    newClicked.add(idx);
    setClickedWords(newClicked);

    if (para.words[idx].isError) {
      setScore((p) => p + 10);
      setTotalCorrect((p) => p + 1);
      playCorrectSound();
    } else {
      setScore((p) => p - 8);
      setTotalFalse((p) => p + 1);
      playWrongSound();
    }

    const newFoundErrors = Array.from(newClicked).filter((i) => para.words[i]?.isError).length;
    if (newFoundErrors >= totalErrors) {
      const falseClicks = Array.from(newClicked).filter((i) => !para.words[i]?.isError).length;
      const wasGoodRound = falseClicks <= 1;
      if (wasGoodRound && consecutiveGood + 1 >= 2) playLevelUpSound();
      playNextSound();
      advanceParagraph(wasGoodRound);
    }
  };

  const timerColor = timeLeft > 60 ? "#22C55E" : timeLeft > 20 ? "#F59E0B" : "#EF4444";

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between w-full">
        <div className="flex flex-col">
          <span className="text-sm font-medium" style={{ color: "#84CC16" }}>
            Paragraph {parasCompleted + 1} · Found {foundErrors}/{totalErrors} errors
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full mt-1" style={{ background: "rgba(132,204,22,0.2)", color: "#84CC16" }}>
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

      <p className="text-xs text-center" style={{ color: "rgba(241,245,249,0.5)" }}>
        Click on words with spelling or grammar errors
      </p>

      <div className="p-6 rounded-2xl leading-loose" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(132,204,22,0.2)" }}>
        {para.words.map((word, idx) => {
          const isClicked = clickedWords.has(idx);
          let wordStyle: React.CSSProperties = {
            color: "#F1F5F9",
            cursor: "pointer",
            padding: "2px 4px",
            borderRadius: "4px",
            transition: "all 0.2s",
          };

          if (isClicked) {
            if (word.isError) {
              wordStyle = { ...wordStyle, backgroundColor: "rgba(34,197,94,0.3)", color: "#22C55E", textDecoration: "line-through", cursor: "default" };
            } else {
              wordStyle = { ...wordStyle, backgroundColor: "rgba(239,68,68,0.3)", color: "#EF4444", cursor: "default" };
            }
          }

          return (
            <span key={idx}>
              <span
                onClick={() => !isClicked && handleWordClick(idx)}
                className="inline-block hover:bg-white/10 text-base md:text-lg"
                style={wordStyle}
              >
                {word.text}
              </span>{" "}
            </span>
          );
        })}
      </div>
    </div>
  );
}
