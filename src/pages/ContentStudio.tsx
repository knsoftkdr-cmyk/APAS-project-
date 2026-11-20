import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildLessonVideo, videoSupported } from "@/lib/lessonVideo";
import { cleanExplainerScene } from "@/lib/explainerScene";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BookOpen, Check, Clapperboard, ChevronDown, ChevronUp, Clock, Download, Film, FileText, GraduationCap, Headphones, Languages, Layers,
  LayoutGrid, Loader2, Palette, Presentation, Search, Sparkles, Trash2, Workflow, X, type LucideIcon,
} from "lucide-react";

type OutputKey = "pptx" | "flashcards" | "mermaid" | "audio" | "video";

// Tailwind class names must stay literal strings so they are not purged.
const OUTPUT_OPTIONS: { key: OutputKey; label: string; desc: string; icon: LucideIcon; tint: string }[] = [
  { key: "pptx", label: "PowerPoint (.pptx)", desc: "Designed slides with speaker notes", icon: Presentation, tint: "bg-orange-50 text-orange-600" },
  { key: "flashcards", label: "Flash cards", desc: "Picture flip cards and a printable sheet", icon: Layers, tint: "bg-pink-50 text-pink-600" },
  { key: "mermaid", label: "Flow chart", desc: "Illustrated poster for the classroom", icon: Workflow, tint: "bg-emerald-50 text-emerald-600" },
  { key: "audio", label: "Audio narration (.mp3)", desc: "Spoken explanation of every slide", icon: Headphones, tint: "bg-violet-50 text-violet-600" },
  { key: "video", label: "Video lesson (.mp4)", desc: "Narrated slides with subtitles", icon: Film, tint: "bg-sky-50 text-sky-600" },
];
const styleFor = (key: string) => OUTPUT_OPTIONS.find((o) => o.key === key) ?? OUTPUT_OPTIONS[0];

// Keep keys and colours in sync with supabase/functions/_shared/pptxTemplates.ts.
const TEMPLATES: { key: string; label: string; cover: string; bg: string; accent: string; text: string }[] = [
  { key: "classic", label: "Classic Blue", cover: "#1E3A8A", bg: "#FFFFFF", accent: "#3B82F6", text: "#1F2937" },
  { key: "nature", label: "Nature Green", cover: "#166534", bg: "#F7FBF4", accent: "#4ADE80", text: "#1A2E1A" },
  { key: "sunset", label: "Sunset", cover: "#C2410C", bg: "#FFF7ED", accent: "#F59E0B", text: "#431407" },
  { key: "dark", label: "Dark Modern", cover: "#020617", bg: "#0F172A", accent: "#A78BFA", text: "#E2E8F0" },
  { key: "playful", label: "Kids Playful", cover: "#7C3AED", bg: "#FFFBEB", accent: "#EC4899", text: "#3B0764" },
];

const VIDEO_STYLES: { key: "explainer" | "slides"; label: string; desc: string; icon: LucideIcon }[] = [
  { key: "explainer", label: "Animated explainer", desc: "Pictures that move as the teacher explains (recommended)", icon: Clapperboard },
  { key: "slides", label: "Narrated slides", desc: "Slide text with bullets appearing one by one", icon: Presentation },
];

interface GenerateResponse {
  job_id: string;
  title: string;
  /** scene: animated explainer plan (src/lib/explainerScene.ts), filled by op "video_scenes". */
  slides: { title: string; bullets: string[]; speaker_notes: string; narration?: string; scene?: unknown }[];
  /** emoji is missing on generations made before picture cards. */
  flashcards: { front: string; back: string; emoji?: string }[];
  /** Printable cut-and-fold sheet (see supabase/functions/_shared/kidsFlashcards.ts). */
  flashcards_svg?: string | null;
  flowchart_mermaid: string | null;
  /** Kids poster flow chart drawn by the server (see supabase/functions/_shared/kidsFlowchart.ts). */
  flowchart_svg?: string | null;
  /** pending: the video is built in the browser after generation (see src/lib/lessonVideo.ts). */
  outputs: { format: string; url: string | null; error?: string; pending?: boolean }[];
  render?: { template: string; rtl: boolean; video_style?: "explainer" | "slides" };
  subtitle?: string;
  /** Per-scene narration for the browser-made video: [title, slide 1, ...]. */
  video_assets?: { scene_audio_urls: string[] } | null;
}

