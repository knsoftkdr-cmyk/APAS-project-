import { useState, useEffect } from "react";
import { AgeGroup, getAgeGroupById } from "../engine/ageGroups";
import { selectGamesForStudent, selectGamesForGeneric, SelectedGame, GameMode } from "../engine/gameSelector";
import { getGameContext, GameContext } from "@/lib/gamificationQuestions";
import { Brain, Rocket, BookOpen, GraduationCap, Sparkles, Layers, Puzzle, Loader2 } from "lucide-react";

interface Props {
  /** Kept for backwards compatibility. Age is no longer typed in: the class comes from the student's record. */
  studentAge?: number;
  onStart: (selectedGames: SelectedGame[], ageGroup: AgeGroup, subject: string, studentClass: string, mode: GameMode) => void;
}

export function GameSetupScreen({ onStart }: Props) {
  // Class and subjects come from the signed-in student's own record (server-side), never from user input.
  const [ctx, setCtx] = useState<GameContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [mode, setMode] = useState<GameMode>('subject');

  useEffect(() => {
    let cancelled = false;
    getGameContext()
      .then(c => { if (!cancelled) setCtx(c); })
      .catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load your class."); });
    return () => { cancelled = true; };
  }, []);

  const ageGroup: AgeGroup | null = ctx ? getAgeGroupById(ctx.band) : null;
  const subjects = ctx?.subjects.map(s => s.label) ?? [];

  const handleStart = () => {
    if (!ctx || !ageGroup) return;
    if (mode === 'subject' && !selectedSubject) return;

    if (mode === 'subject') {
      const games = selectGamesForStudent(ageGroup.id, selectedSubject);
      onStart(games, ageGroup, selectedSubject, ctx.class.key, 'subject');
    } else {
      const games = selectGamesForGeneric(ageGroup.id);
      onStart(games, ageGroup, 'General', ctx.class.key, 'generic');
    }
  };

  const hasSubjects = subjects.length > 0;
  const canStart = !!ctx && !!ageGroup && hasSubjects && (mode === 'generic' || !!selectedSubject);

  return (
    <div className="text-center max-w-xl mx-auto space-y-8 welcome-enter">
      {/* Hero */}
      <div className="relative w-32 h-32 mx-auto">
        <div className="absolute inset-0 rounded-full animate-spin-slow" style={{ background: "conic-gradient(from 0deg, #6366F1, #A855F7, #F472B6, #38BDF8, #84CC16, #F59E0B, #6366F1)", padding: 3 }}>
          <div className="w-full h-full rounded-full" style={{ background: "#0F172A" }} />
        </div>
        <div className="absolute inset-0 flex items-center justify-center text-5xl">🧠</div>
      </div>

      <div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight"
          style={{ background: "linear-gradient(135deg, #6366F1, #A855F7, #F472B6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Adaptive Game Round
        </h1>
        <p className="text-sm mt-2" style={{ color: "rgba(241,245,249,0.5)" }}>
          Games are personalized for your class & preferences
        </p>
      </div>

      {/* Mode Tabs */}
      <div className="space-y-3">
        <label className="text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2" style={{ color: "rgba(241,245,249,0.4)" }}>
          <Layers className="h-4 w-4" /> Choose Game Mode
        </label>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => { setMode('subject'); setSelectedSubject(''); }}
            className="flex items-center gap-2.5 px-6 py-3.5 rounded-2xl text-sm font-bold transition-all duration-200 hover:scale-105"
            style={{
              background: mode === 'subject' ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.05)",
              border: `2px solid ${mode === 'subject' ? "rgba(168,85,247,0.6)" : "rgba(255,255,255,0.1)"}`,
              color: mode === 'subject' ? "#C084FC" : "rgba(241,245,249,0.5)",
              boxShadow: mode === 'subject' ? "0 0 20px rgba(168,85,247,0.15)" : "none",
            }}
          >
            <BookOpen className="h-4 w-4" />
            Subject-wise
          </button>
          <button
            onClick={() => setMode('generic')}
            className="flex items-center gap-2.5 px-6 py-3.5 rounded-2xl text-sm font-bold transition-all duration-200 hover:scale-105"
            style={{
              background: mode === 'generic' ? "rgba(56,189,248,0.25)" : "rgba(255,255,255,0.05)",
              border: `2px solid ${mode === 'generic' ? "rgba(56,189,248,0.6)" : "rgba(255,255,255,0.1)"}`,
              color: mode === 'generic' ? "#7DD3FC" : "rgba(241,245,249,0.5)",
              boxShadow: mode === 'generic' ? "0 0 20px rgba(56,189,248,0.15)" : "none",
            }}
          >
            <Puzzle className="h-4 w-4" />
            Generic
          </button>
        </div>
        <p className="text-xs" style={{ color: "rgba(241,245,249,0.35)" }}>
          {mode === 'subject'
            ? 'Games tailored to a specific subject from your curriculum'
            : 'Brain training games with cognitive challenges & mixed-subject quizzes'}
        </p>
      </div>

      {/* Your class (read from your student record - not typed in) */}
      {!ctx && !loadError && (
        <div className="flex items-center justify-center gap-2 text-sm" style={{ color: "rgba(241,245,249,0.5)" }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your class…
        </div>
      )}
      {loadError && (
        <div className="rounded-2xl p-4 mx-auto max-w-md text-sm animate-fade-in"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#FCA5A5" }}>
          {loadError}
        </div>
      )}
      {ctx && ageGroup && (
        <div className="space-y-3 animate-fade-in">
          <label className="text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2" style={{ color: "rgba(241,245,249,0.4)" }}>
            <GraduationCap className="h-4 w-4" /> Your Class
          </label>
          <div className="flex items-center justify-center gap-3 py-3 px-6 rounded-2xl mx-auto w-fit"
            style={{ background: `${ageGroup.color}15`, border: `1px solid ${ageGroup.color}30` }}>
            <span className="text-2xl">{ageGroup.emoji}</span>
            <div className="text-left">
              <p className="text-sm font-bold" style={{ color: ageGroup.color }}>{ctx.class.label}</p>
              <p className="text-xs" style={{ color: "rgba(241,245,249,0.5)" }}>{ageGroup.label} · {ageGroup.description}</p>
            </div>
          </div>
          <p className="text-xs" style={{ color: "rgba(241,245,249,0.35)" }}>
            Questions are chosen for {ctx.class.label} only.
          </p>
        </div>
      )}
      {ctx && !hasSubjects && (
        <div className="rounded-2xl p-4 mx-auto max-w-md text-sm animate-fade-in"
          style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "#FCD34D" }}>
          {ctx.message ?? "No subjects are set up for your class yet."}
        </div>
      )}

      {/* Subject Selection — only in subject mode */}
      {mode === 'subject' && ctx && hasSubjects && (
        <div className="space-y-3 animate-fade-in">
          <label className="text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2" style={{ color: "rgba(241,245,249,0.4)" }}>
            <BookOpen className="h-4 w-4" /> Select Subject
          </label>
          <div className="flex flex-wrap gap-2 justify-center">
            {subjects.map(sub => (
              <button key={sub} onClick={() => setSelectedSubject(sub)}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 hover:scale-105 ${selectedSubject === sub ? 'scale-105' : ''}`}
                style={{
                  background: selectedSubject === sub ? "rgba(168,85,247,0.3)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${selectedSubject === sub ? "rgba(168,85,247,0.6)" : "rgba(255,255,255,0.1)"}`,
                  color: selectedSubject === sub ? "#C084FC" : "rgba(241,245,249,0.6)",
                }}>
                {sub}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Generic mode info */}
      {mode === 'generic' && ctx && hasSubjects && (
        <div className="animate-fade-in rounded-2xl p-4 mx-auto max-w-md"
          style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)" }}>
          <div className="flex items-start gap-3">
            <Brain className="h-5 w-5 mt-0.5 flex-shrink-0" style={{ color: "#7DD3FC" }} />
            <div className="text-left space-y-1">
              <p className="text-sm font-bold" style={{ color: "#7DD3FC" }}>Generic Brain Training</p>
              <p className="text-xs leading-relaxed" style={{ color: "rgba(241,245,249,0.5)" }}>
                Includes cognitive games (memory, logic, speed, verbal) and mixed-subject quizzes pulling questions from your class subjects. You won't see the same question twice.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Start Button */}
      <button onClick={handleStart} disabled={!canStart}
        className="group relative px-12 py-5 rounded-2xl text-lg font-black tracking-wide transition-all duration-300 disabled:opacity-20 disabled:cursor-not-allowed hover:scale-110 active:scale-95"
        style={{
          background: canStart ? "linear-gradient(135deg, #6366F1, #A855F7, #F472B6)" : "rgba(255,255,255,0.1)",
          color: "#F1F5F9",
          boxShadow: canStart ? "0 0 60px rgba(99,102,241,0.4), 0 8px 32px rgba(0,0,0,0.3)" : "none",
        }}>
        {canStart && <span className="absolute -top-2 -right-2 text-lg animate-bounce">✨</span>}
        <span className="relative flex items-center gap-3">
          <Rocket className="h-5 w-5" /> GENERATE MY GAMES
        </span>
      </button>
    </div>
  );
}