import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { school_id } = await req.json();
    if (!school_id) {
      return new Response(JSON.stringify({ error: "school_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Students & teachers ──────────────────────────────────────────────────
    const { data: students } = await supabase
      .from("students").select("id, profile_id, class, section").eq("school_id", school_id);
    const { count: teacherCount } = await supabase
      .from("profiles").select("*", { count: "exact", head: true }).eq("role", "teacher").eq("school_id", school_id);

    const studentIds = (students || []).map((s) => s.id);
    const profileIds = (students || []).map((s) => s.profile_id).filter(Boolean);

    // ── At-risk breakdown ─────────────────────────────────────────────────────
    const { data: preds } = studentIds.length
      ? await supabase.from("student_predictions").select("student_id, risk_level, dropout_risk_percentage").in("student_id", studentIds)
      : { data: [] as any[] };
// Dedupe by student first — if a student has multiple subject predictions,
    // use their worst (highest-severity) risk level so they're counted once,
    // not once per subject.
    const riskRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
    const worstRiskByStudent = new Map<string, string>();
    (preds || []).forEach((p: any) => {
      const current = worstRiskByStudent.get(p.student_id);
      if (!current || riskRank[p.risk_level] > riskRank[current]) {
        worstRiskByStudent.set(p.student_id, p.risk_level);
      }
    });
    const dedupedRiskLevels = Array.from(worstRiskByStudent.values());
    const highRisk = dedupedRiskLevels.filter((r) => r === "high").length;
    const medRisk = dedupedRiskLevels.filter((r) => r === "medium").length;
    const lowRisk = dedupedRiskLevels.filter((r) => r === "low").length;

    // ── Academic performance (real, from academic_tests.student_class) ──────
const { data: tests } = profileIds.length
      ? await supabase.from("academic_tests").select("student_id, student_class, score, total_questions").in("student_id", profileIds)
      : { data: [] as any[] };
// Step 1: Group each test's percentage by student (within their grade)
    const byStudentInGrade: Record<string, Record<string, number[]>> = {};
    (tests || []).forEach((t: any) => {
      const pct = t.total_questions > 0 ? (t.score / t.total_questions) * 100 : null;
      if (pct === null) return;
      (byStudentInGrade[t.student_class] ||= {});
      (byStudentInGrade[t.student_class][t.student_id] ||= []).push(pct);
    });

    // Step 2: Average each student's own tests → one average per student
    // Step 3: Average those student-averages together → the grade's true average
    const gradeAverages = Object.entries(byStudentInGrade).map(([grade, studentScores]) => {
      const studentAverages = Object.values(studentScores).map(
        (scores) => scores.reduce((a, b) => a + b, 0) / scores.length
      );
      const gradeAvg = studentAverages.reduce((a, b) => a + b, 0) / studentAverages.length;
      return {
        grade,
        avg_score: Math.round(gradeAvg),
        test_count: (tests || []).filter((t: any) => t.student_class === grade).length,
        student_count: studentAverages.length,
      };
    }).sort((a, b) => b.avg_score - a.avg_score);

// Same per-student-then-overall approach as gradeAverages: each student's
    // own average counts once, regardless of how many tests they took —
    // prevents frequent test-takers from skewing the school-wide number.
    const byStudentOverall: Record<string, number[]> = {};
    (tests || []).forEach((t: any) => {
      const pct = t.total_questions > 0 ? (t.score / t.total_questions) * 100 : null;
      if (pct === null) return;
      (byStudentOverall[t.student_id] ||= []).push(pct);
    });
    const allStudentAverages = Object.values(byStudentOverall).map(
      (scores) => scores.reduce((a, b) => a + b, 0) / scores.length
    );
    const overallAvgScore = allStudentAverages.length
      ? Math.round(allStudentAverages.reduce((a, b) => a + b, 0) / allStudentAverages.length)
      : null;

    // ── Homework summary ──────────────────────────────────────────────────────
const { data: assignments } = await supabase
      .from("homework_assignments").select("id, class_level, section, assigned_student_count").eq("school_id", school_id);
    const assignmentIds = (assignments || []).map((a: any) => a.id);
    const { count: submittedCount } = assignmentIds.length
      ? await supabase.from("homework_submissions").select("id", { count: "exact", head: true }).in("assignment_id", assignmentIds).not("submitted_at", "is", null)
      : { count: 0 };
    const { count: pendingEvalCount } = assignmentIds.length
      ? await supabase.from("homework_submissions").select("id", { count: "exact", head: true }).in("assignment_id", assignmentIds).is("teacher_score", null).not("submitted_at", "is", null)
      : { count: 0 };

    // Expected submissions = sum of how many students each assignment actually targeted.
    // Most rows have assigned_student_count populated; for older rows missing it,
    // fall back to counting real students in that class/section from `students`.
    const assignmentsMissingCount = (assignments || []).filter(
      (a: any) => !a.assigned_student_count
    );
    let fallbackCountByAssignment = new Map<string, number>();
    if (assignmentsMissingCount.length > 0) {
      const classSectionPairs = [...new Set(
        assignmentsMissingCount.map((a: any) => `${a.class_level}|||${a.section}`)
      )];
      for (const pair of classSectionPairs) {
        const [classLevel, section] = pair.split("|||");
        const classNumber = classLevel.replace("Class ", "").trim();
        const { count } = await supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("school_id", school_id)
          .eq("class", classNumber)
          .eq("section", section);
        assignmentsMissingCount
          .filter((a: any) => `${a.class_level}|||${a.section}` === pair)
          .forEach((a: any) => fallbackCountByAssignment.set(a.id, count || 0));
      }
    }

    const expectedSubmissions = (assignments || []).reduce((sum: number, a: any) => {
      const count = a.assigned_student_count || fallbackCountByAssignment.get(a.id) || 0;
      return sum + count;
    }, 0);
    const homeworkCompletionPct = expectedSubmissions > 0 ? Math.round(((submittedCount || 0) / expectedSubmissions) * 100) : null;

    // ── Assessment summary: combine academic_tests + Semester Engine's semester_marks ──
    const { data: semMarks } = await supabase
      .from("semester_marks")
      .select("marks_obtained, max_marks")
      .eq("school_id", school_id);

    // Build one combined list of percentage scores from both sources
    const testPercentages = (tests || [])
      .map((t: any) => t.total_questions > 0 ? (t.score / t.total_questions) * 100 : null)
      .filter((p: number | null): p is number => p !== null);
    const semMarkPercentages = (semMarks || [])
      .map((m: any) => m.marks_obtained !== null && m.max_marks > 0 ? (m.marks_obtained / m.max_marks) * 100 : null)
      .filter((p: number | null): p is number => p !== null);

    const combinedPercentages = [...testPercentages, ...semMarkPercentages];
    const assessmentConducted = combinedPercentages.length;
    const assessmentAvgScore = assessmentConducted > 0
      ? Math.round(combinedPercentages.reduce((a, b) => a + b, 0) / assessmentConducted)
      : null;
    // Using the same 40% pass threshold across both sources for consistency —
    // note this differs from Semester Engine's own GPA pass cutoff (GPA >= 5,
    // i.e. 50%), since GPA pass/fail is a separate business rule tied to
    // report cards, not a general "did they pass this assessment" signal.
    const assessmentPassCount = combinedPercentages.filter((p) => p >= 40).length;
    const assessmentPassRate = assessmentConducted > 0 ? Math.round((assessmentPassCount / assessmentConducted) * 100) : null;

    // ── Behaviour summary (from teacher_notes, school-wide) ──────────────────
    const { data: teacherProfiles } = await supabase.from("profiles").select("id").eq("role", "teacher").eq("school_id", school_id);
    const teacherIds = (teacherProfiles || []).map((t: any) => t.id);
    const { data: notes } = teacherIds.length
      ? await supabase.from("teacher_notes").select("note_type, follow_up_completed").in("teacher_id", teacherIds)
      : { data: [] as any[] };
    const positiveCount = (notes || []).filter((n: any) => n.note_type === "positive").length;
    const concernCount = (notes || []).filter((n: any) => n.note_type === "concern").length;
    const incidentCount = (notes || []).filter((n: any) => n.note_type === "incident").length;
    const resolvedCount = (notes || []).filter((n: any) => n.follow_up_completed).length;

    // ── Intervention summary ──────────────────────────────────────────────────
    const { data: interventions } = teacherIds.length
      ? await supabase.from("student_interventions").select("status").in("teacher_id", teacherIds)
      : { data: [] as any[] };
    const ivCreated = (interventions || []).length;
    const ivCompleted = (interventions || []).filter((i: any) => i.status === "completed").length;
    const ivActive = (interventions || []).filter((i: any) => i.status === "active").length;
    const ivSuccessRate = ivCreated > 0 ? Math.round((ivCompleted / ivCreated) * 100) : null;

// ── Teacher workload summary ──────────────────────────────────────────────
    // Composite score built from real signals, not just class count:
    //   1. Classes taught (baseline load)
    //   2. Active interventions (direct ongoing extra work)
    //   3. Pending homework evaluations (ungraded submissions waiting on them)
    //   4. Homework assignments created (content prep volume)
    //   5. Worksheets assigned (content prep volume)
    //   6. At-risk students in their classes (students needing closer attention)
    const { data: classTeacherRows } = teacherIds.length
      ? await supabase.from("class_teachers").select("teacher_id, class_id").in("teacher_id", teacherIds)
      : { data: [] as any[] };
    const classCountByTeacher = new Map<string, number>();
    const classIdsByTeacher = new Map<string, string[]>();
    (classTeacherRows || []).forEach((c: any) => {
      classCountByTeacher.set(c.teacher_id, (classCountByTeacher.get(c.teacher_id) || 0) + 1);
      const list = classIdsByTeacher.get(c.teacher_id) || [];
      list.push(c.class_id);
      classIdsByTeacher.set(c.teacher_id, list);
    });

    // Students in each teacher's classes (for at-risk lookup)
    const allClassIds = (classTeacherRows || []).map((c: any) => c.class_id);
    const { data: classStudentRows } = allClassIds.length
      ? await supabase.from("class_students").select("class_id, student_id").in("class_id", allClassIds)
      : { data: [] as any[] };
    const studentIdsByClass = new Map<string, string[]>();
    (classStudentRows || []).forEach((cs: any) => {
      const list = studentIdsByClass.get(cs.class_id) || [];
      list.push(cs.student_id);
      studentIdsByClass.set(cs.class_id, list);
    });

    // Active interventions per teacher (reuse `interventions` already fetched above)
    const activeInterventionsByTeacher = new Map<string, number>();
    (interventions || []).forEach((i: any) => {
      if (i.status === "active") {
        // interventions doesn't include teacher_id in the select above for this scope,
        // so we recompute directly per-teacher below instead.
      }
    });
    const { data: interventionRows } = teacherIds.length
      ? await supabase.from("student_interventions").select("teacher_id, status").in("teacher_id", teacherIds)
      : { data: [] as any[] };
    (interventionRows || []).forEach((i: any) => {
      if (i.status === "active") {
        activeInterventionsByTeacher.set(i.teacher_id, (activeInterventionsByTeacher.get(i.teacher_id) || 0) + 1);
      }
    });

    // Pending homework evaluations per teacher (homework_assignments.assigned_by = teacher)
    const { data: teacherAssignments } = teacherIds.length
      ? await supabase.from("homework_assignments").select("id, assigned_by").in("assigned_by", teacherIds)
      : { data: [] as any[] };
    const assignmentIdsByTeacher = new Map<string, string[]>();
    (teacherAssignments || []).forEach((a: any) => {
      const list = assignmentIdsByTeacher.get(a.assigned_by) || [];
      list.push(a.id);
      assignmentIdsByTeacher.set(a.assigned_by, list);
    });
    const allTeacherAssignmentIds = (teacherAssignments || []).map((a: any) => a.id);
    const { data: pendingSubs } = allTeacherAssignmentIds.length
      ? await supabase.from("homework_submissions").select("assignment_id").in("assignment_id", allTeacherAssignmentIds).is("teacher_score", null).not("submitted_at", "is", null)
      : { data: [] as any[] };
    const assignmentToTeacher = new Map<string, string>();
    (teacherAssignments || []).forEach((a: any) => assignmentToTeacher.set(a.id, a.assigned_by));
    const pendingEvalByTeacher = new Map<string, number>();
    (pendingSubs || []).forEach((s: any) => {
      const teacherId = assignmentToTeacher.get(s.assignment_id);
      if (teacherId) pendingEvalByTeacher.set(teacherId, (pendingEvalByTeacher.get(teacherId) || 0) + 1);
    });

    // Homework assignments created count per teacher
    const homeworkCountByTeacher = new Map<string, number>();
    (teacherAssignments || []).forEach((a: any) => {
      homeworkCountByTeacher.set(a.assigned_by, (homeworkCountByTeacher.get(a.assigned_by) || 0) + 1);
    });

    // Worksheets assigned per teacher
    const { data: worksheetRows } = teacherIds.length
      ? await supabase.from("worksheet_assignments").select("teacher_id").in("teacher_id", teacherIds)
      : { data: [] as any[] };
    const worksheetCountByTeacher = new Map<string, number>();
    (worksheetRows || []).forEach((w: any) => {
      worksheetCountByTeacher.set(w.teacher_id, (worksheetCountByTeacher.get(w.teacher_id) || 0) + 1);
    });

    // At-risk students across each teacher's classes (dedup by student, count high+medium)
    const atRiskCountByTeacher = new Map<string, number>();
    teacherIds.forEach((teacherId: string) => {
      const classIds = classIdsByTeacher.get(teacherId) || [];
      const studentIdSet = new Set<string>();
      classIds.forEach((cid) => (studentIdsByClass.get(cid) || []).forEach((sid) => studentIdSet.add(sid)));
      const atRisk = (preds || []).filter((p: any) => studentIdSet.has(p.student_id) && (p.risk_level === "high" || p.risk_level === "medium"));
      atRiskCountByTeacher.set(teacherId, new Set(atRisk.map((p: any) => p.student_id)).size);
    });

    const { data: teacherNames } = teacherIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", teacherIds)
      : { data: [] as any[] };

    // Composite score — weights reflect relative effort per unit:
    // active intervention (3), pending grading (2), at-risk student (2),
    // homework created (1), worksheet assigned (1), class taught (1)
    const teacherSummary = (teacherNames || []).map((t: any) => {
      const classAssignments = classCountByTeacher.get(t.id) || 0;
      const activeInterventions = activeInterventionsByTeacher.get(t.id) || 0;
      const pendingEvaluations = pendingEvalByTeacher.get(t.id) || 0;
      const homeworkCreated = homeworkCountByTeacher.get(t.id) || 0;
      const worksheetsAssigned = worksheetCountByTeacher.get(t.id) || 0;
      const atRiskStudents = atRiskCountByTeacher.get(t.id) || 0;

      const score =
        classAssignments * 1 +
        activeInterventions * 3 +
        pendingEvaluations * 2 +
        homeworkCreated * 1 +
        worksheetsAssigned * 1 +
        atRiskStudents * 2;

      const workload: "Low" | "Medium" | "High" = score >= 15 ? "High" : score >= 7 ? "Medium" : "Low";

      return {
        teacher_name: t.full_name,
        class_assignments: classAssignments,
        active_interventions: activeInterventions,
        pending_evaluations: pendingEvaluations,
        homework_created: homeworkCreated,
        worksheets_assigned: worksheetsAssigned,
        at_risk_students: atRiskStudents,
        workload_score: score,
        workload,
      };
    }).sort((a, b) => b.workload_score - a.workload_score);

    const highWorkloadTeachers = teacherSummary.filter((t) => t.workload === "High");

// ── Grade-wise report ──────────────────────────────────────────────────────
    // Normalize grade labels for comparison: academic_tests.student_class stores "4",
    // students.class stores "Class 4" — strip "Class " prefix and trim before matching.
    const normalizeGrade = (val: string) => (val || "").replace(/^Class\s*/i, "").trim().toLowerCase();

    // Build the full list of real grades from `students`, not just grades that
    // happen to have academic_tests rows — otherwise grades with no tests yet
    // are silently omitted from the report instead of shown as "No Tests".
    const allGrades = [...new Set((students || []).map((s: any) => normalizeGrade(s.class)).filter(Boolean))];

    // Risk is now derived directly from the grade's own average test score —
    // same data source as Avg Score, so the two columns can never contradict
    // each other. Thresholds: >=70% Low, 40-69% Medium, <40% High.
    const riskFromScore = (avgScore: number): "Low" | "Medium" | "High" => {
      if (avgScore >= 70) return "Low";
      if (avgScore >= 40) return "Medium";
      return "High";
    };

    const gradeWise = allGrades.map((normalizedGrade) => {
      const matchingAverage = gradeAverages.find((g) => normalizeGrade(g.grade) === normalizedGrade);
      const displayLabel = (students || []).find((s: any) => normalizeGrade(s.class) === normalizedGrade)?.class || normalizedGrade;

      return {
        grade: displayLabel,
        avg_score: matchingAverage ? matchingAverage.avg_score : null,
        risk: matchingAverage ? riskFromScore(matchingAverage.avg_score) : "No Tests",
      };
    }).sort((a, b) => a.grade.localeCompare(b.grade, undefined, { numeric: true }));

    // ── School Health Score (weighted across AVAILABLE signals only — no attendance data exists) ──
    const components: { label: string; value: number; weight: number }[] = [];
    if (overallAvgScore !== null) components.push({ label: "Academic Performance", value: overallAvgScore, weight: 0.35 });
    if (homeworkCompletionPct !== null) components.push({ label: "Homework Completion", value: homeworkCompletionPct, weight: 0.25 });
    if (studentIds.length > 0) {
      const riskHealthPct = Math.round(((studentIds.length - highRisk - medRisk * 0.5) / studentIds.length) * 100);
      components.push({ label: "At-Risk Ratio", value: Math.max(0, riskHealthPct), weight: 0.25 });
    }
    if (ivSuccessRate !== null) components.push({ label: "Intervention Success", value: ivSuccessRate, weight: 0.15 });
    const totalWeight = components.reduce((s, c) => s + c.weight, 0);
    const healthScore = totalWeight > 0
      ? Math.round(components.reduce((s, c) => s + c.value * c.weight, 0) / totalWeight)
      : null;

    // ── Rule-based Action Items (no AI needed for these — deterministic thresholds) ──
    const actionItems: { priority: "red" | "orange" | "yellow" | "green"; text: string }[] = [];
    if (gradeWise.length > 0) {
      const worst = [...gradeWise].sort((a, b) => a.avg_score - b.avg_score)[0];
      if (worst.avg_score < 60) actionItems.push({ priority: "red", text: `${worst.grade} average score (${worst.avg_score}%) is below target.` });
    }
    if (highRisk > 0) actionItems.push({ priority: "orange", text: `${highRisk} student${highRisk === 1 ? "" : "s"} are at high risk.` });
    if (highWorkloadTeachers.length > 0) actionItems.push({ priority: "yellow", text: `${highWorkloadTeachers.length} teacher${highWorkloadTeachers.length === 1 ? "" : "s"} have a high class-assignment load: ${highWorkloadTeachers.map(t => t.teacher_name).join(", ")}.` });
    if (homeworkCompletionPct !== null && homeworkCompletionPct >= 90) actionItems.push({ priority: "green", text: `Homework completion is strong at ${homeworkCompletionPct}%.` });

    // ── One AI call for narrative insights (optional — degrades gracefully) ──
    const GROQ_KEY = Deno.env.get("GROQ_API_KEY") || Deno.env.get("GROK_API_KEY");
    let aiInsights: string[] = [];
    if (GROQ_KEY) {
      try {
        const aiResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content: `You are helping a school principal understand their school's current status. Given structured data, return ONLY a JSON array of 2-4 short, one-sentence insight strings (no markdown, no preamble). Base every insight strictly on the numbers given — never invent a comparison to a prior period unless the data explicitly includes one.`,
              },
              { role: "user", content: JSON.stringify({ overallAvgScore, homeworkCompletionPct, highRisk, medRisk, lowRisk, gradeWise, ivSuccessRate, highWorkloadTeachers: highWorkloadTeachers.map(t => t.teacher_name) }) },
            ],
          }),
        });
        if (aiResp.ok) {
          const aiData = await aiResp.json();
          let content = aiData.choices?.[0]?.message?.content || "[]";
          content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          aiInsights = JSON.parse(content);
        }
      } catch (e) {
        console.error("AI insights failed:", e);
      }
    }

    return new Response(JSON.stringify({
      summary: {
        total_students: (students || []).length,
        total_teachers: teacherCount || 0,
        average_performance: overallAvgScore,
        at_risk_count: highRisk + medRisk,
        homework_completion_pct: homeworkCompletionPct,
        student_attendance: null, // no attendance module exists yet
        teacher_attendance: null,
      },
      academic: { average_score: overallAvgScore, grade_averages: gradeAverages },
      at_risk: { high: highRisk, medium: medRisk, low: lowRisk },
      teacher_performance: {
        teacher_count: teacherCount || 0,
        homework_pending_evaluation: pendingEvalCount || 0,
        teacher_summary: teacherSummary,
      },
      behaviour: { positive: positiveCount, concern: concernCount, incident: incidentCount, resolved: resolvedCount },
      interventions: { created: ivCreated, completed: ivCompleted, active: ivActive, success_rate: ivSuccessRate },
      homework: { assigned: (assignments || []).length, submitted: submittedCount || 0, completion_rate: homeworkCompletionPct },
      assessment: {
        conducted: assessmentConducted,
        average_score: assessmentAvgScore,
        pass_rate: assessmentPassRate,
        from_academic_tests: testPercentages.length,
        from_semester_engine: semMarkPercentages.length,
      },
      grade_wise: gradeWise,
      health_score: healthScore,
      health_components: components,
      action_items: actionItems,
      ai_insights: aiInsights,
      unavailable: ["Student attendance", "Teacher attendance", "Most Improved Grade (no historical baseline)", "Classes/day (no timetable data — showing class assignment count instead)"],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("executive-report error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
