import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, Sparkles } from "lucide-react";

type OutputKey = "pptx" | "flashcards" | "mermaid";

const OUTPUT_OPTIONS: { key: OutputKey; label: string }[] = [
  { key: "pptx", label: "PowerPoint (.pptx)" },
  { key: "flashcards", label: "Flash cards" },
  { key: "mermaid", label: "Flow chart (.mmd)" },
];

// Keep keys and colours in sync with supabase/functions/_shared/pptxTemplates.ts.
const TEMPLATES: { key: string; label: string; cover: string; bg: string; accent: string; text: string }[] = [
  { key: "classic", label: "Classic Blue", cover: "#1E3A8A", bg: "#FFFFFF", accent: "#3B82F6", text: "#1F2937" },
  { key: "nature", label: "Nature Green", cover: "#166534", bg: "#F7FBF4", accent: "#4ADE80", text: "#1A2E1A" },
  { key: "sunset", label: "Sunset", cover: "#C2410C", bg: "#FFF7ED", accent: "#F59E0B", text: "#431407" },
  { key: "dark", label: "Dark Modern", cover: "#020617", bg: "#0F172A", accent: "#A78BFA", text: "#E2E8F0" },
  { key: "playful", label: "Kids Playful", cover: "#7C3AED", bg: "#FFFBEB", accent: "#EC4899", text: "#3B0764" },
];

interface GenerateResponse {
  job_id: string;
  title: string;
  slides: { title: string; bullets: string[]; speaker_notes: string }[];
  flashcards: { front: string; back: string }[];
  flowchart_mermaid: string | null;
  outputs: { format: string; url: string | null; error?: string }[];
}

export default function ContentStudio() {
  const [prompt, setPrompt] = useState("");
  const [subject, setSubject] = useState("");
  const [classLevel, setClassLevel] = useState("");
  const [language, setLanguage] = useState("English");
  const [slideCount, setSlideCount] = useState(8);
  const [template, setTemplate] = useState("classic");
  const [selected, setSelected] = useState<Record<OutputKey, boolean>>({ pptx: true, flashcards: true, mermaid: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);

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
      // Served by the generate-entry-ticket anchor (Edge Function limit) - see supabase/functions/CONSOLIDATION.md.
      const { data, error: fnError } = await supabase.functions.invoke("generate-entry-ticket", {
        body: { action: "content_studio", prompt, subject, class_level: classLevel, language, slide_count: slideCount, outputs: chosen, template },
      });
      if (fnError) {
        let detail = "";
        try { detail = (await (fnError as any).context?.json())?.error ?? ""; } catch { /* not JSON */ }
        throw new Error(detail || fnError.message);
      }
      if (data?.error) throw new Error(data.error);
      setResult(data as GenerateResponse);
    } catch (err: any) {
      setError(err.message || "Generation failed.");
    } finally {
      setLoading(false);
    }
  }

  const labelFor = (key: string) => OUTPUT_OPTIONS.find((o) => o.key === key)?.label ?? key;

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold">Content Studio</h1>
          <p className="text-sm text-muted-foreground">
            Describe a lesson. Get a presentation, flash cards, and a flow chart you can download.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create material</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cs-prompt">What should it cover?</Label>
              <Textarea
                id="cs-prompt"
                rows={4}
                maxLength={1000}
                placeholder="e.g. Make a presentation on the parts of a tree and how trees help humans, for Class 4 English."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="cs-subject">Subject</Label>
                <Input id="cs-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="English" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cs-class">Class</Label>
                <Input id="cs-class" value={classLevel} onChange={(e) => setClassLevel(e.target.value)} placeholder="Class 4" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cs-lang">Language</Label>
                <Input id="cs-lang" value={language} onChange={(e) => setLanguage(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cs-slides">Slides</Label>
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
              <Label>Outputs</Label>
              <div className="flex flex-wrap gap-4">
                {OUTPUT_OPTIONS.map((o) => (
                  <label key={o.key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected[o.key]}
                      onCheckedChange={(v) => setSelected((s) => ({ ...s, [o.key]: v === true }))}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>

            {selected.pptx && (
              <div className="space-y-2">
                <Label>Presentation template</Label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTemplate(t.key)}
                      aria-pressed={template === t.key}
                      className={`overflow-hidden rounded-lg border-2 text-left transition ${
                        template === t.key ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-muted-foreground/30"
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

            {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

            <Button onClick={generate} disabled={loading} className="w-full md:w-auto">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {loading ? "Generating..." : "Generate"}
            </Button>
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{result.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <h3 className="font-semibold">Downloads</h3>
                {result.outputs.map((o) => (
                  <div key={o.format} className="flex items-center justify-between rounded-md border p-3">
                    <span className="text-sm">{labelFor(o.format)}</span>
                    {o.url ? (
                      <a href={o.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
                        <Download className="h-4 w-4" /> Download
                      </a>
                    ) : o.format === "flashcards" ? (
                      <Badge variant="secondary">Shown below</Badge>
                    ) : (
                      <Badge variant="destructive" title={o.error}>Failed</Badge>
                    )}
                  </div>
                ))}
              </div>

              {result.slides.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold">Slides</h3>
                  <ol className="list-decimal space-y-3 pl-5">
                    {result.slides.map((s, i) => (
                      <li key={i}>
                        <div className="font-medium">{s.title}</div>
                        <ul className="list-disc pl-5 text-sm text-muted-foreground">
                          {s.bullets.map((b, j) => <li key={j}>{b}</li>)}
                        </ul>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {result.flashcards.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold">Flash cards</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {result.flashcards.map((c, i) => (
                      <details key={i} className="rounded-md border p-3">
                        <summary className="cursor-pointer font-medium">{c.front}</summary>
                        <p className="mt-2 text-sm text-muted-foreground">{c.back}</p>
                      </details>
                    ))}
                  </div>
                </div>
              )}

              {result.flowchart_mermaid && (
                <div className="space-y-2">
                  <h3 className="font-semibold">Flow chart (Mermaid code)</h3>
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{result.flowchart_mermaid}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
