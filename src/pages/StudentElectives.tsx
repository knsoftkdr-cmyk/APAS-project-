import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, BookOpen, Clock, MapPin, User, CheckCircle2, XCircle, Sparkles } from "lucide-react";
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
      if (error) {
        let serverMessage: string | null = null;
        try {
          const ctx = (error as any)?.context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            serverMessage = body?.error ?? null;
          }
        } catch {
          // response body wasn't JSON or already consumed — fall back below
        }
        toast.error(serverMessage ?? error.message ?? "Failed to choose elective");
        return;
      }
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
      <div className="min-h-screen relative overflow-x-hidden">
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
                <h1 className="text-xl md:text-2xl font-bold text-white">Electives</h1>
                <p className="text-sky-100 text-xs md:text-sm mt-0.5">Browse and choose your elective subjects. You can pick one elective per day/period slot.</p>
              </div>
            </div>
          </div>

          {/* My current choices */}
          {myChoices.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-4 w-4 text-blue-500" />
                <h2 className="font-semibold text-sm text-gray-700">Your Choices</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {myChoices.map((choice) => (
                  <Card
                    key={choice.id}
                    className="overflow-hidden border-blue-100 bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow duration-300"
                  >
                    <div className="h-1 bg-gradient-to-r from-blue-400 to-cyan-500" />
                    <CardContent className="pt-4 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{choice.electives?.name}</p>
                          <p className="text-xs text-muted-foreground">{choice.electives?.subject}</p>
                        </div>
                        <Badge className="shrink-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Enrolled
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground capitalize">
                        <Clock className="h-3 w-3 text-blue-400" />
                        {choice.day_of_week} · Period {choice.period_number}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:text-destructive px-0"
                        disabled={actingOn === choice.id}
                        onClick={() => handleDrop(choice.id)}
                      >
                        {actingOn === choice.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <XCircle className="h-3 w-3 mr-1" />}
                        Drop
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Available electives */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="h-4 w-4 text-blue-500" />
              <h2 className="font-semibold text-sm text-gray-700">Available Electives</h2>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-12 text-sky-600">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading electives...
              </div>
            )}

            {!loading && electives.length === 0 && (
              <Card className="border-blue-100 bg-white/70 backdrop-blur-sm">
                <CardContent className="py-12 text-center">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mx-auto mb-3">
                    <BookOpen className="h-6 w-6 text-blue-500" />
                  </div>
                  <p className="text-muted-foreground text-sm">No electives available for your grade yet.</p>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {electives.map((elective) => {
                const alreadyChosen = chosenElectiveIds.has(elective.id);
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
                          <p className="text-xs md:text-sm text-muted-foreground mt-1 ml-9 md:ml-10">{elective.subject}</p>
                        </div>
                        {alreadyChosen && (
                          <Badge className="shrink-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Chosen
                          </Badge>
                        )}
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
                        {elective.teacher_id && teacherNames[elective.teacher_id] && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3 text-sky-400" /> {teacherNames[elective.teacher_id]}
                          </span>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Button
                        className={`w-full ${alreadyChosen ? "" : "bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white"}`}
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
      </div>
    </AppLayout>
  );
}
