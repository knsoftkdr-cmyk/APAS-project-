import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import html2pdf from "html2pdf.js";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssessmentReportViewProps {
  evaluationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface QuestionScore {
  id: string;
  question_no: string;
  marks_awarded: number;
  marks_total: number;
  status: string;
  page_number: number | null;
}

interface TopicProficiency {
  id: string;
  topic: string;
  proficiency_percent: number;
  status: string;
  evidence: Record<string, string>;
}

interface StudyPlanItem {
  id: string;
  priority: number;
  title: string;
  description: string;
}

interface PageAnnotation {
  id: string;
  page_number: number;
  image_path: string;
  annotations: Array<{
    question_no: string;
    box_2d: [number, number, number, number];
    status: string;
    comment: string;
  }>;
}

const EVIDENCE_COLUMNS = [
  { key: "recall", label: "Recall" },
  { key: "conceptual", label: "Conceptual" },
  { key: "application", label: "Application" },
  { key: "assertion_reason", label: "Assertion/Reason" },
  { key: "numerical", label: "Numerical" },
  { key: "derivation", label: "Derivation" },
];

function questionChipStyle(status: string) {
  switch (status) {
    case "full":
      return "bg-green-50 border-green-300 text-green-700";
    case "partial":
      return "bg-amber-50 border-amber-300 text-amber-700";
    case "low_zero":
      return "bg-red-50 border-red-300 text-red-700";
    case "needs_review":
      return "bg-orange-50 border-orange-300 text-orange-700";
    default:
      return "bg-muted border-border text-muted-foreground";
  }
}

function evidenceIcon(value: string | undefined) {
  if (value === "correct") return <span className="block text-center font-bold" style={{ color: "#16a34a" }}>&#10003;</span>;
  if (value === "partial") return <span className="block text-center font-bold" style={{ color: "#d97706" }}>~</span>;
  if (value === "wrong") return <span className="block text-center font-bold" style={{ color: "#dc2626" }}>&#10007;</span>;
  return <span className="block text-center text-muted-foreground">-</span>;
}

function boxColor(status: string) {
  if (status === "correct") return "border-green-500 bg-green-500/10";
  if (status === "partial") return "border-amber-500 bg-amber-500/10";
  return "border-red-500 bg-red-500/10";
}

export function AssessmentReportView({ evaluationId, open, onOpenChange }: AssessmentReportViewProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["assessment-report", evaluationId],
    enabled: open && !!evaluationId,
    queryFn: async () => {
      const [evalRes, scoresRes, topicsRes, planRes, pagesRes] = await Promise.all([
        supabase.from("assessment_evaluations").select("*").eq("id", evaluationId).single(),
        supabase.from("assessment_question_scores").select("*").eq("evaluation_id", evaluationId),
        supabase.from("assessment_topic_proficiency").select("*").eq("evaluation_id", evaluationId),
        supabase.from("assessment_study_plan").select("*").eq("evaluation_id", evaluationId).order("priority", { ascending: true }),
        supabase.from("assessment_page_annotations").select("*").eq("evaluation_id", evaluationId).order("page_number", { ascending: true }),
      ]);

      if (evalRes.error) throw evalRes.error;

      const pageRows = (pagesRes.data || []) as PageAnnotation[];
      const pagesWithUrls = await Promise.all(
        pageRows.map(async (p) => {
          const { data: signed } = await supabase.storage
            .from("assessment-page-images")
            .createSignedUrl(p.image_path, 3600);
          return { ...p, signedUrl: signed?.signedUrl || null };
        })
      );

      return {
        evaluation: evalRes.data,
        questionScores: (scoresRes.data || []) as QuestionScore[],
        topics: (topicsRes.data || []) as TopicProficiency[],
        studyPlan: (planRes.data || []) as StudyPlanItem[],
        pages: pagesWithUrls,
      };
    },
  });

  const handleDownload = async () => {
    if (!contentRef.current || !data) return;
    setDownloading(true);
    try {
      const rawName = data.evaluation.student_name || data.evaluation.file_name || "assessment";
      const filename = `${rawName.replace(/[^a-zA-Z0-9]/g, "_")}_report.pdf`;
      const worker = html2pdf()
        .from(contentRef.current)
        .set({
          margin: 10,
          filename,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, windowWidth: contentRef.current.scrollWidth, width: contentRef.current.scrollWidth },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        });

      await worker.toPdf().get("pdf").then((pdf: any) => {
        const totalPages = pdf.internal.getNumberOfPages();
        for (let i = totalPages; i > 1; i--) {
          pdf.setPage(i);
          const pageContent = pdf.internal.pages[i];
          // Remove trailing pages that are effectively blank (only whitespace/no ops beyond boilerplate)
          if (pageContent && pageContent.length <= 4) {
            pdf.deletePage(i);
          } else {
            break;
          }
        }
      });

      await worker.save();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 flex-row items-center justify-between space-y-0">
          <DialogTitle>Assessment Correction Report</DialogTitle>
          <Button size="sm" variant="outline" onClick={handleDownload} disabled={downloading || isLoading || !data} className="mr-8">
            {downloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Download
          </Button>
        </DialogHeader>

        <div ref={contentRef} className="flex-1 overflow-y-auto px-6 pb-6 space-y-8">
          {isLoading || !data ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading report...
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="rounded-xl bg-primary text-primary-foreground p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    {data.evaluation.subject && (
                      <Badge variant="secondary" className="bg-white/15 text-white border-0">
                        {data.evaluation.subject}
                      </Badge>
                    )}
                    {data.evaluation.class_level && (
                      <Badge variant="secondary" className="bg-white/15 text-white border-0">
                        Class {data.evaluation.class_level}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="bg-white/15 text-white border-0">
                      {new Date(data.evaluation.created_at).toLocaleDateString()}
                    </Badge>
                  </div>
                  <p className="text-lg font-semibold">
                    {data.evaluation.student_name || data.evaluation.file_name}
                  </p>
                </div>
                <div className="flex items-center gap-6">
                  <div className="bg-white/10 rounded-lg px-4 py-2 text-center">
                    <div className="text-2xl font-bold">{data.evaluation.grade || "-"}</div>
                    <div className="text-xs opacity-80">
                      {data.evaluation.total_score ?? "-"}/{data.evaluation.max_score ?? "-"}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">
                      {data.evaluation.questions_attempted ?? "-"}/{data.evaluation.questions_total ?? "-"}
                    </div>
                    <div className="text-xs opacity-80">Questions Attempted</div>
                  </div>
                </div>
              </div>

              {data.evaluation.ai_feedback && (
                <p className="text-sm text-muted-foreground -mt-4">{data.evaluation.ai_feedback}</p>
              )}

              {/* Marks Breakdown */}
              {data.questionScores.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Marks Breakdown</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {data.questionScores.map((q) => (
                      <div
                        key={q.id}
                        className={cn("rounded-lg border px-3 py-2 text-sm flex items-center justify-between", questionChipStyle(q.status))}
                        style={{ breakInside: "avoid" }}
                      >
                        <span className="font-medium">Q{q.question_no}</span>
                        <span className="flex items-center gap-1">
                          {q.status === "needs_review" && <AlertTriangle className="h-3.5 w-3.5" />}
                          {q.marks_awarded}/{q.marks_total}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              {/* Topic Proficiency Map */}
              {data.topics.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Topic Proficiency Map</h3>
                  <div className="space-y-3">
                    {data.topics.map((t) => (
                      <div key={t.id} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium" title={t.topic}>{t.topic}</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs shrink-0",
                              t.status === "strong" && "text-green-700 border-green-300 bg-green-50",
                              t.status === "weak" && "text-amber-700 border-amber-300 bg-amber-50",
                              t.status === "critical_gap" && "text-red-700 border-red-300 bg-red-50"
                            )}
                          >
                            {t.proficiency_percent}%
                          </Badge>
                        </div>
                        <Progress
                          value={t.proficiency_percent}
                          className={cn(
                            "h-2 w-full",
                            t.status === "critical_gap" && "[&>div]:bg-red-500",
                            t.status === "weak" && "[&>div]:bg-amber-500"
                          )}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence Matrix */}
              {data.topics.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Topic × Question-Type Evidence Matrix</h3>
                  <div className="rounded-lg border">
                    <table className="w-full text-xs table-fixed">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-2 py-2 font-medium" style={{ width: "19%" }}>Topic</th>
                          {EVIDENCE_COLUMNS.map((c) => (
                            <th key={c.key} className="px-1 py-2 font-medium text-center break-words leading-tight" style={{ width: "12%" }}>
                              {c.label}
                            </th>
                          ))}
                          <th className="px-1 py-2 font-medium text-center" style={{ width: "9%" }}>Overall</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.topics.map((t) => (
                          <tr key={t.id} className="border-t">
                            <td className="px-2 py-2 break-words" style={{ width: "19%" }}>{t.topic}</td>
                            {EVIDENCE_COLUMNS.map((c) => (
                              <td key={c.key} className="px-2 py-2">
                                {evidenceIcon(t.evidence?.[c.key])}
                              </td>
                            ))}
                            <td className="px-2 py-2 text-center">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  t.status === "strong" && "text-green-700 border-green-300 bg-green-50",
                                  t.status === "weak" && "text-amber-700 border-amber-300 bg-amber-50",
                                  t.status === "critical_gap" && "text-red-700 border-red-300 bg-red-50"
                                )}
                              >
                                {t.status.replace("_", " ").toUpperCase()}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <Separator />

              {/* Study Plan */}
              {data.studyPlan.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Study Plan</h3>
                  <p className="text-xs text-muted-foreground mb-3">Ranked by marks impact. Start with #1 first.</p>
                  <div className="grid grid-cols-1 gap-3">
                    {data.studyPlan.map((p) => (
                      <div key={p.id} className="rounded-lg border-t-2 border-t-red-500 border-x border-b p-3" style={{ breakInside: "avoid" }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="h-5 w-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
                            {p.priority}
                          </span>
                          <span className="text-[10px] font-semibold tracking-wide text-red-600">
                            {p.priority === 1 ? "FIX FIRST" : "FIX NEXT"}
                          </span>
                        </div>
                        <p className="text-sm font-medium">{p.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">{p.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              {/* Per-page annotated answer sheet */}
              {data.pages.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Annotated Answer Sheet</h3>
                  <div className="space-y-6">
                    {data.pages.map((page) => (
                      <div key={page.id} className="space-y-2">
                        <p className="text-xs text-muted-foreground font-medium">Page {page.page_number}</p>
                        {page.signedUrl ? (
                          <div className="relative border rounded-lg overflow-hidden bg-muted/20">
                            <img src={page.signedUrl} alt={`Page ${page.page_number}`} className="w-full block" crossOrigin="anonymous" />
                            {(page.annotations || []).map((a, i) => {
                              const [ymin, xmin, ymax, xmax] = a.box_2d;
                              return (
                                <div
                                  key={i}
                                  title={`Q${a.question_no}: ${a.comment}`}
                                  className={cn("absolute border-2 rounded-sm", boxColor(a.status))}
                                  style={{
                                    top: `${ymin / 10}%`,
                                    left: `${xmin / 10}%`,
                                    width: `${(xmax - xmin) / 10}%`,
                                    height: `${(ymax - ymin) / 10}%`,
                                  }}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Image unavailable</p>
                        )}
                        {(page.annotations || []).length > 0 && (
                          <ul className="space-y-1">
                            {page.annotations.map((a, i) => (
                              <li key={i} className="text-xs flex gap-2">
                                <span
                                  className={cn(
                                    "shrink-0 font-medium",
                                    a.status === "correct" && "text-green-600",
                                    a.status === "partial" && "text-amber-600",
                                    a.status === "wrong" && "text-red-600"
                                  )}
                                >
                                  Q{a.question_no}:
                                </span>
                                <span className="text-muted-foreground">{a.comment}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
