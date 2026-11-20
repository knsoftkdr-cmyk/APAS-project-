import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDown, ArrowUp, ExternalLink, FileText, FileUp, Link2, Loader2, Lock, Trash2, Video, X, StickyNote, Image as ImageIcon, Presentation } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { CourseChapter, CourseTopic, MaterialType, TopicMaterial, TopicPrerequisite, ContentStatus } from "@/types/courseManagement";
import {
  MATERIAL_TYPE_LABEL, STATUS_LABEL, detectMaterialType, eligiblePrerequisites, friendlyCourseError, materialStoragePath, moveItem,
  safeExternalUrl, statusOf, validateMaterialFile, videoEmbedUrl,
} from "@/lib/courseStructure";
import {
  removeMaterialFile, signedMaterialUrl, uploadMaterialFile, useAttachableWork, useLinkMutations, useStructureMutations, useTopicExtras,
} from "@/hooks/useCourseStructure";

const MATERIAL_ICON: Record<MaterialType, typeof FileText> = {
  pdf: FileText, ppt: Presentation, document: FileText, video: Video, image: ImageIcon, notes: StickyNote, link: Link2,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: CourseTopic | null;
  courseId: string;
  chapters: CourseChapter[];          // chapters of the topic's module (for moving between chapters)
  allTopics: CourseTopic[];           // every topic in the subject (prerequisite candidates)
  prerequisites: TopicPrerequisite[]; // every prerequisite edge in the subject
  canEdit: boolean;
}

