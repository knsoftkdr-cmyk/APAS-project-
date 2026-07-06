// supabase/functions/whatif-timetable/index.ts
//
// Two modes:
//   POST { mode: "draft_preview", school_id, class_grade, section, draft_grid }
//     -> Checks clashes across the whole school AS IF that one class's live
//        grid were replaced by draft_grid. Does not write anything to the DB.
//
//   POST { mode: "teacher_absence", school_id, teacher_id, day }
//     -> Lists every class/period that teacher is scheduled for on that day,
//        plus which other teachers are free at each of those exact slots
//        (candidate substitutes).

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

type ResolvedCell = { className: string; section: string; day: string; period: string; subject: string; teacherId: string; teacherName: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { mode, school_id } = body;
    if (!mode || !school_id) {
      return new Response(JSON.stringify({ error: "mode and school_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const normalizeClass = (c: string) => (c || "").toLowerCase().replace(/^class\s*/i, "").trim();

    // ── Shared setup: classes, teacher assignments, teacher names ──
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

    // ── Load timetables, with an option to override one class's grid ──
    const { data: timetables, error: ttErr } = await supabase
      .from("timetables")
      .select("class_grade, section, parsed_grid")
      .eq("school_id", school_id)
      .not("parsed_grid", "is", null);
    if (ttErr) throw ttErr;

    function resolveAllCells(overrideClassGrade?: string, overrideSection?: string, overrideGrid?: { headers: string[]; rows: string[][] }) {
      const resolved: ResolvedCell[] = [];
      const unmatched: { className: string; section: string; day: string; period: string; rawText: string }[] = [];

      const rowsToProcess = (timetables || []).map((tt) => {
        if (
          overrideClassGrade &&
          overrideSection &&
          overrideGrid &&
          normalizeClass(tt.class_grade) === normalizeClass(overrideClassGrade) &&
          tt.section.trim().toUpperCase() === overrideSection.trim().toUpperCase()
        ) {
          return { ...tt, parsed_grid: overrideGrid };
        }
        return tt;
      });

      // If the overridden class doesn't have an existing timetable row at all,
      // still include the draft for it.
      const hasOverrideClass = rowsToProcess.some(
        (tt) =>
          overrideClassGrade &&
          normalizeClass(tt.class_grade) === normalizeClass(overrideClassGrade) &&
          tt.section.trim().toUpperCase() === overrideSection?.trim().toUpperCase()
      );
      if (overrideClassGrade && overrideSection && overrideGrid && !hasOverrideClass) {
        rowsToProcess.push({ class_grade: overrideClassGrade, section: overrideSection, parsed_grid: overrideGrid } as any);
      }

      for (const tt of rowsToProcess) {
        const key = `${normalizeClass(tt.class_grade)}|${tt.section.trim().toUpperCase()}`;
        const cls = classByGradeSection.get(key);
        if (!cls) continue;

        const candidates = subjectsByClass.get(cls.id) || [];
        const candidateSubjects = candidates.map((c) => c.subject);
        const grid = tt.parsed_grid as { headers: string[]; rows: string[][] };
        if (!grid?.headers || !grid?.rows) continue;

        const dayColumns = grid.headers.slice(1);
        for (const row of grid.rows) {
          const period = row[0];
          for (let i = 0; i < dayColumns.length; i++) {
            const rawText = row[i + 1];
            if (!rawText || !rawText.trim()) continue;
            const match = matchSubject(rawText, candidateSubjects);
            if (!match) {
              unmatched.push({ className: cls.name, section: cls.section, day: dayColumns[i], period, rawText });
              continue;
            }
            const teacherEntry = candidates.find((c) => c.subject === match.subject);
            if (!teacherEntry) continue;
            resolved.push({
              className: cls.name,
              section: cls.section,
              day: dayColumns[i],
              period,
              subject: match.subject,
              teacherId: teacherEntry.teacher_id,
              teacherName: teacherNameById.get(teacherEntry.teacher_id) || "Unknown Teacher",
            });
          }
        }
      }
      return { resolved, unmatched };
    }

    // ── MODE: draft_preview ──
    if (mode === "draft_preview") {
      const { class_grade, section, draft_grid } = body;
      if (!class_grade || !section || !draft_grid) {
        return new Response(JSON.stringify({ error: "class_grade, section, and draft_grid are required for draft_preview" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { resolved, unmatched } = resolveAllCells(class_grade, section, draft_grid);

      const slotMap = new Map<string, ResolvedCell[]>();
      for (const cell of resolved) {
        const slotKey = `${cell.day}|${cell.period}|${cell.teacherId}`;
        const list = slotMap.get(slotKey) || [];
        list.push(cell);
        slotMap.set(slotKey, list);
      }

      const clashes = [];
      for (const [, cells] of slotMap) {
        if (cells.length < 2) continue;
        const [a] = cells;
        clashes.push({
          day: a.day,
          period: a.period,
          teacherName: a.teacherName,
          classesInvolved: cells.map((c) => ({ className: c.className, section: c.section, subject: c.subject })),
        });
      }

      return new Response(JSON.stringify({ clashes, unmatched }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MODE: teacher_absence ──
    if (mode === "teacher_absence") {
      const { teacher_id, day } = body;
      if (!teacher_id || !day) {
        return new Response(JSON.stringify({ error: "teacher_id and day are required for teacher_absence" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { resolved } = resolveAllCells();
      const dayNorm = day.toLowerCase().trim();

      const affectedSlots = resolved.filter((r) => r.teacherId === teacher_id && r.day.toLowerCase().trim() === dayNorm);

      const busyTeacherIdsBySlot = new Map<string, Set<string>>();
      resolved
        .filter((r) => r.day.toLowerCase().trim() === dayNorm)
        .forEach((r) => {
          const key = r.period;
          const set = busyTeacherIdsBySlot.get(key) || new Set<string>();
          set.add(r.teacherId);
          busyTeacherIdsBySlot.set(key, set);
        });

      const allTeacherIds = [...teacherNameById.keys()];

      const impact = affectedSlots.map((slot) => {
        const busyAtThisSlot = busyTeacherIdsBySlot.get(slot.period) || new Set<string>();
        const freeTeachers = allTeacherIds
          .filter((tid) => tid !== teacher_id && !busyAtThisSlot.has(tid))
          .map((tid) => teacherNameById.get(tid));
        return {
          className: slot.className,
          section: slot.section,
          period: slot.period,
          subject: slot.subject,
          candidateSubstitutes: freeTeachers,
        };
      });

      return new Response(JSON.stringify({ teacherName: teacherNameById.get(teacher_id) || "Unknown Teacher", day, impact }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown mode: ${mode}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
