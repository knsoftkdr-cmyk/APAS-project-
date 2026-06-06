/**
 * OCRProcessingDashboard.tsx — OCR Processing Monitor for KNSoft Admin
 * Uses knowledge_chunks (curriculum_files) as the OCR source
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
import { Progress } from "@/components/ui/progress";
import { FileText, CheckCircle, Clock, BarChart3, RefreshCw } from "lucide-react";
import ocrbanner from "@/assets/ocr-banner.png";
interface OCREntry {
  id: string;
  file_name: string;
  subject: string;
  curriculum: string;
  class_level: string;
  source_type: string;
  created_at: string;
  embedding_id: string | null;
  chunk_text: string;
}

export default function OCRProcessingDashboard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<OCREntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<OCREntry | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("knowledge_chunks")
        .select("id, file_name, subject, curriculum, class_level, source_type, created_at, embedding_id, chunk_text")
        .order("created_at", { ascending: false });
      setEntries(data ?? []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Stats
  const total = entries.length;
  const processed = entries.filter(e => e.embedding_id).length;
  const pending = total - processed;
  const accuracy = total > 0 ? Math.round((processed / total) * 100) : 0;

  // By curriculum
  const currMap: Record<string, { total: number; processed: number }> = {};
  for (const e of entries) {
    const c = e.curriculum ?? "Unknown";
    if (!currMap[c]) currMap[c] = { total: 0, processed: 0 };
    currMap[c].total++;
    if (e.embedding_id) currMap[c].processed++;
  }

  // By class level
  const classMap: Record<string, number> = {};
  for (const e of entries) {
    const c = e.class_level ?? "Unknown";
    classMap[c] = (classMap[c] ?? 0) + 1;
  }

  if (loading) return <AppLayout><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div></AppLayout>;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
<div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-500 via-blue-600 to-blue-500 p-8 text-white mb-6">

  {/* Decorations */}
  <div className="hidden md:block absolute top-6 right-40 w-14 h-14 rounded-full border border-white/60"></div>
  <div className="hidden md:block absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/60"></div>
  <div className="hidden md:block absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/60"></div>

  <div className="hidden md:block absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
  <div className="hidden md:block absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
  <div className="hidden md:block absolute top-24 right-[35%] text-white/80 text-lg">✦</div>

  <div className="hidden md:block absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

  <div className="relative z-10 flex items-center gap-4">
          <div className="h-14 w-14 rounded-xl bg-white/20 flex items-center justify-center">
            <FileText className="h-7 w-7" />
          </div>
    <div>
      <h1 className="text-3xl text-black/80 md:text-4xl font-bold">
        OCR Processing
      </h1>

      <p className="text-black/80 mt-1">
        OCR queues, processed PDFs, extraction accuracy
      </p>

    </div>

  </div>
          <img
            src={ocrbanner}
            alt="OCR Processing Banner"
            /* className="absolute right-10 bottom-6 h-[160px]" */
            className="hidden md:block absolute right-5 bottom-7 w-[70px] z-10"
          />
</div>

        {/* <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">OCR Processing Dashboard</h1>
              <p className="text-sm text-muted-foreground">OCR queues, processed PDFs, extraction accuracy</p>
            </div>
          </div> */}
          <Button variant="outline" onClick={fetchAll} className="gap-1.5">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Files", value: total, icon: FileText, color: "text-blue-600" },
            { label: "Processed", value: processed, icon: CheckCircle, color: "text-green-600" },
            { label: "Pending", value: pending, icon: Clock, color: pending > 0 ? "text-yellow-600" : "text-green-600" },
            { label: "Accuracy", value: `${accuracy}%`, icon: BarChart3, color: accuracy > 80 ? "text-green-600" : "text-yellow-600" },
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

        {/* Overall progress */}
        <Card>
          <CardHeader><CardTitle>Overall Processing Progress</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Processed {processed} of {total} files</span>
              <span className="font-semibold">{accuracy}%</span>
            </div>
            <Progress value={accuracy} className="h-3" />
          </CardContent>
        </Card>

        <Tabs defaultValue="queue" className="space-y-4">
          <TabsList>
            <TabsTrigger value="queue">Queue Monitor</TabsTrigger>
            <TabsTrigger value="curriculum">By Curriculum</TabsTrigger>
            <TabsTrigger value="preview">Text Preview</TabsTrigger>
          </TabsList>

          {/* Queue */}
          <TabsContent value="queue">
            <Card>
              <CardHeader><CardTitle>OCR Progress Bars by File</CardTitle></CardHeader>
              <CardContent className="p-0">
                {entries.length === 0 ? (
                  <p className="p-6 text-center text-muted-foreground text-sm">No files in queue.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File Name</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Class</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.slice(0, 50).map((e) => (
                        <TableRow key={e.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedEntry(e)}>
                          <TableCell className="font-medium text-sm max-w-[180px] truncate">{e.file_name ?? "—"}</TableCell>
                          <TableCell className="text-sm">{e.subject ?? "—"}</TableCell>
                          <TableCell className="text-sm">{e.class_level ?? "—"}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{e.source_type ?? "—"}</Badge></TableCell>
                          <TableCell className="text-center">
                            {e.embedding_id
                              ? <Badge className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" />Done</Badge>
                              : <Badge className="bg-yellow-100 text-yellow-800"><Clock className="h-3 w-3 mr-1" />Pending</Badge>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* By Curriculum */}
          <TabsContent value="curriculum">
            <Card>
              <CardHeader><CardTitle>Processing by Curriculum</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(currMap).length === 0 ? <p className="text-center text-muted-foreground py-8">No data.</p> : (
                  Object.entries(currMap).map(([curr, stats]) => (
                    <div key={curr} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{curr}</span>
                        <span className="text-muted-foreground">{stats.processed}/{stats.total} processed</span>
                      </div>
                      <Progress value={stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0} className="h-2" />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Text Preview */}
          <TabsContent value="preview">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="md:col-span-1">
                <CardHeader><CardTitle className="text-sm">Select File</CardTitle></CardHeader>
                <CardContent className="p-0 max-h-96 overflow-y-auto">
                  {entries.slice(0, 30).map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setSelectedEntry(e)}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors border-b border-border ${selectedEntry?.id === e.id ? "bg-muted" : ""}`}
                    >
                      <p className="font-medium truncate">{e.file_name ?? "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">{e.subject} · {e.class_level}</p>
                    </button>
                  ))}
                </CardContent>
              </Card>
              <Card className="md:col-span-2">
                <CardHeader><CardTitle className="text-sm">Extracted Text</CardTitle></CardHeader>
                <CardContent>
                  {selectedEntry ? (
                    <div className="space-y-2">
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant="outline">{selectedEntry.subject}</Badge>
                        <Badge variant="outline">{selectedEntry.class_level}</Badge>
                        <Badge variant="outline">{selectedEntry.curriculum}</Badge>
                        {selectedEntry.embedding_id
                          ? <Badge className="bg-green-100 text-green-800">Embedded</Badge>
                          : <Badge className="bg-yellow-100 text-yellow-800">Not Embedded</Badge>}
                      </div>
                      <div className="bg-muted rounded-lg p-4 max-h-72 overflow-y-auto">
                        <p className="text-sm whitespace-pre-wrap">{selectedEntry.chunk_text ?? "No text available."}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-12">Select a file to preview its extracted text</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
    </AppLayout>
  );
}
