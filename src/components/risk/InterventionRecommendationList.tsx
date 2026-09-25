import { BookOpen, Dumbbell, UserCheck, PhoneCall, HeartHandshake } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { InterventionRecommendation, InterventionType, InterventionPriority } from "@/hooks/useInterventionRecommendations";

export const TYPE_LABEL: Record<InterventionType, string> = {
  remedial_lesson: "Remedial lesson",
  extra_practice: "Extra practice",
  teacher_intervention: "Teacher check-in",
  parent_communication: "Parent communication",
  counselling: "Counselling referral",
};

const TYPE_ICON: Record<InterventionType, typeof BookOpen> = {
  remedial_lesson: BookOpen,
  extra_practice: Dumbbell,
  teacher_intervention: UserCheck,
  parent_communication: PhoneCall,
  counselling: HeartHandshake,
};

const PRIORITY_STYLES: Record<InterventionPriority, string> = {
  high: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400",
  medium: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400",
  low: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400",
};

/** Renders the Intervention Recommendation Engine's suggestions (module 14). */
export function InterventionRecommendationList({ recommendations, className }: { recommendations: InterventionRecommendation[]; className?: string }) {
  if (recommendations.length === 0) {
    return <p className={cn("text-xs text-muted-foreground", className)}>No intervention needed right now - signals look healthy.</p>;
  }
  return (
    <div className={cn("space-y-2.5", className)}>
      {recommendations.map((rec) => {
        const Icon = TYPE_ICON[rec.type];
        return (
          <div key={rec.type} className="flex items-start gap-2.5">
            <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{TYPE_LABEL[rec.type]}</p>
                <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", PRIORITY_STYLES[rec.priority])}>
                  {rec.priority}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{rec.reason}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
