import { useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { reportSecurityEvent } from "@/lib/securityEvents";
import { saveFile } from "@/lib/leadFiles";
import { buildCsv, csvSafe, EXPORT_COLUMNS, exportFileName, type ExportColumnKey } from "@/lib/leadImport";
import { APPLICANT_SOURCE_LABELS, APPLICANT_STATUS_LABELS, type AdmissionApplicant, type ApplicantSource, type ApplicantStatus } from "@/types/admission";
import type { IntakeRef } from "@/lib/leadImport";

interface Props {
  open: boolean; onOpenChange: (o: boolean) => void;
  intakes: IntakeRef[];
  /** Ids ticked in the Applicants table (may be empty). */
  selectedIds: string[];
}

type Scope = "selected" | "all" | "filtered";
const ALL = "all";

/** Loads leads through the same table and RLS as the Admissions screen (school-scoped), applies the chosen filters
 *  server-side, and writes CSV or XLSX. Every cell is formula-injection safe. */
export function LeadExportDialog({ open, onOpenChange, intakes, selectedIds }: Props) {
  const { profile } = useAuth();
  const [scope, setScope] = useState<Scope>(selectedIds.length ? "selected" : "all");
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [status, setStatus] = useState<string>(ALL);
  const [intake, setIntake] = useState<string>(ALL);
  const [source, setSource] = useState<string>(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cols, setCols] = useState<Set<ExportColumnKey>>(new Set(EXPORT_COLUMNS.filter((c) => c.default).map((c) => c.key)));
  const [busy, setBusy] = useState(false);
  const intakeById = useMemo(() => new Map(intakes.map((i) => [i.id, i])), [intakes]);

  const toggle = (k: ExportColumnKey) => setCols((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const run = async () => {
    if (!profile?.school_id) return;
    if (cols.size === 0) return toast.error("Choose at least one column.");
    if (scope === "selected" && selectedIds.length === 0) return toast.error("Tick some leads in the table first, or choose another option.");
    if (from && to && from > to) return toast.error("The 'from' date is after the 'to' date.");
    setBusy(true);
    try {
      const rows: AdmissionApplicant[] = [];
      const page = 1000;
      for (let start = 0; ; start += page) {
        let q = supabase.from("admission_applicants").select("*").eq("school_id", profile.school_id);
        if (scope === "selected") q = q.in("id", selectedIds.slice(0, 5000));
        if (scope === "filtered") {
          if (status !== ALL) q = q.eq("status", status);
          if (intake !== ALL) q = q.eq("intake_id", intake);
          if (source !== ALL) q = q.eq("source", source);
          if (from) q = q.gte("meeting_date", from);
          if (to) q = q.lte("meeting_date", to);
        }
        const { data, error } = await q.order("created_at", { ascending: false }).order("id").range(start, start + page - 1);
        if (error) throw new Error(error.message);
        rows.push(...((data ?? []) as unknown as AdmissionApplicant[]));
        if (!data || data.length < page || scope === "selected") break;
      }
      if (rows.length === 0) { toast.info("No leads match these choices."); return; }

      const chosen = EXPORT_COLUMNS.filter((c) => cols.has(c.key));
      const value = (a: AdmissionApplicant, k: ExportColumnKey): string => {
        const i = intakeById.get(a.intake_id);
        switch (k) {
          case "student_name": return a.full_name;
          case "parent_name": return a.parent_name;
          case "parent_phone": return a.parent_phone;
          case "parent_email": return a.parent_email ?? "";
          case "date_of_birth": return a.date_of_birth ?? "";
          case "gender": return a.gender ?? "";
          case "class": return i?.grade ?? "";
          case "academic_year": return i?.academic_year ?? "";
          case "enquiry_date": return a.meeting_date ?? "";
          case "source": return APPLICANT_SOURCE_LABELS[a.source as ApplicantSource] ?? a.source;
          case "status": return APPLICANT_STATUS_LABELS[a.status as ApplicantStatus] ?? a.status;
          case "previous_school": return a.previous_school_name ?? "";
          case "previous_grade": return a.previous_grade ?? "";
          case "address": return a.address ?? "";
          case "remarks": return a.meeting_notes ?? "";
          case "created_at": return (a.created_at ?? "").slice(0, 10);
        }
      };
      const headers = chosen.map((c) => c.label);
      const body = rows.map((a) => chosen.map((c) => value(a, c.key)));
      const iSel = intakeById.get(intake);
      const name = exportFileName(scope, format, {
        status: scope === "filtered" && status !== ALL ? APPLICANT_STATUS_LABELS[status as ApplicantStatus] : undefined,
        year: scope === "filtered" ? iSel?.academic_year : undefined, cls: scope === "filtered" ? iSel?.grade : undefined,
      });
      if (format === "csv") {
        await saveFile(name, { text: buildCsv(headers, body) }, "Admission leads");
      } else {
        const ws = XLSX.utils.aoa_to_sheet([headers, ...body.map((r) => r.map(csvSafe))]);
        ws["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Leads");
        await saveFile(name, { workbook: wb }, "Admission leads");
      }
      reportSecurityEvent({ event: "data_export", resource: "admission_applicants", count: rows.length });
      toast.success(`Exported ${rows.length} lead(s) to ${name}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Export Leads</DialogTitle><DialogDescription>Only leads from your school are included. Contact details are personal data - share the file carefully.</DialogDescription></DialogHeader>
        <div className="space-y-5">
          <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className="space-y-1">
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="selected" disabled={selectedIds.length === 0} />Selected leads ({selectedIds.length} ticked in the table)</label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="all" />All leads</label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="filtered" />Filtered leads</label>
          </RadioGroup>

          {scope === "filtered" && (
            <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>Status</Label>
                <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={ALL}>All statuses</SelectItem>{Object.entries(APPLICANT_STATUS_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Class &amp; academic year</Label>
                <Select value={intake} onValueChange={setIntake}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={ALL}>All classes</SelectItem>{intakes.map((i) => <SelectItem key={i.id} value={i.id}>{i.grade} · {i.academic_year}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Source of enquiry</Label>
                <Select value={source} onValueChange={setSource}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={ALL}>All sources</SelectItem>{Object.entries(APPLICANT_SOURCE_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label htmlFor="lx-from">Enquiry from</Label><Input id="lx-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="lx-to">to</Label><Input id="lx-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">Counsellor isn't stored on leads in APAS yet, so it can't be used as a filter.</p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Columns</Label>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {EXPORT_COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm"><Checkbox checked={cols.has(c.key)} onCheckedChange={() => toggle(c.key)} />{c.label}{c.sensitive && <span className="text-xs text-amber-700">(personal)</span>}</label>
              ))}
            </div>
          </div>

          <div className="space-y-1"><Label>Format</Label>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as "xlsx" | "csv")} className="flex gap-4">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="xlsx" />Excel (.xlsx)</label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="csv" />CSV (.csv)</label>
            </RadioGroup></div>

          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => void run()} disabled={busy}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}Export</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
