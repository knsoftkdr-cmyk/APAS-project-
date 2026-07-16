import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { BookOpen, TrendingUp, AlertCircle, GraduationCap, Loader2 } from "lucide-react";

interface ClassSyllabus {
  classId: string;
  className: string;
  section: string;
  subject: string;
  totalChapters: number;
  coveredChapters: number;
  percentage: number;
}

interface TeacherSyllabus {
  teacherId: string;
  teacherName: string;
  classes: ClassSyllabus[];
  overallPct: number;
}

export default function SchoolSyllabusOverview() {
  const { profile } = useAuth();
  const [teachers, setTeachers] = useState<TeacherSyllabus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.school_id) return;
    fetchSchoolData();
  }, [profile]);

  async function fetchSchoolData() {
    setLoading(true);
    setError(null);
    try {
      const { data: assignments, error: assignErr } = await supabase
        .from("class_teachers")
        .select(`id, teacher_id, subject, class_id, classes!inner(id, name, section, school_id), profiles!class_teachers_teacher_id_fkey(id, full_name)`)
        .eq("classes.school_id", profile!.school_id);

      if (assignErr) throw assignErr;
      if (!assignments || assignments.length === 0) {
        setTeachers([]);
        setLoading(false);
        return;
      }

      const teacherMap = new Map<string, { name: string; rows: any[] }>();
      for (const a of assignments as any[]) {
        const tid = a.teacher_id;
        const tname = a.profiles?.full_name || "Unknown Teacher";
        if (!teacherMap.has(tid)) teacherMap.set(tid, { name: tname, rows: [] });
        teacherMap.get(tid)!.rows.push(a);
      }

      // Flatten every (teacher, class, subject) combo into one list so all
      // the per-combo queries can run concurrently instead of one-at-a-time —
      // this was previously 3 sequential round trips PER row, which is what
      // made the page slow to load with many teachers/classes.
      type FlatRow = {
        teacherId: string;
        teacherName: string;
        classId: string;
        className: string;
        section: string;
        subject: string;
      };
      const flatRows: FlatRow[] = [];
      for (const [teacherId, { name, rows }] of teacherMap.entries()) {
        for (const row of rows) {
          const cls = row.classes;
          if (!cls) continue;
          const rawName = cls.name as string;
          const className = rawName.replace(/\b\w/g, (c: string) => c.toUpperCase());
          const subject = row.subject || "";
          if (!subject) continue;
          flatRows.push({
            teacherId,
            teacherName: name,
            classId: row.class_id,
            className,
            section: cls.section,
            subject,
          });
        }
      }

      const flatResults = await Promise.all(
        flatRows.map(async (r) => {
          const [{ data: chaptersData }, { count: covered }, { count: coveredNoSchool }] = await Promise.all([
            supabase
              .from("curriculum_chapters")
              .select(`id, books!inner(class_name, subject, school_id)`)
              .ilike("books.class_name", r.className)
              .ilike("books.subject", r.subject)
              .eq("books.school_id", profile!.school_id),
            supabase
              .from("lessons")
              .select("id", { count: "exact", head: true })
              .eq("teacher_id", r.teacherId)
              .ilike("class_level", r.className)
              .ilike("subject", r.subject)
              .eq("school_id", profile!.school_id),
            supabase
              .from("lessons")
              .select("id", { count: "exact", head: true })
              .eq("teacher_id", r.teacherId)
              .ilike("class_level", r.className)
              .ilike("subject", r.subject)
              .is("school_id", null),
          ]);

          const total = chaptersData?.length ?? 0;
          const coveredCount = (covered ?? 0) + (coveredNoSchool ?? 0);
          const percentage = total > 0 ? Math.min(100, Math.round((coveredCount / total) * 100)) : 0;

          return {
            teacherId: r.teacherId,
            teacherName: r.teacherName,
            classSyllabus: {
              classId: r.classId,
              className: r.className,
              section: r.section,
              subject: r.subject,
              totalChapters: total,
              coveredChapters: coveredCount,
              percentage,
            } as ClassSyllabus,
          };
        })
      );

      const grouped = new Map<string, { name: string; classes: ClassSyllabus[] }>();
      for (const { teacherId, teacherName, classSyllabus } of flatResults) {
        if (!grouped.has(teacherId)) grouped.set(teacherId, { name: teacherName, classes: [] });
        grouped.get(teacherId)!.classes.push(classSyllabus);
      }

      const results: TeacherSyllabus[] = [];
      for (const [teacherId, { name, classes }] of grouped.entries()) {
        const classResults = [...classes].sort(
          (a, b) => a.percentage - b.percentage || a.className.localeCompare(b.className)
        );
        const overallPct = classResults.length > 0
          ? Math.round(classResults.reduce((sum, c) => sum + c.percentage, 0) / classResults.length)
          : 0;
        results.push({ teacherId, teacherName: name, classes: classResults, overallPct });
      }

      results.sort((a, b) => a.overallPct - b.overallPct || a.teacherName.localeCompare(b.teacherName));
      setTeachers(results);
    } catch (err: any) {
      console.error("SchoolSyllabusOverview error:", err);
      setError("Failed to load school syllabus data.");
    } finally {
      setLoading(false);
    }
  }

  function getBarColor(pct: number) {
    if (pct >= 80) return "bg-emerald-500";
    if (pct >= 50) return "bg-amber-400";
    return "bg-rose-400";
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-indigo-600">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading syllabus coverage...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-6">
        <div className="flex items-center gap-2 text-red-500 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }

  if (teachers.length === 0) {
    return (
      <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-indigo-100 shadow-sm p-10 text-center">
        <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center mx-auto mb-3">
          <GraduationCap className="w-6 h-6 text-indigo-500" />
        </div>
        <p className="text-sm text-muted-foreground">No teachers have been assigned to classes yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {teachers.map((t) => (
        <div
          key={t.teacherId}
          className="overflow-hidden rounded-2xl border border-indigo-100 bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow duration-300"
        >
          <div className="h-1 bg-gradient-to-r from-indigo-400 to-blue-500" />
          <div className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
                  <GraduationCap className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">{t.teacherName}</h2>
                  <p className="text-xs text-gray-400">
                    {t.classes.length} class{t.classes.length !== 1 ? "es" : ""} assigned
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 rounded-full px-3 py-1">
                <TrendingUp className="w-3.5 h-3.5 text-indigo-600" />
                <span className="text-sm font-semibold text-indigo-700">{t.overallPct}%</span>
                <span className="text-xs text-indigo-500">overall</span>
              </div>
            </div>

            <div className="space-y-3">
              {t.classes.map((item, i) => (
                <div key={`${item.classId}-${item.subject}-${i}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">
                        {item.className} – Sec {item.section}
                      </span>
                      <span className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-md px-1.5 py-0.5">
                        {item.subject}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-gray-700">{item.percentage}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${getBarColor(item.percentage)}`}
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {item.coveredChapters} of {item.totalChapters} chapter{item.totalChapters !== 1 ? "s" : ""} covered
                    {item.totalChapters === 0 && (
                      <span className="ml-1 text-amber-500">(no chapters found in curriculum)</span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
