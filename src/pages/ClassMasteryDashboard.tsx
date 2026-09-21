import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, BarChart3, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useClassMastery, useGenerateLearningObjectives } from "@/hooks/useMastery";
import { useToast } from "@/hooks/use-toast";

interface ClassOption { id: string; label: string }
interface BookOption { id: number; subject: string; class_name: string | null }

export default function ClassMasteryDashboard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [bookId, setBookId] = useState<string>("");
  const [loadingOptions, setLoadingOptions] = useState(true);

  const { data: topics, isLoading, refetch } = useClassMastery(classId || undefined, bookId ? Number(bookId) : undefined);
  const generateObjectives = useGenerateLearningObjectives();

  useEffect(() => {
    async function loadOptions() {
      setLoadingOptions(true);
      const isStaffAdmin = ["admin", "principal", "school_admin", "hod"].includes(profile?.role ?? "");

      const classQuery = isStaffAdmin
        ? supabase.from("classes").select("id, name, section")
        : supabase.from("class_teachers").select("class_id, classes(id, name, section)").eq("teacher_id", profile?.id ?? "");

      const [{ data: classData }, { data: bookData }] = await Promise.all([
        classQuery,
        supabase.from("books").select("id, subject, class_name").eq("is_active", true).order("subject"),
      ]);

      const classOptions: ClassOption[] = isStaffAdmin
        // deno-lint-ignore no-explicit-any
        ? (classData as any[] ?? []).map((c) => ({ id: c.id, label: `${c.name}${c.section ? " - " + c.section : ""}` }))
        // deno-lint-ignore no-explicit-any
        : (classData as any[] ?? [])
            .filter((c) => c.classes)
            .map((c) => ({ id: c.classes.id, label: `${c.classes.name}${c.classes.section ? " - " + c.classes.section : ""}` }));

      setClasses(classOptions);
      setBooks((bookData as BookOption[]) ?? []);
      setLoadingOptions(false);
    }
    if (profile?.id) loadOptions();
  }, [profile?.id, profile?.role]);

  const weakTopics = (topics ?? []).filter((t) => t.is_weak_spot);

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-violet-600 to-indigo-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <BarChart3 className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Class Mastery</h1>
              <p className="text-violet-100 text-xs md:text-sm mt-0.5">
                Topic-by-topic mastery across your class, with weak spots flagged automatically.
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
            <Select value={classId} onValueChange={setClassId} disabled={loadingOptions}>
              <SelectTrigger className="sm:w-56"><SelectValue placeholder="Choose a class" /></SelectTrigger>
              <SelectContent>
                {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={bookId} onValueChange={setBookId} disabled={loadingOptions}>
              <SelectTrigger className="sm:w-64"><SelectValue placeholder="Choose a subject" /></SelectTrigger>
              <SelectContent>
                {books.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.subject} {b.class_name ? `(${b.class_name})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {!classId || !bookId ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            Pick a class and a subject to see mastery by topic.
          </CardContent></Card>
        ) : isLoading ? (
          <Card><CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
          </CardContent></Card>
        ) : (topics ?? []).length === 0 ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center space-y-3">
            <p>No learning objectives exist for this subject yet, so there's nothing to track.</p>
            <Button
              size="sm"
              disabled={generateObjectives.isPending}
              onClick={async () => {
                toast({ title: "Generating learning objectives…", description: "This can take a minute for a whole subject." });
                await generateObjectives.mutateAsync({ topicId: undefined });
                refetch();
              }}
            >
              <Sparkles className="h-4 w-4 mr-1.5" /> Generate for this subject's concepts
            </Button>
          </CardContent></Card>
        ) : (
          <>
            {weakTopics.length > 0 && (
              <Card className="border-rose-200 dark:border-rose-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="h-4 w-4" /> {weakTopics.length} weak spot{weakTopics.length > 1 ? "s" : ""} — class average below 50%
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {weakTopics.map((t) => (
                    <div key={t.topic_id} className="text-sm flex items-center justify-between">
                      <span>{t.chapter_name} → {t.topic_name}</span>
                      <Badge variant="outline" className="text-rose-600 border-rose-200">{Math.round(t.class_avg_mastery * 100)}%</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">All topics</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {(topics ?? []).map((t) => (
                  <div key={t.topic_id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.topic_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{t.chapter_name}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {t.students_attempted}/{t.students_total} attempted
                    </span>
                    <Badge variant="outline" className={t.is_weak_spot ? "text-rose-600 border-rose-200" : ""}>
                      {Math.round(t.class_avg_mastery * 100)}%
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
