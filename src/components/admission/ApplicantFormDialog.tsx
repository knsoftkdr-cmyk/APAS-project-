import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Paperclip, UserPlus, X } from "lucide-react";
import type { ApplicantFormInput } from "@/hooks/useAdmissionApplicants";
import { uploadAdmissionDocument } from "@/hooks/useAdmissionDocuments";
import type { AdmissionDocumentType, AdmissionIntake } from "@/types/admission";
import { APPLICANT_SOURCE_LABELS, DOCUMENT_TYPE_LABELS } from "@/types/admission";

const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "webp"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

interface PendingDocument {
  id: string;
  documentType: AdmissionDocumentType;
  file: File;
}

interface ApplicantFormDialogProps {
  intakes: AdmissionIntake[];
  defaultIntakeId?: string | null;
  onCreate: (input: ApplicantFormInput) => Promise<{ error: string | null; id?: string | null }>;
  onDocumentsUploaded?: () => void;
}

function emptyForm(defaultIntakeId?: string | null): ApplicantFormInput {
  return {
    intake_id: defaultIntakeId ?? "",
    full_name: "",
    date_of_birth: "",
    gender: "",
    parent_name: "",
    parent_phone: "",
    parent_email: "",
    address: "",
    previous_school_name: "",
    previous_grade: "",
    previous_percentage: null,
    sibling_studying_here: false,
    distance_from_school_km: null,
    category: "",
    source: "walk_in",
    meeting_date: new Date().toISOString().slice(0, 10),
    meeting_notes: "",
  };
}

