// src/components/exam/ExamReadinessPanels.tsx
//
// Display components for Exam Readiness Score and Cohort Intelligence. They are
// used by the student page (/exam-readiness) and by the staff Class Mastery
// dashboard, so a teacher and a student are looking at the same numbers.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ChevronDown, ChevronRight, Info, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import {
  BAND_CLASS, BAND_LABEL, bandForScore, useClassCohort, useClassExamReadiness, useExamReadiness, useStudentCohort,
  type ClassCohortIntelligence, type CohortLevelKey, type CohortPattern, type CohortTopicRow, type ReadinessBand,
} from "@/hooks/useExamIntelligence";

const pctText = (n: number | null | undefined, digits = 0) => (n == null ? "—" : `${n.toFixed(digits)}%`);
const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function barColor(score: number | null | undefined) {
  const b = bandForScore(score ?? null);
  return b === "exam_ready" ? "bg-emerald-500" : b === "nearly_ready" ? "bg-sky-500" : b === "needs_work" ? "bg-amber-500" : b === "at_risk" ? "bg-rose-500" : "bg-muted";
}

export function BandBadge({ band }: { band: ReadinessBand | null | undefined }) {
  if (!band) return <Badge variant="outline">Not enough data</Badge>;
  return <Badge variant="outline" className={BAND_CLASS[band]}>{BAND_LABEL[band]}</Badge>;
}

