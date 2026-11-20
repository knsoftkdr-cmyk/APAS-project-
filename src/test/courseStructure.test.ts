import { describe, it, expect } from "vitest";
import {
  buildSubjectTree, filterTree, countTopics, moveItem, wouldCreateCycle, eligiblePrerequisites, detectMaterialType,
  validateMaterialFile, materialStoragePath, videoEmbedUrl, safeExternalUrl, formatDuration, groupCourses, friendlyCourseError, percent,
} from "@/lib/courseStructure";
import type { Course, CourseChapter, CourseModule, CourseTopic } from "@/types/courseManagement";

const mod = (id: string, order: number, extra: Partial<CourseModule> = {}): CourseModule => ({
  id, course_id: "c1", title: `Module ${id}`, description: null, content_url: null, content_body: null, vark_type: null,
  order_index: order, created_at: `2026-01-0${order + 1}`, ...extra,
});
const chap = (id: string, moduleId: string, order: number, extra: Partial<CourseChapter> = {}): CourseChapter => ({
  id, module_id: moduleId, title: `Chapter ${id}`, description: null, order_index: order, status: "published", created_by: null,
  created_at: `2026-01-0${order + 1}`, updated_at: "", ...extra,
});
const topic = (id: string, moduleId: string, chapterId: string | null, order: number, extra: Partial<CourseTopic> = {}): CourseTopic => ({
  id, module_id: moduleId, chapter_id: chapterId, title: `Topic ${id}`, topic_type: "learn", content_body: null, content_url: null,
  order_index: order, created_at: `2026-01-0${order + 1}`, ...extra,
});

