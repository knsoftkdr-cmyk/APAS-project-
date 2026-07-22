/**
 * Surveys.tsx
 *
 * Two tabs: "My Surveys" (create/manage/results) and "To Respond" (surveys
 * targeting the current user that they haven't submitted yet).
 *
 * Anonymity guarantee: enforced by a DB trigger (see migration), not just
 * hidden in this UI — survey_responses.respondent_id is forced NULL by
 * Postgres itself whenever survey.is_anonymous is true, regardless of what
 * this client sends.
 */
import { useState, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Plus, Trash2, ClipboardList, Users, Lock, Star, Play, Square, BarChart3, Download } from "lucide-react";
import { cn } from "@/lib/utils";

type QuestionType = "single_choice" | "multi_choice" | "rating" | "yes_no" | "text_short" | "text_long";
type TargetType = "all_teachers" | "all_parents" | "all_students" | "class_students" | "class_parents";

interface DraftQuestion {
  key: string;
  question_text: string;
  question_type: QuestionType;
  options: string[];
  required: boolean;
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: "Single Choice",
  multi_choice: "Multiple Choice",
  rating: "Rating (1–5)",
  yes_no: "Yes / No",
  text_short: "Short Text",
  text_long: "Long Text",
};

const TARGET_LABELS: Record<TargetType, string> = {
  all_teachers: "All Teachers",
  all_parents: "All Parents",
  all_students: "All Students",
  class_students: "A Class's Students",
  class_parents: "A Class's Parents",
};

