import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mic, Square, Volume2, Turtle, Sparkles, RotateCcw, Loader2, Check, X, Minus, Waves, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TUTOR_LANGUAGES } from "@/lib/tutorLanguages";
import { passagesFor } from "@/lib/pronunciationPassages";
import {
  BAND_LABEL, ENGLISH_ACCENTS, SPEECH_LOCALES, assessPronunciation, fetchPronunciationHistory, generatePassage,
  type AssessResponse, type HistoryResponse, type Level, type WordStatus,
} from "@/lib/pronunciation";
import { useSpeechRecognition, type SpeechOutcome } from "@/hooks/useSpeechRecognition";

const MAX_CHARS = 600;
const LEVELS: { value: Level; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

// Colour is never the only signal: every status also has an icon and a text label.
const STATUS: Record<WordStatus, { label: string; chip: string; Icon: typeof Check }> = {
  correct: { label: "Clear", chip: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-100", Icon: Check },
  close: { label: "Nearly there", chip: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-100", Icon: Waves },
  mispronounced: { label: "Needs practice", chip: "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-100", Icon: X },
  missed: { label: "Not heard", chip: "bg-slate-100 text-slate-700 border-slate-300 line-through dark:bg-slate-800 dark:text-slate-200", Icon: Minus },
};

const bandColour = (s: number) => (s >= 85 ? "text-emerald-600" : s >= 70 ? "text-sky-600" : s >= 50 ? "text-amber-600" : "text-rose-600");

function ScoreTile({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-lg font-semibold">{value === null ? "–" : `${value}%`}</span>
      </div>
      <Progress value={value ?? 0} className="mt-2 h-2" aria-label={`${label} ${value === null ? "not scored" : value + " percent"}`} />
      {hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function PronunciationAssessment() {
  const [language, setLanguage] = useState("en");
  const [accent, setAccent] = useState("en-IN");
  const [level, setLevel] = useState<Level>("beginner");
  const [text, setText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [response, setResponse] = useState<AssessResponse | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState("");

  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLang, setHistoryLang] = useState("all");

  const speech = useSpeechRecognition();
  const textRef = useRef(text);
  textRef.current = text;

  const locale = language === "en" ? accent : SPEECH_LOCALES[language] ?? "en-IN";
  const builtIn = useMemo(() => passagesFor(language, level), [language, level]);
  const langName = TUTOR_LANGUAGES.find((l) => l.code === language)?.name ?? "English";
  const hasText = text.trim().length > 0;

  const resetResult = () => { setResponse(null); setScoreError(null); setLastHeard(""); };

  // ── reading aloud ──────────────────────────────────────────────────────────────────────────────
  const score = useCallback(async (o: SpeechOutcome, lang: string, reference: string) => {
    setScoring(true); setScoreError(null); setLastHeard(o.transcript);
    try {
      const r = await assessPronunciation({
        language: lang, reference_text: reference, transcript: o.transcript,
        duration_seconds: o.durationSeconds, confidence: o.confidence,
      });
      setResponse(r);
      if (r.persistence === "available") setHistory(null); // refetch next time the progress tab opens
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : "Couldn't score your reading.");
    } finally {
      setScoring(false);
    }
  }, []);

  const startReading = () => {
    resetResult();
    const lang = language, reference = textRef.current.trim();
    window.speechSynthesis?.cancel();
    speech.start(locale, (o) => { void score(o, lang, reference); });
  };

  const listen = (slow: boolean) => {
    const synth = window.speechSynthesis;
    if (!synth) { toast.error("This browser can't read text aloud."); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.trim());
    u.lang = locale;
    u.rate = slow ? 0.6 : 0.9;
    const voices = synth.getVoices();
    if (voices.length && !voices.some((v) => v.lang.toLowerCase().replace("_", "-").startsWith(locale.slice(0, 2).toLowerCase()))) {
      toast.info(`Your device has no ${langName} voice installed, so you may not hear a good example.`);
    }
    synth.speak(u);
  };

  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

  // ── choosing text ──────────────────────────────────────────────────────────────────────────────
  const pick = (t: string) => { speech.cancel(); resetResult(); setText(t); };
  const makePassage = async () => {
    setGenerating(true);
    try {
      const p = await generatePassage(language, level);
      pick(p.text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create a passage.");
    } finally {
      setGenerating(false);
    }
  };

  // preload the first built-in passage so the page isn't empty
  useEffect(() => {
    if (!textRef.current.trim() && builtIn.length) setText(builtIn[0].text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── history ────────────────────────────────────────────────────────────────────────────────────
  const loadHistory = useCallback(async (lang: string) => {
    setHistoryLoading(true); setHistoryError(null);
    try { setHistory(await fetchPronunciationHistory(lang === "all" ? undefined : lang)); }
    catch (e) { setHistoryError(e instanceof Error ? e.message : "Couldn't load your progress."); }
    finally { setHistoryLoading(false); }
  }, []);

  const chart = useMemo(() => {
    if (!history) return [];
    return [...history.attempts].reverse().map((a, i) => ({
      n: i + 1, score: a.overall,
      date: new Date(a.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    }));
  }, [history]);

  const result = response?.result ?? null;
  const busy = speech.listening || scoring;
  const weakWords = result ? result.words.filter((w) => w.status !== "correct") : [];

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 p-5 shadow-lg md:p-6">
          <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-white/10" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 md:h-12 md:w-12">
              <Mic className="h-5 w-5 text-white md:h-6 md:w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white md:text-2xl">Pronunciation Practice</h1>
              <p className="mt-0.5 text-xs text-violet-100 md:text-sm">Read a text aloud and see which words came out clearly, plus tips for the rest.</p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="practise" onValueChange={(v) => { if (v === "progress" && !history && !historyLoading) void loadHistory(historyLang); }}>
          <TabsList>
            <TabsTrigger value="practise">Practise</TabsTrigger>
            <TabsTrigger value="progress">My progress</TabsTrigger>
          </TabsList>

          {/* ───────────────────────── PRACTISE ───────────────────────── */}
          <TabsContent value="practise" className="mt-4 space-y-4">
            {!speech.supported && (
              <Card><CardContent className="p-4 text-sm text-amber-700" role="alert">
                This browser can't listen to speech. Please open APAS in Chrome or Edge to practise. You can still read the text and listen to the example.
              </CardContent></Card>
            )}

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">1. Choose what to read</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <div className="min-w-[10rem]">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pron-lang">Language</label>
                    <Select value={language} onValueChange={(v) => { speech.cancel(); resetResult(); setLanguage(v); const p = passagesFor(v, level)[0]; setText(p ? p.text : ""); }} disabled={busy}>
                      <SelectTrigger id="pron-lang"><SelectValue /></SelectTrigger>
                      <SelectContent>{TUTOR_LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.name} · {l.native}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {language === "en" && (
                    <div className="min-w-[10rem]">
                      <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pron-accent">Accent to listen for</label>
                      <Select value={accent} onValueChange={setAccent} disabled={busy}>
                        <SelectTrigger id="pron-accent"><SelectValue /></SelectTrigger>
                        <SelectContent>{ENGLISH_ACCENTS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="min-w-[10rem]">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pron-level">Level</label>
                    <Select value={level} onValueChange={(v) => setLevel(v as Level)} disabled={busy}>
                      <SelectTrigger id="pron-level"><SelectValue /></SelectTrigger>
                      <SelectContent>{LEVELS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {builtIn.map((p, i) => (
                    <Button key={p.id} type="button" size="sm" variant={text === p.text ? "default" : "outline"} disabled={busy} onClick={() => pick(p.text)}>
                      Sentence {i + 1}
                    </Button>
                  ))}
                  <Button type="button" size="sm" variant="secondary" disabled={busy || generating} onClick={makePassage}>
                    {generating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                    New passage (AI)
                  </Button>
                </div>
                {builtIn.length === 0 && <p className="text-xs text-muted-foreground">No ready-made {level} sentences in {langName} yet. Use "New passage (AI)" or type your own text below.</p>}

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pron-text">Text to read (you can type or paste your own)</label>
                  <Textarea id="pron-text" value={text} maxLength={MAX_CHARS} rows={3} disabled={busy}
                    placeholder={`Type or paste ${langName} text here…`}
                    onChange={(e) => { resetResult(); setText(e.target.value); }} />
                  <p className="mt-1 text-right text-[11px] text-muted-foreground">{text.length}/{MAX_CHARS}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">2. Listen, then read it aloud</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {result ? (
                  <div>
                    <div className="flex flex-wrap gap-1.5" role="list" aria-label="Your reading, word by word">
                      {result.words.map((w, i) => {
                        const s = STATUS[w.status];
                        return (
                          <span key={i} role="listitem" title={w.heard ? `Heard: ${w.heard}` : "Not heard"}
                            aria-label={`${w.ref}: ${s.label}${w.heard && w.status !== "correct" ? `, heard as ${w.heard}` : ""}`}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-base ${s.chip}`}>
                            <s.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{w.ref}
                          </span>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
                      {(Object.keys(STATUS) as WordStatus[]).map((k) => { const s = STATUS[k]; return <span key={k} className="inline-flex items-center gap-1"><s.Icon className="h-3 w-3" />{s.label}</span>; })}
                    </div>
                  </div>
                ) : (
                  <p className="min-h-[3rem] whitespace-pre-wrap text-lg leading-relaxed">{hasText ? text : <span className="text-muted-foreground">Choose or type some text above.</span>}</p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={!hasText || busy} onClick={() => listen(false)}><Volume2 className="mr-1.5 h-4 w-4" />Listen</Button>
                  <Button type="button" variant="outline" size="sm" disabled={!hasText || busy} onClick={() => listen(true)}><Turtle className="mr-1.5 h-4 w-4" />Listen slowly</Button>
                  <div className="flex-1" />
                  {speech.listening ? (
                    <Button type="button" size="lg" variant="destructive" onClick={speech.stop}><Square className="mr-2 h-4 w-4" />Stop and score</Button>
                  ) : (
                    <Button type="button" size="lg" disabled={!hasText || !speech.supported || busy} onClick={startReading}>
                      {scoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : result ? <RotateCcw className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                      {scoring ? "Scoring…" : result ? "Try again" : "Start reading"}
                    </Button>
                  )}
                </div>

                <div aria-live="polite" className="min-h-[1.5rem] text-sm">
                  {speech.listening && (
                    <p className="flex items-start gap-2 text-violet-700">
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
                      <span><strong>Listening…</strong> read the text, then press Stop. <span className="text-muted-foreground">{[speech.finalText, speech.interim].filter(Boolean).join(" ")}</span></span>
                    </p>
                  )}
                  {scoring && <p className="text-muted-foreground">Checking your reading…</p>}
                  {speech.error && !speech.listening && <p className="text-destructive" role="alert">{speech.error}</p>}
                  {scoreError && <p className="text-destructive" role="alert">{scoreError}</p>}
                </div>
              </CardContent>
            </Card>

            {result && (
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">3. Your result</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="text-center">
                      <div className={`text-5xl font-bold ${bandColour(result.overall)}`} aria-label={`Overall score ${result.overall} out of 100`}>{result.overall}</div>
                      <div className="text-xs text-muted-foreground">out of 100</div>
                    </div>
                    <div className="min-w-[12rem] flex-1">
                      <Badge variant="secondary" className="mb-1">{BAND_LABEL[result.band]}</Badge>
                      <p className="text-sm">{response?.coaching?.summary ?? `${result.counts.correct} of ${result.counts.total} words were clear.`}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <ScoreTile label="Accuracy" value={result.accuracy} hint="How close each word was" />
                    <ScoreTile label="Completeness" value={result.completeness} hint={`${result.counts.total - result.counts.missed} of ${result.counts.total} words read`} />
                    <ScoreTile label="Pace" value={result.fluency} hint={result.words_per_minute ? `${result.words_per_minute} words/min` : "Needs a longer text"} />
                    <ScoreTile label="Clarity" value={result.clarity} hint="How sure the app was" />
                  </div>

                  {result.extra_words.length > 0 && (
                    <p className="text-sm text-muted-foreground">Extra words heard that aren't in the text: <span className="font-medium text-foreground">{result.extra_words.join(", ")}</span></p>
                  )}

                  {weakWords.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold">Words to practise</h3>
                      <ul className="space-y-2">
                        {weakWords.slice(0, 8).map((w, i) => {
                          const tip = response?.coaching?.tips.find((t) => t.word.toLowerCase() === w.ref.toLowerCase())?.tip;
                          const s = STATUS[w.status];
                          return (
                            <li key={i} className="rounded-xl border p-3 text-sm">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-base font-semibold">{w.ref}</span>
                                <Badge variant="outline" className="gap-1"><s.Icon className="h-3 w-3" aria-hidden="true" />{s.label}</Badge>
                                {w.heard && <span className="text-xs text-muted-foreground">heard as “{w.heard}”</span>}
                              </div>
                              {tip && <p className="mt-1.5 text-muted-foreground">{tip}</p>}
                            </li>
                          );
                        })}
                      </ul>
                      {!response?.coaching && <p className="mt-2 text-xs text-muted-foreground">Written tips aren't available right now, but your score above is saved.</p>}
                    </div>
                  )}

                  {lastHeard && <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">What the app heard</summary><p className="mt-1">{lastHeard}</p></details>}
                  {response?.persistence === "unavailable" && <p className="text-xs text-muted-foreground">Progress tracking isn't set up yet, so this attempt wasn't saved.</p>}
                  <p className="text-xs text-muted-foreground">{response?.disclaimer}</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ───────────────────────── PROGRESS ───────────────────────── */}
          <TabsContent value="progress" className="mt-4 space-y-4">
            <div className="max-w-[14rem]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pron-hist-lang">Show</label>
              <Select value={historyLang} onValueChange={(v) => { setHistoryLang(v); void loadHistory(v); }}>
                <SelectTrigger id="pron-hist-lang"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All languages</SelectItem>
                  {TUTOR_LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {historyLoading && <Card><CardContent className="space-y-3 p-6"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-40 w-full" /></CardContent></Card>}
            {historyError && <Card><CardContent className="p-6 text-sm text-destructive" role="alert">{historyError}</CardContent></Card>}
            {history && history.persistence === "unavailable" && (
              <Card><CardContent className="p-6 text-sm text-muted-foreground">Progress tracking isn't set up yet. Ask your school admin to finish the pronunciation setup.</CardContent></Card>
            )}
            {history && history.persistence === "available" && history.summary.attempts === 0 && !historyLoading && (
              <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No attempts yet. Do a reading on the Practise tab and your progress will appear here.</CardContent></Card>
            )}

            {history && history.summary.attempts > 0 && !historyLoading && (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Attempts</div><div className="text-2xl font-semibold">{history.summary.attempts}</div></CardContent></Card>
                  <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Average score</div><div className="text-2xl font-semibold">{history.summary.average}</div></CardContent></Card>
                  <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Best score</div><div className="text-2xl font-semibold">{history.summary.best}</div></CardContent></Card>
                  <Card><CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">Trend</div>
                    <div className="flex items-center gap-1.5 text-lg font-semibold">
                      {history.summary.direction === "improving" && <><TrendingUp className="h-5 w-5 text-emerald-600" aria-hidden="true" />Improving</>}
                      {history.summary.direction === "declining" && <><TrendingDown className="h-5 w-5 text-rose-600" aria-hidden="true" />Dipping</>}
                      {history.summary.direction === "steady" && <><ArrowRight className="h-5 w-5 text-sky-600" aria-hidden="true" />Steady</>}
                      {history.summary.direction === null && <span className="text-sm font-normal text-muted-foreground">Needs 6+ attempts</span>}
                    </div>
                  </CardContent></Card>
                </div>

                {chart.length > 1 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Your scores over time</CardTitle></CardHeader>
                    <CardContent className="h-56" role="img" aria-label={`Line chart of your last ${chart.length} pronunciation scores`}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" fontSize={11} />
                          <YAxis domain={[0, 100]} fontSize={11} />
                          <Tooltip />
                          <Line type="monotone" dataKey="score" name="Score" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

                {history.summary.tricky_words.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Words that keep tripping you up</CardTitle></CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      {history.summary.tricky_words.map((w) => (
                        <Badge key={w.word} variant="outline" className="text-sm">{w.word} <span className="ml-1.5 text-xs text-muted-foreground">{w.times_missed}×</span></Badge>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Recent attempts</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="divide-y">
                      {history.attempts.slice(0, 10).map((a) => (
                        <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                          <span className={`w-10 shrink-0 text-lg font-semibold ${bandColour(a.overall)}`}>{a.overall}</span>
                          <span className="min-w-0 flex-1 truncate">{a.reference_text}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
