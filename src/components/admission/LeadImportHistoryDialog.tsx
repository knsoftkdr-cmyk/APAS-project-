import { useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveFile } from "@/lib/leadFiles";
import { buildCsv } from "@/lib/leadImport";
import { useImportHistory, type ImportJobRow } from "@/hooks/useLeadImport";

const STATUS_LABEL: Record<string, string> = { completed: "Completed", completed_with_errors: "With errors", failed: "Failed" };

export function LeadImportHistoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useImportHistory(open);
  const [sel, setSel] = useState<ImportJobRow | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setSel(null); onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>Import history</DialogTitle><DialogDescription>Counts and error messages only. Uploaded files and personal details are not kept.</DialogDescription></DialogHeader>
        {q.isLoading && <Skeleton className="h-40 w-full" />}
        {q.error && <p className="text-sm text-red-600">{(q.error as Error).message}</p>}
        {q.data?.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No imports yet.</p>}
        {q.data && q.data.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>File</TableHead><TableHead>By</TableHead><TableHead>Date</TableHead><TableHead>Rows</TableHead><TableHead>Imported</TableHead><TableHead>Skipped</TableHead><TableHead>Failed</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {q.data.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="max-w-44 truncate font-medium">{j.file_name}</TableCell>
                    <TableCell>{j.importer?.full_name ?? "—"}</TableCell>
                    <TableCell>{new Date(j.created_at).toLocaleString()}</TableCell>
                    <TableCell>{j.total_rows}</TableCell>
                    <TableCell>{j.imported_count}{j.updated_count ? ` (+${j.updated_count} updated)` : ""}</TableCell>
                    <TableCell>{j.skipped_duplicates}</TableCell>
                    <TableCell>{j.invalid_count + j.failed_count}</TableCell>
                    <TableCell><Badge variant={j.status === "completed" ? "default" : "secondary"}>{STATUS_LABEL[j.status] ?? j.status}</Badge></TableCell>
                    <TableCell>{j.error_report.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSel(j)}>Errors</Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {sel && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between"><p className="text-sm font-medium">Errors in {sel.file_name}</p>
              <Button size="sm" variant="outline" onClick={() => void saveFile("APAS_Lead_Import_Errors.csv", { text: buildCsv(["Row", "Error"], sel.error_report.map((e) => [e.row, e.message])) }, "Import errors")}><Download className="mr-1 h-4 w-4" />Download</Button></div>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">{sel.error_report.map((e, i) => <li key={i}><span className="text-muted-foreground">Row {e.row}:</span> {e.message}</li>)}</ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
