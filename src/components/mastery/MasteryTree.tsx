import { useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrendingUp } from "lucide-react";
import { MasteryBadge } from "./MasteryBadge";
import { MasteryTrendChart } from "./MasteryTrendChart";
import { useMasteryHistory, useConceptMasteryTrend } from "@/hooks/useMasteryHistory";
import type { MasterySubject, MasteryChapter, MasteryTopic, MasteryConcept } from "@/hooks/useMastery";

function pct(p: number) {
  return Math.round((p ?? 0) * 100);
}

function progressColorClass(p: number) {
  if (p >= 0.85) return "[&>div]:bg-emerald-500";
  if (p >= 0.6) return "[&>div]:bg-blue-500";
  if (p >= 0.35) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-rose-500";
}

function MasteryRow({ label, p_mastery, objectiveCount, attemptedCount }: {
  label: string; p_mastery: number; objectiveCount: number; attemptedCount: number;
}) {
  return (
    <div className="flex items-center gap-3 w-full">
      <span className="flex-1 text-sm font-medium truncate">{label}</span>
      {attemptedCount === 0 ? (
        <Badge variant="outline" className="text-xs text-muted-foreground">Not assessed</Badge>
      ) : (
        <span className="text-xs text-muted-foreground w-10 text-right">{pct(p_mastery)}%</span>
      )}
      <Progress value={attemptedCount === 0 ? 0 : pct(p_mastery)} className={`w-24 h-2 ${progressColorClass(p_mastery)}`} />
      <span className="text-[11px] text-muted-foreground w-14 text-right hidden sm:inline">
        {attemptedCount}/{objectiveCount} LOs
      </span>
    </div>
  );
}

function ConceptBlock({ concept, isAtRisk, onSelectConcept, onSelectObjective }: {
  concept: MasteryConcept; isAtRisk?: boolean;
  onSelectConcept?: (id: number, name: string) => void;
  onSelectObjective?: (id: number, text: string) => void;
}) {
  return (
    <div className={`pl-4 py-2 border-l-2 ml-2 ${isAtRisk ? "border-rose-400" : "border-muted"}`}>
      <button
        type="button"
        onClick={() => onSelectConcept?.(concept.id, concept.name)}
        className="flex items-center gap-2 w-full text-left rounded hover:bg-muted/50 -ml-1 pl-1"
      >
        <MasteryRow
          label={concept.name}
          p_mastery={concept.p_mastery}
          objectiveCount={concept.objective_count}
          attemptedCount={concept.attempted_count}
        />
        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>
      {isAtRisk && (
        <p className="text-[11px] text-rose-600 mt-1 flex items-center gap-1">
          ⚠ A prerequisite concept looks weak — review that first.
        </p>
      )}
      <ul className="mt-2 space-y-1.5">
        {concept.objectives.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onSelectObjective?.(o.id, o.text)}
              className="flex items-center gap-2 text-xs text-muted-foreground pl-2 w-full text-left hover:text-foreground"
            >
              <MasteryBadge status={o.status} className="text-[10px] px-1.5 py-0 shrink-0" />
              <span className="flex-1">{o.text}</span>
              {o.opportunities > 0 && <span className="shrink-0">{pct(o.p_mastery)}%</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SelectHandlers {
  onSelectConcept?: (id: number, name: string) => void;
  onSelectObjective?: (id: number, text: string) => void;
}

function TopicBlock({ topic, atRiskIds, ...handlers }: { topic: MasteryTopic; atRiskIds?: Set<number> } & SelectHandlers) {
  return (
    <AccordionItem value={`topic-${topic.id}`} className="border-b-0">
      <AccordionTrigger className="py-2 hover:no-underline">
        <MasteryRow
          label={topic.name}
          p_mastery={topic.p_mastery}
          objectiveCount={topic.objective_count}
          attemptedCount={topic.attempted_count}
        />
      </AccordionTrigger>
      <AccordionContent>
        {topic.concepts.map((c) => (
          <ConceptBlock key={c.id} concept={c} isAtRisk={atRiskIds?.has(c.id)} {...handlers} />
        ))}
      </AccordionContent>
    </AccordionItem>
  );
}

function ChapterBlock({ chapter, atRiskIds, ...handlers }: { chapter: MasteryChapter; atRiskIds?: Set<number> } & SelectHandlers) {
  return (
    <AccordionItem value={`chapter-${chapter.id}`}>
      <AccordionTrigger className="py-3 hover:no-underline">
        <MasteryRow
          label={chapter.name}
          p_mastery={chapter.p_mastery}
          objectiveCount={chapter.objective_count}
          attemptedCount={chapter.attempted_count}
        />
      </AccordionTrigger>
      <AccordionContent className="pl-2">
        <Accordion type="multiple" className="space-y-1">
          {chapter.topics.map((t) => (
            <TopicBlock key={t.id} topic={t} atRiskIds={atRiskIds} {...handlers} />
          ))}
        </Accordion>
      </AccordionContent>
    </AccordionItem>
  );
}

function TrendDialogBody({ selected, studentId }: {
  selected: { type: "concept" | "objective"; id: number; name: string };
  studentId?: string;
}) {
  const conceptTrend = useConceptMasteryTrend(selected.type === "concept" ? selected.id : undefined, studentId);
  const objectiveHistory = useMasteryHistory(selected.type === "objective" ? selected.id : undefined, studentId);
  const { data, isLoading } = selected.type === "concept" ? conceptTrend : objectiveHistory;

  if (isLoading) return <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>;
  return <MasteryTrendChart points={data ?? []} />;
}

/**
 * Full mastery tree for one student, one subject at a time.
 * Pass a single MasterySubject (from useMasteryTree()'s `subjects` array).
 * Optionally pass atRiskSubtopicIds (from useAtRiskConcepts()) to flag
 * concepts where a prerequisite is currently weak, and studentId (staff
 * viewing someone else) — omit it to default to the signed-in student.
 * Clicking a concept or objective opens its mastery-over-time trend.
 */
export function MasteryTree({ subject, atRiskSubtopicIds, studentId }: {
  subject: MasterySubject; atRiskSubtopicIds?: Set<number>; studentId?: string;
}) {
  const [selected, setSelected] = useState<{ type: "concept" | "objective"; id: number; name: string } | null>(null);

  if (!subject.chapters?.length) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No learning objectives generated for {subject.subject} yet.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 pb-3 border-b">
        <div>
          <h3 className="font-semibold">{subject.subject}</h3>
          <p className="text-xs text-muted-foreground">
            {subject.class_name} · {subject.curriculum ?? "—"} · {subject.attempted_count}/{subject.objective_count} learning objectives assessed
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{pct(subject.p_mastery)}%</div>
          <div className="text-xs text-muted-foreground">overall mastery</div>
        </div>
      </div>
      <Accordion type="multiple" className="space-y-1">
        {subject.chapters.map((c) => (
          <ChapterBlock
            key={c.id}
            chapter={c}
            atRiskIds={atRiskSubtopicIds}
            onSelectConcept={(id, name) => setSelected({ type: "concept", id, name })}
            onSelectObjective={(id, text) => setSelected({ type: "objective", id, name: text })}
          />
        ))}
      </Accordion>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{selected?.name}</DialogTitle>
          </DialogHeader>
          {selected && <TrendDialogBody selected={selected} studentId={studentId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
