import { useEffect, useState } from "react";
import { Brain, BookOpen, PenTool, Sparkles, Trophy } from "lucide-react";

const STUDY_TIPS = [
  "Tip: Read each question twice — it helps you catch tricky wording.",
  "Did you know? Short breaks between tests boost memory retention.",
  "Tip: Eliminate the obviously wrong options first to sharpen your odds.",
  "Fun fact: Explaining an answer out loud helps it stick longer.",
  "Tip: Stay calm — a relaxed mind recalls facts faster.",
];

interface AcademicQuizLoaderProps {
  subject?: string;
  questionCount?: number;
}

const AcademicQuizLoader = ({ subject, questionCount }: AcademicQuizLoaderProps) => {
  const [tipIndex, setTipIndex] = useState(0);
  const [progress, setProgress] = useState(6);

  useEffect(() => {
    const tipTimer = setInterval(() => {
      setTipIndex((i) => (i + 1) % STUDY_TIPS.length);
    }, 3800);
    const progressTimer = setInterval(() => {
      setProgress((p) => (p >= 90 ? 90 : p + Math.random() * 4));
    }, 700);
    return () => {
      clearInterval(tipTimer);
      clearInterval(progressTimer);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-blue-500 via-blue-400 to-cyan-400 overflow-hidden px-4">
      <style>{`
        @keyframes academic-float-up {
          0% { transform: translateY(20px) rotate(-6deg); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translateY(-140vh) rotate(10deg); opacity: 0; }
        }
        @keyframes academic-orbit {
          from { transform: rotate(0deg) translateX(var(--orbit-radius, 70px)) rotate(0deg); }
          to { transform: rotate(360deg) translateX(var(--orbit-radius, 70px)) rotate(-360deg); }
        }
        @keyframes academic-pop {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        @keyframes academic-fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Floating background symbols */}
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className="absolute text-white/30 select-none pointer-events-none hidden sm:inline"
          style={{
            left: `${(i * 9.7) % 100}%`,
            bottom: "-40px",
            fontSize: `${16 + (i % 4) * 8}px`,
            animation: `academic-float-up ${11 + (i % 5) * 1.5}s linear infinite`,
            animationDelay: `${i * 1.1}s`,
          }}
        >
          {["✎", "?", "∑", "✓", "★"][i % 5]}
        </span>
      ))}

      {/* Central animation: brain with orbiting subject icons */}
      <div className="relative h-28 w-28 sm:h-36 sm:w-36 md:h-40 md:w-40 flex items-center justify-center mb-6 sm:mb-8">
        <div className="absolute inset-0 rounded-full bg-white/20 animate-ping" />
        <div
          className="h-16 w-16 sm:h-20 sm:w-20 md:h-24 md:w-24 rounded-full bg-white flex items-center justify-center shadow-2xl"
          style={{ animation: "academic-pop 2.6s ease-in-out infinite" }}
        >
          <Brain className="h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 text-blue-600" />
        </div>

        {[BookOpen, PenTool, Sparkles, Trophy].map((Icon, i) => (
          <div
            key={i}
            className="absolute h-7 w-7 sm:h-8 sm:w-8 md:h-9 md:w-9 rounded-full bg-white shadow-lg flex items-center justify-center"
            style={{
              // radius scales down on narrow screens so orbit stays inside the circle
              ["--orbit-radius" as any]: "clamp(46px, 16vw, 70px)",
              animation: `academic-orbit ${9 + i * 2}s linear infinite`,
              animationDelay: `${i * 0.6}s`,
            }}
          >
            <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-600" />
          </div>
        ))}
      </div>

      <h2 className="text-xl sm:text-2xl font-bold text-white mb-1 text-center px-2">
        Preparing your {subject ? `${subject} ` : ""}test...
      </h2>
      <p className="text-white/80 text-sm mb-6 text-center px-2">
        {questionCount ? `Crafting ${questionCount} questions just for you` : "Crafting your questions"}
      </p>

      {/* Progress bar */}
      <div className="w-full max-w-[280px] sm:max-w-xs h-2.5 rounded-full bg-white/25 overflow-hidden mb-6">
        <div
          className="h-full rounded-full bg-white transition-all duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Rotating study tip */}
      <div className="w-full max-w-sm text-center px-4 min-h-[2.5rem]">
        <p
          key={tipIndex}
          className="text-white/90 text-sm italic"
          style={{ animation: "academic-fade-in 0.5s ease-out" }}
        >
          {STUDY_TIPS[tipIndex]}
        </p>
      </div>
    </div>
  );
};

export default AcademicQuizLoader;
