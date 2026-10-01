import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { GraduationCap, Plus, X, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { toast } from "sonner";
import {
  fetchSimOptions, runAcademicSimulation, type ScenarioRequest, type ScenarioResult, type SimResponse,
} from "@/lib/schoolTwin";

const CLASS_TEACHER = "__class_teacher__";
const TARGET_LABEL: Record<ScenarioRequest["remedial_target"], string> = {
  at_risk: "At-risk students", below_average: "Below class average", all: "Whole class",
};

const num = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v}${suffix}`);
const signed = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v}`);

function describe(s: ScenarioRequest): string {
  const parts: string[] = [];
  if (s.extra_periods > 0) parts.push(`+${s.extra_periods} period${s.extra_periods > 1 ? "s" : ""}/wk`);
  if (s.extra_periods < 0) parts.push(`${s.extra_periods} period${s.extra_periods < -1 ? "s" : ""}/wk`);
  if (s.remedial_periods > 0) parts.push(`${s.remedial_periods} remedial/wk (${TARGET_LABEL[s.remedial_target].toLowerCase()})`);
  if (!parts.length) parts.push("no change");
  return `${s.subject}: ${parts.join(", ")} for ${s.weeks} wk`;
}

function Bands({ before, after }: { before: { high: number; medium: number; low: number }; after: { high: number; medium: number; low: number } }) {
  const Row = ({ label, r }: { label: string; r: typeof before }) => {
    const t = r.high + r.medium + r.low || 1;
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="w-12 text-muted-foreground">{label}</span>
        <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="bg-red-500" style={{ width: `${(r.high / t) * 100}%` }} />
          <div className="bg-yellow-400" style={{ width: `${(r.medium / t) * 100}%` }} />
          <div className="bg-green-500" style={{ width: `${(r.low / t) * 100}%` }} />
        </div>
        <span className="w-24 tabular-nums text-muted-foreground">{r.high}H · {r.medium}M · {r.low}L</span>
      </div>
    );
  };
  return <div className="space-y-1"><Row label="Before" r={before} /><Row label="After" r={after} /></div>;
}

