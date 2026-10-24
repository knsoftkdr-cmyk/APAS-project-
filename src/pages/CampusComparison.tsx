/**
 * CampusComparison.tsx (feature 60)
 *
 * Read-only comparison of the branches (campuses) of the signed-in user's OWN school.
 * No other school's data is read, and nothing is written. No new tables.
 *
 * Data sources (all existing tables, same ones SchoolBenchmarking.tsx already uses):
 * - Branches             -> branches (school_id, name, code, is_active)
 * - Students per branch  -> students (branch_id, profile_id)
 * - Assessment average   -> academic_tests (student_id is a profile id)
 * - Dropout risk         -> student_predictions (student_id is a students.id)
 *
 * Students without a branch are shown in an "Unassigned" card, so nobody is silently left out.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Building2, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const UNASSIGNED = "unassigned";

interface BranchRow {
  id: string;
  name: string;
  code: string | null;
  is_active: boolean | null;
}
interface StudentRow {
  id: string;
  profile_id: string | null;
  branch_id: string | null;
}
interface TestRow {
  student_id: string;
  score: number;
  total_questions: number;
}
interface PredictionRow {
  student_id: string;
  dropout_risk_percentage: number | null;
}
interface CampusStats {
  key: string;
  name: string;
  code: string | null;
  inactive: boolean;
  students: number;
  tests: number;
  assessment_avg: number | null;
  dropout_avg: number | null;
}

const mean = (values: number[]): number | null =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;

// One average per student first, then the average of those, so a student with many tests does not outweigh the others.
function perStudentAverage(rows: { student_id: string; value: number }[]): number | null {
  const by: Record<string, number[]> = {};
  rows.forEach((r) => (by[r.student_id] ||= []).push(r.value));
  return mean(Object.values(by).map((v) => v.reduce((a, b) => a + b, 0) / v.length));
}

const CampusComparison = () => {
  const { profile } = useAuth();
  const schoolId = profile?.school_id;

  const { data, isLoading, error } = useQuery({
    queryKey: ["campus-comparison", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const db = supabase as any; // some of these tables are missing from the generated types
      const { data: branches, error: bErr } = await db
        .from("branches")
        .select("id, name, code, is_active")
        .eq("school_id", schoolId)
        .order("name");
      if (bErr) throw bErr;

      const { data: students, error: sErr } = await db
        .from("students")
        .select("id, profile_id, branch_id")
        .eq("school_id", schoolId);
      if (sErr) throw sErr;

      const studentIds = ((students || []) as StudentRow[]).map((s) => s.id);
      const profileIds = ((students || []) as StudentRow[]).map((s) => s.profile_id).filter(Boolean) as string[];

      const testsRes = profileIds.length
        ? await db.from("academic_tests").select("student_id, score, total_questions").in("student_id", profileIds)
        : { data: [], error: null };
      if (testsRes.error) throw testsRes.error;

      const predsRes = studentIds.length
        ? await db.from("student_predictions").select("student_id, dropout_risk_percentage").in("student_id", studentIds)
        : { data: [], error: null };
      if (predsRes.error) throw predsRes.error;

      return {
        branches: (branches || []) as BranchRow[],
        students: (students || []) as StudentRow[],
        tests: (testsRes.data || []) as TestRow[],
        predictions: (predsRes.data || []) as PredictionRow[],
      };
    },
  });

  const campuses = useMemo<CampusStats[]>(() => {
    if (!data) return [];
    const known = new Set(data.branches.map((b) => b.id));
    const keyOf = (branchId: string | null) => (branchId && known.has(branchId) ? branchId : UNASSIGNED);

    const studentKey = new Map<string, string>();
    const profileKey = new Map<string, string>();
    data.students.forEach((s) => {
      const key = keyOf(s.branch_id);
      studentKey.set(s.id, key);
      if (s.profile_id) profileKey.set(s.profile_id, key);
    });

    const stats = new Map<string, CampusStats>();
    data.branches.forEach((b) =>
      stats.set(b.id, {
        key: b.id,
        name: b.name,
        code: b.code,
        inactive: b.is_active === false,
        students: 0,
        tests: 0,
        assessment_avg: null,
        dropout_avg: null,
      }),
    );
    stats.set(UNASSIGNED, {
      key: UNASSIGNED,
      name: "Unassigned",
      code: null,
      inactive: false,
      students: 0,
      tests: 0,
      assessment_avg: null,
      dropout_avg: null,
    });

    data.students.forEach((s) => {
      const c = stats.get(keyOf(s.branch_id));
      if (c) c.students += 1;
    });

    const testsBy: Record<string, { student_id: string; value: number }[]> = {};
    data.tests.forEach((t) => {
      const key = profileKey.get(t.student_id);
      if (!key || !(t.total_questions > 0)) return;
      (testsBy[key] ||= []).push({ student_id: t.student_id, value: (Number(t.score) / Number(t.total_questions)) * 100 });
    });

    const risksBy: Record<string, { student_id: string; value: number }[]> = {};
    data.predictions.forEach((p) => {
      const key = studentKey.get(p.student_id);
      const v = Number(p.dropout_risk_percentage);
      if (!key || p.dropout_risk_percentage === null || !Number.isFinite(v)) return;
      (risksBy[key] ||= []).push({ student_id: p.student_id, value: v });
    });

    stats.forEach((c, key) => {
      c.tests = (testsBy[key] || []).length;
      c.assessment_avg = perStudentAverage(testsBy[key] || []);
      c.dropout_avg = perStudentAverage(risksBy[key] || []);
    });

    // The Unassigned card only appears when somebody is in it.
    return [...stats.values()].filter((c) => c.key !== UNASSIGNED || c.students > 0);
  }, [data]);

  const chartData = campuses.filter((c) => c.assessment_avg !== null).map((c) => ({ name: c.name, score: c.assessment_avg }));

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Building2 className="h-6 w-6" /> Campus comparison
          </h1>
          <p className="text-muted-foreground">Compare the campuses of your school side by side. Read-only.</p>
        </div>

        {!schoolId ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">No school is linked to this account.</CardContent>
          </Card>
        ) : isLoading ? (
          <LoadingSpinner />
        ) : error ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">Could not load campus data. Try again later.</CardContent>
          </Card>
        ) : campuses.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No campuses yet. Add one in Branch Management and it will appear here.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {campuses.map((c) => (
                <Card key={c.key}>
                  <CardContent className="space-y-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{c.name}</div>
                        {c.code && <div className="text-xs text-muted-foreground">{c.code}</div>}
                      </div>
                      {c.inactive && <Badge variant="secondary">Inactive</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" /> {c.students} students
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Assessment average: </span>
                      {c.assessment_avg === null ? "No tests yet" : `${c.assessment_avg}%`}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Average dropout risk: </span>
                      {c.dropout_avg === null ? "No predictions yet" : `${c.dropout_avg}%`}
                    </div>
                    <div className="text-xs text-muted-foreground">{c.tests} test results counted</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {chartData.length >= 2 && (
              <Card>
                <CardContent className="p-5">
                  <div className="mb-3 font-medium">Assessment average by campus</div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis domain={[0, 100]} unit="%" />
                        <Tooltip />
                        <Bar dataKey="score" name="Assessment average" fill="hsl(var(--primary))" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default CampusComparison;
