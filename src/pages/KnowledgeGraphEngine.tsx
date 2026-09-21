import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GitBranch, Sparkles, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  useTopicGraph, useConceptGraph, useGenerateKnowledgeGraph,
} from "@/hooks/useKnowledgeGraph";
import { GraphCanvas } from "@/components/knowledge-graph/GraphCanvas";
import { MisconceptionsList } from "@/components/knowledge-graph/MisconceptionsList";

interface BookOption { id: number; subject: string; class_name: string | null }

export default function KnowledgeGraphEngine() {
  const { toast } = useToast();
  const [books, setBooks] = useState<BookOption[]>([]);
  const [bookId, setBookId] = useState<string>("");
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);
  const [selectedConceptId, setSelectedConceptId] = useState<number | null>(null);

  const generate = useGenerateKnowledgeGraph();
  const { data: topicGraph, isLoading: topicsLoading, refetch: refetchTopics } = useTopicGraph(bookId ? Number(bookId) : undefined);
  const { data: conceptGraph, isLoading: conceptsLoading, refetch: refetchConcepts } =
    useConceptGraph(selectedTopicId ?? undefined);

  useEffect(() => {
    supabase.from("books").select("id, subject, class_name").eq("is_active", true).order("subject")
      .then(({ data }) => setBooks((data as BookOption[]) ?? []));
  }, []);

  const selectedMisconceptions = (conceptGraph?.misconceptions ?? []).filter(
    (m) => selectedConceptId == null || m.subtopic_id === selectedConceptId,
  );

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
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3 items-center">
            <Select value={bookId} onValueChange={(v) => { setBookId(v); setSelectedTopicId(null); setSelectedConceptId(null); }}>
              <SelectTrigger className="sm:w-72"><SelectValue placeholder="Choose a subject" /></SelectTrigger>
              <SelectContent>
                {books.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.subject} {b.class_name ? `(${b.class_name})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {bookId && !selectedTopicId && (
              <Button
                size="sm" variant="outline" disabled={generate.isPending}
                onClick={async () => {
                  toast({ title: "Mapping topic dependencies…", description: "This can take a minute for a whole subject." });
                  const res = await generate.mutateAsync({ bookId: Number(bookId) });
                  toast({ title: `Added ${res.inserted ?? 0} prerequisite links` });
                  refetchTopics();
                }}
              >
                <Sparkles className="h-4 w-4 mr-1.5" /> Generate topic graph
              </Button>
            )}
          </CardContent>
        </Card>

        {!bookId ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            Pick a subject to see how its topics depend on each other.
          </CardContent></Card>
        ) : !selectedTopicId ? (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Topic dependency graph</CardTitle></CardHeader>
            <CardContent>
              {topicsLoading ? <Skeleton className="h-64 w-full" /> : (
                <GraphCanvas
                  nodes={topicGraph?.nodes ?? []}
                  edges={topicGraph?.edges ?? []}
                  onSelect={(id) => setSelectedTopicId(id)}
                />
              )}
              <p className="text-xs text-muted-foreground mt-2">Click a topic to drill into its concepts.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => { setSelectedTopicId(null); setSelectedConceptId(null); }}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to topic overview
            </Button>

            <div className="grid md:grid-cols-3 gap-4">
              <Card className="md:col-span-2">
                <CardHeader className="pb-2 flex-row items-center justify-between">
                  <CardTitle className="text-sm">
                    {topicGraph?.nodes.find((n) => n.id === selectedTopicId)?.name ?? "Concepts"}
                  </CardTitle>
                  <Button
                    size="sm" variant="outline" disabled={generate.isPending}
                    onClick={async () => {
                      toast({ title: "Mapping concepts & misconceptions…" });
                      const res = await generate.mutateAsync({ topicId: selectedTopicId });
                      toast({ title: `Added ${res.edges_inserted ?? 0} links, ${res.misconceptions_inserted ?? 0} misconceptions` });
                      refetchConcepts();
                    }}
                  >
                    <Sparkles className="h-4 w-4 mr-1.5" /> Generate
                  </Button>
                </CardHeader>
                <CardContent>
                  {conceptsLoading ? <Skeleton className="h-64 w-full" /> : (
                    <GraphCanvas
                      nodes={conceptGraph?.nodes ?? []}
                      edges={conceptGraph?.edges ?? []}
                      selectedId={selectedConceptId}
                      onSelect={(id) => setSelectedConceptId(id)}
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
