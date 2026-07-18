import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowRightLeft, Check, X, Loader2 } from "lucide-react";

type TransferType = "internal" | "external_in" | "external_out";

interface Student {
  id: string;
  full_name: string;
  class: string;
  section: string;
}

interface School {
  id: string;
  full_name: string;
}

interface TransferRequest {
  id: string;
  student_id: string;
  transfer_type: TransferType;
  from_school_id: string | null;
  to_school_id: string | null;
  previous_school_name: string | null;
  new_school_name: string | null;
  new_class: string | null;
  new_section: string | null;
  transfer_date: string;
  reason: string | null;
  status: string;
  created_at: string;
  students?: { name: string } | null;
}

export default function StudentTransfers() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [students, setStudents] = useState<Student[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [pendingTransfers, setPendingTransfers] = useState<TransferRequest[]>([]);
  const [approvedTransfers, setApprovedTransfers] = useState<TransferRequest[]>([]);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [loadingApproved, setLoadingApproved] = useState(true);
  const [loadingPending, setLoadingPending] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    student_id: "",
    new_student_name: "",
    transfer_type: "internal" as TransferType,
    to_school_id: "",
    previous_school_name: "",
    new_school_name: "",
    new_class: "",
    new_section: "",
    transfer_date: new Date().toISOString().slice(0, 10),
    reason: "",
  });

  useEffect(() => {
    if (!profile?.school_id) return;
    loadStudents();
    loadSchools();
    loadPendingTransfers();
    loadApprovedTransfers();
  }, [profile?.school_id]);

  async function loadStudents() {
    const { data, error } = await supabase
      .from("students")
      .select("id, full_name, class, section")
      .eq("school_id", profile?.school_id)
      .order("class", { ascending: true })
      .order("section", { ascending: true })
      .order("full_name", { ascending: true });
    if (error) console.error("loadStudents error:", error.message);
    if (!error && data) {
      const sorted = [...data].sort((a, b) => {
        const classA = parseInt(String(a.class).replace(/\D/g, ""), 10) || 0;
        const classB = parseInt(String(b.class).replace(/\D/g, ""), 10) || 0;
        if (classA !== classB) return classA - classB;
        if (a.section !== b.section) return (a.section || "").localeCompare(b.section || "");
        return a.full_name.localeCompare(b.full_name);
      });
      setStudents(sorted as Student[]);
    }
  }

  async function loadSchools() {
    const { data, error } = await supabase.from("schools").select("id, name").order("name");
    if (!error && data) setSchools(data as School[]);
  }

  async function loadPendingTransfers() {
    setLoadingPending(true);
    const { data, error } = await supabase
      .from("student_transfers")
      .select("*, students:student_id(full_name)")
      .eq("status", "pending_review")
      .or(`from_school_id.eq.${profile?.school_id},to_school_id.eq.${profile?.school_id}`)
      .order("created_at", { ascending: false });

    if (!error && data) setPendingTransfers(data as unknown as TransferRequest[]);
    setLoadingPending(false);
  }

  async function loadApprovedTransfers() {
    setLoadingApproved(true);
    const { data, error } = await supabase
      .from("student_transfers")
      .select("*, students:student_id(full_name), approver:approved_by(full_name)")
      .eq("status", "completed")
      .or(`from_school_id.eq.${profile?.school_id},to_school_id.eq.${profile?.school_id}`)
      .order("approved_at", { ascending: false });

    if (error) console.error("loadApprovedTransfers error:", error.message);
    if (!error && data) setApprovedTransfers(data as unknown as TransferRequest[]);
    setLoadingApproved(false);
  }

  function resetForm() {
    setForm({
      student_id: "",
      new_student_name: "",
      transfer_type: "internal",
      to_school_id: "",
      previous_school_name: "",
      new_school_name: "",
      new_class: "",
      new_section: "",
      transfer_date: new Date().toISOString().slice(0, 10),
      reason: "",
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.transfer_type === "external_in") {
      if (!form.new_student_name || !form.transfer_date) {
        toast({ title: "Missing details", description: "Enter the student's name and transfer date.", variant: "destructive" });
        return;
      }
    } else if (!form.student_id || !form.transfer_date) {
      toast({ title: "Missing details", description: "Select a student and transfer date.", variant: "destructive" });
      return;
    }
    if (form.transfer_type === "internal" && !form.to_school_id) {
      toast({ title: "Missing target school", description: "Pick the school this student is moving to.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from("student_transfers").insert({
      student_id: form.transfer_type === "external_in" ? null : form.student_id,
      new_student_name: form.transfer_type === "external_in" ? form.new_student_name : null,
      transfer_type: form.transfer_type,
      from_school_id: form.transfer_type !== "external_in" ? profile?.school_id : null,
      to_school_id: form.transfer_type === "internal" ? form.to_school_id : null,
      previous_school_name: form.transfer_type === "external_in" ? form.previous_school_name : null,
      new_school_name: form.transfer_type === "external_out" ? form.new_school_name : null,
      new_class: (form.transfer_type === "internal" || form.transfer_type === "external_in") ? form.new_class : null,
      new_section: (form.transfer_type === "internal" || form.transfer_type === "external_in") ? form.new_section : null,
      transfer_date: form.transfer_date,
      reason: form.reason,
      requested_by: profile?.id,
    });
    setSubmitting(false);

    if (error) {
      toast({ title: "Couldn't submit transfer", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Transfer request submitted", description: "Awaiting principal approval." });
    resetForm();
    loadPendingTransfers();
  }

  async function handleDecision(transferId: string, decision: "approved" | "rejected") {
    setProcessingId(transferId);
    const { data, error } = await supabase.functions.invoke("approve-transfer", {
      body: { transfer_id: transferId, decision },
    });
    setProcessingId(null);

    if (error || data?.error) {
      toast({
        title: "Couldn't process transfer",
        description: error?.message ?? data?.error ?? "Unexpected error",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: decision === "approved" ? "Transfer approved" : "Transfer rejected",
      description: decision === "approved" ? "The student record has been updated." : "The request has been closed.",
    });
    loadPendingTransfers();
    loadApprovedTransfers();
  }

  const transferTypeLabel: Record<TransferType, string> = {
    internal: "Internal (between our schools)",
    external_in: "External — joining from another school",
    external_out: "External — leaving to another school",
  };

  const uniqueClasses = Array.from(new Set(students.map((s) => s.class))).sort(
    (a, b) => (parseInt(String(a).replace(/\D/g, ""), 10) || 0) - (parseInt(String(b).replace(/\D/g, ""), 10) || 0)
  );
  const filteredStudents = classFilter === "all" ? students : students.filter((s) => s.class === classFilter);

  return (
    <AppLayout>
      <div className="min-h-screen relative overflow-x-hidden">
        <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-blue-300 opacity-[0.10] blur-3xl" />
        <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-sky-300 opacity-[0.08] blur-3xl" />
        <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-blue-200 opacity-[0.08] blur-3xl" />

        <div className="relative z-10 p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
          {/* Header */}
          <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-blue-600 to-sky-500 shadow-lg">
            <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
            <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative flex items-center gap-3 md:gap-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <ArrowRightLeft className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white">Student Transfers</h1>
                <p className="text-blue-100 text-xs md:text-sm mt-0.5">Request and approve student transfers between schools</p>
              </div>
            </div>
          </div>

          <Tabs defaultValue="new" className="w-full">
            <TabsList className="bg-blue-50/60 p-1 h-auto rounded-xl border border-blue-100">
              <TabsTrigger
                value="new"
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm"
              >
                New Transfer
              </TabsTrigger>
              <TabsTrigger
                value="pending"
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm"
              >
                Pending Approvals
                {pendingTransfers.length > 0 && (
                  <Badge className="ml-2 bg-blue-600 text-white hover:bg-blue-600">{pendingTransfers.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="approved"
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm"
              >
                Approved Transfers
              </TabsTrigger>
            </TabsList>

            {/* NEW TRANSFER TAB */}
            <TabsContent value="new" className="mt-4">
              <Card className="overflow-hidden border-blue-100 shadow-sm">
                <div className="h-1 bg-gradient-to-r from-blue-500 to-sky-500" />
                <CardHeader>
                  <CardTitle>Request a transfer</CardTitle>
                  <CardDescription>Submitted requests need principal approval before taking effect.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-2">
                      <Label>Class</Label>
                      <Select value={classFilter} onValueChange={(v) => { setClassFilter(v); setForm({ ...form, student_id: "" }); }}>
                        <SelectTrigger className="border-slate-200 focus:ring-blue-400">
                          <SelectValue placeholder="All classes" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All classes</SelectItem>
                          {uniqueClasses.map((c) => (
                            <SelectItem key={c} value={c}>Class {c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Student</Label>
                      <Select value={form.student_id} onValueChange={(v) => setForm({ ...form, student_id: v })}>
                        <SelectTrigger className="border-slate-200 focus:ring-blue-400">
                          <SelectValue placeholder="Select a student" />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredStudents.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.full_name} — Class {s.class}{s.section ? ` ${s.section}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Transfer type</Label>
                      <Select
                        value={form.transfer_type}
                        onValueChange={(v: TransferType) => setForm({ ...form, transfer_type: v })}
                      >
                        <SelectTrigger className="border-slate-200 focus:ring-blue-400">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(transferTypeLabel) as TransferType[]).map((t) => (
                            <SelectItem key={t} value={t}>{transferTypeLabel[t]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {form.transfer_type === "internal" && (
                      <>
                        <div className="space-y-2">
                          <Label>Transferring to</Label>
                          <Select value={form.to_school_id} onValueChange={(v) => setForm({ ...form, to_school_id: v })}>
                            <SelectTrigger className="border-slate-200 focus:ring-blue-400">
                              <SelectValue placeholder="Select destination school" />
                            </SelectTrigger>
                            <SelectContent>
                              {schools.filter((s) => s.id !== profile?.school_id).map((s) => (
                                <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>New class</Label>
                            <Input
                              placeholder="e.g. 8"
                              value={form.new_class}
                              onChange={(e) => setForm({ ...form, new_class: e.target.value })}
                              className="border-slate-200 focus-visible:ring-blue-400"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>New section</Label>
                            <Input
                              placeholder="e.g. B"
                              value={form.new_section}
                              onChange={(e) => setForm({ ...form, new_section: e.target.value })}
                              className="border-slate-200 focus-visible:ring-blue-400"
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {form.transfer_type === "external_in" && (
                      <>
                        <div className="space-y-2">
                          <Label>Student name</Label>
                          <Input
                            placeholder="Full name of the incoming student"
                            value={form.new_student_name}
                            onChange={(e) => setForm({ ...form, new_student_name: e.target.value })}
                            className="border-slate-200 focus-visible:ring-blue-400"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Class</Label>
                            <Input
                              placeholder="e.g. 8"
                              value={form.new_class}
                              onChange={(e) => setForm({ ...form, new_class: e.target.value })}
                              className="border-slate-200 focus-visible:ring-blue-400"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Section</Label>
                            <Input
                              placeholder="e.g. B"
                              value={form.new_section}
                              onChange={(e) => setForm({ ...form, new_section: e.target.value })}
                              className="border-slate-200 focus-visible:ring-blue-400"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Previous school name</Label>
                          <Input
                            placeholder="Name of the school they're joining from"
                            value={form.previous_school_name}
                            onChange={(e) => setForm({ ...form, previous_school_name: e.target.value })}
                            className="border-slate-200 focus-visible:ring-blue-400"
                          />
                        </div>
                      </>
                    )}

                    {form.transfer_type === "external_out" && (
                      <div className="space-y-2">
                        <Label>New school name</Label>
                        <Input
                          placeholder="Name of the school they're moving to"
                          value={form.new_school_name}
                          onChange={(e) => setForm({ ...form, new_school_name: e.target.value })}
                          className="border-slate-200 focus-visible:ring-blue-400"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Transfer date</Label>
                      <Input
                        type="date"
                        value={form.transfer_date}
                        onChange={(e) => setForm({ ...form, transfer_date: e.target.value })}
                        className="border-slate-200 focus-visible:ring-blue-400"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Reason</Label>
                      <Textarea
                        placeholder="Brief reason for the transfer"
                        value={form.reason}
                        onChange={(e) => setForm({ ...form, reason: e.target.value })}
                        className="border-slate-200 focus-visible:ring-blue-400"
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={submitting}
                      className="bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-700 hover:to-sky-600"
                    >
                      {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Submit request
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            {/* PENDING APPROVALS TAB */}
            <TabsContent value="pending" className="mt-4">
              <Card className="overflow-hidden border-blue-100 shadow-sm">
                <div className="h-1 bg-gradient-to-r from-blue-500 to-sky-500" />
                <CardHeader>
                  <CardTitle>Pending transfer requests</CardTitle>
                  <CardDescription>Requests involving your school, awaiting a decision.</CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingPending ? (
                    <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin text-blue-500" /> Loading requests...
                    </div>
                  ) : pendingTransfers.length === 0 ? (
                    <Card className="border-2 border-dashed border-blue-100 bg-blue-50/20 shadow-none">
                      <CardContent className="py-16 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-3">
                          <ArrowRightLeft className="h-7 w-7 text-blue-400" />
                        </div>
                        <p className="font-medium text-slate-800">No pending transfer requests.</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-3">
                      {pendingTransfers.map((t) => (
                        <div key={t.id} className="border border-blue-100 rounded-xl p-4 flex items-start justify-between gap-4 hover:bg-blue-50/30 transition-colors">
                          <div className="space-y-1">
                            <div className="font-medium text-slate-800">{t.students?.full_name ?? (t as any).new_student_name ?? "Unknown student"}</div>
                            <div className="text-sm text-muted-foreground">
                              {transferTypeLabel[t.transfer_type]} · {new Date(t.transfer_date).toLocaleDateString()}
                            </div>
                            {t.reason && <div className="text-sm text-muted-foreground">{t.reason}</div>}
                            {t.transfer_type === "internal" && (
                              <div className="text-sm text-muted-foreground">
                                New class: {t.new_class ?? "—"} {t.new_section ?? ""}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-200 text-red-600 hover:bg-red-50"
                              disabled={processingId === t.id}
                              onClick={() => handleDecision(t.id, "rejected")}
                            >
                              <X className="h-4 w-4 mr-1" /> Reject
                            </Button>
                            <Button
                              size="sm"
                              className="bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-700 hover:to-sky-600"
                              disabled={processingId === t.id}
                              onClick={() => handleDecision(t.id, "approved")}
                            >
                              {processingId === t.id ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4 mr-1" />
                              )}
                              Approve
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="approved" className="mt-4">
              <Card className="overflow-hidden border-blue-100 shadow-sm">
                <div className="h-1 bg-gradient-to-r from-blue-500 to-sky-500" />
                <CardHeader>
                  <CardTitle>Approved transfers</CardTitle>
                  <CardDescription>Completed transfers involving your school.</CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingApproved ? (
                    <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin text-blue-500" /> Loading transfers...
                    </div>
                  ) : approvedTransfers.length === 0 ? (
                    <Card className="border-2 border-dashed border-blue-100 bg-blue-50/20 shadow-none">
                      <CardContent className="py-16 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-3">
                          <Check className="h-7 w-7 text-blue-400" />
                        </div>
                        <p className="font-medium text-slate-800">No approved transfers yet.</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-3">
                      {approvedTransfers.map((t) => (
                        <div key={t.id} className="border border-blue-100 rounded-xl p-4 hover:bg-blue-50/30 transition-colors">
                          <div className="font-medium text-slate-800">{t.students?.full_name ?? (t as any).new_student_name ?? "Unknown student"}</div>
                          <div className="text-sm text-muted-foreground">
                            {transferTypeLabel[t.transfer_type]} · {new Date(t.transfer_date).toLocaleDateString()}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Approved by {(t as any).approver?.full_name ?? "unknown"}
                            {t.approved_at ? ` on ${new Date((t as any).approved_at).toLocaleDateString()}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}