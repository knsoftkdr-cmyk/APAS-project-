import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { BookOpen, TrendingUp, AlertCircle } from "lucide-react";

interface ClassSyllabus {
  classId: string;
  className: string;
  section: string;
  subject: string;
  totalChapters: number;
  coveredChapters: number;
  percentage: number;
}

export default function SyllabusTracker() {
  const { profile } = useAuth();
  const [data, setData] = useState<ClassSyllabus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.id || !profile?.school_id) return;
    fetchSyllabusData();
  }, [profile]);

  async function fetchSyllabusData() {
    setLoading(true);
    setError(null);
    try {
      const { data: assignments, error: assignErr } = await supabase
        .from("class_teachers")
        .select(`id, subject, teacher_role, class_id, classes!inner(id, name, section, school_id)`)
        .eq("teacher_id", profile!.id)
        .eq("classes.school_id", profile!.school_id);

      if (assignErr) throw assignErr;
      if (!assignments || assignments.length === 0) {
        setData([]);
        setLoading(false);
        return;
      }

      const results: ClassSyllabus[] = [];

      for (const assignment of assignments) {
        const cls = (assignment as any).classes;
        if (!cls) continue;

        const rawName = cls.name as string;
        const className = rawName.replace(/\b\w/g, (c) => c.toUpperCase());
        const section = cls.section;
        const subject = assignment.subject || profile?.department || "";
        if (!subject) continue;

        const { data: chaptersData } = await supabase
          .from("curriculum_chapters")
          .select(`id, books!inner(class_name, subject, school_id)`)
          .ilike("books.class_name", className)
          .ilike("books.subject", subject)
          .eq("books.school_id", profile!.school_id);

        const total = chaptersData?.length ?? 0;

        const { count: covered } = await supabase
          .from("lessons")
          .select("id", { count: "exact", head: true })
          .eq("teacher_id", profile!.id)
          .ilike("class_level", className)
          .ilike("subject", subject)
          .eq("school_id", profile!.school_id);

        const { count: coveredNoSchool } = await supabase
          .from("lessons")
          .select("id", { count: "exact", head: true })
          .eq("teacher_id", profile!.id)
          .ilike("class_level", className)
          .ilike("subject", subject)
          .is("school_id", null);

        const coveredCount = (covered ?? 0) + (coveredNoSchool ?? 0);
        const percentage = total > 0 ? Math.min(100, Math.round((coveredCount / total) * 100)) : 0;

        results.push({ classId: assignment.class_id, className, section, subject, totalChapters: total, coveredChapters: coveredCount, percentage });
      }

      results.sort((a, b) => a.percentage - b.percentage || a.className.localeCompare(b.className));
      setData(results);
    } catch (err: any) {
      console.error("SyllabusTracker error:", err);
      setError("Failed to load syllabus data.");
    } finally {
      setLoading(false);
    }
  }

  function getBarColor(pct: number) {
    if (pct >= 80) return "bg-emerald-500";
    if (pct >= 50) return "bg-amber-400";
    return "bg-rose-400";
  }

  const overallPct = data.length > 0
    ? Math.round(data.reduce((sum, d) => sum + d.percentage, 0) / data.length)
    : 0;

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Syllabus Coverage</h2>
            <p className="text-xs text-gray-400">Loading your class data...</p>
          </div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
              <div className="h-2 bg-gray-100 rounded-full" />
            </div>
          ))}
        </div>
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

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Syllabus Coverage</h2>
            <p className="text-xs text-gray-400">No classes assigned yet</p>
          </div>
        </div>
        <div className="text-center py-8 text-gray-400 text-sm">
          <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>You haven't been assigned to any classes yet.</p>
          <p className="text-xs mt-1">Contact your principal to get assigned.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Syllabus Coverage</h2>
            <p className="text-xs text-gray-400">{data.length} class{data.length !== 1 ? "es" : ""} assigned</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-violet-50 border border-violet-200 rounded-full px-3 py-1">
          <TrendingUp className="w-3.5 h-3.5 text-violet-600" />
          <span className="text-sm font-semibold text-violet-700">{overallPct}%</span>
          <span className="text-xs text-violet-500">overall</span>
        </div>
      </div>

      <div className="mb-6">
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-700"
            style={{ width: `${overallPct}%` }}
          />
        </div>
      </div>

      <div className="space-y-4">
        {data.map((item, i) => (
          <div key={`${item.classId}-${item.subject}-${i}`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800">
                  {item.className} – Sec {item.section}
                </span>
                <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-md px-1.5 py-0.5">
                  {item.subject}
                </span>
              </div>
              <span className="text-sm font-semibold text-gray-700">
                {item.percentage}%
              </span>
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
  );
}
