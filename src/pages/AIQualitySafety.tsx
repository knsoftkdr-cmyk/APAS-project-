// src/pages/AIQualitySafety.tsx  (route /ai-quality-safety)
//
// AI quality and safety control (sheet row 40). Every AI answer students see can be scored on five dimensions -
// accuracy (hallucination), bias, content alignment, privacy and age suitability - by an AI evaluator plus fixed
// rules (personal data, unsafe terms). AI Tutor and Voice Tutor replies are sampled automatically; staff can also
// paste any AI output here to check it before using it in class.
import { useState } from "react";
import { AlertOctagon, CheckCircle2, Loader2, ShieldCheck, ShieldAlert, TriangleAlert } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  QUALITY_DIMENSIONS, useEvaluateContent, useQualityList, useReviewEvaluation,
  type EvaluateResult, type QualityEvaluation, type Verdict,
} from "@/hooks/useAiQuality";

const VERDICT_STYLE: Record<Verdict, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  pass: { label: "Pass", cls: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: CheckCircle2 },
  warn: { label: "Review", cls: "bg-amber-100 text-amber-800 border-amber-200", icon: TriangleAlert },
  block: { label: "Blocked", cls: "bg-red-100 text-red-800 border-red-200", icon: AlertOctagon },
};
const SOURCE_LABEL: Record<string, string> = { ai_tutor: "AI Tutor", voice_tutor: "Voice Tutor", manual: "Manual check" };

const scoreColor = (v: number | null) => v == null ? "text-muted-foreground" : v < 40 ? "text-red-600" : v < 70 ? "text-amber-600" : "text-emerald-600";

function VerdictBadge({ v }: { v: Verdict }) {
  const s = VERDICT_STYLE[v];
  return <Badge variant="outline" className={`gap-1 ${s.cls}`}><s.icon className="h-3 w-3" />{s.label}</Badge>;
}

