import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { analyzeResponses, getReportConfig, type DimensionScore } from "@/data/reportTheories";
import { deriveVarkScores } from "@/data/varkMapping";
import { Download } from "lucide-react";
import { ReportContent } from "./report/ReportContent";
import { generateReportHtml } from "./report/reportHtmlGenerator";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
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

const handleDownload = async () => {
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

  const filename = `APAS-Report-${studentName}.pdf`;

  // Browser
  if (!Capacitor.isNativePlatform()) {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;


    printWindow.document.write(html);
    printWindow.document.close();

    setTimeout(() => {
      printWindow.print();
    }, 300);

    return;
  }

  // Android App
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  document.body.appendChild(tempDiv);

  const html2pdf = (await import("html2pdf.js")).default;

const opt: any = {
  margin: 0.5,
  filename,
  image: { type: "jpeg", quality: 1 },
  html2canvas: { scale: 2 },
  jsPDF: {
    unit: "in",
    format: "a4",
    orientation: "portrait",
  },
};

  const worker = html2pdf().set(opt).from(tempDiv);

  const pdfBase64 = await worker.outputPdf("datauristring");
  const base64Data = pdfBase64.split(",")[1];

  await Filesystem.writeFile({
    path: filename,
    data: base64Data,
    directory: Directory.Documents,
  });

  document.body.removeChild(tempDiv);

  alert(`Report saved as ${filename}`);
};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[92vh] p-0 overflow-auto border-0 bg-[#f7f5f0]">
        <div className="flex items-center justify-center md:justify-end p-3 pr-12 pb-0">
          <Button size="sm" variant="outline" onClick={handleDownload} className="gap-1.5 w-full md:w-auto">
            <Download className="h-4 w-4" />
            Download Report
          </Button>
        </div>
        <div className="max-h-[84vh] overflow-y-auto px-3 md:px-6 pb-6">
  <div
    className="overflow-x-auto"
    style={{
      WebkitOverflowScrolling: "touch",
      touchAction: "pan-x pan-y",
    }}
  >
    <div style={{ minWidth: "900px" }}>
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
    </div>
  </div>
</div>
      </DialogContent>
    </Dialog>
  );
};
