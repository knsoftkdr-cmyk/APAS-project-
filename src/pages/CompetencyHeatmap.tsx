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

export default function CompetencyHeatmap() {
  const { profile } = useAuth();
  const schoolId = profile?.school_id;

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [allCompetencies, setAllCompetencies] = useState<Competency[]>([]);
  const [subjectFilter, setSubjectFilter] = useState<string>("");
  const [gradeFilter, setGradeFilter] = useState<string>("all");

  const [classDistributions, setClassDistributions] = useState<ClassDistribution[]>([]);
  const [loading, setLoading] = useState(true);

  // School-wide, deduplicated subject list — merged from class_teachers,
  // teacher_subjects, and existing competencies, same source as CompetencyDefinitions.tsx
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

  // Load classes + all competencies for this school
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

  // Default subject selection once the master list arrives — prefer a subject
  // that actually has competencies defined, so the heatmap isn't defaulted
  // into an empty subject just because it's alphabetically first school-wide.
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

  // Fetch and aggregate assessments: count of (student, competency) data points per proficiency level, per class
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

      // Keep only the most recent assessment per (student_id, competency_id)
      const latestPerStudentCompetency = new Map<string, (typeof data)[number]>();
      for (const row of data) {
        const key = `${row.student_id}::${row.competency_id}`;
        if (!latestPerStudentCompetency.has(key)) {
          latestPerStudentCompetency.set(key, row);
        }
      }

      // Count how many data points fall into each proficiency level, per class + competency
      const counts = new Map<
        string, // `${classId}::${competencyId}`
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
                  <div style={{ height: Math.max(140, (cls.rows?.length ?? 0) * 90) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={cls.rows ?? []}
                        layout="vertical"
                        margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                        <YAxis
                          type="category"
                          dataKey="competencyName"
                          width={140}
                          tick={{ fontSize: 12 }}
                        />
                        <RechartsTooltip
                          formatter={(value: number, name: string) => [
                            `${value} student${value === 1 ? "" : "s"}`,
                            name.charAt(0).toUpperCase() + name.slice(1),
                          ]}
                        />
                        <Legend />
                        <Bar
                          dataKey="beginner"
                          name="Beginner"
                          fill={PROFICIENCY_COLORS.beginner}
                          radius={[0, 4, 4, 0]}
                          barSize={16}
                        />
                        <Bar
                          dataKey="developing"
                          name="Developing"
                          fill={PROFICIENCY_COLORS.developing}
                          radius={[0, 4, 4, 0]}
                          barSize={16}
                        />
                        <Bar
                          dataKey="proficient"
                          name="Proficient"
                          fill={PROFICIENCY_COLORS.proficient}
                          radius={[0, 4, 4, 0]}
                          barSize={16}
                        />
                        <Bar
                          dataKey="advanced"
                          name="Advanced"
                          fill={PROFICIENCY_COLORS.advanced}
                          radius={[0, 4, 4, 0]}
                          barSize={16}
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
