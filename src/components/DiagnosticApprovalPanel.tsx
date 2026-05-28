import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, Clock, Eye, ClipboardList, AlertTriangle } from "lucide-react";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { AGE_GROUPS, type AgeGroupConfig, type Dimension } from "@/data/assessmentQuestions";

const EXCELLENCIA_EMAILS = [
  "excellencia1@gmail.com",
  "excellencia2@gmail.com",
  "excellencia3@gmail.com",
  "excellencia4@gmail.com",
  "excellencia5@gmail.com",
  "excellencia6@gmail.com",
];

/** Build a 25-question distribution across all dimensions for a given class */
function build25QuestionDistribution(className: string): Record<string, number> {
  const ageGroup = getAgeGroupForClass(className);
  const config = AGE_GROUPS.find(g => g.ageGroup === ageGroup);
  if (!config) return {};

  const dims = config.dimensions;
  const total = 25;
  const base = Math.floor(total / dims.length);
  let remainder = total - base * dims.length;

  const distribution: Record<string, number> = {};
  for (const dim of dims) {
    const count = base + (remainder > 0 ? 1 : 0);
    distribution[dim.name] = Math.min(count, dim.questions.length);
    if (remainder > 0) remainder--;
  }

  return distribution;
}

/** Map class name to the appropriate age group in the question bank */
function getAgeGroupForClass(className: string): number {
  const lower = className.toLowerCase().trim();
  if (["nursery", "lkg", "ukg"].includes(lower)) return 3;
  const num = parseInt(lower.replace(/\D/g, ""));
  if (!isNaN(num)) {
    if (num <= 4) return 5;
    if (num <= 10) return 10;
    return 15;
  }
  return 5; // default
}

/** Pick N random questions from an array */
function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

/** Build the question set from the question bank based on distribution */
function buildQuestionSet(
  className: string,
  distribution: Record<string, number>
): { id: number; text: string; category: string; modality?: string }[] {
  const ageGroup = getAgeGroupForClass(className);
  const config = AGE_GROUPS.find(g => g.ageGroup === ageGroup);
  if (!config) return [];

  const result: { id: number; text: string; category: string; modality?: string }[] = [];

  for (const [category, count] of Object.entries(distribution)) {
    if (count <= 0) continue;
    // Find matching dimension by name (case-insensitive partial match)
    const dimension = config.dimensions.find(
      d => d.name.toLowerCase() === category.toLowerCase()
    );
    if (dimension) {
      const picked = pickRandom(dimension.questions, count);
      result.push(...picked.map(q => ({ id: q.id, text: q.text, category: dimension.name, modality: q.modality })));
    }
  }

  return result;
}

interface DiagnosticRequest {
  id: string;
  teacher_id: string;
  class_name: string;
  section: string;
  subject: string;
  purpose: string;
  suggested_count: number;
  approved_count: number | null;
  question_distribution: Record<string, number> | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  assigned_at: string | null;
  completed_at: string | null;
  profiles?: { full_name: string | null } | null;
}

