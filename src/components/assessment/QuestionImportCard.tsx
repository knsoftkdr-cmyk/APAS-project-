// "Import questions" on the Item Bank page: a teacher's existing MCQs from a CSV, Excel, Word or PDF file go into this
// chapter's question bank in bulk. The file is read in this browser; only the questions are sent, a batch at a time,
// and the AI tags each one with a learning objective, difficulty and thinking level. Everything lands as a draft.

import { useRef, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";
import { localizeServerMessage } from "@/lib/serverMessages";
import { IMPORT_ACCEPT, IMPORT_BATCH, IMPORT_DOC_EXAMPLE, IMPORT_TEMPLATE_CSV, readQuestionFile, type ImportParseResult } from "@/lib/questionImport";

const CONCURRENT_CALLS = 2;

export function QuestionImportCard({ chapterId, chapterName, onImported }: { chapterId: number; chapterName: string; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ImportParseResult | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const reset = () => { setFileName(null); setParsed(null); };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const result = await readQuestionFile(file);
      setFileName(file.name);
      setParsed(result);
      if (!result.questions.length) toast.error("No questions could be read from this file. See the problems listed below.");
    } catch (e) {
      reset();
      toast.error(e instanceof Error ? localizeServerMessage(e.message) : "That file couldn't be read.");
    } finally {
      setReading(false);
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob(["﻿" + IMPORT_TEMPLATE_CSV], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "question-import-template.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const runImport = async () => {
    if (!parsed?.questions.length) return;
    const qs = parsed.questions;
    const batches: typeof qs[] = [];
    for (let i = 0; i < qs.length; i += IMPORT_BATCH) batches.push(qs.slice(i, i + IMPORT_BATCH));
    setProgress({ done: 0, total: batches.length });
    let inserted = 0, duplicates = 0, flagged = 0, untagged = 0, rejected = 0, done = 0, next = 0;
    let firstError: string | null = null;

    const worker = async () => {
      while (next < batches.length && !firstError) {
        const batch = batches[next++];
        try {
          const { data, error } = await supabase.functions.invoke("generate-item-bank", {
            body: {
              action: "bulk_import", chapter_id: chapterId,
              items: batch.map(({ stem, options, correct, explanation, difficulty, topic_hint }) => ({ stem, options, correct, explanation, difficulty, topic_hint })),
            },
          });
          if (error) throw new Error((await unwrapFunctionError(error, "The import request failed.")).message);
          if (data?.error) throw new Error(data.error);
          inserted += data.inserted ?? 0;
          duplicates += data.skipped_duplicates ?? 0;
          flagged += data.held_for_key_review ?? 0;
          untagged += data.untagged ?? 0;
          rejected += Array.isArray(data.rejected) ? data.rejected.length : 0;
        } catch (e) {
          firstError = e instanceof Error ? localizeServerMessage(e.message) : "The import request failed.";
        }
        done++;
        setProgress({ done, total: batches.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENT_CALLS, batches.length) }, worker));
    setProgress(null);

    if (inserted > 0) {
      const notes = [
        duplicates ? `${duplicates} already in the bank, skipped.` : "",
        flagged ? `${flagged} flagged because the answer key needs checking.` : "",
        untagged ? `${untagged} couldn't be matched to a learning objective. Please check them.` : "",
        rejected ? `${rejected} couldn't be saved.` : "",
      ].filter(Boolean).join(" ");
      toast.success(inserted === 1 ? `1 question imported as a draft for ${chapterName}` : `${inserted} questions imported as drafts for ${chapterName}`, {
        description: `Open a topic in this chapter to review and approve them. ${notes}`.trim(),
      });
      onImported();
      reset();
    } else if (!firstError) {
      toast.info(duplicates ? "All of these questions are already in the bank." : "No questions were imported.");
    }
    if (firstError) toast.error(inserted > 0 ? `Stopped early: ${firstError}` : firstError);
  };

  const busy = !!progress;
  const count = parsed?.questions.length ?? 0;
  const problems = parsed?.problems ?? [];

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Import questions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Bring in your own multiple choice questions from a CSV, Excel, Word or PDF file. The AI tags each one to a learning objective of <strong>{chapterName}</strong> with a difficulty and thinking level, and checks the answer key. They stay as drafts until you approve them.
        </p>
        <input ref={fileRef} type="file" accept={IMPORT_ACCEPT} className="hidden" aria-label="Question file" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        {fileName ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border p-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{fileName}</p>
              <p className="text-xs text-muted-foreground">
                {count === 1 ? "1 question ready" : `${count} questions ready`}
                {problems.length > 0 && <> · {problems.length === 1 ? "1 problem" : `${problems.length} problems`}</>}
              </p>
            </div>
            <Button size="icon" variant="ghost" className="shrink-0" aria-label="Remove file" disabled={busy} onClick={reset}><X className="h-4 w-4" /></Button>
          </div>
        ) : (
          <Button variant="outline" className="w-full" disabled={reading} onClick={() => fileRef.current?.click()}>
            {reading ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <Upload className="h-4 w-4 me-1.5" />}
            {reading ? "Reading the file..." : "Choose a file"}
          </Button>
        )}

        {problems.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 p-2 text-xs space-y-1">
            <p className="font-medium flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> These won't be imported:</p>
            <ul className="space-y-0.5 max-h-32 overflow-y-auto">
              {problems.slice(0, 50).map((p, i) => <li key={i}><span className="font-medium">{p.where}:</span> {p.message}</li>)}
            </ul>
            {problems.length > 50 && <p className="text-muted-foreground">{`and ${problems.length - 50} more`}</p>}
          </div>
        )}

        <Button className="w-full" disabled={!count || busy} onClick={runImport}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <Upload className="h-4 w-4 me-1.5" />}
          {progress ? `Importing... part ${progress.done} of ${progress.total}` : count === 1 ? "Import 1 question" : count ? `Import ${count} questions` : "Import questions"}
        </Button>

        <Collapsible>
          <CollapsibleTrigger className="text-xs underline text-muted-foreground">File format</CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2 text-xs text-muted-foreground">
            <p><strong>CSV or Excel:</strong> one question per row with the columns question, option_a, option_b, option_c, option_d, answer. Optional: explanation, difficulty (easy, medium, hard), topic.</p>
            <Button size="sm" variant="outline" className="h-7" onClick={downloadTemplate}><Download className="h-3.5 w-3.5 me-1" /> Download CSV template</Button>
            <p><strong>Word, PDF or text:</strong> number each question, put options on lines starting A) B) C) D), then the answer:</p>
            <pre dir="ltr" className="rounded bg-muted p-2 whitespace-pre-wrap text-[11px]">{IMPORT_DOC_EXAMPLE}</pre>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
