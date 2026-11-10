import { useState, useEffect } from "react";
import { motion, MotionConfig, type Variants } from "framer-motion";
import { AgeGroup, getAgeGroupById } from "../engine/ageGroups";
import { selectGamesForStudent, selectGamesForGeneric, selectLittleGames, SelectedGame, GameMode } from "../engine/gameSelector";
import { isPrePrimaryClass, eligibleLittleGames, littleSubjectForGames } from "../engine/littleGames";
import { say } from "../games/little/util";
import { getGameContext, GameContext } from "@/lib/gamificationQuestions";
import { useGamificationTheme } from "../theme/GamificationTheme";
import { ApasMark } from "../art/ApasMark";
import { ApasMascot } from "../art/ApasMascot";
import { playSelectSound, playStartSound, playDeselectSound } from "../sounds";
import { Brain, Rocket, BookOpen, GraduationCap, Layers, Puzzle, Loader2, Check } from "lucide-react";

interface Props {
  /** Kept for backwards compatibility. Age is no longer typed in: the class comes from the student's record. */
  studentAge?: number;
  onStart: (selectedGames: SelectedGame[], ageGroup: AgeGroup, subject: string, studentClass: string, mode: GameMode) => void;
  /** Called once the student's class is known, so the page can pick the matching APAS look. */
  onContext?: (classKey: string) => void;
}

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const item: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 24 } },
};

