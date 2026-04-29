import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Home, Lock, FileText, CheckCircle2, Clock, BarChart3, TrendingUp, ChevronDown, Award, AlertTriangle, Calendar, Bell, MessageSquare, GraduationCap, Inbox, Sparkles, Loader2 } from "lucide-react";

const CLASS_OPTIONS = [
  { value: "nursery", label: "Nursery" },
  { value: "lkg", label: "LKG" },
  { value: "ukg", label: "UKG" },
  ...Array.from({ length: 10 }, (_, i) => ({ value: `${i + 1}`, label: `Class ${i + 1}` })),
];

const DEFAULT_SECTIONS = ["A", "B", "C", "D", "E", "F"];

interface AnswerItem { question: string; answer: string }

const Analytics = () => {
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [reviewing, setReviewing] = useState<any | null>(null);
  const [scoreInput, setScoreInput] = useState<string>("");
  const [feedbackInput, setFeedbackInput] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [classAnalyticsOpen, setClassAnalyticsOpen] = useState(false);
  const [studentAnalytics, setStudentAnalytics] = useState<any | null>(null);
  const [submissionFilter, setSubmissionFilter] = useState<"all" | "submitted" | "not_submitted">("all");
  const [assignmentFilter, setAssignmentFilter] = useState<string | null>(null);
  const [showPendingList, setShowPendingList] = useState(false);
  const [individualSuggestions, setIndividualSuggestions] = useState<any | null>(null);
  const [individualLoading, setIndividualLoading] = useState(false);
  const [classSuggestions, setClassSuggestions] = useState<any | null>(null);
  const [classLoading, setClassLoading] = useState(false);

  const isAuthorized =
    profile?.role === "teacher" || profile?.role === "admin" || profile?.role === "school_admin";

  const getClassLabel = (val: string) =>
    CLASS_OPTIONS.find((c) => c.value === val)?.label || val;

  const { data: assignments = [] } = useQuery({
    queryKey: ["analytics-athome-assignments", selectedClass, selectedSection, user?.id],
    enabled: !!selectedClass && !!selectedSection && !!user?.id && isAuthorized,
    queryFn: async () => {
      const { data } = await supabase
        .from("homework_assignments")
        .select("*")
        .eq("assignment_type", "at-home")
        .eq("class_level", selectedClass)
        .eq("section", selectedSection.toUpperCase())
        .order("assigned_at", { ascending: false });
      return data || [];
    },
  });

  const assignmentIds = useMemo(() => assignments.map((a: any) => a.id), [assignments]);

  const { data: roster = [] } = useQuery({
    queryKey: ["analytics-roster", selectedClass, selectedSection, assignmentIds.join(",")],
    enabled: !!selectedClass && !!selectedSection && isAuthorized,
    queryFn: async () => {
      const map = new Map<string, { student_id: string | null; student_name: string }>();
      const { data: assessRows } = await supabase
        .from("student_assessments")
        .select("student_name, submitted_by, student_class, section")
        .eq("student_class", selectedClass)
        .eq("section", selectedSection.toUpperCase());
      for (const r of assessRows || []) {
        const key = (r.submitted_by || r.student_name).toLowerCase();
        if (!map.has(key)) map.set(key, { student_id: r.submitted_by, student_name: r.student_name });
      }
      if (assignmentIds.length > 0) {
        const { data: subRows } = await supabase
          .from("homework_submissions")
          .select("student_id, student_name")
          .in("assignment_id", assignmentIds);
        for (const r of subRows || []) {
          const key = (r.student_id || r.student_name || "").toLowerCase();
          if (!key) continue;
          if (!map.has(key)) map.set(key, { student_id: r.student_id, student_name: r.student_name || "Unknown" });
        }
      }
      return Array.from(map.values());
    },
  });

  const { data: submissions = [], isLoading: subsLoading } = useQuery({
    queryKey: ["analytics-athome-submissions", assignmentIds],
    enabled: assignmentIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("homework_submissions")
        .select("*")
        .in("assignment_id", assignmentIds)
        .eq("completed", true)
        .order("submitted_at", { ascending: false });
      return data || [];
    },
  });

  const rows = useMemo(() => {
    const filteredSubs = assignmentFilter
      ? submissions.filter((s: any) => s.assignment_id === assignmentFilter)
      : submissions;
    const totalAssignments = assignmentFilter ? 1 : assignments.length;
    return roster.map((stu) => {
      const studentSubs = filteredSubs.filter(
        (s: any) => s.student_id === stu.student_id || s.student_name === stu.student_name
      );
      const latest = studentSubs[0] || null;
      const evaluatedCount = studentSubs.filter((s: any) => s.teacher_score != null).length;
      const evaluatedSubs = studentSubs.filter((s: any) => s.teacher_score != null);
      const avgScore = evaluatedSubs.length
        ? evaluatedSubs.reduce((sum, s: any) => sum + Number(s.teacher_score), 0) / evaluatedSubs.length
        : null;
      return {
        student_id: stu.student_id,
        student_name: stu.student_name,
        submissionsCount: studentSubs.length,
        totalAssignments,
        evaluatedCount,
        avgScore,
        latest,
        allSubs: studentSubs,
      };
    }).sort((a, b) => a.student_name.localeCompare(b.student_name));
  }, [roster, submissions, assignments, assignmentFilter]);

  // Class-wide analytics
  const classAnalytics = useMemo(() => {
    const totalStudents = rows.length;
    const submittedStudents = rows.filter(r => r.submissionsCount > 0).length;
    const submissionRate = totalStudents ? Math.round((submittedStudents / totalStudents) * 100) : 0;
    const evaluatedSubs = submissions.filter((s: any) => s.teacher_score != null);
    const avgScore = evaluatedSubs.length
      ? evaluatedSubs.reduce((sum, s: any) => sum + Number(s.teacher_score), 0) / evaluatedSubs.length
      : 0;
    const pendingEval = submissions.filter((s: any) => s.teacher_score == null).length;

    // Per-assignment breakdown
    const perAssignment = assignments.map((a: any) => {
      const subs = submissions.filter((s: any) => s.assignment_id === a.id);
      const evals = subs.filter((s: any) => s.teacher_score != null);
      const avg = evals.length
        ? evals.reduce((sum, s: any) => sum + Number(s.teacher_score), 0) / evals.length
        : 0;
      return {
        name: (a.topic || a.period_title || "Untitled").substring(0, 20),
        fullName: a.topic || a.period_title || "Untitled",
        avgScore: Math.round(avg),
        submitted: subs.length,
        evaluated: evals.length,
      };
    });

    // Score distribution histogram (buckets of 10)
    const buckets = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map(b => ({
      range: `${b}-${b + 10}`,
      count: evaluatedSubs.filter((s: any) => {
        const sc = Number(s.teacher_score);
        return sc >= b && (b === 90 ? sc <= 100 : sc < b + 10);
      }).length,
    }));

    // Top & bottom performers (only those evaluated)
    const performers = rows
      .filter(r => r.avgScore != null)
      .sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));
    const top = performers.slice(0, 5);
    const bottom = performers.slice(-5).reverse();

    return { totalStudents, submittedStudents, submissionRate, avgScore, pendingEval, perAssignment, buckets, top, bottom };
  }, [rows, submissions, assignments]);

  // Individual student trend
  const studentTrend = useMemo(() => {
    if (!studentAnalytics) return [];
    return [...studentAnalytics.allSubs]
      .filter((s: any) => s.teacher_score != null)
      .sort((a: any, b: any) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime())
      .map((s: any) => {
        const a = assignments.find((x: any) => x.id === s.assignment_id);
        return {
          name: (a?.topic || a?.period_title || "Untitled").substring(0, 15),
          score: Number(s.teacher_score),
          date: new Date(s.submitted_at).toLocaleDateString(),
        };
      });
  }, [studentAnalytics, assignments]);

  const openReview = (sub: any) => {
    setReviewing(sub);
    setScoreInput(sub.teacher_score != null ? String(sub.teacher_score) : "");
    setFeedbackInput(sub.teacher_feedback || "");
  };

  const saveScore = async () => {
    if (!reviewing) return;
    const score = parseInt(scoreInput, 10);
    if (isNaN(score) || score < 0 || score > 100) {
      toast.error("Enter a score between 0 and 100");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("homework_submissions")
      .update({
        teacher_score: score,
        teacher_feedback: feedbackInput,
        evaluated_at: new Date().toISOString(),
        evaluated_by: user?.id,
      })
      .eq("id", reviewing.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Score saved");
    queryClient.invalidateQueries({ queryKey: ["analytics-athome-submissions", assignmentIds] });
    setReviewing(null);
  };

  const generateIndividualSuggestions = async () => {
    if (!reviewing) return;
    const score = parseInt(scoreInput, 10);
    if (isNaN(score)) {
      toast.error("Enter a score first to generate suggestions");
      return;
    }
    setIndividualLoading(true);
    setIndividualSuggestions(null);
    try {
      const { data, error } = await supabase.functions.invoke("analytics-ai-suggestions", {
        body: {
          mode: "individual",
          studentName: reviewing.student_name,
          className: getClassLabel(selectedClass),
          section: selectedSection,
          topic: reviewing.assignment?.topic || reviewing.assignment?.period_title,
          score,
          teacherFeedback: feedbackInput,
          answers: reviewingAnswers,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setIndividualSuggestions(data.suggestions);
    } catch (e: any) {
      toast.error(e.message || "Failed to generate suggestions");
    } finally {
      setIndividualLoading(false);
    }
  };

  const generateClassSuggestions = async () => {
    setClassLoading(true);
    setClassSuggestions(null);
    try {
      const { data, error } = await supabase.functions.invoke("analytics-ai-suggestions", {
        body: {
          mode: "class",
          className: getClassLabel(selectedClass),
          section: selectedSection,
          avgScore: Math.round(classAnalytics.avgScore),
          submissionRate: classAnalytics.submissionRate,
          totalStudents: classAnalytics.totalStudents,
          pendingEval: classAnalytics.pendingEval,
          perAssignment: classAnalytics.perAssignment.map((a: any) => ({
            name: a.fullName || a.name,
            avgScore: a.avgScore,
            submissions: a.submitted,
          })),
          topPerformers: classAnalytics.top.map((s: any) => ({
            name: s.student_name,
            avgScore: s.avgScore || 0,
          })),
          bottomPerformers: classAnalytics.bottom.map((s: any) => ({
            name: s.student_name,
            avgScore: s.avgScore || 0,
          })),
          commonFeedback: submissions
            .filter((s: any) => s.teacher_feedback)
            .slice(0, 10)
            .map((s: any) => s.teacher_feedback),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setClassSuggestions(data.suggestions);
    } catch (e: any) {
      toast.error(e.message || "Failed to generate suggestions");
    } finally {
      setClassLoading(false);
    }
  };

  if (!isAuthorized) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Lock className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">Access Restricted</h2>
          <p className="text-muted-foreground">This page is available to teachers and admins.</p>
        </div>
      </AppLayout>
    );
  }

  const reviewingAnswers: AnswerItem[] = Array.isArray(reviewing?.answers) ? reviewing.answers : [];

  return (
    <AppLayout>
      <PageHeader
        title="Analytics Phase"
        subtitle="Review at-home homework answers and assign scores"
      />

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Select Class & Section</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium mb-2 block">Class</label>
            <Select value={selectedClass} onValueChange={(v) => { setSelectedClass(v); setSelectedSection(""); }}>
              <SelectTrigger><SelectValue placeholder="Choose class" /></SelectTrigger>
              <SelectContent>
                {CLASS_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Section</label>
            <Select value={selectedSection} onValueChange={setSelectedSection} disabled={!selectedClass}>
              <SelectTrigger><SelectValue placeholder="Choose section" /></SelectTrigger>
              <SelectContent>
                {DEFAULT_SECTIONS.map((s) => (
                  <SelectItem key={s} value={s}>Section {s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!selectedClass || !selectedSection ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Home className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">
              Select a class and section to view at-home homework submissions.
            </p>
          </CardContent>
        </Card>
      ) : subsLoading ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : assignments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">
              No at-home homework has been assigned for {getClassLabel(selectedClass)} – Section {selectedSection} yet.
            </p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">
              No students found in this class & section. Add students first.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between flex-wrap gap-2">
              <span className="flex items-center gap-2">
                <Home className="h-5 w-5 text-primary" />
                Students — {getClassLabel(selectedClass)} · Section {selectedSection}
              </span>
              <div className="flex gap-2 flex-wrap items-center">
                {/* Clickable assignments badge */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant={assignmentFilter ? "default" : "secondary"} size="sm" className="h-7 gap-1">
                      <FileText className="h-3 w-3" />
                      {assignmentFilter
                        ? `1 of ${assignments.length} selected`
                        : `${assignments.length} assignment${assignments.length !== 1 ? "s" : ""}`}
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="end">
                    <div className="p-3 border-b flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">At-Home Assignments</p>
                        <p className="text-xs text-muted-foreground">
                          {assignmentFilter ? "Filtering by 1 assignment" : `${assignments.length} total · click to filter`}
                        </p>
                      </div>
                      {assignmentFilter && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAssignmentFilter(null)}>
                          Clear
                        </Button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y">
                      {assignments.map((a: any) => {
                        const subs = submissions.filter((s: any) => s.assignment_id === a.id);
                        const isActive = assignmentFilter === a.id;
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => setAssignmentFilter(isActive ? null : a.id)}
                            className={`w-full text-left p-3 transition ${isActive ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/50"}`}
                          >
                            <p className="text-sm font-medium line-clamp-2">
                              {a.topic || a.period_title || "Untitled"}
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {a.assigned_at ? new Date(a.assigned_at).toLocaleDateString() : "—"}
                              {a.subject && <span>· {a.subject}</span>}
                            </div>
                            <div className="flex gap-1 mt-2">
                              <Badge variant="outline" className="text-[10px] h-5">
                                {subs.length} submitted
                              </Badge>
                              <Badge variant="outline" className="text-[10px] h-5">
                                {subs.filter((s: any) => s.teacher_score != null).length} evaluated
                              </Badge>
                              {isActive && <Badge className="text-[10px] h-5 bg-primary/20 text-primary border-primary/30">Active filter</Badge>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>

                <Badge variant="secondary">{rows.length} student{rows.length !== 1 ? "s" : ""}</Badge>
                <button
                  type="button"
                  onClick={() => setSubmissionFilter(f => f === "submitted" ? "all" : "submitted")}
                  aria-pressed={submissionFilter === "submitted"}
                >
                  <Badge
                    className={`bg-emerald-500/15 text-emerald-700 border-emerald-200 cursor-pointer transition ${submissionFilter === "submitted" ? "ring-2 ring-emerald-500" : "hover:bg-emerald-500/25"}`}
                  >
                    {rows.filter(r => r.submissionsCount > 0).length} submitted
                  </Badge>
                </button>
                <button
                  type="button"
                  onClick={() => setSubmissionFilter(f => f === "not_submitted" ? "all" : "not_submitted")}
                  aria-pressed={submissionFilter === "not_submitted"}
                >
                  <Badge
                    variant="outline"
                    className={`cursor-pointer transition ${submissionFilter === "not_submitted" ? "ring-2 ring-primary" : "hover:bg-muted"}`}
                  >
                    {rows.filter(r => r.submissionsCount === 0).length} not submitted
                  </Badge>
                </button>

                <Button size="sm" onClick={() => setClassAnalyticsOpen(true)} className="h-7 gap-1">
                  <BarChart3 className="h-3 w-3" /> Class Analytics
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="text-center">Submitted</TableHead>
                  <TableHead className="text-center">Evaluated</TableHead>
                  <TableHead className="text-center">Avg Score</TableHead>
                  <TableHead>Latest Submission</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                  <TableHead className="text-right">Analytics</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const hasSubmission = r.submissionsCount > 0;
                  const isHighlighted =
                    (submissionFilter === "submitted" && hasSubmission) ||
                    (submissionFilter === "not_submitted" && !hasSubmission);
                  const isDimmed = submissionFilter !== "all" && !isHighlighted;
                  return (
                    <TableRow
                      key={r.student_id || r.student_name}
                      className={`${isHighlighted ? (hasSubmission ? "bg-emerald-500/10 hover:bg-emerald-500/15" : "bg-muted/60") : ""} ${isDimmed ? "opacity-40" : ""}`}
                    >
                      <TableCell className="font-medium">
                        <button
                          onClick={() => hasSubmission && setStudentAnalytics(r)}
                          disabled={!hasSubmission}
                          className="text-left hover:text-primary hover:underline disabled:no-underline disabled:cursor-default disabled:hover:text-foreground"
                        >
                          {r.student_name}
                        </button>
                      </TableCell>
                      <TableCell className="text-center">
                        {hasSubmission ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200 gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {r.submissionsCount} / {r.totalAssignments}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-muted-foreground">
                            <Clock className="h-3 w-3" /> Not submitted
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {hasSubmission ? `${r.evaluatedCount} / ${r.submissionsCount}` : "—"}
                      </TableCell>
                      <TableCell className="text-center text-sm font-medium">
                        {r.avgScore != null ? `${Math.round(r.avgScore)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.latest?.submitted_at ? new Date(r.latest.submitted_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!hasSubmission}
                          onClick={() => {
                            const latestWithAssignment = {
                              ...r.latest,
                              assignment: assignments.find((a: any) => a.id === r.latest.assignment_id),
                            };
                            openReview(latestWithAssignment);
                          }}
                        >
                          {hasSubmission ? "Review Answers" : "Awaiting"}
                        </Button>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setStudentAnalytics(r)}
                          className="gap-1"
                        >
                          <BarChart3 className="h-3 w-3" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Review Answers Dialog */}
      <Dialog open={!!reviewing} onOpenChange={(o) => { if (!o) { setReviewing(null); setIndividualSuggestions(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {reviewing?.student_name} — {reviewing?.assignment?.topic || "Homework"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {reviewingAnswers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No answers recorded.</p>
            ) : (
              reviewingAnswers.map((a, i) => (
                <div key={i} className="rounded-lg border p-3 bg-muted/30">
                  <p className="text-sm font-semibold mb-1">Q{i + 1}. {a.question}</p>
                  <p className="text-sm text-foreground/85 whitespace-pre-wrap">
                    <span className="text-muted-foreground">Answer: </span>
                    {a.answer?.trim() || <em className="text-muted-foreground">No answer</em>}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="space-y-3 pt-2 border-t">
            <div>
              <label className="text-sm font-medium mb-1 block">Score (0–100)</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={scoreInput}
                onChange={(e) => setScoreInput(e.target.value)}
                placeholder="Enter score"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Feedback (optional)</label>
              <Textarea
                value={feedbackInput}
                onChange={(e) => setFeedbackInput(e.target.value)}
                placeholder="Comments for the student…"
                rows={3}
              />
            </div>
          </div>

          {/* AI Suggestions Panel */}
          <div className="pt-3 border-t space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">AI Improvement Suggestions</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={generateIndividualSuggestions}
                disabled={individualLoading || !scoreInput}
                className="gap-1.5"
              >
                {individualLoading ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
                ) : (
                  <><Sparkles className="h-3.5 w-3.5" /> {individualSuggestions ? "Regenerate" : "Generate"}</>
                )}
              </Button>
            </div>

            {!individualSuggestions && !individualLoading && (
              <p className="text-xs text-muted-foreground">
                Enter a score and (optionally) feedback, then generate personalized suggestions for this student.
              </p>
            )}

            {individualSuggestions && (
              <div className="rounded-lg border bg-primary/5 p-4 space-y-3">
                <p className="text-sm text-foreground/90">{individualSuggestions.summary}</p>

                {individualSuggestions.strengths?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-700 mb-1">✓ Strengths</p>
                    <ul className="list-disc list-inside text-xs space-y-0.5 text-foreground/85">
                      {individualSuggestions.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}

                {individualSuggestions.weak_areas?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-amber-700 mb-1">⚠ Areas to Improve</p>
                    <ul className="list-disc list-inside text-xs space-y-0.5 text-foreground/85">
                      {individualSuggestions.weak_areas.map((s: string, i: number) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}

                {individualSuggestions.suggestions?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-primary mb-1">💡 Suggested Actions</p>
                    <div className="space-y-1.5">
                      {individualSuggestions.suggestions.map((s: any, i: number) => (
                        <div key={i} className="rounded border bg-background p-2">
                          <p className="text-xs font-semibold">{s.title}</p>
                          <p className="text-xs text-muted-foreground">{s.action}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {individualSuggestions.parent_tip && (
                  <div className="rounded bg-background border p-2">
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">Parent tip</p>
                    <p className="text-xs">{individualSuggestions.parent_tip}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(null)}>Cancel</Button>
            <Button onClick={saveScore} disabled={saving}>
              {saving ? "Saving…" : "Save Score"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Class Analytics Dialog — Dashboard layout */}
      <Dialog open={classAnalyticsOpen} onOpenChange={setClassAnalyticsOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-0 gap-0">
          {/* Header strip */}
          <div className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground p-5 rounded-t-lg">
            <DialogHeader>
              <DialogTitle className="text-primary-foreground text-2xl font-bold">
                Class Analytics Dashboard
              </DialogTitle>
              <p className="text-sm text-primary-foreground/80 mt-1">
                {getClassLabel(selectedClass)} · Section {selectedSection}
              </p>
            </DialogHeader>
          </div>

          <div className="p-5 space-y-5 bg-muted/30">
            {/* Top row: Class summary + Analytics Rating */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Class summary card */}
              <Card className="shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-baseline justify-between mb-3">
                    <h3 className="text-lg font-bold">{getClassLabel(selectedClass)} {selectedSection}</h3>
                    <Badge variant="secondary" className="text-xs">{assignments.length} assignment{assignments.length !== 1 ? "s" : ""}</Badge>
                  </div>
                  <div className="flex items-end gap-3 mb-4">
                    <p className="text-5xl font-bold text-primary leading-none">{Math.round(classAnalytics.avgScore)}%</p>
                    <div className="text-xs text-muted-foreground pb-1">
                      <p>Class Avg Score</p>
                      <p className="text-emerald-600 font-medium">Submission Rate: {classAnalytics.submissionRate}%</p>
                    </div>
                  </div>
                  <div className="space-y-2 pt-3 border-t">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Submitted Students</span>
                      <span className="font-medium">{classAnalytics.submittedStudents} / {classAnalytics.totalStudents}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Submissions</span>
                      <span className="font-medium">{submissions.length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Pending Evaluation</span>
                      <span className="font-medium text-amber-600">{classAnalytics.pendingEval}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Analytics Rating panel */}
              <Card className="shadow-sm bg-primary/5 border-primary/20">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-primary" />
                      Analytics Rating
                    </h3>
                    <Badge className="bg-primary text-primary-foreground">Live</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-background rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-primary">{Math.round(classAnalytics.avgScore)}%</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Mastery Score</p>
                    </div>
                    <div className="bg-background rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-primary">{classAnalytics.submissionRate}%</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Performance</p>
                    </div>
                    <div className="bg-background rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-primary">
                        {classAnalytics.totalStudents
                          ? Math.round((submissions.length / Math.max(classAnalytics.totalStudents * Math.max(assignments.length, 1), 1)) * 100)
                          : 0}%
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">Engagement</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Academic Coverage strip */}
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-full bg-emerald-500/15 flex items-center justify-center">
                      <Award className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Academic Coverage</p>
                      <p className="text-sm font-semibold">{assignments.length} Lessons</p>
                    </div>
                  </div>
                  <div className="h-10 w-px bg-border" />
                  <div className="flex-1 grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-xl font-bold">{Math.round(classAnalytics.avgScore)}%</p>
                      <p className="text-[10px] text-muted-foreground">Mastered</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold">{classAnalytics.submissionRate}%</p>
                      <p className="text-[10px] text-muted-foreground">Submitted</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold">{classAnalytics.pendingEval}</p>
                      <p className="text-[10px] text-muted-foreground">Pending Review</p>
                    </div>
                  </div>
                  <Button size="sm" className="gap-1">
                    <FileText className="h-3 w-3" /> {submissions.length} Submissions
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Per-assignment bar chart */}
            {classAnalytics.perAssignment.length > 0 && (
              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Average Score by Assignment</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={{ avgScore: { label: "Avg Score", color: "hsl(var(--primary))" } }} className="h-[220px]">
                    <BarChart data={classAnalytics.perAssignment}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" fontSize={10} />
                      <YAxis domain={[0, 100]} fontSize={11} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="avgScore" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}

            {/* Score distribution */}
            {submissions.some((s: any) => s.teacher_score != null) && (
              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Score Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={{ count: { label: "Students", color: "hsl(var(--chart-2))" } }} className="h-[200px]">
                    <BarChart data={classAnalytics.buckets}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="range" fontSize={11} />
                      <YAxis allowDecimals={false} fontSize={11} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="count" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}

            {/* Student Performance section */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold">Student Performance</h3>
                <div className="flex gap-2 text-xs text-muted-foreground items-center">
                  <span>Improvement</span><span>→</span>
                  <span>Activity</span><span>→</span>
                  <span>Outcome</span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <Card className="shadow-sm">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Submissions</p>
                      <p className="text-xl font-bold">{submissions.length}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                      <TrendingUp className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Improvement</p>
                      <p className="text-xl font-bold">{Math.round(classAnalytics.avgScore)}%</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-amber-500/15 flex items-center justify-center">
                      <Award className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Effort</p>
                      <p className="text-xl font-bold">{classAnalytics.submissionRate}%</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Top & Bottom performers */}
              <div className="grid md:grid-cols-2 gap-3">
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Award className="h-4 w-4 text-emerald-600" /> Top Performers
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {classAnalytics.top.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No evaluated submissions yet.</p>
                    ) : classAnalytics.top.map((p, i) => (
                      <div key={i} className="flex justify-between items-center text-sm">
                        <span>{i + 1}. {p.student_name}</span>
                        <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200">{Math.round(p.avgScore || 0)}%</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" /> Needs Attention
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {classAnalytics.bottom.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No evaluated submissions yet.</p>
                    ) : classAnalytics.bottom.map((p, i) => (
                      <div key={i} className="flex justify-between items-center text-sm">
                        <span>{p.student_name}</span>
                        <Badge variant="outline" className="text-amber-700 border-amber-200">{Math.round(p.avgScore || 0)}%</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Individual Student Analytics Dialog — Dashboard layout */}
      <Dialog open={!!studentAnalytics} onOpenChange={(o) => { if (!o) { setStudentAnalytics(null); setShowPendingList(false); } }}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-0 gap-0">
          {studentAnalytics && (() => {
            const totalAssign = studentAnalytics.totalAssignments || 0;
            const submitted = studentAnalytics.submissionsCount || 0;
            const pending = Math.max(totalAssign - submitted, 0);
            const evaluated = studentAnalytics.evaluatedCount || 0;
            const pendingReview = Math.max(submitted - evaluated, 0);
            const completionPct = totalAssign ? Math.round((submitted / totalAssign) * 100) : 0;
            const pendingPct = totalAssign ? Math.round((pending / totalAssign) * 100) : 0;
            const reviewPct = totalAssign ? Math.max(100 - completionPct - pendingPct, 0) : 0;
            const avgScore = studentAnalytics.avgScore != null ? Math.round(studentAnalytics.avgScore) : 0;

            const pieData = [
              { name: "Completed", value: submitted, color: "hsl(142 71% 45%)" },
              { name: "Pending", value: pending, color: "hsl(45 93% 58%)" },
              { name: "In Review", value: pendingReview, color: "hsl(0 72% 60%)" },
            ].filter(d => d.value > 0);

            // Weekly improvement: group trend by week index
            const weekly = studentTrend.length > 0
              ? studentTrend.map((t, i) => ({
                  week: `Week ${i + 1}`,
                  score: t.score,
                }))
              : [];

            // Daily performance (last 7 submissions)
            const daily = studentTrend.slice(-7).map((t, i) => ({
              day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i] || `D${i + 1}`,
              score: t.score,
            }));

            return (
              <>
                {/* Gradient header */}
                <div className="bg-gradient-to-r from-primary to-primary/70 text-primary-foreground p-5 rounded-t-lg">
                  <DialogHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-full bg-background/20 border border-primary-foreground/30 flex items-center justify-center">
                          <GraduationCap className="h-6 w-6 text-primary-foreground" />
                        </div>
                        <div>
                          <DialogTitle className="text-primary-foreground text-2xl font-bold text-left">
                            Hi {studentAnalytics.student_name?.split(" ")[0]}
                          </DialogTitle>
                          <p className="text-sm text-primary-foreground/80 mt-0.5">
                            {getClassLabel(selectedClass)} · Section {selectedSection} · Student Dashboard
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="hidden sm:flex items-center gap-1.5 bg-background/20 border border-primary-foreground/20 rounded-full px-3 py-1.5 text-xs">
                          <MessageSquare className="h-3.5 w-3.5" />
                          Messages
                        </div>
                        <div className="relative h-9 w-9 rounded-full bg-background/20 border border-primary-foreground/20 flex items-center justify-center">
                          <Bell className="h-4 w-4" />
                          {pending > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-rose-500 text-[10px] font-bold flex items-center justify-center">
                              {pending}
                            </span>
                          )}
                        </div>
                        <Badge className="bg-background/20 text-primary-foreground border-primary-foreground/20 hover:bg-background/30">
                          Active
                        </Badge>
                      </div>
                    </div>
                  </DialogHeader>
                </div>

                <div className="p-5 space-y-4 bg-muted/30">
                  {/* Top row: Pending Homework + Daily Performance */}
                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Pending Homework */}
                    <Card className="shadow-sm">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base flex items-center gap-2">
                            <FileText className="h-4 w-4 text-primary" />
                            Pending Homework
                          </CardTitle>
                          <Badge variant="secondary" className="text-xs">
                            {pending} pending
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="rounded-lg border bg-card p-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold">Pending Assignments</p>
                            <p className="text-xs text-muted-foreground">
                              {pending} of {totalAssign} not yet submitted
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-amber-500/15 text-amber-700 border-amber-200 hover:bg-amber-500/25 h-7"
                            onClick={() => setShowPendingList((v) => !v)}
                            disabled={pending === 0}
                          >
                            {showPendingList ? "Hide" : "View All"}
                          </Button>
                        </div>
                        {showPendingList && pending > 0 && (
                          <div className="rounded-lg border bg-card p-2 max-h-44 overflow-y-auto divide-y">
                            {assignments
                              .filter((a: any) => !studentAnalytics.allSubs.some((s: any) => s.assignment_id === a.id))
                              .map((a: any) => (
                                <div key={a.id} className="flex items-center justify-between py-2 px-1 gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium truncate">
                                      {a.topic || a.period_title || "Untitled assignment"}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      {a.created_at ? `Assigned ${new Date(a.created_at).toLocaleDateString()}` : "—"}
                                    </p>
                                  </div>
                                  <Badge variant="outline" className="text-amber-700 border-amber-200 text-[10px] gap-1 shrink-0">
                                    <Clock className="h-3 w-3" /> Pending
                                  </Badge>
                                </div>
                              ))}
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-md bg-emerald-500/10 p-2">
                            <p className="text-lg font-bold text-emerald-700">{submitted}</p>
                            <p className="text-[10px] text-muted-foreground">Submitted</p>
                          </div>
                          <div className="rounded-md bg-amber-500/10 p-2">
                            <p className="text-lg font-bold text-amber-700">{pending}</p>
                            <p className="text-[10px] text-muted-foreground">Pending</p>
                          </div>
                          <div className="rounded-md bg-rose-500/10 p-2">
                            <p className="text-lg font-bold text-rose-700">{pendingReview}</p>
                            <p className="text-[10px] text-muted-foreground">In Review</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Daily Performance Score */}
                    <Card className="shadow-sm">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-primary" />
                            Daily Performance Score
                          </CardTitle>
                          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200 text-xs">
                            {avgScore >= 70 ? "Completed" : "On Track"}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center gap-3 mb-2">
                          <p className="text-4xl font-bold text-primary leading-none">{avgScore}%</p>
                          <div className="text-xs text-muted-foreground">
                            <p>Average across</p>
                            <p className="font-medium">{evaluated} evaluated submission{evaluated !== 1 ? "s" : ""}</p>
                          </div>
                        </div>
                        {daily.length > 0 ? (
                          <ChartContainer config={{ score: { label: "Score", color: "hsl(var(--primary))" } }} className="h-[120px]">
                            <LineChart data={daily}>
                              <XAxis dataKey="day" fontSize={10} />
                              <YAxis hide domain={[0, 100]} />
                              <ChartTooltip content={<ChartTooltipContent />} />
                              <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                            </LineChart>
                          </ChartContainer>
                        ) : (
                          <p className="text-xs text-muted-foreground text-center py-6">No daily data yet</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Bottom row: Homework Completion donut + Weekly Improvement */}
                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Homework Completion */}
                    <Card className="shadow-sm">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">Homework Completion</CardTitle>
                          <Badge variant="outline" className="text-xs">{totalAssign} total</Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {pieData.length > 0 ? (
                          <div className="flex items-center gap-4">
                            <div className="relative h-[160px] w-[160px]">
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={pieData}
                                    cx="50%" cy="50%"
                                    innerRadius={42} outerRadius={70}
                                    paddingAngle={2}
                                    dataKey="value"
                                  >
                                    {pieData.map((entry, i) => (
                                      <Cell key={i} fill={entry.color} />
                                    ))}
                                  </Pie>
                                </PieChart>
                              </ResponsiveContainer>
                              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <p className="text-2xl font-bold text-foreground">{completionPct}%</p>
                                <p className="text-[10px] text-muted-foreground">Done</p>
                              </div>
                            </div>
                            <div className="flex-1 space-y-2 text-sm">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                                  Completed
                                </span>
                                <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200">{submitted}</Badge>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                                  Pending
                                </span>
                                <Badge className="bg-amber-500/15 text-amber-700 border-amber-200">{pending}</Badge>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                                  In Review
                                </span>
                                <Badge className="bg-rose-500/15 text-rose-700 border-rose-200">{pendingReview}</Badge>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-8">No assignment data</p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Weekly Improvement */}
                    <Card className="shadow-sm">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">Weekly Improvement</CardTitle>
                          <Badge variant="outline" className="text-xs">Score Trend</Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {weekly.length > 0 ? (
                          <ChartContainer config={{ score: { label: "Score", color: "hsl(142 71% 45%)" } }} className="h-[180px]">
                            <AreaChart data={weekly}>
                              <defs>
                                <linearGradient id="weeklyGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="hsl(142 71% 45%)" stopOpacity={0.4} />
                                  <stop offset="95%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="week" fontSize={10} />
                              <YAxis domain={[0, 100]} fontSize={10} />
                              <ChartTooltip content={<ChartTooltipContent />} />
                              <Area
                                type="monotone"
                                dataKey="score"
                                stroke="hsl(142 71% 45%)"
                                strokeWidth={2}
                                fill="url(#weeklyGrad)"
                              />
                            </AreaChart>
                          </ChartContainer>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-8">No evaluated submissions yet</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* All Submissions table */}
                  <Card className="shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">All Submissions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Assignment</TableHead>
                            <TableHead>Submitted</TableHead>
                            <TableHead className="text-center">Score</TableHead>
                            <TableHead className="text-right">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {studentAnalytics.allSubs.map((s: any) => {
                            const a = assignments.find((x: any) => x.id === s.assignment_id);
                            return (
                              <TableRow key={s.id}>
                                <TableCell className="text-sm">{a?.topic || a?.period_title || "Untitled"}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : "—"}
                                </TableCell>
                                <TableCell className="text-center text-sm font-medium">
                                  {s.teacher_score != null ? `${s.teacher_score}%` : <span className="text-muted-foreground">Pending</span>}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setStudentAnalytics(null);
                                      openReview({ ...s, assignment: a });
                                    }}
                                  >
                                    Review
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Analytics;
