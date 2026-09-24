import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { VelocityBadge, VelocityTrendIndicator } from "./VelocityBadge";
import type { VelocitySubject, VelocityTopic, VelocityConcept } from "@/hooks/useLearningVelocity";

function fmtGain(g: number | null) {
  if (g === null || g === undefined) return "—";
  return `${g >= 0 ? "+" : ""}${Math.round(g * 1000) / 10}%/attempt`;
}

function ConceptRow({ concept }: { concept: VelocityConcept }) {
  return (
    <div className="pl-4 py-2 border-l-2 ml-2 border-muted">
      <div className="flex items-center gap-3 w-full">
        <span className="flex-1 text-sm font-medium truncate">{concept.name}</span>
        <VelocityTrendIndicator trend={concept.trend} className="hidden sm:inline-flex" />
        <span className="text-xs text-muted-foreground w-24 text-right hidden sm:inline">
          {fmtGain(concept.mastery_gain_per_attempt)}
        </span>
        <VelocityBadge label={concept.velocity_label} className="text-[10px] px-1.5 py-0 shrink-0" />
      </div>
      {concept.velocity_label !== "insufficient_data" && (
        <p className="text-[11px] text-muted-foreground mt-1">
          {concept.attempts_count} attempts
          {concept.projected_attempts_to_mastery
            ? ` · ~${concept.projected_attempts_to_mastery} more attempts to mastery`
            : concept.current_mastery !== null && concept.current_mastery >= 0.85
              ? " · already mastered"
              : ""}
        </p>
      )}
    </div>
  );
}

function TopicBlock({ topic }: { topic: VelocityTopic }) {
  return (
    <AccordionItem value={`topic-${topic.id}`} className="border-b-0">
      <AccordionTrigger className="py-2 hover:no-underline">
        <div className="flex items-center gap-3 w-full">
          <span className="flex-1 text-sm font-medium truncate">{topic.name}</span>
          <span className="text-xs text-muted-foreground w-24 text-right hidden sm:inline">
            {fmtGain(topic.avg_gain_per_attempt)}
          </span>
          <span className="text-[11px] text-muted-foreground w-24 text-right hidden sm:inline">
            {topic.fast_count} fast · {topic.slow_count} slow
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        {topic.concepts.map((c) => <ConceptRow key={c.id} concept={c} />)}
      </AccordionContent>
    </AccordionItem>
  );
}

/**
 * Full learning-velocity tree for one student, one subject at a time.
 * Pass a single VelocitySubject (from useVelocityTree()'s `subjects` array).
 */
export function VelocityTree({ subject }: { subject: VelocitySubject }) {
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
            {subject.class_name} · {subject.curriculum ?? "—"} ·{" "}
            {subject.fast_count} fast, {subject.average_count} average, {subject.slow_count} slow concepts
          </p>
        </div>
        <div className="text-right">
          <VelocityBadge label={subject.pace_label} />
          <div className="text-xs text-muted-foreground mt-1">{fmtGain(subject.avg_gain_per_attempt)}</div>
        </div>
      </div>
      <Accordion type="multiple" className="space-y-1">
        {subject.chapters.map((chapter) => (
          <AccordionItem key={chapter.id} value={`chapter-${chapter.id}`}>
            <AccordionTrigger className="py-3 hover:no-underline">
              <div className="flex items-center gap-3 w-full">
                <span className="flex-1 text-sm font-medium truncate">{chapter.name}</span>
                <span className="text-xs text-muted-foreground w-24 text-right hidden sm:inline">
                  {fmtGain(chapter.avg_gain_per_attempt)}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-2">
              <Accordion type="multiple" className="space-y-1">
                {chapter.topics.map((t) => <TopicBlock key={t.id} topic={t} />)}
              </Accordion>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
