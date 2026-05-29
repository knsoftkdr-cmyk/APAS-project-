/**
 * CacheManagementDashboard.tsx — Cache Management for KNSoft Admin
 * Uses knowledge_chunks as the cache repository
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Database, RefreshCw, Trash2, BookOpen, BarChart3 } from "lucide-react";

interface CacheChunk {
  id: string;
  file_name: string;
  subject: string;
  curriculum: string;
  class_level: string;
  source_type: string;
  created_at: string;
  embedding_id: string | null;
}

export default function CacheManagementDashboard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [chunks, setChunks] = useState<CacheChunk[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("knowledge_chunks")
        .select("id, file_name, subject, curriculum, class_level, source_type, created_at, embedding_id")
        .order("created_at", { ascending: false });
      setChunks(data ?? []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this cache entry?")) return;
    setDeleting(id);
    const { error } = await supabase.from("knowledge_chunks").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Cache entry deleted" });
      fetchAll();
    }
    setDeleting(null);
  };

  // Stats
  const totalChunks = chunks.length;
  const withEmbeddings = chunks.filter(c => c.embedding_id).length;
  const hitRate = totalChunks > 0 ? Math.round((withEmbeddings / totalChunks) * 100) : 0;
  const uniqueSubjects = new Set(chunks.map(c => c.subject).filter(Boolean)).size;

  // By subject chart
  const subjectMap: Record<string, number> = {};
  for (const c of chunks) {
    const s = c.subject ?? "Unknown";
    subjectMap[s] = (subjectMap[s] ?? 0) + 1;
  }
  const subjectChart = Object.entries(subjectMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([subject, count]) => ({ subject: subject.length > 12 ? subject.slice(0, 12) + "…" : subject, count }));

  // By source type
  const sourceMap: Record<string, number> = {};
  for (const c of chunks) {
    const s = c.source_type ?? "Unknown";
    sourceMap[s] = (sourceMap[s] ?? 0) + 1;
  }

  if (loading) return <AppLayout><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div></AppLayout>;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Cache Management</h1>
              <p className="text-sm text-muted-foreground">Cached lessons, embeddings, response reuse stats</p>
            </div>
          </div>
          <Button variant="outline" onClick={fetchAll} className="gap-1.5">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Cache Entries", value: totalChunks, icon: Database, color: "text-blue-600" },
            { label: "With Embeddings", value: withEmbeddings, icon: BookOpen, color: "text-green-600" },
            { label: "Cache Hit Rate", value: `${hitRate}%`, icon: BarChart3, color: hitRate > 70 ? "text-green-600" : "text-yellow-600" },
            { label: "Unique Subjects", value: uniqueSubjects, icon: BookOpen, color: "text-purple-600" },
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

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Analytics</TabsTrigger>
            <TabsTrigger value="entries">Cache Entries</TabsTrigger>
          </TabsList>

          {/* Analytics */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle>Cache by Subject</CardTitle></CardHeader>
                <CardContent>
                  {subjectChart.length === 0 ? <p className="text-center text-muted-foreground py-8">No data.</p> : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={subjectChart} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis dataKey="subject" type="category" tick={{ fontSize: 11 }} width={80} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#2563eb" radius={[0,4,4,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Cache by Source Type</CardTitle></CardHeader>
                <CardContent className="space-y-3 pt-4">
                  {Object.entries(sourceMap).length === 0 ? <p className="text-center text-muted-foreground py-8">No data.</p> : (
                    Object.entries(sourceMap).map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between">
                        <span className="text-sm capitalize">{type}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round((count / totalChunks) * 100)}%` }} />
                          </div>
                          <span className="text-sm font-medium w-8 text-right">{count}</span>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Cache Entries */}
          <TabsContent value="entries">
            <Card>
              <CardHeader>
                <CardTitle>Cache Entries</CardTitle>
                <CardDescription>All cached knowledge chunks</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {chunks.length === 0 ? (
                  <p className="p-6 text-center text-muted-foreground text-sm">No cache entries yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Class</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-center">Embedding</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chunks.slice(0, 100).map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium text-sm max-w-[150px] truncate">{c.file_name ?? "—"}</TableCell>
                          <TableCell>{c.subject ?? "—"}</TableCell>
                          <TableCell>{c.class_level ?? "—"}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{c.source_type ?? "—"}</Badge></TableCell>
                          <TableCell className="text-center">
                            {c.embedding_id ? <Badge className="bg-green-100 text-green-800">Yes</Badge> : <Badge variant="outline">No</Badge>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)} disabled={deleting === c.id}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
