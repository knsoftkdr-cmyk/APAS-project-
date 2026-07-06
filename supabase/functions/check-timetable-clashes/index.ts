// supabase/functions/check-timetable-clashes/index.ts
//
// Detects teacher double-bookings across all classes' uploaded timetable
// Excel files for a school, and suggests a period swap to resolve each clash.
//
// Input:  POST { school_id: string }
// Output: { clashes: Clash[], unmatched: UnmatchedCell[] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Known abbreviation -> canonical subject mappings. Checked first, before
// falling back to fuzzy matching, since these are the most common real-world
// abbreviations seen across schools and are far more reliable than a
// similarity score alone.
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

// Basic Levenshtein distance for fuzzy fallback matching.
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

// Matches a raw cell subject string (e.g. "maths ") against a list of
// candidate official subjects for that class (e.g. ["Mathematics", "Science"]).
// Returns the best match + confidence, or null if nothing clears the bar.
function matchSubject(rawCell: string, candidates: string[]): { subject: string; confidence: number } | null {
  const cellNorm = normalize(rawCell);
  if (!cellNorm) return null;

  // 1. Synonym dictionary check
  for (const candidate of candidates) {
    const candNorm = normalize(candidate);
    const synonymList = SYNONYMS[candNorm] || [];
    if (candNorm === cellNorm || synonymList.includes(cellNorm)) {
      return { subject: candidate, confidence: 1 };
    }
  }

  // 2. Fuzzy fallback
  let best: { subject: string; confidence: number } | null = null;
  for (const candidate of candidates) {
    const score = similarity(cellNorm, normalize(candidate));
    if (score >= FUZZY_THRESHOLD && (!best || score > best.confidence)) {
      best = { subject: candidate, confidence: score };
    }
  }
  return best;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { school_id } = await req.json();
    if (!school_id) {
      return new Response(JSON.stringify({ error: "school_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Load classes for this school
    const { data: classes, error: classesErr } = await supabase
      .from("classes")
      .select("id, name, section")
      .eq("school_id", school_id);
    if (classesErr) throw classesErr;

    const normalizeClass = (c: string) => (c || "").toLowerCase().replace(/^class\s*/i, "").trim();
    const classByGradeSection = new Map<string, { id: string; name: string; section: string }>();
    (classes || []).forEach((c) => {
      classByGradeSection.set(`${normalizeClass(c.name)}|${c.section.trim().toUpperCase()}`, c);
    });

    // 2. Load class_teachers for these classes (subject -> teacher expertise/assignment)
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

    // 3. Load teacher names for readable output
    const teacherIds = [...new Set((classTeachers || []).map((ct) => ct.teacher_id))];
    const { data: teacherProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", teacherIds.length ? teacherIds : ["00000000-0000-0000-0000-000000000000"]);
    const teacherNameById = new Map((teacherProfiles || []).map((p) => [p.id, p.full_name || "Unknown Teacher"]));

    // 4. Load all timetables with parsed data for this school
    const { data: timetables, error: ttErr } = await supabase
      .from("timetables")
      .select("class_grade, section, parsed_grid")
      .eq("school_id", school_id)
      .not("parsed_grid", "is", null);
    if (ttErr) throw ttErr;

    // 5. Resolve each cell to a teacher_id, tracking unmatched cells for review
    type ResolvedCell = { className: string; section: string; day: string; period: string; subject: string; teacherId: string; teacherName: string };
    const resolved: ResolvedCell[] = [];
    const unmatched: { className: string; section: string; day: string; period: string; rawText: string }[] = [];

    for (const tt of timetables || []) {
      const key = `${normalizeClass(tt.class_grade)}|${tt.section.trim().toUpperCase()}`;
      const cls = classByGradeSection.get(key);
      if (!cls) continue;

      const candidates = subjectsByClass.get(cls.id) || [];
      const candidateSubjects = candidates.map((c) => c.subject);
      const grid = tt.parsed_grid as { headers: string[]; rows: string[][] };
      if (!grid?.headers || !grid?.rows) continue;

      const dayColumns = grid.headers.slice(1); // skip "period/day" column
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

    // 6. Group by (day, period, teacher) to find clashes
    const slotMap = new Map<string, ResolvedCell[]>();
    for (const cell of resolved) {
      const slotKey = `${cell.day}|${cell.period}|${cell.teacherId}`;
      const list = slotMap.get(slotKey) || [];
      list.push(cell);
      slotMap.set(slotKey, list);
    }

    type Clash = {
      day: string;
      period: string;
      teacherName: string;
      classesInvolved: { className: string; section: string; subject: string }[];
      suggestedSwap: string | null;
    };
    const clashes: Clash[] = [];

    for (const [, cells] of slotMap) {
      if (cells.length < 2) continue;
      const [a, b] = cells; // handle the common 2-way clash; 3+ way clashes list all involved

      // Look for a period where teacher `a.teacherId` is free in BOTH classes
      // involved, to suggest swapping class A's slot there instead.
      let suggestion: string | null = null;
      const teacherBusySlots = new Set(
        resolved.filter((r) => r.teacherId === a.teacherId).map((r) => `${r.day}|${r.period}`)
      );
      const classAGrid = resolved.filter((r) => r.className === a.className && r.section === a.section);
      for (const candidateSlot of classAGrid) {
        const slotKey2 = `${candidateSlot.day}|${candidateSlot.period}`;
        if (slotKey2 === `${a.day}|${a.period}`) continue;
        if (!teacherBusySlots.has(slotKey2)) {
          suggestion = `Swap ${a.className}-${a.section}'s ${a.day} ${a.period} (${a.subject}) with their ${candidateSlot.day} ${candidateSlot.period} (${candidateSlot.subject}) — ${a.teacherName} is free at that time.`;
          break;
        }
      }

      clashes.push({
        day: a.day,
        period: a.period,
        teacherName: a.teacherName,
        classesInvolved: cells.map((c) => ({ className: c.className, section: c.section, subject: c.subject })),
        suggestedSwap: suggestion,
      });
    }

    return new Response(JSON.stringify({ clashes, unmatched }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
