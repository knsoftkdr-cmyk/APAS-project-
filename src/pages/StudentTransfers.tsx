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
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <ArrowRightLeft className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Student Transfers</h1>
            <p className="text-sm text-muted-foreground">Request and approve student transfers between schools</p>
          </div>
        </div>

        <Tabs defaultValue="new" className="w-full">
          <TabsList>
            <TabsTrigger value="new">New Transfer</TabsTrigger>
            <TabsTrigger value="pending">
              Pending Approvals
              {pendingTransfers.length > 0 && (
                <Badge variant="secondary" className="ml-2">{pendingTransfers.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="approved">Approved Transfers</TabsTrigger>
          </TabsList>

          {/* NEW TRANSFER TAB */}
          <TabsContent value="new">
            <Card>
              <CardHeader>
                <CardTitle>Request a transfer</CardTitle>
                <CardDescription>Submitted requests need principal approval before taking effect.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label>Class</Label>
                    <Select value={classFilter} onValueChange={(v) => { setClassFilter(v); setForm({ ...form, student_id: "" }); }}>
                      <SelectTrigger>
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
                      <SelectTrigger>
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
                      <SelectTrigger>
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
                          <SelectTrigger>
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
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>New section</Label>
                          <Input
                            placeholder="e.g. B"
                            value={form.new_section}
                            onChange={(e) => setForm({ ...form, new_section: e.target.value })}
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
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Class</Label>
                          <Input
                            placeholder="e.g. 8"
                            value={form.new_class}
                            onChange={(e) => setForm({ ...form, new_class: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Section</Label>
                          <Input
                            placeholder="e.g. B"
                            value={form.new_section}
                            onChange={(e) => setForm({ ...form, new_section: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Previous school name</Label>
                        <Input
                          placeholder="Name of the school they're joining from"
                          value={form.previous_school_name}
                          onChange={(e) => setForm({ ...form, previous_school_name: e.target.value })}
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
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Transfer date</Label>
                    <Input
                      type="date"
                      value={form.transfer_date}
                      onChange={(e) => setForm({ ...form, transfer_date: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Reason</Label>
                    <Textarea
                      placeholder="Brief reason for the transfer"
                      value={form.reason}
                      onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    />
                  </div>

                  <Button type="submit" disabled={submitting}>
                    {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Submit request
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* PENDING APPROVALS TAB */}
          <TabsContent value="pending">
            <Card>
              <CardHeader>
                <CardTitle>Pending transfer requests</CardTitle>
                <CardDescription>Requests involving your school, awaiting a decision.</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingPending ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : pendingTransfers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No pending transfer requests.</p>
                ) : (
                  <div className="space-y-3">
                    {pendingTransfers.map((t) => (
                      <div key={t.id} className="border rounded-lg p-4 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="font-medium">{t.students?.full_name ?? (t as any).new_student_name ?? "Unknown student"}</div>
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
                            disabled={processingId === t.id}
                            onClick={() => handleDecision(t.id, "rejected")}
                          >
                            <X className="h-4 w-4 mr-1" /> Reject
                          </Button>
                          <Button
                            size="sm"
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
          <TabsContent value="approved">
            <Card>
              <CardHeader>
                <CardTitle>Approved transfers</CardTitle>
                <CardDescription>Completed transfers involving your school.</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingApproved ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : approvedTransfers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No approved transfers yet.</p>
                ) : (
                  <div className="space-y-3">
                    {approvedTransfers.map((t) => (
                      <div key={t.id} className="border rounded-lg p-4">
                        <div className="font-medium">{t.students?.full_name ?? (t as any).new_student_name ?? "Unknown student"}</div>
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
    </AppLayout>
  );
}