export function ScoreBar({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  return (
    <div className={`h-2 w-full rounded-full bg-muted overflow-hidden ${className}`} role="progressbar"
      aria-valuenow={value ?? 0} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${barColor(value)}`} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
    </div>
  );
}

function LoadingCard() {
  return <Card><CardContent className="p-6 space-y-3"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></CardContent></Card>;
}
function ErrorCard({ error }: { error: unknown }) {
  return <Card><CardContent className="p-6 text-sm text-destructive">{error instanceof Error ? error.message : "Something went wrong loading this."}</CardContent></Card>;
}
function EmptyCard({ children }: { children: React.ReactNode }) {
  return <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">{children}</CardContent></Card>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Student exam readiness
// ═══════════════════════════════════════════════════════════════════════════
export function StudentReadinessView({ studentId, bookId, blueprints = [] }: {
  studentId?: string; bookId?: number | null; blueprints?: { id: string; title: string }[];
}) {
  const [examDate, setExamDate] = useState("");
  const [blueprintId, setBlueprintId] = useState<string>("none");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const today = new Date().toISOString().slice(0, 10);
  const validDate = examDate && examDate >= today ? examDate : "";

  const { data, isLoading, error } = useExamReadiness({
    studentId, bookId, blueprintId: blueprintId === "none" ? null : blueprintId, examDate: validDate || null,
  });

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row gap-4 sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="exam-date" className="text-xs">Exam date (optional)</Label>
            <Input id="exam-date" type="date" min={today} value={examDate} onChange={(e) => setExamDate(e.target.value)} className="sm:w-48" />
          </div>
          {blueprints.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Predict for a specific exam</Label>
              <Select value={blueprintId} onValueChange={setBlueprintId}>
                <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Whole syllabus</SelectItem>
                  {blueprints.map((b) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="text-xs text-muted-foreground sm:ml-auto sm:max-w-xs">
            With an exam date, the score accounts for what is likely to be forgotten by then.
          </p>
        </CardContent>
      </Card>

      {isLoading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : !data?.has_data || !data.overall ? (
        <EmptyCard>{data?.message ?? "No readiness data yet — it fills in as you practise and take assessments."}</EmptyCard>
      ) : (
        <>
          <Card>
            <CardContent className="p-5 grid gap-5 md:grid-cols-[auto,1fr] items-center">
              <div className="flex flex-col items-center justify-center md:pr-6 md:border-r">
                <div className="text-5xl font-bold tabular-nums">{Math.round(data.overall.readiness)}<span className="text-2xl text-muted-foreground">/100</span></div>
                <div className="mt-2"><BandBadge band={data.overall.band} /></div>
                {data.days_to_exam != null && <p className="text-xs text-muted-foreground mt-2">{data.days_to_exam} day{data.days_to_exam === 1 ? "" : "s"} to the exam</p>}
              </div>
              <div className="space-y-3 text-sm">
                <p>
                  Predicted score: <span className="font-semibold">{pctText(data.overall.predicted_score_pct)}</span>
                  {data.blueprint?.predicted_score_pct != null && (
                    <> · on <span className="font-medium">{data.blueprint.title}</span>: <span className="font-semibold">{pctText(data.blueprint.predicted_score_pct)}</span></>
                  )}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <Stat label="Coverage" value={pctText(data.overall.coverage_pct)} hint={`${data.overall.assessed_count} of ${data.overall.objective_count} skills assessed`} />
                  <Stat label="Confidence" value={data.overall.confidence} hint="How much evidence backs this score" />
                  <Stat label="Expected forgetting" value={data.overall.forgetting_loss > 0 ? `−${data.overall.forgetting_loss.toFixed(1)} pts` : "None"} hint="Loss from memory decay" />
                </div>
                {data.overall.confidence === "low" && (
                  <p className="flex gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                    <Info className="h-4 w-4 shrink-0 mt-px" />
                    Few skills have been assessed so far, so this is a rough estimate. It sharpens as you complete more practice and tests.
                  </p>
                )}
                {data.blueprint && data.blueprint.unmapped_weight_pct > 0 && (
                  <p className="text-xs text-muted-foreground">{data.blueprint.unmapped_weight_pct}% of this exam's syllabus has no learning objectives yet and is left out of the exam-specific score.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {(data.focus_areas?.length ?? 0) > 0 && (
            <Card className="border-amber-200">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" />Study these first</CardTitle>
                <CardDescription className="text-xs">Ranked by how much of the syllabus a topic covers and how far it is from ready.</CardDescription></CardHeader>
              <CardContent className="space-y-2">
                {data.focus_areas!.map((f) => (
                  <div key={f.topic_id} className="flex items-center gap-3 text-sm">
                    <div className="min-w-0 flex-1"><p className="truncate font-medium">{f.topic_name}</p><p className="text-xs text-muted-foreground truncate">{f.subject} · {f.chapter_name}</p></div>
                    <span className="text-xs text-muted-foreground hidden sm:block">{f.coverage_pct === 0 ? "not assessed yet" : `${Math.round(f.coverage_pct)}% assessed`}</span>
                    <Badge variant="outline">{Math.round(f.readiness)}%</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">By subject, chapter and topic</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {data.subjects.map((s) => (
                <div key={s.book_id} className="rounded-lg border">
                  <button type="button" className="w-full flex items-center gap-3 p-3 text-left" onClick={() => toggle(`s${s.book_id}`)} aria-expanded={!!open[`s${s.book_id}`]}>
                    {open[`s${s.book_id}`] ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <span className="font-medium flex-1 min-w-0 truncate">{s.subject}{s.class_name ? ` (${s.class_name})` : ""}</span>
                    <div className="w-24 hidden sm:block"><ScoreBar value={s.readiness} /></div>
                    <span className="tabular-nums text-sm w-12 text-right">{Math.round(s.readiness)}%</span>
                    <BandBadge band={s.band} />
                  </button>
                  {open[`s${s.book_id}`] && (
                    <div className="border-t divide-y">
                      {s.chapters.map((c) => (
                        <div key={c.chapter_id}>
                          <button type="button" className="w-full flex items-center gap-3 py-2 pl-8 pr-3 text-left" onClick={() => toggle(`c${c.chapter_id}`)} aria-expanded={!!open[`c${c.chapter_id}`]}>
                            {open[`c${c.chapter_id}`] ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                            <span className="text-sm flex-1 min-w-0 truncate">{c.name}</span>
                            <div className="w-20 hidden sm:block"><ScoreBar value={c.readiness} /></div>
                            <span className="tabular-nums text-xs w-10 text-right">{Math.round(c.readiness)}%</span>
                          </button>
                          {open[`c${c.chapter_id}`] && c.topics.map((t) => (
                            <div key={t.topic_id} className="flex items-center gap-3 py-1.5 pl-14 pr-3 text-xs bg-muted/30">
                              <span className="flex-1 min-w-0 truncate">{t.name}</span>
                              <span className="text-muted-foreground hidden sm:block">{Math.round(t.coverage_pct)}% assessed</span>
                              <div className="w-16"><ScoreBar value={t.readiness} /></div>
                              <span className="tabular-nums w-10 text-right">{Math.round(t.readiness)}%</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {(data.bloom?.length ?? 0) > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">By thinking level (Bloom's)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {data.bloom!.map((b) => (
                    <div key={b.bloom_level} className="flex items-center gap-3 text-xs">
                      <span className="w-24 capitalize">{b.bloom_level}</span>
                      <ScoreBar value={b.readiness} className="flex-1" />
                      <span className="w-10 text-right tabular-nums">{Math.round(b.readiness)}%</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {(data.mock_exams?.length ?? 0) > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Recent mock exams</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {data.mock_exams!.map((m) => (
                    <div key={m.attempt_id} className="flex items-center justify-between text-sm gap-2">
                      <span className="truncate">{m.title}</span>
                      <span className="tabular-nums shrink-0">{m.score}/{m.max_marks} <span className="text-xs text-muted-foreground">({Math.round(m.pct)}%){m.status === "submitted" ? " · provisional" : ""}</span></span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border p-2" title={hint}>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold capitalize">{value}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Class exam readiness (staff)
// ═══════════════════════════════════════════════════════════════════════════
export function ClassReadinessView({ classId, bookId, blueprints = [] }: { classId: string; bookId?: number | null; blueprints?: { id: string; title: string }[] }) {
  const [examDate, setExamDate] = useState("");
  const [blueprintId, setBlueprintId] = useState("none");
  const today = new Date().toISOString().slice(0, 10);
  const validDate = examDate && examDate >= today ? examDate : "";
  const { data, isLoading, error } = useClassExamReadiness(classId, { bookId, blueprintId: blueprintId === "none" ? null : blueprintId, examDate: validDate || null });

  const bands: ReadinessBand[] = ["exam_ready", "nearly_ready", "needs_work", "at_risk"];

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 flex flex-col sm:flex-row gap-4 sm:items-end">
        <div className="space-y-1.5"><Label htmlFor="cls-exam-date" className="text-xs">Exam date (optional)</Label>
          <Input id="cls-exam-date" type="date" min={today} value={examDate} onChange={(e) => setExamDate(e.target.value)} className="sm:w-48" /></div>
        {blueprints.length > 0 && (
          <div className="space-y-1.5"><Label className="text-xs">Weight by exam blueprint</Label>
            <Select value={blueprintId} onValueChange={setBlueprintId}><SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Whole syllabus</SelectItem>{blueprints.map((b) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}</SelectContent></Select></div>
        )}
      </CardContent></Card>

      {isLoading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : !data || data.roster_size === 0 ? (
        <EmptyCard>This class has no students on its roster yet.</EmptyCard>
      ) : data.students_with_data === 0 ? (
        <EmptyCard>No learning objectives exist for this subject yet, so readiness can't be computed.</EmptyCard>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card className="col-span-2 md:col-span-1"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Class average</p>
              <p className="text-3xl font-bold tabular-nums">{Math.round(data.class_avg_readiness ?? 0)}%</p>
              {data.class_avg_blueprint_readiness != null && <p className="text-xs text-muted-foreground">on the exam: {Math.round(data.class_avg_blueprint_readiness)}%</p>}</CardContent></Card>
            {bands.map((b) => (
              <Card key={b}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{BAND_LABEL[b]}</p><p className="text-2xl font-semibold tabular-nums">{data.bands[b] ?? 0}</p></CardContent></Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Students, least ready first</CardTitle></CardHeader>
            <CardContent className="divide-y">
              {data.students.map((s) => (
                <div key={s.student_id} className="flex items-center gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.weakest_topic ? `Study first: ${s.weakest_topic}` : "\u00a0"}</p></div>
                  <span className="text-xs text-muted-foreground hidden sm:block">{s.confidence ? `${s.confidence} confidence` : ""}</span>
                  <div className="w-20 hidden sm:block"><ScoreBar value={s.readiness} /></div>
                  <span className="tabular-nums w-10 text-right">{s.readiness == null ? "—" : `${Math.round(s.readiness)}%`}</span>
                  <BandBadge band={s.band} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Topics, least ready first</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {data.topics.map((t) => (
                <div key={t.topic_id} className="flex items-center gap-3 text-sm">
                  <div className="min-w-0 flex-1"><p className="truncate">{t.topic_name}</p><p className="text-xs text-muted-foreground truncate">{t.chapter_name}</p></div>
                  <span className="text-xs text-muted-foreground hidden sm:block">{t.students_at_risk}/{t.students} at risk</span>
                  <div className="w-24 hidden sm:block"><ScoreBar value={t.class_readiness} /></div>
                  <span className="tabular-nums w-10 text-right">{Math.round(t.class_readiness)}%</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Cohort intelligence
// ═══════════════════════════════════════════════════════════════════════════
const LEVEL_ORDER: CohortLevelKey[] = ["section", "class", "grade", "school"];
const LEVEL_NAME: Record<CohortLevelKey, string> = { section: "Your section", class: "All sections of your class", grade: "Your grade", school: "Whole school" };

export function StudentCohortView({ studentId, bookId }: { studentId?: string; bookId?: number | null }) {
  const { data, isLoading, error } = useStudentCohort(bookId, studentId);
  if (isLoading) return <LoadingCard />;
  if (error) return <ErrorCard error={error} />;
  if (!data) return null;
  if (data.insufficient_data || data.student_score_pct == null) {
    return <EmptyCard>Not enough assessed skills yet to compare (at least {data.min_objectives} are needed). Keep practising and check back.</EmptyCard>;
  }
  const levels = LEVEL_ORDER.filter((k) => data.levels[k]);
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-5">
        <p className="text-xs text-muted-foreground">Your mastery on assessed skills</p>
        <p className="text-4xl font-bold tabular-nums">{Math.round(data.student_score_pct)}%</p>
      </CardContent></Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {levels.map((k) => {
          const l = data.levels[k]!;
          return (
            <Card key={k}>
              <CardHeader className="pb-1"><CardTitle className="text-sm">{LEVEL_NAME[k]}</CardTitle>
                <CardDescription className="text-xs">{l.label}</CardDescription></CardHeader>
              <CardContent className="text-sm space-y-1.5">
                {l.suppressed ? <p className="text-xs text-muted-foreground">{l.reason}</p> : (
                  <>
                    <div className="flex items-baseline justify-between"><span className="text-muted-foreground text-xs">Average</span><span className="tabular-nums">{pctText(l.avg_pct)}</span></div>
                    <div className="flex items-baseline justify-between"><span className="text-muted-foreground text-xs">You vs average</span>
                      <span className={`tabular-nums font-medium ${(l.gap_vs_avg_pts ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{l.gap_vs_avg_pts == null ? "—" : `${sign(l.gap_vs_avg_pts)} pts`}</span></div>
                    <div className="flex items-baseline justify-between"><span className="text-muted-foreground text-xs">Percentile</span>
                      <span className="tabular-nums">{l.percentile == null ? "—" : `${Math.round(l.percentile)}th`}</span></div>
                    <p className="text-[11px] text-muted-foreground">Compared with {l.compared_with} students</p>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <TopicStandingCard topics={data.topics} title="Where you stand, topic by topic" showStudent />
    </div>
  );
}

function TopicStandingCard({ topics, title, showStudent }: { topics: CohortTopicRow[]; title: string; showStudent?: boolean }) {
  if (!topics.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">Compared with the closest group that has enough data (section, then class, grade, school).</CardDescription></CardHeader>
      <CardContent className="divide-y">
        {topics.map((t) => {
          const ref = t.section_avg_pct ?? t.class_avg_pct ?? t.grade_avg_pct ?? t.school_avg_pct;
          return (
            <div key={t.topic_id} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1"><p className="truncate">{t.topic_name}</p><p className="text-xs text-muted-foreground truncate">{t.chapter_name}</p></div>
              <span className="text-xs text-muted-foreground tabular-nums hidden sm:block">
                {showStudent
                  ? `${t.student_pct != null ? `you ${Math.round(t.student_pct)}% · ` : ""}${ref == null ? "no comparison" : `avg ${Math.round(ref)}%`}`
                  : `section ${t.section_avg_pct == null ? "—" : `${Math.round(t.section_avg_pct)}%`} · ${t.grade_avg_pct != null ? `grade ${Math.round(t.grade_avg_pct)}%` : t.class_avg_pct != null ? `class ${Math.round(t.class_avg_pct)}%` : t.school_avg_pct != null ? `school ${Math.round(t.school_avg_pct)}%` : "no comparison"}`}
              </span>
              {t.standing === "no_reference" || t.gap_pts == null ? <Badge variant="outline">—</Badge> : (
                <Badge variant="outline" className={t.standing === "above" ? "text-emerald-700 border-emerald-200" : t.standing === "below" ? "text-rose-700 border-rose-200" : ""}>
                  {t.standing === "above" ? <TrendingUp className="h-3 w-3 mr-1" /> : t.standing === "below" ? <TrendingDown className="h-3 w-3 mr-1" /> : null}
                  {sign(t.gap_pts)} pts
                </Badge>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

const PATTERN_LABEL: Record<CohortPattern, { label: string; hint: string; className: string }> = {
  below_all_levels: { label: "Below all levels", hint: "Below the section, grade and school averages", className: "text-rose-700 border-rose-200" },
  above_all_levels: { label: "Above all levels", hint: "At or above the section, grade and school averages", className: "text-emerald-700 border-emerald-200" },
  strong_in_section_weak_in_grade: { label: "Strong here, weak vs grade", hint: "Doing well in the section but below the grade average — the section may be under-challenging", className: "text-amber-700 border-amber-200" },
  weak_in_section_strong_in_grade: { label: "Weak here, strong vs grade", hint: "Below the section average but above the grade average", className: "text-sky-700 border-sky-200" },
  mixed: { label: "Mixed", hint: "Above some levels, below others", className: "" },
  insufficient_data: { label: "Not enough data", hint: "Too few assessed skills to compare", className: "text-muted-foreground" },
};

export function ClassCohortView({ classId, bookId }: { classId: string; bookId?: number | null }) {
  const { data, isLoading, error } = useClassCohort(classId, bookId);
  if (isLoading) return <LoadingCard />;
  if (error) return <ErrorCard error={error} />;
  if (!data) return null;
  const d: ClassCohortIntelligence = data;
  const maxBand = Math.max(1, ...d.distribution.map((b) => b.students));

  if ((d.levels.section?.compared_with ?? 0) === 0) {
    return <EmptyCard>No student in this section has enough assessed skills yet to compare.</EmptyCard>;
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {LEVEL_ORDER.filter((k) => d.levels[k]).map((k) => (
          <Card key={k}><CardContent className="p-4">
            <p className="text-xs text-muted-foreground capitalize">{k === "section" ? d.class_label : k === "class" ? "All sections" : k === "grade" ? `Grade ${d.grade ?? ""}` : "School"}</p>
            <p className="text-2xl font-bold tabular-nums">{pctText(d.levels[k]!.avg_pct)}</p>
            <p className="text-[11px] text-muted-foreground">{d.levels[k]!.compared_with} of {d.levels[k]!.roster_size} students ranked</p>
          </CardContent></Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {d.section_gap_vs_grade_pts != null && (
          <Badge variant="outline" className={d.section_gap_vs_grade_pts >= 0 ? "text-emerald-700 border-emerald-200" : "text-rose-700 border-rose-200"}>
            Section vs grade: {sign(d.section_gap_vs_grade_pts)} pts</Badge>)}
        {d.section_gap_vs_school_pts != null && (
          <Badge variant="outline" className={d.section_gap_vs_school_pts >= 0 ? "text-emerald-700 border-emerald-200" : "text-rose-700 border-rose-200"}>
            Section vs school: {sign(d.section_gap_vs_school_pts)} pts</Badge>)}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Sections in this class</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.sections_in_class.map((s) => (
              <div key={s.class_id} className="flex items-center gap-3 text-sm">
                <span className={`w-28 truncate ${s.is_this_section ? "font-semibold" : ""}`}>{s.label}</span>
                <ScoreBar value={s.avg_pct} className="flex-1" />
                <span className="w-10 text-right tabular-nums">{pctText(s.avg_pct)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Score distribution in this section</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-28" role="img" aria-label="Number of students in each score band">
              {d.distribution.map((b) => (
                <div key={b.band} className="flex-1 flex flex-col items-center justify-end h-full">
                  <span className="text-xs tabular-nums mb-1">{b.students}</span>
                  <div className="w-full rounded-t bg-violet-500/80" style={{ height: `${(b.students / maxBand) * 100}%`, minHeight: b.students ? 4 : 0 }} />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-1">{d.distribution.map((b) => <span key={b.band} className="flex-1 text-center text-[10px] text-muted-foreground">{b.band}</span>)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Students against section, grade and school</CardTitle>
          <CardDescription className="text-xs">Percentile = share of the group scoring below (ties count half). Lowest scores first.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-normal">Student</th><th className="px-2 font-normal text-right">Score</th>
              <th className="px-2 font-normal text-right">Section</th><th className="px-2 font-normal text-right">Grade</th><th className="px-2 font-normal text-right">School</th><th className="pl-3 font-normal">Pattern</th></tr></thead>
            <tbody className="divide-y">
              {d.students.map((s) => {
                const p = PATTERN_LABEL[s.pattern];
                return (
                  <tr key={s.student_id}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{s.name}</td>
                    <td className="px-2 text-right tabular-nums">{s.score_pct == null ? "—" : `${Math.round(s.score_pct)}%`}</td>
                    <td className="px-2 text-right tabular-nums">{s.section_percentile == null ? "—" : `${Math.round(s.section_percentile)}th`}</td>
                    <td className="px-2 text-right tabular-nums">{s.grade_percentile == null ? "—" : `${Math.round(s.grade_percentile)}th`}</td>
                    <td className="px-2 text-right tabular-nums">{s.school_percentile == null ? "—" : `${Math.round(s.school_percentile)}th`}</td>
                    <td className="pl-3"><Badge variant="outline" className={p.className} title={p.hint}>{p.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <TopicStandingCard topics={d.topics} title="Section vs grade, topic by topic" />
      {d.topics.length === 0 && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" />Topic comparisons appear once at least 3 students have been assessed on a topic.</p>}
    </div>
  );
}
