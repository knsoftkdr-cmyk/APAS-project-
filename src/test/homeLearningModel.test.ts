import { describe, it, expect } from "vitest";
import {
  AREA_ORDER, allBands, bandForGrade, groupTipsByArea, guidanceForClass, parseGrade,
} from "../lib/homeLearningModel";

describe("parseGrade", () => {
  it("reads plain and worded class numbers", () => {
    expect(parseGrade("5")).toBe(5);
    expect(parseGrade("Class 7")).toBe(7);
    expect(parseGrade("10th")).toBe(10);
    expect(parseGrade("Grade 12")).toBe(12);
    expect(parseGrade("  3rd  ")).toBe(3);
  });
  it("reads roman numerals", () => {
    expect(parseGrade("VIII")).toBe(8);
    expect(parseGrade("Class IX")).toBe(9);
    expect(parseGrade("X")).toBe(10);
  });
  it("reads early years labels", () => {
    expect(parseGrade("Nursery")).toBe(-2);
    expect(parseGrade("LKG")).toBe(-1);
    expect(parseGrade("UKG")).toBe(0);
  });
  it("returns null for empty, unknown or out-of-range labels", () => {
    expect(parseGrade(null)).toBeNull();
    expect(parseGrade(undefined)).toBeNull();
    expect(parseGrade("")).toBeNull();
    expect(parseGrade("Staff room")).toBeNull();
    expect(parseGrade("13")).toBeNull();
    expect(parseGrade("0")).toBeNull();
  });
});

describe("bandForGrade", () => {
  it("puts each class in the right band at the edges", () => {
    expect(bandForGrade(-2)).toBe("early_years");
    expect(bandForGrade(0)).toBe("early_years");
    expect(bandForGrade(1)).toBe("lower_primary");
    expect(bandForGrade(3)).toBe("lower_primary");
    expect(bandForGrade(4)).toBe("upper_primary");
    expect(bandForGrade(5)).toBe("upper_primary");
    expect(bandForGrade(6)).toBe("middle");
    expect(bandForGrade(8)).toBe("middle");
    expect(bandForGrade(9)).toBe("secondary");
    expect(bandForGrade(10)).toBe("secondary");
    expect(bandForGrade(11)).toBe("senior");
    expect(bandForGrade(12)).toBe("senior");
    expect(bandForGrade(null)).toBe("general");
  });
});

describe("guidanceForClass", () => {
  it("gives class-appropriate guidance and a readable label", () => {
    const g = guidanceForClass("Class 10");
    expect(g.band).toBe("secondary");
    expect(g.bandLabel).toBe("Secondary (classes 9 and 10)");
    expect(g.tips.some((t) => t.area === "exams")).toBe(true);
  });
  it("falls back to general guidance when the class is unreadable", () => {
    const g = guidanceForClass("???");
    expect(g.band).toBe("general");
    expect(g.tips.length).toBeGreaterThan(0);
  });
  it("returns copies, so changing the result does not change the built-in tips", () => {
    const first = guidanceForClass("5");
    first.tips[0].title = "changed";
    expect(guidanceForClass("5").tips[0].title).not.toBe("changed");
  });
});

describe("content quality", () => {
  it("every band has tips with unique ids, an action and a time", () => {
    const ids = new Set<string>();
    for (const band of allBands()) {
      const tips = guidanceForClass(band === "general" ? "?" : { early_years: "UKG", lower_primary: "2", upper_primary: "4", middle: "7", secondary: "9", senior: "11" }[band]).tips;
      expect(tips.length).toBeGreaterThanOrEqual(4);
      for (const t of tips) {
        expect(t.title.length).toBeGreaterThan(0);
        expect(t.action.length).toBeGreaterThan(0);
        expect(t.time.length).toBeGreaterThan(0);
        expect(ids.has(t.id)).toBe(false);
        ids.add(t.id);
      }
    }
  });
  it("only links to the parent appointment page", () => {
    for (const band of allBands()) {
      const classLabel = band === "general" ? "?" : { early_years: "UKG", lower_primary: "2", upper_primary: "4", middle: "7", secondary: "9", senior: "11" }[band];
      for (const t of guidanceForClass(classLabel).tips) if (t.link) expect(t.link.path).toBe("/appointments");
    }
  });
});

describe("groupTipsByArea", () => {
  it("groups in the fixed order and leaves out empty areas", () => {
    const groups = groupTipsByArea(guidanceForClass("7").tips);
    const areas = groups.map((g) => g.area);
    expect(areas).toEqual(AREA_ORDER.filter((a) => areas.includes(a)));
    expect(groups.every((g) => g.tips.length > 0)).toBe(true);
    expect(groups.reduce((n, g) => n + g.tips.length, 0)).toBe(guidanceForClass("7").tips.length);
  });
});

describe("home learning wiring", () => {
  it("is a parent-only route with a parent sidebar link that parents are allowed to see", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync("src/App.tsx", "utf8");
    const line = app.split("\n").find((l) => l.includes('path="/home-learning"')) ?? "";
    expect(line.includes("ProtectedRoute")).toBe(true);
    expect(line.includes('allowedRoles={["parent"]}')).toBe(true);
    const sidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
    expect(sidebar.includes('path: "/home-learning"')).toBe(true);
    expect(/parentModules = \[[^\]]*"Home Learning"/.test(sidebar)).toBe(true);
  });
});
