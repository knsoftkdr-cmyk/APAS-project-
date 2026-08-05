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
import { GraduationCap, BookOpen, BarChart3, TrendingUp, Bus, Wallet, ChevronRight } from "lucide-react";
import { BusTrackingMap } from "@/components/transport/BusTrackingMap";
import { DriverRatingForm } from "@/components/transport/DriverRatingForm";
import { Link } from "react-router-dom";
import parentBanner from "@/assets/parent-banner.png";
import { DashboardHero } from "@/components/dashboard/DashboardHero";
import parentBanner from "@/assets/parent-banner.png";

interface Child { id: string; full_name: string | null; class_grade: string | null; }
interface HomeworkRow { id: string; title: string; due_date: string | null; status: string; score: number | null; feedback: string | null; answers: any[]; }
interface ScoreRow { id: string; score: number | null; completed_at: string | null; total_questions: number | null; age_group?: number; }
interface TransportInfo {
  routeName: string;
  routeNumber: string | null;
  routeId: string | null;
  vehicleId: string | null;
  pickupStopId: string | null;
  dropStopId: string | null;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  pickupTime: string | null;
  studentId: string | null;
}

export default function ParentDashboard() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [homework, setHomework] = useState<HomeworkRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [reportRow, setReportRow] = useState<any>(null);
  const [noLink, setNoLink] = useState(false);
  const [transportInfo, setTransportInfo] = useState<TransportInfo | null>(null);

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

  const fetchTransport = useCallback(async (childId: string) => {
    // transport_assignments.student_id references students.id, not profiles.id —
    // resolve the students row for this child's profile first.
    const { data: studentRow } = await supabase
      .from("students")
      .select("id")
      .eq("profile_id", childId)
      .maybeSingle();
    if (!studentRow) {
      setTransportInfo(null);
      return;
    }
    const { data } = await supabase
      .from("transport_assignments")
      .select("status, route_id, pickup_stop_id, drop_stop_id, transport_routes(route_name, route_number, vehicle_id, drivers(id, name, phone))")
      .eq("student_id", studentRow.id)
      .eq("status", "active")
      .maybeSingle();
    const row: any = data ?? null;
    const route: any = row?.transport_routes ?? null;
    const driver: any = route?.drivers ?? null;

    let pickupTime: string | null = null;
    if (row?.pickup_stop_id) {
      const { data: stopRow } = await supabase
        .from("route_stops")
        .select("pickup_time")
        .eq("id", row.pickup_stop_id)
        .maybeSingle();
      pickupTime = stopRow?.pickup_time ?? null;
    }

    setTransportInfo(
      route
        ? {
            routeName: route.route_name,
            routeNumber: route.route_number,
            routeId: row.route_id ?? null,
            vehicleId: route.vehicle_id ?? null,
            pickupStopId: row.pickup_stop_id ?? null,
            dropStopId: row.drop_stop_id ?? null,
            driverId: driver?.id ?? null,
            driverName: driver?.name ?? null,
            driverPhone: driver?.phone ?? null,
            pickupTime,
            studentId: studentRow.id,
          }
        : null
    );
  }, []);

  useEffect(() => { fetchChildren(); }, [fetchChildren]);
  useEffect(() => { if (selectedChild) { fetchChildData(selectedChild); fetchTransport(selectedChild); } }, [selectedChild, fetchChildData, fetchTransport]);

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
      <DashboardHero
        eyebrow="APAS Parent Portal"
        greeting="Welcome"
        name={profile?.full_name ?? "Parent"}
        dateLabel={new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        description="Monitor your child's academic progress, homework, assessments and performance — all in one place."
      />


      <div className="container mx-auto px-4 space-y-6">


        {/* Child selector */}
        {children.length > 0 && (
          <Card className="border-0 shadow-xl bg-gradient-to-r from-blue-300 to-blue-400">
            <CardContent className="py-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gray-800 flex items-center justify-center text-white font-bold shrink-0">
                {(selectedChildData?.full_name || "S").charAt(0)}
              </div>

              {children.length > 1 ? (
                <div className="flex-1">
                  <label className="text-xs text-gray-700 block mb-0.5">Viewing data for</label>
                  <select
                    className="w-full max-w-xs rounded-md border-0 bg-white/90 px-3 py-1.5 text-sm font-semibold text-gray-900"
                    value={selectedChild ?? ""}
                    onChange={(e) => setSelectedChild(e.target.value)}
                  >
                    {children.map((child) => (
                      <option key={child.id} value={child.id}>
                        {child.full_name} — Grade: {child.class_grade ?? "—"}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-lg">{selectedChildData?.full_name ?? "Student"}</p>
                  <p className="text-sm text-black-600">Grade: {selectedChildData?.class_grade ?? "—"}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Pay Fees entry point */}
        <Link to="/parent/fee-payment" state={{ studentId: selectedChild }}>
          <Card className="border-0 shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 bg-gradient-to-r from-teal-500 to-teal-600">
            <CardContent className="py-4 flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                <Wallet className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-white">Pay Fees</p>
                <p className="text-xs text-teal-50">View dues and make a payment for {selectedChildData?.full_name ?? "your child"}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-white" />
            </CardContent>
          </Card>
        </Link>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
  {
    label: "Tests Taken",
    value: scores.length,
    icon: BarChart3,
    bg: "bg-gradient-to-r from-blue-500 to-blue-500",
    iconBg: "bg-white",
    color: "text-white-600",
  },
  {
    label: "Avg Score",
    value: avgScore !== null ? `${avgScore}%` : "—",
    icon: TrendingUp,
    bg: "bg-gradient-to-r from-green-500 to-green-500",
    iconBg: "bg-white",
    color: "text-green-600",
  },
  {
    label: "Homework Done",
    value: `${completedHW}/${homework.length}`,
    icon: BookOpen,
    bg: "bg-gradient-to-r from-purple-500 to-purple-500",
    iconBg: "bg-white",
    color: "text-purple-600",
  },
].map((s) => (
              <Card
    key={s.label}
    className={`${s.bg} border-0 shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 overflow-hidden relative`}>
              <CardContent className="py-5 flex items-center gap-4">
                  <div className={`h-14 w-14 rounded-2xl text-white flex items-center justify-center ${s.iconBg}`}>
                    <s.icon className={`h-7 w-7 text-blue-600 ${s.color}`} />
                  </div>
                <div>
                  <p className="text-2xl font-bold text-white">{s.value}</p>
                  <p className="text-xs text-muted-foreground text-white">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="scores">
          <TabsList>
            <TabsTrigger value="scores" className="gap-1.5  data-[state=active]:bg-blue-600 data-[state=active]:text-white rounded-lg"><BarChart3 className="h-4 w-4" /> Test Scores</TabsTrigger>
            <TabsTrigger value="homework" className="gap-1.5 data-[state=active]:bg-blue-600 data-[state=active]:text-white rounded-lg"><BookOpen className="h-4 w-4" /> Homework</TabsTrigger>
            {transportInfo && (
              <TabsTrigger value="transport" className="gap-1.5 data-[state=active]:bg-blue-600 data-[state=active]:text-white rounded-lg"><Bus className="h-4 w-4" /> Bus Tracking</TabsTrigger>
            )}
          </TabsList>

          {/* Test Scores */}
          <TabsContent value="scores">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-xl bg-red-100 flex items-center justify-center">
                <BarChart3 className="h-7 w-7 text-red-600" /> </div>
                Assessment Results</CardTitle>
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

          {/* Bus Tracking */}
          {transportInfo && (
            <TabsContent value="transport">
              <BusTrackingMap
                busNumber={transportInfo.routeNumber ? `Route ${transportInfo.routeNumber}` : "Bus"}
                routeName={transportInfo.routeName}
                routeId={transportInfo.routeId}
                vehicleId={transportInfo.vehicleId}
                pickupStopId={transportInfo.pickupStopId}
                dropStopId={transportInfo.dropStopId}
                driverName={transportInfo.driverName}
                driverPhone={transportInfo.driverPhone}
                pickupTime={transportInfo.pickupTime}
              />
              <DriverRatingForm
                schoolId={profile?.school_id ?? null}
                parentId={user?.id ?? null}
                driverId={transportInfo.driverId}
                studentId={transportInfo.studentId}
                routeId={transportInfo.routeId}
              />
            </TabsContent>
          )}

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
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md flex items-end md:items-center justify-center z-50" onClick={() => setReportRow(null)}>
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full mx-4 shadow-xl max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom-5 zoom-in-95 fade-in duration-700 ease-out" onClick={e => e.stopPropagation()}>
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
