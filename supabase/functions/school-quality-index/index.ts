// supabase/functions/school-quality-index/index.ts
//
// School Quality Index — single school-level composite score.
// Components (equal thirds):
//   1. Attendance Rate      — attendance_records
//   2. Syllabus Coverage    — lessons.completed vs curriculum_index chapter list
//   3. Academic Performance — semester_marks, scoped to the active academic_semesters row
//
// Invoke: POST { school_id: string }
// Returns: { school_id, index_score, components: { attendance, coverage, academic }, meta }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { school_id } = await req.json();

    if (!school_id) {
      return new Response(
        JSON.stringify({ error: "school_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const [attendance, coverage, academic] = await Promise.all([
      computeAttendanceRate(supabase, school_id),
      computeSyllabusCoverage(supabase, school_id),
      computeAcademicPerformance(supabase, school_id),
    ]);

    // Equal-thirds weighting. Any component with no data is excluded from the
    // average (re-weighted across whatever components DO have data) rather than
    // silently dragging the index toward 0 — a school with no exams logged yet
    // shouldn't show a fake "33% quality" score.
    const available = [attendance, coverage, academic].filter(
      (c) => c.value !== null
    );

    const index_score =
      available.length > 0
        ? available.reduce((sum, c) => sum + (c.value as number), 0) /
          available.length
        : null;

    return new Response(
      JSON.stringify({
        school_id,
        index_score: index_score !== null ? round2(index_score) : null,
        components: {
          attendance: formatComponent(attendance),
          coverage: formatComponent(coverage),
          academic: formatComponent(academic),
        },
        meta: {
          weighting: "equal_thirds",
          components_used: available.length,
          computed_at: new Date().toISOString(),
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("school-quality-index error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ---------------------------------------------------------------------------
// Component 1: Attendance Rate
// (present + late + half_day*0.5) / (total - excused)
// ---------------------------------------------------------------------------
async function computeAttendanceRate(supabase: any, schoolId: string) {
  const { data, error } = await supabase
    .from("attendance_records")
    .select("status")
    .eq("school_id", schoolId);

  if (error) throw new Error(`attendance query failed: ${error.message}`);
  if (!data || data.length === 0) return { value: null, raw: null };

  let present = 0, late = 0, halfDay = 0, excused = 0;
  for (const row of data) {
    switch (row.status) {
      case "present": present++; break;
      case "late": late++; break;
      case "half_day": halfDay++; break;
      case "excused": excused++; break;
      // 'absent' contributes to denominator only, no branch needed
    }
  }

  const total = data.length;
  const denominator = total - excused;
  if (denominator <= 0) return { value: null, raw: { total, excused } };

  const rate = (present + late + halfDay * 0.5) / denominator;
  return { value: rate * 100, raw: { total, present, late, halfDay, excused } };
}

// ---------------------------------------------------------------------------
// Component 2: Syllabus Coverage
// Aggregates the SAME logic as SchoolSyllabusOverview.tsx (the real,
// teacher-maintained coverage page) school-wide, rather than a separate
// curriculum_index/lessons.completed model — those tables are a different,
// effectively-unused data path for this feature. Source of truth is:
//   class_teachers (assignment) -> curriculum_chapters/books (chapter total)
//   lessons (count, normalized subject) -> covered count
// ---------------------------------------------------------------------------
async function computeSyllabusCoverage(supabase: any, schoolId: string) {
  const { data: assignments, error: assignErr } = await supabase
    .from("class_teachers")
    .select("id, teacher_id, subject, class_id, classes!inner(id, name, section, school_id)")
    .eq("classes.school_id", schoolId);

  if (assignErr) throw new Error(`class_teachers query failed: ${assignErr.message}`);
  if (!assignments || assignments.length === 0) return { value: null, raw: null };

  let totalChapters = 0;
  let totalCovered = 0;
  let rowsWithCurriculum = 0;

  await Promise.all(
    assignments
      .filter((a: any) => a.subject) // skip rows with no subject set — can't be scored
      .map(async (a: any) => {
        const className = (a.classes.name as string).replace(/\b\w/g, (ch: string) => ch.toUpperCase());
        const normSubject = normalizeSubject(a.subject);

        const [{ data: chaptersData }, { count: covered }, { count: coveredNoSchool }] = await Promise.all([
          supabase
            .from("curriculum_chapters")
            .select("id, books!inner(class_name, subject, school_id)")
            .ilike("books.class_name", className)
            .ilike("books.subject", normSubject)
            .eq("books.school_id", schoolId),
          supabase
            .from("lessons")
            .select("id", { count: "exact", head: true })
            .eq("teacher_id", a.teacher_id)
            .ilike("class_level", className)
            .ilike("subject", normSubject)
            .eq("school_id", schoolId),
          supabase
            .from("lessons")
            .select("id", { count: "exact", head: true })
            .eq("teacher_id", a.teacher_id)
            .ilike("class_level", className)
            .ilike("subject", normSubject)
            .is("school_id", null),
        ]);

        const chapterCount = chaptersData?.length ?? 0;
        if (chapterCount === 0) return; // no curriculum defined yet — excluded, not counted as 0

        totalChapters += chapterCount;
        totalCovered += (covered ?? 0) + (coveredNoSchool ?? 0);
        rowsWithCurriculum += 1;
      })
  );

  if (totalChapters === 0) return { value: null, raw: { rowsWithCurriculum } };

  const coverage = Math.min(1, totalCovered / totalChapters);
  return {
    value: coverage * 100,
    raw: { totalChapters, totalCovered, rowsWithCurriculum, assignmentsChecked: assignments.length },
  };
}

function normalizeSubject(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  const aliases: Record<string, string> = {
    maths: "Mathematics",
    math: "Mathematics",
    mathematics: "Mathematics",
    science: "Science",
    social: "Social Studies",
    "social studies": "Social Studies",
    english: "English",
    "computer science": "Computer Science",
    computers: "Computer Science",
    hindi: "Hindi",
    telugu: "Telugu",
  };
  if (aliases[lower]) return aliases[lower];
  return trimmed.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.substring(1).toLowerCase());
}

// ---------------------------------------------------------------------------
// Component 3: Academic Performance
// sum(marks_obtained) / sum(max_marks) for the ACTIVE academic_semesters row
// ---------------------------------------------------------------------------
async function computeAcademicPerformance(supabase: any, schoolId: string) {
  const { data: activeSemester, error: semesterErr } = await supabase
    .from("academic_semesters")
    .select("id")
    .eq("school_id", schoolId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (semesterErr) throw new Error(`academic_semesters query failed: ${semesterErr.message}`);
  if (!activeSemester) return { value: null, raw: null };

  const { data: marks, error: marksErr } = await supabase
    .from("semester_marks")
    .select("marks_obtained, max_marks")
    .eq("school_id", schoolId)
    .eq("semester_id", activeSemester.id);

  if (marksErr) throw new Error(`semester_marks query failed: ${marksErr.message}`);
  if (!marks || marks.length === 0) return { value: null, raw: { semester_id: activeSemester.id } };

  const totalObtained = marks.reduce((sum: number, m: any) => sum + (m.marks_obtained ?? 0), 0);
  const totalMax = marks.reduce((sum: number, m: any) => sum + (m.max_marks ?? 0), 0);

  if (totalMax === 0) return { value: null, raw: { semester_id: activeSemester.id } };

  const performance = totalObtained / totalMax;
  return {
    value: performance * 100,
    raw: { semester_id: activeSemester.id, totalObtained, totalMax, recordCount: marks.length },
  };
}

// ---------------------------------------------------------------------------
function formatComponent(c: { value: number | null; raw: unknown }) {
  return {
    score: c.value !== null ? round2(c.value) : null,
    available: c.value !== null,
    details: c.raw,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}