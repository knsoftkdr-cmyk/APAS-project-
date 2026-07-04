import { useState, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2, ChevronDown, ChevronUp, FileText, CheckCircle2, Upload, X, Eye } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import mammoth from "mammoth";
import { AssessmentReportView } from "@/components/assessment/AssessmentReportView";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface EvaluationRow {
  id: string;
  teacher_id: string;
  student_name: string | null;
  class_level: string | null;
  section: string | null;
  subject: string | null;
  file_path: string;
  file_name: string;
  file_type: string | null;
  status: string;
  ai_score: number | null;
  ai_feedback: string | null;
  score: number | null;
  teacher_feedback: string | null;
  created_at: string;
}

type TabFilter = "pending" | "ai_reviewed" | "reviewed" | "all";

export default function AssessmentEvaluation() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabFilter>("pending");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [evaluatingIds, setEvaluatingIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reportEvaluationId, setReportEvaluationId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"pdf" | "docx" | "unsupported" | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string>("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [studentName, setStudentName] = useState("");
  const [classLevel, setClassLevel] = useState("");
  const [subject, setSubject] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: evaluations, isLoading } = useQuery({
    queryKey: ["assessment-evaluations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assessment_evaluations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as EvaluationRow[];
    },
  });

  const filtered = (evaluations || []).filter((s) => {
    if (activeTab === "pending") return s.status === "pending";
    if (activeTab === "ai_reviewed") return s.status === "ai_reviewed";
    if (activeTab === "reviewed") return s.status === "reviewed";
    return true;
  });

  const counts = {
    pending: (evaluations || []).filter((s) => s.status === "pending").length,
    ai_reviewed: (evaluations || []).filter((s) => s.status === "ai_reviewed").length,
    reviewed: (evaluations || []).filter((s) => s.status === "reviewed").length,
    all: (evaluations || []).length,
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    const pendingIds = filtered.filter((s) => s.status === "pending").map((s) => s.id);
    setSelectedIds((prev) => (prev.length === pendingIds.length ? [] : pendingIds));
  };

  const handleFilesPicked = (files: FileList | null) => {
    if (!files) return;
    setPendingFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const resetUploadForm = () => {
    setPendingFiles([]);
    setStudentName("");
    setClassLevel("");
    setSubject("");
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewHtml(null);
    setPreviewError(null);
    setPreviewKind(null);
    setPreviewFileName("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
  };

  const openPreview = async (row: EvaluationRow) => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewHtml(null);
    setPreviewUrl(null);
    setPreviewFileName(row.file_name);
    try {
      const { data, error } = await supabase.storage
        .from("assessment-evaluations")
        .download(row.file_path);
      if (error || !data) throw error || new Error("Could not download file");

      const lowerName = row.file_name.toLowerCase();
      if (lowerName.endsWith(".pdf") || row.file_type === "application/pdf") {
        setPreviewKind("pdf");
        const blob = new Blob([data], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(`${url}#toolbar=0&navpanes=0&scrollbar=0`);
      } else if (
        lowerName.endsWith(".docx") ||
        row.file_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        setPreviewKind("docx");
        const arrayBuffer = await data.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setPreviewHtml(result.value);
      } else {
        setPreviewKind("unsupported");
      }
    } catch (e: any) {
      setPreviewError(e.message || "Failed to load preview");
    } finally {
      setPreviewLoading(false);
    }
  };

  const renderAndUploadPages = async (evaluationId: string, teacherId: string, file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png")
      );
      if (!blob) continue;

      const imagePath = `${teacherId}/${evaluationId}/page-${pageNum}.png`;
      const { error: pageUploadErr } = await supabase.storage
        .from("assessment-page-images")
        .upload(imagePath, blob, { contentType: "image/png" });
      if (pageUploadErr) throw pageUploadErr;

      const { error: pageInsertErr } = await supabase.from("assessment_page_annotations").insert({
        evaluation_id: evaluationId,
        page_number: pageNum,
        image_path: imagePath,
        image_width: canvas.width,
        image_height: canvas.height,
        annotations: [],
      });
      if (pageInsertErr) throw pageInsertErr;
    }

    const { error: pageCountErr } = await supabase
      .from("assessment_evaluations")
      .update({ page_count: pdf.numPages })
      .eq("id", evaluationId);
    if (pageCountErr) throw pageCountErr;
  };

  const handleUpload = async () => {
    if (pendingFiles.length === 0) {
      toast.error("Select at least one file to upload");
      return;
    }
    setUploading(true);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) throw new Error("Not authenticated");
      const teacherId = userData.user.id;

      for (const file of pendingFiles) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const filePath = `${teacherId}/${crypto.randomUUID()}-${safeName}`;

        const { error: uploadErr } = await supabase.storage
          .from("assessment-evaluations")
          .upload(filePath, file, { contentType: file.type || undefined });
        if (uploadErr) throw uploadErr;

        const { data: insertedRow, error: insertErr } = await supabase.from("assessment_evaluations").insert({
          teacher_id: teacherId,
          student_name: studentName.trim() || null,
          class_level: classLevel.trim() || null,
          subject: subject.trim() || null,
          file_path: filePath,
          file_name: file.name,
          file_type: file.type || null,
          status: "pending",
        }).select().single();
        if (insertErr) throw insertErr;

        if ((file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) && insertedRow) {
          await renderAndUploadPages(insertedRow.id, teacherId, file);
        }
      }

      toast.success(`Uploaded ${pendingFiles.length} file${pendingFiles.length > 1 ? "s" : ""}`);
      queryClient.invalidateQueries({ queryKey: ["assessment-evaluations"] });
      resetUploadForm();
      setUploadOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const runEvaluation = async (ids: string[]) => {
    if (ids.length === 0) return;
    setEvaluatingIds((prev) => [...prev, ...ids]);
    try {
      const { data, error } = await supabase.functions.invoke("evaluate-assessment", {
        body: { evaluation_ids: ids },
      });
      if (error) throw error;

      const results = data?.results || [];
      const failed = results.filter((r: any) => r.error);
      const succeeded = results.filter((r: any) => r.success);

      if (succeeded.length > 0) {
        toast.success(`AI evaluation complete for ${succeeded.length} file${succeeded.length > 1 ? "s" : ""}`);
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} failed: ${failed[0].error}`);
      }

      queryClient.invalidateQueries({ queryKey: ["assessment-evaluations"] });
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    } catch (e: any) {
      toast.error(e.message || "AI evaluation failed");
    } finally {
      setEvaluatingIds((prev) => prev.filter((id) => !ids.includes(id)));
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">Pending</Badge>;
      case "ai_reviewed":
        return <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50">AI Reviewed</Badge>;
      case "reviewed":
        return <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">Reviewed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <AppLayout>
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Assessment Evaluation
          </h1>
          <p className="text-sm text-muted-foreground">
            Upload student assessment files and run AI-powered evaluation.
          </p>
        </div>

        <Dialog open={uploadOpen} onOpenChange={(open) => { setUploadOpen(open); if (!open) resetUploadForm(); }}>
          <DialogTrigger asChild>
            <Button>
              <Upload className="h-4 w-4 mr-2" />
              Upload Assessment
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Upload Assessment Files</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/40 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleFilesPicked(e.dataTransfer.files); }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilesPicked(e.target.files)}
                />
                <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Click to browse or drag files here</p>
              </div>

              {pendingFiles.length > 0 && (
                <div className="space-y-1">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-sm bg-muted/40 rounded px-2 py-1">
                      <span className="truncate">{f.name}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removePendingFile(i)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Separator />
              <p className="text-xs text-muted-foreground">Optional details (can be filled in later)</p>

              <div className="space-y-2">
                <Label htmlFor="student-name">Student Name</Label>
                <Input id="student-name" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="e.g. Vivaan Sharma" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="class-level">Class</Label>
                  <Input id="class-level" value={classLevel} onChange={(e) => setClassLevel(e.target.value)} placeholder="e.g. 5-A" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Mathematics" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
              <Button onClick={handleUpload} disabled={uploading || pendingFiles.length === 0}>
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Upload
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabFilter)}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({counts.pending})</TabsTrigger>
          <TabsTrigger value="ai_reviewed">AI Reviewed ({counts.ai_reviewed})</TabsTrigger>
          <TabsTrigger value="reviewed">Reviewed ({counts.reviewed})</TabsTrigger>
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === "pending" && filtered.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-2">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectedIds.length > 0 && selectedIds.length === filtered.length}
              onCheckedChange={toggleSelectAll}
            />
            <span className="text-sm text-muted-foreground">
              {selectedIds.length > 0 ? `${selectedIds.length} selected` : "Select all"}
            </span>
          </div>
          <Button
            size="sm"
            disabled={selectedIds.length === 0 || evaluatingIds.length > 0}
            onClick={() => runEvaluation(selectedIds)}
          >
            {evaluatingIds.length > 0 ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            Evaluate Selected with AI
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading evaluations...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <FileText className="h-8 w-8" />
          <p>No files in this view yet. Upload one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => {
            const isEvaluating = evaluatingIds.includes(s.id);
            const isExpanded = expandedId === s.id;
            const label = s.student_name || s.file_name;
            return (
              <Card key={s.id} className="overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between gap-4 py-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {s.status === "pending" && (
                      <Checkbox
                        checked={selectedIds.includes(s.id)}
                        onCheckedChange={() => toggleSelect(s.id)}
                      />
                    )}
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate cursor-pointer hover:underline" onClick={() => openPreview(s)}>{label}</CardTitle>
                      <p className="text-xs text-muted-foreground truncate">
                        {s.file_name}
                        {(s.class_level || s.subject) && (
                          <>{"\u00B7"} {[s.class_level, s.subject].filter(Boolean).join(" ")}</>
                        )}
                        {" "}{"\u00B7"} Uploaded {new Date(s.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => openPreview(s)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    {statusBadge(s.status)}
                    {s.status === "pending" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isEvaluating}
                        onClick={() => runEvaluation([s.id])}
                      >
                        {isEvaluating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {(s.status === "ai_reviewed" || s.status === "reviewed") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setReportEvaluationId(s.id)}
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    )}
                  </div>
                </CardHeader>

              </Card>
            );
          })}
        </div>
      )}
    </div>
      <Dialog open={previewOpen} onOpenChange={(open) => { if (!open) closePreview(); }}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="truncate">{previewFileName}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded-md border bg-muted/20">
            {previewLoading ? (
              <div className="flex items-center justify-center h-full py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading preview...
              </div>
            ) : previewError ? (
              <div className="flex items-center justify-center h-full py-16 text-destructive text-sm px-4 text-center">
                {previewError}
              </div>
            ) : previewKind === "pdf" && previewUrl ? (
              <iframe src={previewUrl} className="w-full h-[70vh]" title={previewFileName} />
            ) : previewKind === "docx" && previewHtml ? (
              <div
                className="prose prose-sm max-w-none p-4 bg-white"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-16 text-muted-foreground gap-2">
                <FileText className="h-8 w-8" />
                <p className="text-sm">Preview not available for this file type.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePreview}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssessmentReportView
        evaluationId={reportEvaluationId}
        open={!!reportEvaluationId}
        onOpenChange={(open) => { if (!open) setReportEvaluationId(null); }}
      />
    </AppLayout>
  );
}
