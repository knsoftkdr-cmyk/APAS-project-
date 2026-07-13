import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, BookOpen, Clock, MapPin, User, CheckCircle2, XCircle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useState } from "react";

interface Elective {
  id: string;
  name: string;
  subject: string;
  grade: string;
  teacher_id: string | null;
  capacity: number;
  room: string | null;
  day_of_week: string;
  period_number: number;
  is_active: boolean;
}

interface MyChoice {
  id: string;
  elective_id: string;
  day_of_week: string;
  period_number: number;
  electives?: Elective | null;
}

export default function StudentElectives() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [actingOn, setActingOn] = useState<string | null>(null);

  // ---- Electives available for this student's grade ----
  const { data: electives = [], isLoading: electivesLoading } = useQuery({
    queryKey: ["student-electives", profile?.school_id, profile?.class_grade],
    enabled: !!profile?.school_id && !!profile?.class_grade,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("electives")
        .select("*")
        .eq("school_id", profile!.school_id)
        .eq("is_active", true)
        .ilike("grade", `%${profile!.class_grade}%`)
        .order("day_of_week")
        .order("period_number");
      if (error) throw error;
      return data as Elective[];
    },
  });

  // ---- This student's own choices ----
  const { data: myChoices = [], isLoading: choicesLoading } = useQuery({
    queryKey: ["my-elective-choices", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_elective_choices")
        .select("*, electives(*)")
        .eq("student_profile_id", user!.id);
      if (error) throw error;
      return data as MyChoice[];
    },
  });

  // ---- Teacher names for display (electives.teacher_id -> profiles.full_name) ----
  const { data: teacherNames = {} } = useQuery({
    queryKey: ["elective-teacher-names", electives.map((e) => e.teacher_id).join(",")],
    enabled: electives.length > 0,
    queryFn: async () => {
      const teacherIds = [...new Set(electives.map((e) => e.teacher_id).filter(Boolean))] as string[];
      if (teacherIds.length === 0) return {};
      const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", teacherIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((t) => { map[t.id] = t.full_name; });
      return map;
    },
  });

  const chosenElectiveIds = new Set(myChoices.map((c) => c.elective_id));

  const handleChoose = async (electiveId: string) => {
    setActingOn(electiveId);
    try {
      const { data, error } = await supabase.functions.invoke("choose-elective", {
        body: { elective_id: electiveId },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success("Elective chosen!");
      queryClient.invalidateQueries({ queryKey: ["my-elective-choices"] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to choose elective");
    } finally {
      setActingOn(null);
    }
  };

  const handleDrop = async (choiceId: string) => {
    setActingOn(choiceId);
    try {
      const { error } = await supabase.from("student_elective_choices").delete().eq("id", choiceId);
      if (error) throw error;
      toast.success("Dropped");
      queryClient.invalidateQueries({ queryKey: ["my-elective-choices"] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to drop elective");
    } finally {
      setActingOn(null);
    }
  };

  const loading = electivesLoading || choicesLoading;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <PageHeader
          title="Electives"
          subtitle="Browse and choose your elective subjects. You can pick one elective per day/period slot."
        />

        {/* My current choices */}
        {myChoices.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <h2 className="font-semibold text-sm text-muted-foreground mb-3">Your Choices</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {myChoices.map((choice) => (
                  <div key={choice.id} className="border rounded-lg p-3 bg-primary/5 border-primary/20">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm">{choice.electives?.name}</p>
                        <p className="text-xs text-muted-foreground">{choice.electives?.subject}</p>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Enrolled
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 capitalize">
                      {choice.day_of_week} · Period {choice.period_number}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 h-7 text-xs text-destructive hover:text-destructive"
                      disabled={actingOn === choice.id}
                      onClick={() => handleDrop(choice.id)}
                    >
                      {actingOn === choice.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <XCircle className="h-3 w-3 mr-1" />}
                      Drop
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Available electives */}
        <div>
          <h2 className="font-semibold text-sm text-muted-foreground mb-3">Available Electives</h2>
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading electives...
            </div>
          )}
          {!loading && electives.length === 0 && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              No electives available for your grade yet.
            </CardContent></Card>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {electives.map((elective) => {
              const alreadyChosen = chosenElectiveIds.has(elective.id);
              return (
                <Card key={elective.id} className={alreadyChosen ? "border-primary/40" : ""}>
                  <CardContent className="pt-6 space-y-3">
                    <div>
                      <h3 className="font-semibold flex items-center gap-2">
                        <BookOpen className="h-4 w-4 text-primary" /> {elective.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">{elective.subject}</p>
                    </div>
                    <div className="space-y-1.5 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5" />
                        <span className="capitalize">{elective.day_of_week} · Period {elective.period_number}</span>
                      </div>
                      {elective.room && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5" /> {elective.room}
                        </div>
                      )}
                      {elective.teacher_id && teacherNames[elective.teacher_id] && (
                        <div className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5" /> {teacherNames[elective.teacher_id]}
                        </div>
                      )}
                    </div>
                    <Button
                      className="w-full"
                      size="sm"
                      variant={alreadyChosen ? "secondary" : "default"}
                      disabled={alreadyChosen || actingOn === elective.id}
                      onClick={() => handleChoose(elective.id)}
                    >
                      {actingOn === elective.id ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : alreadyChosen ? (
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                      ) : null}
                      {alreadyChosen ? "Chosen" : "Choose"}
                    </Button>
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
