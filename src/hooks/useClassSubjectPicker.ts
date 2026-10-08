// src/hooks/useClassSubjectPicker.ts
//
// "Pick a class, then pick one of the subjects taught in that class" — the same rules Class Mastery uses
// (src/lib/Classsubjects.ts): teachers see only the classes assigned to them, staff admins see every class,
// and the subject list is the subjects that have a book for the chosen class's grade. Changing the class
// clears the subject, and a lone class / lone subject is selected automatically.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  classKey, fetchClassOptions, fetchSchoolBooks, resolveSubjectsForClass,
  type BookOption, type ClassOption, type SubjectOption,
} from "@/lib/Classsubjects";

const byLabel = (a: ClassOption, b: ClassOption) => a.label.localeCompare(b.label, undefined, { numeric: true });

export function useClassSubjectPicker() {
  const { profile } = useAuth();
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [classId, setClassIdRaw] = useState("");
  const [bookId, setBookId] = useState("");
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(false);

  // 1. Classes + books, once the profile is known
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    setLoadingClasses(true);
    Promise.all([fetchClassOptions(profile), fetchSchoolBooks(profile.school_id)])
      .then(([classOptions, bookOptions]) => {
        if (cancelled) return;
        const unique = [...new Map(classOptions.map((c) => [c.id, c])).values()].sort(byLabel);
        setClasses(unique);
        setBooks(bookOptions);
        if (unique.length === 1) setClassIdRaw(unique[0].id);
      })
      .catch(() => { if (!cancelled) { setClasses([]); setBooks([]); } })
      .finally(() => { if (!cancelled) setLoadingClasses(false); });
    return () => { cancelled = true; };
  }, [profile?.id, profile?.role, profile?.school_id]);

  const selectedClass = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);

  // 2. Subjects of the chosen class
  useEffect(() => {
    let cancelled = false;
    setBookId("");
    const key = classKey(selectedClass?.name);
    if (!selectedClass || !key) { setSubjects([]); setLoadingSubjects(false); return; }
    setLoadingSubjects(true);
    resolveSubjectsForClass(books, key)
      .then((list) => {
        if (cancelled) return;
        setSubjects(list);
        if (list.length === 1) setBookId(String(list[0].bookId));
      })
      .catch(() => { if (!cancelled) setSubjects([]); })
      .finally(() => { if (!cancelled) setLoadingSubjects(false); });
    return () => { cancelled = true; };
  }, [books, selectedClass]);

  const setClassId = useCallback((id: string) => { setClassIdRaw(id); setBookId(""); }, []);
  const selectedSubject = useMemo(() => subjects.find((s) => String(s.bookId) === bookId), [subjects, bookId]);

  return {
    classes, classId, setClassId, selectedClass,
    subjects, bookId, setBookId, selectedSubject,
    loadingClasses, loadingSubjects,
  };
}
