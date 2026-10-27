// src/hooks/useClassBriefing.ts
// AI class briefing (sheet row 41). Data: ai-teacher-assistant { action: "class_briefing" } - see
// supabase/functions/_shared/handlers/classBriefing.ts. Cached server-side per teacher per day.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { invokeFn } from "@/hooks/useExamIntelligence";

export interface ClassBriefing {
  headline: string;
  priorities: string[];
  classes: Array<{ class_id: string; label: string; summary: string; focus: string | null }>;
  learning_issues: string[];
  outstanding: { attendance_unmarked: number; submissions_to_grade: number; exam_attempts_to_review: number; homework_due_soon: number; at_risk: number };
  source: "ai" | "rules";
  date: string;
  generated_at: string;
  cached: boolean;
}

const tz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata"; } catch { return "Asia/Kolkata"; }
};

export function useClassBriefing() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["class-briefing", user?.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => invokeFn<ClassBriefing>("ai-teacher-assistant", { action: "class_briefing", tz: tz() }),
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await invokeFn<ClassBriefing>("ai-teacher-assistant", { action: "class_briefing", tz: tz(), refresh: true });
      qc.setQueryData(key, fresh);
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, user?.id]);

  return { ...query, refresh, refreshing };
}
