import { useMemo, useState, type ReactNode } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CalendarDays, CheckCircle2, Clock3, FileText, Percent, Sparkles, Users } from "lucide-react";

type DppStatus = "Draft" | "Scheduled" | "Published" | "Active" | "Completed" | "Archived";

type Dpp = {
  id: number;
  title: string;
  subject: string;
  classLevel: string;
  section: string;
  status: DppStatus;
  questions: number;
  completion: number;
  averageScore: number;
  deadline: string;
};

const seedDpps: Dpp[] = [
  { id: 1, title: "Fractions Quick Check", subject: "Mathematics", classLevel: "Class 6", section: "A", status: "Published", questions: 10, completion: 82, averageScore: 76, deadline: "Today" },
  { id: 2, title: "Photosynthesis Review", subject: "Science", classLevel: "Class 7", section: "B", status: "Active", questions: 8, completion: 71, averageScore: 79, deadline: "Tomorrow" },
  { id: 3, title: "Grammar Drill", subject: "English", classLevel: "Class 5", section: "C", status: "Scheduled", questions: 12, completion: 0, averageScore: 0, deadline: "Thu 9:00 AM" },
  { id: 4, title: "History Recall", subject: "Social Studies", classLevel: "Class 8", section: "A", status: "Draft", questions: 6, completion: 0, averageScore: 0, deadline: "Next week" },
];

export default function DPPManagement() {
  const [dpps, setDpps] = useState(seedDpps);
  const [draft, setDraft] = useState({
    title: "Daily Practice Set",
    subject: "Mathematics",
    classLevel: "Class 6",
    section: "A",
    questions: 10,
    difficulty: "Medium",
    startDate: "2026-11-11",
    deadline: "2026-11-12",
  });

  const stats = useMemo(() => {
    const total = dpps.length;
    const published = dpps.filter((item) => item.status === "Published" || item.status === "Active").length;
    const participation = dpps.reduce((sum, item) => sum + item.completion, 0);
    const avgScore = dpps.filter((item) => item.averageScore > 0).reduce((sum, item) => sum + item.averageScore, 0) / Math.max(dpps.filter((item) => item.averageScore > 0).length, 1);
    return { total, published, participation, avgScore };
  }, [dpps]);

  const publishDraft = () => {
    setDpps((current) => [
      {
        id: Date.now(),
        title: draft.title,
        subject: draft.subject,
        classLevel: draft.classLevel,
        section: draft.section,
        status: "Published",
        questions: draft.questions,
        completion: 48,
        averageScore: 72,
        deadline: draft.deadline,
      },
      ...current,
    ]);
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <PageHeader
          title="Daily Practice Problems Management"
          subtitle="Schedule DPPs, track participation, and monitor classroom performance."
          action={<Badge className="bg-emerald-100 text-emerald-800">School-wide</Badge>}
        />

        <section className="grid gap-4 md:grid-cols-4">
          <SummaryCard icon={<FileText className="h-5 w-5" />} label="Total DPPs" value={String(stats.total)} tone="blue" />
          <SummaryCard icon={<CheckCircle2 className="h-5 w-5" />} label="Published" value={String(stats.published)} tone="green" />
          <SummaryCard icon={<Users className="h-5 w-5" />} label="Participation" value={`${Math.round(stats.participation / Math.max(stats.total, 1))}%`} tone="purple" />
          <SummaryCard icon={<Percent className="h-5 w-5" />} label="Avg score" value={`${Math.round(stats.avgScore)}%`} tone="amber" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle>Active DPP schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {dpps.map((item) => (
                <div key={item.id} className="rounded-xl border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm text-muted-foreground">{item.subject} · {item.classLevel} {item.section}</p>
                    </div>
                    <Badge variant={item.status === "Published" || item.status === "Active" ? "default" : "secondary"}>{item.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                    <span>{item.questions} questions</span>
                    <span>{item.deadline}</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Participation</span>
                      <span>{item.completion}%</span>
                    </div>
                    <Progress value={item.completion} className="h-2" />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Average score</span>
                    <span>{item.averageScore ? `${item.averageScore}%` : "—"}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Create DPP</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Title</label>
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Subject" value={draft.subject} onChange={(value) => setDraft((current) => ({ ...current, subject: value }))} />
                <Field label="Class" value={draft.classLevel} onChange={(value) => setDraft((current) => ({ ...current, classLevel: value }))} />
                <Field label="Section" value={draft.section} onChange={(value) => setDraft((current) => ({ ...current, section: value }))} />
                <Field label="Question count" value={String(draft.questions)} onChange={(value) => setDraft((current) => ({ ...current, questions: Number(value) || 1 }))} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Start date" value={draft.startDate} onChange={(value) => setDraft((current) => ({ ...current, startDate: value }))} type="date" />
                <Field label="Deadline" value={draft.deadline} onChange={(value) => setDraft((current) => ({ ...current, deadline: value }))} type="date" />
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={publishDraft}>Publish DPP</Button>
                <Button variant="outline">Save as draft</Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <InsightCard icon={<Sparkles className="h-4 w-4" />} title="Subject focus" value="Mathematics • 32% of class strengths" />
          <InsightCard icon={<Clock3 className="h-4 w-4" />} title="Pending submissions" value="14 students overdue" />
          <InsightCard icon={<CalendarDays className="h-4 w-4" />} title="Next review" value="Friday morning performance summary" />
        </section>
      </div>
    </AppLayout>
  );
}

function SummaryCard({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "blue" | "green" | "purple" | "amber" }) {
  const classes = {
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-200",
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-200",
    purple: "bg-violet-50 text-violet-700 dark:bg-violet-950/20 dark:text-violet-200",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-200",
  };

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-semibold">{value}</p>
        </div>
        <div className={`rounded-lg p-2 ${classes[tone]}`}>{icon}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}

function InsightCard({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2 text-muted-foreground">{icon}<span className="text-sm">{title}</span></div>
        <p className="text-base font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}
