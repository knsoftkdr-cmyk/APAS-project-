import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Paperclip } from "lucide-react";
import { ApplicantDocumentsPanel } from "./ApplicantDocumentsPanel";
import type { AdmissionApplicant } from "@/types/admission";

interface ApplicantDocumentsDialogProps {
  applicant: AdmissionApplicant;
  documentCount?: number;
  onDocumentsChanged?: () => void;
}

export function ApplicantDocumentsDialog({ applicant, documentCount = 0, onDocumentsChanged }: ApplicantDocumentsDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="icon"
        variant="ghost"
        className={`h-8 w-8 relative ${documentCount > 0 ? "text-accent" : ""}`}
        onClick={() => setOpen(true)}
        aria-label={documentCount > 0 ? `Documents (${documentCount} uploaded)` : "Documents"}
      >
        <Paperclip className="h-4 w-4" />
        {documentCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full bg-accent text-white text-[10px] leading-4 text-center font-medium">
            {documentCount}
          </span>
        )}
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Documents — {applicant.full_name}</DialogTitle>
        </DialogHeader>
        <ApplicantDocumentsPanel applicantId={applicant.id} onDocumentsChanged={onDocumentsChanged} />
      </DialogContent>
    </Dialog>
  );
}