describe("buildSubjectTree", () => {
  const modules = [mod("m2", 1), mod("m1", 0)];
  const chapters = [chap("ch2", "m1", 1), chap("ch1", "m1", 0)];
  const topics = [
    topic("t3", "m1", "ch1", 1), topic("t1", "m1", "ch1", 0), topic("t4", "m1", "ch2", 0),
    topic("legacy", "m2", null, 0), topic("orphan", "m1", "deleted-chapter", 5),
  ];
  const tree = buildSubjectTree(modules, chapters, topics);

  it("orders modules, chapters and topics by order_index", () => {
    expect(tree.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(tree[0].chapters.map((c) => c.id)).toEqual(["ch1", "ch2"]);
    expect(tree[0].chapters[0].topics.map((t) => t.id)).toEqual(["t1", "t3"]);
  });
  it("keeps legacy module->topic rows (no chapter) on the module", () => {
    expect(tree[1].looseTopics.map((t) => t.id)).toEqual(["legacy"]);
    expect(tree[1].chapters).toEqual([]);
  });
  it("never drops a topic whose chapter no longer exists", () => {
    expect(tree[0].looseTopics.map((t) => t.id)).toEqual(["orphan"]);
    expect(countTopics(tree)).toBe(5);
  });
});

describe("filterTree", () => {
  const tree = buildSubjectTree(
    [mod("m1", 0), mod("m2", 1)],
    [chap("ch1", "m1", 0)],
    [topic("a", "m1", "ch1", 0, { title: "Variables", status: "published" }), topic("b", "m1", "ch1", 1, { title: "Equations", status: "draft" }), topic("c", "m2", null, 0, { title: "Angles" })],
  );
  it("returns everything with no filter", () => expect(filterTree(tree, { search: "", status: "all" })).toBe(tree));
  it("search keeps the path to matching topics only", () => {
    const r = filterTree(tree, { search: "var", status: "all" });
    expect(r).toHaveLength(1);
    expect(r[0].chapters[0].topics.map((t) => t.id)).toEqual(["a"]);
  });
  it("status filter finds drafts", () => {
    const r = filterTree(tree, { search: "", status: "draft" });
    expect(countTopics(r)).toBe(1);
    expect(r[0].chapters[0].topics[0].id).toBe("b");
  });
  it("rows with no status are treated as published (backward compatible)", () => {
    expect(countTopics(filterTree(tree, { search: "", status: "published" }))).toBe(2);
  });
});

describe("moveItem", () => {
  it("moves forward and backward", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
  it("ignores out-of-range moves without mutating", () => {
    const l = ["a", "b"];
    expect(moveItem(l, 0, 5)).toBe(l);
    expect(moveItem(l, -1, 0)).toBe(l);
    expect(l).toEqual(["a", "b"]);
  });
});

describe("prerequisite cycle detection", () => {
  const edges = [{ topic_id: "b", prerequisite_topic_id: "a" }, { topic_id: "c", prerequisite_topic_id: "b" }];
  it("rejects self, direct and transitive loops", () => {
    expect(wouldCreateCycle(edges, "a", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "b")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "c")).toBe(true);
  });
  it("allows valid links, including diamonds", () => {
    expect(wouldCreateCycle(edges, "c", "a")).toBe(false);
    expect(wouldCreateCycle(edges, "d", "c")).toBe(false);
    expect(wouldCreateCycle([...edges, { topic_id: "d", prerequisite_topic_id: "b" }], "d", "a")).toBe(false);
  });
  it("terminates on graphs that already contain a loop", () => {
    expect(wouldCreateCycle([{ topic_id: "x", prerequisite_topic_id: "y" }, { topic_id: "y", prerequisite_topic_id: "x" }], "q", "x")).toBe(false);
  });
  it("lists only selectable prerequisites", () => {
    const all = ["a", "b", "c", "d"].map((id) => ({ id }));
    expect(eligiblePrerequisites(all, edges, "a")).toEqual(["d"]);
    expect(eligiblePrerequisites(all, edges, "c")).toEqual(["a", "d"]);
  });
});

describe("materials", () => {
  it("detects the material type", () => {
    expect(detectMaterialType("Notes.PDF")).toBe("pdf");
    expect(detectMaterialType("deck.pptx")).toBe("ppt");
    expect(detectMaterialType("clip.mp4")).toBe("video");
    expect(detectMaterialType("diagram.png")).toBe("image");
    expect(detectMaterialType("sheet.xlsx")).toBe("document");
    expect(detectMaterialType("x.bin", "application/pdf")).toBe("pdf");
  });
  it("validates uploads", () => {
    expect(validateMaterialFile({ name: "a.pdf", size: 1000 })).toBeNull();
    expect(validateMaterialFile({ name: "virus.exe", size: 1000 })).toMatch(/Unsupported/);
    expect(validateMaterialFile({ name: "a.pdf", size: 0 })).toMatch(/empty/);
    expect(validateMaterialFile({ name: "a.mp4", size: 300 * 1024 * 1024 })).toMatch(/too large/);
  });
  it("builds a school/course/topic scoped storage path with a safe file name", () => {
    const p = materialStoragePath("sch", "crs", "top", "My Notes (final)!.pdf", 123);
    expect(p.startsWith("sch/crs/top/123-")).toBe(true);
    expect(p).not.toMatch(/[ ()!]/);
    expect(p.endsWith(".pdf")).toBe(true);
    expect(p.split("/")).toHaveLength(4);
  });
  it("embeds YouTube/Vimeo and rejects unknown hosts", () => {
    expect(videoEmbedUrl("https://www.youtube.com/watch?v=abc123")).toBe("https://www.youtube-nocookie.com/embed/abc123");
    expect(videoEmbedUrl("https://youtu.be/abc123")).toBe("https://www.youtube-nocookie.com/embed/abc123");
    expect(videoEmbedUrl("https://vimeo.com/12345")).toBe("https://player.vimeo.com/video/12345");
    expect(videoEmbedUrl("https://evil.example/watch?v=1")).toBeNull();
    expect(videoEmbedUrl("not a url")).toBeNull();
  });
  it("only allows http(s) external links", () => {
    expect(safeExternalUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,x")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});

describe("display helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(600)).toBe("10m");
    expect(formatDuration(3900)).toBe("1h 5m");
    expect(formatDuration(undefined)).toBe("0m");
  });
  it("computes percentages safely", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBe(0);
  });
  it("maps database errors to friendly messages", () => {
    expect(friendlyCourseError("PREREQ_CYCLE: x")).toMatch(/loop/);
    expect(friendlyCourseError('new row violates row-level security policy for table "course_chapters"')).toMatch(/permission/);
    expect(friendlyCourseError("TOPIC_LOCKED: complete")).toMatch(/locked/);
  });
});

describe("groupCourses (session -> semester -> subject)", () => {
  const course = (id: string, title: string, y: string | null, s: string | null): Course => ({
    id, school_id: "s", title, description: null, subject: null, class_level: null, thumbnail_url: null, status: "published",
    mentor_id: null, created_by: null, created_at: "", updated_at: "", academic_year_id: y, semester_id: s,
  });
  const sessions = [{ id: "y1", name: "2025-2026" }, { id: "y2", name: "2026-2027", is_active: true }];
  const semesters = [{ id: "s1", academic_year_id: "y2", name: "Semester 1" }, { id: "s2", academic_year_id: "y2", name: "Semester 2" }];
  const groups = groupCourses(
    [course("1", "Science", "y2", "s1"), course("2", "Maths", "y2", "s1"), course("3", "English", "y2", "s2"), course("4", "Legacy course", null, null)],
    sessions, semesters,
  );
  it("puts the active session first and unassigned (legacy) subjects last", () => {
    expect(groups.map((g) => g.session?.name ?? "Unassigned")).toEqual(["2026-2027", "Unassigned"]);
  });
  it("groups by semester and sorts subjects alphabetically", () => {
    expect(groups[0].semesters.map((s) => s.semester?.name)).toEqual(["Semester 1", "Semester 2"]);
    expect(groups[0].semesters[0].courses.map((c) => c.title)).toEqual(["Maths", "Science"]);
  });
  it("keeps pre-existing courses visible", () => {
    expect(groups[1].semesters[0].courses.map((c) => c.title)).toEqual(["Legacy course"]);
  });
});
