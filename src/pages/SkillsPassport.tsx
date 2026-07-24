import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Award, Sparkles, Gauge, Flame } from "lucide-react";

interface Competency {
  id: string;
  subject: string;
  name: string;
  description: string | null;
  grade_level: string | null;
}

interface LatestAssessment {
  competency_id: string;
  proficiency: "beginner" | "developing" | "proficient" | "advanced";
  assessed_date: string;
  notes: string | null;
}

interface ChildOption {
  id: string; // profiles.id
  full_name: string;
}

const PROFICIENCY_COLOR: Record<string, string> = {
  beginner: "bg-red-100 text-red-700 border-red-200",
  developing: "bg-amber-100 text-amber-700 border-amber-200",
  proficient: "bg-blue-100 text-blue-700 border-blue-200",
  advanced: "bg-green-100 text-green-700 border-green-200",
};

const PROFICIENCY_LABEL: Record<string, string> = {
  beginner: "Beginner",
  developing: "Developing",
  proficient: "Proficient",
  advanced: "Advanced",
};

export default function SkillsPassport() {
  const { profile, user } = useAuth();

  const isParent = profile?.role === "parent";

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [loadingChildren, setLoadingChildren] = useState(isParent);

  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [latestByCompetency, setLatestByCompetency] = useState<
    Record<string, LatestAssessment>
  >({});
  const [loading, setLoading] = useState(true);
  const [studentName, setStudentName] = useState<string>("");

  const [indices, setIndices] = useState<{ confidence: number | null; motivation: number | null }>({
    confidence: null,
    motivation: null,
  });
  const [indicesLoading, setIndicesLoading] = useState(true);
  const [studentPk, setStudentPk] = useState<string | null>(null);

  // Determine the target student id: self, or selected child if parent
  const targetStudentId = isParent ? selectedChildId : user?.id;

  // If parent, load linked children
  useEffect(() => {
    if (!isParent || !user?.id) return;
    const fetchChildren = async () => {
      setLoadingChildren(true);

      const { data: links, error: linksError } = await supabase
        .from("parent_students")
        .select("student_id")
        .eq("parent_id", user.id);

      if (linksError || !links || links.length === 0) {
        setLoadingChildren(false);
        return;
      }

      const studentIds = links.map((l: any) => l.student_id);
      const { data: studentRows, error: studentsError } = await supabase
        .from("students")
        .select("profile_id, full_name")
        .in("profile_id", studentIds);

      if (!studentsError && studentRows) {
        const mapped: ChildOption[] = studentRows.map((s: any) => ({
          id: s.profile_id,
          full_name: s.full_name || "Student",
        }));
        setChildren(mapped);
        if (mapped.length > 0) setSelectedChildId(mapped[0].id);
      }
      setLoadingChildren(false);
    };
    fetchChildren();
  }, [isParent, user?.id]);

  // Load competencies + latest assessments for the target student
  useEffect(() => {
    if (!targetStudentId) {
      setLoading(false);
      return;
    }

    const fetchPassport = async () => {
      setLoading(true);

      // Get the student's school + grade + name via the students table
      const { data: studentRow, error: studentError } = await supabase
        .from("students")
        .select("id, school_id, grade, full_name")
        .eq("profile_id", targetStudentId)
        .maybeSingle();

      if (studentError || !studentRow) {
        setLoading(false);
        return;
      }
      setStudentName(studentRow.full_name || "");
      setStudentPk(studentRow.id);

      const normalizedGrade = studentRow.grade?.replace(/\D/g, "");

      const { data: compData, error: compError } = await supabase
        .from("competencies")
        .select("id, subject, name, description, grade_level")
        .eq("school_id", studentRow.school_id);

      if (compError || !compData) {
        setLoading(false);
        return;
      }

      const relevant = compData.filter((c) => {
        if (!c.grade_level || c.grade_level === "All Grades") return true;
        const compGrade = c.grade_level.replace(/\D/g, "");
        return compGrade === normalizedGrade;
      });
      setCompetencies(relevant);

      if (relevant.length > 0) {
        const { data: assessData } = await supabase
          .from("competency_assessments")
          .select("competency_id, proficiency, assessed_date, notes")
          .eq("student_id", targetStudentId)
          .in(
            "competency_id",
            relevant.map((c) => c.id)
          )
          .order("assessed_date", { ascending: false });

        const latest: Record<string, LatestAssessment> = {};
        (assessData || []).forEach((a: any) => {
          if (!latest[a.competency_id]) {
            latest[a.competency_id] = a; // first hit per competency = most recent, due to ordering
          }
        });
        setLatestByCompetency(latest);
      } else {
        setLatestByCompetency({});
      }

      setLoading(false);
    };
    fetchPassport();
  }, [targetStudentId]);

  // Compute derived indices: Confidence Index & Motivation Score
  useEffect(() => {
    if (!studentPk) {
      setIndicesLoading(false);
      return;
    }
    const computeIndices = async () => {
      setIndicesLoading(true);

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const sinceDate = ninetyDaysAgo.toISOString().split("T")[0];

      const [attendanceRes, marksRes, homeworkRes, competencyHistoryRes] = await Promise.all([
        supabase
          .from("attendance_records")
          .select("status, date")
          .eq("student_id", studentPk)
          .gte("date", sinceDate),
        supabase
          .from("student_marks")
          .select("marks_obtained, max_marks, exam_date")
          .eq("student_id", studentPk)
          .order("exam_date", { ascending: false }),
        supabase
          .from("homework_submissions")
          .select("completed, submission_percentage, submitted_at")
          .eq("student_id", studentPk),
        supabase
          .from("competency_assessments")
          .select("competency_id, proficiency, assessed_date")
          .eq("student_id", studentPk)
          .order("assessed_date", { ascending: false }),
      ]);

      const ATTENDANCE_WEIGHT: Record<string, number> = {
        present: 1,
        late: 0.75,
        half_day: 0.5,
        absent: 0,
      };

      // --- Attendance rate ---
      let attendanceRate: number | null = null;
      const attendanceRows = (attendanceRes.data || []).filter((r: any) => r.status !== "excused");
      if (attendanceRows.length > 0) {
        const weightedSum = attendanceRows.reduce(
          (sum: number, r: any) => sum + (ATTENDANCE_WEIGHT[r.status] ?? 0),
          0
        );
        attendanceRate = (weightedSum / attendanceRows.length) * 100;
      }

      // --- Academic performance + trend ---
      let academicPerf: number | null = null;
      let academicTrendScore: number | null = null;
      const marksRows = (marksRes.data || []).filter((m: any) => m.max_marks > 0);
      if (marksRows.length > 0) {
        const pctOf = (m: any) => (m.marks_obtained / m.max_marks) * 100;
        academicPerf = marksRows.reduce((sum: number, m: any) => sum + pctOf(m), 0) / marksRows.length;

        if (marksRows.length >= 2) {
          const mid = Math.max(1, Math.floor(marksRows.length / 2));
          const recentHalf = marksRows.slice(0, mid);
          const olderHalf = marksRows.slice(mid);
          const recentAvg = recentHalf.reduce((s: number, m: any) => s + pctOf(m), 0) / recentHalf.length;
          const olderAvg = olderHalf.reduce((s: number, m: any) => s + pctOf(m), 0) / olderHalf.length;
          const delta = recentAvg - olderAvg;
          academicTrendScore = Math.min(100, Math.max(0, 50 + delta));
        } else {
          academicTrendScore = 50; // neutral, not enough history
        }
      }

      // --- Homework completion + quality ---
      let homeworkComponent: number | null = null;
      const hwRows = homeworkRes.data || [];
      if (hwRows.length > 0) {
        const completedCount = hwRows.filter((h: any) => h.completed).length;
        const completionRate = (completedCount / hwRows.length) * 100;
        const scored = hwRows.filter((h: any) => h.submission_percentage !== null);
        const avgQuality =
          scored.length > 0
            ? scored.reduce((s: number, h: any) => s + Number(h.submission_percentage), 0) / scored.length
            : completionRate;
        homeworkComponent = 0.6 * completionRate + 0.4 * avgQuality;
      }

      // --- Competency level + trend ---
      const PROFICIENCY_NUM: Record<string, number> = {
        beginner: 25,
        developing: 50,
        proficient: 75,
        advanced: 100,
      };
      let competencyScore: number | null = null;
      let competencyTrendScore: number | null = null;
      const compHistory = competencyHistoryRes.data || [];
      if (compHistory.length > 0) {
        const byCompetency: Record<string, any[]> = {};
        compHistory.forEach((a: any) => {
          if (!byCompetency[a.competency_id]) byCompetency[a.competency_id] = [];
          byCompetency[a.competency_id].push(a); // already sorted desc by assessed_date
        });

        const latestScores = Object.values(byCompetency).map(
          (rows) => PROFICIENCY_NUM[rows[0].proficiency] ?? 50
        );
        competencyScore = latestScores.reduce((s, v) => s + v, 0) / latestScores.length;

        const trendDeltas: number[] = [];
        Object.values(byCompetency).forEach((rows) => {
          if (rows.length >= 2) {
            const latestNum = PROFICIENCY_NUM[rows[0].proficiency] ?? 50;
            const prevNum = PROFICIENCY_NUM[rows[1].proficiency] ?? 50;
            trendDeltas.push(latestNum - prevNum);
          }
        });
        competencyTrendScore =
          trendDeltas.length > 0
            ? Math.min(100, Math.max(0, 50 + trendDeltas.reduce((s, v) => s + v, 0) / trendDeltas.length))
            : 50;
      }

      // --- Confidence Index: academics 35% + trend 20% + attendance 20% + competency 25% ---
      const confidenceParts: { value: number; weight: number }[] = [];
      if (academicPerf !== null) confidenceParts.push({ value: academicPerf, weight: 0.35 });
      if (academicTrendScore !== null) confidenceParts.push({ value: academicTrendScore, weight: 0.2 });
      if (attendanceRate !== null) confidenceParts.push({ value: attendanceRate, weight: 0.2 });
      if (competencyScore !== null) confidenceParts.push({ value: competencyScore, weight: 0.25 });

      const confidence =
        confidenceParts.length > 0
          ? Math.round(
              confidenceParts.reduce((s, p) => s + p.value * p.weight, 0) /
                confidenceParts.reduce((s, p) => s + p.weight, 0)
            )
          : null;

      // --- Motivation Score: attendance 30% + homework 40% + competency trend 30% ---
      const motivationParts: { value: number; weight: number }[] = [];
      if (attendanceRate !== null) motivationParts.push({ value: attendanceRate, weight: 0.3 });
      if (homeworkComponent !== null) motivationParts.push({ value: homeworkComponent, weight: 0.4 });
      if (competencyTrendScore !== null) motivationParts.push({ value: competencyTrendScore, weight: 0.3 });

      const motivation =
        motivationParts.length > 0
          ? Math.round(
              motivationParts.reduce((s, p) => s + p.value * p.weight, 0) /
                motivationParts.reduce((s, p) => s + p.weight, 0)
            )
          : null;

      setIndices({ confidence, motivation });
      setIndicesLoading(false);
    };

    computeIndices();
  }, [studentPk]);

  const grouped = competencies.reduce<Record<string, Competency[]>>((acc, c) => {
    if (!acc[c.subject]) acc[c.subject] = [];
    acc[c.subject].push(c);
    return acc;
  }, {});

  const assessedCount = Object.keys(latestByCompetency).length;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Award className="h-6 w-6 text-primary" />
              Skills Passport
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {studentName
                ? `${studentName}'s competency progress across subjects.`
                : "Competency progress across subjects."}
            </p>
          </div>

          {isParent && (
            <Select
              value={selectedChildId}
              onValueChange={setSelectedChildId}
              disabled={loadingChildren || children.length === 0}
            >
              <SelectTrigger className="w-56">
                <SelectValue
                  placeholder={loadingChildren ? "Loading..." : "Select child"}
                />
              </SelectTrigger>
              <SelectContent>
                {children.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {targetStudentId && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardContent className="py-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <Gauge className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Confidence Index</p>
                    <p className="text-xs text-muted-foreground truncate">
                      Academics, trend &amp; attendance
                    </p>
                  </div>
                </div>
                {indicesLoading ? (
                  <span className="text-sm text-muted-foreground shrink-0">Loading...</span>
                ) : indices.confidence === null ? (
                  <Badge variant="outline" className="text-muted-foreground border-dashed shrink-0">
                    Insufficient data
                  </Badge>
                ) : (
                  <span className="text-2xl font-semibold text-blue-600 shrink-0">
                    {indices.confidence}
                    <span className="text-sm text-muted-foreground">/100</span>
                  </span>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                    <Flame className="h-5 w-5 text-orange-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Motivation Score</p>
                    <p className="text-xs text-muted-foreground truncate">
                      Attendance, homework &amp; growth
                    </p>
                  </div>
                </div>
                {indicesLoading ? (
                  <span className="text-sm text-muted-foreground shrink-0">Loading...</span>
                ) : indices.motivation === null ? (
                  <Badge variant="outline" className="text-muted-foreground border-dashed shrink-0">
                    Insufficient data
                  </Badge>
                ) : (
                  <span className="text-2xl font-semibold text-orange-600 shrink-0">
                    {indices.motivation}
                    <span className="text-sm text-muted-foreground">/100</span>
                  </span>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {isParent && children.length === 0 && !loadingChildren ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No linked students found on your account.
            </CardContent>
          </Card>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : competencies.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No competencies have been defined for this grade yet.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              {assessedCount} of {competencies.length} competencies assessed
            </div>

            {Object.entries(grouped).map(([subject, comps]) => (
              <Card key={subject}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{subject}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {comps.map((c) => {
                    const latest = latestByCompetency[c.id];
                    return (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-4 py-2 border-b last:border-0"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{c.name}</p>
                          {c.description && (
                            <p className="text-sm text-muted-foreground truncate">
                              {c.description}
                            </p>
                          )}
                          {latest?.notes && (
                            <p className="text-xs text-muted-foreground italic mt-1">
                              "{latest.notes}"
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          {latest ? (
                            <>
                              <Badge
                                variant="outline"
                                className={`border ${PROFICIENCY_COLOR[latest.proficiency]}`}
                              >
                                {PROFICIENCY_LABEL[latest.proficiency]}
                              </Badge>
                              <p className="text-xs text-muted-foreground mt-1">
                                {latest.assessed_date}
                              </p>
                            </>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Not yet assessed
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>
    </AppLayout>
  );
}
