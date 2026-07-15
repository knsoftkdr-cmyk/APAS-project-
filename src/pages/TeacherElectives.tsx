import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, BookOpen, Clock, MapPin, Users, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Elective {
  id: string;
  name: string;
  subject: string;
  grade: string;
  capacity: number;
  room: string | null;
  day_of_week: string;
  period_number: number;
}

interface RosterEntry {
  id: string;
  elective_id: string;
  student_profile_id: string;
}

export default function TeacherElectives() {
  const { user, profile } = useAuth();

  // ---- Electives this teacher teaches ----
  const { data: electives = [], isLoading: electivesLoading } = useQuery({
    queryKey: ["teacher-electives", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("electives")
        .select("*")
        .eq("teacher_id", user!.id)
        .eq("is_active", true)
        .order("day_of_week")
        .order("period_number");
      if (error) throw error;
      return data as Elective[];
    },
  });

  // ---- Roster for all of this teacher's electives in one query ----
  const electiveIds = electives.map((e) => e.id);
  const { data: roster = [], isLoading: rosterLoading } = useQuery({
    queryKey: ["elective-roster", electiveIds.join(",")],
    enabled: electiveIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_elective_choices")
        .select("id, elective_id, student_profile_id")
        .in("elective_id", electiveIds);
      if (error) throw error;
      return data as RosterEntry[];
    },
  });

  // ---- Student names for the roster ----
  const studentIds = [...new Set(roster.map((r) => r.student_profile_id))];
  const { data: studentNames = {} } = useQuery({
    queryKey: ["elective-student-names", studentIds.join(",")],
    enabled: studentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", studentIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((s) => { map[s.id] = s.full_name; });
      return map;
    },
  });

  const loading = electivesLoading || rosterLoading;

return (
  <AppLayout>
    <div
  className="min-h-screen relative overflow-x-hidden"
>
  {/* Layered waves at top */}
  <svg className="absolute top-0 left-0 w-full h-48 opacity-[0.07]" viewBox="0 0 1440 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,90 C240,150 480,30 720,70 C960,110 1200,30 1440,80 L1440,0 L0,0 Z" fill="#3b82f6" />
  </svg>
  <svg className="absolute top-0 left-0 w-full h-36 opacity-[0.06]" viewBox="0 0 1440 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,50 C320,120 720,10 1440,60 L1440,0 L0,0 Z" fill="#2563eb" />
  </svg>

  <div className="relative z-10 p-4 md:p-6 space-y-4 md:space-y-6 max-w-5xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-blue-500 to-cyan-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
          <div className="relative flex items-start md:items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">My Electives</h1>
              <p className="text-sky-100 text-xs md:text-sm mt-0.5">Electives you teach and the students enrolled in each.</p>
            </div>
          </div>
        </div>

        {loading && (
  <div className="flex items-center justify-center py-12 text-sky-600">
    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
  </div>
)}

        {!loading && electives.length === 0 && (
  <Card className="border-blue-100 bg-white/70 backdrop-blur-sm">
    <CardContent className="py-12 text-center">
      <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mx-auto mb-3">
        <BookOpen className="h-6 w-6 text-blue-500" />
      </div>
      <p className="text-muted-foreground text-sm">You're not assigned to teach any electives yet.</p>
    </CardContent>
  </Card>
)}

        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
  {electives.map((elective) => {
    const students = roster.filter((r) => r.elective_id === elective.id);
    const isFull = students.length >= elective.capacity;
    return (
      <Card
        key={elective.id}
        className="overflow-hidden border-blue-100 bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow duration-300"
      >
        <div className="h-1 bg-gradient-to-r from-blue-400 to-cyan-500" />
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-sm md:text-base flex items-center gap-2">
                <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                  <BookOpen className="h-3.5 w-3.5 md:h-4 md:w-4 text-blue-600" />
                </div>
                <span className="truncate">{elective.name}</span>
              </CardTitle>
              <p className="text-xs md:text-sm text-muted-foreground mt-1 ml-9 md:ml-10">{elective.subject} · Grade {elective.grade}</p>
            </div>
            <Badge
              className={`shrink-0 ${
                isFull
                  ? "bg-red-100 text-red-700 hover:bg-red-100"
                  : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
              }`}
            >
              {students.length}/{elective.capacity}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3 md:gap-4 text-xs text-muted-foreground mt-2 ml-9 md:ml-10">
            <span className="flex items-center gap-1 capitalize">
              <Clock className="h-3 w-3 text-blue-400" /> {elective.day_of_week} · Period {elective.period_number}
            </span>
            {elective.room && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3 text-sky-400" /> {elective.room}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs md:text-sm font-medium text-gray-600 mb-2">
            <Users className="h-4 w-4 text-sky-500" /> Enrolled Students
          </div>
          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No students enrolled yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {students.map((s, i) => (
                <li
                  key={s.id}
                  className="text-sm py-2 px-3 rounded-lg bg-blue-50/60 border border-blue-100 flex items-center gap-2"
                >
                  <span className="w-5 h-5 rounded-full bg-blue-200 text-blue-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className="truncate">{studentNames[s.student_profile_id] ?? "Unknown student"}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  })}
</div>
</div>
      </div>
    </AppLayout>
  );
}
