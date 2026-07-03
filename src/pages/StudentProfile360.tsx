// src/pages/StudentProfile360.tsx
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import Student360Profile from "@/components/student/Student360Profile";
import type { ProfileRole } from "@/components/student/Student360Profile";

export default function StudentProfile360() {
  const { user, profile } = useAuth();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve the correct studentId and role based on who is logged in:
  // - student  → their own students.id via profile_id
  // - parent   → first child's students.id via parent_students
  // - staff    → no self-student, page shouldn't be accessible
  useEffect(() => {
    if (!user?.id || !profile?.role) return;

    const resolve = async () => {
      setLoading(true);
      try {
        if (profile.role === "student") {
          const { data } = await supabase
            .from("students")
            .select("id")
            .eq("profile_id", user.id)
            .maybeSingle();
          setStudentId(data?.id ?? null);
        } else if (profile.role === "parent") {
          // parent_students.student_id stores profiles.id, so join through students.profile_id
          const { data } = await supabase
            .from("parent_students")
            .select("student_id")
            .eq("parent_id", user.id)
            .limit(1)
            .maybeSingle();
          if (data?.student_id) {
            const { data: student } = await supabase
              .from("students")
              .select("id")
              .eq("profile_id", data.student_id)
              .maybeSingle();
            setStudentId(student?.id ?? null);
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">My 360° Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your complete student profile — personal info, academics, behaviour, health and more.
        </p>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : studentId ? (
        <Student360Profile studentId={studentId} role={role} />
      ) : (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          No student profile found. Please contact your school administrator.
        </div>
      )}
    </AppLayout>
  );
}