export function ApplicantFormDialog({ intakes, defaultIntakeId, onCreate, onDocumentsUploaded }: ApplicantFormDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<ApplicantFormInput>(emptyForm(defaultIntakeId));
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([]);
  const [pendingDocType, setPendingDocType] = useState<AdmissionDocumentType>("report_card");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setForm(emptyForm(defaultIntakeId));
      setPendingDocuments([]);
    }
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      toast({
        title: "Unsupported file type",
        description: `Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast({ title: "File is too large", description: "Max size is 10MB.", variant: "destructive" });
      return;
    }

    setPendingDocuments((docs) => [...docs, { id: crypto.randomUUID(), documentType: pendingDocType, file }]);
  };

  const removePendingDocument = (id: string) => {
    setPendingDocuments((docs) => docs.filter((d) => d.id !== id));
  };

  const handleSubmit = async () => {
    if (!form.intake_id) {
      toast({ title: "Missing info", description: "Select which grade/intake this applicant is for.", variant: "destructive" });
      return;
    }
    if (!form.full_name.trim() || !form.parent_name.trim() || !form.parent_phone.trim()) {
      toast({ title: "Missing info", description: "Student name, parent name and phone are required.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error, id } = await onCreate({
      ...form,
      date_of_birth: form.date_of_birth || null,
      gender: form.gender || null,
      parent_email: form.parent_email || null,
      address: form.address || null,
      previous_school_name: form.previous_school_name || null,
      previous_grade: form.previous_grade || null,
      previous_percentage: form.previous_percentage || null,
      distance_from_school_km: form.distance_from_school_km || null,
      category: form.category || null,
      meeting_notes: form.meeting_notes || null,
    });

    if (error) {
      setSubmitting(false);
      toast({ title: "Could not save applicant", description: error, variant: "destructive" });
      return;
    }

    if (pendingDocuments.length > 0 && id) {
      const failures: string[] = [];
      for (const doc of pendingDocuments) {
        const result = await uploadAdmissionDocument({
          file: doc.file,
          documentType: doc.documentType,
          applicantId: id,
        });
        if (result.error) failures.push(`${doc.file.name}: ${result.error}`);
      }
      setSubmitting(false);
      onDocumentsUploaded?.();

      if (failures.length > 0) {
        toast({
          title: "Applicant saved, but some documents failed to upload",
          description: failures.join(" · "),
          variant: "destructive",
        });
        setOpen(false);
        return;
      }
    } else {
      setSubmitting(false);
    }

    toast({ title: "Applicant logged" });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-white text-indigo-700 hover:bg-indigo-50 shadow-sm">
          <UserPlus className="h-4 w-4 mr-1.5" />
          Log New Applicant
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] p-0 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 shrink-0">
          <DialogHeader>
            <DialogTitle className="text-white text-base flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <UserPlus className="h-4 w-4 text-white" />
              </div>
              Log Admission Applicant
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="grid gap-4 px-5 py-4 overflow-y-auto flex-1">
          

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-600">
              Admission Intake <span className="text-red-500">*</span>
            </Label>
            <Select value={form.intake_id} onValueChange={(v) => setForm((f) => ({ ...f, intake_id: v }))}>
              <SelectTrigger className="border-slate-200 focus:ring-indigo-400">
                <SelectValue placeholder="Select grade / academic year" />
              </SelectTrigger>
              <SelectContent>
                {intakes.map((intake) => (
                  <SelectItem key={intake.id} value={intake.id}>
                    {intake.grade} · {intake.academic_year} ({intake.seats_remaining ?? intake.total_seats} seats left)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
  <div className="space-y-1.5">
    <Label htmlFor="full_name" className="text-xs font-semibold text-slate-600">
      Student Name <span className="text-red-500">*</span>
    </Label>
    <Input
      id="full_name"
      value={form.full_name}
      onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
      className="border-slate-200 focus-visible:ring-indigo-400"
    />
  </div>
  <div className="space-y-1.5">
    <Label htmlFor="dob" className="text-xs font-semibold text-slate-600">Date of Birth</Label>
    <Input
      id="dob"
      type="date"
      value={form.date_of_birth ?? ""}
      onChange={(e) => setForm((f) => ({ ...f, date_of_birth: e.target.value }))}
      className="border-slate-200 focus-visible:ring-indigo-400"
    />
  </div>
</div>

<div className="grid sm:grid-cols-2 gap-3">
  <div className="space-y-1.5">
    <Label className="text-xs font-semibold text-slate-600">Gender</Label>
    <Select value={form.gender ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}>
      <SelectTrigger className="border-slate-200 focus:ring-indigo-400">
        <SelectValue placeholder="Select" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="male">Male</SelectItem>
        <SelectItem value="female">Female</SelectItem>
        <SelectItem value="other">Other</SelectItem>
      </SelectContent>
    </Select>
  </div>
  <div className="space-y-1.5">
    <Label className="text-xs font-semibold text-slate-600">How did they reach us?</Label>
    <Select value={form.source ?? "walk_in"} onValueChange={(v) => setForm((f) => ({ ...f, source: v }))}>
      <SelectTrigger className="border-slate-200 focus:ring-indigo-400">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(APPLICANT_SOURCE_LABELS).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
</div>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3.5">
            <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide mb-3">Parent / Guardian</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="parent_name">
                  Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="parent_name"
                  value={form.parent_name}
                  onChange={(e) => setForm((f) => ({ ...f, parent_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="parent_phone">
                  Phone <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="parent_phone"
                  value={form.parent_phone}
                  onChange={(e) => setForm((f) => ({ ...f, parent_phone: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="parent_email">Email (optional)</Label>
                <Input
                  id="parent_email"
                  type="email"
                  value={form.parent_email ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, parent_email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="address">Address (optional)</Label>
                <Input
                  id="address"
                  value={form.address ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-violet-100 bg-violet-50/30 p-3.5">
           <p className="text-xs font-bold text-violet-700 uppercase tracking-wide mb-3">Previous School (used for filtering)</p>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="prev_school">School Name</Label>
                <Input
                  id="prev_school"
                  value={form.previous_school_name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, previous_school_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prev_grade">Grade Completed</Label>
                <Input
                  id="prev_grade"
                  value={form.previous_grade ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, previous_grade: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prev_pct">Percentage</Label>
                <Input
                  id="prev_pct"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={form.previous_percentage ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, previous_percentage: e.target.value ? Number(e.target.value) : null }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-amber-100 bg-amber-50/30 p-3.5">
            <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-3">Other Criteria</p>
            <div className="grid sm:grid-cols-3 gap-3 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="distance">Distance from school (km)</Label>
                <Input
                  id="distance"
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.distance_from_school_km ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, distance_from_school_km: e.target.value ? Number(e.target.value) : null }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="category">Category (optional)</Label>
                <Input
                  id="category"
                  placeholder="e.g. general, staff ward, quota"
                  value={form.category ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox
                  id="sibling"
                  checked={form.sibling_studying_here}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, sibling_studying_here: checked === true }))}
                />
                <Label htmlFor="sibling" className="font-normal">
                  Sibling already studies here
                </Label>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="meeting_notes" className="text-xs font-semibold text-slate-600">Meeting Notes</Label>
            <Textarea
              id="meeting_notes"
              placeholder="Anything from the conversation worth remembering..."
              value={form.meeting_notes ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, meeting_notes: e.target.value }))}
              rows={3}
              className="border-slate-200 focus-visible:ring-indigo-400"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-3">Documents (optional)</p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <Select
                value={pendingDocType}
                onValueChange={(v) => setPendingDocType(v as AdmissionDocumentType)}
              >
                <SelectTrigger className="sm:w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                disabled={submitting}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4 mr-1.5" />
                Choose File
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleFileSelected}
              />
            </div>

            {pendingDocuments.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {pendingDocuments.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between text-sm bg-indigo-50/50 border border-indigo-100 rounded-lg px-2.5 py-1.5"
                  >
                    <span className="truncate">
                      <span className="font-medium">{DOCUMENT_TYPE_LABELS[doc.documentType]}:</span>{" "}
                      <span className="text-muted-foreground">{doc.file.name}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removePendingDocument(doc.id)}
                      className="text-muted-foreground hover:text-destructive shrink-0 ml-2"
                      aria-label={`Remove ${doc.file.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-xs text-muted-foreground mt-1.5">
              PDF, JPG, PNG or WEBP · max 10MB each. Files upload right after the applicant is saved.
            </p>
          </div>
        </div>

        <DialogFooter className="px-5 py-4 border-t border-slate-100 shrink-0">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 sm:flex-none bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700"
          >
            {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Save Applicant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
