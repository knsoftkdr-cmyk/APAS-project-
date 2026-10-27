// src/hooks/useStudentSubjects.ts
//
// The signed-in student's own class and the subjects taught in it — nothing from other classes.
// Used by Adaptive Test, Adaptive Practice and Enrichment so their subject/chapter pickers never list
// every class's books.
//
// Class lookup order: class_students -> classes (the enrolment record), then the students row
// (class / grade), then profile.class_grade. Subjects come from the school's books whose class matches,
// one entry per subject (duplicate books resolve to the one with the most curriculum).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { classKey, fetchSchoolBooks, resolveSubjectsForClass } from "@/lib/Classsubjects";

export interface StudentSubject { id: number; subject: string; class_name: string }

export function useStudentSubjects() {
  const { profile } = useAuth();
  const [subjects, setSubjects] = useState<StudentSubject[]>([]);
  const [classLabel, setClassLabel] = useState<string | null>(null);
  const [className, setClassName] = useState<string | null>(null); // without the section, e.g. "Class 5"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const { data: stu } = await supabase
          .from("students").select("id, grade, class, section").eq("profile_id", profile.id).maybeSingle();
        let className: string | null = null;
        let section: string | null = null;
        if (stu?.id) {
          const { data: cs } = await supabase
            .from("class_students").select("classes(name, section)").eq("student_id", stu.id).limit(1);
          // deno-lint-ignore no-explicit-any
          const cls = (cs as any[] | null)?.[0]?.classes;
          if (cls?.name) { className = cls.name; section = cls.section ?? null; }
        }
        // Fallback for students not yet enrolled via class_students.
        if (!className) {
          className = stu?.class ?? stu?.grade ?? profile.class_grade ?? null;
          section = stu?.section ?? profile.section ?? null;
        }
        if (cancelled) return;
        if (!className) { setClassLabel(null); setClassName(null); setSubjects([]); return; }
        setClassLabel(`${className}${section ? ` - ${section}` : ""}`);
        setClassName(className);

        const schoolBooks = await fetchSchoolBooks(profile.school_id);
        const list = await resolveSubjectsForClass(schoolBooks, classKey(className));
        if (cancelled) return;
        setSubjects(list.map((s) => ({ id: s.bookId, subject: s.subject, class_name: className! })));
      } catch {
        if (!cancelled) { setSubjects([]); setError(true); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.id, profile?.school_id]);

  return { subjects, classLabel, className, loading, error };
}
