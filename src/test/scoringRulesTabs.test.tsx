import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("@/components/dailyreview/ScoringSettings", () => ({
  AdaptiveTestScoringSettings: () => <div data-testid="adaptive-scoring-settings">adaptive rules</div>,
  ScoringSettings: () => <div data-testid="scoring-settings">daily review rules</div>,
}));

import { ScoringRulesTabs, type ScoringRulesTab } from "@/components/dailyreview/ScoringRulesTabs";

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;
const mount = (path: string, active: ScoringRulesTab) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/adaptive-test" element={<><ScoringRulesTabs active="adaptive" /><Where /></>} />
        <Route path="/daily-review" element={<><ScoringRulesTabs active="daily" /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  ) && active;

describe("ScoringRulesTabs (principal: one page, two tabs)", () => {
  it("opens on the Adaptive Test tab with its rules, and nothing from Daily Review", () => {
    mount("/adaptive-test", "adaptive");
    expect(screen.getByRole("tab", { name: "Adaptive Test" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Daily Review" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("adaptive-scoring-settings")).toBeTruthy();
    expect(screen.queryByTestId("scoring-settings")).toBeNull();
  });
  it("opens on the Daily Review tab with its rules", () => {
    mount("/daily-review", "daily");
    expect(screen.getByRole("tab", { name: "Daily Review" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("scoring-settings")).toBeTruthy();
    expect(screen.queryByTestId("adaptive-scoring-settings")).toBeNull();
  });
  it("clicking a tab switches the page AND the URL, both ways (so back button and bookmarks work)", () => {
    mount("/adaptive-test", "adaptive");
    fireEvent.click(screen.getByRole("tab", { name: "Daily Review" }));
    expect(screen.getByTestId("where").textContent).toBe("/daily-review");
    expect(screen.getByTestId("scoring-settings")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Adaptive Test" }));
    expect(screen.getByTestId("where").textContent).toBe("/adaptive-test");
    expect(screen.getByTestId("adaptive-scoring-settings")).toBeTruthy();
  });
  it("clicking the tab you are already on does nothing", () => {
    mount("/adaptive-test", "adaptive");
    fireEvent.click(screen.getByRole("tab", { name: "Adaptive Test" }));
    expect(screen.getByTestId("where").textContent).toBe("/adaptive-test");
  });
});