export const DiagnosticApprovalPanel = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [reviewRequest, setReviewRequest] = useState<DiagnosticRequest | null>(null);
  const [approvedCount, setApprovedCount] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [processing, setProcessing] = useState(false);

  const { data: requests, isLoading } = useQuery({
    queryKey: ["admin-diagnostic-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("diagnostic_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Fetch teacher names separately
      const teacherIds = [...new Set((data || []).map(r => r.teacher_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", teacherIds);
      const nameMap = new Map((profiles || []).map(p => [p.id, p.full_name]));
      return (data || []).map(r => ({
        ...r,
        profiles: { full_name: nameMap.get(r.teacher_id) || null },
      })) as DiagnosticRequest[];
    },
  });

  const openReview = (req: DiagnosticRequest) => {
    setReviewRequest(req);
    setApprovedCount(String(req.approved_count ?? req.suggested_count));
    setAdminNotes(req.admin_notes || "");
  };

  const handleDecision = async (action: "approved" | "rejected") => {
    if (!reviewRequest || !user) return;
    const count = parseInt(approvedCount);
    if (action === "approved" && (isNaN(count) || count < 1 || count > 200)) {
      toast.error("Approved count must be between 1 and 200");
      return;
    }

    setProcessing(true);

    let assignedQuestions: any[] | null = null;

    if (action === "approved") {
      // Check if this is an excellencia teacher request — use or build 25-question distribution
      let distribution = reviewRequest.question_distribution;
      
      if (distribution) {
        // If distribution exists (e.g., excellencia teacher auto-set), use it directly
        assignedQuestions = buildQuestionSet(reviewRequest.class_name, distribution);
      } else {
        // No distribution — check if this teacher is excellencia by checking suggested_count pattern
        // For excellencia teachers, auto-generate 25 question distribution
        const dist25 = build25QuestionDistribution(reviewRequest.class_name);
        if (reviewRequest.suggested_count === 25 && Object.keys(dist25).length > 0) {
          // Could be excellencia teacher — check distribution total
          assignedQuestions = buildQuestionSet(reviewRequest.class_name, dist25);
        }
      }

      if (assignedQuestions && assignedQuestions.length === 0) {
        toast.error("No matching questions found in the question bank for this class and categories.");
        setProcessing(false);
        return;
      }

      if (assignedQuestions) {
        toast.info(`Assigning ${assignedQuestions.length} questions to ${reviewRequest.class_name} - ${reviewRequest.section} students.`);
      }
    }

    const updatePayload: any = {
      status: action === "approved" ? "assigned" : "rejected",
      approved_count: action === "approved" ? count : null,
      admin_notes: adminNotes.trim() || null,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (assignedQuestions) {
      updatePayload.questions = assignedQuestions;
      updatePayload.assigned_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("diagnostic_requests")
      .update(updatePayload)
      .eq("id", reviewRequest.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(
        action === "approved"
          ? `Request approved! ${assignedQuestions?.length || 0} questions assigned to ${reviewRequest.class_name} - ${reviewRequest.section} students.`
          : "Request rejected."
      );
      setReviewRequest(null);
      queryClient.invalidateQueries({ queryKey: ["admin-diagnostic-requests"] });
    }
    setProcessing(false);
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

  const pendingCount = requests?.filter(r => r.status === "pending").length || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          Diagnostic Question Approvals
          {pendingCount > 0 && (
            <Badge variant="destructive" className="gap-1 ml-2">
              <AlertTriangle className="h-3 w-3" /> {pendingCount} pending
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Review and approve teacher diagnostic question requests. Set the final question count for each class.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : !requests || requests.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No diagnostic requests submitted yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Teacher</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Suggested</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map(r => (
                <TableRow key={r.id} className={r.status === "pending" ? "bg-muted/30" : ""}>
                  <TableCell className="font-medium">{(r.profiles as any)?.full_name || "Unknown"}</TableCell>
                  <TableCell>{r.class_name} - {r.section}</TableCell>
                  <TableCell>{r.subject}</TableCell>
                  <TableCell>{r.suggested_count}</TableCell>
                  <TableCell>{r.approved_count ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(r.status)} className="gap-1 capitalize">
                      {statusIcon(r.status)} {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => openReview(r)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Review Dialog */}
      <Dialog open={!!reviewRequest} onOpenChange={open => !open && setReviewRequest(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review Diagnostic Request</DialogTitle>
          </DialogHeader>
          {reviewRequest && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Teacher:</span>
                  <p className="font-medium text-foreground">{(reviewRequest.profiles as any)?.full_name || "Unknown"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Class:</span>
                  <p className="font-medium text-foreground">{reviewRequest.class_name} - {reviewRequest.section}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Subject:</span>
                  <p className="font-medium text-foreground">{reviewRequest.subject}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Suggested Count:</span>
                  <p className="font-medium text-foreground">{reviewRequest.suggested_count}</p>
                </div>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Purpose:</span>
                <p className="text-sm text-foreground bg-muted/50 rounded-md p-3 mt-1">{reviewRequest.purpose}</p>
              </div>

              {reviewRequest.question_distribution && (
                <div>
                  <span className="text-sm text-muted-foreground">Question Distribution:</span>
                  <div className="mt-1 grid grid-cols-1 gap-1 max-h-[200px] overflow-auto">
                    {Object.entries(reviewRequest.question_distribution).map(([cat, count]) => (
                      <div key={cat} className="flex justify-between text-sm bg-muted/50 rounded px-3 py-1.5">
                        <span className="text-foreground">{cat}</span>
                        <span className="font-medium text-foreground">{count} Qs</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {reviewRequest.status === "pending" ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Approved Question Count</Label>
                    <Input type="number" min={1} max={200} value={approvedCount} onChange={e => setApprovedCount(e.target.value)} />
                    <p className="text-xs text-muted-foreground">You may modify the count from the teacher's suggestion.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Master User Notes (optional)</Label>
                    <Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} placeholder="Add notes or instructions for the teacher..." rows={2} />
                  </div>
                  <div className="flex gap-3">
                    <Button onClick={() => handleDecision("approved")} disabled={processing} className="flex-1 gap-1">
                      <CheckCircle className="h-4 w-4" /> Approve
                    </Button>
                    <Button variant="destructive" onClick={() => handleDecision("rejected")} disabled={processing} className="flex-1 gap-1">
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Badge variant={statusVariant(reviewRequest.status)} className="gap-1 capitalize">
                    {statusIcon(reviewRequest.status)} {reviewRequest.status}
                  </Badge>
                  {reviewRequest.approved_count && (
                    <p className="text-sm"><span className="text-muted-foreground">Approved Count:</span> <span className="font-medium text-foreground">{reviewRequest.approved_count}</span></p>
                  )}
                  {reviewRequest.admin_notes && (
                    <p className="text-sm"><span className="text-muted-foreground">Notes:</span> <span className="text-foreground">{reviewRequest.admin_notes}</span></p>
                  )}
                  {reviewRequest.approved_at && (
                    <p className="text-xs text-muted-foreground">Decided: {new Date(reviewRequest.approved_at).toLocaleString()}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};
