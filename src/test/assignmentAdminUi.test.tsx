// Admin dashboard for assignment + SLA, and the integration into the EXISTING Admissions dashboard (no new menu / module).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";

const NOW = Date.parse("2026-11-16T10:00:00Z");
const min = (m: number) => new Date(NOW + m * 60000).toISOString();
const DASH = {
  from: min(-43200), to: min(0), unassigned: 2, open_leads: 14, overdue_first_response: 3, overdue_follow_up: 1, due_soon_first_response: 1, due_soon_follow_up: 2,
  sla: { fr_total: 10, fr_met: 8, fr_avg_minutes: 18.5, fu_total: 4, fu_met: 1 },
  counsellors: [
    { profile_id: "c1", name: "Asha Rao", is_active: true, is_available: true, unavailable_until: null, max_open_leads: 20, accepting: true, open_leads: 9, total_leads: 20, converted: 5, conversion_pct: 25, overdue_now: 2, due_soon_now: 1, fr_total: 6, fr_met: 5, fr_avg_minutes: 12, fu_total: 3, fu_met: 1 },
    { profile_id: "c2", name: "Vikram Das", is_active: true, is_available: false, unavailable_until: min(60 * 24), max_open_leads: null, accepting: false, open_leads: 5, total_leads: 8, converted: 0, conversion_pct: 0, overdue_now: 0, due_soon_now: 0, fr_total: 0, fr_met: 0, fr_avg_minutes: null, fu_total: 0, fu_met: 0 },
  ],
  recent_assignments: [{ at: min(-5), applicant_id: "a1", lead: "Kiran K", method: "manual", reason: "Sibling known", to: "Asha Rao", from: "Vikram Das", by: "Principal P" },
                       { at: min(-9), applicant_id: "a2", lead: "Maya M", method: "auto", reason: null, to: "Vikram Das", from: null, by: null }],
};
const STAFF = [
  { profile_id: "c1", name: "Asha Rao", role: "teacher", is_counsellor: true, is_active: true, is_available: true, unavailable_until: null, max_open_leads: 20, accepting: true },
  { profile_id: "c2", name: "Vikram Das", role: "teacher", is_counsellor: true, is_active: true, is_available: false, unavailable_until: min(60 * 24), max_open_leads: null, accepting: false },
  { profile_id: "s3", name: "Neha New", role: "teacher", is_counsellor: false, is_active: false, is_available: true, unavailable_until: null, max_open_leads: null, accepting: false },
];
const CFG = { school_id: "s1", first_response_minutes: 30, follow_up_interval_minutes: 1440, follow_up_grace_minutes: 0, due_soon_first_minutes: 10, due_soon_follow_minutes: 120,
  working_hours_enabled: true, work_start: "09:00:00", work_end: "17:00:00", work_days: [1, 2, 3, 4, 5, 6], timezone: "Asia/Kolkata",
  first_response_events: ["call_answered", "message_sent"], auto_assign_enabled: true };
const QUEUE_LEAD = { applicant_id: "u1", full_name: "Unassigned Uma", parent_name: "P", parent_phone: "9000000000", parent_email: null, status: "under_review", source: "walk_in", grade: "Grade 2", created_at: min(-20), meeting_notes: null,
  assigned_to: null, assigned_to_name: null, assigned_at: null, assignment_method: null, score: 61, category: "warm", first_contact_at: null, last_contact_at: null, contact_count: 0, note_count: 0,
  last_event_type: null, last_event_at: null, next_follow_up_at: null, is_new: false, first_response: null, follow_up: null, sla_state: null, follow_up_today: false, follow_up_pending: false };

