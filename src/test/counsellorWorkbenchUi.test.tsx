// Counsellor Workbench inside the existing Admissions page: views, SLA indicators, quick actions.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";

const NOW = Date.parse("2026-11-16T10:00:00Z");
const min = (m: number) => new Date(NOW + m * 60000).toISOString();
const clk = (dueIn: number, soon = 10, kind?: string) => ({ due_at: min(dueIn), due_soon_at: min(dueIn - soon), state: "on_track", kind });
const mk = (o: any) => ({
  applicant_id: "x", full_name: "X", parent_name: "Parent", parent_phone: "9876543210", parent_email: null, status: "under_review", source: "walk_in", grade: "Grade 5",
  created_at: min(-600), meeting_notes: null, assigned_to: "me", assigned_to_name: "Me", assigned_at: min(-600), assignment_method: "auto", score: 50, category: "warm",
  first_contact_at: null, last_contact_at: null, contact_count: 0, note_count: 0, last_event_type: null, last_event_at: null, next_follow_up_at: null, is_new: false,
  first_response: null, follow_up: null, sla_state: null, follow_up_today: false, follow_up_pending: false, ...o,
});
const LEADS = [
  mk({ applicant_id: "n1", full_name: "Newbie New", is_new: true, category: "hot", score: 88, first_response: clk(25) }),
  mk({ applicant_id: "d1", full_name: "Soon Sally", category: "warm", contact_count: 1, last_contact_at: min(-120), follow_up: clk(6), follow_up_today: true, next_follow_up_at: min(6) }),
  mk({ applicant_id: "o1", full_name: "Late Larry", category: "cold", score: 22, contact_count: 2, follow_up: clk(-95), follow_up_today: true, last_contact_at: min(-3000) }),
  mk({ applicant_id: "p1", full_name: "Pending Priya", category: "warm", contact_count: 1, follow_up: clk(60 * 50), follow_up_pending: true, next_follow_up_at: min(60 * 50) }),
];

const api = vi.hoisted(() => ({
  state: { leads: [] as any[], error: null as string | null, loading: false, skewMs: 0 },
  refetch: vi.fn(), useWorkbench: vi.fn(), scheduleFollowUp: vi.fn(async () => ({ error: null })),
  logInteraction: vi.fn(async () => ({ error: null })), update: vi.fn(),
}));
vi.mock("@/hooks/useAdmissionAssignment", () => ({
  ASSIGNMENT_ADMIN_ROLES: ["principal", "admin", "school_admin", "knsoft_admin"],
  useWorkbench: (opts: any) => { api.useWorkbench(opts); return { data: null, leads: api.state.leads, loading: api.state.loading, error: api.state.error, skewMs: api.state.skewMs, refetch: api.refetch }; },
  useAssignmentHistory: () => ({ rows: [{ id: "h1", created_at: min(-600), method: "auto", reason: null, from: null, to: "Me", by: null }], loading: false, refetch: vi.fn() }),
  scheduleFollowUp: api.scheduleFollowUp, assignLead: vi.fn(),
}));
vi.mock("@/hooks/useLeadScores", () => ({ logInteraction: api.logInteraction }));
vi.mock("@/hooks/useAdmissionIntegrations", () => ({
  useLeadTimeline: () => ({ events: [
    { id: "e1", applicant_id: "d1", event_type: "call_answered", detail: { note: "Wants a visit" }, created_at: min(-120), created_by: "me" },
    { id: "e2", applicant_id: "d1", event_type: "assigned", detail: { method: "auto" }, created_at: min(-600), created_by: null }], loading: false, refetch: vi.fn() }),
}));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }), toast: toastSpy }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { id: "me", school_id: "s1", role: "teacher" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(() => ({ update: (p: any) => { api.update(p); return { eq: async () => ({ error: null }) }; } })) } }));

import { CounsellorWorkbench } from "@/components/admission/CounsellorWorkbench";
import { chooseOption, polyfillRadix } from "./radixSelectHelper";
polyfillRadix();

const tab = (name: RegExp) => screen.getByRole("tab", { name });
const names = () => screen.queryAllByTestId("wb-lead").map((li) => within(li).getByRole("heading").textContent);

