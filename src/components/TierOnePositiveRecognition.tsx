/**
 * TierOnePositiveRecognition.tsx
 * PBIS Tier 1 = universal, whole-roster positive reinforcement — the
 * foundation the other two tiers sit on top of. Unlike Behaviour Analytics
 * (which flags concerning patterns) and InterventionDrawer (which plans a
 * response for one student), this panel is about the opposite direction:
 * making sure good behaviour actually gets noticed and celebrated, and that
 * no student is quietly going unrecognized.
 *
 * Reuses the same `teacher_notes` data you already collect — just reads the
 * "positive" note_type instead of "concern"/"incident".
 */
import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Sparkles, Trophy, HeartHandshake } from "lucide-react";

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

interface Props {
  teacherId: string;
  students: Student[];
  onGiveRecognition: (student: Student) => void; // parent selects student + preps note form for a "positive" note
}

export function TierOnePositiveRecognition({ teacherId, students, onGiveRecognition }: Props) {
  const [notes, setNotes] = useState<RawNote[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotes = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data } = await supabase
        .from("teacher_notes")
        .select("id, student_id, note_type, created_at")
        .eq("teacher_id", teacherId)
        .gte("created_at", thirtyDaysAgo.toISOString());

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

  const { totalPositive, topRecognized, needsRecognition } = useMemo(() => {
    const positiveCount = new Map<string, number>();
    const concernCount = new Map<string, number>();

    notes.forEach((n) => {
      if (n.note_type === "positive") {
        positiveCount.set(n.student_id, (positiveCount.get(n.student_id) || 0) + 1);
      } else if (n.note_type === "concern" || n.note_type === "incident") {
        concernCount.set(n.student_id, (concernCount.get(n.student_id) || 0) + 1);
      }
    });

    const totalPositive = notes.filter((n) => n.note_type === "positive").length;

    const topRecognized = [...positiveCount.entries()]
      .map(([studentId, count]) => ({ student: studentById.get(studentId), count }))
      .filter((r) => r.student)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5) as { student: Student; count: number }[];

    // The core Tier 1 equity check: students who've had a concern/incident
    // note in the last 30 days but ZERO positive notes in the same window.
    // PBIS best practice aims for a high ratio of positive-to-corrective
    // contact per student — this surfaces who's falling short of that.
    const needsRecognition = [...concernCount.entries()]
      .filter(([studentId]) => !positiveCount.has(studentId))
      .map(([studentId, concernCountVal]) => ({ student: studentById.get(studentId), concernCountVal }))
      .filter((r) => r.student)
      .sort((a, b) => b.concernCountVal - a.concernCountVal)
      .slice(0, 5) as { student: Student; concernCountVal: number }[];

    return { totalPositive, topRecognized, needsRecognition };
  }, [notes, studentById]);

  return (
    <Card className="border border-green-200 bg-green-50/30">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-green-600" />
          Tier 1 — Positive Recognition
        </CardTitle>
        {!loading && (
          <span className="text-xs text-muted-foreground">
            {totalPositive} positive note{totalPositive === 1 ? "" : "s"} · last 30 days
          </span>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6"><LoadingSpinner /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Top recognized */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-amber-500" /> Recently Recognized
              </p>
              {!topRecognized.length ? (
                <p className="text-xs text-muted-foreground py-2">No positive notes logged yet this month.</p>
              ) : (
                <div className="space-y-1.5">
                  {topRecognized.map(({ student, count }) => (
                    <div key={student.id} className="flex items-center justify-between p-2 rounded-lg bg-white/60">
                      <span className="text-sm truncate">{student.full_name}</span>
                      <Badge className="bg-green-100 text-green-700 shrink-0">{count}×</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Needs recognition */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <HeartHandshake className="h-3.5 w-3.5 text-rose-500" /> Could Use Some Recognition
              </p>
              {!needsRecognition.length ? (
                <p className="text-xs text-muted-foreground py-2">
                  Nobody flagged — every student with a concern note also has a recent positive one.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {needsRecognition.map(({ student }) => (
                    <div key={student.id} className="flex items-center justify-between p-2 rounded-lg bg-white/60 gap-2">
                      <span className="text-sm truncate">{student.full_name}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs shrink-0"
                        onClick={() => onGiveRecognition(student)}
                      >
                        + Recognize
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