export function TopicEditorSheet({ open, onOpenChange, topic, courseId, chapters, allTopics, prerequisites, canEdit }: Props) {
  const { profile } = useAuth();
  const m = useStructureMutations(courseId);
  const extras = useTopicExtras(open ? topic?.id ?? null : null);
  const links = useLinkMutations(topic?.id ?? null);
  const work = useAttachableWork(open && canEdit);

  // ---- details form ----
  const [form, setForm] = useState({ title: "", topic_type: "learn", description: "", learning_objectives: "", estimated_minutes: "", content_body: "", chapter_id: "__none__", status: "draft" as ContentStatus });
  useEffect(() => {
    if (!topic || !open) return;
    setForm({
      title: topic.title, topic_type: topic.topic_type, description: topic.description ?? "", learning_objectives: topic.learning_objectives ?? "",
      estimated_minutes: topic.estimated_minutes ? String(topic.estimated_minutes) : "", content_body: topic.content_body ?? "",
      chapter_id: topic.chapter_id ?? "__none__", status: statusOf(topic),
    });
  }, [topic?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveDetails = async () => {
    if (!topic || !form.title.trim()) { toast.error("Give the topic a title."); return; }
    const minutes = form.estimated_minutes.trim() ? Math.max(1, Math.min(600, parseInt(form.estimated_minutes, 10) || 0)) : null;
    try {
      await m.update.mutateAsync({ kind: "topic", id: topic.id, values: {
        title: form.title.trim(), topic_type: form.topic_type, description: form.description.trim() || null,
        learning_objectives: form.learning_objectives.trim() || null, estimated_minutes: minutes, content_body: form.content_body.trim() || null,
        chapter_id: form.chapter_id === "__none__" ? null : form.chapter_id, status: form.status, updated_at: new Date().toISOString(),
      } });
      toast.success("Topic saved");
    } catch (e) { toast.error((e as Error).message); }
  };

  // ---- materials ----
  const [matMode, setMatMode] = useState<"upload" | "link" | "notes">("upload");
  const [matTitle, setMatTitle] = useState("");
  const [matUrl, setMatUrl] = useState("");
  const [matNotes, setMatNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const materials = extras.data?.materials ?? [];

  const addMaterial = async (values: Partial<TopicMaterial>) => {
    await m.create.mutateAsync({ kind: "material", values: { topic_id: topic!.id, order_index: materials.length, status: "draft", ...values } });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length || !topic || !profile?.school_id) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const problem = validateMaterialFile(file);
        if (problem) { toast.error(`${file.name}: ${problem}`); continue; }
        const path = materialStoragePath(profile.school_id, courseId, topic.id, file.name);
        await uploadMaterialFile(path, file);
        try {
          await addMaterial({
            title: (files.length === 1 && matTitle.trim()) || file.name.replace(/\.[^.]+$/, ""), material_type: detectMaterialType(file.name, file.type),
            storage_path: path, file_name: file.name, file_size: file.size, mime_type: file.type || null, created_by: profile.id,
          });
        } catch (e) { await removeMaterialFile(path); throw e; } // don't leave an orphan file behind
        toast.success(`Uploaded ${file.name}`);
      }
      setMatTitle("");
    } catch (e) { toast.error(friendlyCourseError((e as Error).message)); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const addLink = async () => {
    const url = safeExternalUrl(matUrl);
    if (!url) { toast.error("Enter a valid http(s) link."); return; }
    try {
      await addMaterial({ title: matTitle.trim() || url, material_type: videoEmbedUrl(url) ? "video" : "link", file_url: url });
      setMatTitle(""); setMatUrl(""); toast.success("Link added");
    } catch (e) { toast.error((e as Error).message); }
  };

  const addNotes = async () => {
    if (!matNotes.trim()) { toast.error("Write some notes first."); return; }
    try {
      await addMaterial({ title: matTitle.trim() || "Notes", material_type: "notes", content_body: matNotes.trim() });
      setMatTitle(""); setMatNotes(""); toast.success("Notes added");
    } catch (e) { toast.error((e as Error).message); }
  };

  const deleteMaterial = async (mat: TopicMaterial) => {
    if (!confirm(`Remove "${mat.title}"?`)) return;
    try {
      await m.remove.mutateAsync({ kind: "material", ids: [mat.id] });
      if (mat.storage_path) await removeMaterialFile(mat.storage_path);
    } catch (e) { toast.error((e as Error).message); }
  };

  const openMaterial = async (mat: TopicMaterial) => {
    try {
      const url = mat.storage_path ? await signedMaterialUrl(mat.storage_path) : safeExternalUrl(mat.file_url);
      if (!url) throw new Error("This material has no valid link.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) { toast.error((e as Error).message); }
  };

  const moveMaterial = (i: number, to: number) => {
    const ids = moveItem(materials.map((x) => x.id), i, to).slice();
    m.reorder.mutate({ kind: "material", ids }, { onError: (e) => toast.error(e.message) });
  };

  // ---- prerequisites ----
  const topicById = useMemo(() => new Map(allTopics.map((t) => [t.id, t])), [allTopics]);
  const myPrereqs = prerequisites.filter((p) => p.topic_id === topic?.id);
  const candidates = topic ? eligiblePrerequisites(allTopics, prerequisites, topic.id) : [];
  const [pick, setPick] = useState("");

  // ---- linked work ----
  const [workPick, setWorkPick] = useState("");
  const options = work.data ?? [];
  const linked = extras.data?.links ?? [];
  const attach = async () => {
    const o = options.find((x) => `${x.link_type}:${x.ref_id}` === workPick);
    if (!o) return;
    try { await links.add.mutateAsync({ link_type: o.link_type, ref_id: o.ref_id, title: o.title, due_date: o.due_date }); setWorkPick(""); toast.success("Attached"); }
    catch (e) { toast.error((e as Error).message); }
  };

  if (!topic) return null;
  const publishedMaterials = materials.filter((x) => x.status === "published");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="text-start">
          <SheetTitle className="flex items-center gap-2 flex-wrap">
            {topic.title}
            <Badge variant={form.status === "published" ? "default" : "secondary"}>{STATUS_LABEL[form.status]}</Badge>
          </SheetTitle>
          <SheetDescription>{canEdit ? "Edit this topic's content, learning materials, prerequisites and linked work." : "You can view this topic but not edit it."}</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="details" className="mt-4">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="materials">Materials</TabsTrigger>
            <TabsTrigger value="prereq">Prereqs</TabsTrigger>
            <TabsTrigger value="work">Work</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>

          {/* ---------------- details ---------------- */}
          <TabsContent value="details" className="space-y-4 mt-4">
            <fieldset disabled={!canEdit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="t-title">Title</Label>
                <Input id="t-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={160} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={form.topic_type} onValueChange={(v) => setForm({ ...form, topic_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="learn">Learn</SelectItem><SelectItem value="practice">Practice</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="t-min">Estimated minutes</Label>
                  <Input id="t-min" inputMode="numeric" value={form.estimated_minutes} onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value.replace(/\D/g, "") })} placeholder="e.g. 20" />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as ContentStatus })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{(["draft", "published", "archived"] as const).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Chapter</Label>
                <Select value={form.chapter_id} onValueChange={(v) => setForm({ ...form, chapter_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No chapter (directly under the module)</SelectItem>
                    {chapters.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-desc">Description</Label>
                <Textarea id="t-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="A short summary students see in the topic list." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-obj">Learning objectives</Label>
                <Textarea id="t-obj" rows={3} value={form.learning_objectives} onChange={(e) => setForm({ ...form, learning_objectives: e.target.value })} placeholder={"One per line, e.g.\nDefine a variable\nWrite a simple expression"} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-body">Lesson content</Label>
                <Textarea id="t-body" rows={8} value={form.content_body} onChange={(e) => setForm({ ...form, content_body: e.target.value })} placeholder="The main lesson text. The AI Tutor also uses this to answer questions about the topic." />
              </div>
            </fieldset>
            {canEdit && (
              <div className="flex justify-end gap-2">
                {form.status !== "published" && (
                  <Button variant="outline" onClick={() => setForm({ ...form, status: "published" })}>Mark as published</Button>
                )}
                <Button onClick={saveDetails} disabled={m.update.isPending}>
                  {m.update.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}Save topic
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ---------------- materials ---------------- */}
          <TabsContent value="materials" className="space-y-4 mt-4">
            {extras.isLoading ? <Skeleton className="h-24 w-full" /> : materials.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No learning materials yet. Upload PDFs, slides, documents, images or videos, add a link, or write notes.
              </div>
            ) : (
              <ul className="space-y-2">
                {materials.map((mat, i) => {
                  const Icon = MATERIAL_ICON[mat.material_type] ?? FileText;
                  return (
                    <li key={mat.id} className="flex items-center gap-2 rounded-lg border p-2.5">
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{mat.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{MATERIAL_TYPE_LABEL[mat.material_type]}{mat.file_name ? ` · ${mat.file_name}` : ""}</p>
                      </div>
                      <Badge variant={mat.status === "published" ? "default" : "secondary"} className="shrink-0">{STATUS_LABEL[mat.status]}</Badge>
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Open ${mat.title}`} onClick={() => openMaterial(mat)}><ExternalLink className="h-4 w-4" /></Button>
                      {canEdit && (
                        <>
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Move up" disabled={i === 0} onClick={() => moveMaterial(i, i - 1)}><ArrowUp className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Move down" disabled={i === materials.length - 1} onClick={() => moveMaterial(i, i + 1)}><ArrowDown className="h-4 w-4" /></Button>
                          <Button size="sm" variant="outline" className="h-8" onClick={() => m.update.mutate({ kind: "material", id: mat.id, values: { status: mat.status === "published" ? "draft" : "published", updated_at: new Date().toISOString() } }, { onError: (e) => toast.error(e.message) })}>
                            {mat.status === "published" ? "Unpublish" : "Publish"}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`Delete ${mat.title}`} onClick={() => deleteMaterial(mat)}><Trash2 className="h-4 w-4" /></Button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {canEdit && (
              <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
                <div className="flex gap-1.5">
                  {([["upload", "Upload file", FileUp], ["link", "Link / video", Link2], ["notes", "Notes", StickyNote]] as const).map(([k, label, Icon]) => (
                    <Button key={k} size="sm" variant={matMode === k ? "default" : "outline"} onClick={() => setMatMode(k)}><Icon className="h-4 w-4 me-1.5" />{label}</Button>
                  ))}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="m-title">Title <span className="text-muted-foreground font-normal">(optional for uploads)</span></Label>
                  <Input id="m-title" value={matTitle} onChange={(e) => setMatTitle(e.target.value)} maxLength={160} />
                </div>
                {matMode === "upload" && (
                  <div className="space-y-2">
                    <input ref={fileRef} type="file" multiple className="hidden" accept=".pdf,.ppt,.pptx,.pps,.ppsx,.odp,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.odt,image/*,video/mp4,video/webm,video/quicktime" onChange={(e) => onFiles(e.target.files)} />
                    <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <FileUp className="h-4 w-4 me-2" />}
                      {uploading ? "Uploading…" : "Choose files"}
                    </Button>
                    <p className="text-xs text-muted-foreground">PDF, PPT, documents, images and videos up to 250 MB. New materials are drafts until you publish them.</p>
                  </div>
                )}
                {matMode === "link" && (
                  <div className="space-y-2">
                    <Input value={matUrl} onChange={(e) => setMatUrl(e.target.value)} placeholder="https://… (YouTube and Vimeo play inside the lesson)" aria-label="Link URL" />
                    <Button onClick={addLink} disabled={m.create.isPending}>Add link</Button>
                  </div>
                )}
                {matMode === "notes" && (
                  <div className="space-y-2">
                    <Textarea rows={5} value={matNotes} onChange={(e) => setMatNotes(e.target.value)} placeholder="Write notes students can read in the lesson." aria-label="Notes" />
                    <Button onClick={addNotes} disabled={m.create.isPending}>Add notes</Button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* ---------------- prerequisites ---------------- */}
          <TabsContent value="prereq" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">Students must complete every prerequisite before this topic opens. Topics that would create a loop are not offered.</p>
            {myPrereqs.length === 0 ? <p className="text-sm">No prerequisites – this topic is open as soon as it is published.</p> : (
              <ul className="space-y-2">
                {myPrereqs.map((p) => (
                  <li key={p.id} className="flex items-center justify-between rounded-lg border p-2.5">
                    <span className="flex items-center gap-2 text-sm"><Lock className="h-4 w-4 text-muted-foreground" />{topicById.get(p.prerequisite_topic_id)?.title ?? "Unknown topic"}</span>
                    {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Remove prerequisite" onClick={() => m.removePrerequisite.mutate(p.id, { onError: (e) => toast.error(e.message) })}><X className="h-4 w-4" /></Button>}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <div className="flex gap-2">
                <Select value={pick} onValueChange={setPick}>
                  <SelectTrigger aria-label="Choose prerequisite topic"><SelectValue placeholder={candidates.length ? "Choose a prerequisite topic" : "No other topics available"} /></SelectTrigger>
                  <SelectContent>{candidates.map((id) => <SelectItem key={id} value={id}>{topicById.get(id)?.title}</SelectItem>)}</SelectContent>
                </Select>
                <Button disabled={!pick || m.addPrerequisite.isPending} onClick={() => m.addPrerequisite.mutate({ topicId: topic.id, prerequisiteId: pick }, { onSuccess: () => setPick(""), onError: (e) => toast.error(e.message) })}>Add</Button>
              </div>
            )}
          </TabsContent>

          {/* ---------------- linked work ---------------- */}
          <TabsContent value="work" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">Attach existing homework, worksheets and assessment papers so students see them with this topic.</p>
            {linked.length === 0 ? <p className="text-sm">Nothing attached yet.</p> : (
              <ul className="space-y-2">
                {linked.map((l) => (
                  <li key={l.id} className="flex items-center justify-between rounded-lg border p-2.5">
                    <div className="min-w-0"><p className="text-sm font-medium truncate">{l.title ?? "Untitled"}</p><p className="text-xs text-muted-foreground capitalize">{l.link_type}{l.due_date ? ` · due ${new Date(l.due_date).toLocaleDateString()}` : ""}</p></div>
                    {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Detach" onClick={() => links.remove.mutate(l.id)}><X className="h-4 w-4" /></Button>}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <div className="flex gap-2">
                <Select value={workPick} onValueChange={setWorkPick}>
                  <SelectTrigger aria-label="Choose work to attach"><SelectValue placeholder={work.isLoading ? "Loading your work…" : options.length ? "Choose homework, worksheet or paper" : "You have nothing to attach yet"} /></SelectTrigger>
                  <SelectContent>
                    {options.filter((o) => !linked.some((l) => l.link_type === o.link_type && l.ref_id === o.ref_id)).map((o) => (
                      <SelectItem key={`${o.link_type}:${o.ref_id}`} value={`${o.link_type}:${o.ref_id}`}>{o.link_type === "homework" ? "Homework" : o.link_type === "worksheet" ? "Worksheet" : "Assessment"} – {o.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button disabled={!workPick || links.add.isPending} onClick={attach}>Attach</Button>
              </div>
            )}
          </TabsContent>

          {/* ---------------- preview ---------------- */}
          <TabsContent value="preview" className="mt-4">
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-xs text-muted-foreground">This is what a student sees once the topic is published (unsaved edits are not included).</p>
              <h3 className="text-lg font-semibold">{topic.title}</h3>
              {topic.description && <p className="text-sm text-muted-foreground">{topic.description}</p>}
              {topic.learning_objectives && (
                <div><p className="text-sm font-medium mb-1">Learning objectives</p>
                  <ul className="list-disc ps-5 text-sm space-y-0.5">{topic.learning_objectives.split("\n").filter(Boolean).map((o, i) => <li key={i}>{o}</li>)}</ul></div>
              )}
              {topic.content_body && <div className="text-sm whitespace-pre-wrap rounded-md bg-muted/40 p-3">{topic.content_body}</div>}
              {publishedMaterials.length > 0 ? (
                <div><p className="text-sm font-medium mb-1">Materials</p>
                  <ul className="space-y-1">{publishedMaterials.map((x) => <li key={x.id} className="text-sm flex items-center gap-2"><Badge variant="outline">{MATERIAL_TYPE_LABEL[x.material_type]}</Badge>{x.title}</li>)}</ul></div>
              ) : materials.length > 0 && <p className="text-xs text-amber-600">None of the materials are published yet – students won't see them.</p>}
              {myPrereqs.length > 0 && <p className="text-sm"><Lock className="h-3.5 w-3.5 inline me-1" />Requires: {myPrereqs.map((p) => topicById.get(p.prerequisite_topic_id)?.title).filter(Boolean).join(", ")}</p>}
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
