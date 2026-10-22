import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TOUR_BY_ROLE, tourRoleFor, type TourRole } from "@/components/onboarding/tourSteps";
import { startProductTour } from "@/components/onboarding/tourEvents";

// ── mocks: auth, the extended-profile query, and the supabase client (so nothing touches a real database) ──
const auth: { user: { id: string } | null; profile: { role: string } | null } = { user: null, profile: null };
let ext: Record<string, unknown> | null = null;
const saved: { values: unknown[]; filters: [string, unknown][] } = { values: [], filters: [] };
let saveError: { message: string } | null = null;

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useProfileCompletion", () => ({ useStudentProfile: () => ({ data: ext }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      update: (values: unknown) => {
        saved.values.push({ table, values });
        return {
          eq: async (col: string, val: unknown) => {
            saved.filters.push([col, val]);
            return { error: saveError };
          },
        };
      },
    }),
  },
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

import { ProductTour } from "@/components/onboarding/ProductTour";

// ── a fake page that contains every target a role's tour mentions ──
function mountPage(role: TourRole, omit: string[] = [], hidden: string[] = []) {
  const host = document.createElement("div");
  for (const s of TOUR_BY_ROLE[role]) {
    if (!s.target || omit.includes(s.id)) continue;
    const el = document.createElement("div");
    const nav = s.target.match(/data-tour-nav="([^"]+)"/);
    const tag = s.target.match(/data-tour="([^"]+)"/);
    if (nav) el.setAttribute("data-tour-nav", nav[1]);
    if (tag) el.setAttribute("data-tour", tag[1]);
    if (hidden.includes(s.id)) el.setAttribute("data-test-hidden", "1");
    host.appendChild(el);
  }
  // the sidebar must exist for the tour to start; make sure at least one nav marker is there
  if (!host.querySelector("[data-tour-nav]")) {
    const el = document.createElement("div");
    el.setAttribute("data-tour-nav", "/settings");
    host.appendChild(el);
  }
  document.body.appendChild(host);
  return host;
}

const ROLE_SAMPLES: { role: string; tour: TourRole }[] = [
  { role: "student", tour: "student" },
  { role: "teacher", tour: "teacher" },
  { role: "parent", tour: "parent" },
  { role: "principal", tour: "school_admin" },
  { role: "school_admin", tour: "school_admin" },
  { role: "admin", tour: "school_admin" },
  { role: "knsoft_admin", tour: "platform_admin" },
];

function renderTour(onNeedSidebar?: (o: boolean) => void) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ProductTour onNeedSidebar={onNeedSidebar} />
    </QueryClientProvider>
  );
}

const setUser = (role: string, extra: Record<string, unknown> = {}) => {
  auth.user = { id: `user-${role}` };
  auth.profile = { role };
  ext = { tour_completed: false, onboarding_completed: true, gender: "male", class_grade: "5", ...extra };
};

const stepCounter = () => screen.getByText(/^Step \d+ of \d+$/).textContent!;
const total = () => Number(stepCounter().match(/of (\d+)/)![1]);

// jsdom has no layout. Give every element a size, except ones the test marks as hidden (like display: none).
const realRect = Element.prototype.getBoundingClientRect;
const scrollSpy = vi.fn();
beforeEach(() => {
  scrollSpy.mockReset();
  Element.prototype.scrollIntoView = scrollSpy;
  Element.prototype.getBoundingClientRect = function () {
    const hiddenEl = (this as Element).hasAttribute("data-test-hidden");
    const w = hiddenEl ? 0 : 120, h = hiddenEl ? 0 : 36;
    return { x: 20, y: 20, top: 20, left: 20, right: 20 + w, bottom: 20 + h, width: w, height: h, toJSON: () => ({}) } as DOMRect;
  };
  saved.values = [];
  saved.filters = [];
  saveError = null;
  toastError.mockReset();
  sessionStorage.clear();
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true, writable: true });
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  cleanup();
  document.body.innerHTML = "";
});

const WAIT = { timeout: 4000 };

