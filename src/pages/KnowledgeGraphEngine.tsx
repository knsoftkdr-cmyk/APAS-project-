import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ArrowLeft, GitBranch, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useClassSubjectPicker } from "@/hooks/useClassSubjectPicker";
import {
  useTopicGraph, useConceptGraph, useGenerateKnowledgeGraph,
} from "@/hooks/useKnowledgeGraph";
import { GraphCanvas } from "@/components/knowledge-graph/GraphCanvas";
import { MisconceptionsList } from "@/components/knowledge-graph/MisconceptionsList";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

function ErrorNote({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground max-w-md break-words">{errText(error)}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  );
}

export default function KnowledgeGraphEngine() {
  const { toast } = useToast();
  const {
    classes, classId, setClassId,
    subjects, bookId, setBookId, selectedClass, selectedSubject,
    loadingClasses, loadingSubjects,
  } = useClassSubjectPicker();
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);
  const [selectedConceptId, setSelectedConceptId] = useState<number | null>(null);

  const generate = useGenerateKnowledgeGraph();
  const numericBookId = bookId ? Number(bookId) : undefined;
  const topics = useTopicGraph(numericBookId);
  const concepts = useConceptGraph(selectedTopicId ?? undefined);
  const topicGraph = topics.data;
  const conceptGraph = concepts.data;

  // A different class or subject always starts from the topic overview again.
  useEffect(() => { setSelectedTopicId(null); setSelectedConceptId(null); }, [classId, bookId]);

  const selectedMisconceptions = (conceptGraph?.misconceptions ?? []).filter(
    (m) => selectedConceptId == null || m.subtopic_id === selectedConceptId,
  );

  async function generateTopicGraph() {
    if (!numericBookId) return;
    toast({ title: "Mapping topic dependencies…", description: "This can take a minute for a whole subject." });
    try {
      const res = await generate.mutateAsync({ bookId: numericBookId });
      const skipped = Array.isArray(res?.skipped) ? res.skipped.length : 0;
      toast({
        title: `Saved ${res?.inserted ?? 0} prerequisite link${res?.inserted === 1 ? "" : "s"}`,
        description: skipped ? `${skipped} suggested link${skipped === 1 ? " was" : "s were"} left out because they would have formed a loop.` : undefined,
      });
    } catch (e) {
      toast({ title: "Couldn't generate the topic graph", description: errText(e), variant: "destructive" });
    }
  }

  async function generateConceptGraph() {
    if (!selectedTopicId) return;
    toast({ title: "Mapping concepts & misconceptions…" });
    try {
      const res = await generate.mutateAsync({ topicId: selectedTopicId });
      const skipped = Array.isArray(res?.edges_skipped) ? res.edges_skipped.length : 0;
      toast({
        title: `Saved ${res?.edges_inserted ?? 0} link${res?.edges_inserted === 1 ? "" : "s"} and ${res?.misconceptions_inserted ?? 0} misconception${res?.misconceptions_inserted === 1 ? "" : "s"}`,
        description: skipped ? `${skipped} suggested link${skipped === 1 ? " was" : "s were"} left out because they would have formed a loop.` : undefined,
      });
    } catch (e) {
      toast({ title: "Couldn't generate concepts", description: errText(e), variant: "destructive" });
    }
  }

  const noClasses = !loadingClasses && classes.length === 0;
  const noSubjects = !!classId && !loadingSubjects && subjects.length === 0;
  const nodeCount = topicGraph?.nodes.length ?? 0;
  const edgeCount = topicGraph?.edges.length ?? 0;

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-slate-700 to-slate-900 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <GitBranch className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Knowledge Graph Engine</h1>
              <p className="text-slate-300 text-xs md:text-sm mt-0.5">
                Prerequisites, dependencies and common misconceptions across your curriculum.
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
            <Select value={classId} onValueChange={setClassId} disabled={loadingClasses || noClasses}>
              <SelectTrigger className="sm:w-60" aria-label="Class">
                <SelectValue placeholder={loadingClasses ? "Loading classes…" : noClasses ? "No classes assigned" : "Choose a class"} />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={bookId} onValueChange={setBookId} disabled={!classId || loadingSubjects || subjects.length === 0}>
              <SelectTrigger className="sm:w-64" aria-label="Subject">
                <SelectValue
                  placeholder={
                    !classId ? "Choose a class first"
                    : loadingSubjects ? "Loading subjects…"
                    : subjects.length === 0 ? "No subjects for this class"
                    : "Choose a subject"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((s) => <SelectItem key={s.bookId} value={String(s.bookId)}>{s.subject}</SelectItem>)}
              </SelectContent>
            </Select>

            {loadingSubjects && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}

            {numericBookId && !selectedTopicId && (
              <Button size="sm" variant="outline" className="sm:ml-auto" disabled={generate.isPending || topics.isLoading} onClick={generateTopicGraph}>
                {generate.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
                {edgeCount > 0 ? "Refresh topic graph" : "Generate topic graph"}
              </Button>
            )}
          </CardContent>
        </Card>

        {noClasses ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            You aren't assigned to any class yet. Ask your school admin to assign you to a class and section.
          </CardContent></Card>
        ) : !classId ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            Choose a class, then a subject, to see how its topics depend on each other.
          </CardContent></Card>
        ) : noSubjects ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            No textbook is set up for {selectedClass?.label ?? "this class"} yet, so there are no subjects to show.
          </CardContent></Card>
        ) : !numericBookId ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            Pick a subject to see how its topics depend on each other.
          </CardContent></Card>
        ) : !selectedTopicId ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Topic dependency graph
                <span className="font-normal text-muted-foreground">
                  {" — "}{selectedSubject?.subject}{selectedClass ? `, ${selectedClass.label}` : ""}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topics.isLoading ? <Skeleton className="h-64 w-full" />
                : topics.isError ? <ErrorNote title="Couldn't load the topic graph" error={topics.error} onRetry={() => topics.refetch()} />
                : (
                  <>
                    <GraphCanvas
                      nodes={topicGraph?.nodes ?? []}
                      edges={topicGraph?.edges ?? []}
                      onSelect={(id) => setSelectedTopicId(id)}
                      emptyMessage="This subject has no topics yet. Upload or re-run the textbook loader so its units, chapters and topics are extracted."
                    />
                    {nodeCount > 0 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        {nodeCount} topic{nodeCount === 1 ? "" : "s"}, {edgeCount} prerequisite link{edgeCount === 1 ? "" : "s"}.{" "}
                        {edgeCount === 0
                          ? "No links yet — use “Generate topic graph” to map which topics build on each other."
                          : "Click a topic to drill into its concepts."}
                      </p>
                    )}
                  </>
                )}
            </CardContent>
          </Card>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => { setSelectedTopicId(null); setSelectedConceptId(null); }}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to topic overview
            </Button>

            <div className="grid md:grid-cols-3 gap-4">
              <Card className="md:col-span-2">
                <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm">
                    {topicGraph?.nodes.find((n) => n.id === selectedTopicId)?.name ?? "Concepts"}
                  </CardTitle>
                  <Button size="sm" variant="outline" disabled={generate.isPending || concepts.isLoading} onClick={generateConceptGraph}>
                    {generate.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
                    {(conceptGraph?.edges.length ?? 0) > 0 ? "Refresh" : "Generate"}
                  </Button>
                </CardHeader>
                <CardContent>
                  {concepts.isLoading ? <Skeleton className="h-64 w-full" />
                    : concepts.isError ? <ErrorNote title="Couldn't load the concepts" error={concepts.error} onRetry={() => concepts.refetch()} />
                    : (
                      <GraphCanvas
                        nodes={conceptGraph?.nodes ?? []}
                        edges={conceptGraph?.edges ?? []}
                        selectedId={selectedConceptId}
                        onSelect={(id) => setSelectedConceptId(id)}
                        emptyMessage="This topic has no concepts yet."
                      />
                    )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">
                  {selectedConceptId
                    ? `Misconceptions — ${conceptGraph?.nodes.find((n) => n.id === selectedConceptId)?.name ?? ""}`
                    : "Misconceptions"}
                </CardTitle></CardHeader>
                <CardContent>
                  {!selectedConceptId ? (
                    <p className="text-sm text-muted-foreground">Select a concept to see its common misconceptions.</p>
                  ) : (
                    <MisconceptionsList misconceptions={selectedMisconceptions} />
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
