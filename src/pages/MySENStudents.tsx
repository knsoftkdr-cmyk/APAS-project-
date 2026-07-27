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
  ArrowLeft,
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

const PLAN_STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  active: "bg-emerald-500 text-white border-transparent",
  completed: "bg-blue-100 text-blue-700 border-blue-200",
  archived: "bg-slate-100 text-slate-500 border-slate-200",
};

const GOAL_STATUS_STYLE: Record<string, string> = {
  not_started: "bg-slate-100 text-slate-600 border-slate-200",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  achieved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  discontinued: "bg-red-50 text-red-600 border-red-200",
};

export default function MySENStudents() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const schoolId = profile?.school_id;
  const myId = profile?.id;

  const [senStudents, setSenStudents] = useState<SenStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SenStudent | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);

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
        active: true,
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

  const selectStudent = (s: SenStudent) => {
    setSelected(s);
    setShowMobileDetail(true);
  };

  return (
    <AppLayout>
      <div className="relative min-h-screen overflow-x-hidden">
        <div className="absolute top-10 right-10 w-72 h-72 rounded-full bg-emerald-300 opacity-[0.08] blur-3xl pointer-events-none" />
        <div className="absolute top-96 left-0 w-64 h-64 rounded-full bg-teal-200 opacity-[0.08] blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-4 p-3 md:p-6">
          {/* ── Hero ─────────────────────────────────────────── */}
          <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 shadow-lg">
            <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
            <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <Accessibility className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white">My SEN Students</h1>
                <p className="text-emerald-100 text-xs md:text-sm mt-0.5">
                  Students where you're the case manager or an assigned therapist
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            {/* ── Student list panel ──────────────────────────── */}
            <Card className={`h-fit border border-emerald-100 rounded-2xl shadow-sm overflow-hidden ${showMobileDetail ? "hidden lg:block" : "block"}`}>
              <CardHeader className="pb-3 bg-gradient-to-r from-emerald-50 to-teal-50/50 border-b border-emerald-100">
                <CardTitle className="text-base flex items-center gap-2 text-emerald-900">
                  <Users className="h-4 w-4" /> Students ({senStudents.length})
                </CardTitle>
                <div className="relative mt-2">
                  <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-emerald-400" />
                  <Input
                    placeholder="Search..."
                    className="pl-8 rounded-xl border-emerald-100 h-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5 max-h-[70vh] overflow-y-auto p-3">
                {loading && <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>}
                {!loading && filteredSenStudents.length === 0 && (
                  <p className="text-sm text-muted-foreground py-8 text-center">No SEN students assigned to you yet.</p>
                )}
                {filteredSenStudents.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => selectStudent(s)}
                    className={`w-full text-left p-2.5 rounded-xl flex items-center gap-3 transition-all ${
                      selected?.id === s.id ? "bg-emerald-50 border border-emerald-300 shadow-sm" : "border border-transparent hover:bg-slate-50 hover:border-slate-200"
                    }`}
                  >
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {(s.student?.full_name || "?")[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate text-slate-800">{s.student?.full_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {s.student?.class} {s.student?.section} · {s.category}
                        {s.case_manager_id === myId ? " · Case Manager" : " · Therapist"}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* ── Detail panel ─────────────────────────────────── */}
            {!selected ? (
              <Card className="hidden lg:flex border border-emerald-100 rounded-2xl shadow-sm">
                <CardContent className="py-16 text-center text-muted-foreground w-full">
                  <Accessibility className="h-10 w-10 text-emerald-200 mx-auto mb-3" />
                  Select a student to view their SEN record.
                </CardContent>
              </Card>
            ) : (
              <Card className={`border border-emerald-100 rounded-2xl shadow-sm overflow-hidden ${showMobileDetail ? "block" : "hidden lg:block"}`}>
                <CardHeader className="pb-3 bg-gradient-to-r from-emerald-50 to-teal-50/50 border-b border-emerald-100">
                  <button
                    onClick={() => setShowMobileDetail(false)}
                    className="lg:hidden inline-flex items-center gap-1 text-xs font-medium text-emerald-700 mb-2"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to students
                  </button>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-11 w-11 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white text-base font-bold shrink-0">
                        {(selected.student?.full_name || "?")[0]}
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base md:text-lg truncate">{selected.student?.full_name}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {selected.student?.class} {selected.student?.section}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">{selected.category}</Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        {isCaseManager ? "You are the case manager" : "Therapist view (read-only IEP)"}
                      </p>
                    </div>
                  </div>
                  {selected.diagnosis_notes && (
                    <p className="text-sm text-muted-foreground mt-2 bg-white/70 rounded-lg p-2.5 border border-emerald-100">{selected.diagnosis_notes}</p>
                  )}
                </CardHeader>
                <CardContent className="pt-4">
                  <Tabs defaultValue="iep">
                    <TabsList className="w-full overflow-x-auto flex-nowrap justify-start bg-slate-100 rounded-xl p-1 h-auto">
                      <TabsTrigger value="iep" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">
                        <FileText className="h-3.5 w-3.5 mr-1" /> IEP
                      </TabsTrigger>
                      <TabsTrigger value="accommodations" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">
                        <Accessibility className="h-3.5 w-3.5 mr-1" /> Accommodations
                      </TabsTrigger>
                      <TabsTrigger value="therapy" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">
                        <Stethoscope className="h-3.5 w-3.5 mr-1" /> Therapy
                      </TabsTrigger>
                    </TabsList>

                    {/* IEP TAB */}
                    <TabsContent value="iep" className="space-y-3 mt-4">
                      <div className="flex justify-end">
                        {isCaseManager ? (
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 rounded-xl w-full sm:w-auto"
                            onClick={() => { setEditingPlanId(null); setPlanForm({ title: "", start_date: "", end_date: "", status: "draft" }); setPlanOpen(true); }}
                          >
                            <Plus className="h-4 w-4 mr-1" /> New IEP Plan
                          </Button>
                        ) : (
                          <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" /> Read-only</Badge>
                        )}
                      </div>
                      {detailLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
                      {!detailLoading && plans.length === 0 && (
                        <p className="text-sm text-muted-foreground py-6 text-center">No IEP plans yet.</p>
                      )}
                      {plans.map((plan) => (
                        <Card key={plan.id} className="border border-emerald-100 rounded-xl shadow-sm overflow-hidden">
                          <div className="h-1 bg-gradient-to-r from-emerald-400 to-teal-400" />
                          <CardHeader className="pb-2 pt-3">
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div className="min-w-0">
                                <CardTitle className="text-base truncate">{plan.title}</CardTitle>
                                <p className="text-xs text-muted-foreground">{plan.start_date} → {plan.end_date || "ongoing"}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Badge className={`${PLAN_STATUS_STYLE[plan.status] || ""} capitalize`}>{plan.status}</Badge>
                                {isCaseManager && (
                                  <>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-full hover:bg-emerald-50" onClick={() => openPlanEdit(plan)}><Pencil className="h-3.5 w-3.5" /></Button>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-full text-destructive hover:text-destructive hover:bg-red-50" onClick={() => deletePlan(plan.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                  </>
                                )}
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-sm font-semibold flex items-center gap-1.5 text-slate-700"><Target className="h-3.5 w-3.5 text-emerald-500" /> Goals</p>
                                {isCaseManager && (
                                  <Button variant="ghost" size="sm" className="text-emerald-700 hover:bg-emerald-50 rounded-lg" onClick={() => { setEditingGoal(null); setGoalForm({ domain: "Academic", goal_description: "", baseline: "", target_criteria: "", target_date: "" }); setGoalOpen(plan.id); }}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Goal
                                  </Button>
                                )}
                              </div>
                              {plan.goals?.length === 0 && <p className="text-xs text-muted-foreground">No goals added.</p>}
                              <div className="space-y-1.5">
                                {plan.goals?.map((g) => (
                                  <div key={g.id} className="text-sm border border-slate-100 bg-slate-50/50 rounded-xl p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-slate-800"><span className="font-semibold">{g.domain}:</span> {g.goal_description}</p>
                                      {g.target_criteria && <p className="text-xs text-muted-foreground mt-0.5">Target: {g.target_criteria}</p>}
                                    </div>
                                    {isCaseManager ? (
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <Select value={g.progress_status} onValueChange={(v) => updateGoalStatus(g.id, v)}>
                                          <SelectTrigger className="w-[130px] h-7 text-xs rounded-lg"><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="not_started">Not Started</SelectItem>
                                            <SelectItem value="in_progress">In Progress</SelectItem>
                                            <SelectItem value="achieved">Achieved</SelectItem>
                                            <SelectItem value="discontinued">Discontinued</SelectItem>
                                          </SelectContent>
                                        </Select>
                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-full hover:bg-emerald-50" onClick={() => openGoalEdit(plan.id, g)}><Pencil className="h-3.5 w-3.5" /></Button>
                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-full text-destructive hover:text-destructive hover:bg-red-50" onClick={() => deleteGoal(g.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                      </div>
                                    ) : (
                                      <Badge className={`${GOAL_STATUS_STYLE[g.progress_status] || ""} shrink-0 capitalize`}>{g.progress_status.replace("_", " ")}</Badge>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-sm font-semibold flex items-center gap-1.5 text-slate-700"><CalendarClock className="h-3.5 w-3.5 text-emerald-500" /> Reviews</p>
                                {isCaseManager && (
                                  <Button variant="ghost" size="sm" className="text-emerald-700 hover:bg-emerald-50 rounded-lg" onClick={() => { setEditingReview(null); setReviewForm({ review_date: "", attendees: "", summary: "", next_review_date: "" }); setReviewOpen(plan.id); }}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Review
                                  </Button>
                                )}
                              </div>
                              {plan.reviews?.length === 0 && <p className="text-xs text-muted-foreground">No reviews logged.</p>}
                              <div className="space-y-1.5">
                                {plan.reviews?.map((r) => (
                                  <div key={r.id} className="text-sm border border-slate-100 bg-slate-50/50 rounded-xl p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="font-semibold text-slate-800">{r.review_date}{r.next_review_date ? ` · next: ${r.next_review_date}` : ""}</p>
                                      {r.summary && <p className="text-xs text-muted-foreground mt-0.5">{r.summary}</p>}
                                    </div>
                                    {isCaseManager && (
                                      <div className="flex items-center gap-1 shrink-0">
                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-full hover:bg-emerald-50" onClick={() => openReviewEdit(plan.id, r)}><Pencil className="h-3.5 w-3.5" /></Button>
                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-full text-destructive hover:text-destructive hover:bg-red-50" onClick={() => deleteReview(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </TabsContent>

                    {/* ACCOMMODATIONS TAB */}
                    <TabsContent value="accommodations" className="space-y-2.5 mt-4">
                      <div className="flex justify-end">
                        {isCaseManager ? (
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 rounded-xl w-full sm:w-auto"
                            onClick={() => { setEditingAccId(null); setAccForm({ accommodation_type: ACCOMMODATION_TYPES[0], applies_to: "both", description: "" }); setAccOpen(true); }}
                          >
                            <Plus className="h-4 w-4 mr-1" /> Add Accommodation
                          </Button>
                        ) : (
                          <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" /> Read-only</Badge>
                        )}
                      </div>
                      {accommodations.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No accommodations on file.</p>}
                      {accommodations.map((a) => (
                        <Card key={a.id} className="border border-emerald-100 rounded-xl shadow-sm">
                          <CardContent className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
                                {a.accommodation_type}
                                <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50/50 font-normal">{a.applies_to}</Badge>
                              </p>
                              {a.description && <p className="text-xs text-muted-foreground mt-1">{a.description}</p>}
                            </div>
                            {isCaseManager ? (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button
                                  variant={a.active ? "outline" : "secondary"}
                                  size="sm"
                                  className={`rounded-lg ${a.active ? "border-emerald-200 text-emerald-700" : ""}`}
                                  onClick={() => toggleAccommodation(a.id, a.active)}
                                >
                                  {a.active ? "Active" : "Inactive"}
                                </Button>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-emerald-50" onClick={() => openAccEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full text-destructive hover:text-destructive hover:bg-red-50" onClick={() => deleteAccommodation(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </div>
                            ) : (
                              <Badge variant={a.active ? "outline" : "secondary"} className="shrink-0">{a.active ? "Active" : "Inactive"}</Badge>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </TabsContent>

                    {/* THERAPY TAB */}
                    <TabsContent value="therapy" className="space-y-2.5 mt-4">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 rounded-xl w-full sm:w-auto"
                          onClick={() => { setEditingSessionId(null); setSessionForm({ therapy_type: THERAPY_TYPES[0], session_date: "", duration_minutes: "", goals_addressed: "", notes: "" }); setSessionOpen(true); }}
                        >
                          <Plus className="h-4 w-4 mr-1" /> Log Session
                        </Button>
                      </div>
                      {sessions.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No therapy sessions logged.</p>}
                      {sessions.map((s) => (
                        <Card key={s.id} className="border border-emerald-100 rounded-xl shadow-sm">
                          <CardContent className="py-3">
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="h-8 w-8 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                                  <Stethoscope className="h-4 w-4 text-teal-600" />
                                </div>
                                <p className="text-sm font-semibold text-slate-800">{s.therapy_type} · {s.session_date}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <p className="text-xs text-muted-foreground">{s.therapist?.full_name || "Unassigned"}{s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}</p>
                                {canEditSession(s) && (
                                  <>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-full hover:bg-emerald-50" onClick={() => openSessionEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-full text-destructive hover:text-destructive hover:bg-red-50" onClick={() => deleteSession(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                  </>
                                )}
                              </div>
                            </div>
                            {s.goals_addressed && <p className="text-xs mt-2 ml-10 text-slate-600">Goals: {s.goals_addressed}</p>}
                            {s.notes && <p className="text-xs text-muted-foreground mt-1 ml-10">{s.notes}</p>}
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
      </div>

      {/* IEP Plan Dialog */}
      <Dialog open={planOpen} onOpenChange={(o) => { setPlanOpen(o); if (!o) { setEditingPlanId(null); setPlanForm({ title: "", start_date: "", end_date: "", status: "draft" }); } }}>
        <DialogContent className="rounded-2xl w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader><DialogTitle>{editingPlanId ? "Edit IEP Plan" : "New IEP Plan"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title</Label><Input className="rounded-xl mt-1" value={planForm.title} onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })} /></div>
            <div><Label>Start Date</Label><Input type="date" className="rounded-xl mt-1" value={planForm.start_date} onChange={(e) => setPlanForm({ ...planForm, start_date: e.target.value })} /></div>
            <div><Label>End Date (optional)</Label><Input type="date" className="rounded-xl mt-1" value={planForm.end_date} onChange={(e) => setPlanForm({ ...planForm, end_date: e.target.value })} /></div>
            {editingPlanId && (
              <div>
                <Label>Status</Label>
                <Select value={planForm.status} onValueChange={(v) => setPlanForm({ ...planForm, status: v })}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
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
          <DialogFooter><Button className="bg-emerald-600 hover:bg-emerald-700 rounded-xl w-full sm:w-auto" onClick={addPlan}>{editingPlanId ? "Save Changes" : "Create Plan"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Goal Dialog */}
      <Dialog open={!!goalOpen} onOpenChange={(o) => { if (!o) { setGoalOpen(null); setEditingGoal(null); } }}>
        <DialogContent className="rounded-2xl w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader><DialogTitle>{editingGoal ? "Edit IEP Goal" : "Add IEP Goal"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Domain</Label>
              <Select value={goalForm.domain} onValueChange={(v) => setGoalForm({ ...goalForm, domain: v })}>
                <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Academic", "Behavioral", "Communication", "Social", "Motor", "Self-Help"].map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Goal Description</Label><Textarea className="rounded-xl mt-1" value={goalForm.goal_description} onChange={(e) => setGoalForm({ ...goalForm, goal_description: e.target.value })} /></div>
            <div><Label>Baseline</Label><Input className="rounded-xl mt-1" value={goalForm.baseline} onChange={(e) => setGoalForm({ ...goalForm, baseline: e.target.value })} /></div>
            <div><Label>Target Criteria</Label><Input className="rounded-xl mt-1" value={goalForm.target_criteria} onChange={(e) => setGoalForm({ ...goalForm, target_criteria: e.target.value })} /></div>
            <div><Label>Target Date</Label><Input type="date" className="rounded-xl mt-1" value={goalForm.target_date} onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })} /></div>
          </div>
          <DialogFooter><Button className="bg-emerald-600 hover:bg-emerald-700 rounded-xl w-full sm:w-auto" onClick={() => goalOpen && addGoal(goalOpen)}>{editingGoal ? "Save Changes" : "Add Goal"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={!!reviewOpen} onOpenChange={(o) => { if (!o) { setReviewOpen(null); setEditingReview(null); } }}>
        <DialogContent className="rounded-2xl w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader><DialogTitle>{editingReview ? "Edit IEP Review" : "Log IEP Review"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Review Date</Label><Input type="date" className="rounded-xl mt-1" value={reviewForm.review_date} onChange={(e) => setReviewForm({ ...reviewForm, review_date: e.target.value })} /></div>
            <div><Label>Attendees</Label><Input className="rounded-xl mt-1" value={reviewForm.attendees} onChange={(e) => setReviewForm({ ...reviewForm, attendees: e.target.value })} /></div>
            <div><Label>Summary</Label><Textarea className="rounded-xl mt-1" value={reviewForm.summary} onChange={(e) => setReviewForm({ ...reviewForm, summary: e.target.value })} /></div>
            <div><Label>Next Review Date</Label><Input type="date" className="rounded-xl mt-1" value={reviewForm.next_review_date} onChange={(e) => setReviewForm({ ...reviewForm, next_review_date: e.target.value })} /></div>
          </div>
          <DialogFooter><Button className="bg-emerald-600 hover:bg-emerald-700 rounded-xl w-full sm:w-auto" onClick={() => reviewOpen && addReview(reviewOpen)}>{editingReview ? "Save Changes" : "Save Review"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Accommodation Dialog */}
      <Dialog open={accOpen} onOpenChange={(o) => { setAccOpen(o); if (!o) setEditingAccId(null); }}>
        <DialogContent className="rounded-2xl w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader><DialogTitle>{editingAccId ? "Edit Accommodation" : "Add Accommodation"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Select value={accForm.accommodation_type} onValueChange={(v) => setAccForm({ ...accForm, accommodation_type: v })}>
                <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOMMODATION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Applies To</Label>
              <Select value={accForm.applies_to} onValueChange={(v) => setAccForm({ ...accForm, applies_to: v })}>
                <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="classroom">Classroom</SelectItem>
                  <SelectItem value="exam">Exam</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Textarea className="rounded-xl mt-1" value={accForm.description} onChange={(e) => setAccForm({ ...accForm, description: e.target.value })} /></div>
          </div>
          <DialogFooter><Button className="bg-emerald-600 hover:bg-emerald-700 rounded-xl w-full sm:w-auto" onClick={addAccommodation}>{editingAccId ? "Save Changes" : "Add"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Therapy Session Dialog */}
      <Dialog open={sessionOpen} onOpenChange={(o) => { setSessionOpen(o); if (!o) setEditingSessionId(null); }}>
        <DialogContent className="rounded-2xl w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader><DialogTitle>{editingSessionId ? "Edit Therapy Session" : "Log Therapy Session"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Therapy Type</Label>
              <Select value={sessionForm.therapy_type} onValueChange={(v) => setSessionForm({ ...sessionForm, therapy_type: v })}>
                <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {THERAPY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Session Date</Label><Input type="date" className="rounded-xl mt-1" value={sessionForm.session_date} onChange={(e) => setSessionForm({ ...sessionForm, session_date: e.target.value })} /></div>
            <div><Label>Duration (minutes)</Label><Input type="number" className="rounded-xl mt-1" value={sessionForm.duration_minutes} onChange={(e) => setSessionForm({ ...sessionForm, duration_minutes: e.target.value })} /></div>
            <div><Label>Goals Addressed</Label><Input className="rounded-xl mt-1" value={sessionForm.goals_addressed} onChange={(e) => setSessionForm({ ...sessionForm, goals_addressed: e.target.value })} /></div>
            <div><Label>Notes</Label><Textarea className="rounded-xl mt-1" value={sessionForm.notes} onChange={(e) => setSessionForm({ ...sessionForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button className="bg-emerald-600 hover:bg-emerald-700 rounded-xl w-full sm:w-auto" onClick={addSession}>{editingSessionId ? "Save Changes" : "Log Session"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
