import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Rocket, Loader2, Lightbulb, Globe2, FlaskConical, BookMarked, Lock, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { TUTOR_LANGUAGES, normaliseTutorLanguage } from "@/lib/tutorLanguages";
import { useGenerateEnrichment, type EnrichmentResponse } from "@/hooks/useEnrichment";

interface BookRow { id: number; subject: string; class_name: string | null }
interface ChapterRow { id: number; chapter_name: string }

export default function Enrichment() {
  const { language: appLanguage } = useLanguage();
  const [books, setBooks] = useState<BookRow[]>([]);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [bookId, setBookId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [langOverride, setLangOverride] = useState<string | null>(null);
  const [result, setResult] = useState<EnrichmentResponse | null>(null);
  const generate = useGenerateEnrichment();

  const language = langOverride ?? normaliseTutorLanguage(appLanguage);

  useEffect(() => {
    supabase.from("books").select("id, subject, class_name").eq("is_active", true).order("subject")
      .then(({ data }) => setBooks((data as BookRow[]) ?? []));
  }, []);

  useEffect(() => {
    setChapters([]);
    setChapterId("");
    setResult(null);
    if (!bookId) return;
    supabase.from("curriculum_chapters")
      .select("id, chapter_name, unit_id, units!inner(book_id)")
      .eq("units.book_id", Number(bookId))
      .then(({ data }) => setChapters((data as unknown as ChapterRow[]) ?? []));
  }, [bookId]);

  const run = () => {
    if (!chapterId) return;
    setResult(null);
    generate.mutate(
      { scope_type: "chapter", scope_id: Number(chapterId), language },
      {
        onSuccess: setResult,
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const pack = result?.eligible ? result.pack : null;
  const locked = result && !result.eligible ? result : null;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <PageHeader
          title="Enrichment"
          subtitle="Go beyond the textbook — challenges and ideas for when you've mastered a chapter"
        />

        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Select value={bookId} onValueChange={setBookId}>
                <SelectTrigger><SelectValue placeholder="Choose a subject" /></SelectTrigger>
                <SelectContent>
                  {books.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.subject}{b.class_name ? ` (${b.class_name})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={chapterId} onValueChange={(v) => { setChapterId(v); setResult(null); }} disabled={!bookId}>
                <SelectTrigger><SelectValue placeholder="Choose a chapter" /></SelectTrigger>
                <SelectContent>
                  {chapters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.chapter_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={language} onValueChange={(v) => { setLangOverride(v); setResult(null); }}>
                <SelectTrigger aria-label="Language"><Globe2 className="h-4 w-4 mr-1 shrink-0" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TUTOR_LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.native}{l.code !== "en" ? ` (${l.name})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={run} disabled={!chapterId || generate.isPending} className="gap-2">
              {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {generate.isPending ? "Preparing your challenge…" : "Show me the next level"}
            </Button>
            {generate.isPending && (
              <p className="text-xs text-muted-foreground">First time for a chapter can take up to a minute while it's written.</p>
            )}
          </CardContent>
        </Card>

        {locked && (
          <Card className="border-amber-300 bg-amber-50/50">
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center gap-2 font-medium"><Lock className="h-4 w-4" /> Not unlocked yet</div>
              <p className="text-sm text-muted-foreground">{locked.message}</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Your mastery in this chapter</span>
                  <span>{locked.avg_mastery === null ? "no practice yet" : `${Math.round(locked.avg_mastery * 100)}%`} / {Math.round(locked.required * 100)}% needed</span>
                </div>
                <Progress value={Math.min(100, ((locked.avg_mastery ?? 0) / locked.required) * 100)} />
              </div>
            </CardContent>
          </Card>
        )}

        {pack && (
          <div className="space-y-4">
            <Card className="bg-gradient-to-br from-indigo-50 to-cyan-50 border-indigo-200">
              <CardContent className="pt-6 space-y-2">
                <Badge variant="secondary">AI-generated — check answers with your teacher if unsure</Badge>
                <h2 className="text-2xl font-bold">{pack.content.title}</h2>
                {pack.content.tagline && <p className="text-muted-foreground">{pack.content.tagline}</p>}
                {pack.content.why_it_matters && <p className="text-sm">{pack.content.why_it_matters}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><BookMarked className="h-5 w-5" /> Deep dive</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                {pack.content.deep_dive.map((d, i) => (
                  <div key={i}>
                    <h3 className="font-semibold">{d.heading}</h3>
                    <p className="text-sm leading-relaxed whitespace-pre-line">{d.explanation}</p>
                    {d.key_takeaway && <p className="text-sm mt-1 font-medium text-indigo-700">💡 {d.key_takeaway}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><FlaskConical className="h-5 w-5" /> Challenge problems</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {pack.content.challenge_problems.map((c, i) => (
                  <div key={i} className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Problem {i + 1}</span>
                      <Badge variant="outline">{c.level === "stretch" ? "Stretch" : "Hard"}</Badge>
                    </div>
                    <p className="text-sm whitespace-pre-line">{c.question}</p>
                    {c.hint && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-muted-foreground inline-flex items-center gap-1"><ChevronDown className="h-3 w-3" /> Need a hint?</summary>
                        <p className="mt-1 whitespace-pre-line">{c.hint}</p>
                      </details>
                    )}
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground inline-flex items-center gap-1"><ChevronDown className="h-3 w-3" /> Show worked solution (try first!)</summary>
                      <p className="mt-1 whitespace-pre-line">{c.worked_solution}</p>
                    </details>
                  </div>
                ))}
              </CardContent>
            </Card>

            {pack.content.think_about_it.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Lightbulb className="h-5 w-5" /> Think about it</CardTitle></CardHeader>
                <CardContent><ul className="list-disc pl-5 space-y-1 text-sm">{pack.content.think_about_it.map((q, i) => <li key={i}>{q}</li>)}</ul></CardContent>
              </Card>
            )}

            {pack.content.real_world_connections.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Globe2 className="h-5 w-5" /> In the real world</CardTitle></CardHeader>
                <CardContent><ul className="list-disc pl-5 space-y-1 text-sm">{pack.content.real_world_connections.map((q, i) => <li key={i}>{q}</li>)}</ul></CardContent>
              </Card>
            )}

            {pack.content.project && (
              <Card>
                <CardHeader><CardTitle className="text-lg">🛠️ Try it: {pack.content.project.title}</CardTitle></CardHeader>
                <CardContent><p className="text-sm whitespace-pre-line">{pack.content.project.description}</p></CardContent>
              </Card>
            )}

            {pack.content.key_terms.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg">Key terms</CardTitle></CardHeader>
                <CardContent>
                  <dl className="space-y-1 text-sm">
                    {pack.content.key_terms.map((k, i) => <div key={i}><dt className="inline font-semibold">{k.term}: </dt><dd className="inline">{k.meaning}</dd></div>)}
                  </dl>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
