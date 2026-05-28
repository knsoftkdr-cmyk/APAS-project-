import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  Brain, CheckCircle2, AlertTriangle, Lightbulb, Loader2, Sparkles,
  TrendingUp, TrendingDown, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AnalysisData {
  strengths: { concept: string; detail: string }[];
  weaknesses: { concept: string; detail: string }[];
  suggestions: { title: string; description: string }[];
  overall_summary: string;
}

interface TestAnalysisProps {
  subject: string;
  studentClass: string;
  topic?: string;
  questions: any[];
  answers: Record<string, string>;
}

export function TestAnalysis({ subject, studentClass, topic, questions, answers }: TestAnalysisProps) {
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("analyze-test-results", {
        body: { subject, studentClass, topic, questions, answers },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setAnalysis(data.analysis);
    } catch (err: any) {
      setError(err.message || "Failed to generate analysis");
    } finally {
      setLoading(false);
    }
  };

  if (!analysis && !loading && !error) {
    return (
      <Card className="border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5">
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Brain className="h-10 w-10 text-primary mb-3" />
          <h3 className="text-base font-semibold mb-1">AI Performance Analysis</h3>
          <p className="text-sm text-muted-foreground text-center mb-4 max-w-sm">
            Get personalized insights on your strengths, areas to improve, and actionable suggestions for {subject}
          </p>
          <Button onClick={fetchAnalysis} className="gap-2">
            <Sparkles className="h-4 w-4" /> Analyze My Performance
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-10">
          <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
          <p className="text-sm text-muted-foreground">Analyzing your performance...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="flex flex-col items-center justify-center py-8">
          <AlertTriangle className="h-8 w-8 text-red-500 mb-3" />
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <Button onClick={fetchAnalysis} variant="outline" size="sm">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!analysis) return null;

  return (
    <div className="space-y-4">
      {/* Overall Summary */}
      <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Brain className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h4 className="text-sm font-semibold mb-1">AI Performance Summary</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{analysis.overall_summary}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Strengths */}
        <Card className="border-emerald-200">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2 text-emerald-700">
              <TrendingUp className="h-4 w-4" /> Strong Concepts
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {analysis.strengths.length > 0 ? (
              <div className="space-y-2">
                {analysis.strengths.map((s, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-sm font-medium">{s.concept}</span>
                      <p className="text-xs text-muted-foreground">{s.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Keep practicing to build strengths!</p>
            )}
          </CardContent>
        </Card>

        {/* Weaknesses */}
        <Card className="border-amber-200">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
              <TrendingDown className="h-4 w-4" /> Areas to Improve
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {analysis.weaknesses.length > 0 ? (
              <div className="space-y-2">
                {analysis.weaknesses.map((w, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-sm font-medium">{w.concept}</span>
                      <p className="text-xs text-muted-foreground">{w.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Great job — no major gaps found!</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Suggestions */}
      <Card className="border-blue-200">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2 text-blue-700">
            <Lightbulb className="h-4 w-4" /> Suggestions to Improve
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-3">
            {analysis.suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <Badge variant="outline" className="shrink-0 mt-0.5 text-[10px] px-1.5 py-0 h-5 border-blue-300 text-blue-700">
                  {i + 1}
                </Badge>
                <div>
                  <span className="text-sm font-medium">{s.title}</span>
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
