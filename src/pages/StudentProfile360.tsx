// src/pages/StudentProfile360.tsx
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import Student360Profile from "@/components/student/Student360Profile";
import type { ProfileRole } from "@/components/student/Student360Profile";

interface ChildOption {
  studentId: string;
  fullName: string;
  className: string | null;
  section: string | null;
}

export default function StudentProfile360() {
  const { user, profile } = useAuth();
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id || !profile?.role) return;

    const resolve = async () => {
      setLoading(true);
      try {
        if (profile.role === "student") {
          const { data } = await supabase
            .from("students")
            .select("id, full_name, class, section")
            .eq("profile_id", user.id)
            .maybeSingle();
          if (data) {
            setChildren([{ studentId: data.id, fullName: data.full_name, className: data.class, section: data.section }]);
            setSelectedStudentId(data.id);
          }
        } else if (profile.role === "parent") {
          const { data: links } = await supabase
            .from("parent_students")
            .select("student_id")
            .eq("parent_id", user.id);

          if (links && links.length > 0) {
            const profileIds = links.map((l) => l.student_id);
            const { data: students } = await supabase
              .from("students")
              .select("id, full_name, class, section, profile_id")
              .in("profile_id", profileIds);

            if (students && students.length > 0) {
              const options: ChildOption[] = students.map((s) => ({
                studentId: s.id,
                fullName: s.full_name,
                className: s.class,
                section: s.section,
              }));
              setChildren(options);
              setSelectedStudentId(options[0].studentId);
            }
          }
        }
      } finally {
        setLoading(false);
      }
    };

    resolve();
  }, [user?.id, profile?.role]);

  const role: ProfileRole =
    profile?.role === "parent"
      ? "parent"
      : profile?.role === "student"
      ? "student"
      : "staff";

  return (
    <AppLayout>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">My 360° Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your complete student profile — personal info, academics, behaviour, health and more.
          </p>
        </div>

        {children.length > 1 && (
          <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-blue-50 px-4 py-3 shadow-sm w-full sm:w-72">
            <label className="text-[11px] font-medium text-indigo-700 uppercase tracking-wide block mb-1.5">
              Viewing profile for
            </label>
            <select
              className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-indigo-200 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
              value={selectedStudentId ?? ""}
              onChange={(e) => setSelectedStudentId(e.target.value)}
            >
              {children.map((child) => (
                <option key={child.studentId} value={child.studentId}>
                  {child.fullName}
                  {child.className ? ` — Class ${child.className}${child.section ? ` ${child.section}` : ""}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : selectedStudentId ? (
        <Student360Profile studentId={selectedStudentId} role={role} viewerId={role === "parent" ? user?.id : undefined} />
      ) : (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          No student profile found. Please contact your school administrator.
        </div>
      )}
    </AppLayout>
  );
}