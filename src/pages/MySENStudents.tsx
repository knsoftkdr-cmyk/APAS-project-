import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  Plus,
  FileText,
  Accessibility,
  Stethoscope,
  Search,
  ChevronRight,
  Target,
  CalendarClock,
  Pencil,
  Trash2,
  Lock,
} from "lucide-react";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
interface StudentLite {
  id: string;
  full_name: string;
  admission_number: string | null;
  class: string | null;
  section: string | null;
}

interface SenStudent {
  id: string;
  category: string;
  diagnosis_notes: string | null;
  enrollment_date: string;
  status: string;
  case_manager_id: string | null;
  student: StudentLite | null;
  case_manager: { id: string; full_name: string } | null;
}

interface IepGoal {
  id: string;
  domain: string;
  goal_description: string;
  baseline: string | null;
  target_criteria: string | null;
  target_date: string | null;
  progress_status: string;
}

interface IepReview {
  id: string;
  review_date: string;
  attendees: string | null;
  summary: string | null;
  next_review_date: string | null;
}

interface IepPlan {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  status: string;
  goals: IepGoal[];
  reviews: IepReview[];
}

interface Accommodation {
  id: string;
  accommodation_type: string;
  applies_to: string;
  description: string | null;
  active: boolean;
  start_date: string;
  end_date: string | null;
}

interface TherapySession {
  id: string;
  therapy_type: string;
  therapist_id: string | null;
  therapist: { full_name: string } | null;
  session_date: string;
  duration_minutes: number | null;
  goals_addressed: string | null;
  notes: string | null;
}

const THERAPY_TYPES = ["Speech", "Occupational", "Behavioral", "Physical", "Counseling"];
const ACCOMMODATION_TYPES = ["Extra Time", "Preferential Seating", "Assistive Technology", "Reduced Workload", "Scribe", "Other"];

