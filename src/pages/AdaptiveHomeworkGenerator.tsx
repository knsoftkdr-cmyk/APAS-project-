import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Wand2, Loader2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useClassSubjectPicker } from "@/hooks/useClassSubjectPicker";
import { HomeworkBatches } from "@/components/adaptive-homework/HomeworkResults";
import { supabase } from "@/integrations/supabase/client";
import { useGenerateAdaptiveHomework, useAdaptiveHomeworkAssignments, type MasteryBand } from "@/hooks/useAdaptiveHomework";

interface ChapterOption { id: number; chapter_name: string }

const BAND_META: Record<MasteryBand, { label: string; className: string }> = {
  beginning: { label: "Beginning", className: "bg-red-100 text-red-800 border-red-300" },
  developing: { label: "Developing", className: "bg-amber-100 text-amber-800 border-amber-300" },
  proficient: { label: "Proficient", className: "bg-blue-100 text-blue-800 border-blue-300" },
  mastered: { label: "Mastered", className: "bg-emerald-100 text-emerald-800 border-emerald-300" },
};

export default function AdaptiveHomeworkGenerator() {
  // Classes = this school's classes; Subjects = only the textbooks that belong to the chosen class.
  const {
    classes, classId, setClassId, subjects, bookId, setBookId, loadingClasses, loadingSubjects,
  } = useClassSubjectPicker();
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [chapterId, setChapterId] = useState("");
  const [title, setTitle] = useState("");
  const [itemsPerStudent, setItemsPerStudent] = useState(6);

  const generate = useGenerateAdaptiveHomework();
  const { data: pastAssignments, refetch: refetchAssignments } = useAdaptiveHomeworkAssignments(classId || undefined);

  useEffect(() => {
    setChapterId("");
    if (!bookId) { setChapters([]); return; }
    supabase
      .from("curriculum_chapters")
      .select("id, chapter_name, unit_id, units!inner(book_id)")
      .eq("units.book_id", Number(bookId))
      .then(({ data }) => setChapters((data as unknown as ChapterOption[]) ?? []));
  }, [bookId]);

  const handleGenerate = async () => {
    if (!classId || !bookId) return;
    try {
      const result = await generate.mutateAsync({
        classId, bookId: Number(bookId),
        chapterId: chapterId ? Number(chapterId) : undefined,
        title: title || undefined,
        itemsPerStudent,
      });
      toast.success(`Generated homework for ${result.student_count} student(s).`);
      refetchAssignments();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate homework.");
    }
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-violet-600 to-indigo-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Wand2 className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Adaptive Homework Generator</h1>
              <p className="text-violet-100 text-xs md:text-sm mt-0.5">
                One click generates a different set for every student — shaped to their own mastery band.
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Generate a new set</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Class</Label>
                <Select value={classId} onValueChange={setClassId} disabled={loadingClasses || classes.length === 0}>
                  <SelectTrigger><SelectValue placeholder={loadingClasses ? "Loading classes…" : classes.length === 0 ? "No classes found" : "Choose a class"} /></SelectTrigger>
                  <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Subject</Label>
                <Select value={bookId} onValueChange={setBookId} disabled={!classId || loadingSubjects || subjects.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder={!classId ? "Choose a class first" : loadingSubjects ? "Loading subjects…" : subjects.length === 0 ? "No subjects for this class" : "Choose a subject"} />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((sub) => <SelectItem key={sub.bookId} value={String(sub.bookId)}>{sub.subject}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Chapter <span className="text-muted-foreground font-normal">(optional — whole subject if left blank)</span></Label>
                <Select value={chapterId} onValueChange={setChapterId} disabled={!bookId || chapters.length === 0}>
                  <SelectTrigger><SelectValue placeholder="Any chapter" /></SelectTrigger>
                  <SelectContent>{chapters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.chapter_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Items per student</Label>
                <Input type="number" min={1} max={20} value={itemsPerStudent}
                  onChange={(e) => setItemsPerStudent(Math.max(1, Math.min(20, Number(e.target.value) || 6)))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Title <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Week 4 practice" />
            </div>

            <Button onClick={handleGenerate} disabled={!classId || !bookId || generate.isPending} className="w-full sm:w-auto">
              {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
              Generate homework for this class
            </Button>

            {generate.data && (
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-1.5"><Users className="h-4 w-4" /> {generate.data.student_count} set(s) generated</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(BAND_META) as MasteryBand[]).map((band) => {
                    const count = generate.data!.band_counts[band] ?? 0;
                    if (!count) return null;
                    return (
                      <Badge key={band} variant="outline" className={cn("text-[11px]", BAND_META[band].className)}>
                        {BAND_META[band].label}: {count}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {classId && (pastAssignments ?? []).length > 0 && <HomeworkBatches assignments={pastAssignments ?? []} />}
      </div>
    </AppLayout>
  );
}
