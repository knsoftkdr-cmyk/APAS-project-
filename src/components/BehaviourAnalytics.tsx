/**
 * BehaviourAnalytics.tsx
 * Aggregates this teacher's existing `teacher_notes` into a ranked,
 * at-a-glance view: which students have rising concern/incident activity
 * in the last 30 days, so the teacher doesn't have to already know who
 * to look up.
 *
 * Reuses data you already collect (no new tables). Clicking a row hands
 * off to the same class/section/student selection state your dashboard
 * already drives the Notes + InterventionDrawer off of, AND passes along
 * the risk level + contributing factors so a new intervention can be
 * pre-filled instead of started blank.
 */
import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { TrendingUp, TrendingDown, Minus, ActivitySquare } from "lucide-react";

interface Student {
  id: string;
  full_name: string;
  class: string;
  section: string;
}

interface RawNote {
  id: string;
  student_id: string;
  note_type: string;
  created_at: string;
}

export interface AnalyticsMeta {
  level: "high" | "watch" | "none";
  breakdown: Record<string, number>; // counts by note_type, last 30 days
}

interface StudentStat {
  student: Student;
  last30Total: number;
  last30ConcernIncident: number;
  prev30ConcernIncident: number;
  breakdown: Record<string, number>;
  trend: "up" | "down" | "flat";
  lastActivity: string;
  level: "high" | "watch" | "none";
}

const LEVEL_STYLES: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  watch: "bg-amber-100 text-amber-700",
  none: "bg-muted text-muted-foreground",
};

const LEVEL_LABEL: Record<string, string> = {
  high: "High",
  watch: "Watch",
  none: "OK",
};

// Tune these to taste / school policy
const HIGH_THRESHOLD = 3; // concern+incident notes in last 30 days
const WATCH_THRESHOLD = 2;

interface Props {
  teacherId: string;
  students: Student[]; // pass the same `students` array the dashboard already fetches
  onSelectStudent: (student: Student, meta: AnalyticsMeta) => void;
}