function ScoreBars({ scores }: { scores: Partial<Record<string, number | null>> }) {
  return (
    <div className="space-y-1.5">
      {QUALITY_DIMENSIONS.map((d) => {
        const v = scores[d.key] ?? null;
        return (
          <div key={d.key} className="flex items-center gap-2 text-xs">
            <span className="w-44 shrink-0 text-muted-foreground">{d.label}</span>
            <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
              <div className={`h-full ${v == null ? "" : v < 40 ? "bg-red-500" : v < 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${v ?? 0}%` }} />
            </div>
            <span className={`w-8 text-right tabular-nums font-medium ${scoreColor(v)}`}>{v ?? "–"}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function AIQualitySafety() {
  const [verdict, setVerdict] = useState("all");
  const [source, setSource] = useState("all");
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useQualityList({ verdict, source, days });
  const evaluate = useEvaluateContent();
  const review = useReviewEvaluation();

  const [content, setContent] = useState("");
  const [question, setQuestion] = useState("");
  const [reference, setReference] = useState("");
  const [gradeBand, setGradeBand] = useState("");
  const [subject, setSubject] = useState("");
  const [result, setResult] = useState<EvaluateResult | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function onEvaluate() {
    try {
      setResult(await evaluate.mutateAsync({
        content: content.trim(), question: question.trim() || undefined, reference: reference.trim() || undefined,
        grade_band: gradeBand.trim() || undefined, subject: subject.trim() || undefined,
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Evaluation failed");
    }
  }

  const s = data?.summary;

  return (
    <AppLayout>
      <div className="p-3 sm:p-4 md:p-6 space-y-4 max-w-6xl mx-auto pb-24 md:pb-6">
        <div className="rounded-2xl p-5 bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><ShieldCheck className="h-5 w-5" /></div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold">AI Quality & Safety</h1>
              <p className="text-emerald-50 text-xs md:text-sm">Checks AI answers for hallucinations, bias, curriculum alignment, privacy and age suitability.</p>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Checked (last {days} days)</p><p className="text-2xl font-semibold">{s?.total ?? "–"}</p></CardContent></Card>
          {(["pass", "warn", "block"] as Verdict[]).map((v) => (
            <Card key={v}><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{VERDICT_STYLE[v].label}</p>
              <p className="text-2xl font-semibold">{s?.by_verdict[v] ?? "–"}
                {s?.total ? <span className="text-xs font-normal text-muted-foreground ml-1">{Math.round(((s.by_verdict[v] ?? 0) / s.total) * 100)}%</span> : null}</p>
            </CardContent></Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Manual check */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Check AI output</CardTitle>
              <CardDescription className="text-xs">Paste a lesson, worksheet or answer an AI wrote. Add the question and source text for a stricter accuracy check.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1"><Label className="text-xs">AI output *</Label><Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste the AI-generated text…" /></div>
              <div className="space-y-1"><Label className="text-xs">Question asked (optional)</Label><Input value={question} onChange={(e) => setQuestion(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Reference / textbook text (optional)</Label><Textarea rows={3} value={reference} onChange={(e) => setReference(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">Class / age</Label><Input value={gradeBand} onChange={(e) => setGradeBand(e.target.value)} placeholder="Class 5" /></div>
                <div className="space-y-1"><Label className="text-xs">Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Science" /></div>
              </div>
              <Button onClick={onEvaluate} disabled={content.trim().length < 5 || evaluate.isPending} className="gap-1.5">
                {evaluate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Evaluate
              </Button>
              {result && (
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between"><VerdictBadge v={result.verdict} /><span className={`text-sm font-semibold ${scoreColor(result.overall)}`}>Overall {result.overall ?? "–"}</span></div>
                  {result.scores ? <ScoreBars scores={result.scores} /> : <p className="text-xs text-muted-foreground">AI evaluator unavailable - only rule checks ran.</p>}
                  {result.issues.length > 0 && <ul className="text-xs space-y-1 list-disc pl-4">{result.issues.map((i, k) => <li key={k}><span className="font-medium capitalize">{i.dimension.replace("_", " ")}</span> ({i.severity}): {i.detail}</li>)}</ul>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Averages + log */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Average scores</CardTitle></CardHeader>
              <CardContent>{isLoading ? <Skeleton className="h-28" /> : s ? <ScoreBars scores={s.averages} /> : null}</CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 space-y-2">
                <CardTitle className="text-sm">Evaluation log</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Select value={verdict} onValueChange={setVerdict}>
                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All verdicts</SelectItem><SelectItem value="block">Blocked</SelectItem><SelectItem value="warn">Review</SelectItem><SelectItem value="pass">Pass</SelectItem></SelectContent>
                  </Select>
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      {(s?.sources ?? []).map((x) => <SelectItem key={x} value={x}>{SOURCE_LABEL[x] ?? x}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                    <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>{[7, 30, 90].map((d) => <SelectItem key={d} value={String(d)}>Last {d} days</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading ? <Skeleton className="h-40" />
                  : error ? <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Could not load evaluations"}</p>
                  : !data?.rows.length ? <p className="text-sm text-muted-foreground">No evaluations yet. AI Tutor replies are checked automatically as students use it.</p>
                  : data.rows.map((r: QualityEvaluation) => (
                    <div key={r.id} className="rounded-lg border p-3 text-sm">
                      <button type="button" className="w-full text-left" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                        <div className="flex flex-wrap items-center gap-2">
                          <VerdictBadge v={r.verdict} />
                          <span className="text-xs text-muted-foreground">{SOURCE_LABEL[r.source] ?? r.source} · {new Date(r.created_at).toLocaleString()}</span>
                          {r.reviewed_at && <Badge variant="secondary" className="text-[10px]">Reviewed</Badge>}
                          <span className={`ml-auto text-xs font-semibold ${scoreColor(r.overall_score)}`}>{r.overall_score ?? "–"}</span>
                        </div>
                        <p className={`mt-1.5 text-xs text-muted-foreground ${openId === r.id ? "whitespace-pre-wrap" : "line-clamp-2"}`}>{r.content_excerpt}</p>
                      </button>
                      {openId === r.id && (
                        <div className="mt-2 space-y-2">
                          <ScoreBars scores={{ hallucination: r.score_hallucination, bias: r.score_bias, alignment: r.score_alignment, privacy: r.score_privacy, age_suitability: r.score_age_suitability }} />
                          {r.issues.length > 0 && <ul className="text-xs space-y-1 list-disc pl-4">{r.issues.map((i, k) => <li key={k}><span className="font-medium capitalize">{i.dimension.replace("_", " ")}</span> ({i.severity}): {i.detail}</li>)}</ul>}
                          {!r.reviewed_at && r.verdict !== "pass" && (
                            <Button size="sm" variant="outline" className="gap-1" disabled={review.isPending}
                              onClick={() => review.mutate({ id: r.id }, { onSuccess: () => toast.success("Marked as reviewed"), onError: (e) => toast.error(e instanceof Error ? e.message : "Failed") })}>
                              <ShieldAlert className="h-3.5 w-3.5" /> Mark reviewed
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