export default function MySENStudents() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const schoolId = profile?.school_id;
  const myId = profile?.id;

  const [senStudents, setSenStudents] = useState<SenStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SenStudent | null>(null);

  const [plans, setPlans] = useState<IepPlan[]>([]);
  const [accommodations, setAccommodations] = useState<Accommodation[]>([]);
  const [sessions, setSessions] = useState<TherapySession[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [planOpen, setPlanOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ title: "", start_date: "", end_date: "", status: "draft" });

  const [goalOpen, setGoalOpen] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState<{ id: string; planId: string } | null>(null);
  const [goalForm, setGoalForm] = useState({
    domain: "Academic",
    goal_description: "",
    baseline: "",
    target_criteria: "",
    target_date: "",
  });

  const [reviewOpen, setReviewOpen] = useState<string | null>(null);
  const [editingReview, setEditingReview] = useState<{ id: string; planId: string } | null>(null);
  const [reviewForm, setReviewForm] = useState({
    review_date: "",
    attendees: "",
    summary: "",
    next_review_date: "",
  });

  const [accOpen, setAccOpen] = useState(false);
  const [editingAccId, setEditingAccId] = useState<string | null>(null);
  const [accForm, setAccForm] = useState({
    accommodation_type: ACCOMMODATION_TYPES[0],
    applies_to: "both",
    description: "",
  });

  const [sessionOpen, setSessionOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionForm, setSessionForm] = useState({
    therapy_type: THERAPY_TYPES[0],
    session_date: "",
    duration_minutes: "",
    goals_addressed: "",
    notes: "",
  });

  // -------------------------------------------------------------
  const loadSenStudents = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    // RLS automatically scopes this to: rows where I'm the case manager,
    // OR rows I have therapist-view access to (I've logged a session).
    const { data, error } = await supabase
      .from("sen_students")
      .select(
        `id, category, diagnosis_notes, enrollment_date, status, case_manager_id,
         student:students!sen_students_student_id_fkey(id, full_name, admission_number, class, section),
         case_manager:profiles!sen_students_case_manager_id_fkey(id, full_name)`
      )
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Error loading SEN students", description: error.message, variant: "destructive" });
    } else {
      setSenStudents((data as unknown as SenStudent[]) || []);
    }
    setLoading(false);
  }, [schoolId, toast]);

  const loadDetail = useCallback(async (senStudentId: string) => {
    setDetailLoading(true);
    const [plansRes, accRes, sessRes] = await Promise.all([
      supabase
        .from("iep_plans")
        .select("*, goals:iep_goals(*), reviews:iep_reviews(*)")
        .eq("sen_student_id", senStudentId)
        .order("created_at", { ascending: false }),
      supabase
        .from("sen_accommodations")
        .select("*")
        .eq("sen_student_id", senStudentId)
        .order("created_at", { ascending: false }),
      supabase
        .from("therapy_sessions")
        .select("*, therapist:profiles!therapy_sessions_therapist_id_fkey(full_name)")
        .eq("sen_student_id", senStudentId)
        .order("session_date", { ascending: false }),
    ]);
    setPlans((plansRes.data as unknown as IepPlan[]) || []);
    setAccommodations((accRes.data as Accommodation[]) || []);
    setSessions((sessRes.data as unknown as TherapySession[]) || []);
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    loadSenStudents();
  }, [loadSenStudents]);

  useEffect(() => {
    if (selected) loadDetail(selected.id);
  }, [selected, loadDetail]);

  const isCaseManager = selected?.case_manager_id === myId;

  // -------------------------------------------------------------
  // Mutations (only reachable when isCaseManager, except session
  // functions which are also used by therapist-only viewers)
  // -------------------------------------------------------------
  const openPlanEdit = (plan: IepPlan) => {
    setEditingPlanId(plan.id);
    setPlanForm({ title: plan.title, start_date: plan.start_date, end_date: plan.end_date || "", status: plan.status });
    setPlanOpen(true);
  };

  const addPlan = async () => {
    if (!selected || !planForm.title || !planForm.start_date) return;
    if (editingPlanId) {
      const { error } = await supabase
        .from("iep_plans")
        .update({ title: planForm.title, start_date: planForm.start_date, end_date: planForm.end_date || null, status: planForm.status })
        .eq("id", editingPlanId);
      if (error) { toast({ title: "Could not update IEP plan", description: error.message, variant: "destructive" }); return; }
    } else {
      const { error } = await supabase.from("iep_plans").insert({
        sen_student_id: selected.id,
        title: planForm.title,
        start_date: planForm.start_date,
        end_date: planForm.end_date || null,
        created_by: profile?.id,
      });
      if (error) { toast({ title: "Could not create IEP plan", description: error.message, variant: "destructive" }); return; }
    }
    setPlanOpen(false);
    setEditingPlanId(null);
    setPlanForm({ title: "", start_date: "", end_date: "", status: "draft" });
    loadDetail(selected.id);
  };

  const deletePlan = async (planId: string) => {
    if (!selected) return;
    if (!window.confirm("Delete this IEP plan? This also deletes its goals and reviews.")) return;
    const { error } = await supabase.from("iep_plans").delete().eq("id", planId);
    if (error) { toast({ title: "Could not delete plan", description: error.message, variant: "destructive" }); return; }
    loadDetail(selected.id);
  };

  const openGoalEdit = (planId: string, goal: IepGoal) => {
    setEditingGoal({ id: goal.id, planId });
    setGoalForm({
      domain: goal.domain,
      goal_description: goal.goal_description,
      baseline: goal.baseline || "",
      target_criteria: goal.target_criteria || "",
      target_date: goal.target_date || "",
    });
    setGoalOpen(planId);
  };

  const addGoal = async (planId: string) => {
    if (!selected || !goalForm.goal_description) return;
    if (editingGoal) {
      const { error } = await supabase
        .from("iep_goals")
        .update({
          domain: goalForm.domain,
          goal_description: goalForm.goal_description,
          baseline: goalForm.baseline || null,
          target_criteria: goalForm.target_criteria || null,
          target_date: goalForm.target_date || null,
        })
        .eq("id", editingGoal.id);
      if (error) { toast({ title: "Could not update goal", description: error.message, variant: "destructive" }); return; }
    } else {
      const { error } = await supabase.from("iep_goals").insert({
        iep_plan_id: planId,
        domain: goalForm.domain,
        goal_description: goalForm.goal_description,
        baseline: goalForm.baseline || null,
        target_criteria: goalForm.target_criteria || null,
        target_date: goalForm.target_date || null,
      });
      if (error) { toast({ title: "Could not add goal", description: error.message, variant: "destructive" }); return; }
    }
    setGoalOpen(null);
    setEditingGoal(null);
    setGoalForm({ domain: "Academic", goal_description: "", baseline: "", target_criteria: "", target_date: "" });
    loadDetail(selected.id);
  };

  const deleteGoal = async (goalId: string) => {
    if (!selected) return;
    if (!window.confirm("Delete this goal?")) return;
    const { error } = await supabase.from("iep_goals").delete().eq("id", goalId);
    if (error) { toast({ title: "Could not delete goal", description: error.message, variant: "destructive" }); return; }
    loadDetail(selected.id);
  };

  const updateGoalStatus = async (goalId: string, progress_status: string) => {
    if (!selected) return;
    const { error } = await supabase.from("iep_goals").update({ progress_status }).eq("id", goalId);
    if (!error) loadDetail(selected.id);
  };

  const openReviewEdit = (planId: string, review: IepReview) => {
    setEditingReview({ id: review.id, planId });
    setReviewForm({
      review_date: review.review_date,
      attendees: review.attendees || "",
      summary: review.summary || "",
      next_review_date: review.next_review_date || "",
    });
    setReviewOpen(planId);
  };

  const addReview = async (planId: string) => {
    if (!selected || !reviewForm.review_date) return;
    if (editingReview) {
      const { error } = await supabase
        .from("iep_reviews")
        .update({
          review_date: reviewForm.review_date,
          attendees: reviewForm.attendees || null,
          summary: reviewForm.summary || null,
          next_review_date: reviewForm.next_review_date || null,
        })
        .eq("id", editingReview.id);
      if (error) { toast({ title: "Could not update review", description: error.message, variant: "destructive" }); return; }
    } else {
      const { error } = await supabase.from("iep_reviews").insert({
        iep_plan_id: planId,
        review_date: reviewForm.review_date,
        attendees: reviewForm.attendees || null,
        summary: reviewForm.summary || null,
        next_review_date: reviewForm.next_review_date || null,
        reviewed_by: profile?.id,
      });
      if (error) { toast({ title: "Could not add review", description: error.message, variant: "destructive" }); return; }
    }
    setReviewOpen(null);
    setEditingReview(null);
    setReviewForm({ review_date: "", attendees: "", summary: "", next_review_date: "" });
    loadDetail(selected.id);
  };

  const deleteReview = async (reviewId: string) => {
    if (!selected) return;
    if (!window.confirm("Delete this review?")) return;
    const { error } = await supabase.from("iep_reviews").delete().eq("id", reviewId);
    if (error) { toast({ title: "Could not delete review", description: error.message, variant: "destructive" }); return; }
    loadDetail(selected.id);
  };

  const openAccEdit = (acc: Accommodation) => {
    setEditingAccId(acc.id);
    setAccForm({ accommodation_type: acc.accommodation_type, applies_to: acc.applies_to, description: acc.description || "" });
    setAccOpen(true);
  };

  const addAccommodation = async () => {
    if (!selected || !accForm.accommodation_type) return;
    if (editingAccId) {
      const { error } = await supabase
        .from("sen_accommodations")
        .update({ accommodation_type: accForm.accommodation_type, applies_to: accForm.applies_to, description: accForm.description || null })
        .eq("id", editingAccId);
      if (error) { toast({ title: "Could not update accommodation", description: error.message, variant: "destructive" }); return; }
    } else {
      const { error } = await supabase.from("sen_accommodations").insert({
        sen_student_id: selected.id,
        accommodation_type: accForm.accommodation_type,
        applies_to: accForm.applies_to,
        description: accForm.description || null,
      });
      if (error) { toast({ title: "Could not add accommodation", description: error.message, variant: "destructive" }); return; }
    }
    setAccOpen(false);
    setEditingAccId(null);
    setAccForm({ accommodation_type: ACCOMMODATION_TYPES[0], applies_to: "both", description: "" });
    loadDetail(selected.id);
  };

  const toggleAccommodation = async (id: string, active: boolean) => {
    if (!selected) return;
    const { error } = await supabase.from("sen_accommodations").update({ active: !active }).eq("id", id);
    if (!error) loadDetail(selected.id);
  };

  const deleteAccommodation = async (id: string) => {
    if (!selected) return;
    if (!window.confirm("Delete this accommodation?")) return;
    const { error } = await supabase.from("sen_accommodations").delete().eq("id", id);
    if (error) { toast({ title: "Could not delete accommodation", description: error.message, variant: "destructive" }); return; }
    loadDetail(selected.id);
  };

  // Therapy sessions: case manager can manage any session for their
  // student; a therapist-only viewer can manage only their own rows.
  const canEditSession = (session: TherapySession) => isCaseManager || session.therapist_id === myId;

  const openSessionEdit = (session: TherapySession) => {
    setEditingSessionId(session.id);
    setSessionForm({
      therapy_type: session.therapy_type,
      session_date: session.session_date,
      duration_minutes: session.duration_minutes ? String(session.duration_minutes) : "",
      goals_addressed: session.goals_addressed || "",
      notes: session.notes || "",
    });
    setSessionOpen(true);
  };

  const addSession = async () => {
    if (!selected || !sessionForm.session_date) return;
    if (editingSessionId) {
      const { error } = await supabase
        .from("therapy_sessions")
        .update({
          therapy_type: sessionForm.therapy_type,
          session_date: sessionForm.session_date,
          duration_minutes: sessionForm.duration_minutes ? Number(sessionForm.duration_minutes) : null,
          goals_addressed: sessionForm.goals_addressed || null,
          notes: sessionForm.notes || null,
        })
        .eq("id", editingSessionId);
      if (error) { toast({ title: "Could not update session", description: error.message, variant: "destructive" }); return; }
    } else {
      // Non-case-managers can only log sessions under their own name (RLS enforces this too)
      const { error } = await supabase.from("therapy_sessions").insert({
        sen_student_id: selected.id,
        therapy_type: sessionForm.therapy_type,
        therapist_id: myId,
        session_date: sessionForm.session_date,
        duration_minutes: sessionForm.duration_minutes ? Number(sessionForm.duration_minutes) : null,
        goals_addressed: sessionForm.goals_addressed || null,
        notes: sessionForm.notes || null,
      });
      if (error) { toast({ title: "Could not log session", description: error.message, variant: "destructive" }); return; }
    }
    setSessionOpen(false);
    setEditingSessionId(null);
    setSessionForm({ therapy_type: THERAPY_TYPES[0], session_date: "", duration_minutes: "", goals_addressed: "", notes: "" });
    loadDetail(selected.id);
  };

  const deleteSession = async (id: string) => {
    if (!selected) return;
    if (!window.confirm("Delete this therapy session?")) return;
    const { error } = await supabase.from("therapy_sessions").delete().eq("id", id);
    if (error) { toast({ title: "Could not delete session", description: error.message, variant: "destructive" }); return; }
    loadDetail(selected.id);
  };

  // -------------------------------------------------------------
  const filteredSenStudents = senStudents.filter((s) =>
    s.student?.full_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Accessibility className="h-6 w-6 text-emerald-600" />
            My SEN Students
          </h1>
          <p className="text-sm text-muted-foreground">Students where you're the case manager or an assigned therapist</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          <Card className="h-fit">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" /> Students ({senStudents.length})
              </CardTitle>
              <div className="relative mt-2">
                <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                <Input placeholder="Search..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent className="space-y-1 max-h-[70vh] overflow-y-auto">
              {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
              {!loading && filteredSenStudents.length === 0 && (
                <p className="text-sm text-muted-foreground">No SEN students assigned to you yet.</p>
              )}
              {filteredSenStudents.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s)}
                  className={`w-full text-left p-2 rounded-md border flex items-center justify-between hover:bg-accent transition-colors ${
                    selected?.id === s.id ? "bg-accent border-emerald-500" : "border-transparent"
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{s.student?.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.student?.class} {s.student?.section} · {s.category}
                      {s.case_manager_id === myId ? " · Case Manager" : " · Therapist"}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </CardContent>
          </Card>

          {!selected ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                Select a student to view their SEN record.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{selected.student?.full_name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {selected.student?.class} {selected.student?.section}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge>{selected.category}</Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isCaseManager ? "You are the case manager" : "Therapist view (read-only IEP)"}
                    </p>
                  </div>
                </div>
                {selected.diagnosis_notes && (
                  <p className="text-sm text-muted-foreground mt-2">{selected.diagnosis_notes}</p>
                )}
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="iep">
                  <TabsList>
                    <TabsTrigger value="iep"><FileText className="h-4 w-4 mr-1" /> IEP</TabsTrigger>
                    <TabsTrigger value="accommodations"><Accessibility className="h-4 w-4 mr-1" /> Accommodations</TabsTrigger>
                    <TabsTrigger value="therapy"><Stethoscope className="h-4 w-4 mr-1" /> Therapy</TabsTrigger>
                  </TabsList>

                  {/* IEP TAB */}
                  <TabsContent value="iep" className="space-y-3 mt-3">
                    <div className="flex justify-end">
                      {isCaseManager ? (
                        <Button size="sm" onClick={() => { setEditingPlanId(null); setPlanForm({ title: "", start_date: "", end_date: "", status: "draft" }); setPlanOpen(true); }}>
                          <Plus className="h-4 w-4 mr-1" /> New IEP Plan
                        </Button>
                      ) : (
                        <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" /> Read-only</Badge>
                      )}
                    </div>
                    {detailLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
                    {!detailLoading && plans.length === 0 && <p className="text-sm text-muted-foreground">No IEP plans yet.</p>}
                    {plans.map((plan) => (
                      <Card key={plan.id} className="border-l-4 border-l-emerald-500">
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="text-base">{plan.title}</CardTitle>
                              <p className="text-xs text-muted-foreground">{plan.start_date} → {plan.end_date || "ongoing"}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{plan.status}</Badge>
                              {isCaseManager && (
                                <>
                                  <Button variant="ghost" size="sm" onClick={() => openPlanEdit(plan)}><Pencil className="h-3.5 w-3.5" /></Button>
                                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deletePlan(plan.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                </>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-sm font-medium flex items-center gap-1"><Target className="h-3.5 w-3.5" /> Goals</p>
                              {isCaseManager && (
                                <Button variant="ghost" size="sm" onClick={() => { setEditingGoal(null); setGoalForm({ domain: "Academic", goal_description: "", baseline: "", target_criteria: "", target_date: "" }); setGoalOpen(plan.id); }}>
                                  <Plus className="h-3.5 w-3.5 mr-1" /> Goal
                                </Button>
                              )}
                            </div>
                            {plan.goals?.length === 0 && <p className="text-xs text-muted-foreground">No goals added.</p>}
                            {plan.goals?.map((g) => (
                              <div key={g.id} className="text-sm border rounded-md p-2 mb-1 flex items-start justify-between gap-2">
                                <div>
                                  <p><span className="font-medium">{g.domain}:</span> {g.goal_description}</p>
                                  {g.target_criteria && <p className="text-xs text-muted-foreground">Target: {g.target_criteria}</p>}
                                </div>
                                {isCaseManager ? (
                                  <div className="flex items-center gap-1">
                                    <Select value={g.progress_status} onValueChange={(v) => updateGoalStatus(g.id, v)}>
                                      <SelectTrigger className="w-[130px] h-7 text-xs"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="not_started">Not Started</SelectItem>
                                        <SelectItem value="in_progress">In Progress</SelectItem>
                                        <SelectItem value="achieved">Achieved</SelectItem>
                                        <SelectItem value="discontinued">Discontinued</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openGoalEdit(plan.id, g)}><Pencil className="h-3.5 w-3.5" /></Button>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deleteGoal(g.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                  </div>
                                ) : (
                                  <Badge variant="outline" className="shrink-0">{g.progress_status.replace("_", " ")}</Badge>
                                )}
                              </div>
                            ))}
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-sm font-medium flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Reviews</p>
                              {isCaseManager && (
                                <Button variant="ghost" size="sm" onClick={() => { setEditingReview(null); setReviewForm({ review_date: "", attendees: "", summary: "", next_review_date: "" }); setReviewOpen(plan.id); }}>
                                  <Plus className="h-3.5 w-3.5 mr-1" /> Review
                                </Button>
                              )}
                            </div>
                            {plan.reviews?.length === 0 && <p className="text-xs text-muted-foreground">No reviews logged.</p>}
                            {plan.reviews?.map((r) => (
                              <div key={r.id} className="text-sm border rounded-md p-2 mb-1 flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-medium">{r.review_date}{r.next_review_date ? ` · next: ${r.next_review_date}` : ""}</p>
                                  {r.summary && <p className="text-xs text-muted-foreground">{r.summary}</p>}
                                </div>
                                {isCaseManager && (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openReviewEdit(plan.id, r)}><Pencil className="h-3.5 w-3.5" /></Button>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deleteReview(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </TabsContent>

                  {/* ACCOMMODATIONS TAB - full manage for case manager, read-only for therapist-only viewers */}
                  <TabsContent value="accommodations" className="space-y-2 mt-3">
                    <div className="flex justify-end">
                      {isCaseManager ? (
                        <Button size="sm" onClick={() => { setEditingAccId(null); setAccForm({ accommodation_type: ACCOMMODATION_TYPES[0], applies_to: "both", description: "" }); setAccOpen(true); }}>
                          <Plus className="h-4 w-4 mr-1" /> Add Accommodation
                        </Button>
                      ) : (
                        <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" /> Read-only</Badge>
                      )}
                    </div>
                    {accommodations.length === 0 && <p className="text-sm text-muted-foreground">No accommodations on file.</p>}
                    {accommodations.map((a) => (
                      <Card key={a.id}>
                        <CardContent className="py-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{a.accommodation_type} <Badge variant="outline" className="ml-1">{a.applies_to}</Badge></p>
                            {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
                          </div>
                          {isCaseManager ? (
                            <div className="flex items-center gap-1">
                              <Button variant={a.active ? "outline" : "secondary"} size="sm" onClick={() => toggleAccommodation(a.id, a.active)}>
                                {a.active ? "Active" : "Inactive"}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openAccEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteAccommodation(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
                          ) : (
                            <Badge variant={a.active ? "outline" : "secondary"}>{a.active ? "Active" : "Inactive"}</Badge>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </TabsContent>

                  {/* THERAPY TAB */}
                  <TabsContent value="therapy" className="space-y-2 mt-3">
                    <div className="flex justify-end">
                      <Button size="sm" onClick={() => { setEditingSessionId(null); setSessionForm({ therapy_type: THERAPY_TYPES[0], session_date: "", duration_minutes: "", goals_addressed: "", notes: "" }); setSessionOpen(true); }}>
                        <Plus className="h-4 w-4 mr-1" /> Log Session
                      </Button>
                    </div>
                    {sessions.length === 0 && <p className="text-sm text-muted-foreground">No therapy sessions logged.</p>}
                    {sessions.map((s) => (
                      <Card key={s.id}>
                        <CardContent className="py-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">{s.therapy_type} · {s.session_date}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-xs text-muted-foreground">{s.therapist?.full_name || "Unassigned"}{s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}</p>
                              {canEditSession(s) && (
                                <>
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openSessionEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deleteSession(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                </>
                              )}
                            </div>
                          </div>
                          {s.goals_addressed && <p className="text-xs mt-1">Goals: {s.goals_addressed}</p>}
                          {s.notes && <p className="text-xs text-muted-foreground mt-1">{s.notes}</p>}
                        </CardContent>
                      </Card>
                    ))}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* IEP Plan Dialog */}
      <Dialog open={planOpen} onOpenChange={(o) => { setPlanOpen(o); if (!o) { setEditingPlanId(null); setPlanForm({ title: "", start_date: "", end_date: "", status: "draft" }); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingPlanId ? "Edit IEP Plan" : "New IEP Plan"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title</Label><Input value={planForm.title} onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })} /></div>
            <div><Label>Start Date</Label><Input type="date" value={planForm.start_date} onChange={(e) => setPlanForm({ ...planForm, start_date: e.target.value })} /></div>
            <div><Label>End Date (optional)</Label><Input type="date" value={planForm.end_date} onChange={(e) => setPlanForm({ ...planForm, end_date: e.target.value })} /></div>
            {editingPlanId && (
              <div>
                <Label>Status</Label>
                <Select value={planForm.status} onValueChange={(v) => setPlanForm({ ...planForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter><Button onClick={addPlan}>{editingPlanId ? "Save Changes" : "Create Plan"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Goal Dialog */}
      <Dialog open={!!goalOpen} onOpenChange={(o) => { if (!o) { setGoalOpen(null); setEditingGoal(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingGoal ? "Edit IEP Goal" : "Add IEP Goal"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Domain</Label>
              <Select value={goalForm.domain} onValueChange={(v) => setGoalForm({ ...goalForm, domain: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Academic", "Behavioral", "Communication", "Social", "Motor", "Self-Help"].map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Goal Description</Label><Textarea value={goalForm.goal_description} onChange={(e) => setGoalForm({ ...goalForm, goal_description: e.target.value })} /></div>
            <div><Label>Baseline</Label><Input value={goalForm.baseline} onChange={(e) => setGoalForm({ ...goalForm, baseline: e.target.value })} /></div>
            <div><Label>Target Criteria</Label><Input value={goalForm.target_criteria} onChange={(e) => setGoalForm({ ...goalForm, target_criteria: e.target.value })} /></div>
            <div><Label>Target Date</Label><Input type="date" value={goalForm.target_date} onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={() => goalOpen && addGoal(goalOpen)}>{editingGoal ? "Save Changes" : "Add Goal"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={!!reviewOpen} onOpenChange={(o) => { if (!o) { setReviewOpen(null); setEditingReview(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingReview ? "Edit IEP Review" : "Log IEP Review"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Review Date</Label><Input type="date" value={reviewForm.review_date} onChange={(e) => setReviewForm({ ...reviewForm, review_date: e.target.value })} /></div>
            <div><Label>Attendees</Label><Input value={reviewForm.attendees} onChange={(e) => setReviewForm({ ...reviewForm, attendees: e.target.value })} /></div>
            <div><Label>Summary</Label><Textarea value={reviewForm.summary} onChange={(e) => setReviewForm({ ...reviewForm, summary: e.target.value })} /></div>
            <div><Label>Next Review Date</Label><Input type="date" value={reviewForm.next_review_date} onChange={(e) => setReviewForm({ ...reviewForm, next_review_date: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={() => reviewOpen && addReview(reviewOpen)}>{editingReview ? "Save Changes" : "Save Review"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Accommodation Dialog */}
      <Dialog open={accOpen} onOpenChange={(o) => { setAccOpen(o); if (!o) setEditingAccId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingAccId ? "Edit Accommodation" : "Add Accommodation"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Select value={accForm.accommodation_type} onValueChange={(v) => setAccForm({ ...accForm, accommodation_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOMMODATION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Applies To</Label>
              <Select value={accForm.applies_to} onValueChange={(v) => setAccForm({ ...accForm, applies_to: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="classroom">Classroom</SelectItem>
                  <SelectItem value="exam">Exam</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Textarea value={accForm.description} onChange={(e) => setAccForm({ ...accForm, description: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={addAccommodation}>{editingAccId ? "Save Changes" : "Add"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Therapy Session Dialog */}
      <Dialog open={sessionOpen} onOpenChange={(o) => { setSessionOpen(o); if (!o) setEditingSessionId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingSessionId ? "Edit Therapy Session" : "Log Therapy Session"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Therapy Type</Label>
              <Select value={sessionForm.therapy_type} onValueChange={(v) => setSessionForm({ ...sessionForm, therapy_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {THERAPY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Session Date</Label><Input type="date" value={sessionForm.session_date} onChange={(e) => setSessionForm({ ...sessionForm, session_date: e.target.value })} /></div>
            <div><Label>Duration (minutes)</Label><Input type="number" value={sessionForm.duration_minutes} onChange={(e) => setSessionForm({ ...sessionForm, duration_minutes: e.target.value })} /></div>
            <div><Label>Goals Addressed</Label><Input value={sessionForm.goals_addressed} onChange={(e) => setSessionForm({ ...sessionForm, goals_addressed: e.target.value })} /></div>
            <div><Label>Notes</Label><Textarea value={sessionForm.notes} onChange={(e) => setSessionForm({ ...sessionForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={addSession}>{editingSessionId ? "Save Changes" : "Log Session"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