describe.each(ROLE_SAMPLES)("first login as $role", ({ role, tour }) => {
  it("shows that role's tour automatically, walks Next/Back, and Finish saves completion for this user only", async () => {
    setUser(role);
    mountPage(tour);
    renderTour();

    await screen.findByRole("dialog", {}, WAIT);
    expect(screen.getByText("Welcome to APAS")).toBeTruthy();
    expect(stepCounter()).toMatch(/^Step 1 of /);
    expect((screen.getByRole("button", { name: /back/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(total()).toBe(TOUR_BY_ROLE[tour].length); // every target is on the page, so nothing was dropped

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(stepCounter()).toMatch(/^Step 2 of /);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(stepCounter()).toMatch(/^Step 1 of /);

    // run to the end
    for (let i = 1; i < total(); i++) fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(stepCounter()).toBe(`Step ${total()} of ${total()}`);
    expect(screen.getByText("You are all set")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^next/i })).toBeNull();
    expect(saved.values).toHaveLength(0); // nothing saved until the user finishes

    fireEvent.click(screen.getByRole("button", { name: /finish/i }));
    await waitFor(() => expect(saved.values).toHaveLength(1));
    expect(saved.values[0]).toEqual({ table: "profiles", values: { tour_completed: true } });
    expect(saved.filters).toEqual([["id", `user-${role}`]]); // only the signed-in user's own row
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Skip also saves completion so it does not repeat", async () => {
    setUser(role);
    mountPage(tour);
    renderTour();
    await screen.findByRole("dialog", {}, WAIT);
    fireEvent.click(screen.getAllByRole("button", { name: /^skip/i })[0]);
    await waitFor(() => expect(saved.values).toHaveLength(1));
    expect(saved.values[0]).toEqual({ table: "profiles", values: { tour_completed: true } });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("who sees the tour", () => {
  it("does not auto-start once completed (the next login)", async () => {
    setUser("teacher", { tour_completed: true });
    mountPage("teacher");
    renderTour();
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(saved.values).toHaveLength(0);
  });

  it.each(["hod", "driver"])("%s has no tour", async (role) => {
    setUser(role);
    mountPage("teacher");
    renderTour();
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); });
    expect(screen.queryByRole("dialog")).toBeNull();
    startProductTour();
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a student waits for the profile setup dialogs to finish first", async () => {
    setUser("student", { onboarding_completed: false, gender: null, class_grade: null });
    mountPage("student");
    renderTour();
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not run when signed out", async () => {
    auth.user = null; auth.profile = null; ext = null;
    mountPage("teacher");
    renderTour();
    await act(async () => { await new Promise((r) => setTimeout(r, 1300)); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("restart (Take a tour again)", () => {
  it("replays for a user who already finished, and saves nothing", async () => {
    setUser("parent", { tour_completed: true });
    mountPage("parent");
    renderTour();
    startProductTour();
    await screen.findByRole("dialog", {}, WAIT);
    expect(stepCounter()).toMatch(/^Step 1 of /);
    fireEvent.click(screen.getAllByRole("button", { name: /^skip/i })[0]);
    await act(async () => { await Promise.resolve(); });
    expect(saved.values).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("authorization: steps for things that are not on screen are dropped", () => {
  it("a teacher whose school disabled Attendance and Requests never sees those steps", async () => {
    setUser("teacher");
    mountPage("teacher", ["nav-attendance", "nav-requests"]);
    renderTour();
    await screen.findByRole("dialog", {}, WAIT);
    expect(total()).toBe(TOUR_BY_ROLE.teacher.length - 2);
    for (let i = 1; i < total(); i++) {
      expect(screen.queryByText("Attendance", { selector: "h3" })).toBeNull();
      expect(screen.queryByText("Requests", { selector: "h3" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /next|finish/i }));
    }
  });

  it("the school-admin tour on a principal's page (no School Admin item) skips the super-admin steps", async () => {
    setUser("principal");
    mountPage("school_admin", ["nav-super-admin", "admin-tabs"]);
    renderTour();
    await screen.findByRole("dialog", {}, WAIT);
    const titles: string[] = [];
    for (let i = 0; i < total(); i++) {
      titles.push(screen.getByRole("heading", { level: 3 }).textContent!);
      if (i < total() - 1) fireEvent.click(screen.getByRole("button", { name: /next/i }));
    }
    expect(titles).not.toContain("School Admin");
    expect(titles).not.toContain("School administration");
  });
});

describe("scrolling the target into view", () => {
  it("centers sidebar rows (so long sidebars scroll to them) and only nudges other targets", async () => {
    setUser("teacher");
    mountPage("teacher");
    renderTour();
    await screen.findByRole("dialog", {}, WAIT);
    const steps = TOUR_BY_ROLE.teacher;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].target) {
        const isNav = steps[i].target!.includes("data-tour-nav");
        await waitFor(() =>
          expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: isNav ? "center" : "nearest" }))
        );
      }
      scrollSpy.mockClear();
      if (i < steps.length - 1) fireEvent.click(screen.getByRole("button", { name: /next/i }));
    }
  });
});

describe("hidden targets", () => {
  it("a control that is in the page but not displayed (e.g. desktop-only) is not highlighted or described", async () => {
    setUser("student");
    mountPage("student", [], ["header-search"]);
    renderTour();
    await screen.findByRole("dialog", {}, WAIT);
    expect(total()).toBe(TOUR_BY_ROLE.student.length - 1);
    for (let i = 0; i < total(); i++) {
      expect(screen.getByRole("heading", { level: 3 }).textContent).not.toBe("Search");
      if (i < total() - 1) fireEvent.click(screen.getByRole("button", { name: /next/i }));
    }
  });
});

describe("saving problems", () => {
  it("tells the user, and does not reopen in the same session", async () => {
    setUser("teacher");
    saveError = { message: "boom" };
    mountPage("teacher");
    const { unmount } = renderTour();
    await screen.findByRole("dialog", {}, WAIT);
    fireEvent.click(screen.getAllByRole("button", { name: /^skip/i })[0]);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    unmount();

    renderTour(); // e.g. navigating to another page: ext still says not completed
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("phones", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true, writable: true });
  });

  it("opens the sidebar drawer for sidebar steps and closes it for header steps and when done", async () => {
    setUser("teacher");
    mountPage("teacher");
    const onNeed = vi.fn();
    renderTour(onNeed);
    await screen.findByRole("dialog", {}, WAIT);

    const steps = TOUR_BY_ROLE.teacher;
    for (let i = 0; i < steps.length; i++) {
      const wantsDrawer = !!steps[i].target?.includes("data-tour-nav");
      await waitFor(() => expect(onNeed).toHaveBeenLastCalledWith(wantsDrawer), { timeout: 1000 });
      if (i < steps.length - 1) fireEvent.click(screen.getByRole("button", { name: /next/i }));
    }
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));
    await waitFor(() => expect(onNeed).toHaveBeenLastCalledWith(false));
  });

  it("the card fits inside a 375px screen", async () => {
    setUser("student");
    mountPage("student");
    renderTour();
    const dialog = await screen.findByRole("dialog", {}, WAIT);
    const card = dialog.querySelector<HTMLElement>(".shadow-2xl")!;
    expect(parseFloat(card.style.width)).toBeLessThanOrEqual(375 - 24);
    expect(parseFloat(card.style.left)).toBeGreaterThanOrEqual(0);
  });

  it("desktop does not touch the drawer", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true, writable: true });
    setUser("teacher");
    mountPage("teacher");
    const onNeed = vi.fn();
    renderTour(onNeed);
    await screen.findByRole("dialog", {}, WAIT);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onNeed.mock.calls.every(([open]) => open === false)).toBe(true);
  });
});

describe("keyboard", () => {
  it("arrow keys move and Escape skips", async () => {
    setUser("student");
    mountPage("student");
    renderTour();
    await screen.findByRole("dialog", {}, WAIT);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(stepCounter()).toMatch(/^Step 2 of /);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(stepCounter()).toMatch(/^Step 1 of /);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(saved.values).toHaveLength(1));
  });
});

// sanity: every role in the sample list maps to the tour the test expects
describe("role mapping used by these tests", () => {
  it.each(ROLE_SAMPLES)("$role -> $tour", ({ role, tour }) => expect(tourRoleFor(role)).toBe(tour));
});
