import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PredictionResponse {
  predicted_score_pct: number;
  confidence_level: number;
  risk_level: "low" | "medium" | "high";
  recommended_interventions: string[];
  subject_predictions: Record<string, { predicted_pct: number; trend: string }>;
  weekly_forecast: Array<{ week: number; predicted_score: number }>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { student_id } = await req.json();

    if (!student_id) {
      return new Response(
        JSON.stringify({ error: "student_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch student's academic test scores
    const { data: testScores, error: testError } = await supabase
      .from("academic_tests")
      .select("subject, score, total_questions, completed_at")
      .eq("student_id", student_id)
      .order("completed_at", { ascending: false })
      .limit(50);

    if (testError) throw testError;

    if (!testScores || testScores.length === 0) {
      // No historical data - return neutral prediction
      return new Response(
        JSON.stringify({
          predicted_score_pct: 50,
          confidence_level: 30,
          risk_level: "medium",
          recommended_interventions: [
            "Complete more practice tests to establish a baseline",
            "Review fundamental concepts",
            "Start with easier difficulty levels",
          ],
          subject_predictions: {},
          weekly_forecast: Array.from({ length: 8 }, (_, i) => ({
            week: i + 1,
            predicted_score: 50,
          })),
        } as PredictionResponse),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate metrics by subject
    const bySubject: Record<string, { scores: number[]; latest: number; oldest: number }> = {};

    testScores.forEach((test: any) => {
      const pct = test.total_questions > 0 ? (test.score / test.total_questions) * 100 : 0;
      if (!bySubject[test.subject]) {
        bySubject[test.subject] = { scores: [], latest: pct, oldest: pct };
      }
      bySubject[test.subject].scores.push(pct);
      bySubject[test.subject].oldest = pct;
    });

    // Calculate predictions and trends
    const subjectPredictions: Record<string, { predicted_pct: number; trend: string }> = {};
    let totalPredicted = 0;
    let subjectCount = 0;

    for (const [subject, data] of Object.entries(bySubject)) {
      const scores = data.scores;
      const latestScore = data.latest;
      const avgScore = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;

      // Simple linear trend prediction
      const trend = latestScore - data.oldest;
      const predictedScore = Math.min(100, Math.max(0, avgScore + trend * 0.3));

      // Determine trend direction
      const trendDirection =
        trend > 5 ? "📈 Improving" : trend < -5 ? "📉 Declining" : "➡️ Stable";

      subjectPredictions[subject] = {
        predicted_pct: Math.round(predictedScore),
        trend: trendDirection,
      };

      totalPredicted += predictedScore;
      subjectCount++;
    }

    // Calculate overall prediction
    const overallPredicted = subjectCount > 0 ? totalPredicted / subjectCount : 50;
    const recentScores = testScores
      .slice(0, 10)
      .map((t: any) => (t.total_questions > 0 ? (t.score / t.total_questions) * 100 : 0));
    const recentAvg = recentScores.reduce((a: number, b: number) => a + b, 0) / (recentScores.length || 1);
    const volatility = Math.sqrt(
      recentScores.reduce((sum: number, score: number) => sum + Math.pow(score - recentAvg, 2), 0) /
        (recentScores.length || 1)
    );

    // Calculate confidence (inverse of volatility)
    const confidence = Math.max(20, Math.round((1 - volatility / 100) * 100));

    // Determine risk level
    const riskLevel: "low" | "medium" | "high" =
      overallPredicted > 75 ? "low" : overallPredicted > 50 ? "medium" : "high";

    // Generate interventions
    const interventions: string[] = [];
    if (riskLevel === "high") {
      interventions.push("Increase study time by 30 minutes daily");
      interventions.push("Review previous weak topics from homework");
      interventions.push("Schedule a study session with your teacher");
    } else if (riskLevel === "medium") {
      interventions.push("Practice 2-3 sample tests weekly");
      interventions.push("Focus on areas with declining scores");
      interventions.push("Track your progress regularly");
    } else {
      interventions.push("Maintain current study habits");
      interventions.push("Challenge yourself with advanced problems");
      interventions.push("Help peers by explaining concepts");
    }

    // Generate 8-week forecast
    const weeklyForecast = Array.from({ length: 8 }, (_, i) => {
      const weekTrend = (trend * 0.1) / 8; // Distribute trend across 8 weeks
      const weekPredicted = Math.min(100, Math.max(0, overallPredicted + weekTrend * (i + 1)));
      return {
        week: i + 1,
        predicted_score: Math.round(weekPredicted),
      };
    });

    const response: PredictionResponse = {
      predicted_score_pct: Math.round(overallPredicted),
      confidence_level: confidence,
      risk_level: riskLevel,
      recommended_interventions: interventions,
      subject_predictions: subjectPredictions,
      weekly_forecast: weeklyForecast,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("predict-performance error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
