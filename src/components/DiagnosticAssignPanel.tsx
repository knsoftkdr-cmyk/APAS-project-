import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Clock, Loader2, Send, Eye, BookOpen } from "lucide-react";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const EXCELLENCIA_EMAILS = [
  "excellencia1@gmail.com",
  "excellencia2@gmail.com",
  "excellencia3@gmail.com",
  "excellencia4@gmail.com",
  "excellencia5@gmail.com",
  "excellencia6@gmail.com",
];

interface DiagnosticRequest {
  id: string;
  class_name: string;
  section: string;
  subject: string;
  purpose: string;
  suggested_count: number;
  approved_count: number | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  assigned_at: string | null;
  questions: any[] | null;
}

export const DiagnosticAssignPanel = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [previewRequest, setPreviewRequest] = useState<DiagnosticRequest | null>(null);

  const { data: requests, isLoading } = useQuery({
    queryKey: ["teacher-approved-requests", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("diagnostic_requests")
        .select("*")
        .eq("teacher_id", user!.id)
        .in("status", ["approved", "assigned", "completed"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as DiagnosticRequest[];
    },
    enabled: !!user?.id,
  });

  const handleAssign = async (req: DiagnosticRequest) => {
    if (!req.approved_count) {
      toast.error("No approved count set");
      return;
    }

    setGeneratingId(req.id);
    try {
      // Check if current teacher is excellencia — limit to 25 questions
      const isExcellencia = EXCELLENCIA_EMAILS.includes(user?.email?.toLowerCase() || "");
      const numQuestions = isExcellencia ? 25 : req.approved_count;

      // Generate diagnostic MCQs via edge function
      const { data: mcqData, error: mcqError } = await supabase.functions.invoke("generate-mcqs", {
        body: {
          studentClass: req.class_name,
          section: req.section,
          subject: req.subject,
          numQuestions,
          questionType: "diagnostic",
          difficulty: "mixed",
        },
      });

      if (mcqError) throw new Error(mcqError.message || "Failed to generate questions");
      if (!mcqData?.questions?.length) throw new Error("No questions were generated");

      // Save questions to the diagnostic request and update status
      const { error: updateError } = await supabase
        .from("diagnostic_requests")
        .update({
          questions: mcqData.questions,
          status: "assigned",
          assigned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", req.id);

      if (updateError) throw updateError;

      toast.success(`${mcqData.questions.length} diagnostic questions generated and assigned! Students can now take the test.`);
      queryClient.invalidateQueries({ queryKey: ["teacher-approved-requests"] });
      queryClient.invalidateQueries({ queryKey: ["diagnostic-requests"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to assign questions");
    } finally {
      setGeneratingId(null);
    }
  };

  const approvedRequests = requests?.filter(r => r.status === "approved") || [];
  const assignedRequests = requests?.filter(r => r.status === "assigned" || r.status === "completed") || [];

  return (
    <div className="space-y-6">
      {/* Approved - Ready to Assign */}
      {approvedRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Ready to Assign
              <Badge variant="default" className="ml-2">{approvedRequests.length}</Badge>
            </CardTitle>
            <CardDescription>
              These requests have been approved by the Master User. Generate and assign diagnostic questions for your students.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Approved Count</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvedRequests.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.class_name} - {r.section}</TableCell>
                    <TableCell>{r.subject}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.approved_count} questions</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        onClick={() => handleAssign(r)}
                        disabled={generatingId === r.id}
                        className="gap-1.5"
                      >
                        {generatingId === r.id ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <BookOpen className="h-3.5 w-3.5" />
                            Generate & Assign
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Assigned / Completed */}
      {assignedRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              Assigned Diagnostics
            </CardTitle>
            <CardDescription>
              Questions have been assigned to students. Track completion status here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Questions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignedRequests.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.class_name} - {r.section}</TableCell>
                    <TableCell>{r.subject}</TableCell>
                    <TableCell>{(r.questions as any[])?.length || r.approved_count || "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={r.status === "completed" ? "default" : "outline"}
                        className="gap-1 capitalize"
                      >
                        {r.status === "completed" ? <CheckCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.assigned_at ? new Date(r.assigned_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => setPreviewRequest(r)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="flex justify-center py-8"><LoadingSpinner /></div>
      )}

      {!isLoading && approvedRequests.length === 0 && assignedRequests.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No approved diagnostic requests yet. Submit a request above and wait for Master User approval.
          </CardContent>
        </Card>
      )}

      {/* Preview Dialog */}
      <Dialog open={!!previewRequest} onOpenChange={open => !open && setPreviewRequest(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Diagnostic Questions — {previewRequest?.class_name} {previewRequest?.section} · {previewRequest?.subject}
            </DialogTitle>
          </DialogHeader>
          {previewRequest?.questions && (
            <div className="space-y-4">
              {(previewRequest.questions as any[]).map((q: any, idx: number) => (
                <div key={q.id || idx} className="border border-border rounded-lg p-4">
                  <p className="font-medium text-sm text-foreground mb-2">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold mr-2">
                      {idx + 1}
                    </span>
                    {q.question}
                  </p>
                  <div className="grid grid-cols-2 gap-2 ml-8">
                    {Object.entries(q.options || {}).map(([key, val]) => (
                      <div
                        key={key}
                        className={`text-xs px-3 py-1.5 rounded border ${
                          key === q.correct
                            ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        <span className="font-semibold mr-1">{key}.</span> {val as string}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
