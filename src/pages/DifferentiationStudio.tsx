// src/pages/DifferentiationStudio.tsx  (staff, route /differentiation)
//
// AI-assisted differentiation (sheet row 46): describe one lesson material and get it written for different needs
// at once - Support / Core / Challenge plus Language support, Visual and SEN-friendly versions. With a class picked,
// the class's live learning groups (remedial / regular / enrichment) tell the AI how many students each version is
// for; with a chapter picked, the chapter's learning objectives ground the content. Every pack is saved, and any
// version can be shared to the Digital Classroom (students get it without answers or teacher notes).
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Copy, Eye, EyeOff, History, Layers3, Loader2, Printer, Share2, Sparkles, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useClassSubjectPicker } from "@/hooks/useClassSubjectPicker";
import { TUTOR_LANGUAGES } from "@/lib/tutorLanguages";
import {
  DIFF_VERSIONS, MATERIAL_TYPES, deleteDiffPack, loadDiffPack, shareDiffVersion, useDiffPacks, useGenerateDiff,
  type DiffPack, type DiffVersion,
} from "@/hooks/useDifferentiation";

// deno-lint-ignore no-explicit-any
const db = supabase as any;
const NONE = "none";

function versionText(pack: DiffPack, v: DiffVersion, withAnswers: boolean) {
  return [
    `${pack.title} - ${v.label}`, pack.learning_objective ? `Learning objective: ${pack.learning_objective}` : "",
    v.student_instructions ? `Instructions: ${v.student_instructions}` : "", v.content,
    v.questions.length ? "Questions:\n" + v.questions.map((q, i) => `${i + 1}. ${q.q}${withAnswers ? `\n   Answer: ${q.answer}` : ""}`).join("\n") : "",
  ].filter(Boolean).join("\n\n");
}

