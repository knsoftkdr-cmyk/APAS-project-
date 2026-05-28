import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { analyzeResponses, getReportConfig, type DimensionScore } from "@/data/reportTheories";
import { deriveVarkScores } from "@/data/varkMapping";
import { Download } from "lucide-react";
import { ReportContent } from "./report/ReportContent";
import { generateReportHtml } from "./report/reportHtmlGenerator";

interface StudentReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentName: string;
  studentAge: number;
  ageGroup: number;
  responses: Record<string, any>;
  submittedAt: string;
  studentClass?: string;
  teacherName?: string;
}

export const StudentReport = ({
  open,
  onOpenChange,
  studentName,
  studentAge,
  ageGroup,
  responses,
  submittedAt,
  studentClass,
  teacherName,
}: StudentReportProps) => {
  const reportConfig = getReportConfig(ageGroup);
  const scores = analyzeResponses(ageGroup, responses as Record<string, number>);
  const varkResponses = (responses as any)?.vark as Record<string, string> | undefined;
  const varkScores = deriveVarkScores(ageGroup, responses as Record<string, number>, varkResponses);

  if (!reportConfig || !scores) return null;

  const handleDownload = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const html = generateReportHtml({
      studentName,
      studentAge,
      ageGroup,
      submittedAt,
      reportConfig,
      scores,
      varkScores,
      studentClass,
      teacherName,
    });

    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] p-0 overflow-hidden border-0 bg-[#f7f5f0]">
        <div className="flex items-center justify-end p-3 pb-0">
          <Button size="sm" variant="outline" onClick={handleDownload} className="gap-1.5">
            <Download className="h-4 w-4" />
            Download Report
          </Button>
        </div>
        <ScrollArea className="max-h-[84vh] px-6 pb-6">
          <ReportContent
            studentName={studentName}
            studentAge={studentAge}
            ageGroup={ageGroup}
            submittedAt={submittedAt}
            reportConfig={reportConfig}
            scores={scores}
            varkScores={varkScores}
            studentClass={studentClass}
            teacherName={teacherName}
          />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