const api = vi.hoisted(() => ({
  queueLeads: [] as any[], scopes: [] as string[], refetch: vi.fn(),
  assignLead: vi.fn(async () => ({ error: null, changed: true })), assignUnassigned: vi.fn(async () => ({ error: null, assigned: 2 })),
  saveCounsellor: vi.fn(async () => ({ error: null, result: { redistributed: 3, waiting_assigned: 0 } })), saveSlaConfig: vi.fn(async () => ({ error: null })),
  dashError: null as string | null, role: "principal", monitor: { scheduled: true, last_run_at: null as string | null, last_run_ok: true as boolean | null, interval_minutes: 5 },
}));
vi.mock("@/hooks/useAdmissionAssignment", () => ({
  ASSIGNMENT_ADMIN_ROLES: ["principal", "admin", "school_admin", "knsoft_admin"],
  useAssignmentDashboard: () => ({ data: api.dashError ? null : DASH, loading: false, error: api.dashError, refetch: vi.fn() }),
  useEligibleStaff: () => ({ staff: STAFF, loading: false, refetch: vi.fn() }),
  useSlaConfig: () => ({ config: CFG, loading: false, refetch: vi.fn() }),
  useMonitorStatus: () => api.monitor,
  useWorkbench: (o: any) => { api.scopes.push(o.scope); return { data: { total: api.queueLeads.length }, leads: api.queueLeads, loading: false, error: null, skewMs: 0, refetch: api.refetch }; },
  useAssignmentHistory: () => ({ rows: [], loading: false, refetch: vi.fn() }),
  assignLead: api.assignLead, assignUnassigned: api.assignUnassigned, saveCounsellor: api.saveCounsellor, saveSlaConfig: api.saveSlaConfig, scheduleFollowUp: vi.fn(),
}));
vi.mock("@/hooks/useLeadScores", () => ({ logInteraction: vi.fn(), useLeadScores: () => ({ scores: {}, refetch: vi.fn() }), useLeadTemperature: () => null, useScoreHistory: () => ({ rows: [], names: {}, loading: false, refetch: vi.fn() }), useLeadQualification: () => ({ q: null, loading: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useAdmissionIntegrations", () => ({
  ADMISSION_ADMIN_ROLES: ["principal", "admin", "school_admin"], useLeadTimeline: () => ({ events: [], loading: false, refetch: vi.fn() }),
  useAdmissionIntegrations: () => ({ integrations: [], loading: false, error: null, canManage: true, refetch: vi.fn() }), useLeadMeta: () => ({ meta: {}, refetch: vi.fn(), integrationName: () => null }),
  useIntegrationActivity: () => ({ rows: [], loading: false, refetch: vi.fn() }), addFollowUpNote: vi.fn(),
}));
vi.mock("@/hooks/useAdmissionIntakes", () => ({ useAdmissionIntakes: () => ({ intakes: [], loading: false, createIntake: vi.fn(), toggleIntakeOpen: vi.fn() }) }));
vi.mock("@/hooks/useAdmissionApplicants", () => ({ useAdmissionApplicants: () => ({ applicants: [], loading: false, addApplicant: vi.fn(), decideApplicant: vi.fn(), refetch: vi.fn() }) }));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }), toast: toastSpy }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { id: "u1", school_id: "s1", role: api.role } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn(() => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }) })), storage: { from: vi.fn() } } }));

import { AssignmentAdminPanel } from "@/components/admission/AssignmentAdminPanel";
import { AdmissionDashboard } from "@/components/admission/AdmissionDashboard";
import { chooseOption, polyfillRadix } from "./radixSelectHelper";
polyfillRadix();

