import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Clock, CheckCircle, XCircle, ClipboardList, Eye } from "lucide-react";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Languages,
  Brain,
  Music,
  Dumbbell, 
  Users,
  UserCircle,
  Leaf,
  GraduationCap,
  ShieldCheck,
} from "lucide-react";
const CLASS_OPTIONS = [
  { value: "nursery", label: "Nursery" },
  { value: "lkg", label: "LKG" },
  { value: "ukg", label: "UKG" },
  ...Array.from({ length: 10 }, (_, i) => ({ value: `Class ${i + 1}`, label: `Class ${i + 1}` })),
];

const MI_CATEGORIES = [
  "Language Skills",
  "Logical Thinking",
  "Visual Learning",
  "Musical Intelligence",
  "Physical Learning",
  "Social Skills",
  "Self Awareness",
  "Naturalist Intelligence",
  "VARK Learning Style",
  "Self-Regulation & School Readiness",
];

interface QuestionDistribution {
  [category: string]: number;
}

interface DiagnosticRequest {
  id: string;
  class_name: string;
  section: string;
  subject: string;
  purpose: string;
  suggested_count: number;
  approved_count: number | null;
  question_distribution: QuestionDistribution | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  approved_at: string | null;
  assigned_at: string | null;
}

export const TeacherRequestForm = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [className, setClassName] = useState("");
  const [section, setSection] = useState("A");
  const [purpose, setPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [viewRequest, setViewRequest] = useState<DiagnosticRequest | null>(null);
  const [showForm, setShowForm] = useState(true);

  // Per-category question counts
  const [distribution, setDistribution] = useState<QuestionDistribution>(
    Object.fromEntries(MI_CATEGORIES.map((c) => [c, 5]))
  );

  const totalQuestions = Object.values(distribution).reduce((a, b) => a + b, 0);

  const updateCategory = (category: string, value: string) => {
    const num = parseInt(value) || 0;
    setDistribution((prev) => ({ ...prev, [category]: Math.max(0, Math.min(20, num)) }));
  };

  const { data: requests, isLoading } = useQuery({
    queryKey: ["teacher-diagnostic-requests", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("diagnostic_requests")
        .select("*")
        .eq("teacher_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DiagnosticRequest[];
    },
    enabled: !!user?.id,
  });

  const handleSubmit = async () => {
    if (!className || !purpose.trim()) {
      toast.error("Please select a class and provide a purpose");
      return;
    }
    if (totalQuestions < 5 || totalQuestions > 200) {
      toast.error("Total questions must be between 5 and 200");
      return;
    }

    setSubmitting(true);
    const sectionVal = section.trim() || "A";

    // Delete any existing request for the same class+section by this teacher (override with latest)
    await supabase
      .from("diagnostic_requests")
      .delete()
      .eq("teacher_id", user!.id)
      .eq("class_name", className)
      .eq("section", sectionVal);

    const { error } = await supabase.from("diagnostic_requests").insert({
      teacher_id: user!.id,
      class_name: className,
      section: sectionVal,
      subject: "Diagnostic Test",
      purpose: purpose.trim(),
      suggested_count: totalQuestions,
      question_distribution: distribution,
    } as any);

if (error) {
      toast.error(error.message);
      setSubmitting(false);
      return;
    }

    toast.success("Request submitted! Any previous request for this class has been replaced.");
    setClassName("");
    setSection("A");
    setPurpose("");
    setDistribution(Object.fromEntries(MI_CATEGORIES.map((c) => [c, 5])));
    setShowForm(false);
    queryClient.invalidateQueries({ queryKey: ["teacher-diagnostic-requests"] });

    // Notify principals of the same school
    try {
      const { data: teacherProfile } = await supabase
        .from("profiles")
        .select("full_name, school_id")
        .eq("id", user!.id)
        .single();

      if ((teacherProfile as any)?.school_id) {
        const teacherName = (teacherProfile as any).full_name || "A teacher";
        const notifTitle = "New Diagnostic Request";
        const notifBody = `${teacherName} has requested a diagnostic test for ${className} - Section ${section}. ${totalQuestions} questions suggested.`;

        const response = await fetch(
          "https://qkclzrscyhzrbixajaiw.supabase.co/functions/v1/send-push-notification",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "notify_role",
              payload: {
                school_id: (teacherProfile as any).school_id,
                role: "principal",
                title: notifTitle,
                body: notifBody,
                data: {
                  type: "diagnostic_request",
                  class_name: className,
                  section,
                },
              },
            }),
          }
        );
        const result = await response.json();
      } 
    } catch (notifError) {
      console.error("❌ Principal notification failed:", notifError);
    }

    setSubmitting(false);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "pending": return <Clock className="h-3.5 w-3.5" />;
      case "approved": return <CheckCircle className="h-3.5 w-3.5" />;
      case "rejected": return <XCircle className="h-3.5 w-3.5" />;
      case "assigned": return <ClipboardList className="h-3.5 w-3.5" />;
      case "completed": return <CheckCircle className="h-3.5 w-3.5" />;
      default: return null;
    }
  };

