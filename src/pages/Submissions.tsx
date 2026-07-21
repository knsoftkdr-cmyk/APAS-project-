import { useState, useMemo, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ClipboardCheck, Users, Check, Eye, FileText, BookOpen, Lock, Sparkles, FileCheck, Bot, Paperclip, CheckCircle2, XCircle, AlertCircle, Download } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import html2pdf from "html2pdf.js";
import { AssessmentReport } from "@/components/report/AssessmentReport";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";

const STATIC_CLASSES = Array.from({ length: 10 }, (_, i) => `Class ${i + 1}`);

interface WorksheetSubmissionRow {
  id: string;
  worksheet_id: string;
  assignment_id: string | null;
  student_id: string;
  student_name: string | null;
  class_level: string;
  section: string;
  school_id: string | null;
  answers: Record<string, string>;
  status: string;
  score: number | null;
  teacher_feedback: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  answer_file_url: string | null;
  answer_file_name: string | null;
  ai_score: number | null;
  ai_feedback: string | null;
  ai_per_activity: any[] | null;
  ai_topic_analysis: any[] | null;
  ai_study_plan: any[] | null;
  ai_reviewed_at: string | null;
  worksheets?: {
    id: string;
    subject: string;
    chapter: string | null;
    topic: string | null;
    subtopic: string | null;
    worksheet_content: string;
    vark_type: string | null;
  } | null;
}

