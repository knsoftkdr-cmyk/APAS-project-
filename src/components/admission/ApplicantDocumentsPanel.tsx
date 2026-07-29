import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FileText, Upload, Loader2, Trash2, Eye, Paperclip } from "lucide-react";
import { useAdmissionDocuments } from "@/hooks/useAdmissionDocuments";
import type { AdmissionDocument, AdmissionDocumentType } from "@/types/admission";
import { DOCUMENT_TYPE_LABELS } from "@/types/admission";

interface ApplicantDocumentsPanelProps {
  applicantId: string;
  onDocumentsChanged?: () => void;
}

const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as AdmissionDocumentType[];

function formatFileSize(doc: AdmissionDocument) {
  return doc.file_name ?? doc.file_path.split("/").pop();
}

export function ApplicantDocumentsPanel({ applicantId, onDocumentsChanged }: ApplicantDocumentsPanelProps) {
  const { toast } = useToast();
  const { documents, loading, uploading, uploadDocument, viewDocument, deleteDocument } =
    useAdmissionDocuments(applicantId);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedType, setSelectedType] = useState<AdmissionDocumentType>("report_card");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handlePickFile = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so selecting the same file again still fires onChange.
    e.target.value = "";
    if (!file) return;

    const { error } = await uploadDocument(file, selectedType);
    if (error) {
      toast({ title: "Upload failed", description: error, variant: "destructive" });
      return;
    }
    toast({ title: `${DOCUMENT_TYPE_LABELS[selectedType]} uploaded` });
    onDocumentsChanged?.();
  };

  const handleView = async (doc: AdmissionDocument) => {
    const { url, error } = await viewDocument(doc);
    if (error || !url) {
      toast({ title: "Could not open file", description: error ?? undefined, variant: "destructive" });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleDelete = async (doc: AdmissionDocument) => {
    setPendingDeleteId(doc.id);
    const { error } = await deleteDocument(doc);
    setPendingDeleteId(null);
    if (error) {
      toast({ title: "Could not delete file", description: error, variant: "destructive" });
      return;
    }
    toast({ title: "Document removed" });
    onDocumentsChanged?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedType} onValueChange={(v) => setSelectedType(v as AdmissionDocumentType)}>
          <SelectTrigger className="w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOCUMENT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {DOCUMENT_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button onClick={handlePickFile} disabled={uploading} variant="outline">
          {uploading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
          Upload File
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          onChange={handleFileChange}
        />
        <span className="text-xs text-muted-foreground">PDF or image, up to 10MB</span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading documents...</p>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed rounded-card">
          <Paperclip className="h-6 w-6 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
        </div>
      ) : (
        <ul className="divide-y rounded-card border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{formatFileSize(doc)}</p>
                  <p className="text-xs text-muted-foreground">
                    {DOCUMENT_TYPE_LABELS[doc.document_type]} · {new Date(doc.uploaded_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleView(doc)} aria-label="View">
                  <Eye className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-danger hover:text-danger"
                  onClick={() => handleDelete(doc)}
                  disabled={pendingDeleteId === doc.id}
                  aria-label="Delete"
                >
                  {pendingDeleteId === doc.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
