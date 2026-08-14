/**
 * StudentTravelPatternSubTab.tsx
 * Sub-tab of AiInsightsTab — runs and displays the AI-generated travel
 * pattern analysis (analyze-travel-patterns edge function), cached in
 * student_travel_pattern_insights (one row per school, upserted on each run).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Sparkles, Loader2, Route } from "lucide-react";

interface Props {
  schoolId?: string;
}

interface StopInsight {
  stop_label: string;
  efficiency: "good" | "needs_attention" | "poor";
  insight: string;
}

interface StudentPattern {
  student_name: string;
  pattern: string;
  recommendation: string;
}

interface AnalysisRow {
  overall_summary: string;
  stop_insights: StopInsight[];
  student_patterns: StudentPattern[];
  generated_at: string;
}

const EFFICIENCY_COLORS: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-700 border-emerald-200",
  needs_attention: "bg-amber-50 text-amber-700 border-amber-200",
  poor: "bg-red-50 text-red-600 border-red-200",
};

const IST_FORMAT = { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" } as const;

export default function StudentTravelPatternSubTab({ schoolId }: Props) {
  const queryClient = useQueryClient();

  const { data: analysis, isLoading } = useQuery({
    queryKey: ["travel-pattern-analysis", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_travel_pattern_insights")
        .select("*")
        .eq("school_id", schoolId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as AnalysisRow | null;
    },
    enabled: !!schoolId,
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("analyze-travel-patterns", {
        body: { school_id: schoolId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.analysis;
    },
    onSuccess: () => {
      toast.success("Analysis complete.");
      queryClient.invalidateQueries({ queryKey: ["travel-pattern-analysis", schoolId] });
    },
    onError: (e: any) => toast.error(e.message || "Analysis failed"),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
          <span className="flex items-center gap-2">
            <Route className="h-4 w-4 text-indigo-500" /> Student Travel Pattern Analysis
          </span>
          <Button
            size="sm"
            onClick={() => analyzeMutation.mutate()}
            disabled={!schoolId || analyzeMutation.isPending}
          >
            {analyzeMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Analyzing...</>
            ) : analysis ? (
              <><Sparkles className="h-4 w-4 mr-1.5" /> Re-run Analysis</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-1.5" /> Run Analysis</>
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !analysis && !analyzeMutation.isPending ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No analysis yet. Click Run Analysis to check stop efficiency and individual student boarding patterns over the last 30 days.
          </p>
        ) : analysis ? (
          <div className="space-y-5">
            <div>
              <p className="text-sm text-slate-700">{analysis.overall_summary}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Last analyzed: {new Date(analysis.generated_at).toLocaleString("en-IN", IST_FORMAT)}
              </p>
            </div>

            {analysis.stop_insights?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Stop Efficiency</p>
                <div className="space-y-2">
                  {analysis.stop_insights.map((s, i) => (
                    <div key={i} className="border border-slate-200 rounded-xl p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm font-semibold text-slate-800">{s.stop_label}</p>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${EFFICIENCY_COLORS[s.efficiency]}`}>
                          {s.efficiency.replace("_", " ")}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.insight}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.student_patterns?.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Individual Student Patterns</p>
                <div className="space-y-2">
                  {analysis.student_patterns.map((s, i) => (
                    <div key={i} className="border border-slate-200 rounded-xl p-3">
                      <p className="text-sm font-semibold text-slate-800 mb-1">{s.student_name}</p>
                      <p className="text-xs text-muted-foreground mb-1.5">{s.pattern}</p>
                      <div className="text-xs bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1.5 text-blue-800">
                        <span className="font-medium">Recommendation:</span> {s.recommendation}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No individual students flagged for review.</p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
