/**
 * HODDashboard.tsx — Head of Department Dashboard
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
import { Users, BookOpen, BarChart3, GraduationCap, TrendingUp, UserCheck } from "lucide-react";

interface TeacherRow { id: string; full_name: string | null; class_grade: string | null; }
interface StudentPerf { id: string; full_name: string | null; avg_score: number | null; tests: number; }
interface LessonRow { id: string; title: string; created_at: string; teacher_name: string | null; }

export default function HODDashboard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [students, setStudents] = useState<StudentPerf[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);

  const fetchAll = useCallback(async () => {
    if (!profile?.school_id) { setLoading(false); return; }
    setLoading(true);
    try {
      // Teachers in school
      const { data: tData } = await supabase
        .from("profiles")
        .select("id, full_name, class_grade")
        .eq("school_id", profile.school_id)
        .eq("role", "teacher");
      setTeachers(tData ?? []);

      // Student performance
      const { data: sData } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("school_id", profile.school_id)
        .eq("role", "student");

      if (sData && sData.length > 0) {
        const { data: diagData } = await supabase
          .from("diagnostic_submissions")
          .select("student_id, score")
          .not("score", "is", null);

        const map = new Map<string, { scores: number[] }>();
        for (const s of sData) map.set(s.id, { scores: [] });
        for (const d of (diagData ?? []) as any[]) {
          if (map.has(d.student_id)) map.get(d.student_id)!.scores.push(Number(d.score));
        }
        setStudents(sData.map((s) => ({
          id: s.id,
          full_name: s.full_name,
          avg_score: map.get(s.id)!.scores.length
            ? Math.round(map.get(s.id)!.scores.reduce((a, b) => a + b, 0) / map.get(s.id)!.scores.length)
            : null,
          tests: map.get(s.id)!.scores.length,
        })).sort((a, b) => (b.avg_score ?? 0) - (a.avg_score ?? 0)));
      }

      // Recent lessons
      const { data: lData } = await supabase
        .from("lessons")
        .select("id, title, created_at, profiles:created_by(full_name)")
        .order("created_at", { ascending: false })
        .limit(20);
      setLessons((lData ?? []).map((l: any) => ({
        id: l.id,
        title: l.title,
        created_at: l.created_at,
        teacher_name: l.profiles?.full_name ?? null,
      })));
    } catch (e: any) {
      toast({ title: "Error loading data", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [profile, toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) return <AppLayout><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div></AppLayout>;

  const avgScore = students.filter(s => s.avg_score !== null).length
    ? Math.round(students.filter(s => s.avg_score !== null).reduce((a, s) => a + (s.avg_score ?? 0), 0) / students.filter(s => s.avg_score !== null).length)
    : null;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">HOD Dashboard</h1>
            <p className="text-sm text-muted-foreground">Welcome, {profile?.full_name} — Head of Department</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Teachers", value: teachers.length, icon: Users, color: "text-blue-600" },
            { label: "Students", value: students.length, icon: GraduationCap, color: "text-green-600" },
            { label: "Avg Score", value: avgScore !== null ? `${avgScore}%` : "—", icon: TrendingUp, color: "text-purple-600" },
            { label: "Lessons", value: lessons.length, icon: BookOpen, color: "text-orange-600" },
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

        <Tabs defaultValue="teachers" className="space-y-4">
          <TabsList>
            <TabsTrigger value="teachers" className="gap-1.5"><Users className="h-4 w-4" /> Teachers</TabsTrigger>
            <TabsTrigger value="students" className="gap-1.5"><GraduationCap className="h-4 w-4" /> Students</TabsTrigger>
            <TabsTrigger value="lessons" className="gap-1.5"><BookOpen className="h-4 w-4" /> Lessons</TabsTrigger>
          </TabsList>

          {/* Teachers Tab */}
          <TabsContent value="teachers">
            <Card>
              <CardHeader><CardTitle>Department Teachers</CardTitle><CardDescription>All teachers in your school</CardDescription></CardHeader>
              <CardContent className="p-0">
                {teachers.length === 0 ? (
                  <p className="p-6 text-center text-muted-foreground text-sm">No teachers found.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Grade</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {teachers.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium">{t.full_name ?? "Unknown"}</TableCell>
                          <TableCell>{t.class_grade ?? "—"}</TableCell>
                          <TableCell><Badge className="bg-green-100 text-green-800">Active</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Students Tab */}
          <TabsContent value="students">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Student Performance</CardTitle></CardHeader>
              <CardContent className="p-0">
                {students.length === 0 ? (
                  <p className="p-6 text-center text-muted-foreground text-sm">No students found.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Student</TableHead><TableHead className="text-center">Tests</TableHead><TableHead className="text-center">Avg Score</TableHead><TableHead className="text-center">Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {students.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.full_name ?? "Unknown"}</TableCell>
                          <TableCell className="text-center">{s.tests}</TableCell>
                          <TableCell className="text-center font-semibold">{s.avg_score !== null ? `${s.avg_score}%` : "—"}</TableCell>
                          <TableCell className="text-center">
                            {s.avg_score === null ? <Badge variant="outline">No data</Badge>
                              : s.avg_score >= 75 ? <Badge className="bg-green-100 text-green-800">On Track</Badge>
                              : s.avg_score >= 50 ? <Badge className="bg-yellow-100 text-yellow-800">Needs Attention</Badge>
                              : <Badge className="bg-red-100 text-red-800">At Risk</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lessons Tab */}
          <TabsContent value="lessons">
            <Card>
              <CardHeader><CardTitle>Recent Lesson Plans</CardTitle><CardDescription>Latest lessons submitted by teachers</CardDescription></CardHeader>
              <CardContent className="p-0">
                {lessons.length === 0 ? (
                  <p className="p-6 text-center text-muted-foreground text-sm">No lessons yet.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Lesson Title</TableHead><TableHead>Teacher</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {lessons.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-medium">{l.title}</TableCell>
                          <TableCell>{l.teacher_name ?? "Unknown"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(l.created_at).toLocaleDateString()}</TableCell>
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
    </AppLayout>
  );
}
