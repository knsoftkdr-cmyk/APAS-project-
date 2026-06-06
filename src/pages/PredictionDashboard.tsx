import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { AlertCircle, TrendingUp, Brain, Target, Zap } from "lucide-react";
import statisticsBanner from "@/assets/statistics-banner.png";

interface PredictionData {
  predicted_score_pct: number;
  confidence_level: number;
  risk_level: "low" | "medium" | "high";
  recommended_interventions: string[];
  subject_predictions: Record<string, { predicted_pct: number; trend: string }>;
  weekly_forecast: Array<{ week: number; predicted_score: number }>;
}

export default function PredictionDashboard() {
  const { user, profile } = useAuth();

  // Fetch predictions
  const { data: predictions, isLoading: predictionsLoading, error: predictionsError } = useQuery({
    queryKey: ["predictions", user?.id],
    queryFn: async () => {
      if (profile?.role !== "student") {
        throw new Error("Only students can view predictions");
      }

      const { data, error } = await supabase.functions.invoke("predict-performance", {
        body: { student_id: user?.id },
      });

      if (error) throw error;
      return data as PredictionData;
    },
    enabled: !!user?.id && profile?.role === "student",
  });

  // Fetch historical performance for comparison
  const { data: history } = useQuery({
    queryKey: ["performance-history", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_tests")
        .select("subject, score, total_questions, completed_at")
        .eq("student_id", user?.id)
        .order("completed_at", { ascending: false })
        .limit(20);

      if (error) throw error;

      // Calculate average by subject
      const bySubject: Record<string, number[]> = {};
      data.forEach(test => {
        const pct = test.total_questions > 0 ? (test.score / test.total_questions) * 100 : 0;
        if (!bySubject[test.subject]) bySubject[test.subject] = [];
        bySubject[test.subject].push(pct);
      });

      return Object.entries(bySubject).map(([subject, scores]) => ({
        subject,
        average: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        latest: scores[0],
        trend: scores[0] - (scores[scores.length - 1] || 0),
      }));
    },
    enabled: !!user?.id,
  });

  if (profile?.role !== "student") {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="w-full max-w-md">
            <CardContent className="py-12 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-amber-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Not Available</h3>
              <p className="text-sm text-muted-foreground">
                Only students can view performance predictions. Teachers and admins can view class analytics instead.
              </p>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (predictionsLoading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  if (predictionsError) {
    return (
      <AppLayout>
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex items-center gap-4">
              <AlertCircle className="h-8 w-8 text-destructive flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-destructive">Failed to Load Predictions</h3>
                <p className="text-sm text-muted-foreground">
                  Please ensure you've completed an assessment first.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "low":
        return "bg-emerald-100 text-emerald-800 border-emerald-300";
      case "medium":
        return "bg-amber-100 text-amber-800 border-amber-300";
      case "high":
        return "bg-red-100 text-red-800 border-red-300";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const forecastData = predictions?.weekly_forecast || [];
  const radarData = history?.map(h => ({
    subject: h.subject,
    current: h.latest,
    predicted: predictions?.subject_predictions[h.subject]?.predicted_pct || 0,
  })) || [];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-blue-400 via-blue-0 to-blue-400 p-8 relative min-h-[220px]">
<div className="hidden md:block">
          <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/60"></div>
          <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/80"></div>
          <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>


          <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
          <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
          <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>
          
          <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
          <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
          <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
          <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

          <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

          <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

          <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>
</div>

  <div className="max-w-xl">
    <h1 className="text-4xl font-bold text-slate-900">
      Performance Predictions
    </h1>

    <p className="mt-3 text-slate-700 text-lg">
      AI-powered forecast of your academic performance
    </p>
  </div>

  <img
    src={statisticsBanner}
    alt="Statistics Banner"
    /* className="absolute right-10 bottom-0 h-[160px]" */
    className="hidden md:block absolute right-10 bottom-6 w-40"
  />
</div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">Predicted Score</div>
                  <div className="text-3xl font-bold">{Math.round(predictions?.predicted_score_pct || 0)}%</div>
                </div>
                <TrendingUp className="h-8 w-8 text-primary opacity-20" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">Confidence</div>
                  <div className="text-3xl font-bold">{Math.round((predictions?.confidence_level || 0) * 100)}%</div>
                </div>
                <Brain className="h-8 w-8 text-blue-500 opacity-20" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">Risk Level</div>
                  <Badge className={`mt-2 ${getRiskColor(predictions?.risk_level || "medium")}`}>
                    {predictions?.risk_level?.toUpperCase() || "MEDIUM"}
                  </Badge>
                </div>
                <AlertCircle className={`h-8 w-8 opacity-20 ${
                  predictions?.risk_level === "high" ? "text-red-500" :
                  predictions?.risk_level === "medium" ? "text-amber-500" : "text-emerald-500"
                }`} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">Action Items</div>
                  <div className="text-3xl font-bold text-amber-600">
                    {predictions?.recommended_interventions?.length || 0}
                  </div>
                </div>
                <Target className="h-8 w-8 text-amber-500 opacity-20" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recommended Interventions */}
        {predictions?.recommended_interventions && predictions.recommended_interventions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Recommended Actions
              </CardTitle>
              <CardDescription>
                Personalized interventions to improve your performance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {predictions.recommended_interventions.map((action, idx) => (
                  <li key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold">
                      {idx + 1}
                    </div>
                    <span className="text-sm">{action}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Weekly Forecast */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Weekly Forecast</CardTitle>
              <CardDescription>Predicted scores for the next 8 weeks</CardDescription>
            </CardHeader>
            <CardContent>
              {forecastData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={forecastData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip formatter={(value) => `${value}%`} />
                    <Line
                      type="monotone"
                      dataKey="predicted_score"
                      stroke="#3b82f6"
                      dot={{ r: 4 }}
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                  Insufficient data for forecast
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subject Comparison */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Subject Analysis</CardTitle>
              <CardDescription>Current vs. Predicted performance by subject</CardDescription>
            </CardHeader>
            <CardContent>
              {radarData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="subject" />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} />
                    <Radar name="Current" dataKey="current" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.5} />
                    <Radar name="Predicted" dataKey="predicted" stroke="#10b981" fill="#10b981" fillOpacity={0.5} />
                    <Legend />
                    <Tooltip formatter={(value) => `${Math.round(value)}%`} />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                  No subject data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Subject Details */}
        {history && history.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Subject Performance Trends</CardTitle>
              <CardDescription>Latest score vs. average and prediction</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {history.map((subj) => (
                  <div key={subj.subject} className="p-4 rounded-lg border">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">{subj.subject}</h4>
                      <Badge
                        variant={subj.trend > 0 ? "default" : "secondary"}
                        className={subj.trend > 0 ? "bg-emerald-600" : ""}
                      >
                        {subj.trend > 0 ? "📈" : "📉"} {Math.round(subj.trend)}%
                      </Badge>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Latest:</span>{" "}
                        <span className="font-semibold">{subj.latest}%</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Average:</span>{" "}
                        <span className="font-semibold">{subj.average}%</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Predicted:</span>{" "}
                        <span className="font-semibold text-blue-600">
                          {predictions?.subject_predictions[subj.subject]?.predicted_pct || "—"}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
