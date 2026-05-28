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

const CLASS_OPTIONS = [
  { value: "nursery", label: "Nursery" },
  { value: "lkg", label: "LKG" },
  { value: "ukg", label: "UKG" },
  ...Array.from({ length: 10 }, (_, i) => ({ value: `Class ${i + 1}`, label: `Class ${i + 1}` })),
];

const MI_CATEGORIES = [
  "Linguistic Intelligence",
  "Logical-Mathematical Intelligence",
  "Spatial Intelligence",
  "Musical Intelligence",
  "Bodily-Kinaesthetic Intelligence",
  "Interpersonal Intelligence",
  "Intrapersonal Intelligence",
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
    } else {
      toast.success("Request submitted! Any previous request for this class has been replaced.");
      setClassName("");
      setSection("A");
      setPurpose("");
      setDistribution(Object.fromEntries(MI_CATEGORIES.map((c) => [c, 5])));
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["teacher-diagnostic-requests"] });
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

  return (
    <div className="space-y-6">
      {!showForm ? (
        <Button onClick={() => setShowForm(true)} className="gap-1.5">
          <Send className="h-4 w-4" /> New Request
        </Button>
      ) : (
      /* Request Form */
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Request Diagnostic Questionnaire
          </CardTitle>
          <CardDescription>
            Submit a request for diagnostic questions to the School Admin. Specify the number of questions per intelligence category.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Class</Label>
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
              <Label>Section</Label>
              <Input value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. A, B, C" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Input value="Diagnostic Test" disabled className="bg-muted" />
            </div>
          </div>

          {/* Question Distribution */}
          <div className="space-y-2">
            <Label>Question Distribution by Category</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MI_CATEGORIES.map((category) => (
                <div key={category} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <span className="text-sm text-foreground">{category}</span>
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    value={distribution[category]}
                    onChange={(e) => updateCategory(category, e.target.value)}
                    className="w-20 text-center"
                  />
                </div>
              ))}
            </div>
            <p className="text-sm font-medium text-foreground">
              Total Questions: <span className="text-primary">{totalQuestions}</span>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Purpose / Rationale</Label>
            <Textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Describe why this diagnostic is needed, target learning outcomes, etc."
              rows={3}
            />
          </div>

          <Button onClick={handleSubmit} disabled={submitting} className="w-full md:w-auto">
            {submitting ? <LoadingSpinner size="sm" /> : <Send className="h-4 w-4 mr-1" />}
            Submit Request
          </Button>
        </CardContent>
      </Card>
      )}

      {/* My Requests */}
      <Card>
        <CardHeader>
          <CardTitle>My Diagnostic Requests</CardTitle>
          <CardDescription>Track the status of your submitted requests</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : !requests || requests.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No requests submitted yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Total Questions</TableHead>
                  <TableHead>Approved</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Admin Notes</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.class_name} - {r.section}</TableCell>
                    <TableCell>{r.suggested_count}</TableCell>
                    <TableCell>{r.approved_count ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)} className="gap-1 capitalize">
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
          )}
        </CardContent>
      </Card>

      {/* View Details Dialog */}
      <Dialog open={!!viewRequest} onOpenChange={(open) => !open && setViewRequest(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Details</DialogTitle>
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
                    <Badge variant={statusVariant(viewRequest.status)} className="gap-1 capitalize">
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
                  <div className="mt-1 grid grid-cols-1 gap-1">
                    {Object.entries(viewRequest.question_distribution as QuestionDistribution).map(([cat, count]) => (
                      <div key={cat} className="flex justify-between text-sm bg-muted/50 rounded px-3 py-1.5">
                        <span className="text-foreground">{cat}</span>
                        <span className="font-medium text-foreground">{count} Qs</span>
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
  );
};
