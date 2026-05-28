import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, Upload, Search, Database, Loader2, FileText, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, string>;
  similarity: number;
}

const AIKnowledgeHub = () => {
  // Embed state
  const [embedFile, setEmbedFile] = useState("");
  const [embedContent, setEmbedContent] = useState("");
  const [embedSubject, setEmbedSubject] = useState("");
  const [embedClass, setEmbedClass] = useState("");
  const [embedCurriculum, setEmbedCurriculum] = useState("");
  const [embedding, setEmbedding] = useState(false);
  const [embedResult, setEmbedResult] = useState<any>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSubject, setSearchSubject] = useState("");
  const [searchClass, setSearchClass] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // Stats
  const [stats, setStats] = useState<{ chunks: number; embeddings: number } | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      const [{ count: chunks }, { count: embeddings }] = await Promise.all([
        supabase.from("knowledge_chunks").select("*", { count: "exact", head: true }),
        supabase.from("ai_embeddings").select("*", { count: "exact", head: true }),
      ]);
      setStats({ chunks: chunks || 0, embeddings: embeddings || 0 });
    } catch {
      toast.error("Failed to fetch stats");
    }
    setLoadingStats(false);
  };

  const handleEmbed = async () => {
    if (!embedFile || !embedContent) {
      toast.error("File name and content are required");
      return;
    }
    setEmbedding(true);
    setEmbedResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("embed-knowledge", {
        body: {
          file_name: embedFile,
          content: embedContent,
          subject: embedSubject || undefined,
          class_level: embedClass || undefined,
          curriculum: embedCurriculum || undefined,
        },
      });
      if (error) throw error;
      setEmbedResult(data);
      toast.success(`Embedded ${data.results?.[0]?.processed || 0} chunks successfully`);
      setEmbedContent("");
      fetchStats();
    } catch (e: any) {
      toast.error(e.message || "Embedding failed");
    }
    setEmbedding(false);
  };

  const handleSearch = async () => {
    if (!searchQuery) {
      toast.error("Enter a search query");
      return;
    }
    setSearching(true);
    setSearchResults([]);
    try {
      const filters: Record<string, string> = {};
      if (searchSubject) filters.subject = searchSubject;
      if (searchClass) filters.class_level = searchClass;

      const { data, error } = await supabase.functions.invoke("search-context", {
        body: {
          query: searchQuery,
          match_count: 8,
          match_threshold: 0.65,
          filters: Object.keys(filters).length > 0 ? filters : undefined,
        },
      });
      if (error) throw error;
      setSearchResults(data.results || []);
      if ((data.results || []).length === 0) toast.info("No matching results found");
    } catch (e: any) {
      toast.error(e.message || "Search failed");
    }
    setSearching(false);
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
        <PageHeader
          title="AI Knowledge Hub"
          subtitle="RAG-powered knowledge base — embed textbooks and search with AI"
        />

        {/* Stats Bar */}
        <div className="flex gap-4 items-center">
          <Button variant="outline" size="sm" onClick={fetchStats} disabled={loadingStats}>
            {loadingStats ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Database className="h-4 w-4 mr-1" />}
            Refresh Stats
          </Button>
          {stats && (
            <div className="flex gap-3">
              <Badge variant="secondary">{stats.embeddings} Embeddings</Badge>
              <Badge variant="secondary">{stats.chunks} Chunks</Badge>
            </div>
          )}
        </div>

        <Tabs defaultValue="search" className="space-y-4">
          <TabsList>
            <TabsTrigger value="search"><Search className="h-4 w-4 mr-1" /> Search Knowledge</TabsTrigger>
            <TabsTrigger value="embed"><Upload className="h-4 w-4 mr-1" /> Embed Content</TabsTrigger>
          </TabsList>

          {/* Search Tab */}
          <TabsContent value="search" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Semantic Search
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  placeholder="Ask a question or describe what you're looking for..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  rows={2}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Select value={searchSubject} onValueChange={setSearchSubject}>
                    <SelectTrigger><SelectValue placeholder="Filter by subject" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Subjects</SelectItem>
                      <SelectItem value="Mathematics">Mathematics</SelectItem>
                      <SelectItem value="Science">Science</SelectItem>
                      <SelectItem value="English">English</SelectItem>
                      <SelectItem value="Social Studies">Social Studies</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={searchClass} onValueChange={setSearchClass}>
                    <SelectTrigger><SelectValue placeholder="Filter by class" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Classes</SelectItem>
                      {Array.from({ length: 12 }, (_, i) => (
                        <SelectItem key={i + 1} value={`Class ${i + 1}`}>Class {i + 1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleSearch} disabled={searching} className="w-full">
                  {searching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                  Search Knowledge Base
                </Button>
              </CardContent>
            </Card>

            {searchResults.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground">
                  {searchResults.length} results found
                </h3>
                {searchResults.map((result, i) => (
                  <Card key={result.id} className="border-l-4 border-l-primary/50">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex gap-2 flex-wrap">
                          {result.metadata?.subject && (
                            <Badge variant="outline" className="text-xs">{result.metadata.subject}</Badge>
                          )}
                          {result.metadata?.class_level && (
                            <Badge variant="outline" className="text-xs">{result.metadata.class_level}</Badge>
                          )}
                          {result.metadata?.file_name && (
                            <Badge variant="secondary" className="text-xs">
                              <FileText className="h-3 w-3 mr-1" />{result.metadata.file_name}
                            </Badge>
                          )}
                        </div>
                        <Badge className="text-xs shrink-0">
                          {(result.similarity * 100).toFixed(1)}% match
                        </Badge>
                      </div>
                      <p className="text-sm text-foreground/80 whitespace-pre-wrap line-clamp-6">
                        {result.content}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Embed Tab */}
          <TabsContent value="embed" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Upload className="h-5 w-5 text-primary" />
                  Embed New Content
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="File / Source name (e.g., NCERT_Math_Class10.pdf)"
                  value={embedFile}
                  onChange={(e) => setEmbedFile(e.target.value)}
                />
                <div className="grid grid-cols-3 gap-3">
                  <Select value={embedSubject} onValueChange={setEmbedSubject}>
                    <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Mathematics">Mathematics</SelectItem>
                      <SelectItem value="Science">Science</SelectItem>
                      <SelectItem value="English">English</SelectItem>
                      <SelectItem value="Social Studies">Social Studies</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={embedClass} onValueChange={setEmbedClass}>
                    <SelectTrigger><SelectValue placeholder="Class Level" /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => (
                        <SelectItem key={i + 1} value={`Class ${i + 1}`}>Class {i + 1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={embedCurriculum} onValueChange={setEmbedCurriculum}>
                    <SelectTrigger><SelectValue placeholder="Curriculum" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CBSE">CBSE</SelectItem>
                      <SelectItem value="ICSE">ICSE</SelectItem>
                      <SelectItem value="IB">IB</SelectItem>
                      <SelectItem value="Cambridge">Cambridge</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Textarea
                  placeholder="Paste the textbook content here..."
                  value={embedContent}
                  onChange={(e) => setEmbedContent(e.target.value)}
                  rows={10}
                />
                <Button onClick={handleEmbed} disabled={embedding} className="w-full">
                  {embedding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                  {embedding ? "Embedding... (this may take a while)" : "Embed Content"}
                </Button>

                {embedResult && (
                  <div className="rounded-lg bg-accent p-4 text-sm">
                    <p className="font-semibold text-primary">✅ Embedding Complete</p>
                    {embedResult.results?.map((r: any, i: number) => (
                      <p key={i} className="mt-1 text-muted-foreground">
                        {r.file_name}: {r.processed}/{r.total_chunks} chunks processed
                      </p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default AIKnowledgeHub;
