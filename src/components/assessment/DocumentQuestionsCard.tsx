// "Questions from a document" on the Item Bank page. The file is read in this browser and never uploaded: only its text
// goes to the AI, one piece at a time, so a long document works without hitting the server's time limit.
// Everything lands as a draft for the teacher to review in the Item Bank below.

import { useRef, useState } from "react";
import { FileUp, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { DOC_ACCEPT, DOC_LIMITS, planDocumentBatches, readDocumentText, type DocumentText } from "@/lib/documentText";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";
import { localizeServerMessage } from "@/lib/serverMessages";

const CONCURRENT_CALLS = 3;

export function DocumentQuestionsCard({ chapterId, chapterName, onGenerated }: { chapterId: number; chapterName: string; onGenerated: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<DocumentText | null>(null);
  const [reading, setReading] = useState(false);
  const [count, setCount] = useState(30);
  const [difficulty, setDifficulty] = useState("mixed");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const read = await readDocumentText(file);
      setDoc(read);
      if (read.truncated) toast.warning(`Only the first ${DOC_LIMITS.maxChars.toLocaleString()} characters of this document will be used.`);
    } catch (e) {
      setDoc(null);
      toast.error(e instanceof Error ? localizeServerMessage(e.message) : "That file couldn't be read.");
    } finally {
      setReading(false);
    }
  };

  const generate = async () => {
    if (!doc) return;
    const batches = planDocumentBatches(doc.text, count);
    setProgress({ done: 0, total: batches.length });
    let inserted = 0, flagged = 0, done = 0, nextIndex = 0;
    let firstError: string | null = null;

    const worker = async () => {
      while (nextIndex < batches.length && !firstError) {
        const batch = batches[nextIndex++];
        try {
          const { data, error } = await supabase.functions.invoke("generate-item-bank", {
            body: { action: "from_document", chapter_id: chapterId, document_text: batch.chunk, count: batch.count, difficulty },
          });
          if (error) throw new Error((await unwrapFunctionError(error, "The AI request failed.")).message);
          if (data?.error) throw new Error(data.error);
          inserted += data.inserted ?? 0;
          flagged += data.held_for_key_review ?? 0;
        } catch (e) {
          firstError = e instanceof Error ? localizeServerMessage(e.message) : "The AI request failed.";
        }
        done++;
        setProgress({ done, total: batches.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENT_CALLS, batches.length) }, worker));
    setProgress(null);

    if (inserted > 0) {
      toast.success(`${inserted} draft question${inserted === 1 ? "" : "s"} saved for ${chapterName}`, {
        description: `Open a topic in this chapter to review and approve them.${flagged ? ` ${flagged} flagged because the answer key needs checking.` : ""}`,
      });
      onGenerated();
    }
    if (firstError) {
      toast.error(inserted > 0 ? `Stopped early: ${firstError}` : firstError);
    } else if (inserted === 0) {
      toast.info("The AI couldn't write questions from this document. Check that it's about this chapter.");
    }
  };

  const busy = !!progress;

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileUp className="h-4 w-4 text-indigo-600" /> Questions from a document</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Upload a PDF, Word or PowerPoint file. The AI writes multiple choice questions only from its content, and tags each one to a learning objective of <strong>{chapterName}</strong>. They stay as drafts until you approve them.
        </p>
        <input ref={fileRef} type="file" accept={DOC_ACCEPT} className="hidden" aria-label="Document" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        {doc ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border p-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{doc.name}</p>
              <p className="text-xs text-muted-foreground">{doc.note}{doc.truncated ? ", trimmed to fit" : ""}</p>
            </div>
            <Button size="icon" variant="ghost" className="shrink-0" aria-label="Remove document" disabled={busy} onClick={() => setDoc(null)}><X className="h-4 w-4" /></Button>
          </div>
        ) : (
          <Button variant="outline" className="w-full" disabled={reading} onClick={() => fileRef.current?.click()}>
            {reading ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <FileUp className="h-4 w-4 me-1.5" />}
            {reading ? "Reading the document..." : "Choose a document"}
          </Button>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="doc-count" className="text-xs text-muted-foreground">Number of questions</label>
            <Input id="doc-count" type="number" min={1} max={DOC_LIMITS.maxQuestions} value={count} className="h-8"
              onChange={(e) => setCount(Math.min(DOC_LIMITS.maxQuestions, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Difficulty</label>
            <Select value={difficulty} onValueChange={setDifficulty}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mixed">Mixed</SelectItem>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button className="w-full" disabled={!doc || busy} onClick={generate}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <Sparkles className="h-4 w-4 me-1.5" />}
          {progress ? `Writing questions... part ${progress.done} of ${progress.total}` : "Generate questions"}
        </Button>
      </CardContent>
    </Card>
  );
}