describe("Assignment & SLA admin panel", () => {
  beforeEach(() => { vi.clearAllMocks(); api.queueLeads = [QUEUE_LEAD]; api.scopes = []; api.dashError = null; api.role = "principal"; api.monitor = { scheduled: true, last_run_at: null, last_run_ok: true, interval_minutes: 5 }; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it("summarises unassigned and overdue leads and SLA performance from the real numbers", () => {
    render(<AssignmentAdminPanel />);
    const stat = (label: string) => screen.getAllByText(label)[0].closest("div")!.parentElement!.textContent;   // the stat card comes before the queue tab of the same name
    expect(stat("Unassigned")).toContain("2"); expect(stat("First response overdue")).toContain("3"); expect(stat("Follow-up overdue")).toContain("1");
    expect(stat("First response on time (30d)")).toContain("80%"); expect(stat("Follow-ups on time (30d)")).toContain("25%");
    expect(screen.getByText(/3 deadline\(s\) are due soon/)).toBeTruthy();
  });

  it("shows lead distribution, workload, conversion and SLA performance per counsellor", () => {
    render(<AssignmentAdminPanel />);
    const row = (n: string) => screen.getByRole("rowheader", { name: n }).closest("tr")!;
    const asha = row("Asha Rao").textContent!;
    expect(asha).toContain("Receiving leads"); expect(asha).toContain("/ 20"); expect(asha).toContain("25%"); expect(asha).toContain("(5/20)");
    expect(asha).toContain("83%"); expect(asha).toContain("avg 12m");
    const vik = row("Vikram Das").textContent!;
    expect(vik).toContain("Away until"); expect(vik).toContain("0%"); expect(vik).toContain("—");      // no first responses yet: a dash, not a made-up 0%
  });

  it("lists the unassigned queue by default, with overdue and all leads one click away", () => {
    render(<AssignmentAdminPanel />);
    expect(screen.getByText("Unassigned Uma")).toBeTruthy();
    expect(api.scopes.at(-1)).toBe("unassigned");
    fireEvent.click(screen.getByRole("tab", { name: "Overdue" })); expect(api.scopes.at(-1)).toBe("overdue");
    fireEvent.click(screen.getByRole("tab", { name: "All open leads" })); expect(api.scopes.at(-1)).toBe("all");
  });

  it("hands every unassigned lead out in rotation with one click", async () => {
    render(<AssignmentAdminPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Assign all unassigned in rotation/ }));
    await waitFor(() => expect(api.assignUnassigned).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "2 leads assigned" })));
  });

  it("manually assigns a lead to a chosen counsellor with a reason", async () => {
    render(<AssignmentAdminPanel />);
    fireEvent.click(within(screen.getByTestId("wb-lead")).getByRole("button", { name: /^Assign$/ }));
    const go = await screen.findByRole("button", { name: "Assign" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    await chooseOption(screen.getByLabelText("Counsellor"), /Asha Rao/);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Speaks the parent's language" } });
    await waitFor(() => expect(go.disabled).toBe(false)); fireEvent.click(go);
    await waitFor(() => expect(api.assignLead).toHaveBeenCalledWith("u1", "c1", "Speaks the parent's language"));
  });

  it("marks away counsellors in the assignment picker", async () => {
    render(<AssignmentAdminPanel />);
    fireEvent.click(within(screen.getByTestId("wb-lead")).getByRole("button", { name: /^Assign$/ }));
    fireEvent.keyDown(await screen.findByLabelText("Counsellor"), { key: "Enter" });
    expect(await screen.findByRole("option", { name: "Vikram Das (away)" })).toBeTruthy();
  });

  it("surfaces a database refusal when assignment fails", async () => {
    api.assignLead.mockResolvedValueOnce({ error: "Not allowed", changed: false } as any);
    render(<AssignmentAdminPanel />);
    fireEvent.click(within(screen.getByTestId("wb-lead")).getByRole("button", { name: /^Assign$/ }));
    await chooseOption(await screen.findByLabelText("Counsellor"), /Asha Rao/);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not assign", description: "Not allowed", variant: "destructive" })));
  });

  it("takes a counsellor out of rotation and moves their open leads", async () => {
    render(<AssignmentAdminPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Manage Asha Rao" }));
    fireEvent.click(await screen.findByLabelText("Available now"));
    fireEvent.click(await screen.findByLabelText(/Move their open leads/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveCounsellor).toHaveBeenCalledWith(expect.objectContaining({ schoolId: "s1", profileId: "c1", active: true, available: false, redistribute: true, maxOpen: 20 })));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("3 open lead(s) moved") })));
  });

  it("adds a counsellor from staff who are not counsellors yet, and rejects a bad capacity", async () => {
    render(<AssignmentAdminPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Add counsellor/ }));
    await chooseOption(await screen.findByLabelText("Staff member"), /Neha New/);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/Maximum open leads/), { target: { value: "0" } });
    expect(save.disabled).toBe(true); expect(screen.getByText(/whole number of 1 or more/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Maximum open leads/), { target: { value: "15" } });
    await waitFor(() => expect(save.disabled).toBe(false)); fireEvent.click(save);
    await waitFor(() => expect(api.saveCounsellor).toHaveBeenCalledWith(expect.objectContaining({ profileId: "s3", active: true, available: true, maxOpen: 15, redistribute: false })));
  });

  it("saves SLA targets (follow-up hours are converted to minutes) and working hours", async () => {
    render(<AssignmentAdminPanel />);
    fireEvent.change(screen.getByLabelText(/First response \(minutes\)/), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText(/Follow-up interval \(hours\)/), { target: { value: "48" } });
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save SLA settings" }));
    await waitFor(() => expect(api.saveSlaConfig).toHaveBeenCalledWith("s1", expect.objectContaining({
      first_response_minutes: 45, follow_up_interval_minutes: 2880, work_start: "09:00", work_end: "18:00", work_days: [1, 2, 3, 4, 5, 6],
      working_hours_enabled: true, timezone: "Asia/Kolkata", first_response_events: ["call_answered", "message_sent"], auto_assign_enabled: true })));
  });

  it("blocks invalid SLA settings before they reach the database", () => {
    render(<AssignmentAdminPanel />);
    const save = screen.getByRole("button", { name: "Save SLA settings" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/First response \(minutes\)/), { target: { value: "0" } });
    expect(save.disabled).toBe(true); expect(screen.getByRole("alert").textContent).toContain("First response target");
    fireEvent.change(screen.getByLabelText(/First response \(minutes\)/), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "08:00" } });
    expect(save.disabled).toBe(true); expect(screen.getByRole("alert").textContent).toContain("end after they start");
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "17:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Fri" })); fireEvent.click(screen.getByRole("button", { name: "Mon" }));
    for (const d of ["Tue", "Wed", "Thu", "Sat"]) fireEvent.click(screen.getByRole("button", { name: d }));
    expect(save.disabled).toBe(true); expect(screen.getByRole("alert").textContent).toContain("at least one working day");
  });

  it("shows the assignment log: who assigned, to whom, how and why", () => {
    render(<AssignmentAdminPanel />);
    const log = screen.getByRole("heading", { name: "Recent assignments" }).nextElementSibling as HTMLElement;
    expect(log.textContent).toContain("Kiran K"); expect(log.textContent).toContain("Manual by Principal P"); expect(log.textContent).toContain("Sibling known");
    expect(log.textContent).toContain("from Vikram Das"); expect(log.textContent).toContain("Automatic");
  });

  it("warns loudly when the database job that enforces SLAs is not scheduled, and stays quiet when it is", () => {
    const ok = render(<AssignmentAdminPanel />);
    expect(screen.queryByText(/SLA monitoring is not running/)).toBeNull(); ok.unmount();
    api.monitor = { scheduled: false, last_run_at: null, last_run_ok: null, interval_minutes: 5 };
    render(<AssignmentAdminPanel />);
    expect(screen.getByRole("alert").textContent).toContain("SLA monitoring is not running"); expect(screen.getByRole("alert").textContent).toContain("pg_cron");
  });

  it("flags a failing last monitor run", () => {
    api.monitor = { scheduled: true, last_run_at: min(-3), last_run_ok: false, interval_minutes: 5 };
    render(<AssignmentAdminPanel />);
    expect(screen.getByRole("alert").textContent).toContain("last SLA monitor run failed");
  });

  it("explains a missing migration or a real error instead of showing zeros", () => {
    api.dashError = "not_installed"; const a = render(<AssignmentAdminPanel />);
    expect(screen.getByText(/latest database update/)).toBeTruthy(); a.unmount();
    api.dashError = "Not allowed"; render(<AssignmentAdminPanel />);
    expect(screen.getByRole("alert").textContent).toContain("Not allowed");
  });
});

