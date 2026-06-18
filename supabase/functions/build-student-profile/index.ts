// Personalization Engine — builds a dynamic student profile that goes
// beyond static VARK. Returns a single JSON snapshot used by the AI Tutor,
// lesson generator, and homework system to tailor content.
//
// Inputs : { student_id }   (uses caller auth where possible)
// Output : { profile: {...}, sources: [...] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface BuildProfileResult {
  student_id: string;
  identity: {
    full_name: string | null;
    grade: string | null;
    age: number | null;
    curriculum: string | null;
  };
  learning_style: {
    vark: string | null;            // legacy single label
    vark_distribution: Record<string, number> | null;
    dominant_intelligence: string | null;
    confidence: "low" | "medium" | "high";
  };
  cognitive: {
    zpd_score: number | null;
    avg_recent_score_pct: number | null;
    normalized_gain_avg: number | null;
    trend: "improving" | "declining" | "stable" | "unknown";
  };
  mastery: {
    strong_subjects: string[];
    weak_subjects: string[];
    weak_topics: string[];
  };
  engagement: {
    homework_completion_pct: number | null;
    last_active_at: string | null;
    games_played: number;
    brain_level: string | null;
  };
  risk: {
    level: string | null;
    dropout_risk_pct: number | null;
  };
  recommended: {
    pace: "slow" | "standard" | "accelerated";
    modality_priority: string[];      // e.g. ["Visual","Kinesthetic"]
    next_focus_topics: string[];
  };
  generated_at: string;
}