export default function DifferentiationStudio() {
  const { classes, classId, setClassId, selectedClass, subjects, bookId, setBookId, selectedSubject, loadingClasses } = useClassSubjectPicker();
  const generate = useGenerateDiff();
  const { data: history } = useDiffPacks();

  const [chapters, setChapters] = useState<{ id: number; chapter_name: string }[]>([]);
  const [chapterId, setChapterId] = useState(NONE);
  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState("");
  const [materialType, setMaterialType] = useState("worksheet");
  const [versions, setVersions] = useState<string[]>(["support", "core", "challenge"]);
  const [language, setLanguage] = useState("Telugu");
  const [pack, setPack] = useState<DiffPack | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [shareClass, setShareClass] = useState("");
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    setChapters([]); setChapterId(NONE);
    if (!bookId) return;
    (async () => {
      const { data: units } = await db.from("units").select("id").eq("book_id", Number(bookId));
      const ids = (units ?? []).map((u: { id: number }) => u.id);
      if (!ids.length) return;
      const { data } = await db.from("curriculum_chapters").select("id, chapter_name").in("unit_id", ids).eq("is_active", true).order("id");
      setChapters(data ?? []);
    })();
  }, [bookId]);
  useEffect(() => { if (classId) setShareClass(classId); }, [classId]);

  // Picking a chapter fills the topic when it's still empty.
  useEffect(() => {
    const ch = chapters.find((c) => String(c.id) === chapterId);
    if (ch && !topic.trim()) setTopic(ch.chapter_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  const toggleVersion = (k: string, on: boolean) => setVersions((v) => (on ? [...new Set([...v, k])] : v.filter((x) => x !== k)));
  const ordered = useMemo(() => DIFF_VERSIONS.map((v) => v.key).filter((k) => versions.includes(k)), [versions]);

  async function onGenerate() {
    try {
      const res = await generate.mutateAsync({
        topic: topic.trim(), material_type: materialType, versions: ordered, objective: objective.trim() || undefined,
        subject: selectedSubject?.subject, grade: selectedClass?.name, language: versions.includes("language") ? language : undefined,
        class_id: classId || undefined, book_id: bookId || undefined, chapter_id: chapterId !== NONE ? chapterId : undefined,
      });
      setPack(res);
      toast.success(`${res.versions.length} versions ready`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    }
  }

  async function onShare(v: DiffVersion) {
    if (!pack || !shareClass) return;
    setSharing(true);
    try {
      await shareDiffVersion(pack.id, v.key, shareClass);
      toast.success(`"${v.label}" shared to ${classes.find((c) => c.id === shareClass)?.label ?? "the class"} - Materials tab`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Share failed"); }
    finally { setSharing(false); }
  }

  function onPrint(v: DiffVersion) {
    if (!pack) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    w.document.write(`<pre style="font-family:system-ui;white-space:pre-wrap;font-size:14px;line-height:1.5;padding:24px">${esc(versionText(pack, v, showAnswers))}</pre>`);
    w.document.close(); w.print();
  }

  const canGenerate = topic.trim().length >= 3 && ordered.length >= 2 && !generate.isPending;

  return (
    <AppLayout>
      <div className="p-3 sm:p-4 md:p-6 space-y-4 max-w-7xl mx-auto pb-24 md:pb-6">
        <div className="rounded-2xl p-5 bg-gradient-to-r from-fuchsia-600 to-purple-600 shadow-lg text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><Layers3 className="h-5 w-5" /></div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold">Differentiation Studio</h1>
              <p className="text-fuchsia-50 text-xs md:text-sm">One lesson, every learner: AI writes the same material for different levels and needs.</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">What do you need?</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Select value={classId} onValueChange={setClassId} disabled={loadingClasses}>
                    <SelectTrigger aria-label="Class"><SelectValue placeholder="Class (optional)" /></SelectTrigger>
                    <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={bookId} onValueChange={setBookId} disabled={!classId || !subjects.length}>
                    <SelectTrigger aria-label="Subject"><SelectValue placeholder="Subject (optional)" /></SelectTrigger>
                    <SelectContent>{subjects.map((s) => <SelectItem key={s.bookId} value={String(s.bookId)}>{s.subject}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={chapterId} onValueChange={setChapterId} disabled={!chapters.length}>
                    <SelectTrigger className="col-span-2" aria-label="Chapter"><SelectValue placeholder="Chapter (optional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No chapter</SelectItem>
                      {chapters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.chapter_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Topic *</Label><Input value={topic} maxLength={300} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Adding fractions with unlike denominators" /></div>
                <div className="space-y-1"><Label className="text-xs">Learning objective (optional)</Label><Input value={objective} maxLength={400} onChange={(e) => setObjective(e.target.value)} placeholder="Students will be able to…" /></div>
                <div className="space-y-1"><Label className="text-xs">Material</Label>
                  <Select value={materialType} onValueChange={setMaterialType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{MATERIAL_TYPES.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Versions (pick at least two)</Label>
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {DIFF_VERSIONS.map((v) => (
                      <label key={v.key} className="flex items-start gap-2 rounded-md border p-2 text-sm cursor-pointer">
                        <Checkbox checked={versions.includes(v.key)} onCheckedChange={(c) => toggleVersion(v.key, c === true)} className="mt-0.5" />
                        <span><span className="font-medium">{v.label}</span><span className="block text-[11px] text-muted-foreground">{v.help}</span></span>
                      </label>
                    ))}
                  </div>
                </div>
                {versions.includes("language") && (
                  <div className="space-y-1"><Label className="text-xs">Home language for language support</Label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{TUTOR_LANGUAGES.filter((l) => l.code !== "en").map((l) => <SelectItem key={l.code} value={l.name}>{l.native} ({l.name})</SelectItem>)}</SelectContent>
                    </Select></div>
                )}
                <Button className="w-full gap-1.5" onClick={onGenerate} disabled={!canGenerate}>
                  {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {generate.isPending ? "Writing versions… (up to a minute)" : "Generate differentiated material"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><History className="h-4 w-4" />Saved packs</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 max-h-72 overflow-y-auto">
                {!history?.length ? <p className="text-sm text-muted-foreground">Nothing saved yet.</p> : history.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                    <button type="button" className="flex-1 text-left min-w-0" onClick={async () => {
                      try { setPack(await loadDiffPack(h.id)); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not open"); }
                    }}>
                      <p className="truncate">{h.topic}</p>
                      <p className="text-[11px] text-muted-foreground">{[h.grade, h.subject, h.versions.map((v) => v.label).join(" · ")].filter(Boolean).join(" · ")}</p>
                    </button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Delete pack" onClick={async () => {
                      if (!window.confirm("Delete this saved pack?")) return;
                      try { await deleteDiffPack(h.id); if (pack?.id === h.id) setPack(null); toast.success("Deleted"); } catch (e) { toast.error(e instanceof Error ? e.message : "Delete failed"); }
                    }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="min-h-[24rem]">
            {!pack ? (
              <CardContent className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground p-10 gap-2">
                <Layers3 className="h-10 w-10 text-fuchsia-300" />
                Pick a topic and the versions you need. Each version teaches the same objective at a different level.
              </CardContent>
            ) : (
              <>
                <CardHeader className="pb-2 space-y-1">
                  <CardTitle className="text-base">{pack.title}</CardTitle>
                  {pack.learning_objective && <p className="text-sm text-muted-foreground"><b>Objective:</b> {pack.learning_objective}</p>}
                  {pack.group_counts && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3.5 w-3.5" />
                      Class groups: {pack.group_counts.remedial ?? 0} need support · {pack.group_counts.regular ?? 0} at level · {pack.group_counts.enrichment ?? 0} ready for challenge</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setShowAnswers((s) => !s)}>
                      {showAnswers ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{showAnswers ? "Hide answers" : "Show answers"}
                    </Button>
                    <Select value={shareClass} onValueChange={setShareClass}>
                      <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Share to class…" /></SelectTrigger>
                      <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue={pack.versions[0]?.key} key={pack.id}>
                    <TabsList className="w-full justify-start overflow-x-auto">
                      {pack.versions.map((v) => <TabsTrigger key={v.key} value={v.key}>{v.label}</TabsTrigger>)}
                    </TabsList>
                    {pack.versions.map((v) => (
                      <TabsContent key={v.key} value={v.key} className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {v.for_whom && <Badge variant="secondary" className="font-normal">For: {v.for_whom}</Badge>}
                          <div className="ml-auto flex gap-1.5">
                            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => { navigator.clipboard.writeText(versionText(pack, v, showAnswers)); toast.success("Copied"); }}><Copy className="h-3.5 w-3.5" />Copy</Button>
                            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => onPrint(v)}><Printer className="h-3.5 w-3.5" />Print</Button>
                            <Button size="sm" className="h-8 gap-1" disabled={!shareClass || sharing} onClick={() => onShare(v)}><Share2 className="h-3.5 w-3.5" />Share</Button>
                          </div>
                        </div>
                        {v.student_instructions && <p className="text-sm"><b>Instructions:</b> {v.student_instructions}</p>}
                        <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-3"><ReactMarkdown>{v.content}</ReactMarkdown></div>
                        {v.questions.length > 0 && (
                          <ol className="list-decimal pl-5 space-y-1.5 text-sm">
                            {v.questions.map((q, i) => (
                              <li key={i}>{q.q}{showAnswers && q.answer && <p className="text-xs text-emerald-800 bg-emerald-50 rounded px-2 py-1 mt-1">{q.answer}</p>}</li>
                            ))}
                          </ol>
                        )}
                        {v.teacher_notes && <p className="text-xs rounded-md bg-muted/50 p-2"><b>Teacher notes:</b> {v.teacher_notes}</p>}
                        <p className="text-[11px] text-muted-foreground">AI-generated - check before using in class. Shared versions go without answers or teacher notes.</p>
                      </TabsContent>
                    ))}
                  </Tabs>
                </CardContent>
              </>
            )}
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
