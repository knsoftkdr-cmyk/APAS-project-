import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import academictests from "@/assets/academictests-banner.png";
import boyTeacher from "@/assets/BoyTeacher-guide.png";
import {
  School,
  Users,
  FileText,
  HelpCircle,
  Flame
} from "lucide-react";
import {
  BookOpen, CheckCircle2, XCircle, ChevronRight, Trophy, Clock, RotateCcw,
  GraduationCap, Sparkles, ArrowRight, Loader2, History, Target, Award,
  Timer, Eye, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TestAnalysis } from "@/components/TestAnalysis";

const CLASS_OPTIONS = [
  { value: "nursery", label: "Nursery" },
  { value: "lkg", label: "LKG" },
  { value: "ukg", label: "UKG" },
  ...Array.from({ length: 10 }, (_, i) => ({ value: `${i + 1}`, label: `Class ${i + 1}` })),
];

const SECTION_OPTIONS = ["A", "B", "C", "D", "E"];

// Map class value to storage folder name
const getClassFolder = (classValue: string): string => {
  const folderMap: Record<string, string> = { nursery: "nursery", lkg: "lkg", ukg: "ukg" };
  for (let i = 1; i <= 10; i++) folderMap[`${i}`] = `class ${i}`;
  return folderMap[classValue] || classValue;
};

const QUESTION_TYPE_OPTIONS = [
  { value: "mcq", label: "Multiple Choice (MCQ)" },
  { value: "true_false", label: "True / False" },
  { value: "fill_blank", label: "Fill in the Blank" },
  { value: "recall", label: "Recall / Knowledge" },
  { value: "understanding", label: "Understanding / Comprehension" },
  { value: "application", label: "Application Based" },
  { value: "analysis", label: "Analysis" },
  { value: "evaluation", label: "Evaluation" },
  { value: "creation", label: "Creation / Synthesis" },
  { value: "hots", label: "Higher-Order Thinking (HOTS)" },
  { value: "diagnostic", label: "Diagnostic" },
  { value: "formative", label: "Formative Assessment" },
  { value: "summative", label: "Summative" },
  { value: "open_ended", label: "Open-Ended" },
  { value: "closed_ended", label: "Closed-Ended" },
  { value: "probing", label: "Probing" },
  { value: "reflective", label: "Reflective" },
  { value: "real_world", label: "Real-World Connection" },
];

const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "mixed", label: "Mixed" },
];

const NUM_QUESTIONS_OPTIONS = [5, 10, 15, 20, 25, 30];

interface MCQQuestion {
  id: number;
  question: string;
  options: Record<string, string>;
  correct: string;
  explanation: string;
}

