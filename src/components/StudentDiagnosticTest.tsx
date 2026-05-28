import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, ArrowRight, ArrowLeft, BookOpen, ClipboardList } from "lucide-react";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { getAgeGroupConfig } from "@/data/assessmentQuestions";

interface DiagnosticRequest {
  id: string;
  class_name: string;
  section: string;
  subject: string;
  questions: any[];
  approved_count: number | null;
  assigned_at: string | null;
}

/** Assessment-style question from the question bank */
interface AssessmentQuestion {
  id: number;
  text: string;
  category: string;
  modality?: string;
}

/** Map class to age group for fetching rating options */
function getAgeGroupForClass(className: string): number {
  const lower = className.toLowerCase().trim();
  if (["nursery", "lkg", "ukg"].includes(lower)) return 3;
  const num = parseInt(lower.replace(/\D/g, ""));
  if (!isNaN(num)) {
    if (num <= 4) return 5;
    if (num <= 9) return 10;
    return 15;
  }
  return 5;
}

const RATING_OPTIONS = [
  { label: "Always", emoji: "😊", value: 4 },
  { label: "Sometimes", emoji: "🙂", value: 3 },
  { label: "Rarely", emoji: "😐", value: 2 },
  { label: "Never", emoji: "😶", value: 1 },
  { label: "Not yet observed", emoji: "🤷", value: 0 },
];

