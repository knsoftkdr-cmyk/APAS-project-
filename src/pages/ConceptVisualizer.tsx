import { useState } from "react";
import { toast } from "sonner";
import { Lightbulb, Loader2, Sparkles } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useLanguage } from "@/i18n/LanguageContext";
import { normaliseTutorLanguage } from "@/lib/tutorLanguages";
import {
  cleanConceptInput,
  requestConceptVisual,
  MAX_CONCEPT_LENGTH,
  type ConceptVisual,
} from "@/lib/conceptVisual";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConceptDiagram } from "@/components/ConceptDiagram";

const EXAMPLES = ["Photosynthesis", "Water cycle", "Fractions"];

export default function ConceptVisualizer() {
  const { language } = useLanguage();
  const [concept, setConcept] = useState("");
  const [grade, setGrade] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visual, setVisual] = useState<ConceptVisual | null>(null);

  const generate = async (topic: string) => {
    const cleaned = cleanConceptInput(topic);
    if (!cleaned) {
      toast.error(`Please type a short topic (2 to ${MAX_CONCEPT_LENGTH} characters)`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await requestConceptVisual({
        concept: cleaned,
        grade: grade.trim(),
        language: normaliseTutorLanguage(language),
      });
      setVisual(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't build the visual. Please try again.";
      setError(message);
      setVisual(null);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!loading) void generate(concept);
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Sparkles className="h-6 w-6 text-primary" /> Concept Visualizer
          </h1>
          <p className="mt-1 text-muted-foreground">
            Type a topic and see it explained step by step as a simple diagram.
          </p>
        </div>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  placeholder="Type a topic, for example: Water cycle"
                  maxLength={MAX_CONCEPT_LENGTH}
                  aria-label="Topic"
                  className="flex-1"
                />
                <Input
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  placeholder="Class (optional)"
                  maxLength={20}
                  aria-label="Class (optional)"
                  className="sm:w-40"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={loading || concept.trim().length === 0}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Show visual
                </Button>
                <span className="text-sm text-muted-foreground">Try:</span>
                {EXAMPLES.map((example) => (
                  <Button
                    key={example}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => {
                      setConcept(example);
                      void generate(example);
                    }}
                  >
                    {example}
                  </Button>
                ))}
              </div>
            </form>
          </CardContent>
        </Card>

        {error && (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void generate(concept)} disabled={loading}>
                Try again
              </Button>
            </CardContent>
          </Card>
        )}

        {visual && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{visual.title}</CardTitle>
                <CardDescription>{visual.summary}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-6"><ConceptDiagram steps={visual.steps} title={visual.title} /></div>
                <ol className="space-y-2">
                  {visual.steps.map((step, index) => (
                    <li key={`${index}-${step.label}`}>
                      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                          {index + 1}
                        </span>
                        <div>
                          <p className="font-medium text-foreground">{step.label}</p>
                          <p className="text-sm text-muted-foreground">{step.detail}</p>
                        </div>
                      </div>
                      {index < visual.steps.length - 1 && (
                        <div className="py-1 text-center text-muted-foreground" aria-hidden="true">↓</div>
                      )}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            {visual.parts.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Key parts</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {visual.parts.map((part, index) => (
                    <div key={`${index}-${part.name}`} className="rounded-lg border p-3">
                      <p className="font-medium text-foreground">{part.name}</p>
                      <p className="text-sm text-muted-foreground">{part.role}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {(visual.analogy || visual.check_question) && (
              <Card>
                <CardContent className="space-y-3 pt-6">
                  {visual.analogy && (
                    <p className="flex items-start gap-2 text-sm text-foreground">
                      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>
                        <span className="font-medium">Think of it like this: </span>
                        {visual.analogy}
                      </span>
                    </p>
                  )}
                  {visual.check_question && (
                    <p className="text-sm text-foreground">
                      <span className="font-medium">Ask yourself: </span>
                      {visual.check_question}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            <p className="text-xs text-muted-foreground">
              Made by AI. It can make mistakes, so check important facts with your teacher or textbook.
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
