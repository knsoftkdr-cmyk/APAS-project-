import { useEffect, useMemo, useState } from "react";
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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Flame } from "lucide-react";
import { normalizeSubject } from "@/lib/subjectUtils";

interface ClassRow {
  id: string;
  name: string;
  section: string;
}

interface Competency {
  id: string;
  subject: string;
  name: string;
  grade_level: string | null;
}

interface CompetencyRow {
  competencyId: string;
  competencyName: string;
  beginner: number;
  developing: number;
  proficient: number;
  advanced: number;
  total: number;
}

interface ClassDistribution {
  classId: string;
  classLabel: string;
  rows: CompetencyRow[];
  total: number;
}

const PROFICIENCY_COLORS: Record<string, string> = {
  beginner: "rgb(239, 68, 68)", // red-500
  developing: "rgb(245, 158, 11)", // amber-500
  proficient: "rgb(59, 130, 246)", // blue-500
  advanced: "rgb(34, 197, 94)", // green-500
};

// --- NEW: simple responsive hook ---------------------------------------
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= breakpoint : false
  );
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [breakpoint]);
  return isMobile;
}

export default function CompetencyHeatmap() {
  const { profile } = useAuth();
  const schoolId = profile?.school_id;
  const isMobile = useIsMobile(); // --- NEW ---

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [allCompetencies, setAllCompetencies] = useState<Competency[]>([]);
  const [subjectFilter, setSubjectFilter] = useState<string>("");
  const [gradeFilter, setGradeFilter] = useState<string>("all");

  const [classDistributions, setClassDistributions] = useState<ClassDistribution[]>([]);
  const [loading, setLoading] = useState(true);

  const [subjectMasterList, setSubjectMasterList] = useState<string[]>([]);

  useEffect(() => {
    if (!schoolId) return;
    const fetchSubjectMasterList = async () => {
      const [classTeachersRes, teacherSubjectsRes, competenciesRes] = await Promise.all([
        supabase
          .from("class_teachers")
          .select("subject, classes!inner(school_id)")
          .eq("classes.school_id", schoolId),
        supabase.from("teacher_subjects").select("subject").eq("school_id", schoolId),
        supabase.from("competencies").select("subject").eq("school_id", schoolId),
      ]);
      const rawSubjects: string[] = [
        ...(classTeachersRes.data || []).map((r: any) => r.subject),
        ...(teacherSubjectsRes.data || []).map((r: any) => r.subject),
        ...(competenciesRes.data || []).map((r: any) => r.subject),
      ].filter(Boolean);
      const normalized = new Map<string, string>();
      for (const raw of rawSubjects) {
        const clean = normalizeSubject(raw);
        normalized.set(clean.toLowerCase(), clean);
      }
      setSubjectMasterList(Array.from(normalized.values()).sort());
    };
    fetchSubjectMasterList();
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    const load = async () => {
      setLoading(true);
      const [{ data: classData }, { data: compData }] = await Promise.all([
        supabase.from("classes").select("id, name, section").eq("school_id", schoolId),
        supabase
          .from("competencies")
          .select("id, subject, name, grade_level")
          .eq("school_id", schoolId),
      ]);
      setClasses(classData || []);
      setAllCompetencies(compData || []);
      setLoading(false);
    };
    load();
  }, [schoolId]);

  useEffect(() => {
    if ((subjectMasterList.length > 0 || allCompetencies.length > 0) && !subjectFilter) {
      const subjectsWithCompetencies = new Set(allCompetencies.map((c) => c.subject));
      const preferred = subjectMasterList.find((s) => subjectsWithCompetencies.has(s));
      setSubjectFilter(preferred || subjectMasterList[0] || allCompetencies[0]?.subject || "");
    }
  }, [subjectMasterList, allCompetencies, subjectFilter]);

  const subjects = subjectMasterList;

  const visibleCompetencies = useMemo(() => {
    return allCompetencies.filter((c) => {
      const subjectOk = !subjectFilter || c.subject === subjectFilter;
      const gradeOk =
        gradeFilter === "all" ||
        !c.grade_level ||
        c.grade_level === "All Grades" ||
        c.grade_level === gradeFilter;
      return subjectOk && gradeOk;
    });
  }, [allCompetencies, subjectFilter, gradeFilter]);

  const gradeOptions = useMemo(() => {
    const grades = new Set(classes.map((c) => c.name).filter(Boolean));
    return Array.from(grades).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }, [classes]);

  useEffect(() => {
    if (!schoolId || visibleCompetencies.length === 0 || classes.length === 0) {
      setClassDistributions([]);
      return;
    }

    const aggregate = async () => {
      const competencyIds = visibleCompetencies.map((c) => c.id);
      const classIds = classes.map((c) => c.id);

      const { data, error } = await supabase
        .from("competency_assessments")
        .select("student_id, competency_id, class_id, proficiency, assessed_date")
        .in("competency_id", competencyIds)
        .in("class_id", classIds)
        .order("assessed_date", { ascending: false });

      if (error || !data) {
        console.error(error);
        return;
      }

      const latestPerStudentCompetency = new Map<string, (typeof data)[number]>();
      for (const row of data) {
        const key = `${row.student_id}::${row.competency_id}`;
        if (!latestPerStudentCompetency.has(key)) {
          latestPerStudentCompetency.set(key, row);
        }
      }

      const counts = new Map<
        string, 
        { beginner: number; developing: number; proficient: number; advanced: number }
      >();
      for (const row of latestPerStudentCompetency.values()) {
        const key = `${row.class_id}::${row.competency_id}`;
        const existing =
          counts.get(key) || {
            beginner: 0,
            developing: 0,
            proficient: 0,
            advanced: 0,
          };
        if (row.proficiency in existing) {
          (existing as any)[row.proficiency] += 1;
        }
        counts.set(key, existing);
      }

      const result: ClassDistribution[] = classes.map((cls) => {
        const rows: CompetencyRow[] = visibleCompetencies
          .map((comp) => {
            const c = counts.get(`${cls.id}::${comp.id}`) || {
              beginner: 0,
              developing: 0,
              proficient: 0,
              advanced: 0,
            };
            const total = c.beginner + c.developing + c.proficient + c.advanced;
            return {
              competencyId: comp.id,
              competencyName: comp.name,
              beginner: c.beginner,
              developing: c.developing,
              proficient: c.proficient,
              advanced: c.advanced,
              total,
            };
          })
          .filter((r) => r.total > 0);

        return {
          classId: cls.id,
          classLabel: `${cls.name} ${cls.section}`.trim(),
          rows,
          total: rows.reduce((sum, r) => sum + r.total, 0),
        };
      });

      result.sort((a, b) =>
        a.classLabel.localeCompare(b.classLabel, undefined, { numeric: true })
      );

      setClassDistributions(result);
    };
    aggregate();
  }, [schoolId, visibleCompetencies, classes]);

  const chartData = classDistributions.filter((c) => c.total > 0);
  const hasAnyData = chartData.length > 0;

  // --- NEW: responsive sizing constants -----------------------------------
  const rowHeight = isMobile ? 130 : 90;
  const baseHeight = isMobile ? 170 : 140;
  const yAxisWidth = isMobile ? 92 : 140;
  const barSize = isMobile ? 12 : 16;
  const chartMargin = isMobile
    ? { top: 8, right: 10, left: 0, bottom: 8 }
    : { top: 8, right: 24, left: 8, bottom: 8 };

  // --- NEW: wraps long competency names onto up to 2 lines so they never
  // get clipped, instead of relying on a single fixed-width line ----------
  const renderYAxisTick = (props: any) => {
    const { x, y, payload } = props;
    const text: string = String(payload.value);
    const maxChars = isMobile ? 12 : 20;

    let lines: string[];
    if (text.length <= maxChars) {
      lines = [text];
    } else {
      const words = text.split(" ");
      const built: string[] = [];
      let current = "";
      for (const w of words) {
        if ((current + " " + w).trim().length > maxChars && current) {
          built.push(current.trim());
          current = w;
        } else {
          current = (current + " " + w).trim();
        }
      }
      if (current) built.push(current);
      // cap at 2 lines, merge any overflow into the second line
      lines = built.length > 2 ? [built[0], built.slice(1).join(" ")] : built;
    }

    const lineHeight = isMobile ? 11 : 13;
    const startY = y - ((lines.length - 1) * lineHeight) / 2;

    return (
      <g>
        {lines.map((line, i) => (
          <text
            key={i}
            x={x}
            y={startY + i * lineHeight}
            dy={4}
            textAnchor="end"
            fontSize={isMobile ? 10 : 12}
            fill="#374151"
          >
            {line}
          </text>
        ))}
      </g>
    );
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-600 via-purple-500 to-indigo-500 p-8 text-white">
          <div className="absolute top-6 right-10 w-16 h-16 rounded-full border border-white/30" />
          <div className="relative z-10 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Flame className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Competency Heatmap</h1>
              <p className="text-purple-100 mt-1">Average proficiency by class, across every competency in a subject.</p>
            </div>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select subject" />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All grades" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All grades</SelectItem>
              {gradeOptions.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
        ) : subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No competencies defined yet. Add some from Competency & Outcomes Management first.
          </p>
        ) : visibleCompetencies.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No competencies match this filter.
          </p>
        ) : !hasAnyData ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No assessments recorded yet for {subjectFilter}.
          </p>
        ) : (
          <div className="space-y-4">
            {chartData.map((cls) => (
              <Card key={cls.classId}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {cls.classLabel} — {subjectFilter}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    style={{
                      height: Math.max(baseHeight, (cls.rows?.length ?? 0) * rowHeight),
                    }}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={cls.rows ?? []}
                        layout="vertical"
                        margin={chartMargin}
                        barCategoryGap={isMobile ? "30%" : "20%"}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                        <YAxis
                          type="category"
                          dataKey="competencyName"
                          width={yAxisWidth}
                          tick={renderYAxisTick}
                          interval={0}
                        />
                        <RechartsTooltip
                          formatter={(value: number, name: string) => [
                            `${value} student${value === 1 ? "" : "s"}`,
                            name.charAt(0).toUpperCase() + name.slice(1),
                          ]}
                        />
                        <Legend wrapperStyle={isMobile ? { fontSize: 11 } : undefined} />
                        <Bar
                          dataKey="beginner"
                          name="Beginner"
                          fill={PROFICIENCY_COLORS.beginner}
                          radius={[0, 4, 4, 0]}
                          barSize={barSize}
                        />
                        <Bar
                          dataKey="developing"
                          name="Developing"
                          fill={PROFICIENCY_COLORS.developing}
                          radius={[0, 4, 4, 0]}
                          barSize={barSize}
                        />
                        <Bar
                          dataKey="proficient"
                          name="Proficient"
                          fill={PROFICIENCY_COLORS.proficient}
                          radius={[0, 4, 4, 0]}
                          barSize={barSize}
                        />
                        <Bar
                          dataKey="advanced"
                          name="Advanced"
                          fill={PROFICIENCY_COLORS.advanced}
                          radius={[0, 4, 4, 0]}
                          barSize={barSize}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}