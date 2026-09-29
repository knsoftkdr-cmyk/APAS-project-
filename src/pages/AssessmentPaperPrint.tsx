// src/pages/AssessmentPaperPrint.tsx
//
// Printable / PDF-export view for a paper assembled by generate-assessment-paper.
//
// Deliberately renders to a print stylesheet + window.print() rather than
// generating a PDF on the server: this app has no server-side PDF renderer,
// and every OS/browser already ships one via "Print -> Save as PDF" - so
// this gets a real, well-formatted PDF with zero new backend dependencies.
// If a literal file artifact (not just a save-as-PDF dialog) is ever needed,
// the same JSON this page renders (from get-assessment-paper-full) is what
// a future server-side renderer would consume - nothing here would need to
// change.
//
// Route (add to src/App.tsx, same pattern as ItemBankReview):
//   const AssessmentPaperPrint = lazy(() => import("./pages/AssessmentPaperPrint"));
//   <Route path="/assessment-paper-print" element={<ProtectedRoute><RoleGuard allowedRoles={["admin","teacher","principal","hod","school_admin"]}><AssessmentPaperPrint /></RoleGuard></ProtectedRoute>} />
//
// Link to it with ?paper_id=<uuid>, e.g. from wherever a paper's row/card is
// shown after generate-assessment-paper returns its id.

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Printer, Key } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────
interface SubQuestion { id: string; text: string; max_marks: number }
interface RubricCriterion { criterion: string; description?: string; max_marks: number; sub_question_id?: string }
interface PaperItem {
  order_index: number;
  section_label: string;
  marks: number;
  question_type: string;
  stem: string;
  options?: Record<string, string>;
  context_passage?: string | null;
  sub_questions?: SubQuestion[];
  correct_option?: string;
  explanation?: string | null;
  rubric?: RubricCriterion[];
  model_answer?: string | null;
}
interface Section { label: string; items: PaperItem[] }
interface PaperPayload {
  paper: { id: string; title: string; total_marks: number; duration_minutes: number | null; status: string };
  include_answer_key: boolean;
  sections: Section[];
}

async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const { message } = await unwrapFunctionError(error, "That request failed.");
    throw new Error(message);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
  return data as T;
}

const OPTION_ORDER = ["A", "B", "C", "D"] as const;

export default function AssessmentPaperPrint() {
  const [searchParams] = useSearchParams();
  const paperId = searchParams.get("paper_id");

  const [includeKey, setIncludeKey] = useState(false);
  const [data, setData] = useState<PaperPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!paperId) return;
    setLoading(true);
    setError(null);
    invokeFn<PaperPayload>("evaluate-assessment", { action: "get_paper_full", paper_id: paperId, include_answer_key: includeKey })
      .then(setData)
      .catch((e: Error) => { setError(e.message); toast.error(e.message); })
      .finally(() => setLoading(false));
  }, [paperId, includeKey]);

  if (!paperId) {
    return (
      <AppLayout>
        <div className="p-6">
          <p className="text-muted-foreground">No paper selected - open this page with ?paper_id=&lt;id&gt; from the generated paper's list.</p>
        </div>
      </AppLayout>
    );
  }

  let itemNumber = 0;

  return (
    <AppLayout>
      {/* Print stylesheet: hide app chrome, let only #printable-paper show, one section flow. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable-paper, #printable-paper * { visibility: visible; }
          #printable-paper { position: absolute; inset: 0; width: 100%; margin: 0; padding: 24px; }
          .no-print { display: none !important; }
          .print-question { break-inside: avoid; }
        }
      `}</style>

      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div className="no-print flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="answer-key-toggle">Include answer key</Label>
            <Switch id="answer-key-toggle" checked={includeKey} onCheckedChange={setIncludeKey} />
          </div>
          <Button onClick={() => window.print()} disabled={!data}>
            <Printer className="h-4 w-4 mr-2" /> Print / Save as PDF
          </Button>
        </div>

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {error && <p className="text-destructive">{error}</p>}

        {data && (
          <Card id="printable-paper">
            <CardHeader className="text-center border-b">
              <CardTitle className="text-2xl">{data.paper.title}</CardTitle>
              <div className="flex justify-center gap-6 text-sm text-muted-foreground pt-2">
                <span>Total Marks: {data.paper.total_marks}</span>
                {data.paper.duration_minutes != null && <span>Duration: {data.paper.duration_minutes} minutes</span>}
                {data.include_answer_key && <span className="font-semibold text-foreground">ANSWER KEY COPY</span>}
              </div>
            </CardHeader>
            <CardContent className="space-y-8 pt-6">
              {data.sections.map((section) => (
                <div key={section.label} className="space-y-4">
                  <h3 className="font-semibold text-base border-b pb-1">{section.label}</h3>
                  {section.items.map((item) => {
                    itemNumber += 1;
                    return <QuestionBlock key={item.order_index} number={itemNumber} item={item} showKey={data.include_answer_key} />;
                  })}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

function QuestionBlock({ number, item, showKey }: { number: number; item: PaperItem; showKey: boolean }) {
  return (
    <div className="print-question space-y-2 text-sm">
      <div className="flex justify-between gap-4">
        <p className="font-medium">
          {number}. {item.stem}
        </p>
        <span className="text-muted-foreground whitespace-nowrap">[{item.marks} marks]</span>
      </div>

      {item.context_passage && (
        <div className="ml-5 p-2 border-l-2 border-muted bg-muted/30 italic text-muted-foreground">{item.context_passage}</div>
      )}

      {item.question_type === "mcq" && item.options && (
        <div className="ml-5 grid grid-cols-2 gap-1">
          {OPTION_ORDER.map((letter) => (
            <span key={letter} className={showKey && item.correct_option === letter ? "font-semibold text-emerald-700" : ""}>
              ({letter}) {item.options?.[letter]}
              {showKey && item.correct_option === letter && " ✓"}
            </span>
          ))}
        </div>
      )}

      {!!item.sub_questions?.length && (
        <ol className="ml-5 list-[lower-alpha] space-y-1">
          {item.sub_questions.map((sq) => (
            <li key={sq.id}>
              {sq.text} <span className="text-muted-foreground">[{sq.max_marks}m]</span>
            </li>
          ))}
        </ol>
      )}

      {showKey && item.explanation && <p className="ml-5 text-muted-foreground">Explanation: {item.explanation}</p>}

      {showKey && item.model_answer && (
        <div className="ml-5 p-2 border border-dashed rounded text-muted-foreground">
          <span className="font-medium text-foreground">Model answer: </span>
          {item.model_answer}
        </div>
      )}
      {showKey && !!item.rubric?.length && (
        <ul className="ml-5 list-disc text-muted-foreground">
          {item.rubric.map((c, i) => (
            <li key={i}>
              {c.criterion} {c.description ? `- ${c.description}` : ""} [{c.max_marks}m]
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
