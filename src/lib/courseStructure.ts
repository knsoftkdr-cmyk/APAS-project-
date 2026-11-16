// Pure helpers for the multi-level course structure
//   Academic Session -> Semester -> Subject(course) -> Module -> Chapter -> Topic -> Materials
// Nothing here touches Supabase, so it is fully unit-testable.
import type {
  ContentStatus, Course, CourseChapter, CourseModule, CourseTopic, MaterialType, TopicPrerequisite, TopicState,
} from "@/types/courseManagement";

// ---------- tree building ----------
export interface ChapterNode extends CourseChapter { topics: CourseTopic[] }
export interface ModuleNode extends CourseModule { chapters: ChapterNode[]; looseTopics: CourseTopic[] }

const byOrder = <T extends { order_index: number; created_at?: string }>(a: T, b: T) =>
  a.order_index - b.order_index || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));

/** Nests flat rows into Module -> Chapter -> Topic. Topics without a chapter (legacy shape) stay on the module. */
export function buildSubjectTree(modules: CourseModule[], chapters: CourseChapter[], topics: CourseTopic[]): ModuleNode[] {
  return [...modules].sort(byOrder).map((m) => {
    const modTopics = topics.filter((t) => t.module_id === m.id);
    const chs = chapters.filter((c) => c.module_id === m.id).sort(byOrder).map((c) => ({
      ...c,
      topics: modTopics.filter((t) => t.chapter_id === c.id).sort(byOrder),
    }));
    const chapterIds = new Set(chs.map((c) => c.id));
    return {
      ...m,
      chapters: chs,
      // a topic whose chapter was deleted/unknown is shown on the module rather than disappearing
      looseTopics: modTopics.filter((t) => !t.chapter_id || !chapterIds.has(t.chapter_id)).sort(byOrder),
    };
  });
}

export const statusOf = (x: { status?: ContentStatus | null }): ContentStatus => x.status ?? "published";

export interface TreeFilter { search: string; status: ContentStatus | "all" }

/** Keeps a node when it (or any descendant) matches; ancestors of a match are always kept so the path stays visible. */
export function filterTree(tree: ModuleNode[], f: TreeFilter): ModuleNode[] {
  const q = f.search.trim().toLowerCase();
  const textOk = (s?: string | null) => !q || (s ?? "").toLowerCase().includes(q);
  const statusOk = (x: { status?: ContentStatus | null }) => f.status === "all" || statusOf(x) === f.status;
  const topicOk = (t: CourseTopic) => statusOk(t) && textOk(t.title);
  if (!q && f.status === "all") return tree;

  const out: ModuleNode[] = [];
  for (const m of tree) {
    const chapters = m.chapters
      .map((c) => ({ ...c, topics: c.topics.filter(topicOk) }))
      .filter((c) => c.topics.length > 0 || (statusOk(c) && textOk(c.title)));
    const looseTopics = m.looseTopics.filter(topicOk);
    if (chapters.length > 0 || looseTopics.length > 0 || (statusOk(m) && textOk(m.title))) {
      out.push({ ...m, chapters, looseTopics });
    }
  }
  return out;
}

export function countTopics(tree: ModuleNode[]): number {
  return tree.reduce((n, m) => n + m.looseTopics.length + m.chapters.reduce((k, c) => k + c.topics.length, 0), 0);
}

// ---------- ordering ----------
/** Returns a new array with the item at `from` moved to `to` (drag & drop / up-down buttons). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ---------- prerequisites ----------
/**
 * True when adding "topicId requires prerequisiteId" would close a loop. Mirrors the database trigger so the
 * UI can explain the problem before it round-trips; the database remains the source of truth.
 */
export function wouldCreateCycle(edges: Pick<TopicPrerequisite, "topic_id" | "prerequisite_topic_id">[], topicId: string, prerequisiteId: string): boolean {
  if (topicId === prerequisiteId) return true;
  const requires = new Map<string, string[]>();
  for (const e of edges) requires.set(e.topic_id, [...(requires.get(e.topic_id) ?? []), e.prerequisite_topic_id]);
  // walk everything the prerequisite (transitively) requires; reaching topicId means a loop
  const seen = new Set<string>();
  const stack = [prerequisiteId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === topicId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(requires.get(id) ?? []));
  }
  return false;
}

/** Topics that may be offered as a prerequisite of `topicId` (same subject, not itself, would not form a loop, not already chosen). */
export function eligiblePrerequisites(
  topics: Pick<CourseTopic, "id">[], edges: Pick<TopicPrerequisite, "topic_id" | "prerequisite_topic_id">[], topicId: string,
): string[] {
  const chosen = new Set(edges.filter((e) => e.topic_id === topicId).map((e) => e.prerequisite_topic_id));
  return topics.map((t) => t.id).filter((id) => id !== topicId && !chosen.has(id) && !wouldCreateCycle(edges, topicId, id));
}

// ---------- materials ----------
export const MATERIAL_TYPE_LABEL: Record<MaterialType, string> = {
  pdf: "PDF", ppt: "Slides (PPT)", document: "Document", video: "Video", image: "Image", notes: "Notes", link: "Link",
};

export function detectMaterialType(fileName: string, mime?: string | null): MaterialType {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const m = (mime ?? "").toLowerCase();
  if (ext === "pdf" || m === "application/pdf") return "pdf";
  if (["ppt", "pptx", "pps", "ppsx", "key", "odp"].includes(ext) || m.includes("presentation") || m.includes("powerpoint")) return "ppt";
  if (["mp4", "webm", "mov", "m4v", "mkv"].includes(ext) || m.startsWith("video/")) return "video";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext) || m.startsWith("image/")) return "image";
  if (["doc", "docx", "xls", "xlsx", "csv", "odt", "ods", "txt", "rtf"].includes(ext) || m.includes("word") || m.includes("sheet") || m.startsWith("text/")) return "document";
  return "document";
}

