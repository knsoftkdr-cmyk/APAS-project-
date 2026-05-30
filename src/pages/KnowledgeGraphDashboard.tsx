/**
 * KnowledgeGraphDashboard.tsx — Knowledge Graph for KNSoft Admin
 * Uses knowledge_chunks for concept relationships
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Network, Search, BookOpen, RefreshCw, FileText } from "lucide-react";

interface Chunk {
  id: string;
  subject: string;
  curriculum: string;
  class_level: string;
  source_type: string;
  file_name: string;
  chunk_text: string;
  created_at: string;
  embedding_id: string | null;
}

export default function KnowledgeGraphDashboard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Chunk | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("knowledge_chunks")
        .select("id, subject, curriculum, class_level, source_type, file_name, chunk_text, created_at, embedding_id")
        .order("subject", { ascending: true });
      setChunks(data ?? []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSelect = (chunk: Chunk) => {
    setSelected(chunk);
    setEditText(chunk.chunk_text ?? "");
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    const { error } = await supabase
      .from("knowledge_chunks")
      .update({ chunk_text: editText })
      .eq("id", selected.id);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Concept map updated" });
      fetchAll();
    }
  };

  // Build concept relationships from subjects
  const subjectMap: Record<string, { count: number; classes: Set<string>; curricula: Set<string> }> = {};
  for (const c of chunks) {
    const s = c.subject ?? "Unknown";
    if (!subjectMap[s]) subjectMap[s] = { count: 0, classes: new Set(), curricula: new Set() };
    subjectMap[s].count++;
    if (c.class_level) subjectMap[s].classes.add(c.class_level);
    if (c.curriculum) subjectMap[s].curricula.add(c.curriculum);
  }

  const filtered = chunks.filter(c =>
    !search || c.subject?.toLowerCase().includes(search.toLowerCase()) ||
    c.file_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.chunk_text?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <AppLayout><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div></AppLayout>;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Network className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Knowledge Graph Dashboard</h1>
              <p className="text-sm text-muted-foreground">Concept relationships, topic dependencies</p>
            </div>
          </div>
          <Button variant="outline" onClick={fetchAll} className="gap-1.5"><RefreshCw className="h-4 w-4" /> Refresh</Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Concepts", value: chunks.length, icon: BookOpen, color: "text-blue-600" },
            { label: "Subjects", value: Object.keys(subjectMap).length, icon: Network, color: "text-purple-600" },
            { label: "With Embeddings", value: chunks.filter(c => c.embedding_id).length, icon: FileText, color: "text-green-600" },
            { label: "Pending Embed", value: chunks.filter(c => !c.embedding_id).length, icon: FileText, color: "text-yellow-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-6 pb-4 flex items-center gap-4">
                <div className={`rounded-lg bg-muted p-2 ${color}`}><Icon className="h-5 w-5" /></div>
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="graph" className="space-y-4">
          <TabsList>
            <TabsTrigger value="graph">Graph Visualization</TabsTrigger>
            <TabsTrigger value="concepts">View/Edit Concept Maps</TabsTrigger>
          </TabsList>

          {/* Graph Visualization */}
          <TabsContent value="graph">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Subject nodes */}
              <Card className="md:col-span-1">
                <CardHeader><CardTitle className="text-sm">Subject Nodes</CardTitle></CardHeader>
                <CardContent className="p-0 max-h-[500px] overflow-y-auto">
                  {Object.entries(subjectMap).map(([subject, data]) => (
                    <button
                      key={subject}
                      onClick={() => setSearch(subject)}
                      className={`w-full text-left px-4 py-3 border-b border-border hover:bg-muted transition-colors ${search === subject ? "bg-muted" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{subject}</span>
                        <Badge variant="outline" className="text-xs">{data.count}</Badge>
                      </div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {Array.from(data.classes).slice(0, 3).map(c => (
                          <Badge key={c} variant="secondary" className="text-xs">Class {c}</Badge>
                        ))}
                        {Array.from(data.classes).length > 3 && <Badge variant="secondary" className="text-xs">+{Array.from(data.classes).length - 3}</Badge>}
                      </div>
                    </button>
                  ))}
                  {Object.keys(subjectMap).length === 0 && <p className="p-4 text-center text-muted-foreground text-sm">No subjects.</p>}
                </CardContent>
              </Card>

              {/* Relationship map */}
              <Card className="md:col-span-2">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Concept Relationships</CardTitle>
                    {search && <Button variant="ghost" size="sm" onClick={() => setSearch("")}>Clear filter</Button>}
                  </div>
                </CardHeader>
                <CardContent className="p-0 max-h-[500px] overflow-y-auto">
                  {filtered.length === 0 ? (
                    <p className="p-6 text-center text-muted-foreground text-sm">No concepts found.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 p-4">
                      {filtered.slice(0, 30).map((c) => (
                        <div
                          key={c.id}
                          onClick={() => handleSelect(c)}
                          className={`p-3 rounded-lg border cursor-pointer hover:border-primary transition-colors ${selected?.id === c.id ? "border-primary bg-primary/5" : "border-border"}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-sm">{c.subject ?? "Unknown"}</span>
                            <div className="flex gap-1">
                              <Badge variant="outline" className="text-xs">Class {c.class_level}</Badge>
                              {c.embedding_id ? <Badge className="bg-green-100 text-green-800 text-xs">Embedded</Badge> : <Badge variant="outline" className="text-xs">Pending</Badge>}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{c.chunk_text?.slice(0, 100)}…</p>
                          <p className="text-xs text-muted-foreground mt-1">{c.file_name} · {c.curriculum}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Edit Concept Maps */}
          <TabsContent value="concepts">
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search concepts by subject, file, or content..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* List */}
                <Card>
                  <CardHeader><CardTitle className="text-sm">Concept List ({filtered.length})</CardTitle></CardHeader>
                  <CardContent className="p-0 max-h-[400px] overflow-y-auto">
                    {filtered.slice(0, 50).map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleSelect(c)}
                        className={`w-full text-left px-4 py-2 border-b border-border hover:bg-muted transition-colors ${selected?.id === c.id ? "bg-muted" : ""}`}
                      >
                        <p className="font-medium text-sm">{c.subject} — Class {c.class_level}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.file_name}</p>
                      </button>
                    ))}
                    {filtered.length === 0 && <p className="p-4 text-center text-muted-foreground text-sm">No results.</p>}
                  </CardContent>
                </Card>

                {/* Editor */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">{selected ? `Edit: ${selected.subject} / Class ${selected.class_level}` : "Select a concept to edit"}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selected ? (
                      <>
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant="outline">{selected.subject}</Badge>
                          <Badge variant="outline">Class {selected.class_level}</Badge>
                          <Badge variant="outline">{selected.curriculum}</Badge>
                          <Badge variant="outline">{selected.source_type}</Badge>
                        </div>
                        <textarea
                          className="w-full h-48 p-3 text-sm border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary bg-background"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                        />
                        <Button onClick={handleSave} disabled={saving} className="w-full">
                          {saving ? <LoadingSpinner size="sm" /> : "Save Concept Map"}
                        </Button>
                      </>
                    ) : (
                      <p className="text-center text-muted-foreground py-12">Click a concept from the list to view and edit it</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
