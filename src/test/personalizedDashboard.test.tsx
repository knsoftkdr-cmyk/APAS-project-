import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DashboardLayout } from "@/lib/dashboardLayout";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { school_id: "s1" } }) }));

const rows = new Map<string, DashboardLayout>();
let serverRow: DashboardLayout | null = null; // convenience view of the "t" dashboard row
let serverAvailable = true;
vi.mock("@/lib/dashboardLayoutStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dashboardLayoutStore")>("@/lib/dashboardLayoutStore");
  return {
    ...actual,
    fetchServerLayout: vi.fn(async (_u: string, k: string) => (serverAvailable ? { ok: true, layout: rows.get(k) ?? null } : { ok: false, reason: "unavailable" })),
    saveServerLayout: vi.fn(async (_u: string, k: string, l: DashboardLayout) => {
      if (!serverAvailable) return "unavailable";
      rows.set(k, l);
      serverRow = rows.get("t") ?? null;
      return "saved";
    }),
  };
});

import { PersonalizedDashboard, type DashboardWidget } from "@/components/dashboard/PersonalizedDashboard";
import { readLocalLayout } from "@/lib/dashboardLayoutStore";

const widgets: DashboardWidget[] = [
  { id: "stats", title: "Key numbers", canHide: false, render: () => <div>STATS-BODY</div> },
  { id: "risk", title: "At risk", available: false, render: () => <div>RISK-BODY</div> },
  { id: "about", title: "About", render: () => <div>ABOUT-BODY</div> },
  { id: "tools", title: "Tools", render: () => <div>TOOLS-BODY</div> },
];
const order = () => Array.from(document.querySelectorAll("[data-widget]")).map((e) => e.getAttribute("data-widget"));
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); rows.clear(); serverRow = null; serverAvailable = true; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("PersonalizedDashboard", () => {
  it("renders the default order and skips unavailable widgets", async () => {
    render(<PersonalizedDashboard dashboardKey="t" widgets={widgets} />);
    await flush();
    expect(order()).toEqual(["stats", "about", "tools"]);
    expect(screen.queryByText("RISK-BODY")).toBeNull();
  });

  it("reorders with the arrows, saves, and a reload restores the same order", async () => {
    const first = render(<PersonalizedDashboard dashboardKey="t" widgets={widgets} />);
    await flush();
    fireEvent.click(screen.getByTestId("customize-dashboard"));
    await flush();
    fireEvent.click(screen.getByLabelText("Move Tools up"));
    await flush();
    expect(order()).toEqual(["stats", "tools", "about"]);
    await flush(700);
    expect(serverRow?.order.slice(0, 4)).toEqual(["stats", "risk", "tools", "about"]);
    expect(screen.getByTestId("layout-status").textContent).toContain("Saved");

    first.unmount(); // "refresh"
    render(<PersonalizedDashboard dashboardKey="t" widgets={widgets} />);
    await flush();
    expect(order()).toEqual(["stats", "tools", "about"]);
  });

  it("hides and shows a section; the locked stats row cannot be hidden", async () => {
    render(<PersonalizedDashboard dashboardKey="t" widgets={widgets} />);
    await flush();
    fireEvent.click(screen.getByTestId("customize-dashboard"));
    await flush();
    const statsSwitch = screen.getByLabelText("Key numbers is always shown") as HTMLButtonElement;
    expect(statsSwitch.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Show About"));
    await flush();
    expect(order()).toEqual(["stats", "tools"]);
    expect(readLocalLayout("u1", "t")?.hidden).toContain("about");
    fireEvent.click(screen.getByLabelText("Show About"));
    await flush();
    expect(order()).toEqual(["stats", "about", "tools"]);
  });

  it("reset restores the default order and visibility", async () => {
    render(<PersonalizedDashboard dashboardKey="t" widgets={widgets} />);
    await flush();
    fireEvent.click(screen.getByTestId("customize-dashboard"));
    await flush();
    fireEvent.click(screen.getByLabelText("Move Tools up"));
    fireEvent.click(screen.getByLabelText("Show About"));
    await flush();
    expect(order()).toEqual(["stats", "tools"]);
    fireEvent.click(screen.getByText("Reset to default"));
    await flush();
    expect(order()).toEqual(["stats", "about", "tools"]);
  });

  it("a NEWER server layout wins over an older device copy", async () => {
    localStorage.setItem("apas.dashboard-layout.v1:u1:t", JSON.stringify({ v: 1, updatedAt: 100, order: ["stats", "risk", "about", "tools"], hidden: [] }));
    rows.set("t", { v: 1, updatedAt: 200, order: ["tools", "stats", "risk", "about"], hidden: [] });
    render(<PersonalizedDashboard dashboardKey="t" widgets={widgets} />);
    await flush();
    expect(order()).toEqual(["tools", "stats", "about"]);
  });

  it("a NEWER device layout is pushed to the server instead of being overwritten", async () => {
    localStorage.setItem("apas.dashboard-layout.v1:u1:t", JSON.stringify({ v: 1, updatedAt: 300, order: ["about", "stats", "risk", "tools"], hidden: [] }));
    rows.set("t", { v: 1, updatedAt: 200, order: ["tools", "stats", "risk", "about"], hidden: [] });
    render(<PersonalizedDashboard dashboardKey="t" widgets={widgets} />);
    await flush();
    expect(order()).toEqual(["about", "stats", "tools"]);
    expect(serverRow?.updatedAt).toBe(300);
  });

  it("works device-only when the server table is not deployed", async () => {
    serverAvailable = false;
    render(<PersonalizedDashboard dashboardKey="t" widgets={widgets} />);
    await flush();
    fireEvent.click(screen.getByTestId("customize-dashboard"));
    await flush();
    fireEvent.click(screen.getByLabelText("Move Tools up"));
    await flush(700);
    expect(order()).toEqual(["stats", "tools", "about"]);
    expect(screen.getByTestId("layout-status").textContent).toContain("Saved on this device");
    expect(within(document.body).getByTestId("widget-row-tools")).toBeTruthy();
  });

  it("different dashboards keep separate layouts", async () => {
    const a = render(<PersonalizedDashboard dashboardKey="a" widgets={widgets} />);
    await flush();
    fireEvent.click(screen.getByTestId("customize-dashboard"));
    await flush();
    fireEvent.click(screen.getByLabelText("Move Tools up"));
    await flush();
    a.unmount();
    render(<PersonalizedDashboard dashboardKey="b" widgets={widgets} />);
    await flush();
    expect(order()).toEqual(["stats", "about", "tools"]);
  });
});
