/**
 * ParentDashboard.tsx — Parent Dashboard
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { GraduationCap, BookOpen, BarChart3, TrendingUp } from "lucide-react";
import parentBanner from "@/assets/parent-banner.png";

interface Child { id: string; full_name: string | null; class_grade: string | null; }
interface HomeworkRow { id: string; title: string; due_date: string | null; status: string; score: number | null; feedback: string | null; answers: any[]; }
interface ScoreRow { id: string; score: number | null; completed_at: string | null; total_questions: number | null; age_group?: number; }

export default function ParentDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [homework, setHomework] = useState<HomeworkRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [reportRow, setReportRow] = useState<any>(null);
  const [noLink, setNoLink] = useState(false);

  const fetchChildren = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("parent_students")
      .select("student_id, profiles:student_id(id, full_name, class_grade)")
      .eq("parent_id", user.id);
    if (!data || data.length === 0) {
      setNoLink(true);
      setLoading(false);
      return;
    }
    const kids = (data as any[]).map((r) => ({
      id: r.profiles.id,
      full_name: r.profiles.full_name,
      class_grade: r.profiles.class_grade,
    }));
    setChildren(kids);
    setSelectedChild(kids[0].id);
  }, [user]);

  const fetchChildData = useCallback(async (childId: string) => {
    const childName = children.find(c => c.id === childId)?.full_name ?? "";
    setLoading(true);
    try {
      const { data: hwData } = await supabase
        .from("homework_assignments")
        .select("id, title, due_date, school_id")
        .order("due_date", { ascending: false })
        .limit(20);
      const { data: subData } = await supabase
        .from("homework_submissions")
        .select("assignment_id, completed, score, teacher_score, teacher_feedback, answers")
        .eq("student_id", childId);
      const subIds = new Set((subData ?? []).map((s: any) => (s.assignment_id ?? "").trim().toLowerCase()));
      const scoreMap = new Map((subData ?? []).map((s: any) => [(s.assignment_id ?? "").trim().toLowerCase(), s.teacher_score ?? s.score ?? null]));
      const feedbackMap = new Map((subData ?? []).map((s: any) => [(s.assignment_id ?? "").trim().toLowerCase(), { feedback: s.teacher_feedback ?? null, answers: s.answers ?? [] }]));
      const gradedIds = new Set((subData ?? []).filter((s: any) => s.teacher_score !== null).map((s: any) => (s.assignment_id ?? "").trim().toLowerCase()));
      setHomework((hwData ?? []).map((h: any) => ({
        id: h.id,
        title: h.title,
        due_date: h.due_date,
        status: gradedIds.has((h.id ?? "").trim().toLowerCase()) ? "graded" : subIds.has((h.id ?? "").trim().toLowerCase()) ? "completed" : "pending",
        score: scoreMap.get((h.id ?? "").trim().toLowerCase()) ?? null,
        feedback: feedbackMap.get((h.id ?? "").trim().toLowerCase())?.feedback ?? null,
        answers: feedbackMap.get((h.id ?? "").trim().toLowerCase())?.answers ?? [],
      })));
      const { data: scoreData } = await supabase
        .from("student_assessments")
        .select("id, responses, age_group, created_at")
        .eq("student_name", childName)
        .order("created_at", { ascending: false })
        .limit(20);
      setScores((scoreData ?? []).map((s: any) => ({
        id: s.id,
        score: null,
        completed_at: s.created_at,
        total_questions: s.responses ? Object.keys(s.responses).length : 0,
        age_group: s.age_group,
      })));
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, children]);

  useEffect(() => { fetchChildren(); }, [fetchChildren]);
  useEffect(() => { if (selectedChild) fetchChildData(selectedChild); }, [selectedChild, fetchChildData]);

  const selectedChildData = children.find(c => c.id === selectedChild);
  const avgScore = scores.filter(s => s.score !== null).length
    ? Math.round(scores.filter(s => s.score !== null).reduce((a, s) => a + (s.score ?? 0), 0) / scores.filter(s => s.score !== null).length)
    : null;
  const completedHW = homework.filter(h => h.status === "completed" || h.status === "graded").length;

  if (loading && children.length === 0) return <AppLayout><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div></AppLayout>;

  if (noLink) return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6">
        <Card>
          <CardContent className="py-12 text-center">
            <GraduationCap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">No Students Linked</h2>
            <p className="text-muted-foreground text-sm">Please contact the school admin to link your child's account.</p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );

  return (
    <AppLayout>
      {/* Banner */}
      <div className="relative w-full overflow-hidden rounded-2xl mb-6" style={{ background: "linear-gradient(135deg, #e8d5f5 0%, #d4b8f0 100%)" }}>
        <div className="px-8 py-8 relative z-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Welcome, {selectedChildData?.full_name ?? "Parent"}</h1>
          <p className="text-gray-600 text-sm">{new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
          <p className="text-gray-600 text-sm mt-1">Monitor your child's academic progress, homework, assessments and performance — all in one place.</p>
        </div>
        <img src={parentBanner} alt="" className="absolute right-0 top-0 h-full object-cover opacity-80" style={{ maxWidth: "300px" }} />
      </div>

      <div className="container mx-auto px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center">
            <GraduationCap className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Parent Dashboard</h2>
            <p className="text-sm text-muted-foreground">Welcome, {user?.email}</p>
          </div>
        </div>

        {/* Child selector */}
        {children.length > 0 && (
          <Card className="cursor-pointer border-2 border-purple-100">
            <CardContent className="py-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gray-800 flex items-center justify-center text-white font-bold">
                {(selectedChildData?.full_name || "S").charAt(0)}
              </div>
              <div>
                <p className="font-semibold text-lg">{selectedChildData?.full_name ?? "Student"}</p>
                <p className="text-sm text-muted-foreground">Grade: {selectedChildData?.class_grade ?? "—"}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Tests Taken", value: scores.length, icon: BarChart3, color: "text-blue-600" },
            { label: "Avg Score", value: avgScore !== null ? `${avgScore}%` : "—", icon: TrendingUp, color: "text-green-600" },
            { label: "Homework Done", value: `${completedHW}/${homework.length}`, icon: BookOpen, color: "text-purple-600" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="py-4 flex items-center gap-3">
                <s.icon className={`h-6 w-6 ${s.color}`} />
                <div>
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="scores">
          <TabsList>
            <TabsTrigger value="scores" className="gap-1.5"><BarChart3 className="h-4 w-4" /> Test Scores</TabsTrigger>
            <TabsTrigger value="homework" className="gap-1.5"><BookOpen className="h-4 w-4" /> Homework</TabsTrigger>
          </TabsList>

          {/* Test Scores */}
          <TabsContent value="scores">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Assessment Results</CardTitle>
                <p className="text-sm text-muted-foreground">Your child's diagnostic test scores</p>
              </CardHeader>
              <CardContent>
                {scores.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No test results yet.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-center">Age Group</TableHead><TableHead className="text-center">Questions</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {scores.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="text-sm">{s.completed_at ? new Date(s.completed_at).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-center">{(s as any).age_group ? `${(s as any).age_group}+` : "—"}</TableCell>
                          <TableCell className="text-center">{s.total_questions ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Homework */}
          <TabsContent value="homework">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5" /> Homework Status</CardTitle></CardHeader>
              <CardContent>
                {homework.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No homework assigned yet.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Due Date</TableHead><TableHead className="text-center">Score</TableHead><TableHead className="text-center">Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {homework.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell className="font-medium">{h.title}</TableCell>
                          <TableCell className="text-sm">{h.due_date ? new Date(h.due_date).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-center">{h.score !== null ? `${h.score}` : "—"}</TableCell>
                          <TableCell className="text-center">
                            {h.status === "graded" ? <Badge className="bg-green-100 text-green-800">Graded</Badge>
                              : h.status === "completed" ? <Badge className="bg-blue-100 text-blue-800">Submitted</Badge>
                              : <Badge variant="outline">Pending</Badge>}
                          </TableCell>
                          <TableCell>{h.status === "graded" && <button onClick={() => setReportRow(h)} className="text-xs text-blue-600 hover:underline font-medium">View Report</button>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Report Modal */}
      {reportRow && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setReportRow(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-gray-900">{reportRow.title}</h3>
              <button onClick={() => setReportRow(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="space-y-3 mb-5">
              {(reportRow.answers ?? []).map((a: any, i: number) => (
                <div key={i} className="border border-gray-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-gray-800 mb-1">Q{i+1}. {a.question}</p>
                  <p className="text-sm text-gray-500">Answer: <span className="text-gray-800 font-medium">{a.answer}</span></p>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 pt-4 mb-3">
              <p className="text-sm text-gray-600 mb-1">Score (0–100)</p>
              <div className="border border-gray-200 rounded-xl px-4 py-3 text-sm font-semibold text-gray-800">{reportRow.score ?? "—"}</div>
            </div>
            {reportRow.feedback && (
              <div className="mb-3">
                <p className="text-sm text-gray-600 mb-1">Feedback</p>
                <div className="border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800">{reportRow.feedback}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