describe("Counsellor Workbench", () => {
  beforeEach(() => {
    vi.clearAllMocks(); api.state = { leads: LEADS, error: null, loading: false, skewMs: 0 };
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it("only ever asks for the caller's own leads", () => {
    render(<CounsellorWorkbench />);
    expect(api.useWorkbench).toHaveBeenCalledWith(expect.objectContaining({ scope: "mine" }));
  });

  it("offers every required view with a live count", () => {
    render(<CounsellorWorkbench />);
    const counts: Record<string, string> = { "My Assigned Leads": "4", "New Leads": "1", "Hot": "1", "Warm": "2", "Cold": "1", "Today's Follow-ups": "2", "Pending Follow-ups": "1", "Overdue": "1" };
    for (const [label, n] of Object.entries(counts)) expect(tab(new RegExp(`^${label.replace("'", "'")}\\s*${n}$`)).textContent).toContain(n);
  });

  it("filters the list by view", () => {
    render(<CounsellorWorkbench />);
    expect(names()).toHaveLength(4);
    fireEvent.click(tab(/^New Leads/)); expect(names()).toEqual(["Newbie New"]);
    fireEvent.click(tab(/^Hot/)); expect(names()).toEqual(["Newbie New"]);
    fireEvent.click(tab(/^Cold/)); expect(names()).toEqual(["Late Larry"]);
    fireEvent.click(tab(/^Today/)); expect(names().sort()).toEqual(["Late Larry", "Soon Sally"]);
    fireEvent.click(tab(/^Pending/)); expect(names()).toEqual(["Pending Priya"]);
    fireEvent.click(tab(/^Overdue/)); expect(names()).toEqual(["Late Larry"]);
  });

  it("shows On Track / Due Soon / Overdue with time left, using words and not only colour", () => {
    render(<CounsellorWorkbench />);
    const card = (n: string) => screen.getAllByTestId("wb-lead").find((li) => within(li).getByRole("heading").textContent === n)!;
    const fr = within(card("Newbie New")).getByTestId("sla-first_response");
    expect(fr.dataset.state).toBe("on_track"); expect(fr.textContent).toContain("On Track"); expect(fr.textContent).toContain("25m left");
    const soon = within(card("Soon Sally")).getByTestId("sla-follow_up");
    expect(soon.dataset.state).toBe("due_soon"); expect(soon.textContent).toContain("Due Soon"); expect(soon.textContent).toContain("6m left");
    const late = within(card("Late Larry")).getByTestId("sla-follow_up");
    expect(late.dataset.state).toBe("overdue"); expect(late.textContent).toContain("Overdue"); expect(late.textContent).toContain("Overdue by 1h 35m");
  });

  it("uses the server's clock: a device set an hour fast neither hides nor invents an overdue lead", () => {
    const fr = () => within(screen.getAllByTestId("wb-lead").find((x) => within(x).getByRole("heading").textContent === "Newbie New")!).getByTestId("sla-first_response");
    vi.setSystemTime(NOW + 3_600_000);                    // the device says 11:00 while the server says 10:00
    api.state.skewMs = 0;                                 // control: ignoring the server, the 25-minute deadline looks long gone
    const control = render(<CounsellorWorkbench />);
    expect(fr().dataset.state).toBe("overdue"); expect(fr().textContent).toContain("Overdue by 35m");
    control.unmount();
    api.state.skewMs = -3_600_000;                        // what the hook measures from the server's reported time
    render(<CounsellorWorkbench />);
    expect(fr().dataset.state).toBe("on_track"); expect(fr().textContent).toContain("25m left");
  });

  it("shows the lead's score + temperature, next follow-up and last contact", () => {
    render(<CounsellorWorkbench />);
    const li = screen.getAllByTestId("wb-lead").find((x) => within(x).getByRole("heading").textContent === "Newbie New")!;
    expect(within(li).getByLabelText("Lead score 88")).toBeTruthy(); expect(within(li).getByText("Hot")).toBeTruthy();
    expect(within(li).getByText("Not scheduled")).toBeTruthy(); expect(within(li).getByText("None yet")).toBeTruthy();
  });

  it("quick call is a tel: link to the parent", () => {
    render(<CounsellorWorkbench />);
    const link = screen.getAllByRole("link", { name: /^Call Newbie New/ })[0] as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("tel:9876543210");
  });

  it("records an interaction through the existing logging path, attributed to the signed-in user", async () => {
    render(<CounsellorWorkbench />);
    const li = screen.getAllByTestId("wb-lead")[0];
    fireEvent.click(within(li).getByRole("button", { name: /Record interaction/ }));
    fireEvent.change(await screen.findByLabelText(/Notes \(optional\)/), { target: { value: "Spoke to mother" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.logInteraction).toHaveBeenCalledWith({ schoolId: "s1", applicantId: "n1", type: "call_answered", note: "Spoke to mother", userId: "me" }));
    await waitFor(() => expect(api.refetch).toHaveBeenCalled());
  });

  it("surfaces a database error when an interaction cannot be saved", async () => {
    api.logInteraction.mockResolvedValueOnce({ error: "row-level security" } as any);
    render(<CounsellorWorkbench />);
    fireEvent.click(within(screen.getAllByTestId("wb-lead")[0]).getByRole("button", { name: /Record interaction/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not save", variant: "destructive" })));
  });

  it("schedules a follow-up only for a future time", async () => {
    render(<CounsellorWorkbench />);
    fireEvent.click(within(screen.getAllByTestId("wb-lead")[0]).getByRole("button", { name: /Schedule follow-up/ }));
    const input = await screen.findByLabelText("Next follow-up");
    const submit = screen.getByRole("button", { name: "Schedule" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "2026-11-10T09:00" } });           // in the past
    expect(submit.disabled).toBe(true); expect(screen.getByText(/Choose a time in the future/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "2026-11-20T09:00" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(api.scheduleFollowUp).toHaveBeenCalledWith(expect.objectContaining({ schoolId: "s1", applicantId: "n1", userId: "me", dueAtIso: new Date("2026-11-20T09:00").toISOString() })));
  });

  it("updates the lead status on the existing applicants table (stamped with who decided and when)", async () => {
    render(<CounsellorWorkbench />);
    fireEvent.click(within(screen.getAllByTestId("wb-lead")[0]).getByRole("button", { name: /Update status/ }));
    const submit = await screen.findByRole("button", { name: "Update" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);                                         // nothing chosen yet
    await chooseOption(screen.getByLabelText("Status"), "Shortlisted");
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ status: "shortlisted", decided_by: "me", decision_notes: null })));
    await waitFor(() => expect(api.refetch).toHaveBeenCalled());
  });

  it("warns that closing a lead stops its SLA clocks", async () => {
    render(<CounsellorWorkbench />);
    fireEvent.click(within(screen.getAllByTestId("wb-lead")[0]).getByRole("button", { name: /Update status/ }));
    await chooseOption(await screen.findByLabelText("Status"), "Rejected");
    expect(await screen.findByText(/stops its SLA clocks/)).toBeTruthy();
  });

  it("opens lead details: contact, notes, contact history and assignment history", async () => {
    render(<CounsellorWorkbench />);
    const li = screen.getAllByTestId("wb-lead").find((x) => within(x).getByRole("heading").textContent === "Soon Sally")!;
    fireEvent.click(within(li).getByRole("button", { name: /Details/ }));
    expect(await screen.findByText("Contact history")).toBeTruthy();
    expect(screen.getByText(/Call answered — Wants a visit/)).toBeTruthy();
    expect(screen.getByText("Assignment history")).toBeTruthy();
    expect(screen.getByText(/Automatic · /)).toBeTruthy();            // the history row: how it was assigned and when
    expect(screen.getAllByText("Me").length).toBe(2);                 // owner line + history row
  });

  it("explains an empty view instead of showing a blank screen", () => {
    api.state.leads = [];
    render(<CounsellorWorkbench />);
    expect(screen.getByText("No leads are assigned to you right now.")).toBeTruthy();
    fireEvent.click(tab(/^Overdue/)); expect(screen.getByText(/Nothing overdue/)).toBeTruthy();
  });

  it("tells the user when the database update has not been applied, and shows real errors", () => {
    api.state.error = "not_installed"; const { unmount } = render(<CounsellorWorkbench />);
    expect(screen.getByText(/latest database update/)).toBeTruthy(); unmount();
    api.state.error = "Not allowed"; render(<CounsellorWorkbench />);
    expect(screen.getByRole("alert").textContent).toContain("Not allowed");
  });
});
