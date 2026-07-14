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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  assessment_paper_id: string | null;
  ai_score: number | null;
  ai_feedback: string | null;
  score: number | null;
  teacher_feedback: string | null;
  created_at: string;
}

interface AssessmentPaper {
  id: string;
  teacher_id: string;
  title: string | null;
  class_level: string | null;
  section: string | null;
  subject: string | null;
  file_path: string;
  file_name: string;
  file_type: string | null;
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
  const [sectionLevel, setSectionLevel] = useState("");
  const [subject, setSubject] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Question paper selection state
  const [paperMode, setPaperMode] = useState<"existing" | "new">("existing");
  const [selectedPaperId, setSelectedPaperId] = useState<string>("");
  const [newPaperFile, setNewPaperFile] = useState<File | null>(null);
  const [newPaperTitle, setNewPaperTitle] = useState("");
  const paperFileInputRef = useRef<HTMLInputElement>(null);

  const [classFilter, setClassFilter] = useState<string>("all");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [paperFilter, setPaperFilter] = useState<string>("all");


  const { data: currentSchoolId } = useQuery({
    queryKey: ["current-school-id"],
    queryFn: async () => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("profiles")
        .select("school_id")
        .eq("id", userData.user.id)
        .single();
      if (error) throw error;
      return (data?.school_id as string | null) ?? null;
    },
  });

  const studentClassValue = classLevel ? (/^\d+$/.test(classLevel) ? `Class ${classLevel}` : classLevel) : "";

  const { data: studentsForClassSection } = useQuery({
    queryKey: ["students-for-class-section", currentSchoolId, studentClassValue, sectionLevel],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name")
        .eq("school_id", currentSchoolId)
        .eq("class", studentClassValue)
        .eq("section", sectionLevel)
        .order("full_name");
      if (error) throw error;
      return (data || []) as { id: string; full_name: string }[];
    },
    enabled: !!currentSchoolId && !!classLevel && !!sectionLevel,
  });
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

  const { data: papers } = useQuery({
    queryKey: ["assessment-papers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assessment_papers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as AssessmentPaper[];
    },
  });

  const classOptions = ["Nursery", "LKG", "UKG", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const sectionOptions = ["A", "B", "C", "D", "E"];

  const classSectionFiltered = (evaluations || []).filter((s) => {
    if (classFilter !== "all" && s.class_level !== classFilter) return false;
    if (sectionFilter !== "all" && s.section !== sectionFilter) return false;
    if (paperFilter !== "all" && s.assessment_paper_id !== paperFilter) return false;
    return true;
  });

  const filtered = classSectionFiltered.filter((s) => {
    if (activeTab === "pending") return s.status === "pending";
    if (activeTab === "ai_reviewed") return s.status === "ai_reviewed";
    if (activeTab === "reviewed") return s.status === "reviewed";
    return true;
  });

  const counts = {
    pending: classSectionFiltered.filter((s) => s.status === "pending").length,
    ai_reviewed: classSectionFiltered.filter((s) => s.status === "ai_reviewed").length,
    reviewed: classSectionFiltered.filter((s) => s.status === "reviewed").length,
    all: classSectionFiltered.length,
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

  const handlePaperFilePicked = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setNewPaperFile(files[0]);
  };

  const resetUploadForm = () => {
    setPendingFiles([]);
    setStudentName("");
    setClassLevel("");
    setSectionLevel("");
    setSubject("");
    setPaperMode("existing");
    setSelectedPaperId("");
    setNewPaperFile(null);
    setNewPaperTitle("");
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

  const createQuestionPaper = async (teacherId: string): Promise<string> => {
    if (!newPaperFile) throw new Error("Select a question paper file");
    const safeName = newPaperFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${teacherId}/${crypto.randomUUID()}-${safeName}`;

    const { error: uploadErr } = await supabase.storage
      .from("assessment-question-papers")
      .upload(filePath, newPaperFile, { contentType: newPaperFile.type || undefined });
    if (uploadErr) throw uploadErr;

    const { data: inserted, error: insertErr } = await supabase
      .from("assessment_papers")
      .insert({
        teacher_id: teacherId,
        title: newPaperTitle.trim() || newPaperFile.name,
        class_level: classLevel.trim() || null,
        section: sectionLevel.trim() || null,
        subject: subject.trim() || null,
        file_path: filePath,
        file_name: newPaperFile.name,
        file_type: newPaperFile.type || null,
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    queryClient.invalidateQueries({ queryKey: ["assessment-papers"] });
    return inserted.id as string;
  };

  const handleUpload = async () => {
    if (pendingFiles.length === 0) {
      toast.error("Select at least one answer sheet to upload");
      return;
    }
    if (paperMode === "existing" && !selectedPaperId) {
      toast.error("Select the question paper for this assessment first");
      return;
    }
    if (paperMode === "new" && !newPaperFile) {
      toast.error("Upload the question paper for this assessment first");
      return;
    }
    setUploading(true);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) throw new Error("Not authenticated");
      const teacherId = userData.user.id;

      const paperId = paperMode === "new" ? await createQuestionPaper(teacherId) : selectedPaperId;

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
          section: sectionLevel.trim() || null,
          subject: subject.trim() || null,
          assessment_paper_id: paperId,
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
  <div
    className="min-h-screen relative overflow-hidden"
    style={{ background: "linear-gradient(135deg, #ffffff, #fff7ed, #fffbeb)", backgroundSize: "cover" }}
  >
    {/* Layered waves at top */}
    <svg className="absolute top-0 left-0 w-full h-48 opacity-[0.07]" viewBox="0 0 1440 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0,90 C240,150 480,30 720,70 C960,110 1200,30 1440,80 L1440,0 L0,0 Z" fill="#f59e0b" />
    </svg>
    <svg className="absolute top-0 left-0 w-full h-36 opacity-[0.06]" viewBox="0 0 1440 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0,50 C320,120 720,10 1440,60 L1440,0 L0,0 Z" fill="#ea580c" />
    </svg>

    {/* Faint wave at bottom */}
    <svg className="absolute bottom-0 left-0 w-full h-40 opacity-[0.05]" viewBox="0 0 1440 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0,130 C240,70 480,190 720,150 C960,110 1200,190 1440,140 L1440,220 L0,220 Z" fill="#fb923c" />
    </svg>

    {/* Floating circles */}
    <div className="absolute top-20 right-10 w-40 h-40 rounded-full bg-amber-300 opacity-[0.06] blur-2xl" />
    <div className="absolute top-96 left-6 w-56 h-56 rounded-full bg-orange-300 opacity-[0.05] blur-2xl" />
    <div className="absolute bottom-32 right-1/4 w-32 h-32 rounded-full bg-amber-200 opacity-[0.05] blur-xl" />
    <div className="absolute top-1/2 left-1/3 w-24 h-24 rounded-full bg-orange-200 opacity-[0.04] blur-xl" />

    <div className="relative z-10 p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
<div className="rounded-2xl p-6 relative overflow-hidden bg-gradient-to-r from-amber-500 to-orange-600 shadow-lg">
  <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
  <div className="absolute right-16 top-10 w-16 h-16 bg-white/10 rounded-full" />
  <div className="relative flex items-center gap-4">
    <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
      <Sparkles className="h-6 w-6 text-white" />
    </div>
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-bold text-white">Assessment Evaluation</h1>
      <p className="text-sm text-white/80">
        Upload student assessment files and run AI-powered evaluation.
      </p>
    </div>
  </div>
</div>

<div className="flex justify-end">
  <Dialog open={uploadOpen} onOpenChange={(open) => { setUploadOpen(open); if (!open) resetUploadForm(); }}>
    <DialogTrigger asChild>
      <Button className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white">
        <Upload className="h-4 w-4 mr-2" />
        Upload Assessment
      </Button>
    </DialogTrigger>
          <DialogContent className="sm:max-w-md p-6 max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Upload Assessment Files</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Question Paper</Label>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={paperMode === "existing" ? "default" : "outline"}
                      onClick={() => setPaperMode("existing")}
                      className={`rounded-lg transition-all duration-200 ${
                        paperMode === "existing"
                          ? "bg-blue-600 text-white shadow-md"
                          : "bg-transparent text-slate-600 hover:bg-white"
                      }`}
                    >
                      Use Existing
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={paperMode === "new" ? "default" : "outline"}
                      onClick={() => setPaperMode("new")}
                      className={`rounded-lg transition-all duration-200 ${
                        paperMode === "new"
                          ? "bg-blue-600 text-white shadow-md"
                          : "bg-transparent text-slate-600 hover:bg-white"
                      }`}
                    >
                      Upload New
                    </Button>
                  </div>
                </div>

                {paperMode === "existing" ? (
                  <Select value={selectedPaperId} onValueChange={setSelectedPaperId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={papers && papers.length > 0 ? "Choose a question paper" : "No question papers uploaded yet"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(papers || []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {(p.title || p.file_name)}
                          {(p.class_level || p.subject) ? ` \u00B7 ${[p.class_level, p.subject].filter(Boolean).join(" ")}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-2">
                    <Input
                      value={newPaperTitle}
                      onChange={(e) => setNewPaperTitle(e.target.value)}
                      placeholder="Paper title, e.g. Mid-Term Maths"
                      className="w-full"
                    />
                    <div
                      className="w-full border-2 border-dashed border-amber-200 rounded-lg p-4 text-center cursor-pointer hover:bg-amber-50 hover:border-amber-300 transition-colors"
                      onClick={() => paperFileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); handlePaperFilePicked(e.dataTransfer.files); }}
                    >
                      <input
                        ref={paperFileInputRef}
                        type="file"
                        accept="application/pdf,image/png,image/jpeg"
                        className="hidden"
                        onChange={(e) => handlePaperFilePicked(e.target.files)}
                      />
                      {newPaperFile ? (
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate min-w-0 flex-1" title={newPaperFile.name}>{newPaperFile.name}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={(e) => { e.stopPropagation(); setNewPaperFile(null); }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                          <p className="text-xs text-muted-foreground">Click to browse or drag the question paper here (PDF or image)</p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              <div>
                <Label className="mb-2 block">Answer Sheets</Label>
                <div
                  className="w-full border-2 border-dashed border-orange-200 rounded-lg p-8 text-center cursor-pointer hover:bg-orange-50 hover:border-orange-300 transition-colors"
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
              </div>

              {pendingFiles.length > 0 && (
                <div className="space-y-2">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-sm bg-muted/40 border rounded-md px-3 py-2">
                      <span className="truncate min-w-0 flex-1" title={f.name}>{f.name}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removePendingFile(i)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Separator />

              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">Optional details (can be filled in later)</p>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="class-level">Class</Label>
                    <Select value={classLevel} onValueChange={(v) => { setClassLevel(v); setStudentName(""); }}>
                      <SelectTrigger id="class-level" className="w-full">
                        <SelectValue placeholder="Select class" />
                      </SelectTrigger>
                      <SelectContent>
                        {classOptions.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="section-level">Section</Label>
                    <Select value={sectionLevel} onValueChange={(v) => { setSectionLevel(v); setStudentName(""); }}>
                      <SelectTrigger id="section-level" className="w-full">
                        <SelectValue placeholder="Select section" />
                      </SelectTrigger>
                      <SelectContent>
                        {sectionOptions.map((sec) => (
                          <SelectItem key={sec} value={sec}>{sec}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="subject">Subject</Label>
                    <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Mathematics" className="w-full" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="student-name">Student Name</Label>
                  <Select value={studentName} onValueChange={setStudentName} disabled={!classLevel || !sectionLevel}>
                    <SelectTrigger id="student-name" className="w-full">
                      <SelectValue placeholder={!classLevel || !sectionLevel ? "Select class & section first" : "Select student"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(studentsForClassSection || []).map((st) => (
                        <SelectItem key={st.id} value={st.full_name}>{st.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter className="pt-4 mt-2 border-t">
              <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
              <Button
                className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700"
                onClick={handleUpload}
                disabled={
                  uploading ||
                  pendingFiles.length === 0 ||
                  (paperMode === "existing" ? !selectedPaperId : !newPaperFile)
                }
              >
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Upload
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    
      <div className="rounded-xl border border-orange-100 bg-white shadow-sm overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-500" />
        <div className="flex items-center gap-3 p-4">
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {classOptions.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sectionFilter} onValueChange={setSectionFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Sections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sections</SelectItem>
            {sectionOptions.map((sec) => (
              <SelectItem key={sec} value={sec}>{sec}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={paperFilter} onValueChange={setPaperFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="All Question Papers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Question Papers</SelectItem>
            {(papers || []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabFilter)}>
        <TabsList className="bg-orange-50 border border-orange-100">
          <TabsTrigger value="pending" className="data-[state=active]:bg-amber-500 data-[state=active]:text-white">
            Pending ({counts.pending})
          </TabsTrigger>
          <TabsTrigger value="ai_reviewed" className="data-[state=active]:bg-violet-500 data-[state=active]:text-white">
            AI Reviewed ({counts.ai_reviewed})
          </TabsTrigger>
          <TabsTrigger value="reviewed" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white">
            Reviewed ({counts.reviewed})
          </TabsTrigger>
          <TabsTrigger value="all" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white">
            All ({counts.all})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === "pending" && filtered.length > 0 && (
  <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
    <div className="flex items-center gap-2">
      <Checkbox
        checked={selectedIds.length > 0 && selectedIds.length === filtered.length}
        onCheckedChange={toggleSelectAll}
      />
      <span className="text-sm text-amber-800 font-medium">
        {selectedIds.length > 0 ? `${selectedIds.length} selected` : "Select all"}
      </span>
    </div>
    <Button
      size="sm"
      className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white"
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
              <Card key={s.id} className={`overflow-hidden border-l-4 ${s.status === "pending" ? "border-l-amber-400" : s.status === "ai_reviewed" ? "border-l-violet-400" : s.status === "reviewed" ? "border-l-emerald-400" : "border-l-gray-300" }`}>
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
            <Button className="bg-blue-600 text-white" variant="outline" onClick={closePreview}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssessmentReportView
        evaluationId={reportEvaluationId}
        open={!!reportEvaluationId}
        onOpenChange={(open) => { if (!open) setReportEvaluationId(null); }}
      />
      </div>
    </AppLayout>
  );
}