const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "pending": return "secondary";
      case "approved": return "default";
      case "rejected": return "destructive";
      case "assigned": return "outline";
      case "completed": return "default";
      default: return "secondary";
    }
  };

  const statusColorClass = (status: string) => {
    switch (status) {
      case "pending": return "bg-amber-100 text-amber-800 hover:bg-amber-100";
      case "approved": return "bg-emerald-500 text-white hover:bg-emerald-500";
      case "rejected": return "bg-red-100 text-red-700 hover:bg-red-100";
      case "assigned": return "bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100";
      case "completed": return "bg-indigo-500 text-white hover:bg-indigo-500";
      default: return "";
    }
  };
const categoryIcons: Record<string, any> = {
  "Language Skills": Languages,
  "Logical Thinking": Brain,
  "Visual Learning": Eye,
  "Musical Intelligence": Music,
  "Physical Learning": Dumbbell,
  "Social Skills": Users,
  "Self Awareness": UserCircle,
  "Naturalist Intelligence": Leaf,
  "VARK Learning Style": GraduationCap,
  "Self-Regulation & School Readiness": ShieldCheck,
};


return (
    <div className="relative">
      <div className="absolute -top-4 right-0 w-40 h-40 rounded-full bg-blue-200 opacity-[0.15] blur-3xl pointer-events-none" />
      <div className="absolute top-40 left-0 w-48 h-48 rounded-full bg-indigo-200 opacity-[0.12] blur-3xl pointer-events-none" />
      <div className="relative z-10 space-y-6">
      {!showForm ? (
        <Card className="border-2 border-dashed border-blue-200 bg-blue-50/40">
          <CardContent className="py-10 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
              <Send className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="font-medium text-foreground">Ready for a new diagnostic request?</p>
              <p className="text-sm text-muted-foreground mt-0.5">Submitting a new request will replace any existing request for the same class & section.</p>
            </div>
            <Button onClick={() => setShowForm(true)} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white mt-1">
              <Send className="h-4 w-4" /> New Request
            </Button>
          </CardContent>
        </Card>
      ) : (
      /* Request Form */
      <Card className="border-blue-100 shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
          <CardTitle className="flex items-center gap-3">
            <div className="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
            <Send className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <span className="text-base md:text-lg">Request Diagnostic Questionnaire</span>
          </CardTitle>
          <CardDescription>
            Submit a request for diagnostic questions to the School Admin. Specify the number of questions per intelligence category.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-foreground">Class</Label>
              <Select value={className} onValueChange={setClassName}>
                <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {CLASS_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-foreground">Section</Label>
              <Input value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. A, B, C" className="focus-visible:ring-blue-400" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-foreground">Type</Label>
              <Input value="Diagnostic Test" disabled className="bg-muted" />
            </div>
          </div>

          {/* Question Distribution */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Label className="text-sm font-semibold text-foreground">Question Distribution by Category</Label>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${totalQuestions < 5 || totalQuestions > 200 ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                {totalQuestions} / 200 questions
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MI_CATEGORIES.map((category, idx) => {
                const palette = [
                  "bg-blue-100 text-blue-600",
                  "bg-indigo-100 text-indigo-600",
                  "bg-cyan-100 text-cyan-600",
                  "bg-sky-100 text-sky-600",
                ];
                const colorClass = palette[idx % palette.length];
                return (
                  <div key={category} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white p-3 hover:border-blue-200 hover:shadow-sm transition-all">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {(() => {
                        const Icon = categoryIcons[category];
                        return Icon ? (
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
                            <Icon className="w-5 h-5" />
                          </div>
                        ) : null;
                      })()}
                      <span className="text-sm font-medium text-foreground truncate">
                        {category}
                      </span>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      value={distribution[category]}
                      onChange={(e) => updateCategory(category, e.target.value)}
                      className="w-16 md:w-20 text-center shrink-0 focus-visible:ring-blue-400"
                    />
                  </div>
                );
              })}
            </div>
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-2.5 flex items-center justify-between">
              <span className="text-sm text-blue-900">Total Questions</span>
              <span className="text-base font-bold text-blue-700">{totalQuestions}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-foreground">Purpose / Rationale</Label>
            <Textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Describe why this diagnostic is needed, target learning outcomes, etc."
              rows={3}
              className="focus-visible:ring-blue-400"
            />
          </div>

          <Button onClick={handleSubmit} disabled={submitting} className="w-full md:w-auto bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm">
            {submitting ? <LoadingSpinner size="sm" /> : <Send className="h-4 w-4 mr-1" />}
            Submit Request
          </Button>
        </CardContent>
      </Card>
      )}

      {/* My Requests */}
      <Card className="border-blue-100 shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
          <CardTitle className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-sm border border-blue-100">
              <ClipboardList className="h-5 w-5 text-blue-600" />
            </div>
            <span className="text-base md:text-lg">My Diagnostic Requests</span>
          </CardTitle>
          <CardDescription>Track the status of your submitted requests</CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <LoadingSpinner /> Loading your requests...
            </div>
          ) : !requests || requests.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-2 py-10">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
                <ClipboardList className="h-6 w-6 text-blue-300" />
              </div>
              <p className="text-sm text-muted-foreground">No requests submitted yet.</p>
            </div>
          ) : (
            <>
            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-blue-900/70">Class</TableHead>
                  <TableHead className="text-blue-900/70">Total Questions</TableHead>
                  <TableHead className="text-blue-900/70">Approved</TableHead>
                  <TableHead className="text-blue-900/70">Status</TableHead>
                  <TableHead className="text-blue-900/70">Admin Notes</TableHead>
                  <TableHead className="text-blue-900/70">Submitted</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id} className="hover:bg-blue-50/50">
                    <TableCell className="font-medium">{r.class_name} - {r.section}</TableCell>
                    <TableCell>{r.suggested_count}</TableCell>
                    <TableCell>{r.approved_count ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)} className={`gap-1 capitalize ${statusColorClass(r.status)}`}>
                        {statusIcon(r.status)} {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {r.admin_notes || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => setViewRequest(r)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden space-y-3">
              {requests.map((r) => (
                <div key={r.id} className="rounded-xl border border-border p-3.5 space-y-2.5 bg-white">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground text-sm">{r.class_name} - {r.section}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Submitted {new Date(r.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant={statusVariant(r.status)} className={`gap-1 capitalize shrink-0 ${statusColorClass(r.status)}`}>
                      {statusIcon(r.status)} {r.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Requested: <span className="font-medium text-foreground">{r.suggested_count}</span></span>
                    <span>Approved: <span className="font-medium text-foreground">{r.approved_count ?? "—"}</span></span>
                  </div>
                  {r.admin_notes && (
                    <p className="text-xs text-muted-foreground truncate">Note: {r.admin_notes}</p>
                  )}
                  <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setViewRequest(r)}>
                    <Eye className="h-3.5 w-3.5" /> View Details
                  </Button>
                </div>
              ))}
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* View Details Dialog */}
      <Dialog open={!!viewRequest} onOpenChange={(open) => !open && setViewRequest(null)}>
        <DialogContent className="max-w-lg w-[calc(100%-2rem)] sm:w-full max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <ClipboardList className="h-4 w-4 text-blue-600" />
              </div>
              Request Details
            </DialogTitle>
          </DialogHeader>
          {viewRequest && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Class:</span>
                  <p className="font-medium text-foreground">{viewRequest.class_name} - {viewRequest.section}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <div className="mt-0.5">
                    <Badge variant={statusVariant(viewRequest.status)} className={`gap-1 capitalize ${statusColorClass(viewRequest.status)}`}>
                      {statusIcon(viewRequest.status)} {viewRequest.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Requested:</span>
                  <p className="font-medium text-foreground">{viewRequest.suggested_count}</p>
                </div>
                {viewRequest.approved_count && (
                  <div>
                    <span className="text-muted-foreground">Approved Count:</span>
                    <p className="font-medium text-foreground">{viewRequest.approved_count}</p>
                  </div>
                )}
              </div>

              {viewRequest.question_distribution && (
                <div>
                  <span className="text-sm text-muted-foreground">Question Distribution:</span>
                  <div className="mt-1.5 grid grid-cols-1 gap-1.5">
                    {Object.entries(viewRequest.question_distribution as QuestionDistribution).map(([cat, count]) => (
                      <div key={cat} className="flex justify-between text-sm bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5">
                        <span className="text-foreground">{cat}</span>
                        <span className="font-semibold text-blue-700">{count} Qs</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <span className="text-sm text-muted-foreground">Purpose:</span>
                <p className="text-sm text-foreground bg-muted/50 rounded-md p-3 mt-1">{viewRequest.purpose}</p>
              </div>

              {viewRequest.admin_notes && (
                <div>
                  <span className="text-sm text-muted-foreground">Admin Notes:</span>
                  <p className="text-sm text-foreground bg-muted/50 rounded-md p-3 mt-1">{viewRequest.admin_notes}</p>
                </div>
              )}

              {viewRequest.approved_at && (
                <p className="text-xs text-muted-foreground">
                  Decided: {new Date(viewRequest.approved_at).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
};
