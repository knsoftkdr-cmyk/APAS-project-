import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ProfileExtended {
  id: string;
  full_name: string | null;
  role: string;
  gender: string | null;
  avatar_url: string | null;
  class_grade: string | null;
  school_name: string | null;
  onboarding_completed: boolean;
  tour_completed: boolean;
  // Teacher professional fields
  mobile_number: string | null;
  employee_id: string | null;
  designation: string | null;
  department: string | null;
  qualification: string | null;
  experience: string | null;
}

export function useStudentProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["student-profile-extended", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<ProfileExtended | null> => {
      const { data } = await supabase
        .from("profiles")
        .select(
          "id, full_name, role, gender, avatar_url, class_grade, school_name, onboarding_completed, tour_completed, mobile_number, employee_id, designation, department, qualification, experience"
        )
        .eq("id", user!.id)
        .maybeSingle();
      return data as ProfileExtended | null;
    },
  });
}

export interface CompletionResult {
  percent: number;
  missing: string[];
  fields: { key: string; label: string; done: boolean }[];
}

export function computeCompletion(p: ProfileExtended | null | undefined, hasAcademic: boolean): CompletionResult {
  const fields = [
    { key: "full_name", label: "Name", done: !!p?.full_name?.trim() },
    { key: "gender", label: "Gender", done: !!p?.gender },
    { key: "avatar_url", label: "Profile photo", done: !!p?.avatar_url },
    { key: "class_grade", label: "Class / grade", done: !!p?.class_grade?.trim() },
    { key: "school_name", label: "School details", done: !!p?.school_name?.trim() },
    { key: "academic", label: "Academic information", done: hasAcademic },
  ];
  const done = fields.filter((f) => f.done).length;
  const percent = Math.round((done / fields.length) * 100);
  return { percent, missing: fields.filter((f) => !f.done).map((f) => f.label), fields };
}

export function useProfileCompletion() {
  const { user } = useAuth();
  const profileQuery = useStudentProfile();

  const academicQuery = useQuery({
    queryKey: ["student-has-academic", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { count } = await supabase
        .from("academic_tests")
        .select("id", { count: "exact", head: true })
        .eq("student_id", user!.id);
      return (count || 0) > 0;
    },
  });

  const result = computeCompletion(profileQuery.data, !!academicQuery.data);
  return {
    ...result,
    profile: profileQuery.data,
    isLoading: profileQuery.isLoading || academicQuery.isLoading,
    refetch: () => {
      profileQuery.refetch();
      academicQuery.refetch();
    },
  };
}