function parseWorksheetActivities(content: string): string[] {
  if (!content) return [];
  const keyIndex = content.search(/COMPLETE ANSWER KEY/i);
  const studentFacing = keyIndex >= 0 ? content.slice(0, keyIndex) : content;
  return studentFacing
    .split(/^---$/m)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

function StatusBadge({ status }: { status: string }) {
  if (status === "reviewed")
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs gap-1"><Check className="h-3 w-3" /> Reviewed</Badge>;
  if (status === "ai_reviewed")
    return <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs gap-1"><Bot className="h-3 w-3" /> AI Reviewed</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">Pending Review</Badge>;
}

function normalizeClass(val: string): string {
  if (!val) return "";
  const trimmed = val.trim();
  // If already "Class 4" format
  if (/^Class \d+$/i.test(trimmed)) return `Class ${trimmed.replace(/^Class /i, "")}`;
  // If just a number "4"
  if (/^\d+$/.test(trimmed)) return `Class ${trimmed}`;
  return trimmed;
}

export default function Submissions() {
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();

  const [filterClass, setFilterClass] = useState<string>("all");
  const [filterSection, setFilterSection] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedSubmission, setSelectedSubmission] = useState<WorksheetSubmissionRow | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [scoreInput, setScoreInput] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [aiEvaluatingId, setAiEvaluatingId] = useState<string | null>(null);
  const [isBulkEvaluating, setIsBulkEvaluating] = useState(false);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setPreviewBlobUrl(null);
    setPreviewError(null);
    if (selectedSubmission?.answer_file_url) {
      setPreviewLoading(true);
      fetch(selectedSubmission.answer_file_url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setPreviewBlobUrl(objectUrl);
        })
        .catch((err) => {
          console.error("Failed to load preview file:", err);
          if (!cancelled) setPreviewError(err?.message || "Failed to load preview");
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedSubmission?.answer_file_url]);

  if (profile?.role !== "teacher") {
    return (
      <AppLayout>
        <PageHeader title="Worksheet Submissions" subtitle="Review student worksheet answers" />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Lock className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Restricted</h2>
            <p className="text-muted-foreground">Only teachers can view worksheet submissions.</p>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  const { data: submissions = [], isLoading } = useQuery<WorksheetSubmissionRow[]>({
    queryKey: ["worksheet-submissions-list", user?.id, profile?.school_id],
    enabled: !!user?.id && !!profile?.school_id,
    queryFn: async () => {
      const { data: myWorksheets, error: wsErr } = await supabase
        .from("worksheets")
        .select("id")
        .eq("teacher_id", user!.id);
      if (wsErr || !myWorksheets || myWorksheets.length === 0) return [];
      const worksheetIds = myWorksheets.map((w: any) => w.id);
      const { data, error } = await supabase
        .from("worksheet_submissions")
        .select("*, worksheets(id, subject, chapter, topic, subtopic, worksheet_content, vark_type)")
        .in("worksheet_id", worksheetIds)
        .order("submitted_at", { ascending: false });
      if (error) { console.error("Error fetching submissions:", error); return []; }
      return (data as WorksheetSubmissionRow[]) || [];
    },
  });

  const uniqueSections = useMemo(() => [...new Set(submissions.map((s) => s.section).filter(Boolean))], [submissions]);

  const filteredSubmissions = submissions.filter((s) => {
    if (filterClass !== "all" && normalizeClass(s.class_level) !== filterClass) return false;
    if (filterSection !== "all" && s.section !== filterSection) return false;
    if (filterStatus !== "all" && s.status !== filterStatus) return false;
    return true;
  });

  const pendingCount = submissions.filter((s) => s.status === "submitted").length;

  const openSubmission = (s: WorksheetSubmissionRow) => {
    setSelectedSubmission(s);
    setFeedbackText(s.teacher_feedback || s.ai_feedback || "");
    setScoreInput(s.score !== null && s.score !== undefined ? String(s.score) : s.ai_score !== null ? String(s.ai_score) : "");
  };

  const handleAiEvaluate = async (submissionId: string) => {
    setAiEvaluatingId(submissionId);
    try {
      const { data, error } = await supabase.functions.invoke("evaluate-worksheet-submission", {
        body: { submission_id: submissionId },
      });
      if (error) throw new Error(error.message);
      const result = data?.results?.[0];
      if (result?.error) throw new Error(result.error);
      toast.success(`AI evaluation complete! Score: ${result.ai_score}/100`);
      queryClient.invalidateQueries({ queryKey: ["worksheet-submissions-list", user?.id, profile?.school_id] });
      if (selectedSubmission?.id === submissionId) {
        const updated = submissions.find((s) => s.id === submissionId);
        if (updated) setSelectedSubmission({ ...updated, status: "ai_reviewed", ai_score: result.ai_score, ai_feedback: result.ai_feedback });
      }
    } catch (err: any) {
      toast.error(`AI evaluation failed: ${err.message || "Unknown error"}`);
    } finally {
      setAiEvaluatingId(null);
    }
  };

  const handleBulkAiEvaluate = async () => {
    const pendingIds = filteredSubmissions.filter((s) => s.status === "submitted").map((s) => s.id);
    if (pendingIds.length === 0) { toast.info("No pending submissions to evaluate."); return; }
    setIsBulkEvaluating(true);
    try {
      const { data, error } = await supabase.functions.invoke("evaluate-worksheet-submission", {
        body: { submission_ids: pendingIds },
      });
      if (error) throw new Error(error.message);
      const results = data?.results || [];
      const succeeded = results.filter((r: any) => r.success).length;
      const failed = results.filter((r: any) => r.error).length;
      toast.success(`AI evaluated ${succeeded} submission${succeeded !== 1 ? "s" : ""}${failed > 0 ? ` (${failed} failed)` : ""}!`);
      queryClient.invalidateQueries({ queryKey: ["worksheet-submissions-list", user?.id, profile?.school_id] });
    } catch (err: any) {
      toast.error(`Bulk evaluation failed: ${err.message || "Unknown error"}`);
    } finally {
      setIsBulkEvaluating(false);
    }
  };

  const handleMarkReviewed = async () => {
    if (!selectedSubmission || !user?.id) return;
    setIsSaving(true);
    try {
      const scoreVal = scoreInput.trim() === "" ? null : parseFloat(scoreInput);
      if (scoreVal !== null && (isNaN(scoreVal) || scoreVal < 0)) {
        toast.error("Please enter a valid score"); setIsSaving(false); return;
      }
      const { error } = await supabase
        .from("worksheet_submissions")
        .update({
          status: "reviewed",
          teacher_feedback: feedbackText.trim() || null,
          score: scoreVal,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq("id", selectedSubmission.id);
      if (error) throw new Error(error.message);
      toast.success("Marked as reviewed and feedback saved!");

// Notify student + parent that worksheet has been reviewed
try {
  const scoreVal = scoreInput.trim() === "" ? null : parseFloat(scoreInput);
  const worksheetTopic = selectedSubmission.worksheets?.topic || 
                         selectedSubmission.worksheets?.subject || 
                         "Worksheet";
  
  const studentBody = scoreVal !== null
    ? feedbackText.trim()
      ? `Your worksheet scored ${scoreVal}/100. Teacher says: ${feedbackText.trim().substring(0, 60)}${feedbackText.trim().length > 60 ? "..." : ""}`
      : `Your worksheet has been reviewed. You scored ${scoreVal}/100.`
    : feedbackText.trim()
      ? `Your worksheet has been reviewed. Teacher says: ${feedbackText.trim().substring(0, 80)}${feedbackText.trim().length > 80 ? "..." : ""}`
      : "Your worksheet has been reviewed by your teacher.";

  await fetch(
    "https://qkclzrscyhzrbixajaiw.supabase.co/functions/v1/send-push-notification",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "single_by_user_id",
        payload: {
          user_id: selectedSubmission.student_id,
          student_name: selectedSubmission.student_name || "Student",
          title: `${worksheetTopic} reviewed`,
          body: studentBody,
          score: scoreVal !== null ? String(scoreVal) : "",
          subject: selectedSubmission.worksheets?.subject || "",
          topic: worksheetTopic,
          feedback: feedbackText.trim() || "",
          data: {
            type: "worksheet_reviewed",
            submission_id: selectedSubmission.id,
            score: scoreVal !== null ? String(scoreVal) : "",
          },
        },
      }),
    }
  );
} catch (notifError) {
  console.error("Worksheet review notification failed:", notifError);
}

      queryClient.invalidateQueries({ queryKey: ["worksheet-submissions-list", user?.id, profile?.school_id] });
      setSelectedSubmission(null);
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message || "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadReport = async () => {
    if (!reportRef.current || !selectedSubmission) return;
    setIsGeneratingPdf(true);
    try {
      const filename = `${(selectedSubmission.student_name || "student").replace(/\s+/g, "_")}-assessment-report.pdf`;
      const opt = {
        margin: 0,
        filename,
        image: { type: "jpeg" as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "pt" as const, format: "a4" as const, orientation: "portrait" as const },
        pagebreak: { mode: ["css", "legacy"] },
      };

      if (!Capacitor.isNativePlatform()) {
        // Browser
        await html2pdf().set(opt).from(reportRef.current).save();
        toast.success("Report downloaded!");
      } else {
        // Native app (Android/iOS)
        const worker = html2pdf().set(opt).from(reportRef.current);
        const pdfData = await worker.outputPdf("datauristring");
        const base64 = pdfData.split(",")[1];

        await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Documents,
        });

        toast.success("Report saved successfully!");
      }
    } catch (err: any) {
      toast.error(`Failed to generate PDF: ${err.message || "Unknown error"}`);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const activities = selectedSubmission?.worksheets?.worksheet_content
    ? parseWorksheetActivities(selectedSubmission.worksheets.worksheet_content)
    : [];

  const canDownloadReport =
    !!selectedSubmission &&
    selectedSubmission.ai_score !== null &&
    selectedSubmission.ai_score !== undefined;

  return (
    <AppLayout>
      <div className="rounded-2xl p-6 mb-6 relative overflow-hidden bg-gradient-to-r from-violet-600 to-fuchsia-600 shadow-lg">
  <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
  <div className="absolute right-16 top-10 w-16 h-16 bg-white/10 rounded-full" />
  <div className="relative flex items-center gap-4">
    <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
      <FileCheck className="h-7 w-7 text-white" />
    </div>
    <div>
      <h1 className="text-2xl font-bold text-white">Worksheet Submissions</h1>
      <p className="text-white/80 text-sm mt-1">Review and AI-evaluate student worksheet answers</p>
    </div>
  </div>
</div>

      {/* Filters + Bulk AI button */}
<Card className="mb-6 border border-purple-200 shadow-sm overflow-hidden">
  <div className="h-1 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500" />
  <CardContent className="p-5 flex flex-wrap gap-3 items-end">
          <div className="w-[160px]">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Class</label>
            <Select value={filterClass} onValueChange={setFilterClass}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {STATIC_CLASSES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[160px]">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Section</label>
            <Select value={filterSection} onValueChange={setFilterSection}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sections</SelectItem>
                {uniqueSections.map((s) => <SelectItem key={s} value={s}>Section {s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[160px]">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Status</label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="submitted">Pending Review</SelectItem>
                <SelectItem value="ai_reviewed">AI Reviewed</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm font-medium border border-green-600 text-white bg-green-400 px-3 py-1.5 rounded-full">
              {filteredSubmissions.length} submission{filteredSubmissions.length !== 1 ? "s" : ""}
            </span>
            {pendingCount > 0 && (
              <Button
                onClick={handleBulkAiEvaluate}
                disabled={isBulkEvaluating}
                className="gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 shadow-sm"
                size="sm"
              >
                {isBulkEvaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                AI Review All Pending ({pendingCount})
              </Button>
            )}
          </div>
        
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading submissions...
        </div>
      ) : filteredSubmissions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-border rounded-xl">
          <ClipboardCheck className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">No submissions yet</p>
          <p className="text-xs text-muted-foreground mt-1">Once students submit worksheet answers, they'll appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSubmissions.map((s) => (
            <Card key={s.id} className="border border-border/60 hover:-translate-y-2 hover:shadow-2xl hover:border-purple-300">
              <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs gap-1">
                      <Users className="h-3 w-3" /> {s.student_name || "Unknown student"}
                    </Badge>
                    <Badge variant="outline" className="text-xs">{normalizeClass(s.class_level)} · Section {s.section}</Badge>
                    {s.worksheets?.subject && (
                      <Badge variant="outline" className="text-xs gap-1"><BookOpen className="h-3 w-3" /> {s.worksheets.subject}</Badge>
                    )}
                    {s.worksheets?.topic && <Badge variant="outline" className="text-xs">{s.worksheets.topic}</Badge>}
                    <StatusBadge status={s.status} />
                    {s.ai_score !== null && s.ai_score !== undefined && (
                      <Badge className="bg-violet-100 text-violet-700 border-violet-200 text-xs gap-1">
                        <Bot className="h-3 w-3" /> AI: {s.ai_score}/100
                      </Badge>
                    )}
                    {s.score !== null && s.score !== undefined && (
                      <Badge variant="outline" className="text-xs">Score: {s.score}</Badge>
                    )}
                    {s.answer_file_url && (
                      <Badge variant="outline" className="text-xs gap-1"><Paperclip className="h-3 w-3" /> File uploaded</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Submitted {new Date(s.submitted_at).toLocaleDateString()}{" "}
                    {new Date(s.submitted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="flex gap-2">
                  {s.status === "submitted" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50"
                      disabled={aiEvaluatingId === s.id}
                      onClick={() => handleAiEvaluate(s.id)}
                    >
                      {aiEvaluatingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                      AI Review
                    </Button>
                  )}
                  <Button size="sm" className="gap-1.5 bg-cyan-600" onClick={() => openSubmission(s)}>
                    <Eye className="h-3.5 w-3.5" /> View Answers
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={!!selectedSubmission} onOpenChange={(open) => !open && setSelectedSubmission(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {selectedSubmission?.student_name || "Student"}'s Answers
              {selectedSubmission && <StatusBadge status={selectedSubmission.status} />}
            </DialogTitle>
          </DialogHeader>

          {selectedSubmission && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">{normalizeClass(selectedSubmission.class_level)} · Section {selectedSubmission.section}</Badge>
                {selectedSubmission.worksheets?.subject && <Badge variant="outline" className="text-xs">{selectedSubmission.worksheets.subject}</Badge>}
                {selectedSubmission.worksheets?.topic && <Badge variant="outline" className="text-xs">{selectedSubmission.worksheets.topic}</Badge>}
              </div>

              {/* Uploaded file link + inline preview */}
              {selectedSubmission.answer_file_url && (
                <div className="p-3 rounded-lg bg-muted/40 border space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    <span>Uploaded file:</span>
                    <a href={selectedSubmission.answer_file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium">
                      {selectedSubmission.answer_file_name || "View file"}
                    </a>
                    <a
                      href={selectedSubmission.answer_file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-xs text-muted-foreground hover:underline"
                    >
                      Open in new tab ↗
                    </a>
                  </div>
                  {previewLoading ? (
                    <div className="w-full h-[520px] rounded-lg border bg-white flex items-center justify-center text-sm text-muted-foreground">
                      Loading preview...
                    </div>
                  ) : previewError ? (
                    <div className="w-full h-[520px] rounded-lg border bg-white flex items-center justify-center text-sm text-destructive text-center px-6">
                      Couldn't load inline preview ({previewError}). Use "Open in new tab" above to view the file.
                    </div>
                  ) : /\.pdf(\?|$)/i.test(selectedSubmission.answer_file_url) ? (
                    <iframe
                      src={previewBlobUrl ? previewBlobUrl + "#toolbar=0&navpanes=0&scrollbar=0" : undefined}
                      title="Uploaded answer PDF"
                      className="w-full h-[520px] rounded-lg border bg-white"
                    />
                  ) : /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(selectedSubmission.answer_file_url) ? (
                    <img
                      src={previewBlobUrl || selectedSubmission.answer_file_url}
                      alt="Uploaded answer"
                      className="max-w-full max-h-[520px] rounded-lg border object-contain mx-auto"
                    />
                  ) : null}
                </div>
              )}

              {/* AI Evaluation Results */}
              {selectedSubmission.ai_reviewed_at && (
                <div className="rounded-xl border-2 border-violet-200 bg-violet-50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bot className="h-5 w-5 text-violet-600" />
                      <span className="font-semibold text-violet-800">AI Evaluation Results</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-violet-700">{selectedSubmission.ai_score}/100</span>
                    </div>
                  </div>
                  {selectedSubmission.ai_feedback && (
                    <p className="text-sm text-violet-700 bg-white rounded-lg p-3 border border-violet-100">
                      {selectedSubmission.ai_feedback}
                    </p>
                  )}
                  <p className="text-xs text-violet-500">
                    AI reviewed {new Date(selectedSubmission.ai_reviewed_at).toLocaleDateString()} at{" "}
                    {new Date(selectedSubmission.ai_reviewed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              )}

              {/* Activities with student answers + AI per-activity verdict */}
              {!selectedSubmission.answer_file_url && (
                activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Could not load the original worksheet activities.</p>
              ) : (
                activities.map((activity, idx) => {
                  const aiActivity = selectedSubmission.ai_per_activity?.find(
                    (a: any) => a.activity_index === idx
                  );
                  return (
                    <div key={idx} className="border rounded-xl p-4 bg-muted/10 space-y-3">
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{activity}</ReactMarkdown>
                      </div>
                      {(selectedSubmission.answers?.[idx] || selectedSubmission.answers?.[String(idx)]) && (
                        <div className="border-t pt-3">
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                            Student's Answer
                          </label>
                          <p className="text-sm whitespace-pre-wrap bg-card border rounded-lg p-3">
                            {selectedSubmission.answers?.[idx] || selectedSubmission.answers?.[String(idx)]}
                          </p>
                        </div>
                      )}
                      {aiActivity && (
                        <div className={`rounded-lg p-3 border text-sm space-y-1.5 ${
                          aiActivity.is_correct
                            ? "bg-emerald-50 border-emerald-200"
                            : aiActivity.partial_credit
                            ? "bg-amber-50 border-amber-200"
                            : "bg-red-50 border-red-200"
                        }`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {aiActivity.is_correct ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              ) : aiActivity.partial_credit ? (
                                <AlertCircle className="h-4 w-4 text-amber-600" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500" />
                              )}
                              <span className={`font-semibold text-xs uppercase ${
                                aiActivity.is_correct ? "text-emerald-700" : aiActivity.partial_credit ? "text-amber-700" : "text-red-600"
                              }`}>
                                {aiActivity.is_correct ? "Correct" : aiActivity.partial_credit ? "Partially Correct" : "Incorrect"}
                              </span>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              +{aiActivity.student_score ?? 0} pts
                            </Badge>
                          </div>
                          {aiActivity.correct_answer && (
                            <div>
                              <span className="text-xs font-semibold text-muted-foreground">Correct Answer: </span>
                              <span className="text-xs">{aiActivity.correct_answer}</span>
                            </div>
                          )}
                          {aiActivity.what_student_got_right && (
                            <div>
                              <span className="text-xs font-semibold text-emerald-700">What they got right: </span>
                              <span className="text-xs text-emerald-700">{aiActivity.what_student_got_right}</span>
                            </div>
                          )}
                          {aiActivity.reason_for_wrong && (
                            <div>
                              <span className="text-xs font-semibold text-red-600">Needs improvement: </span>
                              <span className="text-xs text-red-600">{aiActivity.reason_for_wrong}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )
              )}

              {/* Teacher review section */}
              <div className="space-y-3 border-t pt-4">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" />
                  Teacher's Final Review
                  {selectedSubmission.ai_score !== null && (
                    <span className="text-xs font-normal text-muted-foreground">(AI suggested score: {selectedSubmission.ai_score}/100 — edit if needed)</span>
                  )}
                </h3>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Final Score (out of 100)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={scoreInput}
                    onChange={(e) => setScoreInput(e.target.value)}
                    placeholder={selectedSubmission.ai_score !== null ? `AI suggested: ${selectedSubmission.ai_score}` : "e.g. 85"}
                    className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Feedback for Student
                  </label>
                  <Textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder={selectedSubmission.ai_feedback || "Great work! Try to show your working next time..."}
                    rows={3}
                  />
                  {selectedSubmission.ai_feedback && !feedbackText && (
                    <button
                      type="button"
                      onClick={() => setFeedbackText(selectedSubmission.ai_feedback || "")}
                      className="text-xs text-violet-600 hover:underline mt-1"
                    >
                      Use AI feedback as starting point
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSelectedSubmission(null)} disabled={isSaving}>Close</Button>
            {selectedSubmission?.status === "submitted" && (
              <Button
                variant="outline"
                className="gap-2 border-violet-300 text-violet-700 hover:bg-violet-50"
                disabled={aiEvaluatingId === selectedSubmission?.id}
                onClick={() => selectedSubmission && handleAiEvaluate(selectedSubmission.id)}
              >
                {aiEvaluatingId === selectedSubmission?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Run AI Evaluation
              </Button>
            )}
            {canDownloadReport && (
              <Button
                variant="outline"
                className="gap-2"
                disabled={isGeneratingPdf}
                onClick={handleDownloadReport}
              >
                {isGeneratingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download Report
              </Button>
            )}
            <Button
              onClick={handleMarkReviewed}
              disabled={isSaving || selectedSubmission?.status === "reviewed"}
              className="gap-2"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {selectedSubmission?.status === "reviewed" ? "Already Reviewed" : "Approve & Finalize"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Off-screen render target for PDF export. Must be laid out in the DOM
          (not display:none) for html2canvas to capture it, so we push it
          off-screen with fixed positioning instead of hiding it. */}
      {canDownloadReport && selectedSubmission && (
        <div style={{ position: "fixed", top: 0, left: "-9999px", zIndex: -1 }} aria-hidden="true">
          <AssessmentReport
            ref={reportRef}
            studentName={selectedSubmission.student_name || "Student"}
            classLevel={normalizeClass(selectedSubmission.class_level)}
            section={selectedSubmission.section}
            subject={selectedSubmission.worksheets?.subject}
            topic={selectedSubmission.worksheets?.topic}
            submittedAt={selectedSubmission.submitted_at}
            aiScore={selectedSubmission.ai_score as number}
            aiFeedback={selectedSubmission.ai_feedback || ""}
            perActivity={selectedSubmission.ai_per_activity || []}
            topicAnalysis={selectedSubmission.ai_topic_analysis || []}
            studyPlan={selectedSubmission.ai_study_plan || []}
          />
        </div>
      )}
    </AppLayout>
  );
}