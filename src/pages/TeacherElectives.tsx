import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, BookOpen, Clock, MapPin, Users } from "lucide-react";
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
      <div className="p-6 space-y-6">
        <PageHeader
          title="My Electives"
          subtitle="Electives you teach and the students enrolled in each."
        />

        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
          </div>
        )}

        {!loading && electives.length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            You're not assigned to teach any electives yet.
          </CardContent></Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {electives.map((elective) => {
            const students = roster.filter((r) => r.elective_id === elective.id);
            return (
              <Card key={elective.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <BookOpen className="h-4 w-4 text-primary" /> {elective.name}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">{elective.subject} · Grade {elective.grade}</p>
                    </div>
                    <Badge variant={students.length >= elective.capacity ? "destructive" : "secondary"}>
                      {students.length}/{elective.capacity}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
                    <span className="flex items-center gap-1 capitalize">
                      <Clock className="h-3 w-3" /> {elective.day_of_week} · Period {elective.period_number}
                    </span>
                    {elective.room && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {elective.room}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                    <Users className="h-4 w-4" /> Enrolled Students
                  </div>
                  {students.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No students enrolled yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {students.map((s) => (
                        <li key={s.id} className="text-sm py-1.5 px-2 rounded bg-muted/50">
                          {studentNames[s.student_profile_id] ?? "Unknown student"}
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
    </AppLayout>
  );
}
