import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sparkles, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCalibrateBktParams } from "@/hooks/useMasteryHistory";

interface BookOption { id: number; subject: string; class_name: string | null }
interface TopicOption { id: number; topic_name: string }
interface ConceptOption { id: number; subtopic_name: string }
interface ObjectiveRow {
  id: number;
  objective_text: string;
  p_init: number; p_transit: number; p_slip: number; p_guess: number;
  is_calibrated: boolean;
  calibration_sample_size: number | null;
  calibration_log_likelihood: number | null;
}

export default function BktCalibration() {
  const { toast } = useToast();
  const calibrate = useCalibrateBktParams();

  const [books, setBooks] = useState<BookOption[]>([]);
  const [topics, setTopics] = useState<TopicOption[]>([]);
  const [concepts, setConcepts] = useState<ConceptOption[]>([]);
  const [objectives, setObjectives] = useState<ObjectiveRow[]>([]);

  const [bookId, setBookId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [subtopicId, setSubtopicId] = useState("");
  const [loadingObjectives, setLoadingObjectives] = useState(false);
  const [calibratingId, setCalibratingId] = useState<number | "batch" | null>(null);

  useEffect(() => {
    supabase.from("books").select("id, subject, class_name").eq("is_active", true).order("subject")
      .then(({ data }) => setBooks((data as BookOption[]) ?? []));
  }, []);

  useEffect(() => {
    setTopicId(""); setSubtopicId(""); setConcepts([]); setObjectives([]);
    if (!bookId) { setTopics([]); return; }
    supabase
      .from("topics")
      .select("id, topic_name, curriculum_chapters!inner(unit_id, units!inner(book_id))")
      .eq("curriculum_chapters.units.book_id", Number(bookId))
      .then(({ data }) => setTopics((data as TopicOption[]) ?? []));
  }, [bookId]);

  useEffect(() => {
    setSubtopicId(""); setObjectives([]);
    if (!topicId) { setConcepts([]); return; }
    supabase.from("subtopics").select("id, subtopic_name").eq("topic_id", Number(topicId)).eq("is_active", true)
      .then(({ data }) => setConcepts((data as ConceptOption[]) ?? []));
  }, [topicId]);

  const loadObjectives = async () => {
    if (!subtopicId) return;
    setLoadingObjectives(true);
    const { data } = await supabase
      .from("learning_objectives")
      .select("id, objective_text, mastery_bkt_params(p_init, p_transit, p_slip, p_guess, is_calibrated, calibration_sample_size, calibration_log_likelihood)")
      .eq("subtopic_id", Number(subtopicId))
      .eq("status", "active");
    // deno-lint-ignore no-explicit-any
    const rows: ObjectiveRow[] = (data as any[] ?? []).map((r) => ({
      id: r.id,
      objective_text: r.objective_text,
      p_init: r.mastery_bkt_params?.p_init ?? 0.3,
      p_transit: r.mastery_bkt_params?.p_transit ?? 0.15,
      p_slip: r.mastery_bkt_params?.p_slip ?? 0.1,
      p_guess: r.mastery_bkt_params?.p_guess ?? 0.2,
      is_calibrated: r.mastery_bkt_params?.is_calibrated ?? false,
      calibration_sample_size: r.mastery_bkt_params?.calibration_sample_size ?? null,
      calibration_log_likelihood: r.mastery_bkt_params?.calibration_log_likelihood ?? null,
    }));
    setObjectives(rows);
    setLoadingObjectives(false);
  };

  useEffect(() => { loadObjectives(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [subtopicId]);

  const runCalibration = async (learningObjectiveId: number) => {
    setCalibratingId(learningObjectiveId);
    try {
      const results = await calibrate.mutateAsync({ learningObjectiveId });
      const r = results[0];
      toast({
        title: r?.calibrated ? "Calibrated" : "Not enough data",
        description: r?.calibrated
          ? `Fit from ${r.student_count} students, ${r.event_count} attempts (log-likelihood ${r.log_likelihood})`
          : `Needs at least 5 students and 20 attempts — currently ${r?.student_count ?? 0} students, ${r?.event_count ?? 0} attempts.`,
      });
      loadObjectives();
    } catch {
      toast({ title: "Calibration failed", variant: "destructive" });
    } finally {
      setCalibratingId(null);
    }
  };

  const runBatchCalibration = async () => {
    if (!subtopicId) return;
    setCalibratingId("batch");
    try {
      const results = await calibrate.mutateAsync({ subtopicId: Number(subtopicId) });
      const calibrated = results.filter((r) => r.calibrated).length;
      toast({ title: `Calibrated ${calibrated}/${results.length} objectives` });
      loadObjectives();
    } catch {
      toast({ title: "Batch calibration failed", variant: "destructive" });
    } finally {
      setCalibratingId(null);
    }
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-cyan-700 to-blue-800 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Activity className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">BKT Calibration</h1>
              <p className="text-cyan-100 text-xs md:text-sm mt-0.5">
                Fit each objective's learn/slip/guess rates from real student data instead of defaults.
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
            <Select value={bookId} onValueChange={setBookId}>
              <SelectTrigger className="sm:w-60"><SelectValue placeholder="Subject" /></SelectTrigger>
              <SelectContent>
                {books.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.subject} {b.class_name ? `(${b.class_name})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={topicId} onValueChange={setTopicId} disabled={!bookId}>
              <SelectTrigger className="sm:w-60"><SelectValue placeholder="Topic" /></SelectTrigger>
              <SelectContent>
                {topics.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.topic_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={subtopicId} onValueChange={setSubtopicId} disabled={!topicId}>
              <SelectTrigger className="sm:w-60"><SelectValue placeholder="Concept" /></SelectTrigger>
              <SelectContent>
                {concepts.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.subtopic_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {!subtopicId ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            Pick a subject, topic and concept to see and calibrate its learning objectives.
          </CardContent></Card>
        ) : loadingObjectives ? (
          <Card><CardContent className="p-6 space-y-2">
            <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
          </CardContent></Card>
        ) : (
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="text-sm">Learning objectives ({objectives.length})</CardTitle>
              <Button size="sm" variant="outline" disabled={calibratingId !== null} onClick={runBatchCalibration}>
                <Sparkles className="h-4 w-4 mr-1.5" /> Calibrate all
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Objective</TableHead>
                    <TableHead className="text-right">P(init)</TableHead>
                    <TableHead className="text-right">P(learn)</TableHead>
                    <TableHead className="text-right">P(slip)</TableHead>
                    <TableHead className="text-right">P(guess)</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {objectives.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="max-w-xs truncate text-sm">{o.objective_text}</TableCell>
                      <TableCell className="text-right text-xs">{o.p_init.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-xs">{o.p_transit.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-xs">{o.p_slip.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-xs">{o.p_guess.toFixed(2)}</TableCell>
                      <TableCell>
                        {o.is_calibrated ? (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-200 text-[10px]">
                            Calibrated · n={o.calibration_sample_size}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground text-[10px]">Default</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm" variant="ghost" disabled={calibratingId !== null}
                          onClick={() => runCalibration(o.id)}
                        >
                          {calibratingId === o.id ? "Fitting…" : "Calibrate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