function trendOf(values: number[]): "improving" | "declining" | "stable" | "unknown" {
  if (values.length < 2) return "unknown";
  const first = values.slice(0, Math.ceil(values.length / 2));
  const last = values.slice(Math.ceil(values.length / 2));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const d = avg(last) - avg(first);
  if (d > 5) return "improving";
  if (d < -5) return "declining";
  return "stable";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { student_id } = await req.json();
    if (!student_id) {
      return new Response(JSON.stringify({ error: "student_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Identity ----
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", student_id).maybeSingle();

    const { data: student } = await supabase
      .from("students")
      .select("id, grade, age, curriculum, vark_type, zpd_score, dominant_intelligence")
      .eq("profile_id", student_id).maybeSingle();

    // ---- Recent academic test performance ----
    const { data: tests } = await supabase
      .from("academic_tests")
      .select("subject, score, total_questions, completed_at")
      .eq("student_id", student_id)
      .order("completed_at", { ascending: false })
      .limit(15);

    const testPcts = (tests || []).map(t =>
      t.total_questions > 0 ? (t.score / t.total_questions) * 100 : 0,
    );
    const avgRecent = testPcts.length
      ? Math.round(testPcts.reduce((a, b) => a + b, 0) / testPcts.length)
      : null;

    const subjectAgg: Record<string, { sum: number; n: number }> = {};
    (tests || []).forEach(t => {
      const pct = t.total_questions > 0 ? (t.score / t.total_questions) * 100 : 0;
      const key = t.subject || "Unknown";
      if (!subjectAgg[key]) subjectAgg[key] = { sum: 0, n: 0 };
      subjectAgg[key].sum += pct;
      subjectAgg[key].n += 1;
    });
    const subjectAvgs = Object.entries(subjectAgg)
      .map(([s, v]) => ({ subject: s, avg: v.sum / v.n }));
    const strong = subjectAvgs.filter(s => s.avg >= 70).map(s => s.subject);
    const weak = subjectAvgs.filter(s => s.avg < 60).map(s => s.subject);

    // ---- Performance records / normalized gain ----
    let normalizedGainAvg: number | null = null;
    try {
      const { data: studentRow } = await supabase
        .from("students").select("id").eq("profile_id", student_id).maybeSingle();
      if (studentRow?.id) {
        const { data: perf } = await supabase
          .from("performance_records")
          .select("normalized_gain")
          .eq("student_id", studentRow.id)
          .order("recorded_at", { ascending: false })
          .limit(10);
        const gains = (perf || []).map(p => p.normalized_gain).filter((g): g is number => typeof g === "number");
        if (gains.length) {
          normalizedGainAvg = +(gains.reduce((a, b) => a + b, 0) / gains.length).toFixed(2);
        }
      }
    } catch (_) { /* ignore */ }

    // ---- Homework engagement ----
    const { data: subs } = await supabase
      .from("homework_submissions")
      .select("completed, submission_percentage, submitted_at")
      .eq("student_id", student_id)
      .order("created_at", { ascending: false })
      .limit(20);
    const totalSubs = subs?.length || 0;
    const completed = (subs || []).filter(s => s.completed).length;
    const hwPct = totalSubs ? Math.round((completed / totalSubs) * 100) : null;

    // ---- Gamification ----
    const { data: game } = await supabase
      .from("student_game_profiles")
      .select("brain_level, total_games_played, last_played_at, avg_accuracy")
      .eq("student_id", student_id).maybeSingle();

    // ---- Risk prediction ----
    const { data: pred } = await supabase
      .from("student_predictions")
      .select("risk_level, dropout_risk_percentage, contributing_factors")
      .eq("student_id", student?.id ?? student_id)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();

    // ---- VARK distribution from latest student_assessment ----
    let varkDist: Record<string, number> | null = null;
    let varkConfidence: "low" | "medium" | "high" = "low";
    const { data: assess } = await supabase
      .from("student_assessments")
      .select("responses, created_at")
      .eq("submitted_by", student_id)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (assess?.responses && typeof assess.responses === "object") {
      const counts = { V: 0, A: 0, R: 0, K: 0 };
      let total = 0;
      for (const v of Object.values(assess.responses as Record<string, unknown>)) {
        if (typeof v === "string" && v in counts) {
          counts[v as keyof typeof counts]++;
          total++;
        }
      }
      if (total > 0) {
        varkDist = {
          Visual: Math.round((counts.V / total) * 100),
          Auditory: Math.round((counts.A / total) * 100),
          ReadWrite: Math.round((counts.R / total) * 100),
          Kinesthetic: Math.round((counts.K / total) * 100),
        };
        varkConfidence = total >= 20 ? "high" : total >= 10 ? "medium" : "low";
      }
    }

    // ---- Recommendations ----
    const trend = trendOf(testPcts.slice().reverse()); // chronological
    const pace: "slow" | "standard" | "accelerated" =
      (avgRecent ?? 0) >= 80 ? "accelerated" :
      (avgRecent ?? 0) < 50 ? "slow" : "standard";

    const modalityPriority = varkDist
      ? Object.entries(varkDist).sort((a, b) => b[1] - a[1]).map(([k]) => k)
      : student?.vark_type ? [student.vark_type] : ["Visual", "Kinesthetic"];

    const result: BuildProfileResult = {
      student_id,
      identity: {
        full_name: profile?.full_name ?? null,
        grade: student?.grade ?? null,
        age: student?.age ?? null,
        curriculum: student?.curriculum ?? null,
      },
      learning_style: {
        vark: student?.vark_type ?? null,
        vark_distribution: varkDist,
        dominant_intelligence: student?.dominant_intelligence ?? null,
        confidence: varkConfidence,
      },
      cognitive: {
        zpd_score: student?.zpd_score ?? null,
        avg_recent_score_pct: avgRecent,
        normalized_gain_avg: normalizedGainAvg,
        trend,
      },
      mastery: {
        strong_subjects: strong,
        weak_subjects: weak,
        weak_topics: weak, // topic-level requires lesson linkage; using subjects as proxy
      },
      engagement: {
        homework_completion_pct: hwPct,
        last_active_at: game?.last_played_at ?? null,
        games_played: game?.total_games_played ?? 0,
        brain_level: game?.brain_level ?? null,
      },
      risk: {
        level: pred?.risk_level ?? null,
        dropout_risk_pct: pred?.dropout_risk_percentage ?? null,
      },
      recommended: {
        pace,
        modality_priority: modalityPriority,
        next_focus_topics: weak.slice(0, 3),
      },
      generated_at: new Date().toISOString(),
    };

    return new Response(
      JSON.stringify({ profile: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("build-student-profile error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
