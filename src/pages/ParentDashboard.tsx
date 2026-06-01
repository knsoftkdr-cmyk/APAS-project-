/**
 * ParentDashboard.tsx — Parent Dashboard
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GraduationCap, BookOpen, BarChart3, Users, FileText } from "lucide-react";
import parentBanner from "@/assets/parent-banner.png";

interface Child { id: string; full_name: string | null; class_grade: string | null; }
interface HomeworkRow { id: string; title: string; due_date: string | null; status: string; }
interface ScoreRow { id: string; score: number | null; completed_at: string | null; total_questions: number | null; }

export default function ParentDashboard() {
  const { profile, user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [homework, setHomework] = useState<HomeworkRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [noLink, setNoLink] = useState(false);

  // Fetch children linked to this parent
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

  // Fetch data for selected child
  const fetchChildData = useCallback(async (childId: string) => {
    setLoading(true);
    try {
      // Homework
      const { data: hwData } = await supabase
        .from("homework_assignments")
        .select("id, title, due_date")
        .order("due_date", { ascending: false })
        .limit(20);

      // Homework submissions for this student
      const { data: subData } = await supabase
        .from("homework_submissions")
        .select("assignment_id, status")
        .eq("student_id", childId);

      const subMap = new Map((subData ?? []).map((s: any) => [s.assignment_id, s.status]));
      setHomework((hwData ?? []).map((h: any) => ({
        id: h.id,
        title: h.title,
        due_date: h.due_date,
        status: subMap.get(h.id) ?? "pending",
      })));

      // Diagnostic scores
      const { data: scoreData } = await supabase
        .from("diagnostic_submissions")
        .select("id, score, completed_at, total_questions")
        .eq("student_id", childId)
        .order("completed_at", { ascending: false })
        .limit(20);
      setScores(scoreData ?? []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchChildren(); }, [fetchChildren]);
  useEffect(() => { if (selectedChild) fetchChildData(selectedChild); }, [selectedChild, fetchChildData]);

  const selectedChildData = children.find(c => c.id === selectedChild);
  const avgScore = scores.filter(s => s.score !== null).length
    ? Math.round(scores.filter(s => s.score !== null).reduce((a, s) => a + (s.score ?? 0), 0) / scores.filter(s => s.score !== null).length)
    : null;
  const completedHW = homework.filter(h => h.status === "submitted" || h.status === "graded").length;

  if (noLink) return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6">
        <Card>
          <CardContent className="py-12 text-center">
            <GraduationCap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">No Students Linked</h2>
            <p className="text-muted-foreground text-sm">Please contact the school admin to link your child's account to your parent profile.</p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );

  if (loading && children.length === 0) return <AppLayout><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div></AppLayout>;

  return (
    <AppLayout>
{/* Hero Banner */}
<div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-[#EDE9FE] via-[#DDD6FE] to-[#C4B5FD] p-8 relative min-h-[220px]">

  {/* Decorative Circles */}
  <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/40"></div>
  <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/40"></div>
  <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>

  {/* Stars */}
  <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
  <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
  <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>
  <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
  <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
  <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
  <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

  {/* Triangles */}
  <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

  <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

  <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>

  {/* Text */}
  <div className="max-w-xl relative z-10">
    <h1 className="text-5xl font-bold text-slate-900">
      Welcome, {profile?.full_name || "Parent"}
    </h1>

    <p className="mt-3 text-slate-850 text-lg">
      {new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}
    </p>

    <p className="mt-4 text-slate-700">
      Monitor your child's academic progress, homework,
      assessments and performance — all in one place.
    </p>
  </div>

  {/* Parent Banner Image */}
  <img
    src={parentBanner}
    alt="Parent Dashboard"
    className="absolute right-10 bottom-5 h-[150px] object-contain"
  />
</div>
      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Parent Dashboard</h1>
              <p className="text-sm text-muted-foreground">Welcome, {profile?.full_name}</p>
            </div>
          </div>
          {children.length > 1 && (
            <Select value={selectedChild ?? ""} onValueChange={setSelectedChild}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Select child" /></SelectTrigger>
              <SelectContent>
                {children.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.full_name ?? "Unknown"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Child info */}
        {selectedChildData && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-4 pb-4 flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground text-lg font-bold">
                {(selectedChildData.full_name || "S").charAt(0)}
              </div>
              <div>
                <p className="font-semibold text-lg">{selectedChildData.full_name ?? "Student"}</p>
                <p className="text-sm text-muted-foreground">Grade: {selectedChildData.class_grade ?? "—"}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: "Tests Taken", value: scores.length, icon: BarChart3, color: "text-blue-600" },
            { label: "Avg Score", value: avgScore !== null ? `${avgScore}%` : "—", icon: TrendingUp, color: "text-green-600" },
            { label: "Homework Done", value: `${completedHW}/${homework.length}`, icon: BookOpen, color: "text-purple-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-6 pb-4 flex items-center gap-4">
                <div className={`rounded-lg bg-muted p-2 ${color}`}><Icon className="h-5 w-5" /></div>
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : (
          <Tabs defaultValue="scores" className="space-y-4">
            <TabsList>
              <TabsTrigger value="scores" className="gap-1.5"><BarChart3 className="h-4 w-4" /> Test Scores</TabsTrigger>
              <TabsTrigger value="homework" className="gap-1.5"><BookOpen className="h-4 w-4" /> Homework</TabsTrigger>
            </TabsList>

            {/* Scores */}
            <TabsContent value="scores">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Assessment Results</CardTitle><CardDescription>Your child's diagnostic test scores</CardDescription></CardHeader>
                <CardContent className="p-0">
                  {scores.length === 0 ? (
                    <p className="p-6 text-center text-muted-foreground text-sm">No test results yet.</p>
                  ) : (
                    <Table>
                      <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-center">Score</TableHead><TableHead className="text-center">Questions</TableHead><TableHead className="text-center">Result</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {scores.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="text-sm">{s.completed_at ? new Date(s.completed_at).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-center font-semibold">{s.score !== null ? `${s.score}%` : "—"}</TableCell>
                            <TableCell className="text-center">{s.total_questions ?? "—"}</TableCell>
                            <TableCell className="text-center">
                              {s.score === null ? <Badge variant="outline">—</Badge>
                                : s.score >= 75 ? <Badge className="bg-green-100 text-green-800">Good</Badge>
                                : s.score >= 50 ? <Badge className="bg-yellow-100 text-yellow-800">Average</Badge>
                                : <Badge className="bg-red-100 text-red-800">Needs Help</Badge>}
                            </TableCell>
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
                <CardContent className="p-0">
                  {homework.length === 0 ? (
                    <p className="p-6 text-center text-muted-foreground text-sm">No homework assigned yet.</p>
                  ) : (
                    <Table>
                      <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Due Date</TableHead><TableHead className="text-center">Status</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {homework.map((h) => (
                          <TableRow key={h.id}>
                            <TableCell className="font-medium">{h.title}</TableCell>
                            <TableCell className="text-sm">{h.due_date ? new Date(h.due_date).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-center">
                              {h.status === "graded" ? <Badge className="bg-green-100 text-green-800">Graded</Badge>
                                : h.status === "submitted" ? <Badge className="bg-blue-100 text-blue-800">Submitted</Badge>
                                : <Badge variant="outline">Pending</Badge>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}

// Missing import fix
function TrendingUp(props: any) { return <BarChart3 {...props} />; }
