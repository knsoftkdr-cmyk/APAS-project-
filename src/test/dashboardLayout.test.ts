import { describe, expect, it } from "vitest";
import {
  emptyLayout, isCustomized, isLayout, moveWidget, reorderAvailable, resolveLayout, setWidgetHidden, toLayout, type WidgetDef,
} from "@/lib/dashboardLayout";

const defs: WidgetDef[] = [
  { id: "stats", title: "Stats", canHide: false },
  { id: "risk", title: "Risk", available: false },
  { id: "about", title: "About" },
  { id: "tools", title: "Tools" },
];
const ids = (l: { id: string }[]) => l.map((w) => w.id);

describe("resolveLayout", () => {
  it("uses the default order with nothing saved", () => {
    expect(ids(resolveLayout(defs, null))).toEqual(["stats", "risk", "about", "tools"]);
  });
  it("applies a saved order and hidden list", () => {
    const l = resolveLayout(defs, { v: 1, updatedAt: 1, order: ["tools", "stats", "risk", "about"], hidden: ["about"] });
    expect(ids(l)).toEqual(["tools", "stats", "risk", "about"]);
    expect(l.find((w) => w.id === "about")!.hidden).toBe(true);
  });
  it("drops removed widgets and ignores duplicates", () => {
    const l = resolveLayout(defs, { v: 1, updatedAt: 1, order: ["gone", "tools", "tools", "stats"], hidden: ["gone"] });
    expect(ids(l)).toEqual(["tools", "stats", "risk", "about"]);
  });
  it("places a widget added in a later release after its default predecessor", () => {
    const newer: WidgetDef[] = [...defs.slice(0, 3), { id: "news", title: "News" }, defs[3]];
    const l = resolveLayout(newer, { v: 1, updatedAt: 1, order: ["tools", "stats", "risk", "about"], hidden: [] });
    expect(ids(l)).toEqual(["tools", "stats", "risk", "about", "news"]);
  });
  it("can never hide a widget marked canHide:false, whatever is saved", () => {
    const l = resolveLayout(defs, { v: 1, updatedAt: 1, order: [], hidden: ["stats", "tools"] });
    expect(l.find((w) => w.id === "stats")!.hidden).toBe(false);
    expect(l.find((w) => w.id === "tools")!.hidden).toBe(true);
  });
});

describe("editing", () => {
  const base = resolveLayout(defs, null);
  it("moves among available widgets only, skipping unavailable ones", () => {
    const moved = moveWidget(base, "about", -1); // 'risk' is unavailable, so it swaps with 'stats'
    expect(ids(moved)).toEqual(["about", "risk", "stats", "tools"]);
  });
  it("does nothing at the ends", () => {
    expect(moveWidget(base, "stats", -1)).toBe(base);
    expect(moveWidget(base, "tools", 1)).toBe(base);
  });
  it("applies a drag-and-drop order to available widgets and keeps unavailable ones in place", () => {
    const r = reorderAvailable(base, ["tools", "about", "stats"]);
    expect(ids(r)).toEqual(["tools", "risk", "about", "stats"]);
  });
  it("toggles visibility but refuses for locked widgets", () => {
    expect(setWidgetHidden(base, "tools", true).find((w) => w.id === "tools")!.hidden).toBe(true);
    expect(setWidgetHidden(base, "stats", true).find((w) => w.id === "stats")!.hidden).toBe(false);
  });
  it("round-trips through toLayout and detects customization", () => {
    expect(isCustomized(defs, null)).toBe(false);
    expect(isCustomized(defs, emptyLayout())).toBe(false);
    const l = toLayout(setWidgetHidden(base, "about", true), 5);
    expect(isCustomized(defs, l)).toBe(true);
    expect(isCustomized(defs, toLayout(base, 9))).toBe(false);
  });
  it("validates stored data", () => {
    expect(isLayout({ v: 1, updatedAt: 1, order: ["a"], hidden: [] })).toBe(true);
    expect(isLayout({ v: 1, updatedAt: 1, order: [1], hidden: [] })).toBe(false);
    expect(isLayout(null)).toBe(false);
    expect(isLayout("x")).toBe(false);
  });
});