export default function Surveys() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const schoolId = profile?.school_id;
  const role = profile?.role;
  const canCreate = ["teacher", "admin", "principal", "school_admin", "hod"].includes(role || "");

  const [tab, setTab] = useState<"mine" | "respond">(canCreate ? "mine" : "respond");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [respondSurvey, setRespondSurvey] = useState<any>(null);
  const [resultsSurvey, setResultsSurvey] = useState<any>(null);

  const { data: myClassIds = [] } = useQuery({
    queryKey: ["my-class-ids", user?.id],
    queryFn: async () => {
      if (role === "teacher") {
        const { data } = await supabase.from("class_teachers").select("class_id").eq("teacher_id", user!.id);
        return (data || []).map((r: any) => r.class_id);
      }
      if (role === "student") {
        const { data: student } = await supabase.from("students").select("id").eq("profile_id", user!.id).maybeSingle();
        if (!student) return [];
        const { data } = await supabase.from("class_students").select("class_id").eq("student_id", student.id);
        return (data || []).map((r: any) => r.class_id);
      }
      if (role === "parent") {
        const { data: links } = await supabase.from("parent_students").select("student_id").eq("parent_id", user!.id);
        const studentProfileIds = (links || []).map((l: any) => l.student_id);
        if (studentProfileIds.length === 0) return [];
        const { data: students } = await supabase.from("students").select("id").in("profile_id", studentProfileIds);
        const studentIds = (students || []).map((s: any) => s.id);
        if (studentIds.length === 0) return [];
        const { data } = await supabase.from("class_students").select("class_id").in("student_id", studentIds);
        return (data || []).map((r: any) => r.class_id);
      }
      return [];
    },
    enabled: !!user?.id && !!role,
  });

  const { data: surveys = [], isLoading } = useQuery({
    queryKey: ["surveys", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surveys" as any)
        .select("*")
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!schoolId,
  });

  // Which class(es) each class_students/class_parents survey targets —
  // a survey can now target any combination of sections, so membership
  // is a lookup against this table rather than a single target_class_id.
  const surveyIds = useMemo(() => surveys.map((s) => s.id), [surveys]);
  const { data: targetClassRows = [] } = useQuery({
    queryKey: ["survey-target-classes", surveyIds.slice().sort().join(",")],
    queryFn: async () => {
      if (surveyIds.length === 0) return [];
      const { data } = await supabase.from("survey_target_classes" as any).select("survey_id, class_id").in("survey_id", surveyIds);
      return (data || []) as any[];
    },
    enabled: surveyIds.length > 0,
  });
  const targetClassesBySurvey = useMemo(() => {
    const map: Record<string, string[]> = {};
    targetClassRows.forEach((r: any) => {
      (map[r.survey_id] ||= []).push(r.class_id);
    });
    return map;
  }, [targetClassRows]);

  const { data: myReceipts = [] } = useQuery({
    queryKey: ["my-survey-receipts", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("survey_receipts" as any).select("survey_id").eq("respondent_id", user!.id);
      return (data || []).map((r: any) => r.survey_id);
    },
    enabled: !!user?.id,
  });

  const mySurveys = useMemo(() => surveys.filter((s) => s.created_by === user?.id), [surveys, user]);

  const isTargeted = useCallback((s: any) => {
    if (role === "teacher" && s.target_type === "all_teachers") return true;
    if (role === "parent" && s.target_type === "all_parents") return true;
    if (role === "student" && s.target_type === "all_students") return true;
    if ((role === "student" && s.target_type === "class_students") || (role === "parent" && s.target_type === "class_parents")) {
      const classIds = targetClassesBySurvey[s.id] || [];
      return classIds.some((id: string) => myClassIds.includes(id));
    }
    return false;
  }, [role, myClassIds, targetClassesBySurvey]);

  const toRespond = useMemo(
    () => surveys.filter((s) => s.status === "active" && isTargeted(s) && !myReceipts.includes(s.id)),
    [surveys, isTargeted, myReceipts]
  );

  const updateStatus = async (survey: any, status: "active" | "closed") => {
    const { error } = await supabase.from("surveys" as any).update({ status }).eq("id", survey.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: status === "active" ? "Survey activated" : "Survey closed" });
    qc.invalidateQueries({ queryKey: ["surveys", schoolId] });
  };

  const deleteSurvey = async (survey: any) => {
    const { error } = await supabase.from("surveys" as any).delete().eq("id", survey.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Survey deleted" });
    qc.invalidateQueries({ queryKey: ["surveys", schoolId] });
  };

return (
    <AppLayout>
      <div className="relative min-h-screen">
        <div className="absolute -top-10 right-0 w-72 h-72 rounded-full bg-violet-300 opacity-[0.12] blur-3xl pointer-events-none" />
        <div className="absolute top-64 left-0 w-64 h-64 rounded-full bg-fuchsia-200 opacity-[0.12] blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 right-1/3 w-56 h-56 rounded-full bg-indigo-200 opacity-[0.10] blur-3xl pointer-events-none" />

      <div className="relative z-10 space-y-6 pb-10">
        <div className="rounded-2xl md:rounded-3xl p-5 md:p-7 relative overflow-hidden bg-gradient-to-r from-violet-600 via-indigo-600 to-fuchsia-600 shadow-lg">
          <div className="absolute -right-8 -top-8 w-40 h-40 bg-white/10 rounded-full" />
          <div className="absolute right-20 top-10 w-16 h-16 bg-white/10 rounded-full" />
          <div className="absolute bottom-0 left-1/3 w-24 h-24 bg-white/5 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="flex h-11 w-11 md:h-12 md:w-12 items-center justify-center rounded-xl bg-white/20 text-white shrink-0">
              <ClipboardList className="h-5 w-5 md:h-6 md:w-6" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Surveys</h1>
              <p className="text-xs md:text-sm text-violet-100 mt-0.5">Feedback from parents, students, teachers, and staff</p>
            </div>
          </div>
        </div>

        {canCreate && (
          <div className="flex justify-end">
            <Button onClick={() => setBuilderOpen(true)} className="bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white shrink-0 w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-1.5" /> Create Survey
            </Button>
          </div>
        )}

        <div className="inline-flex gap-1 rounded-xl bg-violet-50 border border-violet-100 p-1 w-full md:w-auto">
          <button
            onClick={() => setTab("respond")}
            className={cn("flex-1 md:flex-none px-4 py-2 text-sm font-medium rounded-lg transition-all",
              tab === "respond" ? "bg-white text-violet-700 shadow-sm" : "text-muted-foreground hover:text-violet-600")}
          >
            To Respond {toRespond.length > 0 && <Badge className="ml-1.5 bg-red-500 text-white hover:bg-red-500">{toRespond.length}</Badge>}
          </button>
          {canCreate && (
            <button
              onClick={() => setTab("mine")}
              className={cn("flex-1 md:flex-none px-4 py-2 text-sm font-medium rounded-lg transition-all",
                tab === "mine" ? "bg-white text-violet-700 shadow-sm" : "text-muted-foreground hover:text-violet-600")}
            >
              My Surveys
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <LoadingSpinner /> Loading surveys...
          </div>
        ) : tab === "respond" ? (
          <div className="space-y-3">
            {toRespond.length === 0 ? (
              <EmptyState text="No surveys waiting for your response right now." />
            ) : (
              toRespond.map((s) => (
                <Card key={s.id} className="border-l-4 border-l-violet-400 border-y border-r border-border/60 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
                  <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center shrink-0 mt-0.5">
                        <ClipboardList className="h-4.5 w-4.5 text-violet-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold truncate">{s.title}</p>
                          {s.is_anonymous && <Badge variant="outline" className="gap-1 border-violet-200 text-violet-700"><Lock className="h-3 w-3" /> Anonymous</Badge>}
                        </div>
                        {s.description && <p className="text-sm text-muted-foreground mt-0.5">{s.description}</p>}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setRespondSurvey(s)} className="bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white shrink-0 w-full sm:w-auto">
                      Respond
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        ) : tab === "mine" && canCreate ? (
          <div className="space-y-3">
            {mySurveys.length === 0 ? (
              <EmptyState text="You haven't created any surveys yet." />
            ) : (
              mySurveys.map((s) => {
                const statusAccent =
                  s.status === "active" ? "border-l-emerald-400" :
                  s.status === "closed" ? "border-l-slate-300" : "border-l-amber-400";
                return (
                <Card key={s.id} className={cn("border-l-4 border-y border-r border-border/60 shadow-sm hover:shadow-md transition-shadow overflow-hidden", statusAccent)}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between flex-wrap gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                          <ClipboardList className="h-4.5 w-4.5 text-indigo-600" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold truncate">{s.title}</p>
                            <Badge className={
                              s.status === "active" ? "bg-emerald-500 text-white hover:bg-emerald-500" :
                              s.status === "closed" ? "bg-slate-200 text-slate-700 hover:bg-slate-200" : "bg-amber-500 text-white hover:bg-amber-500"
                            }>{s.status}</Badge>
                            {s.is_anonymous && <Badge variant="outline" className="gap-1 border-violet-200 text-violet-700"><Lock className="h-3 w-3" /> Anonymous</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                            <Users className="h-3 w-3" /> {TARGET_LABELS[s.target_type as TargetType]}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {s.status === "draft" && (
                        <Button size="sm" variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => updateStatus(s, "active")}>
                          <Play className="h-3.5 w-3.5 mr-1.5" /> Activate
                        </Button>
                      )}
                      {s.status === "active" && (
                        <Button size="sm" variant="outline" className="border-slate-200 hover:bg-slate-50" onClick={() => updateStatus(s, "closed")}>
                          <Square className="h-3.5 w-3.5 mr-1.5" /> Close
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50" onClick={() => setResultsSurvey(s)}>
                        <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Results
                      </Button>
                      {s.status === "draft" && (
                        <Button size="sm" variant="outline" className="hover:bg-red-50" onClick={() => deleteSurvey(s)}>
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
                );
              })
            )}
          </div>
        ) : null}
      </div>
</div>
      {builderOpen && (
        <SurveyBuilderDialog
          schoolId={schoolId}
          userId={user!.id}
          role={role || ""}
          onClose={() => setBuilderOpen(false)}
          onCreated={() => { setBuilderOpen(false); qc.invalidateQueries({ queryKey: ["surveys", schoolId] }); }}
        />
      )}

      {respondSurvey && (
        <RespondDialog
          survey={respondSurvey}
          userId={user!.id}
          onClose={() => setRespondSurvey(null)}
          onSubmitted={() => { setRespondSurvey(null); qc.invalidateQueries({ queryKey: ["my-survey-receipts", user?.id] }); }}
        />
      )}

      {resultsSurvey && (
        <ResultsDialog survey={resultsSurvey} onClose={() => setResultsSurvey(null)} />
      )}
      
    </AppLayout>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="border-2 border-dashed border-violet-200 bg-violet-50/40">
      <CardContent className="p-10 flex flex-col items-center text-center gap-2">
        <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center">
          <ClipboardList className="h-6 w-6 text-violet-400" />
        </div>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Survey Builder
// ─────────────────────────────────────────────────────────────────────────

function SurveyBuilderDialog({ schoolId, userId, role, onClose, onCreated }: {
  schoolId: string | undefined; userId: string; role: string; onClose: () => void; onCreated: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [targetType, setTargetType] = useState<TargetType>(role === "teacher" ? "class_students" : "all_parents");
  const [selectedClassName, setSelectedClassName] = useState("");
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [questions, setQuestions] = useState<DraftQuestion[]>([
    { key: crypto.randomUUID(), question_text: "", question_type: "rating", options: [], required: true },
  ]);
  const [saving, setSaving] = useState(false);

  const { data: classes = [] } = useQuery({
    queryKey: ["survey-builder-classes", schoolId, role, userId],
    queryFn: async () => {
      if (role === "teacher") {
        const { data: ct } = await supabase.from("class_teachers").select("class_id").eq("teacher_id", userId);
        const ids = (ct || []).map((r: any) => r.class_id);
        if (ids.length === 0) return [];
        const { data } = await supabase.from("classes").select("id, name, section").in("id", ids);
        return data || [];
      }
      const { data } = await supabase.from("classes").select("id, name, section").eq("school_id", schoolId);
      return data || [];
    },
    enabled: !!schoolId,
  });

  // Distinct class names (e.g. "10", "9") for the first dropdown, sorted
  // naturally so "10" doesn't sort before "2".
  const classNames = useMemo(() => {
    const names = Array.from(new Set(classes.map((c: any) => c.name)));
    return names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [classes]);

  // Sections available for whichever class name is currently selected.
  const sectionsForSelectedClass = useMemo(() => {
    return classes
      .filter((c: any) => c.name === selectedClassName)
      .map((c: any) => c.section)
      .sort((a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }));
  }, [classes, selectedClassName]);

  // The actual classes.id rows this class + selected sections resolve
  // to — one or more, depending on how many sections are checked.
  // Checking every section is how you target the whole grade.
  const targetClassIds = useMemo(() => {
    return classes
      .filter((c: any) => c.name === selectedClassName && selectedSections.includes(c.section))
      .map((c: any) => c.id);
  }, [classes, selectedClassName, selectedSections]);

  const handleClassNameChange = (name: string) => {
    setSelectedClassName(name);
    setSelectedSections([]); // reset sections whenever the class changes
  };

  const toggleSection = (section: string) => {
    setSelectedSections((prev) => prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]);
  };

  const allSectionsSelected = sectionsForSelectedClass.length > 0 && selectedSections.length === sectionsForSelectedClass.length;
  const toggleAllSections = () => {
    setSelectedSections(allSectionsSelected ? [] : [...sectionsForSelectedClass]);
  };

  const availableTargets: TargetType[] = role === "teacher"
    ? ["class_students", "class_parents"]
    : ["all_teachers", "all_parents", "all_students", "class_students", "class_parents"];

  const addQuestion = () => {
    setQuestions((qs) => [...qs, { key: crypto.randomUUID(), question_text: "", question_type: "rating", options: [], required: true }]);
  };
  const updateQuestion = (key: string, patch: Partial<DraftQuestion>) => {
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  };
  const removeQuestion = (key: string) => setQuestions((qs) => qs.filter((q) => q.key !== key));

  const handleCreate = async () => {
    if (!title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    if (questions.some((q) => !q.question_text.trim())) { toast({ title: "Every question needs text", variant: "destructive" }); return; }
    if ((targetType === "class_students" || targetType === "class_parents") && targetClassIds.length === 0) {
      toast({ title: "Select a class and at least one section", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const { data: survey, error } = await supabase.from("surveys" as any).insert({
        school_id: schoolId,
        created_by: userId,
        title: title.trim(),
        description: description.trim() || null,
        is_anonymous: isAnonymous,
        target_type: targetType,
        status: "draft",
      }).select().single();
      if (error) throw error;

      if (targetType === "class_students" || targetType === "class_parents") {
        const targetRows = targetClassIds.map((classId) => ({ survey_id: (survey as any).id, class_id: classId }));
        const { error: tError } = await supabase.from("survey_target_classes" as any).insert(targetRows);
        if (tError) throw tError;
      }

      const questionRows = questions.map((q, i) => ({
        survey_id: (survey as any).id,
        question_text: q.question_text.trim(),
        question_type: q.question_type,
        options: (q.question_type === "single_choice" || q.question_type === "multi_choice") ? q.options.filter(Boolean) : null,
        position: i,
        required: q.required,
      }));
      const { error: qError } = await supabase.from("survey_questions" as any).insert(questionRows);
      if (qError) throw qError;

      toast({ title: "Survey created as draft — activate it when ready" });
      onCreated();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl w-[calc(100%-2rem)] sm:w-full max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shrink-0">
              <Plus className="h-4 w-4 text-white" />
            </div>
            Create Survey
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-violet-700">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 focus-visible:ring-violet-400" />
          </div>
          <div>
            <label className="text-xs font-semibold text-violet-700">Description (optional)</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 focus-visible:ring-violet-400" />
          </div>

          <div>
            <label className="text-xs font-semibold text-violet-700">Audience</label>
            <Select value={targetType} onValueChange={(v: any) => setTargetType(v)}>
              <SelectTrigger className="mt-1 focus:ring-violet-400"><SelectValue /></SelectTrigger>
              <SelectContent>
                {availableTargets.map((t) => <SelectItem key={t} value={t}>{TARGET_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {(targetType === "class_students" || targetType === "class_parents") && (
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-violet-50/60 border border-violet-100 p-3">
              <div>
                <label className="text-xs font-semibold text-violet-700">Class</label>
                <Select value={selectedClassName} onValueChange={handleClassNameChange}>
                  <SelectTrigger className="mt-1 bg-white focus:ring-violet-400"><SelectValue placeholder="Select class" /></SelectTrigger>
                  <SelectContent>
                    {classNames.map((name: string) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold text-violet-700">Section(s)</label>
                <details className="mt-1 group relative">
                  <summary
                    className={cn(
                      "flex h-9 w-full items-center justify-between rounded-md border border-input bg-white px-3 py-1 text-sm cursor-pointer select-none list-none",
                      !selectedClassName && "opacity-50 pointer-events-none"
                    )}
                  >
                    <span className="truncate">
                      {selectedSections.length === 0
                        ? (selectedClassName ? "Select section(s)" : "Select class first")
                        : allSectionsSelected
                        ? "All sections (whole grade)"
                        : selectedSections.slice().sort().join(", ")}
                    </span>
                  </summary>
                  <div className="absolute z-20 mt-1 w-full rounded-md border border-violet-200 bg-popover p-2 shadow-md space-y-1">
                    <label className="flex items-center gap-2 text-sm py-1 px-1 border-b border-violet-100 mb-1 pb-2 font-medium text-violet-700">
                      <Checkbox checked={allSectionsSelected} onCheckedChange={toggleAllSections} />
                      All sections (whole grade)
                    </label>
                    {sectionsForSelectedClass.map((section: string) => (
                      <label key={section} className="flex items-center gap-2 text-sm py-1 px-1">
                        <Checkbox checked={selectedSections.includes(section)} onCheckedChange={() => toggleSection(section)} />
                        {section}
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm bg-violet-50/60 border border-violet-100 rounded-lg px-3 py-2.5">
            <Checkbox checked={isAnonymous} onCheckedChange={(v) => setIsAnonymous(!!v)} />
            Make this survey anonymous (responses can never be linked back to a person)
          </label>

          <div className="space-y-3 border-t border-violet-100 pt-3">
            <p className="text-sm font-semibold text-violet-900">Questions</p>
            {questions.map((q, i) => (
              <div key={q.key} className="rounded-xl border border-violet-100 bg-violet-50/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-violet-600">Question {i + 1}</span>
                  {questions.length > 1 && (
                    <button onClick={() => removeQuestion(q.key)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                  )}
                </div>
                <Input
                  placeholder="Question text"
                  value={q.question_text}
                  onChange={(e) => updateQuestion(q.key, { question_text: e.target.value })}
                  className="bg-white focus-visible:ring-violet-400"
                />
                <Select value={q.question_type} onValueChange={(v: any) => updateQuestion(q.key, { question_type: v })}>
                  <SelectTrigger className="bg-white focus:ring-violet-400"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(QUESTION_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                {(q.question_type === "single_choice" || q.question_type === "multi_choice") && (
                  <div className="space-y-1.5">
                    {q.options.map((opt, oi) => (
                      <div key={oi} className="flex gap-2">
                        <Input
                          value={opt}
                          placeholder={`Option ${oi + 1}`}
                          onChange={(e) => {
                            const opts = [...q.options]; opts[oi] = e.target.value;
                            updateQuestion(q.key, { options: opts });
                          }}
                          className="bg-white focus-visible:ring-violet-400"
                        />
                        <button onClick={() => updateQuestion(q.key, { options: q.options.filter((_, x) => x !== oi) })}>
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" className="border-violet-200 text-violet-700 hover:bg-violet-50" onClick={() => updateQuestion(q.key, { options: [...q.options, ""] })}>
                      <Plus className="h-3 w-3 mr-1" /> Add Option
                    </Button>
                  </div>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" className="border-violet-200 text-violet-700 hover:bg-violet-50" onClick={addQuestion}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Question
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving} className="bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white">
            {saving ? "Creating..." : "Create Survey"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Respond
// ─────────────────────────────────────────────────────────────────────────

function RespondDialog({ survey, userId, onClose, onSubmitted }: { survey: any; userId: string; onClose: () => void; onSubmitted: () => void }) {
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);

  const { data: questions = [], isLoading } = useQuery({
    queryKey: ["survey-questions", survey.id],
    queryFn: async () => {
      const { data } = await supabase.from("survey_questions" as any).select("*").eq("survey_id", survey.id).order("position");
      return (data || []) as any[];
    },
  });

  const handleSubmit = async () => {
    const missing = questions.some((q: any) => q.required && !answers[q.id]);
    if (missing) { toast({ title: "Please answer all required questions", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const { error: receiptError } = await supabase.from("survey_receipts" as any).insert({ survey_id: survey.id, respondent_id: userId });
      if (receiptError) throw receiptError;

      const rows = questions
        .filter((q: any) => answers[q.id] !== undefined)
        .map((q: any) => ({
          survey_id: survey.id,
          question_id: q.id,
          respondent_id: userId, // overwritten server-side if survey is anonymous
          answer_value: answers[q.id],
        }));
      const { error: responseError } = await supabase.from("survey_responses" as any).insert(rows);
      if (responseError) throw responseError;

      toast({ title: "Response submitted — thank you!" });
      onSubmitted();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{survey.title}</DialogTitle>
        </DialogHeader>
        {survey.is_anonymous && (
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" /> This survey is anonymous — your answers can't be linked to you.</p>
        )}
        {isLoading ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : (
          <div className="space-y-4">
            {questions.map((q: any) => (
              <div key={q.id}>
                <label className="text-sm font-medium">{q.question_text}{q.required && <span className="text-red-500"> *</span>}</label>
                <div className="mt-2">
                  {q.question_type === "single_choice" && (
                    <RadioGroup value={answers[q.id] || ""} onValueChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}>
                      {(q.options || []).map((opt: string) => (
                        <label key={opt} className="flex items-center gap-2 text-sm py-1">
                          <RadioGroupItem value={opt} /> {opt}
                        </label>
                      ))}
                    </RadioGroup>
                  )}
                  {q.question_type === "multi_choice" && (
                    <div className="space-y-1">
                      {(q.options || []).map((opt: string) => {
                        const selected: string[] = answers[q.id] || [];
                        return (
                          <label key={opt} className="flex items-center gap-2 text-sm py-1">
                            <Checkbox
                              checked={selected.includes(opt)}
                              onCheckedChange={(v) => {
                                const next = v ? [...selected, opt] : selected.filter((o) => o !== opt);
                                setAnswers((a) => ({ ...a, [q.id]: next }));
                              }}
                            />
                            {opt}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {q.question_type === "rating" && (
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} onClick={() => setAnswers((a) => ({ ...a, [q.id]: n }))}>
                          <Star className={cn("h-6 w-6", (answers[q.id] || 0) >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                        </button>
                      ))}
                    </div>
                  )}
                  {q.question_type === "yes_no" && (
                    <RadioGroup value={answers[q.id] || ""} onValueChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="yes" /> Yes</label>
                        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="no" /> No</label>
                      </div>
                    </RadioGroup>
                  )}
                  {(q.question_type === "text_short" || q.question_type === "text_long") && (
                    <Textarea
                      rows={q.question_type === "text_long" ? 4 : 2}
                      value={answers[q.id] || ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Submitting..." : "Submit"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────

function ResultsDialog({ survey, onClose }: { survey: any; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["survey-results", survey.id],
    queryFn: async () => {
      const { data: questions } = await supabase.from("survey_questions" as any).select("*").eq("survey_id", survey.id).order("position");
      const { data: responses } = await supabase.from("survey_responses" as any).select("*").eq("survey_id", survey.id);
      const { count: receiptCount } = await supabase.from("survey_receipts" as any).select("id", { count: "exact", head: true }).eq("survey_id", survey.id);

      let targetCount = 0;
      if (survey.target_type === "all_teachers") {
        const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("school_id", survey.school_id).eq("role", "teacher");
        targetCount = count || 0;
      } else if (survey.target_type === "all_students") {
        const { count } = await supabase.from("students").select("id", { count: "exact", head: true }).eq("school_id", survey.school_id);
        targetCount = count || 0;
      } else if (survey.target_type === "class_students") {
        const { data: tc } = await supabase.from("survey_target_classes" as any).select("class_id").eq("survey_id", survey.id);
        const classIds = (tc || []).map((r: any) => r.class_id);
        const { count } = classIds.length
          ? await supabase.from("class_students").select("id", { count: "exact", head: true }).in("class_id", classIds)
          : { count: 0 };
        targetCount = count || 0;
      } else if (survey.target_type === "all_parents" || survey.target_type === "class_parents") {
        let studentIds: string[] = [];
        if (survey.target_type === "class_parents") {
          const { data: tc } = await supabase.from("survey_target_classes" as any).select("class_id").eq("survey_id", survey.id);
          const classIds = (tc || []).map((r: any) => r.class_id);
          const { data: cs } = classIds.length
            ? await supabase.from("class_students").select("student_id").in("class_id", classIds)
            : { data: [] as any[] };
          studentIds = (cs || []).map((r: any) => r.student_id);
        } else {
          const { data: st } = await supabase.from("students").select("id").eq("school_id", survey.school_id);
          studentIds = (st || []).map((r: any) => r.id);
        }
        const { data: st } = studentIds.length ? await supabase.from("students").select("profile_id").in("id", studentIds) : { data: [] as any[] };
        const profileIds = (st || []).map((r: any) => r.profile_id).filter(Boolean);
        if (profileIds.length) {
          const { data: pl } = await supabase.from("parent_students").select("parent_id").in("student_id", profileIds);
          targetCount = new Set((pl || []).map((r: any) => r.parent_id)).size;
        }
      }

      return { questions: questions || [], responses: responses || [], receiptCount: receiptCount || 0, targetCount };
    },
  });

  const exportCsv = () => {
    if (!data) return;
    const rows = [["Question", "Answer"]];
    data.responses.forEach((r: any) => {
      const q = data.questions.find((qq: any) => qq.id === r.question_id);
      rows.push([q?.question_text || "", Array.isArray(r.answer_value) ? r.answer_value.join("; ") : String(r.answer_value)]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${survey.title.replace(/\s+/g, "_")}_responses.csv`; a.click();
    URL.revokeObjectURL(url);
  };

const responseRate = data && data.targetCount > 0 ? (data.receiptCount / data.targetCount) * 100 : 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl w-[calc(100%-2rem)] sm:w-full max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
              <BarChart3 className="h-4 w-4 text-white" />
            </div>
            <span className="truncate">{survey.title} — Results</span>
          </DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <LoadingSpinner /> Loading results...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100 p-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-medium text-indigo-900">Response Rate</span>
                <span className="font-bold text-indigo-700">{data.receiptCount} / {data.targetCount || "?"}</span>
              </div>
              <Progress value={responseRate} className="h-2.5" />
              <p className="text-xs text-indigo-600/70 mt-1.5">{responseRate.toFixed(0)}% responded</p>
            </div>

            

            {data.questions.map((q: any, qi: number) => {
              const qResponses = data.responses.filter((r: any) => r.question_id === q.id);
              const palette = [
                { bg: "bg-violet-100", text: "text-violet-600" },
                { bg: "bg-indigo-100", text: "text-indigo-600" },
                { bg: "bg-fuchsia-100", text: "text-fuchsia-600" },
              ];
              const c = palette[qi % palette.length];
              return (
                <Card key={q.id} className="border border-border/60 shadow-sm overflow-hidden">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold", c.bg, c.text)}>
                        {qi + 1}
                      </div>
                      <p className="text-sm font-medium pt-0.5">{q.question_text}</p>
                    </div>

                    {(q.question_type === "single_choice" || q.question_type === "multi_choice" || q.question_type === "yes_no") && (
                      <QuestionBreakdown options={q.question_type === "yes_no" ? ["yes", "no"] : (q.options || [])} responses={qResponses} multi={q.question_type === "multi_choice"} />
                    )}
                    {q.question_type === "rating" && <RatingBreakdown responses={qResponses} />}
                    {(q.question_type === "text_short" || q.question_type === "text_long") && (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {qResponses.length === 0 ? (
                          <p className="text-xs text-muted-foreground pl-9">No responses yet.</p>
                        ) : (
                          qResponses.map((r: any, i: number) => (
                            <p key={i} className="text-sm bg-violet-50/60 border border-violet-100 rounded-lg p-2.5 ml-9">{r.answer_value}</p>
                          ))
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuestionBreakdown({ options, responses, multi }: { options: string[]; responses: any[]; multi: boolean }) {
  const counts = options.map((opt) => {
    const n = responses.filter((r) => multi ? (r.answer_value || []).includes(opt) : r.answer_value === opt).length;
    return { opt, n };
  });
  const total = responses.length || 1;
  return (
    <div className="space-y-2 pl-9">
      {counts.map(({ opt, n }) => (
        <div key={opt}>
          <div className="flex justify-between text-xs mb-1">
            <span className="font-medium text-foreground">{opt}</span>
            <span className="text-violet-600 font-semibold">{n}</span>
          </div>
          <Progress value={(n / total) * 100} className="h-2 [&>div]:bg-violet-500" />
        </div>
      ))}
    </div>
  );
}

function RatingBreakdown({ responses }: { responses: any[] }) {
  const avg = responses.length ? (responses.reduce((s, r) => s + Number(r.answer_value), 0) / responses.length).toFixed(1) : "—";
  const dist = [1, 2, 3, 4, 5].map((n) => responses.filter((r) => Number(r.answer_value) === n).length);
  const total = responses.length || 1;
  return (
    <div className="pl-9">
      <p className="text-2xl font-bold mb-2 text-violet-700">{avg} <span className="text-sm font-normal text-muted-foreground">/ 5 avg</span></p>
      <div className="space-y-1.5">
        {dist.map((n, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs w-3 font-medium text-amber-600">{i + 1}★</span>
            <Progress value={(n / total) * 100} className="h-2 flex-1 [&>div]:bg-amber-400" />
            <span className="text-xs w-5 text-right text-muted-foreground">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