export function GameSetupScreen({ onStart, onContext }: Props) {
  const th = useGamificationTheme();
  const playful = th.tier === "playful";
  const arena = th.tier === "arena";

  // Class and subjects come from the signed-in student's own record (server-side), never from user input.
  const [ctx, setCtx] = useState<GameContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [mode, setMode] = useState<GameMode>('subject');
  // Nursery / LKG / UKG tap picture cards instead of reading subject names. Either a special choice ('surprise' = 5 mixed
  // games, 'all' = every game) or one or more specific games.
  const [special, setSpecial] = useState<'surprise' | 'all' | null>('surprise');
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    getGameContext()
      .then(c => { if (!cancelled) setCtx(c); })
      .catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load your class."); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (ctx) onContext?.(ctx.class.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  const ageGroup: AgeGroup | null = ctx ? getAgeGroupById(ctx.band) : null;
  const subjects = ctx?.subjects.map(s => s.label) ?? [];
  const little = !!ctx && isPrePrimaryClass(ctx.class.key);

  const handleStart = () => {
    if (!ctx || !ageGroup) return;
    if (little) {
      playStartSound();
      const games = selectLittleGames(ctx.class.key, special ?? picked);
      const subject = littleSubjectForGames(games, subjects);
      onStart(games, ageGroup, subject, ctx.class.key, subject === 'General' ? 'generic' : 'subject');
      return;
    }
    if (mode === 'subject' && !selectedSubject) return;
    playStartSound();

    if (mode === 'subject') {
      const games = selectGamesForStudent(ageGroup.id, selectedSubject, undefined, ctx.class.key);
      onStart(games, ageGroup, selectedSubject, ctx.class.key, 'subject');
    } else {
      const games = selectGamesForGeneric(ageGroup.id, undefined, ctx.class.key);
      onStart(games, ageGroup, 'General', ctx.class.key, 'generic');
    }
  };

  const hasSubjects = subjects.length > 0;
  const canStart = !!ctx && !!ageGroup && (little ? (!!special || picked.length > 0) : hasSubjects && (mode === 'generic' || !!selectedSubject));

  const INK = th.ink;
  const sectionLabel = "text-xs uppercase tracking-widest font-extrabold flex items-center justify-center gap-2";
  const notice = (kind: "error" | "warn") => {
    const light = kind === "error" ? ["#FEE2E2", "#B91C1C", "#7F1D1D"] : ["#FEF3C7", "#B45309", "#78350F"];
    const dark = kind === "error" ? ["rgba(239,68,68,0.12)", "rgba(239,68,68,0.45)", "#FCA5A5"] : ["rgba(245,158,11,0.12)", "rgba(245,158,11,0.45)", "#FCD34D"];
    const [bg, border, color] = playful ? light : dark;
    return { background: bg, border: `${playful ? 3 : 1}px solid ${border}`, color, borderRadius: playful ? 20 : 16 };
  };

  const modes: { id: GameMode; label: string; Icon: typeof BookOpen; playColor: string }[] = [
    { id: 'subject', label: 'Subject-wise', Icon: BookOpen, playColor: "#FFB830" },
    { id: 'generic', label: 'Generic', Icon: Puzzle, playColor: "#4DA8FF" },
  ];

  return (
    <MotionConfig reducedMotion="user">
      <motion.div variants={container} initial="hidden" animate="show"
        className="text-center max-w-xl mx-auto space-y-7 px-1" style={{ fontFamily: th.fontBody, color: th.text }}>

        {/* Hero */}
        <motion.div variants={item} className="flex flex-col items-center gap-3">
          {playful ? (
            <div className="flex items-end justify-center gap-1">
              <ApasMascot size={128} mood={canStart ? "cheer" : "happy"} />
              <div className="relative mb-16 max-w-[10.5rem] px-4 py-2 text-sm font-extrabold text-start"
                style={{ ...th.card, borderRadius: 20, color: th.cardText }}>
                <span aria-hidden="true" className="absolute w-3 h-3 rotate-45"
                  style={{ insetInlineStart: -8, bottom: 14, background: "#FFFDF5", borderInlineStart: `3px solid ${INK}`, borderBottom: `3px solid ${INK}` }} />
                {canStart ? "Let's go!" : "Pick your adventure!"}
              </div>
            </div>
          ) : arena ? (
            <div className="relative w-36 h-36 grid place-items-center">
              <motion.div className="absolute inset-0 rounded-full"
                style={{ background: "conic-gradient(from 0deg,#8B5CF6,#22D3EE,#F472B6,#FBBF24,#8B5CF6)", filter: "blur(16px)", opacity: 0.6 }}
                animate={{ rotate: 360 }} transition={{ duration: 14, repeat: Infinity, ease: "linear" }} />
              <motion.div className="absolute inset-0 rounded-full"
                style={{ background: "conic-gradient(from 0deg,#8B5CF6,#22D3EE,#F472B6,#FBBF24,#8B5CF6)" }}
                animate={{ rotate: -360 }} transition={{ duration: 14, repeat: Infinity, ease: "linear" }} />
              <div className="absolute rounded-full" style={{ inset: 4, background: "radial-gradient(circle at 50% 30%,#2E2279,#120D33)" }} />
              <motion.div className="absolute inset-0" animate={{ rotate: 360 }} transition={{ duration: 9, repeat: Infinity, ease: "linear" }}>
                <span className="absolute" style={{ top: -8, left: "calc(50% - 9px)" }}><ApasMark size={18} fill="#22D3EE" ink="#120D33" withA={false} /></span>
                <span className="absolute" style={{ bottom: -8, left: "calc(50% - 7px)" }}><ApasMark size={14} fill="#F472B6" ink="#120D33" withA={false} /></span>
              </motion.div>
              <motion.div className="relative" animate={{ y: [0, -5, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}>
                <ApasMark size={68} fill="#FBBF24" ink="#120D33" />
              </motion.div>
            </div>
          ) : (
            <div className="relative w-28 h-28 grid place-items-center">
              <motion.div className="absolute inset-0 rounded-full"
                style={{ background: "conic-gradient(from 0deg,#818CF8,#2DD4BF,#E7C873,#818CF8)" }}
                animate={{ rotate: 360 }} transition={{ duration: 24, repeat: Infinity, ease: "linear" }} />
              <div className="absolute rounded-full" style={{ inset: 2, background: "#0F1530" }} />
              <ApasMark size={54} fill="#E7C873" ink="#0F1530" className="relative" />
            </div>
          )}
          <div>
            {arena && (
              <div className="inline-flex items-center gap-1.5 mb-3 px-3 py-1 rounded-full text-[11px] font-extrabold tracking-[0.2em]"
                style={{ background: "rgba(139,92,246,0.18)", border: "1px solid rgba(167,139,250,0.5)", color: "#DDD6FE" }}>
                <ApasMark size={13} fill="#FBBF24" ink="#120D33" withA={false} /> APAS ARENA
              </div>
            )}
            <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-tight"
              style={playful
                ? { color: "#fff", fontFamily: th.fontHeading, textShadow: `0 3px 0 ${INK}, 2px 2px 0 ${INK}, -2px 2px 0 ${INK}, 0 -1px 0 ${INK}` }
                : arena
                  ? { fontFamily: th.fontHeading, fontWeight: 800, filter: "drop-shadow(0 4px 24px rgba(139,92,246,0.5))" }
                  : { fontFamily: th.fontHeading, fontWeight: 700, background: "linear-gradient(135deg,#E0E7FF,#818CF8 45%,#2DD4BF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              {playful ? "Pick Your Adventure!" : arena ? (
                <span style={{ display: "inline-block", background: "linear-gradient(135deg,#DDD6FE,#22D3EE 48%,#F472B6)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>
                  Adaptive Game Round
                </span>
              ) : "Adaptive Game Round"}
            </h1>
            <p className="text-sm mt-2 font-semibold" style={{ color: th.muted }}>
              {little ? "Tap the games you want to play!" : "Games are personalized for your class & preferences"}
            </p>
          </div>
        </motion.div>

        {/* Mode (not for Nursery / LKG / UKG: they pick pictures below) */}
        {ctx && !little && (
        <motion.div variants={item} className="space-y-3">
          <label className={sectionLabel} style={{ color: th.muted }}>
            <Layers className="h-4 w-4" /> Choose Game Mode
          </label>
          <div className="flex flex-wrap gap-3 justify-center">
            {modes.map(({ id, label, Icon, playColor }) => {
              const on = mode === id;
              return (
                <motion.button key={id} type="button" aria-pressed={on} whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.04 }}
                  onClick={() => { if (mode !== id) playSelectSound(); setMode(id); if (id === 'subject') setSelectedSubject(''); }}
                  className="flex items-center gap-2.5 min-h-[48px] px-6 py-3 text-sm font-extrabold"
                  style={playful
                    ? { background: on ? playColor : "#FFFDF5", color: INK, border: `3px solid ${INK}`, boxShadow: `0 5px 0 ${INK}`, borderRadius: 20 }
                    : arena
                    ? { background: on ? "linear-gradient(135deg,#7C3AED,#C026D3)" : "rgba(255,255,255,0.05)", color: on ? "#fff" : th.muted, border: `1px solid ${on ? "rgba(255,255,255,0.3)" : "rgba(167,139,250,0.35)"}`, borderRadius: 16, boxShadow: on ? "0 8px 28px rgba(192,38,211,0.45)" : "none" }
                    : { background: on ? "rgba(129,140,248,0.16)" : "rgba(255,255,255,0.04)", color: on ? "#C7D2FE" : th.muted, border: `1px solid ${on ? "rgba(129,140,248,0.7)" : "rgba(255,255,255,0.12)"}`, borderRadius: 14, boxShadow: on ? "0 0 24px rgba(129,140,248,0.18)" : "none" }}>
                  <Icon className="h-4 w-4" /> {label}
                </motion.button>
              );
            })}
          </div>
          <p className="text-xs font-medium" style={{ color: th.muted }}>
            {mode === 'subject'
              ? 'Games tailored to a specific subject from your curriculum'
              : 'Brain training games with cognitive challenges & mixed-subject quizzes'}
          </p>
        </motion.div>
        )}

        {/* Your class (read from the student record, not typed in) */}
        {!ctx && !loadError && (
          <div className="flex items-center justify-center gap-2 text-sm font-semibold" style={{ color: th.muted }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your class…
          </div>
        )}
        {loadError && (
          <div className="p-4 mx-auto max-w-md text-sm font-semibold" style={notice("error")}>
            {loadError}
          </div>
        )}
        {ctx && ageGroup && (
          <motion.div variants={item} className="space-y-3">
            <label className={sectionLabel} style={{ color: th.muted }}>
              <GraduationCap className="h-4 w-4" /> Your Class
            </label>
            <div className="flex items-center justify-center gap-3 py-3 px-6 mx-auto w-fit max-w-full"
              style={playful || arena ? th.card : { ...th.card, border: "1px solid rgba(231,200,115,0.4)" }}>
              <ApasMark size={34} fill={playful ? "#FFB830" : arena ? "#FBBF24" : "#E7C873"} ink={INK} />
              <div className="text-start">
                <p className="text-sm font-extrabold" style={{ color: th.cardText }}>{ctx.class.label}</p>
                <p className="text-xs font-medium" style={{ color: th.cardMuted }}>{ageGroup.label} · {ageGroup.description}</p>
              </div>
            </div>
            {!little && (
              <p className="text-xs font-medium" style={{ color: th.muted }}>
                Questions are chosen for {ctx.class.label} only.
              </p>
            )}
          </motion.div>
        )}
        {ctx && !little && !hasSubjects && (
          <div className="p-4 mx-auto max-w-md text-sm font-semibold" style={notice("warn")}>
            {ctx.message ?? "No subjects are set up for your class yet."}
          </div>
        )}

        {/* Subjects: subject mode only */}
        {mode === 'subject' && ctx && hasSubjects && !little && (
          <motion.div variants={item} className="space-y-3">
            <label className={sectionLabel} style={{ color: th.muted }}>
              <BookOpen className="h-4 w-4" /> Select Subject
            </label>
            <div className={arena ? "grid grid-cols-2 sm:grid-cols-3 gap-3" : "flex flex-wrap gap-2.5 justify-center"}>
              {subjects.map((sub, i) => {
                const on = selectedSubject === sub;
                const colour = th.swatches[i % th.swatches.length];
                if (arena) {
                  return (
                    <motion.button key={sub} type="button" aria-pressed={on} whileTap={{ scale: 0.95 }} whileHover={{ y: -3 }}
                      onClick={() => { if (selectedSubject === sub) playDeselectSound(); else playSelectSound(); setSelectedSubject(sub); }}
                      className="relative flex flex-col items-center gap-2 min-h-[96px] px-3 py-4 text-sm font-bold"
                      style={{ background: on ? `linear-gradient(160deg,${colour}33,${colour}12)` : "rgba(255,255,255,0.05)", color: th.text, border: `1px solid ${on ? colour : "rgba(167,139,250,0.28)"}`, borderRadius: 20, boxShadow: on ? `0 0 0 1px ${colour}, 0 10px 32px ${colour}55` : "none" }}>
                      <span className="grid place-items-center w-11 h-11 rounded-2xl text-lg font-black"
                        style={{ background: `linear-gradient(135deg,${colour},${colour}99)`, color: "#120D33", boxShadow: `0 6px 18px ${colour}66` }}>
                        {sub.trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="leading-tight break-words">{sub}</span>
                      {on && (
                        <span className="absolute top-2 end-2 grid place-items-center w-5 h-5 rounded-full" style={{ background: colour, color: "#120D33" }}>
                          <Check className="h-3 w-3" strokeWidth={4} />
                        </span>
                      )}
                    </motion.button>
                  );
                }
                return (
                  <motion.button key={sub} type="button" aria-pressed={on} whileTap={{ scale: 0.94 }}
                    animate={{ scale: on ? 1.06 : 1, rotate: on && playful ? [0, -3, 3, 0] : 0 }}
                    transition={{ duration: 0.35 }}
                    onClick={() => { if (selectedSubject === sub) playDeselectSound(); else playSelectSound(); setSelectedSubject(sub); }}
                    className="relative min-h-[44px] px-5 py-2.5 text-sm font-extrabold"
                    style={playful
                      ? { background: colour, color: INK, border: `3px solid ${INK}`, boxShadow: on ? `0 2px 0 ${INK}` : `0 5px 0 ${INK}`, borderRadius: 18, transform: on ? "translateY(3px)" : undefined }
                      : { background: on ? "rgba(129,140,248,0.2)" : "rgba(255,255,255,0.04)", color: on ? "#E0E7FF" : th.muted, border: `1px solid ${on ? "rgba(129,140,248,0.7)" : "rgba(255,255,255,0.12)"}`, borderRadius: 999, boxShadow: on ? `inset 0 -2px 0 #E7C873` : "none" }}>
                    {sub}
                    {on && playful && (
                      <span className="absolute -top-2 -end-2 grid place-items-center w-6 h-6 rounded-full" style={{ background: "#fff", border: `2px solid ${INK}`, color: INK }}>
                        <Check className="h-3.5 w-3.5" strokeWidth={4} />
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Generic mode info */}
        {mode === 'generic' && ctx && hasSubjects && !little && (
          <motion.div variants={item} className="p-4 mx-auto max-w-md" style={th.card}>
            <div className="flex items-start gap-3">
              <Brain className="h-5 w-5 mt-0.5 flex-shrink-0" style={{ color: playful ? "#0369A1" : arena ? "#67E8F9" : "#7DD3FC" }} />
              <div className="text-start space-y-1">
                <p className="text-sm font-extrabold" style={{ color: th.cardText }}>Generic Brain Training</p>
                <p className="text-xs leading-relaxed font-medium" style={{ color: th.cardMuted }}>
                  Includes cognitive games (memory, logic, speed, verbal) and mixed-subject quizzes pulling questions from your class subjects. You won't see the same question twice.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Nursery / LKG / UKG: a big picture card for every game, no reading needed */}
        {little && ctx && (() => {
          const games = eligibleLittleGames(ctx.class.key);
          const choose = (id: string) => {
            playSelectSound();
            const g = games.find(x => x.id === id);
            if (g) say(g.name);
            if (special) { setSpecial(null); setPicked([id]); return; }
            const next = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id];
            setPicked(next);
            if (!next.length) setSpecial('surprise');
          };
          const chooseSpecial = (k: 'surprise' | 'all', label: string) => { playSelectSound(); say(label); setSpecial(k); setPicked([]); };
          const cards: { id: string; icon: string; name: string; color: string; on: boolean; onClick: () => void }[] = [
            { id: 'surprise', icon: "🎁", name: "Surprise Me!", color: "#FF8A1F", on: special === 'surprise', onClick: () => chooseSpecial('surprise', "Surprise me") },
            { id: 'all', icon: "🌟", name: "All Games", color: "#FFD43B", on: special === 'all', onClick: () => chooseSpecial('all', "All games") },
            ...games.map(g => ({ id: g.id, icon: g.icon, name: g.name, color: g.color, on: picked.includes(g.id), onClick: () => choose(g.id) })),
          ];
          return (
            <motion.div variants={item} className="space-y-4">
              <label className={sectionLabel} style={{ color: th.muted }}>
                <Puzzle className="h-4 w-4" /> Tap the games you want
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 justify-items-center">
                {cards.map(c => (
                  <motion.button key={c.id} type="button" aria-pressed={c.on} aria-label={c.name} whileTap={{ scale: 0.93 }}
                    animate={{ scale: c.on ? 1.05 : 1 }} transition={{ duration: 0.25 }} onClick={c.onClick}
                    className="relative flex flex-col items-center justify-center gap-1 w-full max-w-[180px] min-h-[124px] px-2 py-3 text-base font-black leading-tight"
                    style={{ background: c.color, color: INK, border: `3px solid ${INK}`, borderRadius: 26,
                      boxShadow: c.on ? `0 2px 0 ${INK}` : `0 7px 0 ${INK}`, transform: c.on ? "translateY(5px)" : undefined }}>
                    <span aria-hidden="true" className="text-5xl leading-none">{c.icon}</span>
                    <span>{c.name}</span>
                    {c.on && (
                      <span className="absolute -top-2 -end-2 grid place-items-center w-7 h-7 rounded-full" style={{ background: "#fff", border: `2px solid ${INK}`, color: INK }}>
                        <Check className="h-4 w-4" strokeWidth={4} />
                      </span>
                    )}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          );
        })()}

        {/* Start */}
        <motion.div variants={item} className="pt-1">
          <motion.button type="button" onClick={handleStart} disabled={!canStart}
            whileHover={canStart ? { scale: 1.05 } : undefined} whileTap={canStart ? { scale: 0.95 } : undefined}
            className="min-h-[56px] px-10 sm:px-12 py-4 text-lg font-black tracking-wide disabled:cursor-not-allowed"
            style={playful
              ? { background: canStart ? "#FF5E73" : "#D9D2F0", color: INK, border: `3px solid ${INK}`, boxShadow: `0 7px 0 ${INK}`, borderRadius: 24, opacity: canStart ? 1 : 0.7 }
              : arena
                ? { position: "relative", overflow: "hidden", background: canStart ? "linear-gradient(135deg,#7C3AED,#C026D3 55%,#F97316)" : "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.28)", borderRadius: 18, boxShadow: canStart ? "0 12px 44px rgba(192,38,211,0.5)" : "none", opacity: canStart ? 1 : 0.4 }
                : { background: canStart ? "linear-gradient(135deg,#4F46E5,#6D5EF5)" : "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 16, boxShadow: canStart ? "0 10px 40px rgba(79,70,229,0.45)" : "none", opacity: canStart ? 1 : 0.4 }}>
            {arena && canStart && (
              <motion.span aria-hidden="true" className="absolute inset-y-0 w-1/3 pointer-events-none"
                style={{ background: "linear-gradient(100deg,transparent,rgba(255,255,255,0.35),transparent)" }}
                initial={{ x: "-150%" }} animate={{ x: "420%" }} transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.2, ease: "easeInOut" }} />
            )}
            <span className="relative flex items-center justify-center gap-3">
              <Rocket className="h-5 w-5" /> {playful ? "LET'S PLAY!" : "GENERATE MY GAMES"}
            </span>
          </motion.button>
        </motion.div>
      </motion.div>
    </MotionConfig>
  );
}