export const StudentDiagnosticTest = () => {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [activeTest, setActiveTest] = useState<DiagnosticRequest | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const { data: availableTests, isLoading } = useQuery({
    queryKey: ["student-diagnostic-tests", user?.id],
    queryFn: async () => {
      const { data: requests, error } = await supabase
        .from("diagnostic_requests")
        .select("id, class_name, section, subject, questions, approved_count, assigned_at")
        .eq("status", "assigned")
        .not("questions", "is", null);

      if (error) throw error;

      // Get already submitted tests
      const { data: submissions } = await supabase
        .from("diagnostic_submissions")
        .select("request_id")
        .eq("student_id", user!.id);

      const submittedIds = new Set((submissions || []).map((s: any) => s.request_id));

      return ((requests || []) as DiagnosticRequest[]).filter(
        r => !submittedIds.has(r.id) && r.questions && r.questions.length > 0
      );
    },
    enabled: !!user?.id,
  });

  const handleStartTest = (test: DiagnosticRequest) => {
    setActiveTest(test);
    setCurrentQ(0);
    setAnswers({});
    setShowResults(false);
  };

  const handleAnswer = (questionIdx: number, value: number) => {
    setAnswers(prev => ({ ...prev, [questionIdx]: value }));
  };

  const handleSubmit = async () => {
    if (!activeTest || !user) return;
    setSubmitting(true);

    try {
      const questions = activeTest.questions as AssessmentQuestion[];
      const totalScore = Object.values(answers).reduce((sum, v) => sum + v, 0);
      const maxPossible = questions.length * 4;

      const { error } = await supabase.from("diagnostic_submissions").insert({
        request_id: activeTest.id,
        student_id: user.id,
        answers: answers,
        score: totalScore,
        total_questions: questions.length,
      } as any);

      if (error) throw error;

      setShowResults(true);
      toast.success("Diagnostic assessment submitted successfully!");
      queryClient.invalidateQueries({ queryKey: ["student-diagnostic-tests"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to submit assessment");
    } finally {
      setSubmitting(false);
    }
  };

  // Results view
  if (showResults && activeTest) {
    const questions = activeTest.questions as AssessmentQuestion[];
    const totalScore = Object.values(answers).reduce((sum, v) => sum + v, 0);
    const maxPossible = questions.length * 4;
    const percentage = Math.round((totalScore / maxPossible) * 100);

    // Group by category
    const categoryScores: Record<string, { total: number; max: number; count: number }> = {};
    questions.forEach((q, idx) => {
      if (!categoryScores[q.category]) categoryScores[q.category] = { total: 0, max: 0, count: 0 };
      categoryScores[q.category].total += answers[idx] ?? 0;
      categoryScores[q.category].max += 4;
      categoryScores[q.category].count++;
    });

    return (
      <div className="space-y-6">
        <Card className="max-w-lg mx-auto">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
            <h2 className="text-2xl font-bold text-foreground mb-2">Assessment Complete!</h2>
            <p className="text-muted-foreground mb-4">
              {activeTest.subject} — {activeTest.class_name} {activeTest.section}
            </p>
            <div className="text-4xl font-bold text-primary mb-2">
              {totalScore}/{maxPossible}
            </div>
            <Badge variant={percentage >= 70 ? "default" : percentage >= 40 ? "secondary" : "destructive"}>
              {percentage}%
            </Badge>
            <Button className="mt-6" onClick={() => { setActiveTest(null); setShowResults(false); }}>
              Back to Diagnostics
            </Button>
          </CardContent>
        </Card>

        {/* Category breakdown */}
        <Card>
          <CardContent className="p-6 space-y-3">
            <h3 className="font-semibold text-foreground mb-2">Category Breakdown</h3>
            {Object.entries(categoryScores).map(([cat, data]) => {
              const pct = Math.round((data.total / data.max) * 100);
              return (
                <div key={cat} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground">{cat}</span>
                    <span className="font-medium text-foreground">{data.total}/{data.max} ({pct}%)</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Active test - assessment view
  if (activeTest) {
    const questions = activeTest.questions as AssessmentQuestion[];
    const totalQuestions = questions.length;
    const question = questions[currentQ];
    const answeredCount = Object.keys(answers).length;
    const progress = Math.round((answeredCount / totalQuestions) * 100);
    const isLastQuestion = currentQ === totalQuestions - 1;
    const allAnswered = answeredCount === totalQuestions;

    // Get appropriate rating options
    const ageGroup = getAgeGroupForClass(activeTest.class_name);
    const config = getAgeGroupConfig(ageGroup);
    const options = config?.options || RATING_OPTIONS;

    return (
      <div className="w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Diagnostic Assessment</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {activeTest.subject} — {activeTest.class_name} {activeTest.section} · {answeredCount} of {totalQuestions} answered
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">{progress}%</span>
            <div className="w-32">
              <Progress value={progress} className="h-2" />
            </div>
          </div>
        </div>

        {/* Category badge */}
        {question.category && (
          <Badge variant="outline" className="mb-4">{question.category}</Badge>
        )}

        <div className="flex gap-6">
          {/* Question area */}
          <div className="flex-1 min-w-0">
            <Card className="mb-5 shadow-sm">
              <CardContent className="p-6 sm:p-8">
                <div className="animate-fade-in" key={currentQ}>
                  <div className="flex gap-3 mb-8">
                    <span className="inline-flex items-center justify-center h-8 w-8 min-w-[2rem] rounded-full bg-accent text-accent-foreground text-sm font-bold">
                      {currentQ + 1}
                    </span>
                    <p className="text-base sm:text-lg font-medium text-foreground leading-relaxed pt-0.5">
                      {question.text}
                    </p>
                  </div>
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {options.map((opt) => {
                      const selected = answers[currentQ] === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => {
                            handleAnswer(currentQ, opt.value);
                            if (!isLastQuestion) {
                              setTimeout(() => setCurrentQ(q => q + 1), 350);
                            }
                          }}
                          className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition-all ${
                            selected
                              ? "border-accent bg-accent/10 text-accent shadow-sm"
                              : "border-border bg-card text-foreground hover:border-accent/40 hover:bg-muted/50"
                          }`}
                        >
                          <span className="text-lg">{opt.emoji}</span>
                          <span>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Navigation */}
            <div className="flex justify-between items-center">
              <Button
                variant="outline"
                onClick={() => setCurrentQ(q => Math.max(0, q - 1))}
                disabled={currentQ === 0}
              >
                <ArrowLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <div className="flex gap-2">
                {!isLastQuestion && answers[currentQ] !== undefined && (
                  <Button onClick={() => setCurrentQ(q => q + 1)}>
                    Next <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
                {isLastQuestion && answers[currentQ] !== undefined && (
                  <div className="flex flex-col items-end gap-1">
                    <Button onClick={handleSubmit} disabled={submitting || !allAnswered}>
                      {submitting ? "Submitting..." : "Submit Assessment"} <CheckCircle className="h-4 w-4 ml-1" />
                    </Button>
                    {!allAnswered && (
                      <span className="text-xs text-destructive">
                        {totalQuestions - answeredCount} question{totalQuestions - answeredCount > 1 ? "s" : ""} unanswered
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Navigator */}
          <div className="hidden lg:block w-[220px] shrink-0">
            <Card className="sticky top-4">
              <CardContent className="p-4">
                <p className="text-xs font-semibold text-foreground mb-3">Questions</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {questions.map((_, idx) => {
                    const isCurrent = idx === currentQ;
                    const answered = answers[idx] !== undefined;
                    return (
                      <button
                        key={idx}
                        onClick={() => setCurrentQ(idx)}
                        className={`h-8 w-8 rounded-full text-xs font-medium transition-all flex items-center justify-center ${
                          isCurrent
                            ? "ring-2 ring-accent ring-offset-1 ring-offset-card bg-card text-foreground font-bold"
                            : answered
                            ? "bg-accent text-accent-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"
                        }`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // List view
  if (isLoading) {
    return <div className="flex justify-center py-12"><LoadingSpinner /></div>;
  }

  if (!availableTests || availableTests.length === 0) {
    return (
      <Card className="max-w-lg mx-auto border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-14 text-center">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-5">
            <ClipboardList className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">No tests assigned yet</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            Your teacher will assign tests soon. You'll see them here when they're ready.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {availableTests.map(test => (
          <Card key={test.id} className="hover:shadow-md transition-shadow border-border/60">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground truncate">{test.subject}</h3>
                  <p className="text-sm text-muted-foreground">
                    {test.class_name} · Section {test.section}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-5">
                <span>{test.questions.length} questions</span>
                <span>{test.assigned_at ? new Date(test.assigned_at).toLocaleDateString() : ""}</span>
              </div>
              <Button className="w-full gap-2" size="lg" onClick={() => handleStartTest(test)}>
                Start Test
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