export const MAX_MATERIAL_BYTES = 250 * 1024 * 1024;
const ALLOWED_EXT = new Set(["pdf", "ppt", "pptx", "pps", "ppsx", "odp", "doc", "docx", "xls", "xlsx", "csv", "txt", "rtf", "odt", "png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "mov", "m4v"]);

/** null when the file is acceptable, otherwise a message for the teacher. */
export function validateMaterialFile(file: { name: string; size: number }): string | null {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return "Unsupported file type. Upload a PDF, PPT, document, image or video.";
  if (file.size <= 0) return "The file is empty.";
  if (file.size > MAX_MATERIAL_BYTES) return `File is too large (max ${Math.round(MAX_MATERIAL_BYTES / 1024 / 1024)} MB).`;
  return null;
}

/** Object path inside the private `course-materials` bucket: {school}/{course}/{topic}/{timestamp}-{safe-name}. */
export function materialStoragePath(schoolId: string, courseId: string, topicId: string, fileName: string, now = Date.now()): string {
  const safe = fileName.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(-100) || "file";
  return `${schoolId}/${courseId}/${topicId}/${now}-${safe}`;
}

/** Turns a watch / share URL into an embeddable one for the common video hosts; null = open as a plain link. */
export function videoEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
      const m = u.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/);
      if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
    }
    if (host === "vimeo.com") {
      const m = u.pathname.match(/^\/(\d+)/);
      if (m) return `https://player.vimeo.com/video/${m[1]}`;
    }
  } catch { /* not a URL */ }
  return null;
}

/** Only http(s) links may be opened from learning material; blocks javascript:/data: URLs. */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch { return null; }
}

// ---------- display ----------
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  if (s < 60) return s > 0 ? `${s}s` : "0m";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: "Draft", pending_review: "Pending review", changes_requested: "Changes requested", rejected: "Rejected",
  approved: "Approved", published: "Published", archived: "Archived",
};
export const STATE_LABEL: Record<TopicState, string> = {
  locked: "Locked", available: "Not started", in_progress: "In progress", completed: "Completed",
};

export const percent = (done: number, total: number) => (total > 0 ? Math.round((100 * done) / total) : 0);

// ---------- session -> semester -> subject grouping ----------
export interface SessionRef { id: string; name: string; is_active?: boolean }
export interface SemesterRef { id: string; academic_year_id: string; name: string }
export interface SemesterGroup { semester: SemesterRef | null; courses: Course[] }
export interface SessionGroup { session: SessionRef | null; semesters: SemesterGroup[] }

/** Subjects without a session/semester (all pre-existing courses) land in an "Unassigned" group so nothing is lost. */
export function groupCourses(courses: Course[], sessions: SessionRef[], semesters: SemesterRef[]): SessionGroup[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const semById = new Map(semesters.map((s) => [s.id, s]));
  const groups = new Map<string, SessionGroup>();
  const semGroups = new Map<string, SemesterGroup>();

  for (const c of courses) {
    const session = c.academic_year_id ? sessionById.get(c.academic_year_id) ?? null : null;
    const sem = c.semester_id ? semById.get(c.semester_id) ?? null : null;
    const gKey = session?.id ?? "none";
    if (!groups.has(gKey)) groups.set(gKey, { session, semesters: [] });
    const sKey = `${gKey}:${sem?.id ?? "none"}`;
    if (!semGroups.has(sKey)) {
      const sg: SemesterGroup = { semester: sem, courses: [] };
      semGroups.set(sKey, sg);
      groups.get(gKey)!.semesters.push(sg);
    }
    semGroups.get(sKey)!.courses.push(c);
  }
  const list = [...groups.values()];
  const rank = (g: SessionGroup) => (g.session ? (g.session.is_active ? 0 : 1) : 2);
  list.sort((a, b) => rank(a) - rank(b) || (b.session?.name ?? "").localeCompare(a.session?.name ?? ""));
  for (const g of list) {
    g.semesters.sort((a, b) => (a.semester ? 0 : 1) - (b.semester ? 0 : 1) || (a.semester?.name ?? "").localeCompare(b.semester?.name ?? ""));
    for (const s of g.semesters) s.courses.sort((a, b) => a.title.localeCompare(b.title));
  }
  return list;
}

/** Friendly message for the database errors raised by the course-structure migration. */
export function friendlyCourseError(message: string | undefined | null): string {
  const m = message ?? "";
  // Approval-workflow errors arrive as "WF_CODE: readable text" - show the readable part.
  const wf = m.match(/WF_[A-Z_]+:\s*(.*)/);
  if (wf) return wf[1].trim();
  if (m.includes("HISTORY_IMMUTABLE")) return "Approval history cannot be changed.";
  if (m.includes("PREREQ_CYCLE")) return "That prerequisite would create a loop (a topic cannot depend on itself, directly or indirectly).";
  if (m.includes("PREREQ_CROSS_COURSE")) return "Prerequisites must belong to the same subject.";
  if (m.includes("TOPIC_LOCKED")) return "This topic is locked. Complete its prerequisite topics first.";
  if (m.includes("CHAPTER_MODULE_MISMATCH")) return "The chapter does not belong to that module.";
  if (m.includes("row-level security") || m.includes("FORBIDDEN")) return "You don't have permission to change this content.";
  if (m.includes("duplicate key")) return "That item already exists.";
  return m || "Something went wrong. Please try again.";
}
