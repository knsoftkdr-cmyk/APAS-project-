import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS, filterItems, hoursLabel, lockedReason, ownerActions, reasonOk, reasonRequired, stageProgress,
  summarizeStatuses, type WorkflowItem,
} from "@/lib/approvalWorkflow";

const item = (o: Partial<WorkflowItem>): WorkflowItem => ({
  kind: "chapter", id: "1", title: "Intro", status: "draft", courseId: "c1", subject: "Maths", module: "Algebra", chapter: "Intro", topic: null, ...o,
});

describe("owner actions", () => {
  it("when the workflow is off nothing is gated (backward compatible)", () => {
    expect(ownerActions("draft", false)).toMatchObject({ submit: false, edit: true });
    expect(lockedReason("published", false)).toBeNull();
  });
  it("teachers can edit/submit only drafts and requested changes", () => {
    for (const s of ["draft", "changes_requested"] as const) expect(ownerActions(s, true)).toMatchObject({ submit: true, edit: true });
    for (const s of ["pending_review", "approved", "published", "rejected", "archived"] as const) {
      expect(ownerActions(s, true).edit).toBe(false);
      expect(ownerActions(s, true).submit).toBe(false);
      expect(lockedReason(s, true)).toBeTruthy();
    }
  });
  it("published and approved content is revised via reopen, never edited in place", () => {
    expect(ownerActions("published", true).reopen).toBe(true);
    expect(ownerActions("pending_review", true).reopen).toBe(false);
  });
});

describe("dashboard summaries and filters", () => {
  const items = [item({ id: "1" }), item({ id: "2", status: "pending_review", title: "Linear equations", module: "Geometry" }),
    item({ id: "3", status: "published", kind: "material", courseId: "c2", subject: "Science" })];
  it("counts every status", () => {
    expect(summarizeStatuses(items)).toMatchObject({ draft: 1, pending_review: 1, published: 1, approved: 0, rejected: 0 });
  });
  it("filters by subject, module, kind, status and text", () => {
    expect(filterItems(items, { ...EMPTY_FILTERS, subject: "c2" }).map((i) => i.id)).toEqual(["3"]);
    expect(filterItems(items, { ...EMPTY_FILTERS, module: "Geometry" }).map((i) => i.id)).toEqual(["2"]);
    expect(filterItems(items, { ...EMPTY_FILTERS, kind: "material" }).map((i) => i.id)).toEqual(["3"]);
    expect(filterItems(items, { ...EMPTY_FILTERS, status: "draft" }).map((i) => i.id)).toEqual(["1"]);
    expect(filterItems(items, { ...EMPTY_FILTERS, search: "LINEAR" }).map((i) => i.id)).toEqual(["2"]);
  });
});

describe("approval stepper", () => {
  const stages = [{ name: "Coordinator" }, { name: "Principal" }];
  it("shows the current stage and a final publish step", () => {
    const s = stageProgress("pending_review", 2, stages);
    expect(s.map((x) => x.state)).toEqual(["done", "current", "todo"]);
    expect(s.at(-1)!.name).toBe("Publish");
  });
  it("approved waits for publish; published is all done", () => {
    expect(stageProgress("approved", 2, stages).map((x) => x.state)).toEqual(["done", "done", "current"]);
    expect(stageProgress("published", 2, stages).every((x) => x.state === "done")).toBe(true);
  });
  it("works with no configured stages", () => {
    expect(stageProgress("pending_review", 1, [])[0]).toEqual({ name: "Review", state: "current" });
  });
});

describe("reasons and labels", () => {
  it("requires a meaningful reason except for approve", () => {
    expect(reasonRequired("reject")).toBe(true);
    expect(reasonRequired("request_changes")).toBe(true);
    expect(reasonRequired("approve")).toBe(false);
    expect(reasonOk("   no ")).toBe(false);
    expect(reasonOk("Needs more examples")).toBe(true);
  });
  it("formats review time", () => {
    expect(hoursLabel(null)).toBe("-");
    expect(hoursLabel(0.2)).toBe("<1 h");
    expect(hoursLabel(5.4)).toBe("5 h");
    expect(hoursLabel(72)).toBe("3 d");
  });
});
