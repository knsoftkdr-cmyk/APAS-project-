// Client for the Academic Forecasting Engine.
// Served by the existing `predict-performance` edge function (no new function) via `action: "forecast_overview"`.
import { supabase } from "@/integrations/supabase/client";

export type Direction = "improving" | "declining" | "stable";
export type Confidence = "low" | "medium" | "high";

export interface Forecast {
  ok: boolean;
  reason?: string;
  tests: number;
  months_with_data: number;
  history: { month: string; pct: number; n: number }[];
  projection: { month: string; pct: number; low: number; high: number }[];
  slope_per_month: number | null;
  direction: Direction | null;
  confidence: Confidence | null;
}
export interface GroupForecast { key: string; label: string; students: number; forecast: Forecast }
export interface WatchStudent {
  student_id: string; name: string; subject: string;
  projected_pct: number; recent_avg: number; change: number;
  reason: "low_projection" | "falling";
}
export interface ForecastSignal { severity: "warning" | "info"; message: string; subject?: string; class_id?: string }
export interface ForecastOverview {
  model_version: string;
  scope: "school" | "teacher";
  generated_at: string;
  school: Forecast;
  subjects: GroupForecast[];
  classes: GroupForecast[];
  watchlist: WatchStudent[];
  signals: ForecastSignal[];
  assumptions: Record<string, number | string>;
}

/** Surfaces the function's own error message instead of a generic "non-2xx" one. */
export async function fetchForecastOverview(classId?: string): Promise<ForecastOverview> {
  const { data, error } = await supabase.functions.invoke("predict-performance", {
    body: { action: "forecast_overview", ...(classId ? { class_id: classId } : {}) },
  });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j?.error) message = j.error;
      }
    } catch { /* keep generic message */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as ForecastOverview;
}
