/**
 * DelayPredictionSubTab.tsx
 * Sub-tab of AiInsightsTab — runs and displays the AI-generated delay
 * forecast (predict-route-delays edge function), cached in
 * route_delay_predictions (one row per school, upserted on each run).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Sparkles, Loader2, TrendingUp } from "lucide-react";

interface Props {
  schoolId?: string;
}

interface RouteForecast {
  route_label: string;
  risk_level: "low" | "medium" | "high";
  forecast: string;
  reasoning: string;
  recommendation: string;
}

interface PredictionRow {
  overall_summary: string;
  route_forecasts: RouteForecast[];
  generated_at: string;
}

const RISK_COLORS: Record<string, string> = {
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-red-50 text-red-600 border-red-200",
};

export default function DelayPredictionSubTab({ schoolId }: Props) {
  const queryClient = useQueryClient();

  const { data: prediction, isLoading } = useQuery({
    queryKey: ["route-delay-prediction", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("route_delay_predictions")
        .select("*")
        .eq("school_id", schoolId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as PredictionRow | null;
    },
    enabled: !!schoolId,
  });

  const forecastMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("predict-route-delays", {
        body: { school_id: schoolId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.forecast;
    },
    onSuccess: () => {
      toast.success("Forecast complete.");
      queryClient.invalidateQueries({ queryKey: ["route-delay-prediction", schoolId] });
    },
    onError: (e: any) => toast.error(e.message || "Forecast failed"),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
          <span className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-indigo-500" /> Delay Prediction
          </span>
          <Button
            size="sm"
            onClick={() => forecastMutation.mutate()}
            disabled={!schoolId || forecastMutation.isPending}
          >
            {forecastMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Forecasting...</>
            ) : prediction ? (
              <><Sparkles className="h-4 w-4 mr-1.5" /> Re-run Forecast</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-1.5" /> Run Forecast</>
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !prediction && !forecastMutation.isPending ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No forecast yet. Click Run Forecast to analyze the last 30 days of trip data and predict which routes are at risk of delay.
          </p>
        ) : prediction ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm text-slate-700">{prediction.overall_summary}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Last forecast: {new Date(prediction.generated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" })}
            </p>

            <div className="space-y-2.5 pt-2 border-t">
              {(prediction.route_forecasts || []).map((rf, i) => (
                <div key={i} className="border border-slate-200 rounded-xl p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-sm font-semibold text-slate-800">{rf.route_label}</p>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${RISK_COLORS[rf.risk_level]}`}>
                      {rf.risk_level.toUpperCase()} RISK
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-700 mb-1">{rf.forecast}</p>
                  <p className="text-xs text-muted-foreground mb-1.5">{rf.reasoning}</p>
                  <div className="text-xs bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1.5 text-blue-800">
                    <span className="font-medium">Recommendation:</span> {rf.recommendation}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
