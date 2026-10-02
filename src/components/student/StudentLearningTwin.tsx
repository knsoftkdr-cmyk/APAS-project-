import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchStudentTwin } from "@/lib/studentTwin";

const riskStyle = {
  low: "bg-green-100 text-green-800 hover:bg-green-100",
  medium: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  high: "bg-red-100 text-red-800 hover:bg-red-100",
  unknown: "bg-gray-100 text-gray-600 hover:bg-gray-100",
} as const;
const dash = (v: number | null | undefined, s = "") => (v === null || v === undefined ? "—" : `${v}${s}`);

function Trend({ t }: { t: "improving" | "declining" | "stable" | null }) {
  if (!t) return <span className="text-muted-foreground">—</span>;
  if (t === "improving") return <span className="inline-flex items-center gap-1 text-green-700"><TrendingUp className="h-3.5 w-3.5" />Improving</span>;
  if (t === "declining") return <span className="inline-flex items-center gap-1 text-red-700"><TrendingDown className="h-3.5 w-3.5" />Declining</span>;
  return <span className="inline-flex items-center gap-1 text-gray-600"><Minus className="h-3.5 w-3.5" />Stable</span>;
}

/** `studentId` is students.id. Access is enforced by the edge function, not by this component. */
export default function StudentLearningTwin({ studentId }: { studentId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["student-twin", studentId],
    queryFn: () => fetchStudentTwin(studentId),
    enabled: !!studentId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !data) {
    return (
      <Card><CardContent className="py-8 text-center">
        <p className="text-destructive font-medium">Couldn't load the learning twin.</p>
        <p className="text-sm text-muted-foreground mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
      </CardContent></Card>
    );
  }

  const t = data.twin;
  const history = t.progression.history.filter((h) => h.overall !== null);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="pt-5">
          <p className="text-xs text-muted-foreground">Overall ability</p>
          <p className="text-2xl font-bold">{dash(t.overall_ability, "%")}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs text-muted-foreground">Progression</p>
          <p className="text-sm font-semibold mt-1"><Trend t={t.progression.direction} /></p>
          {t.progression.slope_per_month !== null && <p className="text-xs text-muted-foreground">{t.progression.slope_per_month} points/month</p>}
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs text-muted-foreground">Concepts mastered</p>
          <p className="text-2xl font-bold">{dash(t.retention.mastered_pct, "%")}</p>
          <p className="text-xs text-muted-foreground">{t.retention.mastered} of {t.retention.tracked} tracked</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs text-muted-foreground">Risk</p>
          <Badge className={`mt-1 capitalize ${riskStyle[t.risk.level]}`}>{t.risk.level}</Badge>
        </CardContent></Card>
      </div>

      {!t.sufficient_data && (
        <Card className="border-dashed"><CardContent className="py-5 text-sm text-muted-foreground">
          There isn't enough evidence yet to estimate ability. It appears once there are at least {String(t.assumptions.min_tests_for_ability)} tests in a subject or an adaptive session.
        </CardContent></Card>
      )}

      {t.risk.reasons.length > 0 && (
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Why this risk level</CardTitle></CardHeader>
          <CardContent><ul className="list-disc pl-5 text-sm space-y-1">{t.risk.reasons.map((r) => <li key={r}>{r}</li>)}</ul></CardContent></Card>
      )}

      {t.subjects.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Ability by subject</CardTitle>
            <CardDescription>Blends test scores and adaptive-test ability. The range is 80%.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {t.subjects.map((s) => (
              <div key={s.subject} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{s.subject}</span>
                  <span className="tabular-nums">{dash(s.ability, "%")} <span className="text-xs text-muted-foreground">· {s.tests} tests</span></span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${s.ability ?? 0}%` }} /></div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <Trend t={s.trend} />
                  <span>{s.projected_next !== null ? `Next test: ${s.projected_next}% (${s.projected_low}–${s.projected_high})` : "No projection yet"}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Learning preferences</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          {t.preferences.strengths.length > 0 && <p><span className="font-medium">Stronger than their own average: </span>{t.preferences.strengths.map((s) => `${s.subject} (+${s.margin})`).join(", ")}</p>}
          {t.preferences.challenges.length > 0 && <p><span className="font-medium">Weaker than their own average: </span>{t.preferences.challenges.map((s) => `${s.subject} (${s.margin})`).join(", ")}</p>}
          {t.preferences.recorded_learning_style && <p><span className="font-medium">Recorded learning style: </span>{t.preferences.recorded_learning_style}</p>}
          <p className="text-xs text-muted-foreground">{t.preferences.note}</p>
        </CardContent>
      </Card>

      {history.length >= 2 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Ability over time</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={history} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip />
                <Line type="monotone" dataKey="overall" name="Overall ability %" stroke="hsl(var(--primary))" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {t.next_steps.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Suggested next steps</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {t.next_steps.map((n) => (
              <div key={n.action} className="flex items-start gap-2 text-sm">
                <ArrowRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <div><p className="font-medium">{n.action}</p><p className="text-xs text-muted-foreground">{n.reason}</p></div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