type Phase = "select" | "loading" | "test" | "result" | "review";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function AcademicTests() {
  const { user, profile } = useAuth();
  const [phase, setPhase] = useState<Phase>("select");
  const [studentClass, setStudentClass] = useState("");
  const [section, setSection] = useState("");
  const [subject, setSubject] = useState("");
  const [numQuestions, setNumQuestions] = useState(10);
  const [questionType, setQuestionType] = useState("mcq");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [questions, setQuestions] = useState<MCQQuestion[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [score, setScore] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [reviewTest, setReviewTest] = useState<any>(null);

  // Auto-populate student's class and section from profile on component mount
  useEffect(() => {
    if (profile?.class_grade && !studentClass) {
      setStudentClass(profile.class_grade);
    }
    if (profile?.section && !section) {
      setSection(profile.section);
    }
  }, [profile?.class_grade, profile?.section]);

  // Live timer
  useEffect(() => {
    if (!timerActive) return;
    const interval = setInterval(() => {
      setElapsedTime((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [timerActive]);

  // Fetch subjects dynamically from TextBooks storage based on selected class
  const { data: subjectOptions, isLoading: loadingSubjects } = useQuery({
    queryKey: ["class-subjects-storage", studentClass],
    queryFn: async () => {
      if (!studentClass) return [];
      const folder = getClassFolder(studentClass);

      const { data: files, error } = await supabase.storage
        .from("TextBooks")
        .list(folder);

      if (error || !files) return [];

      // Extract unique subjects from filenames
      const subjects = Array.from(
        new Map(
          files
            .filter((f) => f.name.endsWith(".pdf"))
            .map<[string, string]>((f) => {
              const nameWithoutExt = f.name.replace(/\.pdf$/i, "");
              const subject = nameWithoutExt.split(/[\s_]/)[0];
              const cleanSubject = subject.charAt(0).toUpperCase() + subject.slice(1).toLowerCase();
              return [cleanSubject.toLowerCase(), cleanSubject];
            }),
        ).values(),
      ).sort();

      return subjects;
    },
    enabled: !!studentClass,
  });

  // Reset subject when class changes
  const handleClassChange = (val: string) => {
    setStudentClass(val);
    setSubject("");
  };

  // Fetch past tests
  const { data: pastTests, refetch: refetchTests } = useQuery({
    queryKey: ["academic-tests", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_tests")
        .select("*")
        .eq("student_id", user!.id)
        .order("completed_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const handleStartTest = async () => {
    if (!studentClass || !subject) {
      toast.error("Please select class and subject");
      return;
    }
    setPhase("loading");
    try {
      const { data, error } = await supabase.functions.invoke("generate-mcqs", {
        body: { studentClass, section, subject, numQuestions, questionType, topic: topic || undefined, difficulty },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setQuestions(data.questions);
      setCurrentQ(0);
      setAnswers({});
      setSelectedOption(null);
      setShowAnswer(false);
      setScore(0);
      setElapsedTime(0);
      setTimerActive(true);
      setPhase("test");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate questions");
      setPhase("select");
    }
  };

  const handleSelectOption = (option: string) => {
    if (showAnswer) return;
    setSelectedOption(option);
  };

  const handleConfirm = () => {
    if (!selectedOption) return;
    const isCorrect = selectedOption === questions[currentQ].correct;
    if (isCorrect) setScore((s) => s + 1);
    setAnswers((prev) => ({ ...prev, [currentQ]: selectedOption }));
    setShowAnswer(true);
  };

  const handleNext = async () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ((q) => q + 1);
      setSelectedOption(null);
      setShowAnswer(false);
    } else {
      // Test complete
      setTimerActive(false);

      try {
        await supabase.from("academic_tests").insert({
          student_id: user!.id,
          student_class: studentClass,
          section: section || null,
          subject,
          questions: questions as any,
          answers: answers as any,
          score,
          total_questions: questions.length,
        });
        refetchTests();
      } catch (err) {
        console.error("Failed to save test:", err);
      }
      setPhase("result");
    }
  };

  const handleReset = () => {
    setPhase("select");
    setQuestions([]);
    setAnswers({});
    setSelectedOption(null);
    setShowAnswer(false);
    setScore(0);
    setCurrentQ(0);
    setTimerActive(false);
    setElapsedTime(0);
    setReviewTest(null);
  };

  const handleOpenReview = (test: any) => {
    setReviewTest(test);
    setPhase("review");
  };

  const getOptionStyle = (key: string) => {
    if (!showAnswer) {
      return selectedOption === key
        ? "border-primary bg-primary/10 ring-2 ring-primary/30"
        : "border-border hover:border-primary/50 hover:bg-accent/50";
    }
    if (key === questions[currentQ].correct) return "border-emerald-500 bg-emerald-50 text-emerald-800";
    if (key === selectedOption && key !== questions[currentQ].correct)
      return "border-red-500 bg-red-50 text-red-800";
    return "border-border opacity-50";
  };

  const progressPercent = questions.length > 0 ? ((currentQ + (showAnswer ? 1 : 0)) / questions.length) * 100 : 0;
const subjectColors: Record<string, string> = {
  Math: "bg-blue-500 text-white",
  Science: "bg-green-500 text-white",
  English: "bg-purple-500 text-white",
  Social: "bg-orange-500 text-white",
  Telugu: "bg-pink-500 text-white",
  Hindi: "bg-red-500 text-white",
  Computer: "bg-cyan-500 text-white",
  Physics: "bg-indigo-500 text-white",
  Chemistry: "bg-emerald-500 text-white",
  Biology: "bg-lime-500 text-white",
};
  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-blue-400 via-blue-0 to-blue-400 p-8 relative min-h-[220px]">
<div className="hidden md:block">
          <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/60"></div>
          <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/80"></div>
          <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>


          <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
          <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
          <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>
          
          <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
          <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
          <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
          <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

          <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

          <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

          <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>
</div>

  <div className="max-w-xl">
    <h1 className="text-5xl font-bold text-slate-900">
      Academic Tests
    </h1>

    <p className="mt-3 text-slate-700 text-lg">
      Test your knowledge with AI-generated questions
    </p>
  </div>

  <img
    src={academictests}
    alt="Academic tests Banner"
    /* className="absolute right-10 bottom-5 h-[150px]" */
    className="hidden md:block absolute right-10 bottom-6 w-40"
  />
</div>

      {/* ─── SELECT PHASE ─── */}
      {phase === "select" && (
        <div className="space-y-6 animate-fade-in">
          <Card className="relative border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5 overflow-visible">
          <img
  src={boyTeacher}
  alt="Teacher Guide"
  className="hidden lg:block absolute right-[70px] bottom-0 h-[500px] w-auto z-20 drop-shadow-2xl"
/>
            <CardHeader className="text-center pb-2">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 shadow-lg">
                <GraduationCap className="h-8 w-8 text-primary-foreground" />
              </div>
              <CardTitle className="text-xl">Start a New Test</CardTitle>
              <p className="text-sm text-muted-foreground">Configure your test settings and begin</p>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md mx-auto">
              {/* Class */}
            <div className="flex gap-3 items-start">

              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center shrink-0 mt-7">
                <School className="w-6 h-6 text-blue-600" />
              </div>

              <div className="flex-1 space-y-2">

                <label className="text-sm font-medium">
                  Class <span className="text-red-500">*</span>
                </label>
                <Select value={studentClass} onValueChange={handleClassChange} disabled={!!profile?.class_grade}>
                  <SelectTrigger className={!!profile?.class_grade ? "bg-muted cursor-not-allowed" : ""}><SelectValue placeholder="Select Class" /></SelectTrigger>
                  <SelectContent>
                    {CLASS_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

              {/* Section */}
<div className="flex gap-3 items-start">

  <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center shrink-0 mt-7">
    <Users className="w-6 h-6 text-orange-600" />
  </div>

  <div className="flex-1 space-y-2">
    <label className="text-sm font-medium">
      Section
    </label>
                <Select value={section} onValueChange={setSection} disabled={!!profile?.section}>
                  <SelectTrigger className={!!profile?.section ? "bg-muted cursor-not-allowed" : ""}><SelectValue placeholder="Select Section (Optional)" /></SelectTrigger>
                  <SelectContent>
                    {SECTION_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>Section {s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

              {/* Subject */}
            <div className="flex gap-3 items-start">

              <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center shrink-0 mt-7">
                <BookOpen className="w-6 h-6 text-green-600" />
              </div>

              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium">
                  Subject <span className="text-red-500">*</span>
                </label>
                <Select value={subject} onValueChange={setSubject} disabled={!studentClass || loadingSubjects}>
                  <SelectTrigger>
                    <SelectValue placeholder={
                      !studentClass ? "Select a class first" :
                      loadingSubjects ? "Loading subjects..." :
                      "Select Subject"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {(subjectOptions || []).map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                    {subjectOptions && subjectOptions.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No subjects available for this class</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

              {/* Topic */}
            <div className="flex gap-3 items-start">

              <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center shrink-0 mt-7">
                <FileText className="w-6 h-6 text-purple-600" />
              </div>

              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium">
                  Topic
                </label>
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Photosynthesis, Fractions (Optional)"
                />
              </div>
              </div>

              {/* Number of Questions */}
            <div className="flex gap-3 items-start">
              <div className="w-12 h-12 rounded-xl bg-pink-100 flex items-center justify-center shrink-0 mt-7">
                <HelpCircle className="w-6 h-6 text-pink-600" />
              </div>
              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium">
                  Number of Questions
                </label>
                <Select value={String(numQuestions)} onValueChange={(v) => setNumQuestions(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {NUM_QUESTIONS_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} Questions</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
              {/* Type of Questions */}
            <div className="flex gap-3 items-start">
              <div className="w-12 h-12 rounded-xl bg-cyan-100 flex items-center justify-center shrink-0 mt-7">
                <Target className="w-6 h-6 text-cyan-600" />
              </div>
              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium">
                  Type of Questions
                </label>
                <Select value={questionType} onValueChange={setQuestionType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {QUESTION_TYPE_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
              {/* Difficulty */}
            <div className="flex gap-3 items-start">
              <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center shrink-0 mt-7">
                <Flame className="w-6 h-6 text-red-600" />
              </div>
              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium">
                  Level of Difficulty
                </label>
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIFFICULTY_OPTIONS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
              <Button onClick={handleStartTest} className="flex-shrink-0 bg-blue-500 hover:bg-blue-700 text-white" size="lg" disabled={!studentClass || !subject}>
                <Sparkles className="h-4 w-4" /> Generate & Start Test
              </Button>
            </CardContent>
          </Card>

          {/* Past Tests */}
          {pastTests && pastTests.length > 0 && (
            <div>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" /> Recent Tests
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {pastTests.map((test: any) => (
<Card
  key={test.id}
  className={`cursor-pointer border-0 bg-gradient-to-br ${subjectColors[test.subject] || "from-blue-50 to-green-50"} hover:shadow-xl hover:-translate-y-1 transition-all duration-300`}
  onClick={() => handleOpenReview(test)}
>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="secondary" className="text-xs">{test.subject}</Badge>
                        <span className="text-s text-white text-muted-foreground">
                          {new Date(test.completed_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white text-muted-foreground">
                          {CLASS_OPTIONS.find(c => c.value === test.student_class)?.label || test.student_class}
                          {test.section ? ` - ${test.section}` : ""}
                        </span>
                        <div className="flex items-center gap-1">
                          <Target className="h-3.5 w-3.5 text-white text-primary" />
                          <span className={cn("text-sm font-bold",
                            test.score >= 7 ? "text-emerald-400" : test.score >= 4 ? "text-amber-400" : "text-red-400"
                          )}>
                            {test.score}/{test.total_questions}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 mt-2">
                        <Eye className="h-4 w-4 text-white text-muted-foreground" />
                        <span className="text-xs text-muted-foreground text-white">Click to review answers</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── LOADING PHASE ─── */}
      {phase === "loading" && (
        <Card className="animate-fade-in">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="relative mb-6">
              <div className="h-20 w-20 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
              <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 text-primary animate-pulse" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Generating Your Questions...</h3>
            <p className="text-sm text-muted-foreground">
              AI is crafting {numQuestions} {QUESTION_TYPE_OPTIONS.find(t => t.value === questionType)?.label} questions
              {topic ? ` on "${topic}"` : ""} for {CLASS_OPTIONS.find(c => c.value === studentClass)?.label} - {subject}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ─── TEST PHASE ─── */}
      {phase === "test" && questions.length > 0 && (
        <div className="space-y-4 animate-fade-in">
          {/* Progress bar + Timer */}
          <div className="flex items-center gap-3">
            <Progress value={progressPercent} className="flex-1 h-3 [&>div]:bg-primary" />
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              {currentQ + 1}/{questions.length}
            </span>
          </div>

          {/* Score + Timer indicator */}
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="gap-1">
              <Trophy className="h-3 w-3 text-amber-500" /> Score: {score}
            </Badge>
            <Badge variant="outline" className="gap-1.5 font-mono text-sm">
              <Timer className="h-3.5 w-3.5 text-primary" /> {formatTime(elapsedTime)}
            </Badge>
          </div>

          {/* Question card */}
          <Card className="border-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base leading-relaxed">
                <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-sm font-bold mr-2">
                  {currentQ + 1}
                </span>
                {questions[currentQ].question}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(questions[currentQ].options).map(([key, value]) => (
                <button
                  key={key}
                  onClick={() => handleSelectOption(key)}
                  disabled={showAnswer}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all duration-200",
                    getOptionStyle(key)
                  )}
                >
                  <span className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-colors",
                    showAnswer && key === questions[currentQ].correct
                      ? "bg-emerald-500 text-white"
                      : showAnswer && key === selectedOption
                        ? "bg-red-500 text-white"
                        : selectedOption === key
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                  )}>
                    {showAnswer && key === questions[currentQ].correct ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : showAnswer && key === selectedOption ? (
                      <XCircle className="h-5 w-5" />
                    ) : (
                      key
                    )}
                  </span>
                  <span className="text-sm">{value}</span>
                </button>
              ))}

              {/* Explanation */}
              {showAnswer && (
                <div className={cn(
                  "mt-4 rounded-lg p-3 text-sm animate-fade-in",
                  selectedOption === questions[currentQ].correct
                    ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                    : "bg-amber-50 border border-amber-200 text-amber-800"
                )}>
                  <p className="font-medium mb-1">
                    {selectedOption === questions[currentQ].correct ? "✅ Correct!" : "❌ Incorrect"}
                  </p>
                  <p>{questions[currentQ].explanation}</p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex justify-end gap-2 pt-2">
                {!showAnswer ? (
                  <Button onClick={handleConfirm} disabled={!selectedOption} className="flex-shrink-0 bg-blue-500 hover:bg-blue-700 text-white">
                    Confirm Answer <CheckCircle2 className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button onClick={handleNext} className="flex-shrink-0 bg-blue-500 hover:bg-blue-700 text-white">
                    {currentQ < questions.length - 1 ? (
                      <>Next Question <ChevronRight className="h-4 w-4" /></>
                    ) : (
                      <>View Results <Trophy className="h-4 w-4" /></>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── RESULT PHASE ─── */}
      {phase === "result" && (
        <div className="space-y-6 animate-fade-in">
          <Card className="border-2 overflow-hidden">
            <div className={cn(
              "p-8 text-center text-white",
              score >= Math.ceil(questions.length * 0.7) ? "bg-gradient-to-br from-emerald-500 to-emerald-700" :
              score >= Math.ceil(questions.length * 0.4) ? "bg-gradient-to-br from-amber-500 to-amber-700" :
              "bg-gradient-to-br from-red-500 to-red-700"
            )}>
              <Award className="h-16 w-16 mx-auto mb-3 drop-shadow-lg" />
              <h2 className="text-3xl font-bold mb-1">{score}/{questions.length}</h2>
              <p className="text-lg opacity-90">
                {score >= Math.ceil(questions.length * 0.8) ? "Outstanding!" :
                 score >= Math.ceil(questions.length * 0.6) ? "Great Job!" :
                 score >= Math.ceil(questions.length * 0.4) ? "Good Effort!" : "Keep Practicing!"}
              </p>
              <p className="text-sm opacity-75 mt-1">{subject} • {CLASS_OPTIONS.find(c => c.value === studentClass)?.label}</p>
            </div>
            <CardContent className="p-6">
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-600">
                    {Object.entries(answers).filter(([i, a]) => a === questions[Number(i)].correct).length}
                  </div>
                  <div className="text-xs text-muted-foreground">Correct</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-500">
                    {Object.entries(answers).filter(([i, a]) => a !== questions[Number(i)].correct).length}
                  </div>
                  <div className="text-xs text-muted-foreground">Wrong</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">
                    {Math.round((score / questions.length) * 100)}%
                  </div>
                  <div className="text-xs text-muted-foreground">Accuracy</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">
                    {formatTime(elapsedTime)}
                  </div>
                  <div className="text-xs text-muted-foreground">Time Taken</div>
                </div>
              </div>

              {/* Review answers */}
              <h3 className="font-semibold text-sm mb-3">Answer Review</h3>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {questions.map((q, i) => {
                  const isCorrect = answers[i] === q.correct;
                  return (
                    <div key={i} className={cn(
                      "rounded-lg border p-3 text-sm",
                      isCorrect ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50"
                    )}>
                      <div className="flex items-start gap-2">
                        {isCorrect ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                        )}
                        <div className="flex-1">
                          <p className="font-medium">{q.question}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Your answer: <span className={isCorrect ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>
                              {answers[i]} ({q.options[answers[i]]})
                            </span>
                            {!isCorrect && (
                              <> • Correct: <span className="text-emerald-600 font-medium">{q.correct} ({q.options[q.correct]})</span></>
                            )}
                          </p>
                          {q.explanation && (
                            <p className="text-xs text-muted-foreground mt-1 italic">💡 {q.explanation}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3 mt-6">
                <Button onClick={handleReset} variant="outline" className="flex-1 gap-2">
                  <RotateCcw className="h-4 w-4" /> Take Another Test
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* AI Performance Analysis */}
          <TestAnalysis
            subject={subject}
            studentClass={studentClass}
            topic={topic || undefined}
            questions={questions}
            answers={answers}
          />
        </div>
      )}

      {/* ─── REVIEW PHASE (Past Test Detail) ─── */}
      {phase === "review" && reviewTest && (
        <div className="space-y-6 animate-fade-in">
          <Button onClick={handleReset} variant="ghost" className="gap-2 mb-2">
            <ChevronDown className="h-4 w-4 rotate-90" /> Back to Tests
          </Button>

          <Card className="border-2 overflow-hidden">
            <div className={cn(
              "p-6 text-center text-white",
              reviewTest.score >= Math.ceil(reviewTest.total_questions * 0.7)
                ? "bg-gradient-to-br from-emerald-500 to-emerald-700"
                : reviewTest.score >= Math.ceil(reviewTest.total_questions * 0.4)
                  ? "bg-gradient-to-br from-amber-500 to-amber-700"
                  : "bg-gradient-to-br from-red-500 to-red-700"
            )}>
              <Award className="h-12 w-12 mx-auto mb-2 drop-shadow-lg" />
              <h2 className="text-2xl font-bold mb-1">{reviewTest.score}/{reviewTest.total_questions}</h2>
              <p className="text-sm opacity-90">
                {reviewTest.subject} • {CLASS_OPTIONS.find((c: any) => c.value === reviewTest.student_class)?.label || reviewTest.student_class}
                {reviewTest.section ? ` - ${reviewTest.section}` : ""}
              </p>
              <p className="text-xs opacity-75 mt-1">
                {new Date(reviewTest.completed_at).toLocaleString()}
              </p>
            </div>
            <CardContent className="p-6">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-600">{reviewTest.score}</div>
                  <div className="text-xs text-muted-foreground">Correct</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-500">{reviewTest.total_questions - reviewTest.score}</div>
                  <div className="text-xs text-muted-foreground">Wrong</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">
                    {Math.round((reviewTest.score / reviewTest.total_questions) * 100)}%
                  </div>
                  <div className="text-xs text-muted-foreground">Accuracy</div>
                </div>
              </div>

              <h3 className="font-semibold text-sm mb-3">Detailed Answer Review</h3>
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {(reviewTest.questions as MCQQuestion[]).map((q: MCQQuestion, i: number) => {
                  const studentAnswer = (reviewTest.answers as Record<string, string>)?.[String(i)];
                  const isCorrect = studentAnswer === q.correct;
                  return (
                    <div key={i} className={cn(
                      "rounded-lg border p-4 text-sm",
                      isCorrect ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50"
                    )}>
                      <div className="flex items-start gap-2">
                        {isCorrect ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                        )}
                        <div className="flex-1">
                          <p className="font-medium mb-2">
                            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-muted text-xs font-bold mr-1.5">
                              {i + 1}
                            </span>
                            {q.question}
                          </p>
                          {/* Show all options */}
                          <div className="grid gap-1 ml-1">
                            {Object.entries(q.options).map(([key, value]) => (
                              <div
                                key={key}
                                className={cn(
                                  "text-xs px-2 py-1 rounded",
                                  key === q.correct ? "bg-emerald-100 text-emerald-800 font-medium" :
                                  key === studentAnswer && key !== q.correct ? "bg-red-100 text-red-800 font-medium" :
                                  "text-muted-foreground"
                                )}
                              >
                                <span className="font-bold mr-1">{key}.</span> {value}
                                {key === q.correct && " ✓"}
                                {key === studentAnswer && key !== q.correct && " ✗ (your answer)"}
                                {key === studentAnswer && key === q.correct && " (your answer)"}
                              </div>
                            ))}
                          </div>
                          {q.explanation && (
                            <p className="text-xs text-muted-foreground mt-2 italic">💡 {q.explanation}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3 mt-6">
                <Button onClick={handleReset} variant="outline" className="flex-1 gap-2">
                  <RotateCcw className="h-4 w-4" /> Back to Tests
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* AI Performance Analysis for past test */}
          <TestAnalysis
            subject={reviewTest.subject}
            studentClass={reviewTest.student_class}
            questions={reviewTest.questions as any[]}
            answers={reviewTest.answers as Record<string, string>}
          />
        </div>
      )}
      </div>
    </AppLayout>
  );
}