describe("integration into the existing Admissions page", () => {
  beforeEach(() => { vi.clearAllMocks(); api.queueLeads = []; api.role = "principal"; api.dashError = null; api.monitor = { scheduled: true, last_run_at: null, last_run_ok: true, interval_minutes: 5 }; });
  afterEach(cleanup);

  it("adds My Workbench and Assignment & SLA beside the existing tabs; nothing else is replaced", () => {
    render(<AdmissionDashboard />);
    for (const t of ["Overview", "Applicants", "Lead Sources", "My Workbench", "Assignment & SLA"]) expect(screen.getByRole("button", { name: new RegExp(t.replace("&", "&")) })).toBeTruthy();
    expect(screen.getByText("Admission Intakes")).toBeTruthy();         // the existing overview is still the landing view
  });

  it("offers the admin tab only to admin roles (the database enforces it regardless)", () => {
    api.role = "teacher";
    render(<AdmissionDashboard />);
    expect(screen.getByRole("button", { name: /My Workbench/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Assignment & SLA/ })).toBeNull();
  });

  it("switches into the admin dashboard and back to the existing views", async () => {
    render(<AdmissionDashboard />);
    fireEvent.click(screen.getByRole("button", { name: /Assignment & SLA/ }));
    expect(await screen.findByText("Counsellors")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Overview/ }));
    expect(screen.getByText("Admission Intakes")).toBeTruthy();
  });
});