interface HistoryItem extends GenerateResponse {
  created_at: string;
  status: string;
  error: string | null;
  prompt: string;
  subject: string | null;
  class_level: string | null;
  language: string;
}

/** Content Studio calls go to the generate-entry-ticket anchor (Edge Function limit) - see supabase/functions/CONSOLIDATION.md. */
async function callStudio<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("generate-entry-ticket", { body: { action: "content_studio", ...body } });
  if (error) {
    let detail = "";
    try { detail = (await (error as any).context?.json())?.error ?? ""; } catch { /* not JSON */ }
    throw new Error(detail || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

const labelFor = (key: string) => OUTPUT_OPTIONS.find((o) => o.key === key)?.label ?? key;

// History filters. "all" = no filter (Radix Select does not allow an empty value).
const DATE_RANGES = [
  { key: "all", label: "Any time", days: 0 },
  { key: "today", label: "Today", days: 1 },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
] as const;
const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Distinct values ignoring case ("class 4" and "Class 4" are one option), sorted naturally. */
function distinctOptions(values: (string | null | undefined)[]): [string, string][] {
  const map = new Map<string, string>();
  for (const v of values) if (v?.trim() && !map.has(norm(v))) map.set(norm(v), v.trim());
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
}

function FilterSelect({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void; placeholder: string; options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10 w-full bg-white sm:w-[160px]"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export default function ContentStudio() {
  const [tab, setTab] = useState("create");
  const [prompt, setPrompt] = useState("");
  const [subject, setSubject] = useState("");
  const [classLevel, setClassLevel] = useState("");
  const [language, setLanguage] = useState("English");
  const [slideCount, setSlideCount] = useState(8);
  const [template, setTemplate] = useState("classic");
  const [videoStyle, setVideoStyle] = useState<"explainer" | "slides">("explainer");
  const [selected, setSelected] = useState<Record<OutputKey, boolean>>({ pptx: true, flashcards: true, mermaid: false, audio: false, video: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [outputFilter, setOutputFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const queryClient = useQueryClient();

  const historyQuery = useQuery({
    queryKey: ["content-studio-history"],
    queryFn: async () => (await callStudio<{ jobs: HistoryItem[] }>({ op: "history" })).jobs,
    enabled: tab === "history",
    // Download links expire after an hour; refetch when the tab is opened again later.
    staleTime: 5 * 60 * 1000,
  });

  const jobs = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);
  const subjectOptions = useMemo(() => distinctOptions(jobs.map((j) => j.subject)), [jobs]);
  const classOptions = useMemo(() => distinctOptions(jobs.map((j) => j.class_level)), [jobs]);
  const filtersOn = !!search.trim() || [subjectFilter, classFilter, outputFilter, dateFilter].some((f) => f !== "all");
  const filteredJobs = useMemo(() => {
    const words = norm(search).split(/\s+/).filter(Boolean);
    const range = DATE_RANGES.find((r) => r.key === dateFilter);
    let since = 0;
    if (range?.days) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (range.days - 1));
      since = d.getTime();
    }
    return jobs.filter((j) => {
      if (subjectFilter !== "all" && norm(j.subject) !== subjectFilter) return false;
      if (classFilter !== "all" && norm(j.class_level) !== classFilter) return false;
      if (outputFilter !== "all" && !j.outputs.some((o) => o.format === outputFilter)) return false;
      if (since && new Date(j.created_at).getTime() < since) return false;
      if (words.length) {
        const hay = norm([j.title, j.prompt, j.subject, j.class_level, j.language].join(" "));
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }, [jobs, search, subjectFilter, classFilter, outputFilter, dateFilter]);
  const clearFilters = () => {
    setSearch("");
    setSubjectFilter("all");
    setClassFilter("all");
    setOutputFilter("all");
    setDateFilter("all");
  };

  async function deleteJob(jobId: string) {
    if (!window.confirm("Delete this generation and its files?")) return;
    setDeleting(jobId);
    try {
      await callStudio({ op: "delete", job_id: jobId });
      await queryClient.invalidateQueries({ queryKey: ["content-studio-history"] });
    } catch (err: any) {
      window.alert(err.message || "Delete failed.");
    } finally {
      setDeleting(null);
    }
  }

  const chosen = OUTPUT_OPTIONS.map((o) => o.key).filter((k) => selected[k]);

  async function generate() {
    setError("");
    setResult(null);
    if (prompt.trim().length < 5) {
      setError("Please describe what you want to create (at least a few words).");
      return;
    }
    if (chosen.length === 0) {
      setError("Select at least one output.");
      return;
    }
    setLoading(true);
    try {
      const data = await callStudio<GenerateResponse>({
        prompt, subject, class_level: classLevel, language, slide_count: slideCount, outputs: chosen, template, video_style: videoStyle,
      });
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["content-studio-history"] });
    } catch (err: any) {
      setError(err.message || "Generation failed.");
    } finally {
      setLoading(false);
    }
  }


  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        {/* Header - same style as the Lesson Plan Generator */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-sky-600 to-sky-700 p-5 shadow-xl md:p-8">
          <div className="absolute -end-6 -top-6 h-32 w-32 rounded-full bg-white/10" />
          <div className="absolute end-16 top-10 h-16 w-16 rounded-full bg-white/10" />
          <div className="relative z-10 flex items-center gap-3">
            <div className="rounded-xl bg-white/20 p-2.5 backdrop-blur-sm">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">Content Studio</h1>
              <p className="mt-0.5 text-white/80">
                Generate presentations, flash cards, flow charts and audio narration from a single lesson description.
              </p>
            </div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-auto rounded-full bg-muted p-1">
            <TabsTrigger value="create" className="rounded-full px-5 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
              <Sparkles className="mr-1.5 h-4 w-4" /> Create
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-full px-5 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
              <Clock className="mr-1.5 h-4 w-4" /> My generations
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="mt-4 space-y-6">
            <Card className="shadow-sm">
              <CardHeader className="border-b">
                <CardTitle className="text-lg">Create material</CardTitle>
                <p className="text-sm text-muted-foreground">Describe the lesson, choose the outputs and generate.</p>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="space-y-2">
                  <FieldLabel htmlFor="cs-prompt" icon={FileText}>Lesson description</FieldLabel>
                  <Textarea
                    id="cs-prompt"
                    rows={4}
                    maxLength={1000}
                    placeholder="e.g. Make a presentation on the parts of a tree and how trees help humans, for Class 4 English."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <p className="text-end text-xs text-muted-foreground">{prompt.length}/1000</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                  <div className="space-y-2">
                    <FieldLabel htmlFor="cs-subject" icon={BookOpen}>Subject</FieldLabel>
                    <Input id="cs-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="English" />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel htmlFor="cs-class" icon={GraduationCap}>Class</FieldLabel>
                    <Input id="cs-class" value={classLevel} onChange={(e) => setClassLevel(e.target.value)} placeholder="Class 4" />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel htmlFor="cs-lang" icon={Languages}>Language</FieldLabel>
                    <Input id="cs-lang" value={language} onChange={(e) => setLanguage(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel htmlFor="cs-slides" icon={LayoutGrid}>Number of slides</FieldLabel>
                    <Input
                      id="cs-slides"
                      type="number"
                      min={3}
                      max={12}
                      value={slideCount}
                      onChange={(e) => setSlideCount(Number(e.target.value) || 8)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Outputs</Label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {OUTPUT_OPTIONS.map((o) => {
                      const on = selected[o.key];
                      const Icon = o.icon;
                      return (
                        <button
                          key={o.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setSelected((s) => ({ ...s, [o.key]: !s[o.key] }))}
                          className={`flex items-center gap-3 rounded-xl border p-3 text-start transition ${
                            on ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-500" : "border-border bg-background hover:border-blue-300 hover:bg-muted/40"
                          }`}
                        >
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${o.tint}`}>
                            <Icon className="h-5 w-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">{o.label}</span>
                            <span className="block text-xs text-muted-foreground">{o.desc}</span>
                          </span>
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                              on ? "border-blue-600 bg-blue-600 text-white" : "border-muted-foreground/40"
                            }`}
                            aria-hidden
                          >
                            {on && <Check className="h-3.5 w-3.5" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selected.video && (
                  <div className="space-y-2">
                    <FieldLabel icon={Film}>Video style</FieldLabel>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {VIDEO_STYLES.map((v) => {
                        const on = videoStyle === v.key;
                        return (
                          <button
                            key={v.key}
                            type="button"
                            onClick={() => setVideoStyle(v.key)}
                            aria-pressed={on}
                            className={`flex items-center gap-3 rounded-lg border p-3 text-left transition ${
                              on ? "border-blue-600 bg-blue-50/60 ring-2 ring-blue-600/20" : "hover:border-muted-foreground/30"
                            }`}
                          >
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${on ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                              <v.icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold">{v.label}</span>
                              <span className="block text-xs text-muted-foreground">{v.desc}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(selected.pptx || selected.mermaid || selected.flashcards || selected.video) && (
                  <div className="space-y-2">
                    <FieldLabel icon={Palette}>{selected.pptx ? "Presentation template" : "Colour theme"}</FieldLabel>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                      {TEMPLATES.map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setTemplate(t.key)}
                          aria-pressed={template === t.key}
                          className={`overflow-hidden rounded-lg border-2 text-left transition ${
                            template === t.key ? "border-blue-600 ring-2 ring-blue-600/20" : "border-transparent hover:border-muted-foreground/30"
                          }`}
                        >
                          {/* Mini preview: cover strip + content slide */}
                          <div className="flex h-16">
                            <div className="relative w-2/5" style={{ background: t.cover }}>
                              <span className="absolute -right-2 -top-2 h-6 w-6 rounded-full opacity-60" style={{ background: t.accent }} />
                            </div>
                            <div className="flex-1 space-y-1 p-2" style={{ background: t.bg }}>
                              <div className="h-1.5 w-3/4 rounded" style={{ background: t.text }} />
                              <div className="h-1 w-1/3 rounded" style={{ background: t.accent }} />
                              <div className="h-1 w-full rounded opacity-40" style={{ background: t.text }} />
                              <div className="h-1 w-5/6 rounded opacity-40" style={{ background: t.text }} />
                            </div>
                          </div>
                          <div className="bg-background px-2 py-1 text-xs font-medium">{t.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selected.audio && (
                  <p className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                    <Headphones className="mt-0.5 h-4 w-4 shrink-0" />
                    Audio adds a spoken explanation of every slide in the chosen language. Generation takes about 1-2 minutes.
                  </p>
                )}

                {selected.video && (
                  <p className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                    <Film className="mt-0.5 h-4 w-4 shrink-0" />
                    {videoSupported()
                      ? videoStyle === "explainer"
                        ? "After generation the AI plans the animations and this browser creates the video (about 1-2 minutes). Keep this page open until it finishes."
                        : "The video is narrated and created in this browser after generation (usually under a minute). Keep this page open until it finishes."
                      : "This browser cannot create videos. Please use the latest Chrome or Edge."}
                  </p>
                )}

                {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

                <div className="flex flex-wrap items-center gap-3 border-t pt-5">
                  <Button onClick={generate} disabled={loading} className="w-full bg-blue-600 px-6 text-white hover:bg-blue-700 md:w-auto">
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    {loading ? "Generating..." : "Generate"}
                  </Button>
                  {loading && <span className="text-sm text-muted-foreground">This can take up to 1-2 minutes. Please keep this page open.</span>}
                </div>
              </CardContent>
            </Card>

            {result && <ResultView key={result.job_id} result={result} autoStartVideo />}
          </TabsContent>

          <TabsContent value="history" className="mt-4 space-y-3">
            {historyQuery.isLoading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>
            )}
            {historyQuery.error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{(historyQuery.error as Error).message}</p>}
            {historyQuery.data?.length === 0 && (
              <div className="rounded-xl border border-dashed p-10 text-center">
                <Clock className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 font-medium">Nothing generated yet</p>
                <p className="text-sm text-muted-foreground">Your presentations, flash cards, flow charts and audio will appear here.</p>
              </div>
            )}
            {jobs.length > 0 && (
              <div className="rounded-xl border bg-slate-50/70 p-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by topic, e.g. plants, fractions..."
                      className="h-10 bg-white pl-9"
                      aria-label="Search generations"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    <FilterSelect value={subjectFilter} onChange={setSubjectFilter} placeholder="All subjects" options={subjectOptions} />
                    <FilterSelect value={classFilter} onChange={setClassFilter} placeholder="All classes" options={classOptions} />
                    <FilterSelect value={outputFilter} onChange={setOutputFilter} placeholder="All outputs"
                      options={OUTPUT_OPTIONS.map((o): [string, string] => [o.key, o.label])} />
                    <FilterSelect value={dateFilter} onChange={setDateFilter} placeholder="Any time"
                      options={DATE_RANGES.filter((r) => r.key !== "all").map((r): [string, string] => [r.key, r.label])} />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Showing {filteredJobs.length} of {jobs.length}</span>
                  {filtersOn && (
                    <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline">
                      <X className="h-3 w-3" /> Clear filters
                    </button>
                  )}
                </div>
              </div>
            )}
            {jobs.length > 0 && filteredJobs.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <Search className="mx-auto h-7 w-7 text-muted-foreground" />
                <p className="mt-2 font-medium">No generations match</p>
                <p className="text-sm text-muted-foreground">Try another word or clear the filters.</p>
              </div>
            )}
            {filteredJobs.map((job) => (
              <Card key={job.job_id} className="shadow-sm">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{job.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(job.created_at).toLocaleString()}
                        {[job.subject, job.class_level, job.language].filter(Boolean).map((v) => ` · ${v}`).join("")}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {job.outputs.map((o) => {
                          const Icon = styleFor(o.format).icon;
                          const failed = !!o.error && o.format !== "flashcards";
                          return (
                            <Badge key={o.format} variant={failed ? "destructive" : "secondary"} className="gap-1 font-medium">
                              <Icon className="h-3 w-3" /> {labelFor(o.format)}
                            </Badge>
                          );
                        })}
                        {job.status === "failed" && <Badge variant="destructive" title={job.error ?? ""}>Failed</Badge>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {job.status !== "failed" && (
                        <Button size="sm" variant="outline" onClick={() => setOpenId(openId === job.job_id ? null : job.job_id)}>
                          {openId === job.job_id ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
                          {openId === job.job_id ? "Close" : "Open"}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={deleting === job.job_id} onClick={() => deleteJob(job.job_id)} aria-label="Delete">
                        {deleting === job.job_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-600" />}
                      </Button>
                    </div>
                  </div>
                  {openId === job.job_id && <ResultView result={job} />}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function FieldLabel({ htmlFor, icon: Icon, children }: { htmlFor?: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="flex items-center gap-1.5 text-sm font-semibold">
      <Icon className="h-4 w-4 text-muted-foreground" /> {children}
    </Label>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-base font-semibold">
      <Icon className="h-4 w-4 text-blue-600" /> {children}
    </h3>
  );
}

function ResultView({ result, autoStartVideo = false }: { result: GenerateResponse; autoStartVideo?: boolean }) {
  const audioUrl = result.outputs.find((o) => o.format === "audio" && o.url)?.url;
  const videoOutput = result.outputs.find((o) => o.format === "video");
  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b">
        <CardTitle className="text-lg">{result.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8 pt-6">
        <div className="space-y-3">
          <SectionTitle icon={Download}>Downloads</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {result.outputs.map((o) => {
              const st = styleFor(o.format);
              const Icon = st.icon;
              return (
                <div key={o.format} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <span className="flex items-center gap-2.5 text-sm font-medium">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-md ${st.tint}`}><Icon className="h-4 w-4" /></span>
                    {labelFor(o.format)}
                  </span>
                  {o.url ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={o.url} target="_blank" rel="noreferrer"><Download className="mr-1 h-4 w-4" /> Download</a>
                    </Button>
                  ) : o.format === "flashcards" || o.pending ? (
                    <Badge variant="secondary">Shown below</Badge>
                  ) : (
                    <Badge variant="destructive" title={o.error}>Failed</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {videoOutput && (videoOutput.url || result.video_assets) && (
          <VideoPanel result={result} existingUrl={videoOutput.url} autoStart={autoStartVideo} />
        )}

        {audioUrl && (
          <div className="space-y-3">
            <SectionTitle icon={Headphones}>Audio narration</SectionTitle>
            <audio controls preload="none" className="w-full" src={audioUrl} />
          </div>
        )}

        {result.slides.length > 0 && (
          <div className="space-y-3">
            <SectionTitle icon={Presentation}>Slides</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              {result.slides.map((s, i) => (
                <div key={i} className="rounded-lg border bg-muted/30 p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{i + 1}</span>
                    <span className="font-medium">{s.title}</span>
                  </div>
                  <ul className="mt-2 list-disc space-y-1 ps-6 text-sm text-muted-foreground">
                    {s.bullets.map((b, j) => <li key={j}>{b}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {result.flashcards.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle icon={Layers}>Flash cards <span className="text-xs font-normal text-muted-foreground">(tap a card to flip)</span></SectionTitle>
              {result.flashcards_svg && (
                <Button size="sm" variant="outline" onClick={() => downloadSvgAsPng(result.flashcards_svg!, `${result.title || "flashcards"} - flash cards.png`)}>
                  <Download className="mr-1 h-4 w-4" /> Download printable cards (PNG)
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {result.flashcards.map((c, i) => <PictureCard key={i} card={c} index={i} />)}
            </div>
          </div>
        )}

        {result.flowchart_svg && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle icon={Workflow}>Flow chart</SectionTitle>
              <Button size="sm" variant="outline" onClick={() => downloadSvgAsPng(result.flowchart_svg!, `${result.title || "flowchart"}.png`)}>
                <Download className="mr-1 h-4 w-4" /> Download PNG (for printing)
              </Button>
            </div>
            {/* Rendered as an <img>, so nothing inside the SVG can run in the page. */}
            <img
              src={svgDataUrl(result.flowchart_svg)}
              alt={`Flow chart: ${result.title}`}
              className="mx-auto w-full max-w-xl rounded-lg border"
            />
          </div>
        )}

        {!result.flowchart_svg && result.flowchart_mermaid && (
          <div className="space-y-2">
            <SectionTitle icon={Workflow}>Flow chart (Mermaid code)</SectionTitle>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{result.flowchart_mermaid}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Draw the poster onto a canvas at 2x size and save it as a PNG (prints sharply on A4). */
function downloadSvgAsPng(svg: string, fileName: string) {
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName.replace(/[\/:*?"<>|]+/g, "-");
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  };
  img.src = svgDataUrl(svg);
}

// Same pastel colours as the printable sheet (PALETTE in supabase/functions/_shared/kidsFlowchart.ts).
const CARD_COLORS: [string, string][] = [
  ["#C9B6F2", "#7C5CC4"], ["#F6B3D3", "#C2417F"], ["#FDBF8A", "#D9731F"], ["#FDE68A", "#C99A06"],
  ["#B9E6A1", "#4D9A2A"], ["#9FE3D8", "#1F9584"], ["#A9D8F5", "#2B87C4"], ["#C7CDF8", "#5560C9"], ["#F8B4B4", "#C83E3E"],
];

/** Kid-style flip card: picture + word on the front, answer on the back (reuses the .apas-flip CSS). */
function PictureCard({ card, index }: { card: { front: string; back: string; emoji?: string }; index: number }) {
  const [flipped, setFlipped] = useState(false);
  const [fill, stroke] = CARD_COLORS[index % CARD_COLORS.length];
  const face = "apas-flip__face flex min-h-[15rem] flex-col rounded-2xl border-4 p-2 shadow-md";
  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      aria-label={flipped ? `Answer: ${card.back}. Tap to see the card again.` : `${card.front}. Tap to see the answer.`}
      className={`apas-flip w-full text-center focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 rounded-2xl ${flipped ? "is-flipped" : ""}`}
    >
      <div className="apas-flip__inner">
        <div className={`${face} apas-flip__face--front`} style={{ background: fill, borderColor: stroke }} aria-hidden={flipped}>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-white p-3">
            {card.emoji && <span className="text-6xl leading-none" aria-hidden>{card.emoji}</span>}
            <span className="text-base font-extrabold leading-snug text-slate-800 sm:text-lg">{card.front}</span>
          </div>
          <span className="pt-1 text-[11px] font-semibold" style={{ color: stroke }}>Tap to flip</span>
        </div>
        <div className={`${face} apas-flip__face--back`} style={{ background: stroke, borderColor: stroke }} aria-hidden={!flipped}>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-white/95 p-3">
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: stroke }}>Answer</span>
            <span className="text-sm font-bold leading-snug text-slate-800 sm:text-base">{card.back}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

/**
 * Lesson video: built in this browser from the slides + per-scene narration (src/lib/lessonVideo.ts),
 * then uploaded through a one-time signed upload slot so it shows up in My generations.
 */
function VideoPanel({ result, existingUrl, autoStart }: { result: GenerateResponse; existingUrl: string | null; autoStart: boolean }) {
  const queryClient = useQueryClient();
  const supported = videoSupported();
  const [savedUrl, setSavedUrl] = useState<string | null>(existingUrl);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "building" | "saving" | "done" | "error">(existingUrl ? "done" : "idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const started = useRef(false);

  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);

  async function build() {
    if (!result.video_assets) return;
    setPhase("building");
    setError("");
    setNotice("");
    setProgress(0);
    let builtUrl: string | null = null;
    try {
      // Animated explainer: the AI plans a picture scene per slide (once; stored with the job).
      let slides = result.slides.map((s) => ({ ...s, scene: cleanExplainerScene(s.scene) }));
      if (result.render?.video_style === "explainer" && slides.some((s) => !s.scene)) {
        setStage("Planning the animations");
        try {
          const { scenes } = await callStudio<{ scenes: unknown[] }>({ op: "video_scenes", job_id: result.job_id });
          slides = slides.map((s, i) => ({ ...s, scene: s.scene ?? cleanExplainerScene(scenes[i]) }));
        } catch (e: any) {
          setNotice(`Animations could not be planned (${e?.message ?? "error"}), so this video uses slides. Click "Create again" to try the animations.`);
        }
      }
      const theme = TEMPLATES.find((t) => t.key === result.render?.template) ?? TEMPLATES[0];
      const blob = await buildLessonVideo({
        title: result.title,
        subtitle: result.subtitle ?? "",
        slides,
        sceneAudioUrls: result.video_assets.scene_audio_urls,
        theme,
        rtl: !!result.render?.rtl,
        onProgress: (f, s) => { setProgress(f); setStage(s); },
      });
      builtUrl = URL.createObjectURL(blob);
      setLocalUrl(builtUrl);

      setPhase("saving");
      const slot = await callStudio<{ bucket: string; path: string; token: string }>({ op: "video_upload", job_id: result.job_id });
      const { error: upErr } = await supabase.storage.from(slot.bucket).uploadToSignedUrl(slot.path, slot.token, blob, { contentType: "video/mp4" });
      if (upErr) throw new Error(upErr.message);
      const done = await callStudio<{ url: string | null }>({ op: "video_done", job_id: result.job_id });
      setSavedUrl(done.url);
      setPhase("done");
      queryClient.invalidateQueries({ queryKey: ["content-studio-history"] });
    } catch (err: any) {
      const message = err?.message || "Video creation failed.";
      setError(builtUrl ? `The video was created but could not be saved to My generations (${message}). Download it now to keep it.` : message);
      setPhase("error");
    }
  }

  useEffect(() => {
    if (autoStart && supported && !existingUrl && result.video_assets && !started.current) {
      started.current = true;
      void build();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playUrl = localUrl ?? savedUrl;
  const fileName = `${(result.title || "lesson").replace(/[\/:*?"<>|]+/g, "-")}.mp4`;

  return (
    <div className="space-y-3">
      <SectionTitle icon={Film}>Video lesson</SectionTitle>

      {!supported && !playUrl && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This browser cannot create videos. Open this page in the latest Chrome or Edge to create it.
        </p>
      )}

      {(phase === "building" || phase === "saving") && (
        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              {phase === "saving" ? "Saving video" : stage || "Creating video"}
            </span>
            <span className="tabular-nums text-muted-foreground">{Math.round((phase === "saving" ? 1 : progress) * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.round((phase === "saving" ? 1 : progress) * 100)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">Please keep this page open until the video is ready.</p>
        </div>
      )}

      {phase === "error" && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && phase !== "building" && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}

      {playUrl && (phase === "done" || phase === "error") && (
        <video controls preload="metadata" className="w-full rounded-lg border bg-black" src={playUrl} />
      )}

      <div className="flex flex-wrap gap-2">
        {playUrl && (phase === "done" || phase === "error") && (
          <Button asChild size="sm" variant="outline">
            <a href={playUrl} download={fileName} target="_blank" rel="noreferrer"><Download className="mr-1 h-4 w-4" /> Download video</a>
          </Button>
        )}
        {supported && result.video_assets && (phase === "idle" || phase === "error" || (phase === "done" && notice)) && (
          <Button size="sm" onClick={() => void build()} className="bg-blue-600 text-white hover:bg-blue-700">
            <Film className="mr-1 h-4 w-4" /> {phase === "error" ? "Try again" : phase === "done" ? "Create again" : "Create video"}
          </Button>
        )}
      </div>
    </div>
  );
}