export function BehaviourAnalytics({ teacherId, students, onSelectStudent }: Props) {
  const [notes, setNotes] = useState<RawNote[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotes = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    try {
      // 60 days back is enough to compute a "last 30 vs previous 30" trend
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      const { data } = await supabase
        .from("teacher_notes")
        .select("id, student_id, note_type, created_at")
        .eq("teacher_id", teacherId)
        .gte("created_at", sixtyDaysAgo.toISOString());

      setNotes((data || []) as RawNote[]);
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  const studentById = useMemo(() => {
    const map = new Map<string, Student>();
    students.forEach((s) => map.set(s.id, s));
    return map;
  }, [students]);

  const stats: StudentStat[] = useMemo(() => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const grouped = new Map<string, RawNote[]>();

    notes.forEach((n) => {
      if (!grouped.has(n.student_id)) grouped.set(n.student_id, []);
      grouped.get(n.student_id)!.push(n);
    });

    const result: StudentStat[] = [];

    grouped.forEach((studentNotes, studentId) => {
      const student = studentById.get(studentId);
      if (!student) return; // note for a student outside current roster/filter

      const last30 = studentNotes.filter((n) => now - new Date(n.created_at).getTime() <= 30 * day);
      const prev30 = studentNotes.filter((n) => {
        const age = now - new Date(n.created_at).getTime();
        return age > 30 * day && age <= 60 * day;
      });

      const isConcernIncident = (n: RawNote) => n.note_type === "concern" || n.note_type === "incident";
      const last30ConcernIncident = last30.filter(isConcernIncident).length;
      const prev30ConcernIncident = prev30.filter(isConcernIncident).length;

      const breakdown: Record<string, number> = {};
      last30.forEach((n) => { breakdown[n.note_type] = (breakdown[n.note_type] || 0) + 1; });

      let trend: StudentStat["trend"] = "flat";
      if (last30ConcernIncident > prev30ConcernIncident) trend = "up";
      else if (last30ConcernIncident < prev30ConcernIncident) trend = "down";

      let level: StudentStat["level"] = "none";
      if (last30ConcernIncident >= HIGH_THRESHOLD) level = "high";
      else if (last30ConcernIncident >= WATCH_THRESHOLD) level = "watch";

      const lastActivity = studentNotes
        .map((n) => n.created_at)
        .sort()
        .reverse()[0];

      result.push({
        student,
        last30Total: last30.length,
        last30ConcernIncident,
        prev30ConcernIncident,
        breakdown,
        trend,
        lastActivity,
        level,
      });
    });

    // Flagged (high, then watch) first, each sorted by concern/incident count desc,
    // then everything else by most recent activity.
    const rank = { high: 0, watch: 1, none: 2 };
    return result
      .sort((a, b) => {
        if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level];
        if (b.last30ConcernIncident !== a.last30ConcernIncident) return b.last30ConcernIncident - a.last30ConcernIncident;
        return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      })
      .slice(0, 8); // keep the panel scannable; rest is available via normal student picker
  }, [notes, studentById]);

  const flaggedCount = stats.filter((s) => s.level !== "none").length;

return (
  <Card className="overflow-hidden border-cyan-200 shadow-sm">
    <div className="h-1 bg-gradient-to-r from-cyan-500 to-sky-500" />
    <CardHeader className="pb-2 flex flex-row items-center justify-between">
      <CardTitle className="text-base flex items-center gap-2">
        <div className="w-10 h-10 rounded-lg bg-cyan-100 flex items-center justify-center">
          <ActivitySquare className="h-6 w-6 text-cyan-600" />
        </div>
        Behaviour Analytics
      </CardTitle>
      {!loading && (
        <Badge className={flaggedCount ? "bg-red-100 text-red-700 hover:bg-red-100" : "bg-slate-100 text-slate-500 hover:bg-slate-100"}>
          {flaggedCount ? `${flaggedCount} flagged` : "No flags"}
        </Badge>
      )}
    </CardHeader>
    <CardContent>
      {loading ? (
        <div className="flex justify-center py-6"><LoadingSpinner /></div>
      ) : !stats.length ? (
        <div className="text-center py-6">
          <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center mx-auto mb-2">
            <ActivitySquare className="h-5 w-5 text-cyan-400" />
          </div>
          <p className="text-sm text-muted-foreground">
            No notes in the last 60 days yet — analytics will populate as you log notes.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {stats.map((s) => (
            <button
              key={s.student.id}
              onClick={() => onSelectStudent(s.student, { level: s.level, breakdown: s.breakdown })}
              className={`w-full flex items-center justify-between p-2.5 rounded-lg border transition-colors text-left ${
                s.level === "high"
                  ? "bg-red-50/60 border-red-100 hover:bg-red-50"
                  : s.level === "watch"
                  ? "bg-amber-50/60 border-amber-100 hover:bg-amber-50"
                  : "bg-slate-50/60 border-slate-100 hover:bg-slate-100/60"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {s.student.full_name}
                  <span className="font-normal text-muted-foreground text-xs">
                    {" "}· {s.student.class}{s.student.section ? `-${s.student.section}` : ""}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.last30ConcernIncident} concern/incident{s.last30ConcernIncident === 1 ? "" : "s"} · {s.last30Total} note{s.last30Total === 1 ? "" : "s"} (30d)
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {s.trend === "up" && (
                  <span className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
                    <TrendingUp className="h-3.5 w-3.5 text-red-600" />
                  </span>
                )}
                {s.trend === "down" && (
                  <span className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
                    <TrendingDown className="h-3.5 w-3.5 text-green-600" />
                  </span>
                )}
                {s.trend === "flat" && (
                  <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
                    <Minus className="h-3.5 w-3.5 text-slate-400" />
                  </span>
                )}
                <Badge className={LEVEL_STYLES[s.level]}>{LEVEL_LABEL[s.level]}</Badge>
              </div>
            </button>
          ))}
        </div>
      )}
    </CardContent>
  </Card>
);
}