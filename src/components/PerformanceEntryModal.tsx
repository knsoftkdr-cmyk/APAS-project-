import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useGamification } from "@/hooks/useGamification";

interface StudentOption {
  id: string;
  name: string;
}

interface PerformanceEntryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "pretest" | "exit_ticket";
  lessonId: string;
  lessonTitle: string;
  students: StudentOption[];
  existingRecords?: Array<{ student_id: string; pretest_score: number | null }>;
  onSaved: () => void;
}

interface ScoreDraft {
  pretestScore: string;
  posttestScore: string;
  masteryScore: string;
  effortScore: string;
}

const EMPTY_DRAFT: ScoreDraft = {
  pretestScore: "",
  posttestScore: "",
  masteryScore: "",
  effortScore: "",
};

export function PerformanceEntryModal({
  open, onOpenChange, mode, lessonId, lessonTitle, students, existingRecords = [], onSaved,
}: PerformanceEntryModalProps) {
  const { awardXp } = useGamification();
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, ScoreDraft>>({});
  const [saving, setSaving] = useState(false);

  const existingMap = useMemo(
    () => new Map(existingRecords.map((record) => [record.student_id, record.pretest_score])),
    [existingRecords]
  );

  const studentsToRender = mode === "pretest"
    ? students
    : students.filter((student) => existingMap.get(student.id) != null);

  useEffect(() => {
    if (!open) return;

    const nextDrafts: Record<string, ScoreDraft> = {};
    students.forEach((student) => {
      const pretestScore = existingMap.get(student.id);
      nextDrafts[student.id] = {
        ...EMPTY_DRAFT,
        pretestScore: pretestScore != null ? String(pretestScore) : "",
      };
    });

    setScoreDrafts(nextDrafts);
  }, [open, students, existingMap]);

  const calcNormalizedGain = (pre: number, post: number): number => {
    if (pre >= 100) return 1.0;
    return (post - pre) / (100 - pre);
  };

  const updateDraft = (studentId: string, field: keyof ScoreDraft, value: string) => {
    setScoreDrafts((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || EMPTY_DRAFT),
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    if (studentsToRender.length === 0) {
      toast.error(mode === "pretest" ? "No students available for this lesson" : "Record pre-test scores first");
      return;
    }

    setSaving(true);
    try {
      if (mode === "pretest") {
        const pretestEntries: Array<{ student_id: string; pretest_score: number }> = [];

        for (const student of studentsToRender) {
          const rawScore = scoreDrafts[student.id]?.pretestScore?.trim() || "";
          if (!rawScore) continue;

          const score = Number(rawScore);
          if (Number.isNaN(score) || score < 0 || score > 100) {
            toast.error(`Enter a valid pre-test score (0–100) for ${student.name}`);
            return;
          }

          pretestEntries.push({ student_id: student.id, pretest_score: score });
        }

        if (pretestEntries.length === 0) {
          toast.error("Enter at least one pre-test score");
          return;
        }

        const toInsert = pretestEntries.filter((entry) => existingMap.get(entry.student_id) == null);
        const toUpdate = pretestEntries.filter((entry) => existingMap.get(entry.student_id) != null);

        if (toInsert.length > 0) {
          const { error } = await supabase.from("performance_records").insert(
            toInsert.map((entry) => ({
              student_id: entry.student_id,
              lesson_id: lessonId,
              pretest_score: entry.pretest_score,
            }))
          );
          if (error) throw error;
        }

        if (toUpdate.length > 0) {
          const updateResults = await Promise.all(
            toUpdate.map((entry) =>
              supabase
                .from("performance_records")
                .update({ pretest_score: entry.pretest_score })
                .eq("lesson_id", lessonId)
                .eq("student_id", entry.student_id)
            )
          );
          const updateError = updateResults.find((result) => result.error)?.error;
          if (updateError) throw updateError;
        }

        toast.success(`Pre-test saved for ${pretestEntries.length} student${pretestEntries.length > 1 ? "s" : ""} ✓`);
      } else {
        const posttestEntries: Array<{
          student_id: string;
          posttest_score: number;
          mastery_score: number;
          effort_score: number;
          normalized_gain: number;
        }> = [];

        for (const student of studentsToRender) {
          const draft = scoreDrafts[student.id] || EMPTY_DRAFT;
          const hasAnyInput = Boolean(draft.posttestScore || draft.masteryScore || draft.effortScore);
          if (!hasAnyInput) continue;

          if (!draft.posttestScore || !draft.masteryScore || !draft.effortScore) {
            toast.error(`Complete post-test, mastery, and effort for ${student.name}`);
            return;
          }

          const post = Number(draft.posttestScore);
          const mastery = Number(draft.masteryScore);
          const effort = Number(draft.effortScore);
          if (Number.isNaN(post) || post < 0 || post > 100) {
            toast.error(`Enter a valid post-test score (0–100) for ${student.name}`);
            return;
          }
          if (Number.isNaN(mastery) || mastery < 0 || mastery > 100) {
            toast.error(`Enter a valid mastery score (0–100) for ${student.name}`);
            return;
          }
          if (Number.isNaN(effort) || effort < 1 || effort > 5) {
            toast.error(`Enter effort score (1–5) for ${student.name}`);
            return;
          }

          const preScore = existingMap.get(student.id);
          if (preScore == null) {
            toast.error(`Record pre-test first for ${student.name}`);
            return;
          }

          const normalizedGain = calcNormalizedGain(preScore, post);
          posttestEntries.push({
            student_id: student.id,
            posttest_score: post,
            mastery_score: mastery,
            effort_score: effort,
            normalized_gain: Math.round(normalizedGain * 1000) / 1000,
          });
        }

        if (posttestEntries.length === 0) {
          toast.error("Enter at least one post-test score");
          return;
        }

        const updateResults = await Promise.all(
          posttestEntries.map((entry) =>
            supabase
              .from("performance_records")
              .update({
                posttest_score: entry.posttest_score,
                mastery_score: entry.mastery_score,
                effort_score: entry.effort_score,
                normalized_gain: entry.normalized_gain,
              })
              .eq("lesson_id", lessonId)
              .eq("student_id", entry.student_id)
          )
        );

        const updateError = updateResults.find((result) => result.error)?.error;
        if (updateError) throw updateError;

        toast.success(`Post-test saved for ${posttestEntries.length} student${posttestEntries.length > 1 ? "s" : ""} ✓`);
        await awardXp("record_exit_ticket", "Recorded post-test scores");

        // Check mismatch alert trigger
        await checkMismatchAlert(lessonId);
      }

      onSaved();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const checkMismatchAlert = async (lessonId: string) => {
    try {
      const { data: records } = await supabase
        .from("performance_records")
        .select("student_id, normalized_gain")
        .eq("lesson_id", lessonId)
        .not("normalized_gain", "is", null);

      if (!records) return;
      const lowGainStudents = records.filter(r => (r.normalized_gain ?? 1) < 0.3);
      if (lowGainStudents.length >= 2) {
        const failRate = Math.round((lowGainStudents.length / records.length) * 100);

        // Check if alert already exists for this lesson
        const { data: existing } = await supabase
          .from("mismatch_alerts")
          .select("id")
          .eq("lesson_type", lessonId)
          .eq("status", "flagged")
          .limit(1);

        if (existing && existing.length > 0) return;

        await supabase.from("mismatch_alerts").insert({
          student_group: "Lesson students",
          lesson_type: lessonId,
          fail_rate: failRate,
          trigger_condition: `Low normalized gain < 0.3 for ${lowGainStudents.length} students`,
          recommendation: "Review lesson delivery method and check VARK alignment",
          status: "flagged",
        });
      }
    } catch (err) {
      console.error("Mismatch alert check failed:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "pretest" ? "Record Class Pre-test Scores" : "Record Class Post-test Scores"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">{lessonTitle}</p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>{mode === "pretest" ? "Pre-test Entry" : "Post-test Entry"}</Label>
            <p className="text-xs text-muted-foreground mt-1">
              {mode === "pretest"
                ? "Enter pre-test scores for the class. Leave blank to skip a student."
                : "Enter post-test, mastery, and effort for each student with a pre-test score."}
            </p>
          </div>

          {studentsToRender.length > 0 ? (
            <div className="max-h-[420px] overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[160px]">Student</TableHead>
                    {mode === "pretest" ? (
                      <TableHead className="min-w-[180px]">Pre-test Score (0–100)</TableHead>
                    ) : (
                      <>
                        <TableHead className="min-w-[120px]">Pre-test</TableHead>
                        <TableHead className="min-w-[150px]">Post-test (0–100)</TableHead>
                        <TableHead className="min-w-[150px]">Mastery (0–100)</TableHead>
                        <TableHead className="min-w-[150px]">Effort (1–5)</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {studentsToRender.map((student) => (
                    <TableRow key={student.id}>
                      <TableCell className="font-medium">{student.name}</TableCell>
                      {mode === "pretest" ? (
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={scoreDrafts[student.id]?.pretestScore || ""}
                            onChange={(event) => updateDraft(student.id, "pretestScore", event.target.value)}
                            placeholder="Enter score"
                          />
                        </TableCell>
                      ) : (
                        <>
                          <TableCell>{existingMap.get(student.id) ?? "—"}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              value={scoreDrafts[student.id]?.posttestScore || ""}
                              onChange={(event) => updateDraft(student.id, "posttestScore", event.target.value)}
                              placeholder="Post-test"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              value={scoreDrafts[student.id]?.masteryScore || ""}
                              onChange={(event) => updateDraft(student.id, "masteryScore", event.target.value)}
                              placeholder="Mastery"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={scoreDrafts[student.id]?.effortScore || ""}
                              onValueChange={(value) => updateDraft(student.id, "effortScore", value)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Effort" />
                              </SelectTrigger>
                              <SelectContent>
                                {[1, 2, 3, 4, 5].map((value) => (
                                  <SelectItem key={value} value={String(value)}>
                                    {value} — {["", "Minimal", "Low", "Moderate", "Good", "Excellent"][value]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {mode === "pretest"
                ? "No students are assigned to this lesson yet."
                : "No students with saved pre-test scores yet."}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || studentsToRender.length === 0}>
            {saving ? "Saving..." : "Save Class Scores"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