function ResultCard({ r, showAllStudents }: { r: ScenarioResult; showAllStudents: boolean }) {
  if (r.error || !r.projected) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <p className="font-semibold">{r.label}</p>
        <p>{r.error ?? "Couldn't simulate this scenario."}</p>
      </div>
    );
  }
  const p = r.projected;
  const gain = p.avg_gain ?? 0;
  const GainIcon = gain < 0 ? TrendingDown : TrendingUp;
  const gainTone = gain < 0 ? "text-red-600" : gain > 0 ? "text-green-600" : "text-muted-foreground";
  const syl = r.syllabus;
  const students = r.students ?? [];
  const shown = showAllStudents ? students : students.slice(0, 6);

  return (
    <div className="rounded-xl border bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{r.label}</p>
          {r.scenario && <p className="text-xs text-muted-foreground">{describe(r.scenario)}</p>}
        </div>
        <Badge variant="outline" className="text-xs">Confidence: {p.confidence}</Badge>
      </div>

      {/* Headline */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-[11px] text-muted-foreground">Class avg now</p>
          <p className="text-xl font-bold">{num(p.avg_before, "%")}</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-[11px] text-muted-foreground">Projected</p>
          <p className="text-xl font-bold">{num(p.avg_after, "%")}</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-[11px] text-muted-foreground">Change</p>
          <p className={`text-xl font-bold flex items-center justify-center gap-1 ${gainTone}`}>
            <GainIcon className="h-4 w-4" />{signed(p.avg_gain)}
          </p>
          {p.gain_low !== null && p.gain_high !== null && gain !== 0 && (
            <p className="text-[10px] text-muted-foreground">likely {signed(Math.min(p.gain_low, p.gain_high))} to {signed(Math.max(p.gain_low, p.gain_high))}</p>
          )}
        </div>
      </div>

      {r.risk && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Risk bands ({p.students_evaluated} students)</p>
          <Bands before={r.risk.before} after={r.risk.after} />
          <p className="text-xs text-muted-foreground">
            {r.risk.improved} student{r.risk.improved === 1 ? "" : "s"} move to a lower risk band
            {r.risk.declined > 0 ? `, ${r.risk.declined} to a higher one` : ""}.
            {p.students_targeted > 0 && ` Remedial group: ${p.students_targeted} student${p.students_targeted === 1 ? "" : "s"}.`}
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3 text-xs">
        {/* Timetable feasibility */}
        <div className="rounded-lg border p-3 space-y-1">
          <p className="font-medium text-sm flex items-center gap-1.5">
            {r.feasibility?.feasible === false ? <AlertTriangle className="h-4 w-4 text-yellow-600" />
              : r.feasibility?.feasible ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Info className="h-4 w-4 text-muted-foreground" />}
            Timetable
          </p>
          {r.timetable && <p>Periods/wk: {r.timetable.weekly_periods_now} → {r.timetable.weekly_periods_after}{r.timetable.remedial_periods ? ` (+${r.timetable.remedial_periods} remedial)` : ""}</p>}
          <p className="text-muted-foreground">{r.feasibility?.note}</p>
          {r.feasibility && r.feasibility.sample_slots.length > 0 && r.feasibility.slots_needed > 0 && (
            <p className="text-muted-foreground">e.g. {r.feasibility.sample_slots.slice(0, 4).map((s) => `${s.day} ${s.period}`).join(", ")}</p>
          )}
        </div>

        {/* Syllabus */}
        <div className="rounded-lg border p-3 space-y-1">
          <p className="font-medium text-sm">Syllabus pace</p>
          {syl?.available ? (
            <>
              <p>Now: {syl.covered}/{syl.total} chapters ({num(syl.current_pct, "%")})</p>
              {syl.projected_pct_with_change !== null && syl.projected_pct_with_change !== undefined ? (
                <p>After: {num(syl.projected_pct_with_change, "%")} <span className="text-muted-foreground">(vs {num(syl.projected_pct_without_change, "%")} unchanged)</span></p>
              ) : <p className="text-muted-foreground">{syl.note}</p>}
              {syl.weeks_to_finish_after !== null && syl.weeks_to_finish_after !== undefined && syl.weeks_to_finish_now !== null && (
                <p className="text-muted-foreground">Finish in ~{syl.weeks_to_finish_after} wk (was ~{syl.weeks_to_finish_now})</p>
              )}
            </>
          ) : <p className="text-muted-foreground">{syl?.note}</p>}
        </div>

        {/* Teacher load */}
        <div className="rounded-lg border p-3 space-y-1">
          <p className="font-medium text-sm">Teacher load</p>
          {r.teacher_load && (
            <>
              <p>{r.teacher_load.teacher_name}: {r.teacher_load.before} → {r.teacher_load.after} periods/wk</p>
              <Badge className={r.teacher_load.status === "ok" ? "bg-green-100 text-green-800 hover:bg-green-100" : r.teacher_load.status === "high" ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-100" : "bg-red-100 text-red-800 hover:bg-red-100"}>
                {r.teacher_load.status === "ok" ? "Within range" : r.teacher_load.status === "high" ? "High" : "Overloaded"}
              </Badge>
              {r.teacher_load.teacher_id && r.teacher_load.class_teacher_after !== r.teacher_load.after && (
                <p className="text-muted-foreground">Class teacher: {r.teacher_load.class_teacher_before} → {r.teacher_load.class_teacher_after}</p>
              )}
            </>
          )}
        </div>
      </div>

      {r.warnings && r.warnings.length > 0 && (
        <div className="space-y-1">
          {r.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 rounded-md bg-yellow-50 border border-yellow-200 px-2.5 py-1.5 text-xs text-yellow-900">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{w}
            </p>
          ))}
        </div>
      )}

      {students.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-1">{showAllStudents ? "All students" : "Biggest movers"}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-1 pr-2 font-normal">Student</th>
                  <th className="py-1 px-2 font-normal text-right">Now</th>
                  <th className="py-1 px-2 font-normal text-right">Projected</th>
                  <th className="py-1 px-2 font-normal text-right">Change</th>
                  <th className="py-1 pl-2 font-normal">Notes</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.student_id} className="border-b last:border-0">
                    <td className="py-1 pr-2">{s.name}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{s.before}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{s.after}</td>
                    <td className={`py-1 px-2 text-right tabular-nums ${s.delta < 0 ? "text-red-600" : s.delta > 0 ? "text-green-600" : ""}`}>{signed(s.delta)}</td>
                    <td className="py-1 pl-2 text-muted-foreground">{[s.targeted ? "remedial" : "", s.baseline_source === "other_subjects" ? "estimated baseline" : ""].filter(Boolean).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {r.assumptions && r.assumptions.length > 0 && (
        <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
          {r.assumptions.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function AcademicWhatIf() {
  const { data: options, isLoading, error } = useQuery({ queryKey: ["whatif-academic-options"], queryFn: fetchSimOptions, staleTime: 5 * 60_000 });

  const [classId, setClassId] = useState("");
  const [subject, setSubject] = useState("");
  const [extra, setExtra] = useState("2");
  const [remedial, setRemedial] = useState("0");
  const [target, setTarget] = useState<ScenarioRequest["remedial_target"]>("at_risk");
  const [weeks, setWeeks] = useState("8");
  const [teacherId, setTeacherId] = useState(CLASS_TEACHER);
  const [scenarios, setScenarios] = useState<ScenarioRequest[]>([]);
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<SimResponse | null>(null);

  const cls = useMemo(() => options?.classes.find((c) => c.id === classId), [options, classId]);
  const subjectRow = cls?.subjects.find((s) => s.subject === subject);

  const maxWeeks = options?.max_weeks ?? 40;
  const form = (): { value?: ScenarioRequest; error?: string } => {
    const e = Number(extra), r = Number(remedial), w = Number(weeks);
    if (!subject) return { error: "Choose a subject" };
    if (!Number.isInteger(e) || e < -5 || e > 10) return { error: "Extra periods must be a whole number from -5 to 10" };
    if (!Number.isInteger(r) || r < 0 || r > 6) return { error: "Remedial periods must be a whole number from 0 to 6" };
    if (!Number.isInteger(w) || w < 1 || w > maxWeeks) return { error: `Weeks must be a whole number from 1 to ${maxWeeks}` };
    return { value: {
      subject, extra_periods: e, remedial_periods: r, remedial_target: target, weeks: w,
      teacher_id: teacherId === CLASS_TEACHER ? undefined : teacherId,
    } };
  };

  const resetResults = () => { setResponse(null); };
  const onClassChange = (id: string) => { setClassId(id); setSubject(""); setTeacherId(CLASS_TEACHER); setScenarios([]); resetResults(); };

  const addScenario = () => {
    const f = form();
    if (!f.value) { toast.error(f.error); return; }
    if (scenarios.length >= 4) { toast.error("You can compare up to 4 scenarios"); return; }
    setScenarios([...scenarios, { ...f.value, label: `Option ${String.fromCharCode(65 + scenarios.length)}` }]);
    resetResults();
  };

  const run = async () => {
    let list = scenarios;
    if (list.length === 0) {
      const f = form();
      if (!f.value) { toast.error(f.error); return; }
      list = [{ ...f.value, label: "Your scenario" }];
    }
    if (!classId) { toast.error("Choose a class"); return; }
    setRunning(true);
    setResponse(null);
    try {
      setResponse(await runAcademicSimulation(classId, list));
    } catch (e) {
      toast.error((e as Error).message || "Couldn't run the simulation");
    } finally {
      setRunning(false);
    }
  };

  if (isLoading) return <div className="flex justify-center py-6"><LoadingSpinner size="sm" /></div>;
  if (error) return <p className="text-sm text-red-600 p-4">Couldn't load classes for simulation: {(error as Error).message}</p>;

  const ok = response?.results.filter((r) => r.projected) ?? [];
  const best = ok.length > 1 ? ok.reduce((a, b) => ((b.projected!.avg_gain ?? -99) > (a.projected!.avg_gain ?? -99) ? b : a)) : null;

  return (
    <Card className="overflow-hidden border-blue-100 bg-white/80 backdrop-blur-sm shadow-sm p-0">
      <div className="p-5 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-blue-600">
        <div className="absolute -right-6 -top-6 w-28 h-28 bg-white/10 rounded-full" />
        <div className="relative flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
            <GraduationCap className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">What-If: Academic Outcomes</h3>
            <p className="text-blue-50 text-xs mt-1">
              Test extra classes, remedial periods or timetable changes before you make them — see the likely effect on scores, risk, syllabus pace, teacher load and free slots.
            </p>
          </div>
        </div>
      </div>

      <CardContent className="space-y-4 pt-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Class</Label>
            <Select value={classId} onValueChange={onClassChange}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Choose a class..." /></SelectTrigger>
              <SelectContent>
                {(options?.classes ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}-{c.section} ({c.student_count} students)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Subject</Label>
            <Select value={subject} onValueChange={(v) => { setSubject(v); setTeacherId(CLASS_TEACHER); }} disabled={!cls}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={cls ? "Choose a subject..." : "Choose a class first"} /></SelectTrigger>
              <SelectContent>
                {(cls?.subjects ?? []).map((s) => (
                  <SelectItem key={s.subject} value={s.subject}>{s.subject} — {s.teacher_name} ({s.weekly_periods}/wk)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Delivered by</Label>
            <Select value={teacherId} onValueChange={setTeacherId} disabled={!subject}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={CLASS_TEACHER}>Class teacher{subjectRow ? ` (${subjectRow.teacher_name})` : ""}</SelectItem>
                {(options?.teachers ?? []).filter((t) => t.id !== subjectRow?.teacher_id).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Extra regular periods / week</Label>
            <Input type="number" min={-5} max={10} step={1} value={extra} onChange={(e) => setExtra(e.target.value)} className="h-9 text-sm" />
            <p className="text-[10px] text-muted-foreground">Negative = remove periods</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Remedial periods / week</Label>
            <Input type="number" min={0} max={6} step={1} value={remedial} onChange={(e) => setRemedial(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Remedial for</Label>
            <Select value={target} onValueChange={(v) => setTarget(v as ScenarioRequest["remedial_target"])}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(TARGET_LABEL) as ScenarioRequest["remedial_target"][]).map((k) => <SelectItem key={k} value={k}>{TARGET_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">For how many weeks</Label>
            <Input type="number" min={1} max={maxWeeks} step={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} className="h-9 text-sm" />
          </div>
        </div>

        {scenarios.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {scenarios.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full border bg-blue-50 px-3 py-1 text-xs text-blue-900">
                <b>{s.label}</b> {describe(s)}
                <button type="button" aria-label={`Remove ${s.label}`} onClick={() => { setScenarios(scenarios.filter((_, j) => j !== i).map((x, j) => ({ ...x, label: `Option ${String.fromCharCode(65 + j)}` }))); resetResults(); }}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={run} disabled={running || !classId}>
            {running ? "Simulating..." : scenarios.length > 1 ? `Compare ${scenarios.length} options` : "Run simulation"}
          </Button>
          <Button variant="outline" onClick={addScenario} disabled={!subject || scenarios.length >= 4} className="gap-1.5">
            <Plus className="h-4 w-4" />Add to comparison
          </Button>
        </div>

        {response && (
          <div className="space-y-3 pt-3 border-t">
            <p className="text-xs text-muted-foreground">
              {response.class.name}-{response.class.section} · {response.class.student_count} students
              {response.class.attendance_pct !== null ? ` · ${response.class.attendance_pct}% recent attendance` : ""}
            </p>

            {ok.length > 1 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="p-2 font-medium">Option</th><th className="p-2 font-medium">Change</th>
                      <th className="p-2 font-medium text-right">Avg gain</th><th className="p-2 font-medium text-right">High-risk after</th>
                      <th className="p-2 font-medium text-right">Teacher load</th><th className="p-2 font-medium">Fits timetable?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ok.map((r) => (
                      <tr key={r.label} className={`border-t ${best === r ? "bg-green-50" : ""}`}>
                        <td className="p-2 font-medium">{r.label}{best === r ? " ★" : ""}</td>
                        <td className="p-2">{r.scenario ? describe(r.scenario) : ""}</td>
                        <td className="p-2 text-right tabular-nums">{signed(r.projected!.avg_gain)}</td>
                        <td className="p-2 text-right tabular-nums">{r.risk!.after.high} (was {r.risk!.before.high})</td>
                        <td className="p-2 text-right tabular-nums">{r.teacher_load!.after}/wk</td>
                        <td className="p-2">{r.feasibility?.feasible === null ? "Unknown" : r.feasibility?.feasible ? "Yes" : "Not fully"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {response.results.map((r) => <ResultCard key={r.label} r={r} showAllStudents={false} />)}

            <details className="rounded-lg border bg-muted/30 p-3 text-xs">
              <summary className="cursor-pointer font-medium">How this estimate works</summary>
              <p className="mt-2 text-muted-foreground">{response.model.disclaimer}</p>
              <ul className="mt-2 list-disc pl-4 space-y-1 text-muted-foreground">
                {response.model.assumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
