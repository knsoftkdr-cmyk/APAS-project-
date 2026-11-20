import { useCallback, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { readLeadFile, saveFile } from "@/lib/leadFiles";
import {
  autoMapColumns, detectDuplicates, failedReportCsv, LEAD_FIELDS, missingRequiredMappings, templateCsv, validateLeadRow,
  type DupInfo, type FieldMapping, type IntakeRef, type LeadFieldKey, type ParsedSheet, type RowResult,
} from "@/lib/leadImport";
import { executeLeadImport, fetchExistingLeads, recordImportJob, type ExistingLeadFull } from "@/hooks/useLeadImport";

type Step = "upload" | "map" | "review" | "importing" | "done";
type DupMode = "skip" | "update" | "review";
type RowChoice = "skip" | "update" | "new";
const NONE = "__none__";

interface Props { open: boolean; onOpenChange: (o: boolean) => void; intakes: IntakeRef[]; onImported: () => void }

interface Summary { total: number; imported: number; updated: number; skipped: number; invalid: number; failed: number; failedRows: { rowNum: number; cells: string[]; messages: string[] }[] }

export function LeadImportDialog({ open, onOpenChange, intakes, onImported }: Props) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [results, setResults] = useState<RowResult[]>([]);
  const [dups, setDups] = useState<Map<number, DupInfo>>(new Map());
  const [existing, setExisting] = useState<ExistingLeadFull[]>([]);
  const [dupMode, setDupMode] = useState<DupMode>("skip");
  const [choices, setChoices] = useState<Record<number, RowChoice>>({});
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const reset = () => {
    setStep("upload"); setFileName(""); setSheet(null); setMapping({}); setResults([]); setDups(new Map()); setExisting([]);
    setDupMode("skip"); setChoices({}); setSummary(null); setProgress({ done: 0, total: 0 }); setShowAll(false); setBusy(false);
  };
  const close = (o: boolean) => { if (!o && step === "importing") return; if (!o) reset(); onOpenChange(o); };

  const takeFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const { sheet: s, error } = await readLeadFile(file);
    setBusy(false);
    if (error || !s) { toast.error(error ?? "Couldn't read this file."); return; }
    setFileName(file.name); setSheet(s); setMapping(autoMapColumns(s.headers)); setStep("map");
  }, []);

  const missing = useMemo(() => missingRequiredMappings(mapping), [mapping]);
  const noIntakes = intakes.length === 0;

  const runValidation = async () => {
    if (!sheet || !profile?.school_id) return;
    setBusy(true);
    try {
      const rs = sheet.rows.map((cells, i) => validateLeadRow(cells, i + 2, mapping, intakes, today));
      const ex = await fetchExistingLeads(profile.school_id);
      setExisting(ex);
      setResults(rs);
      setDups(detectDuplicates(rs.filter((r) => r.payload), ex, intakes));
      setChoices({}); setStep("review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't check for duplicates.");
    } finally { setBusy(false); }
  };

  const valid = results.filter((r) => r.payload);
  const invalid = results.filter((r) => !r.payload);
  const dupRows = valid.filter((r) => dups.get(r.rowNum)?.kind !== "none" && dups.get(r.rowNum));
  const fresh = valid.filter((r) => dups.get(r.rowNum)?.kind === "none");

  const decisionFor = (r: RowResult): RowChoice => {
    const d = dups.get(r.rowNum);
    if (!d || d.kind === "none") return "new";
    if (dupMode === "review") return choices[r.rowNum] ?? "skip";
    if (dupMode === "update") return d.kind === "existing" ? "update" : "skip";
    return "skip";
  };
  const plan = useMemo(() => {
    const ins = valid.filter((r) => decisionFor(r) === "new");
    const upd = valid.filter((r) => decisionFor(r) === "update" && dups.get(r.rowNum)?.kind === "existing");
    return { ins, upd, skip: valid.length - ins.length - upd.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, dups, dupMode, choices]);

  const doImport = async () => {
    if (!user?.id || !profile?.school_id) return;
    setConfirm(false); setStep("importing");
    setProgress({ done: 0, total: plan.ins.length + plan.upd.length });
    const byId = new Map(existing.map((e) => [e.id, e]));
    let outcome: Awaited<ReturnType<typeof executeLeadImport>>;
    try {
      outcome = await executeLeadImport({
        userId: user.id, schoolId: profile.school_id,
        inserts: plan.ins.map((r) => ({ rowNum: r.rowNum, payload: r.payload! })),
        updates: plan.upd.map((r) => ({ rowNum: r.rowNum, existing: byId.get(dups.get(r.rowNum)!.existingId!)!, payload: r.payload! })),
        onProgress: (done, total) => setProgress({ done, total }),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed.");
      setStep("review");
      return;
    }
    const failedRows = [
      ...invalid.map((r) => ({ rowNum: r.rowNum, cells: r.cells, messages: r.errors })),
      ...outcome.failed.map((f) => ({ rowNum: f.rowNum, cells: results.find((r) => r.rowNum === f.rowNum)?.cells ?? [], messages: [f.message] })),
    ].sort((a, b) => a.rowNum - b.rowNum);
    const s: Summary = { total: results.length, imported: outcome.imported, updated: outcome.updated, skipped: plan.skip, invalid: invalid.length, failed: outcome.failed.length, failedRows };
    setSummary(s); setStep("done");
    const status = outcome.imported + outcome.updated === 0 && (s.invalid + s.failed) > 0 ? "failed" : s.invalid + s.failed > 0 ? "completed_with_errors" : "completed";
    const err = await recordImportJob({
      school_id: profile.school_id, imported_by: user.id, file_name: fileName.slice(0, 255), duplicate_mode: dupMode, total_rows: s.total,
      imported_count: s.imported, updated_count: s.updated, skipped_duplicates: s.skipped, invalid_count: s.invalid, failed_count: s.failed, status,
      error_report: failedRows.map((f) => ({ row: f.rowNum, message: f.messages.join("; ").slice(0, 300) })),
    });
    if (err) toast.warning("Leads were imported, but the import history entry couldn't be saved.");
    qc.invalidateQueries({ queryKey: ["lead-import-history"] });
    onImported();
    if (s.imported + s.updated > 0) toast.success(`${s.imported} lead(s) added${s.updated ? `, ${s.updated} updated` : ""}.`);
  };

  const downloadFailed = () => summary && void saveFile("APAS_Lead_Import_Failed_Rows.csv", { text: failedReportCsv(sheet?.headers ?? [], summary.failedRows) }, "Failed lead rows");
  const previewRows = showAll ? results : results.slice(0, 50);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Leads</DialogTitle>
          <DialogDescription>Upload a CSV or Excel (.xlsx) file of enquiries. You review everything before anything is saved.</DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            {noIntakes && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Create at least one admission intake (class + academic year) first. Every lead must belong to an intake.</p>}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void takeFile(e.dataTransfer.files?.[0]); }}
              className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center", dragOver && "border-primary bg-primary/5")}
            >
              {busy ? <Loader2 className="h-8 w-8 animate-spin" /> : <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />}
              <p className="text-sm">Drag a file here, or</p>
              <Button disabled={busy || noIntakes} onClick={() => fileInput.current?.click()}><Upload className="mr-1 h-4 w-4" />Choose file</Button>
              <input ref={fileInput} type="file" accept=".csv,.xlsx" className="hidden" aria-label="Upload leads file"
                onChange={(e) => { void takeFile(e.target.files?.[0]); e.target.value = ""; }} />
              <p className="text-xs text-muted-foreground">.csv or .xlsx, up to 5 MB and 5,000 rows. Headings go in the first row.</p>
            </div>
            <Button variant="outline" onClick={() => void saveFile("APAS_Leads_Import_Template.csv", { text: templateCsv() }, "Leads import template")}>
              <Download className="mr-1 h-4 w-4" />Download sample template
            </Button>
          </div>
        )}

        {step === "map" && sheet && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground"><strong>{fileName}</strong> · {sheet.rows.length} rows. Match your file's columns to APAS fields (we guessed where we could).</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {LEAD_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="flex items-center gap-1">{f.label}{f.required && <span className="text-red-600" aria-label="required">*</span>}</Label>
                  <Select value={mapping[f.key] == null ? NONE : String(mapping[f.key])}
                    onValueChange={(v) => setMapping((m) => { const n = { ...m }; if (v === NONE) delete n[f.key as LeadFieldKey]; else n[f.key] = Number(v); return n; })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— not in my file —</SelectItem>
                      {sheet.headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h || `(column ${i + 1})`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{f.hint}</p>
                </div>
              ))}
            </div>
            {missing.length > 0 && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">Still needed: {missing.map((m) => m.label).join(", ")}.</p>}
            <div className="flex justify-between"><Button variant="ghost" onClick={reset}>Choose another file</Button>
              <Button disabled={missing.length > 0 || busy} onClick={() => void runValidation()}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Check my data</Button></div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Total rows" value={results.length} />
              <Tile label="Ready to import" value={fresh.length} tone="good" />
              <Tile label="Possible duplicates" value={dupRows.length} tone={dupRows.length ? "warn" : undefined} />
              <Tile label="Invalid rows" value={invalid.length} tone={invalid.length ? "bad" : undefined} />
            </div>

            {dupRows.length > 0 && (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">How should duplicates be handled?</p>
                <p className="text-xs text-muted-foreground">A duplicate has the same student name, parent phone and academic year. Siblings (same phone, different name) are not duplicates.</p>
                <RadioGroup value={dupMode} onValueChange={(v) => setDupMode(v as DupMode)} className="space-y-1">
                  <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="skip" />Skip duplicates (safest)</label>
                  <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="update" />Fill in blank details on existing leads (never overwrites what's already saved, never changes status)</label>
                  <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="review" />Let me decide row by row</label>
                </RadioGroup>
              </div>
            )}

            <ScrollArea className="h-72 rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Student</TableHead><TableHead>Class</TableHead><TableHead>Phone</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
                <TableBody>
                  {previewRows.map((r) => {
                    const d = dups.get(r.rowNum);
                    const isDup = r.payload && d && d.kind !== "none";
                    return (
                      <TableRow key={r.rowNum}>
                        <TableCell>{r.rowNum}</TableCell>
                        <TableCell className="max-w-40 truncate">{r.payload?.full_name ?? r.cells[mapping.student_name ?? -1] ?? ""}</TableCell>
                        <TableCell>{r.cells[mapping.class ?? -1] ?? ""}</TableCell>
                        <TableCell>{r.cells[mapping.parent_phone ?? -1] ?? ""}</TableCell>
                        <TableCell className="min-w-56 text-xs">
                          {!r.payload && <span className="flex items-start gap-1 text-red-700"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{r.errors.join("; ")}</span>}
                          {r.payload && !isDup && <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Ready{r.warnings.length ? ` · ${r.warnings[0]}` : ""}</span>}
                          {isDup && (
                            <span className="flex flex-wrap items-center gap-2 text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />
                              {d!.kind === "existing" ? "Already in Admissions" : `Same as row ${d!.firstRow}`}
                              {dupMode === "review" && (
                                <Select value={choices[r.rowNum] ?? "skip"} onValueChange={(v) => setChoices((c) => ({ ...c, [r.rowNum]: v as RowChoice }))}>
                                  <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="skip">Skip</SelectItem>
                                    {d!.kind === "existing" && <SelectItem value="update">Fill blanks</SelectItem>}
                                    <SelectItem value="new">Import as new</SelectItem>
                                  </SelectContent>
                                </Select>)}
                            </span>)}
                        </TableCell>
                      </TableRow>);
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
            {results.length > 50 && <Button variant="link" size="sm" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show first 50 rows" : `Show all ${results.length} rows`}</Button>}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep("map")}>← Back to column mapping</Button>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">{plan.ins.length} to add{plan.upd.length ? `, ${plan.upd.length} to update` : ""}, {plan.skip + invalid.length} skipped</span>
                <Button disabled={plan.ins.length + plan.upd.length === 0} onClick={() => setConfirm(true)}>Import</Button>
              </div>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="space-y-4 py-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin" />
            <p className="text-sm">Importing {progress.done} of {progress.total}… please keep this window open.</p>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} aria-label="Import progress" />
          </div>
        )}

        {step === "done" && summary && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Tile label="Total rows" value={summary.total} />
              <Tile label="Imported" value={summary.imported} tone="good" />
              <Tile label="Updated" value={summary.updated} />
              <Tile label="Skipped duplicates" value={summary.skipped} tone={summary.skipped ? "warn" : undefined} />
              <Tile label="Invalid" value={summary.invalid} tone={summary.invalid ? "bad" : undefined} />
              <Tile label="Failed" value={summary.failed} tone={summary.failed ? "bad" : undefined} />
            </div>
            {summary.failedRows.length > 0 && (
              <Button variant="outline" onClick={downloadFailed}><Download className="mr-1 h-4 w-4" />Download the {summary.failedRows.length} rows that need fixing</Button>
            )}
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={reset}>Import another file</Button><Button onClick={() => close(false)}>Done</Button></div>
          </div>
        )}

        <AlertDialog open={confirm} onOpenChange={setConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Import these leads?</AlertDialogTitle>
              <AlertDialogDescription>{plan.ins.length} new lead(s) will be added{plan.upd.length ? ` and ${plan.upd.length} existing lead(s) will have blank details filled in` : ""}. {plan.skip + invalid.length} row(s) will be skipped. Imported leads can't be undone in bulk.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Go back</AlertDialogCancel><AlertDialogAction onClick={() => void doImport()}>Import</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className={cn("rounded-lg border p-3 text-center", tone === "good" && "border-emerald-300 bg-emerald-50", tone === "warn" && "border-amber-300 bg-amber-50", tone === "bad" && "border-red-300 bg-red-50")}>
      <p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p>
    </div>
  );
}
