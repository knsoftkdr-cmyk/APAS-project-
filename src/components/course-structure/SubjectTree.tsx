import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowDown, ArrowUp, BookOpen, ChevronDown, ChevronRight, Eye, EyeOff, FileText, GripVertical, Layers, MoreHorizontal, Pencil, Plus, Trash2, Archive,
} from "lucide-react";
import type { ContentStatus, Course, CourseChapter, CourseModule, CourseTopic } from "@/types/courseManagement";
import { WF_STATUS_STYLE, ownerActions } from "@/lib/approvalWorkflow";
import { useOwnerActions, useWorkflowSettings } from "@/hooks/useApprovalWorkflow";
import { ReasonDialog } from "@/components/approval/ReasonDialog";
import { buildSubjectTree, countTopics, filterTree, moveItem, statusOf, STATUS_LABEL, type TreeFilter } from "@/lib/courseStructure";
import { useStructureMutations, useSubjectData, type NodeKind } from "@/hooks/useCourseStructure";
import { useSortable } from "./dnd";
import { NodeDialog } from "./NodeDialog";
import { TopicEditorSheet } from "./TopicEditorSheet";

export function StatusBadge({ status }: { status: ContentStatus }) {
  return <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${WF_STATUS_STYLE[status] ?? WF_STATUS_STYLE.draft}`}>{STATUS_LABEL[status] ?? status}</Badge>;
}

type DialogState =
  | { type: "module"; mode: "create" }
  | { type: "module"; mode: "edit"; node: CourseModule }
  | { type: "chapter"; mode: "create"; moduleId: string }
  | { type: "chapter"; mode: "edit"; node: CourseChapter }
  | null;

interface Props {
  course: Course;
  canEdit: boolean;
  filter: TreeFilter;
  /** allows the parent to open the stats dialog etc. */
  expandAll?: boolean;
}

export function SubjectTree({ course, canEdit, filter, expandAll }: Props) {
  const { data, isLoading, error } = useSubjectData(course.id);
  const m = useStructureMutations(course.id);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set()); // "kind:id"
  const [dialog, setDialog] = useState<DialogState>(null);
  const [editingTopic, setEditingTopic] = useState<CourseTopic | null>(null);

  const tree = useMemo(() => (data ? buildSubjectTree(data.modules, data.chapters, data.topics) : []), [data]);
  const visible = useMemo(() => filterTree(tree, filter), [tree, filter]);
  const filtering = filter.search.trim() !== "" || filter.status !== "all";
  const isOpen = (id: string) => expandAll || filtering || open.has(id);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const fail = (e: Error) => toast.error(e.message);

  const moduleSort = useSortable("module", visible.map((x) => x.id), (ids) => m.reorder.mutate({ kind: "module", ids }, { onError: fail }), canEdit && !filtering);

  const toggleSel = (kind: NodeKind, id: string) => setSelected((s) => { const n = new Set(s); const k = `${kind}:${id}`; if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const isSel = (kind: NodeKind, id: string) => selected.has(`${kind}:${id}`);
  const selectedIds = (kind: NodeKind) => [...selected].filter((k) => k.startsWith(kind + ":")).map((k) => k.slice(kind.length + 1));

  const bulkStatus = async (status: ContentStatus) => {
    try {
      for (const kind of ["module", "chapter", "topic"] as const) {
        const ids = selectedIds(kind);
        if (ids.length) await m.bulkStatus.mutateAsync({ kind, ids, status });
      }
      toast.success(`Set ${selected.size} item(s) to ${STATUS_LABEL[status].toLowerCase()}`);
      setSelected(new Set());
    } catch (e) { fail(e as Error); }
  };
  const bulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} selected item(s)? Chapters and modules also delete what is inside them. This cannot be undone.`)) return;
    try {
      // children first would be redundant: the database cascades; delete from the top level down.
      for (const kind of ["module", "chapter", "topic"] as const) {
        const ids = selectedIds(kind);
        if (ids.length) await m.remove.mutateAsync({ kind, ids });
      }
      toast.success("Deleted");
      setSelected(new Set());
    } catch (e) { fail(e as Error); }
  };

  const setStatus = (kind: NodeKind, id: string, status: ContentStatus) =>
    m.update.mutate({ kind, id, values: { status, ...(kind !== "module" ? { updated_at: new Date().toISOString() } : {}) } }, { onError: fail, onSuccess: () => toast.success(status === "published" ? "Published" : `Marked ${status}`) });
  const del = (kind: NodeKind, id: string, label: string, cascade: string) => {
    if (!confirm(`Delete "${label}"?${cascade} This cannot be undone.`)) return;
    m.remove.mutate({ kind, ids: [id] }, { onError: fail, onSuccess: () => toast.success("Deleted") });
  };

  const addTopic = (moduleId: string, chapterId: string | null, count: number) =>
    m.create.mutate(
      { kind: "topic", values: { module_id: moduleId, chapter_id: chapterId, title: "New topic", topic_type: "learn", status: "draft", order_index: count } },
      { onError: fail, onSuccess: (row) => { setEditingTopic(row as CourseTopic); if (chapterId) setOpen((s) => new Set(s).add(chapterId)); } },
    );

  if (isLoading) return <div className="space-y-2 p-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>;
  if (error) return <p className="p-3 text-sm text-destructive">Couldn't load this subject: {(error as Error).message}</p>;
  if (!data) return null;

  const topicCount = countTopics(tree);
  const NodeMenu = ({ kind, id, status, onEdit, label, cascade, extra }: { kind: NodeKind; id: string; status: ContentStatus; onEdit: () => void; label: string; cascade: string; extra?: React.ReactNode }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Actions for ${label}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}><Pencil className="h-4 w-4 me-2" />Edit</DropdownMenuItem>
        {extra}
        {status !== "published" && <DropdownMenuItem onClick={() => setStatus(kind, id, "published")}><Eye className="h-4 w-4 me-2" />Publish</DropdownMenuItem>}
        {status === "published" && <DropdownMenuItem onClick={() => setStatus(kind, id, "draft")}><EyeOff className="h-4 w-4 me-2" />Unpublish</DropdownMenuItem>}
        {status !== "archived" && <DropdownMenuItem onClick={() => setStatus(kind, id, "archived")}><Archive className="h-4 w-4 me-2" />Archive</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => del(kind, id, label, cascade)}><Trash2 className="h-4 w-4 me-2" />Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const TopicRow = ({ t, siblings, index, indent }: { t: CourseTopic; siblings: CourseTopic[]; index: number; indent: string }) => {
    const prereqCount = data.prerequisites.filter((p) => p.topic_id === t.id).length;
    return (
      <div className={`flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 ${indent}`} data-testid={`topic-row-${t.id}`}>
        {canEdit && <Checkbox checked={isSel("topic", t.id)} onCheckedChange={() => toggleSel("topic", t.id)} aria-label={`Select ${t.title}`} />}
        {canEdit && !filtering && <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" aria-hidden />}
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <button className="flex-1 min-w-0 text-start text-sm truncate hover:underline" onClick={() => setEditingTopic(t)}>{t.title}</button>
        <span className="hidden sm:inline text-xs text-muted-foreground capitalize shrink-0">{t.topic_type}</span>
        {prereqCount > 0 && <Badge variant="outline" className="text-[11px] px-1.5 py-0 shrink-0">{prereqCount} prereq</Badge>}
        <StatusBadge status={statusOf(t)} />
        {canEdit && !filtering && (
          <>
            <Button size="icon" variant="ghost" className="h-7 w-7 hidden sm:inline-flex" aria-label="Move topic up" disabled={index === 0}
              onClick={() => m.reorder.mutate({ kind: "topic", ids: moveItem(siblings.map((x) => x.id), index, index - 1) }, { onError: fail })}><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 hidden sm:inline-flex" aria-label="Move topic down" disabled={index === siblings.length - 1}
              onClick={() => m.reorder.mutate({ kind: "topic", ids: moveItem(siblings.map((x) => x.id), index, index + 1) }, { onError: fail })}><ArrowDown className="h-3.5 w-3.5" /></Button>
          </>
        )}
        {canEdit
          ? <NodeMenu kind="topic" id={t.id} status={statusOf(t)} label={t.title} cascade=" Its materials and progress are deleted too." onEdit={() => setEditingTopic(t)} />
          : <Button size="sm" variant="ghost" onClick={() => setEditingTopic(t)}>View</Button>}
      </div>
    );
  };

  const TopicList = ({ topics, indent }: { topics: CourseTopic[]; indent: string }) => {
    const sortable = useSortable("topic-" + (topics[0]?.chapter_id ?? topics[0]?.module_id ?? "x"), topics.map((x) => x.id),
      (ids) => m.reorder.mutate({ kind: "topic", ids }, { onError: fail }), canEdit && !filtering);
    return (
      <div className="space-y-1.5">
        {topics.map((t, i) => (
          <div key={t.id} {...sortable.itemProps(t.id)} className={sortable.overId === t.id ? "ring-2 ring-primary rounded-md" : ""}>
            <TopicRow t={t} siblings={topics} index={i} indent={indent} />
          </div>
        ))}
      </div>
    );
  };

  const ChapterList = ({ module }: { module: (typeof visible)[number] }) => {
    const sortable = useSortable("chapter-" + module.id, module.chapters.map((c) => c.id),
      (ids) => m.reorder.mutate({ kind: "chapter", ids }, { onError: fail }), canEdit && !filtering);
    return (
      <div className="space-y-2">
        {module.chapters.map((c, ci) => {
          const fullChapter = data.topics.filter((t) => t.chapter_id === c.id);
          return (
            <div key={c.id} {...sortable.itemProps(c.id)} className={`rounded-lg border bg-muted/20 ${sortable.overId === c.id ? "ring-2 ring-primary" : ""}`}>
              <div className="flex items-center gap-2 px-2 py-1.5">
                {canEdit && <Checkbox checked={isSel("chapter", c.id)} onCheckedChange={() => toggleSel("chapter", c.id)} aria-label={`Select ${c.title}`} />}
                {canEdit && !filtering && <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" aria-hidden />}
                <button className="flex items-center gap-1.5 flex-1 min-w-0 text-start" onClick={() => toggle(c.id)} aria-expanded={isOpen(c.id)}>
                  {isOpen(c.id) ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <Layers className="h-4 w-4 text-indigo-500 shrink-0" />
                  <span className="text-sm font-medium truncate">Chapter {ci + 1}: {c.title}</span>
                </button>
                <span className="text-xs text-muted-foreground shrink-0">{fullChapter.length} topic{fullChapter.length === 1 ? "" : "s"}</span>
                <StatusBadge status={statusOf(c)} />
                {canEdit && !filtering && (
                  <>
                    <Button size="icon" variant="ghost" className="h-7 w-7 hidden sm:inline-flex" aria-label="Move chapter up" disabled={ci === 0}
                      onClick={() => m.reorder.mutate({ kind: "chapter", ids: moveItem(module.chapters.map((x) => x.id), ci, ci - 1) }, { onError: fail })}><ArrowUp className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 hidden sm:inline-flex" aria-label="Move chapter down" disabled={ci === module.chapters.length - 1}
                      onClick={() => m.reorder.mutate({ kind: "chapter", ids: moveItem(module.chapters.map((x) => x.id), ci, ci + 1) }, { onError: fail })}><ArrowDown className="h-3.5 w-3.5" /></Button>
                  </>
                )}
                {canEdit && (
                  <>
                    <Button size="sm" variant="ghost" className="h-8 hidden md:inline-flex" onClick={() => addTopic(module.id, c.id, fullChapter.length)}><Plus className="h-4 w-4 me-1" />Topic</Button>
                    <NodeMenu kind="chapter" id={c.id} status={statusOf(c)} label={c.title} cascade=" Its topics are deleted too." onEdit={() => setDialog({ type: "chapter", mode: "edit", node: c })}
                      extra={<DropdownMenuItem onClick={() => addTopic(module.id, c.id, fullChapter.length)}><Plus className="h-4 w-4 me-2" />Add topic</DropdownMenuItem>} />
                  </>
                )}
              </div>
              {isOpen(c.id) && (
                <div className="px-2 pb-2">
                  {c.description && <p className="text-xs text-muted-foreground px-1 pb-1.5">{c.description}</p>}
                  {c.topics.length === 0
                    ? <p className="text-xs text-muted-foreground px-1 py-1">{filtering ? "No matching topics." : "No topics yet."}</p>
                    : <TopicList topics={c.topics} indent="ms-2" />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">{tree.length} module{tree.length === 1 ? "" : "s"} · {data.chapters.length} chapter{data.chapters.length === 1 ? "" : "s"} · {topicCount} topic{topicCount === 1 ? "" : "s"}</p>
        {canEdit && <Button size="sm" variant="outline" className="ms-auto" onClick={() => setDialog({ type: "module", mode: "create" })}><Plus className="h-4 w-4 me-1" />Add module</Button>}
      </div>

      {selected.size > 0 && canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2" role="region" aria-label="Bulk actions">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => bulkStatus("published")}><Eye className="h-4 w-4 me-1" />Publish</Button>
          <Button size="sm" variant="outline" onClick={() => bulkStatus("draft")}><EyeOff className="h-4 w-4 me-1" />Unpublish</Button>
          <Button size="sm" variant="outline" onClick={() => bulkStatus("archived")}><Archive className="h-4 w-4 me-1" />Archive</Button>
          <Button size="sm" variant="outline" className="text-destructive" onClick={bulkDelete}><Trash2 className="h-4 w-4 me-1" />Delete</Button>
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {tree.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="font-medium">No modules yet</p>
          <p className="text-sm text-muted-foreground mb-3">Start by adding a module, then chapters and topics inside it.</p>
          {canEdit && <Button onClick={() => setDialog({ type: "module", mode: "create" })}><Plus className="h-4 w-4 me-1" />Add the first module</Button>}
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground p-4 text-center">Nothing matches your search or filter.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((mod, mi) => {
            const full = tree.find((x) => x.id === mod.id)!;
            const count = full.looseTopics.length + full.chapters.reduce((n, c) => n + c.topics.length, 0);
            return (
              <div key={mod.id} {...moduleSort.itemProps(mod.id)} className={`rounded-xl border bg-card ${moduleSort.overId === mod.id ? "ring-2 ring-primary" : ""}`}>
                <div className="flex items-center gap-2 px-2.5 py-2">
                  {canEdit && <Checkbox checked={isSel("module", mod.id)} onCheckedChange={() => toggleSel("module", mod.id)} aria-label={`Select ${mod.title}`} />}
                  {canEdit && !filtering && <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" aria-hidden />}
                  <button className="flex items-center gap-1.5 flex-1 min-w-0 text-start" onClick={() => toggle(mod.id)} aria-expanded={isOpen(mod.id)}>
                    {isOpen(mod.id) ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <BookOpen className="h-4 w-4 text-primary shrink-0" />
                    <span className="font-medium truncate">Module {mi + 1}: {mod.title}</span>
                  </button>
                  <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">{full.chapters.length} ch · {count} topics</span>
                  <StatusBadge status={statusOf(mod)} />
                  {canEdit && !filtering && (
                    <>
                      <Button size="icon" variant="ghost" className="h-7 w-7 hidden sm:inline-flex" aria-label="Move module up" disabled={mi === 0}
                        onClick={() => m.reorder.mutate({ kind: "module", ids: moveItem(visible.map((x) => x.id), mi, mi - 1) }, { onError: fail })}><ArrowUp className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 hidden sm:inline-flex" aria-label="Move module down" disabled={mi === visible.length - 1}
                        onClick={() => m.reorder.mutate({ kind: "module", ids: moveItem(visible.map((x) => x.id), mi, mi + 1) }, { onError: fail })}><ArrowDown className="h-3.5 w-3.5" /></Button>
                    </>
                  )}
                  {canEdit && (
                    <NodeMenu kind="module" id={mod.id} status={statusOf(mod)} label={mod.title} cascade=" Its chapters and topics are deleted too." onEdit={() => setDialog({ type: "module", mode: "edit", node: mod })}
                      extra={<>
                        <DropdownMenuItem onClick={() => setDialog({ type: "chapter", mode: "create", moduleId: mod.id })}><Plus className="h-4 w-4 me-2" />Add chapter</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => addTopic(mod.id, null, full.looseTopics.length)}><Plus className="h-4 w-4 me-2" />Add topic (no chapter)</DropdownMenuItem>
                      </>} />
                  )}
                </div>
                {isOpen(mod.id) && (
                  <div className="px-3 pb-3 space-y-2">
                    {mod.description && <p className="text-sm text-muted-foreground">{mod.description}</p>}
                    {mod.chapters.length > 0 && <ChapterList module={mod} />}
                    {mod.looseTopics.length > 0 && (
                      <div className="space-y-1.5">
                        {mod.chapters.length > 0 && <p className="text-xs font-medium text-muted-foreground pt-1">Topics outside a chapter</p>}
                        <TopicList topics={mod.looseTopics} indent="" />
                      </div>
                    )}
                    {mod.chapters.length === 0 && mod.looseTopics.length === 0 && !filtering && <p className="text-sm text-muted-foreground">This module is empty.</p>}
                    {canEdit && !filtering && (
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" variant="outline" onClick={() => setDialog({ type: "chapter", mode: "create", moduleId: mod.id })}><Plus className="h-4 w-4 me-1" />Add chapter</Button>
                        <Button size="sm" variant="ghost" onClick={() => addTopic(mod.id, null, full.looseTopics.length)}><Plus className="h-4 w-4 me-1" />Add topic</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* module + chapter dialogs */}
      <NodeDialog
        open={dialog?.type === "module"} onOpenChange={(o) => !o && setDialog(null)} noun="module"
        mode={dialog?.type === "module" ? dialog.mode : "create"} initial={dialog?.type === "module" && dialog.mode === "edit" ? dialog.node : undefined}
        saving={m.create.isPending || m.update.isPending}
        onSubmit={(v) => {
          if (dialog?.type !== "module") return;
          if (dialog.mode === "create") m.create.mutate({ kind: "module", values: { course_id: course.id, status: "draft", order_index: data.modules.length, ...v } }, { onError: fail, onSuccess: () => { setDialog(null); toast.success("Module added"); } });
          else m.update.mutate({ kind: "module", id: dialog.node.id, values: v }, { onError: fail, onSuccess: () => { setDialog(null); toast.success("Module updated"); } });
        }}
      />
      <NodeDialog
        open={dialog?.type === "chapter"} onOpenChange={(o) => !o && setDialog(null)} noun="chapter"
        mode={dialog?.type === "chapter" ? dialog.mode : "create"} initial={dialog?.type === "chapter" && dialog.mode === "edit" ? dialog.node : undefined}
        saving={m.create.isPending || m.update.isPending}
        onSubmit={(v) => {
          if (dialog?.type !== "chapter") return;
          if (dialog.mode === "create") {
            const count = data.chapters.filter((c) => c.module_id === dialog.moduleId).length;
            m.create.mutate({ kind: "chapter", values: { module_id: dialog.moduleId, status: "draft", order_index: count, ...v } }, { onError: fail, onSuccess: () => { setOpen((s) => new Set(s).add(dialog.moduleId)); setDialog(null); toast.success("Chapter added"); } });
          } else m.update.mutate({ kind: "chapter", id: dialog.node.id, values: { ...v, updated_at: new Date().toISOString() } }, { onError: fail, onSuccess: () => { setDialog(null); toast.success("Chapter updated"); } });
        }}
      />

      <TopicEditorSheet
        open={!!editingTopic} onOpenChange={(o) => !o && setEditingTopic(null)}
        topic={editingTopic ? data.topics.find((t) => t.id === editingTopic.id) ?? editingTopic : null}
        courseId={course.id}
        chapters={editingTopic ? data.chapters.filter((c) => c.module_id === editingTopic.module_id) : []}
        allTopics={data.topics} prerequisites={data.prerequisites} canEdit={canEdit}
      />
    </div>
  );
}
