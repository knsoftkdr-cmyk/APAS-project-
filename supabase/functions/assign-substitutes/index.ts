// supabase/functions/assign-substitutes/index.ts
//
// POST { school_id, teacher_id, day }
//
// Finds every class/period the given teacher is scheduled for on that day,
// picks the best available substitute for each (the free teacher with the
// fewest existing duties that day, to spread load fairly), saves the
// assignment to substitute_assignments, and returns the results.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYNONYMS: Record<string, string[]> = {
  mathematics: ["maths", "math", "mathematic"],
  "social studies": ["social", "social science", "ss", "sst"],
  "physical education": ["pt", "games", "sports", "phy edu", "pe"],
  english: ["eng"],
  telugu: ["tel"],
  hindi: ["hin"],
  science: ["sci", "general science", "gen science"],
  "computer science": ["computer", "cs", "it", "computers"],
};

function normalize(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

const FUZZY_THRESHOLD = 0.55;

function matchSubject(rawCell: string, candidates: string[]): { subject: string; confidence: number } | null {
  const cellNorm = normalize(rawCell);
  if (!cellNorm) return null;
  for (const candidate of candidates) {
    const candNorm = normalize(candidate);
    const synonymList = SYNONYMS[candNorm] || [];
    if (candNorm === cellNorm || synonymList.includes(cellNorm)) {
      return { subject: candidate, confidence: 1 };
    }
  }
  let best: { subject: string; confidence: number } | null = null;
  for (const candidate of candidates) {
    const score = similarity(cellNorm, normalize(candidate));
    if (score >= FUZZY_THRESHOLD && (!best || score > best.confidence)) {
      best = { subject: candidate, confidence: score };
    }
  }
  return best;
}

type ResolvedCell = { classId: string; className: string; section: string; day: string; period: string; subject: string; teacherId: string; teacherName: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { school_id, teacher_id, day } = await req.json();
    if (!school_id || !teacher_id || !day) {
      return new Response(JSON.stringify({ error: "school_id, teacher_id, and day are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const normalizeClass = (c: string) => (c || "").toLowerCase().replace(/^class\s*/i, "").trim();
    const dayNorm = day.toLowerCase().trim();

    // ── Load classes, teacher assignments, teacher names (same as whatif-timetable) ──
    const { data: classes, error: classesErr } = await supabase
      .from("classes")
      .select("id, name, section")
      .eq("school_id", school_id);
    if (classesErr) throw classesErr;

    const classByGradeSection = new Map<string, { id: string; name: string; section: string }>();
    (classes || []).forEach((c) => {
      classByGradeSection.set(`${normalizeClass(c.name)}|${c.section.trim().toUpperCase()}`, c);
    });

    const classIds = (classes || []).map((c) => c.id);
    const { data: classTeachers, error: ctErr } = await supabase
      .from("class_teachers")
      .select("class_id, teacher_id, subject")
      .in("class_id", classIds.length ? classIds : ["00000000-0000-0000-0000-000000000000"]);
    if (ctErr) throw ctErr;

    const subjectsByClass = new Map<string, { subject: string; teacher_id: string }[]>();
    (classTeachers || []).forEach((ct) => {
      if (!ct.subject) return;
      const list = subjectsByClass.get(ct.class_id) || [];
      list.push({ subject: ct.subject, teacher_id: ct.teacher_id });
      subjectsByClass.set(ct.class_id, list);
    });

    const teacherIds = [...new Set((classTeachers || []).map((ct) => ct.teacher_id))];
    const { data: teacherProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", teacherIds.length ? teacherIds : ["00000000-0000-0000-0000-000000000000"]);
    const teacherNameById = new Map((teacherProfiles || []).map((p) => [p.id, p.full_name || "Unknown Teacher"]));

    const { data: timetables, error: ttErr } = await supabase
      .from("timetables")
      .select("class_grade, section, parsed_grid")
      .eq("school_id", school_id)
      .not("parsed_grid", "is", null);
    if (ttErr) throw ttErr;

    // ── Resolve every cell across all classes for this day ──
    const resolved: ResolvedCell[] = [];
    for (const tt of timetables || []) {
      const key = `${normalizeClass(tt.class_grade)}|${tt.section.trim().toUpperCase()}`;
      const cls = classByGradeSection.get(key);
      if (!cls) continue;

      const candidates = subjectsByClass.get(cls.id) || [];
      const candidateSubjects = candidates.map((c) => c.subject);
      const grid = tt.parsed_grid as { headers: string[]; rows: string[][] };
      if (!grid?.headers || !grid?.rows) continue;

      const dayColumns = grid.headers.slice(1);
      const dayIdx = dayColumns.findIndex((d) => d.toLowerCase().trim() === dayNorm);
      if (dayIdx === -1) continue;

      for (const row of grid.rows) {
        const period = row[0];
        const rawText = row[dayIdx + 1];
        if (!rawText || !rawText.trim()) continue;
        const match = matchSubject(rawText, candidateSubjects);
        if (!match) continue;
        const teacherEntry = candidates.find((c) => c.subject === match.subject);
        if (!teacherEntry) continue;
        resolved.push({
          classId: cls.id,
          className: cls.name,
          section: cls.section,
          day: dayColumns[dayIdx],
          period,
          subject: match.subject,
          teacherId: teacherEntry.teacher_id,
          teacherName: teacherNameById.get(teacherEntry.teacher_id) || "Unknown Teacher",
        });
      }
    }

    const affectedSlots = resolved.filter((r) => r.teacherId === teacher_id);
    if (affectedSlots.length === 0) {
      return new Response(JSON.stringify({ teacherName: teacherNameById.get(teacher_id) || "Unknown Teacher", day, assignments: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Busy teachers per period (for that day)
    const busyTeacherIdsByPeriod = new Map<string, Set<string>>();
    resolved.forEach((r) => {
      const set = busyTeacherIdsByPeriod.get(r.period) || new Set<string>();
      set.add(r.teacherId);
      busyTeacherIdsByPeriod.set(r.period, set);
    });

    // Existing substitute load per teacher for this day, to spread fairly.
    const { data: existingSubs } = await supabase
      .from("substitute_assignments")
      .select("substitute_teacher_id")
      .eq("school_id", school_id)
      .eq("day", day)
      .not("substitute_teacher_id", "is", null);
    const subLoad = new Map<string, number>();
    (existingSubs || []).forEach((s) => {
      subLoad.set(s.substitute_teacher_id, (subLoad.get(s.substitute_teacher_id) || 0) + 1);
    });

    const allTeacherIds = [...teacherNameById.keys()];
    const assignments: { className: string; section: string; period: string; subject: string; substituteName: string | null; status: string }[] = [];

    for (const slot of affectedSlots) {
      const busyAtSlot = busyTeacherIdsByPeriod.get(slot.period) || new Set<string>();
      const freeCandidates = allTeacherIds.filter((tid) => tid !== teacher_id && !busyAtSlot.has(tid));

      // Pick the free candidate with the fewest substitute duties assigned so far today.
      let chosen: string | null = null;
      let lowestLoad = Infinity;
      for (const candidate of freeCandidates) {
        const load = subLoad.get(candidate) || 0;
        if (load < lowestLoad) {
          lowestLoad = load;
          chosen = candidate;
        }
      }

      const status = chosen ? "pending_review" : "unresolved";
      if (chosen) subLoad.set(chosen, (subLoad.get(chosen) || 0) + 1);

      const { error: upsertErr } = await supabase.from("substitute_assignments").upsert(
        {
          school_id,
          day,
          original_teacher_id: teacher_id,
          substitute_teacher_id: chosen,
          class_id: slot.classId,
          period: slot.period,
          subject: slot.subject,
          status,
        },
        { onConflict: "school_id,day,class_id,period" }
      );
      if (upsertErr) throw upsertErr;

      assignments.push({
        className: slot.className,
        section: slot.section,
        period: slot.period,
        subject: slot.subject,
        substituteName: chosen ? teacherNameById.get(chosen) || "Unknown Teacher" : null,
        status,
      });
    }

    return new Response(JSON.stringify({ teacherName: teacherNameById.get(teacher_id) || "Unknown Teacher", day, assignments }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});