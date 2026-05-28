import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useGamification } from "@/hooks/useGamification";
import { Download } from "lucide-react";

interface StudentOption {
  id: string;
  name: string;
}

interface BulkScoreEntryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "pretest" | "posttest";
  lessonId: string;
  lessonTitle: string;
  students: StudentOption[];
  existingRecords?: Array<{ 
    student_id: string; 
    pretest_score: number | null;
    posttest_score: number | null;
    mastery_score: number | null;
    effort_score: number | null;
  }>;
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

export function BulkScoreEntryModal({
  open,
  onOpenChange,
  mode,
  lessonId,
  lessonTitle,
  students,
  existingRecords = [],
  onSaved,
}: BulkScoreEntryModalProps) {
  const { awardXp } = useGamification();
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, ScoreDraft>>({});
  const [saving, setSaving] = useState(false);
  const [bulkScore, setBulkScore] = useState("");

  const existingMap = useMemo(
    () => new Map(existingRecords.map((record) => [record.student_id, record])),
    [existingRecords]
  );

  useEffect(() => {
    if (!open) {
      setBulkScore("");
    }

    const nextDrafts: Record<string, ScoreDraft> = {};
    students.forEach((student) => {
      const record = existingMap.get(student.id);
      nextDrafts[student.id] = {
        pretestScore: record?.pretest_score != null ? String(record.pretest_score) : "",
        posttestScore: record?.posttest_score != null ? String(record.posttest_score) : "",
        masteryScore: record?.mastery_score != null ? String(record.mastery_score) : "",
        effortScore: record?.effort_score != null ? String(record.effort_score) : "",
      };
    });

    setScoreDrafts(nextDrafts);
  }, [open, students, existingMap]);

  const updateDraft = (studentId: string, field: keyof ScoreDraft, value: string) => {
    setScoreDrafts((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || EMPTY_DRAFT),
        [field]: value,
      },
    }));
  };

  const calcNormalizedGain = (pre: number, post: number): number => {
    if (pre >= 100) return 1.0;
    return (post - pre) / (100 - pre);
  };

  const handleSave = async () => {
    if (students.length === 0) {
      toast.error("No students available for this lesson");
      return;
    }

    setSaving(true);
    try {
      if (mode === "pretest") {
        // Pre-test mode: Apply to all students
        if (!bulkScore.trim()) {
          toast.error("Please enter a score");
          setSaving(false);
          return;
        }

        const pretestScore = parseFloat(bulkScore);
        if (isNaN(pretestScore) || pretestScore < 0 || pretestScore > 100) {
          toast.error("Invalid pre-test score");
          setSaving(false);
          return;
        }

        // Apply to all students
        for (const student of students) {
          const { data: existing } = await supabase
            .from("performance_records")
            .select("id")
            .eq("student_id", student.id)
            .eq("lesson_id", lessonId)
            .maybeSingle();

          if (existing?.id) {
            const { error: updateError } = await supabase
              .from("performance_records")
              .update({ pretest_score: pretestScore })
              .eq("id", existing.id);
            if (updateError) throw updateError;
          } else {
            const { error: insertError } = await supabase
              .from("performance_records")
              .insert({
                student_id: student.id,
                lesson_id: lessonId,
                pretest_score: pretestScore,
              });
            if (insertError) throw insertError;
          }
        }

        awardXp("record_pretest_scores", `Recorded pre-test score for ${students.length} students`);
        toast.success(`✓ Saved pre-test score for ${students.length} student${students.length !== 1 ? "s" : ""}`);
      } else {
        // Post-test mode: Save as class-level overview score
        if (!bulkScore.trim()) {
          toast.error("Please enter the class overview score");
          setSaving(false);
          return;
        }

        const posttestScore = parseFloat(bulkScore);
        if (isNaN(posttestScore) || posttestScore < 0 || posttestScore > 100) {
          toast.error("Invalid post-test score");
          setSaving(false);
          return;
        }

        // Save as class-level record
        const { data: existing } = await supabase
          .from("performance_records")
          .select("id")
          .eq("student_id", "class_level")
          .eq("lesson_id", lessonId)
          .maybeSingle();

        if (existing?.id) {
          const { error: updateError } = await supabase
            .from("performance_records")
            .update({ posttest_score: posttestScore })
            .eq("id", existing.id);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from("performance_records")
            .insert({
              student_id: "class_level",
              lesson_id: lessonId,
              posttest_score: posttestScore,
            });
          if (insertError) throw insertError;
        }

        awardXp("record_posttest_scores", `Recorded class-level post-test overview score`);
        toast.success(`✓ Saved class overview score (${posttestScore})`);
      }

      onOpenChange(false);
      onSaved();
    } catch (error: any) {
      console.error("Save error:", error);
      toast.error("Failed to save score: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const downloadTemplate = () => {
    const headers = mode === "pretest" 
      ? ["Student Name", "Pre-test Score (0-100)"]
      : ["Student Name"];
    
    const rows = students.map((s) => {
      if (mode === "pretest") {
        const draft = scoreDrafts[s.id];
        return [s.name, draft?.pretestScore || ""];
      } else {
        return [s.name];
      }
    });

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lessonTitle}-${mode}-scores.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("CSV template downloaded");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "pretest" ? "📊 Record Class Pre-test Scores" : "📊 Class Overview Score"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-2">
            {mode === "pretest" ? "Apply pre-test score to all students" : "Teacher's overall assessment for the class"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {lessonTitle}
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Instructions */}
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm text-blue-900 dark:text-blue-100">
              <strong>💡 How it works:</strong> {mode === "pretest" 
                ? "Enter the pre-test score and it will be saved for all students listed below."
                : "Enter the class overview score (teacher's overall assessment for the class)."}
            </p>
          </div>

          {/* Score Input Section */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 border-2 border-blue-300 dark:border-blue-700 rounded-lg p-6 space-y-4">
            <h3 className="font-semibold text-base text-foreground mb-4">
              {mode === "pretest" ? "Enter Pre-test Score for All Students" : "Enter Class Overview Score"}
            </h3>
            
            <div className="space-y-2">
              <Label htmlFor="bulk-score" className="text-sm font-semibold">
                {mode === "pretest" ? "Pre-test Score (0-100)" : "Class Overview Score (0-100)"} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="bulk-score"
                type="number"
                min="0"
                max="100"
                step="1"
                placeholder="Enter score"
                value={bulkScore}
                onChange={(e) => setBulkScore(e.target.value)}
                className="text-lg font-semibold text-center h-10"
              />
            </div>

            <Button
              onClick={() => {
                if (!bulkScore.trim()) {
                  toast.error("Please enter a score first");
                  return;
                }
                const nextDrafts: Record<string, ScoreDraft> = { ...scoreDrafts };
                students.forEach((student) => {
                  nextDrafts[student.id] = {
                    ...(nextDrafts[student.id] || EMPTY_DRAFT),
                    [mode === "pretest" ? "pretestScore" : "posttestScore"]: bulkScore,
                  };
                });
                setScoreDrafts(nextDrafts);
                setBulkScore("");
              }}
              disabled={!bulkScore || saving}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              size="lg"
            >
              ✨ Apply to All {students.length} Student{students.length !== 1 ? "s" : ""}
            </Button>
          </div>

          {/* Mastery & Effort Info - Only for posttest */}
          {mode === "posttest" && (
            <div className="bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
              <p className="text-sm text-purple-900 dark:text-purple-100 font-semibold mb-1">
                📊 About Class Overview Score
              </p>
              <p className="text-xs text-purple-800 dark:text-purple-200">
                This is the teacher's overall assessment of the class performance. It provides a single metric for class-level comparison and analysis.
              </p>
            </div>
          )}

          {/* Student List Display */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-foreground">
              📋 Students in Class ({students.length} total)
            </h3>
            <div className="bg-white dark:bg-slate-900 border rounded-lg p-4 max-h-[350px] overflow-y-auto space-y-2">
              {students.map((student) => {
                const draft = scoreDrafts[student.id];
                const scoreValue = mode === "pretest" ? draft?.pretestScore : draft?.posttestScore;
                const hasData = !!scoreValue;

                return (
                  <div
                    key={student.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-colors ${
                      hasData
                        ? "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950"
                        : "border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">{student.name}</p>
                    </div>
                    {hasData && (
                      <div className="text-right">
                        <p className="text-green-600 dark:text-green-400 font-semibold text-sm">{scoreValue}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Info */}
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <p className="text-sm text-green-900 dark:text-green-100">
              <strong>✓ All {students.length} student{students.length !== 1 ? "s" : ""} listed above • Ready to save</strong>
            </p>
          </div>
        </div>

        <DialogFooter className="flex gap-2 justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={downloadTemplate}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Download List
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || students.length === 0}
              className="gap-2"
            >
              {saving ? "Saving..." : `Save Score`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
