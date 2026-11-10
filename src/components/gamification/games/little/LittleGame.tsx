import { useEffect, useRef, useState } from "react";
import type { GameResult } from "../../types";
import { playCorrectSound, playWrongSound } from "../../sounds";
import { LITTLE_ROUNDS } from "./rounds";
import { say, cancelSay, pick, type Ctx, type Q } from "./util";

interface Props {
  gameId: string;
  gameName: string;
  gameIndex: number;
  /** 0 = Nursery, 1 = LKG, 2 = UKG */
  level: number;
  onComplete: (result: GameResult) => void;
}

const PRAISE = ["Great job!", "Well done!", "Super!", "Hooray!"];

/**
 * Runs one picture game for Nursery / LKG / UKG: a few short rounds, spoken instructions,
 * no timer and no penalties. Reports a normal GameResult when finished so XP, streaks and badges work.
 */
export function LittleGame({ gameId, gameName, gameIndex, level, onComplete }: Props) {
  const def = LITTLE_ROUNDS[gameId];
  const N = def?.rounds ?? 5;
  const [r, setR] = useState(0);
  const [q, setQ] = useState<{ r: number; q: Q; c: Ctx } | null>(null);
  const [line, setLine] = useState("");
  const stars = useRef(0), miss = useRef(0), solved = useRef(false), made = useRef(-1), mounted = useRef(false);
  const started = useRef(Date.now()), timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lineRef = useRef("");
  const finished = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; timers.current.forEach(clearTimeout); cancelSay(); };
  }, []);

  useEffect(() => {
    if (!def || made.current === r) return;
    made.current = r; miss.current = 0; solved.current = false;
    const question = def.make(level);
    const ctx: Ctx = {
      say,
      prompt: t => { lineRef.current = t; setLine(t); say(t); },
      alive: () => mounted.current && !solved.current,
      wrong: () => { miss.current++; playWrongSound(); if (miss.current === 1) say("Try again!"); return miss.current; },
      ok: extra => {
        if (solved.current) return;
        solved.current = true;
        if (!miss.current) stars.current++;
        playCorrectSound();
        say(`${extra ? extra + ". " : ""}${pick(PRAISE)}`);
        timers.current.push(setTimeout(() => {
          if (!mounted.current) return;
          if (r + 1 >= N) finish(); else setR(r + 1);
        }, 1700));
      },
    };
    lineRef.current = question.prompt; setLine(question.prompt); say(question.prompt);
    setQ({ r, q: question, c: ctx });
  }, [r]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = () => {
    if (finished.current) return; finished.current = true;
    const s = stars.current, secs = Math.max(1, Math.round((Date.now() - started.current) / 1000));
    // Every finished round counts; a round solved on the first try counts fully. No penalty for trying again.
    const accuracy = Math.round(((s + (N - s) * 0.5) / N) * 100);
    onComplete({
      gameIndex, gameName, rawScore: s * 10 + (N - s) * 5, maxScore: N * 10, accuracy,
      avgResponseTime: secs / N, questionsAttempted: N, questionsCorrect: N, timeUsed: secs, timeLimit: 120,
    });
  };

  if (!def) return null;
  return (
    <div className="ll-wrap">
      <style>{LL_CSS}</style>
      <div className="ll-dots" aria-label={`Round ${Math.min(r + 1, N)} of ${N}`}>
        {Array.from({ length: N }, (_, i) => <span key={i} className={`ll-dot ${i < r ? "on" : i === r ? "cur" : ""}`} />)}
      </div>
      <div className="ll-prompt" role="status" aria-live="polite">
        <span className="ll-mascot" aria-hidden="true">🍊</span><span>{line}</span>
        <button type="button" className="ll-replay" aria-label="Say it again" onClick={() => say(lineRef.current)}>🔈</button>
      </div>
      <div key={r}>{q && q.r === r ? q.q.view(q.c) : null}</div>
    </div>
  );
}

const LL_CSS = `
.ll-wrap{max-width:780px;margin:0 auto;padding:6px 12px 40px;text-align:center;color:#fff;font-weight:800;user-select:none}
.ll-wrap button{font-family:inherit;color:#24135F;cursor:pointer}
.ll-dots{display:flex;gap:8px;justify-content:center;margin-bottom:10px}
.ll-dot{width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,.3);border:2px solid #24135F}.ll-dot.on{background:#FFB830}.ll-dot.cur{background:#fff}
.ll-prompt{display:flex;align-items:center;justify-content:center;gap:10px;background:#FFFDF5;color:#24135F;border:3px solid #24135F;box-shadow:0 5px 0 #24135F;border-radius:24px;padding:10px 14px;margin:6px 0 14px;font-size:clamp(20px,4.6vw,28px);font-weight:900}
.ll-mascot{font-size:44px}
.ll-replay{background:#FFFDF5;border:3px solid #24135F;box-shadow:0 3px 0 #24135F;border-radius:14px;padding:4px 10px;font-size:20px}
.ll-stage{min-height:300px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
.ll-row{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:12px;margin:8px 0}
.ll-pic{background:#FFFDF5;border:3px solid #24135F;box-shadow:0 5px 0 #24135F;border-radius:24px;font-size:clamp(54px,14vw,84px);line-height:1;padding:14px 20px;min-width:104px;transition:transform .1s}
.ll-pic:active:not(:disabled){transform:translateY(3px);box-shadow:0 1px 0 #24135F}
.ll-pic:disabled{opacity:1}
.ll-big{font-size:clamp(100px,28vw,170px);line-height:1;background:#FFFDF5;color:#24135F;border:3px solid #24135F;border-radius:32px;padding:10px 30px}
.ll-balloon{width:86px;height:108px;border-radius:50% 50% 48% 48%;border:3px solid #24135F;font-size:38px;font-weight:900;color:#fff!important;text-shadow:0 2px 0 #24135F;animation:ll-bob 2.4s ease-in-out infinite;position:relative}
.ll-balloon::after{content:"";position:absolute;left:50%;top:100%;width:2px;height:22px;background:#24135F}
.ll-popped{transform:scale(0);opacity:0;transition:.2s;pointer-events:none}
.ll-mon{font-size:110px;transition:transform .2s}.ll-yum{transform:scale(1.25) rotate(-6deg)}
.ll-count{font-size:46px;font-weight:900;text-shadow:0 3px 0 #24135F}
.ll-gone{opacity:.15;pointer-events:none}
.ll-pw{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;align-items:flex-start}
.ll-art{background:#FFFDF5;border:3px solid #24135F;border-radius:24px}
.ll-art [data-r]{stroke:#24135F;stroke-width:3;stroke-linejoin:round}
.ll-sw{width:62px;height:62px;border-radius:50%;border:4px solid #24135F;box-shadow:0 4px 0 #24135F;padding:0}.ll-sel{outline:5px solid #FFB830;transform:scale(1.12)}
.ll-wob{animation:ll-wob .4s}.ll-glow{animation:ll-glow .7s infinite}
@keyframes ll-bob{50%{transform:translateY(-14px)}}
@keyframes ll-wob{25%{transform:translateX(-10px) rotate(-4deg)}75%{transform:translateX(10px) rotate(4deg)}}
@keyframes ll-glow{50%{box-shadow:0 0 0 8px #FFB830,0 5px 0 #24135F}}
@media(prefers-reduced-motion:reduce){.ll-wrap *{animation:none!important}}
`;
