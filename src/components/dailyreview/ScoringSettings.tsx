import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Save, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useDailyReviewScoring, useSaveDailyReviewScoring, type ScoringConfig, type ScoringRules } from "@/hooks/useSpacedRepetition";
import { useAdaptiveTestScoring, useSaveAdaptiveTestScoring } from "@/hooks/useAdaptiveTestScoring";
import { exampleScore, validateRules } from "../../../supabase/functions/_shared/dailyReviewScoring";

/**
 * Daily Review scoring rules. Shown inside the Daily Review page to the principal only
 * (the server enforces it too). Applies to this school's Daily Review only: Adaptive Tests have their own rules and
 * regular assessments, quizzes, tests and exams are not affected.
 */
export function ScoringSettings() {
  const query = useDailyReviewScoring();
  const save = useSaveDailyReviewScoring();
  return <RulesEditor query={query} save={save} copy={DAILY_REVIEW_COPY} />;
}

/**
 * Adaptive Test scoring rules, shown inside the Adaptive Test page to the same admin roles. Marks are an extra on top of
 * the test: the ability estimate, scaled score and band are not changed.
 */
export function AdaptiveTestScoringSettings() {
  const query = useAdaptiveTestScoring();
  const save = useSaveAdaptiveTestScoring();
  return <RulesEditor query={query} save={save} copy={ADAPTIVE_TEST_COPY} />;
}

interface Copy { testId: string; title: string; intro: string; saved: (on: boolean) => string; notes: string[] }

const DAILY_REVIEW_COPY: Copy = {
  testId: "scoring-settings",
  title: "Daily Review scoring",
  intro: "Choose how Daily Review answers are marked for your school. This applies to Daily Review only - Adaptive Tests have their own rules, and assessments, quizzes, tests and exams are not affected. Spaced-repetition scheduling is not changed.",
  saved: (on) => (on ? "Negative marking is on for Daily Review." : "Negative marking is off for Daily Review."),
  notes: [
    'A skipped ("Remind me tomorrow") or unanswered question is always 0 marks.',
    "Deductions can't be more than the marks for a correct answer.",
    "Each question is marked once; changing the rules affects new answers only.",
    "These rules apply to every class in your school.",
  ],
};

const ADAPTIVE_TEST_COPY: Copy = {
  testId: "adaptive-scoring-settings",
  title: "Adaptive Test scoring",
  intro: "Choose how Adaptive Test answers are marked for your school. This applies to Adaptive Tests only - Daily Review has its own rules, and assessments, quizzes, tests and exams are not affected. The test still measures ability the same way: the scaled score, band and which questions come next do not change.",
  saved: (on) => (on ? "Negative marking is on for Adaptive Tests." : "Negative marking is off for Adaptive Tests."),
  notes: [
    "Marks are shown in addition to the ability score. A question that isn't answered is 0 marks.",
    "Deductions can't be more than the marks for a correct answer.",
    "A test keeps the rules it started with; changing them affects tests started afterwards.",
    "These rules apply to every class in your school.",
  ],
};

interface EditorProps {
  query: { data?: ScoringConfig; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  save: { mutateAsync: (rules: ScoringRules) => Promise<unknown>; isPending: boolean };
  copy: Copy;
}

function RulesEditor({ query, save, copy }: EditorProps) {
  const { data, isLoading, isError, error, refetch } = query;

  const [enabled, setEnabled] = useState(false);
  const [correct, setCorrect] = useState("1");
  const [wrong, setWrong] = useState("0.25");

  useEffect(() => {
    if (!data) return;
    setEnabled(data.rules.enabled);
    setCorrect(String(data.rules.marks_per_correct));
    setWrong(String(data.rules.negative_marks_per_wrong));
  }, [data]);

  if (isLoading) return <Card><CardContent className="p-6"><Skeleton className="h-40 w-full" /></CardContent></Card>;
  if (isError || !data) {
    return (
      <Card><CardContent className="p-8 text-center space-y-3">
        <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
        <p className="font-medium">Couldn't load the scoring rules</p>
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Something went wrong."}</p>
        <Button variant="outline" onClick={() => refetch()}>Try again</Button>
      </CardContent></Card>
    );
  }

  const check = validateRules({ enabled, marks_per_correct: correct, negative_marks_per_wrong: wrong });
  const dirty = data.rules.enabled !== enabled
    || String(data.rules.marks_per_correct) !== String(Number(correct))
    || String(data.rules.negative_marks_per_wrong) !== String(Number(wrong));
  const canEdit = data.can_edit;

  const onSave = async () => {
    if (!check.ok) return;
    try {
      await save.mutateAsync(check.rules);
      toast.success(copy.saved(check.rules.enabled));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the rules.");
    }
  };

  return (
    <Card data-testid={copy.testId}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" /> {copy.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{copy.intro}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {!canEdit && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Your account can't change these rules (only a principal can, and your account must be linked to a school).</p>}

        <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
          <div>
            <Label htmlFor={`nm-enabled-${copy.testId}`} className="font-medium">Negative marking</Label>
            <p className="text-xs text-muted-foreground">Off: Daily Review works as it always has, with no marks shown.</p>
          </div>
          <Switch id={`nm-enabled-${copy.testId}`} checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="nm-correct">Marks for a correct answer</Label>
            <Input id="nm-correct" type="number" inputMode="decimal" min="0.01" max="10" step="0.25" value={correct} onChange={(e) => setCorrect(e.target.value)} disabled={!canEdit || !enabled} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nm-wrong">Marks deducted for a wrong answer</Label>
            <Input id="nm-wrong" type="number" inputMode="decimal" min="0" max="10" step="0.25" value={wrong} onChange={(e) => setWrong(e.target.value)} disabled={!canEdit || !enabled} />
            <p className="text-xs text-muted-foreground">Enter the amount to take away (e.g. 0.25), not a minus number. 0 means wrong answers cost nothing.</p>
          </div>
        </div>

        <ul className="text-xs text-muted-foreground list-disc ps-5 space-y-0.5">
          {copy.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>

        {enabled && check.ok && (
          <p className="text-sm rounded-lg bg-primary/5 border border-primary/20 p-3" data-testid="scoring-example">Example - {exampleScore(check.rules).text}</p>
        )}
        {"error" in check && enabled && <p className="text-sm text-destructive" role="alert">{check.error}</p>}

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!canEdit || !dirty || (enabled && !check.ok) || save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Save className="h-4 w-4 me-1" />} Save rules
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
