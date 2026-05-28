import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardCheck, CheckCircle, Clock, BookOpen, Send, Loader2, Award, Play, AlertCircle, ChevronRight, ChevronLeft, Home } from "lucide-react";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface HomeworkQuestion {
  question: string;
  index: number;
}

// Extract questions from exit ticket content
const extractQuestionsFromExitTicket = (exitTicketContent: string): string[] => {
  if (!exitTicketContent) return [];
  
  // Remove markdown headers and metadata lines
  let cleanContent = exitTicketContent
    .replace(/^###\s*Assessment[\s\S]*?\n/i, '')
    .replace(/^(📝\s*\d+\.\s*)?Assessment[^\n]*\n/i, '')
    .replace(/^(Format:|Collection Method:|Success Criteria:|Follow-up:)[^\n]*\n?/gim, '')
    .replace(/^(Format|Collection|Success|Follow).*$/gm, '')
    .trim();
  
  // Extract numbered questions (1. 2. 3. etc.)
  const questionPattern = /^\s*\d+\.\s*(.+?)(?=^\s*\d+\.|$)/gm;
  const questions: string[] = [];
  let match;
  
  while ((match = questionPattern.exec(cleanContent)) !== null) {
    const question = match[1].trim();
    if (question && question.length > 0) {
      questions.push(question);
    }
  }
  
  // If no numbered questions found, try to extract from bullet points
  if (questions.length === 0) {
    const bulletPattern = /^[-*]\s+(.+?)$/gm;
    while ((match = bulletPattern.exec(cleanContent)) !== null) {
      questions.push(match[1].trim());
    }
  }
  
  return questions;
};

const StudentHomework = () => {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, Record<number, string>>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  // Get student's class/section from student_assessments (same as Reports tab)
  const { data: studentClassInfo } = useQuery({
    queryKey: ["student-class-info", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      const { data } = await supabase
        .from("student_assessments")
        .select("student_class, section")
        .eq("submitted_by", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      console.log("StudentHomework: Found student class info:", data);
      return data || null;
    },
    enabled: !!user?.id,
  });

  const { data: assignments, isLoading } = useQuery({
    queryKey: ["student-homework", user?.id, studentClassInfo],
    queryFn: async () => {
      if (!studentClassInfo?.student_class || !studentClassInfo?.section) {
        console.log("StudentHomework: Missing class or section info");
        return [];
      }

      console.log("StudentHomework: Querying for assignments with:", {
        class_level: studentClassInfo.student_class,
        section: studentClassInfo.section,
      });

      // Normalize section to uppercase for matching
      const normalizedSection = (studentClassInfo.section || "").toUpperCase().trim();

      // Fetch homework matching the student's class/section
      const { data, error } = await supabase
        .from("homework_assignments")
        .select("*")
        .eq("class_level", studentClassInfo.student_class)
        .order("created_at", { ascending: false });
      
      if (error) {
        console.error("Error fetching assignments:", error);
        throw error;
      }

      // Filter by section (case-insensitive)
      const filtered = (data || []).filter(assignment => {
        const assignmentSection = (assignment.section || "").toUpperCase().trim();
        return assignmentSection === normalizedSection && assignment.assignment_type === "at-home";
      });

      console.log("StudentHomework: Found assignments after filtering:", filtered);
      return filtered;
    },
    enabled: !!user?.id && !!studentClassInfo?.student_class && !!studentClassInfo?.section,
  });

  const { data: submissions } = useQuery({
    queryKey: ["homework-submissions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homework_submissions")
        .select("*")
        .eq("student_id", user!.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const submittedIds = new Set((submissions || []).map((s: any) => s.assignment_id));

  // Homework Start View State
  type HomeworkView = "list" | "start";
  const [currentView, setCurrentView] = useState<HomeworkView>("list");
  const [activeHomeworkId, setActiveHomeworkId] = useState<string | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(5 * 60); // 5 minutes
  const [timerActive, setTimerActive] = useState(false);
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "submitted">("all");

  // Timer effect
  useEffect(() => {
    if (!timerActive || timerSeconds <= 0) {
      if (timerSeconds === 0 && timerActive) {
        // Auto-submit when timer reaches 0
        handleAutoSubmit();
      }
      return;
    }

    const interval = setInterval(() => {
      setTimerSeconds((prev) => {
        if (prev <= 1) {
          setTimerActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timerActive, timerSeconds]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getTimerColor = () => {
    if (timerSeconds > 120) return "text-green-600 dark:text-green-400";
    if (timerSeconds > 60) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const handleStartHomework = (assignmentId: string) => {
    setActiveHomeworkId(assignmentId);
    setCurrentView("start");
    setCurrentQuestionIndex(0);
    setTimerSeconds(5 * 60);
    setTimerActive(true);
    setAnswers((prev) => ({
      ...prev,
      [assignmentId]: prev[assignmentId] || {},
    }));
  };

  const handleAnswerChange = (assignmentId: string, qIndex: number, value: string) => {
    setAnswers((prev) => ({
      ...prev,
      [assignmentId]: { ...(prev[assignmentId] || {}), [qIndex]: value },
    }));
  };

  const handleAutoSubmit = async () => {
    if (!activeHomeworkId) return;
    await handleSubmit(activeHomeworkId, null);
  };

  const handleSubmit = async (assignmentId: string, questionsArray: HomeworkQuestion[] | null) => {
    const assignment = assignments?.find((a: any) => a.id === assignmentId);
    if (!assignment) return;

    if (!questionsArray) {
      const extractedQs = extractQuestionsFromExitTicket(assignment.exit_ticket_content);
      questionsArray = extractedQs.map((q, i) => ({
        question: q,
        index: i,
      }));
    }

    const myAnswers = answers[assignmentId] || {};
    const totalQuestions = questionsArray.length;
    const answeredQuestions = questionsArray.filter((_, i) => myAnswers[i]?.trim()).length;
    const submissionPercentage = totalQuestions > 0 
      ? Math.round((answeredQuestions / totalQuestions) * 100) 
      : 0;

    setSubmitting(assignmentId);
    setTimerActive(false);

    try {
      const answerArray = questionsArray.map((q, i) => ({
        question: q.question,
        answer: myAnswers[i] || "",
      }));

      const timestamp = new Date().toISOString();

      // Try update first; if no row exists, insert a new submission
      const { data: updated, error: updateError } = await supabase
        .from("homework_submissions")
        .update({
          answers: answerArray as any,
          submission_percentage: submissionPercentage,
          completed: true,
          submitted_at: timestamp,
          updated_at: timestamp,
          student_name: profile?.full_name || user?.email || "Student",
        })
        .eq("assignment_id", assignmentId)
        .eq("student_id", user!.id)
        .select("id");

      if (updateError) throw updateError;

      if (!updated || updated.length === 0) {
        const { error: insertError } = await supabase
          .from("homework_submissions")
          .insert([
            {
              assignment_id: assignmentId,
              student_id: user!.id,
              student_name: profile?.full_name || user?.email || "Student",
              answers: answerArray as any,
              submission_percentage: submissionPercentage,
              completed: true,
              assigned_at: timestamp,
              submitted_at: timestamp,
              updated_at: timestamp,
            },
          ] as any);

        if (insertError) throw insertError;
      }

      toast.success(`✓ Homework submitted!\n✓ Submission: ${submissionPercentage}%`);
      await queryClient.invalidateQueries({ queryKey: ["homework-submissions"] });
      setCurrentView("list");
      setActiveHomeworkId(null);
    } catch (e: any) {
      console.error("Homework submission error:", e);
      toast.error(e.message || "Failed to submit homework");
    } finally {
      setSubmitting(null);
    }
  };

  if (isLoading) return <LoadingSpinner />;

  if (!assignments || assignments.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <ClipboardCheck className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold text-foreground mb-2">No Homework Yet</h3>
          <p className="text-muted-foreground max-w-md">
            Your teacher hasn't assigned any homework yet. Check back later!
          </p>
        </CardContent>
      </Card>
    );
  }

  // ──────────────────────────────────────────────────────────────
  // HOMEWORK LIST VIEW
  // ──────────────────────────────────────────────────────────────
  if (currentView === "list") {
    const pendingCount = (assignments || []).filter((a: any) => !submittedIds.has(a.id)).length;
    const submittedCount = (assignments || []).filter((a: any) => submittedIds.has(a.id)).length;
    const filteredAssignments = (assignments || []).filter((a: any) => {
      if (statusFilter === "pending") return !submittedIds.has(a.id);
      if (statusFilter === "submitted") return submittedIds.has(a.id);
      return true;
    });

    return (
      <div className="space-y-4">
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all" className="gap-2">
              All <Badge variant="secondary" className="ml-1">{assignments.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="pending" className="gap-2">
              <Clock className="h-3.5 w-3.5" /> Pending
              <Badge variant="secondary" className="ml-1">{pendingCount}</Badge>
            </TabsTrigger>
            <TabsTrigger value="submitted" className="gap-2">
              <CheckCircle className="h-3.5 w-3.5" /> Submitted
              <Badge variant="secondary" className="ml-1">{submittedCount}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {filteredAssignments.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <ClipboardCheck className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                {statusFilter === "pending"
                  ? "Great! No pending homework."
                  : statusFilter === "submitted"
                  ? "You haven't submitted any homework yet."
                  : "No homework available."}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {filteredAssignments.map((assignment: any) => {
          let questionsArray: HomeworkQuestion[] = [];
          if (assignment.exit_ticket_content) {
            const extractedQs = extractQuestionsFromExitTicket(assignment.exit_ticket_content);
            questionsArray = extractedQs.map((q, i) => ({
              question: q,
              index: i,
            }));
          }

          const isSubmitted = submittedIds.has(assignment.id);
          const submission = (submissions || []).find((s: any) => s.assignment_id === assignment.id);

          return (
            <Card 
              key={assignment.id} 
              className={`border-2 transition-all ${isSubmitted ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10' : 'border-primary/10 hover:border-primary/30'}`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-primary" />
                      {assignment.period_title || assignment.title || "Homework"}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-2 space-y-1">
                      <div className="flex flex-wrap gap-2">
                        {assignment.subject && (
                          <Badge variant="secondary" className="text-xs">
                            {assignment.subject}
                          </Badge>
                        )}
                        {assignment.topic && (
                          <Badge variant="outline" className="text-xs">
                            {assignment.topic}
                          </Badge>
                        )}
                        {questionsArray.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {questionsArray.length} Questions
                          </Badge>
                        )}
                      </div>
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      {assignment.period_number && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Period {assignment.period_number}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(assignment.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {isSubmitted ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200 gap-1 whitespace-nowrap">
                      <CheckCircle className="h-3 w-3" /> Submitted
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 whitespace-nowrap">
                      <Clock className="h-3 w-3" /> Pending
                    </Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {isSubmitted ? (
                  <div className="space-y-3">
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Award className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        <h4 className="font-semibold text-emerald-900 dark:text-emerald-100">
                          Submission: {submission?.submission_percentage || 0}%
                        </h4>
                      </div>
                      <p className="text-sm text-emerald-800 dark:text-emerald-200">
                        Submitted on {new Date(submission?.submitted_at || submission?.updated_at || submission?.created_at).toLocaleString()}
                      </p>
                    </div>

                    {/* Teacher's review (score + feedback) */}
                    {(submission?.teacher_score != null || submission?.teacher_feedback) && (
                      <div className="p-4 bg-primary/5 border-2 border-primary/30 rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Award className="h-5 w-5 text-primary" />
                            <h4 className="font-semibold text-foreground">Teacher's Review</h4>
                          </div>
                          {submission?.teacher_score != null && (
                            <Badge className="bg-primary text-primary-foreground text-base px-3 py-1">
                              Score: {submission.teacher_score}/100
                            </Badge>
                          )}
                        </div>
                        {submission?.teacher_feedback && (
                          <div className="pt-2 border-t border-primary/20">
                            <p className="text-xs font-medium text-muted-foreground mb-1">Feedback:</p>
                            <p className="text-sm text-foreground whitespace-pre-wrap">{submission.teacher_feedback}</p>
                          </div>
                        )}
                        {submission?.evaluated_at && (
                          <p className="text-xs text-muted-foreground">
                            Reviewed on {new Date(submission.evaluated_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Show submitted answers */}
                    <div className="space-y-3">
                      {questionsArray.map((q, idx) => (
                        <div key={idx} className="space-y-2">
                          <div className="flex items-start gap-2">
                            <span className="text-xs bg-primary/10 text-primary rounded-full w-6 h-6 flex items-center justify-center shrink-0 mt-0.5 font-semibold">
                              {idx + 1}
                            </span>
                            <p className="text-sm font-medium text-foreground">{q.question}</p>
                          </div>
                          <div className="ml-8 p-3 bg-muted/50 rounded-lg border border-border">
                            <p className="text-sm text-foreground/80">
                              {(submission?.answers as any)?.[idx]?.answer || "—"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Show preview of questions */}
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {questionsArray.slice(0, 2).map((q, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <span className="font-semibold min-w-fit">{idx + 1}.</span>
                          <p>{q.question}</p>
                        </div>
                      ))}
                      {questionsArray.length > 2 && (
                        <p className="text-xs text-muted-foreground italic">
                          +{questionsArray.length - 2} more questions...
                        </p>
                      )}
                    </div>

                    {/* Start Button */}
                    <Button
                      onClick={() => handleStartHomework(assignment.id)}
                      className="w-full gap-2 bg-primary hover:bg-primary/90"
                    >
                      <Play className="h-4 w-4" /> Start Homework
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────
  // HOMEWORK START VIEW (With Timer)
  // ──────────────────────────────────────────────────────────────
  const activeAssignment = assignments?.find((a: any) => a.id === activeHomeworkId);
  if (!activeAssignment) return null;

  let questionsArray: HomeworkQuestion[] = [];
  if (activeAssignment.exit_ticket_content) {
    const extractedQs = extractQuestionsFromExitTicket(activeAssignment.exit_ticket_content);
    questionsArray = extractedQs.map((q, i) => ({
      question: q,
      index: i,
    }));
  }

  const currentQuestion = questionsArray[currentQuestionIndex];
  const answeredCount = questionsArray.filter((_, i) => answers[activeHomeworkId]?.[i]?.trim()).length;
  const progressPercent = (currentQuestionIndex / questionsArray.length) * 100;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ─── TIMER BANNER ─── */}
      <Card className={`border-2 ${timerSeconds > 120 ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20' : timerSeconds > 60 ? 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20' : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'}`}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Time Remaining</p>
              <p className={`text-4xl font-bold font-mono ${getTimerColor()}`}>
                {formatTime(timerSeconds)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Auto-submit when time's up</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground mb-2">Progress</p>
              <p className="text-2xl font-bold text-primary">
                {answeredCount}/{questionsArray.length}
              </p>
              <p className="text-xs text-muted-foreground">Answered</p>
            </div>
          </div>
          <Progress value={progressPercent} className="mt-4" />
        </CardContent>
      </Card>

      {/* ─── HOMEWORK HEADER ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Home className="h-5 w-5 text-primary" />
                {activeAssignment.period_title || `Period ${activeAssignment.period_number ?? "Homework"}`}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-2">
                {activeAssignment.subject} • {activeAssignment.topic || "General"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCurrentView("list");
                setActiveHomeworkId(null);
                setTimerActive(false);
              }}
            >
              ✕
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* ─── VIEW MODE TOGGLE ─── */}
      <div className="flex gap-2">
        <Button
          variant={!showAllQuestions ? "default" : "outline"}
          onClick={() => setShowAllQuestions(false)}
          className="flex-1"
        >
          One at a Time
        </Button>
        <Button
          variant={showAllQuestions ? "default" : "outline"}
          onClick={() => setShowAllQuestions(true)}
          className="flex-1"
        >
          All Questions
        </Button>
      </div>

      {/* ─── QUESTIONS VIEW ─── */}
      {!showAllQuestions ? (
        // One Question at a Time View
        <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader className="border-b pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  Question {currentQuestionIndex + 1} of {questionsArray.length}
                </p>
                <CardTitle className="text-lg">{currentQuestion?.question}</CardTitle>
              </div>
              <div className="text-right">
                <span className="inline-block px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                  Q {currentQuestionIndex + 1}
                </span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Your Answer</label>
              <Textarea
                placeholder="Type your answer here..."
                value={answers[activeHomeworkId]?.[currentQuestionIndex] || ""}
                onChange={(e) => handleAnswerChange(activeHomeworkId, currentQuestionIndex, e.target.value)}
                rows={6}
                className="resize-none"
              />
            </div>

            {/* Navigation Buttons */}
            <div className="flex gap-2 justify-between pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => setCurrentQuestionIndex((q) => Math.max(0, q - 1))}
                disabled={currentQuestionIndex === 0}
                className="gap-2"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>

              <div className="flex items-center gap-2">
                {answeredCount > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle className="h-3 w-3" /> {answeredCount} Answered
                  </Badge>
                )}
              </div>

              <Button
                onClick={() => setCurrentQuestionIndex((q) => Math.min(questionsArray.length - 1, q + 1))}
                disabled={currentQuestionIndex === questionsArray.length - 1}
                className="gap-2"
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        // All Questions at Once View
        <Card>
          <CardHeader>
            <CardTitle>All Questions ({questionsArray.length})</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Answer all questions below</p>
          </CardHeader>

          <CardContent className="space-y-6">
            {questionsArray.map((q, idx) => (
              <div key={idx} className="space-y-2 pb-4 border-b last:border-b-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <span className="text-sm font-semibold bg-primary/10 text-primary rounded-full w-8 h-8 flex items-center justify-center shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{q.question}</p>
                    <Textarea
                      placeholder="Type your answer here..."
                      value={answers[activeHomeworkId]?.[idx] || ""}
                      onChange={(e) => handleAnswerChange(activeHomeworkId, idx, e.target.value)}
                      rows={3}
                      className="mt-2 resize-none"
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ─── SUBMIT BUTTON ─── */}
      <div className="flex gap-2 sticky bottom-0 bg-background/80 backdrop-blur-sm p-4 rounded-lg border">
        <Button
          variant="outline"
          onClick={() => {
            setCurrentView("list");
            setActiveHomeworkId(null);
            setTimerActive(false);
          }}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          onClick={() => setConfirmSubmitOpen(true)}
          disabled={submitting === activeHomeworkId || timerSeconds === 0}
          className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700"
        >
          {submitting === activeHomeworkId ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</>
          ) : (
            <><Send className="h-4 w-4" /> Submit Homework</>
          )}
        </Button>
      </div>

      {/* ─── TIME WARNING ─── */}
      {timerSeconds < 60 && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <CardContent className="pt-4 flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-900 dark:text-red-100">Time Running Out!</p>
              <p className="text-sm text-red-800 dark:text-red-200 mt-1">
                Your homework will auto-submit in {formatTime(timerSeconds)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── CONFIRM SUBMIT DIALOG ─── */}
      <AlertDialog open={confirmSubmitOpen} onOpenChange={setConfirmSubmitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit Homework?</AlertDialogTitle>
            <AlertDialogDescription>
              You have answered <strong>{answeredCount} of {questionsArray.length}</strong> questions.
              Once submitted, you <strong>cannot change your answers</strong>. Your teacher will review and score this submission.
              <br /><br />
              Are you sure you want to submit now?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmSubmitOpen(false);
                handleSubmit(activeHomeworkId, questionsArray);
              }}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              Yes, Submit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default StudentHomework;
