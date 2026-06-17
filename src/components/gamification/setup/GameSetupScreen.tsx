import { useState, useEffect, useMemo } from "react";
import { AgeGroup, getAgeGroupByAge, AGE_GROUPS } from "../engine/ageGroups";
import { selectGamesForStudent, selectGamesForGeneric, SelectedGame, GameMode } from "../engine/gameSelector";
import { getSubjectsForClass } from "../engine/classSubjects";
import { resetQuestionTracker } from "../engine/contentPools";
import { Brain, Rocket, BookOpen, GraduationCap, Sparkles, User, Layers, Puzzle } from "lucide-react";

interface Props {
  studentAge?: number;
  onStart: (selectedGames: SelectedGame[], ageGroup: AgeGroup, subject: string, studentClass: string, mode: GameMode) => void;
}

const CLASS_OPTIONS = [
  { value: 'nursery', label: 'Nursery' },
  { value: 'lkg', label: 'LKG' },
  { value: 'ukg', label: 'UKG' },
  ...Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `Class ${i + 1}` })),
];

// ─── DEFINE DYNAMIC SUBJECT MAP ALIGNED FROM NURSERY UP TO CLASS 10 ───
const DYNAMIC_SUBJECTS_BY_CLASS: Record<string, string[]> = {
  nursery: ["English", "Maths"],
  lkg: ["English", "Maths"],
  ukg: ["English", "Maths"],
  "1": ["English", "Maths", "Science"],
  "2": ["English", "Maths", "Science"],
  "3": ["English", "Maths", "Science", "Social"],
  "4": ["English", "Maths", "Science", "Social"],
  "5": ["English", "Maths", "Science", "Social"],
  "6": ["English", "Maths", "Science"],
  "7": ["English", "Maths", "Science"],
  "8": ["English", "Maths", "Science"],
  "9": ["English", "Maths", "Science"],
  "10": ["English", "Maths", "Science"]
};

export function GameSetupScreen({ studentAge, onStart }: Props) {
  const [age, setAge] = useState<string>(studentAge ? String(studentAge) : '');
  const [selectedClass, setSelectedClass] = useState('');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [ageGroup, setAgeGroup] = useState<AgeGroup | null>(null);
  const [mode, setMode] = useState<GameMode>('subject');

  useEffect(() => {
    const numAge = parseInt(age);
    if (numAge >= 4 && numAge <= 18) {
      setAgeGroup(getAgeGroupByAge(numAge));
    } else {
      setAgeGroup(null);
    }
  }, [age]);

  // ─── EFFECT HANDLING SUBJECT LOADING DYNAMICALLY FROM NURSERY TO CLASS 10 ───
  useEffect(() => {
    if (!selectedClass) { 
      setSubjects([]); 
      setSelectedSubject(''); 
      return; 
    }
    
    setSelectedSubject('');
    
    if (DYNAMIC_SUBJECTS_BY_CLASS[selectedClass]) {
      setSubjects(DYNAMIC_SUBJECTS_BY_CLASS[selectedClass]);
    } else {
      setSubjects(getSubjectsForClass(selectedClass));
    }
  }, [selectedClass]);

  const handleStart = () => {
    if (!ageGroup || !selectedClass) return;
    if (mode === 'subject' && !selectedSubject) return;

    resetQuestionTracker();

    if (mode === 'subject') {
      const games = selectGamesForStudent(ageGroup.id, selectedSubject);
      onStart(games, ageGroup, selectedSubject, selectedClass, 'subject');
    } else {
      const games = selectGamesForGeneric(ageGroup.id);
      onStart(games, ageGroup, 'General', selectedClass, 'generic');
    }
  };

  const validAge = parseInt(age) >= 4 && parseInt(age) <= 18;
  const canStart = validAge && selectedClass && ageGroup && (mode === 'generic' || selectedSubject);

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
          Games are personalized based on your age, class & preferences
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

      {/* Age Input */}
      <div className="space-y-3">
        <label className="text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2" style={{ color: "rgba(241,245,249,0.4)" }}>
          <User className="h-4 w-4" /> Enter Your Age
        </label>
        <div className="flex items-center justify-center gap-3">
          <div className="relative">
            <input
              type="number"
              min={4}
              max={18}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="e.g. 13"
              className="w-32 text-center text-2xl font-black py-3 px-4 rounded-2xl outline-none transition-all duration-200 focus:scale-105"
              style={{
                background: "rgba(255,255,255,0.08)",
                border: `2px solid ${validAge ? "rgba(99,102,241,0.6)" : age ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.15)"}`,
                color: "#F1F5F9",
                caretColor: "#6366F1",
              }}
            />
          </div>
          <span className="text-sm font-medium" style={{ color: "rgba(241,245,249,0.4)" }}>years</span>
        </div>
        {age && !validAge && (
          <p className="text-xs animate-fade-in" style={{ color: "#EF4444" }}>
            Please enter an age between 4 and 18
          </p>
        )}
      </div>

      {/* Age Group Badge */}
      {ageGroup && validAge && (
        <div className="flex items-center justify-center gap-3 py-3 px-6 rounded-2xl mx-auto w-fit animate-fade-in"
          style={{ background: `${ageGroup.color}15`, border: `1px solid ${ageGroup.color}30` }}>
          <span className="text-2xl">{ageGroup.emoji}</span>
          <div className="text-left">
            <p className="text-sm font-bold" style={{ color: ageGroup.color }}>{ageGroup.label}</p>
            <p className="text-xs" style={{ color: "rgba(241,245,249,0.5)" }}>{ageGroup.description} · Age {ageGroup.ageRange[0]}-{ageGroup.ageRange[1]}</p>
          </div>
        </div>
      )}

      {/* Class Selection */}
      {validAge && (
        <div className="space-y-3 animate-fade-in">
          <label className="text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2" style={{ color: "rgba(241,245,249,0.4)" }}>
            <GraduationCap className="h-4 w-4" /> Select Your Class
          </label>
          <div className="flex flex-wrap gap-2 justify-center">
            {CLASS_OPTIONS.map(cls => (
              <button key={cls.value} onClick={() => setSelectedClass(cls.value)}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all duration-200 hover:scale-105 ${selectedClass === cls.value ? 'scale-105' : ''}`}
                style={{
                  background: selectedClass === cls.value ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${selectedClass === cls.value ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.1)"}`,
                  color: selectedClass === cls.value ? "#818CF8" : "rgba(241,245,249,0.6)",
                }}>
                {cls.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Subject Selection — only in subject mode */}
      {mode === 'subject' && validAge && selectedClass && (
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
      {mode === 'generic' && validAge && selectedClass && (
        <div className="animate-fade-in rounded-2xl p-4 mx-auto max-w-md"
          style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)" }}>
          <div className="flex items-start gap-3">
            <Brain className="h-5 w-5 mt-0.5 flex-shrink-0" style={{ color: "#7DD3FC" }} />
            <div className="text-left space-y-1">
              <p className="text-sm font-bold" style={{ color: "#7DD3FC" }}>Generic Brain Training</p>
              <p className="text-xs leading-relaxed" style={{ color: "rgba(241,245,249,0.5)" }}>
                Includes cognitive games (memory, logic, speed, verbal) and mixed-subject quizzes pulling questions from all your class subjects.
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