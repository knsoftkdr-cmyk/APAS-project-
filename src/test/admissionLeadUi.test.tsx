// The lead-source UI inside the EXISTING Admissions screens (no new menu / module).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const META = {
  a1: { applicant_id: "a1", integration_id: "i1", lead_source: "meta", campaign: {}, assigned_to: null, next_follow_up_at: null, last_contacted_at: null, enquiry_count: 3, last_enquiry_at: "2026-11-01T00:00:00Z" },
};
const INTEGRATIONS = [
  { id: "i1", school_id: "s1", provider: "meta", name: "Spring Meta Ads", status: "active", webhook_token: "t".repeat(48), default_intake_id: null, config: {}, field_mapping: {}, notify_emails: [], leads_received: 5, leads_created: 4, leads_duplicate: 1, leads_failed: 0, last_received_at: null, last_success_at: null, last_error: null, last_error_at: null, last_sync_at: null, created_at: "2026-11-01T00:00:00Z" },
  { id: "i2", school_id: "s1", provider: "zoho", name: "Zoho CRM", status: "error", webhook_token: "u".repeat(48), default_intake_id: null, config: {}, field_mapping: {}, notify_emails: [], leads_received: 0, leads_created: 0, leads_duplicate: 0, leads_failed: 2, last_received_at: null, last_success_at: null, last_error: "Zoho: bad token", last_error_at: null, last_sync_at: null, created_at: "2026-11-01T00:00:00Z" },
];

vi.mock("@/hooks/useAdmissionIntegrations", () => ({
  ADMISSION_ADMIN_ROLES: ["principal", "admin", "school_admin"],
  useLeadMeta: () => ({ meta: META, refetch: vi.fn(), integrationName: (id: string | null) => INTEGRATIONS.find((i) => i.id === id)?.name ?? null }),
  useAdmissionIntegrations: () => ({ integrations: INTEGRATIONS, loading: false, error: null, canManage: true, refetch: vi.fn() }),
  useLeadTimeline: () => ({ events: [], loading: false, refetch: vi.fn() }),
  useIntegrationActivity: () => ({ rows: [], loading: false, refetch: vi.fn() }),
  addFollowUpNote: vi.fn(),
}));
const factor = (label: string, weight: number, score: number | null, contribution: number | null, signals: any[] = []) =>
  ({ label, weight, available: score !== null, score, contribution, signals });
const mkScore = (id: string, score: number, category: string, extra: any = {}) => ({
  applicant_id: id, computed_score: score, override_score: null, override_reason: null, override_by: null, override_at: null, score, category, coverage: 55,
  calculated_at: "2026-11-14T08:00:00Z", score_changed_at: "2026-11-13T08:00:00Z",
  factors: {
    interest: factor("Enquiry Interest", 30, 76.84, 41.9, [{ key: "channel", label: "Enquiry channel", score: 90, weight: 20, detail: "Came via referral" }]),
    engagement: factor("Engagement", 25, null, null),
    readiness: factor("Admission Readiness", 25, 43.33, 19.7, [{ key: "status", label: "Application progress", score: 40, weight: 30, detail: "Status: under review" }]),
    budget: factor("Budget & Timeline", 20, null, null),
  }, ...extra,
});
const SCORES: Record<string, any> = { a1: mkScore("a1", 87, "hot"), a2: mkScore("a2", 20, "cold") };
const scoreApi = vi.hoisted(() => ({ setScoreOverride: vi.fn(async () => ({ error: null })), clearScoreOverride: vi.fn(async () => ({ error: null })), logInteraction: vi.fn(async () => ({ error: null })), saveQualification: vi.fn(async () => ({ error: null })) }));
vi.mock("@/hooks/useLeadScores", () => ({
  useLeadScores: () => ({ scores: SCORES, refetch: vi.fn() }),
  useLeadTemperature: () => ({ hot: 4, warm: 7, cold: 2 }),
  useScoreHistory: () => ({ rows: [{ id: "h1", change_type: "auto", trigger_source: "documents_changed", old_score: 70, new_score: 87, old_category: "hot", new_category: "hot", computed_score: 87, reason: null, created_by: null, created_at: "2026-11-14T08:00:00Z" }], names: {}, loading: false, refetch: vi.fn() }),
  useLeadQualification: () => ({ q: null, loading: false, refetch: vi.fn() }),
  ...scoreApi,
}));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }), toast: toastSpy }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { id: "u1", school_id: "s1", role: "principal" } }) }));
vi.mock("@/hooks/useAdmissionIntakes", () => ({
  useAdmissionIntakes: () => ({ intakes: [], loading: false, createIntake: vi.fn(), toggleIntakeOpen: vi.fn() }),
}));
vi.mock("@/hooks/useAdmissionApplicants", () => ({
  useAdmissionApplicants: () => ({ applicants: [], loading: false, addApplicant: vi.fn(), decideApplicant: vi.fn(), refetch: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn(() => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }) })), storage: { from: vi.fn() } } }));

import { ApplicantsTable } from "@/components/admission/ApplicantsTable";
import { AdmissionDashboard } from "@/components/admission/AdmissionDashboard";

const applicant = (id: string, name: string, source: string) => ({
  id, intake_id: "k1", school_id: "s1", full_name: name, date_of_birth: null, gender: null, parent_name: "P", parent_phone: "9876543210",
  parent_email: null, address: null, previous_school_name: null, previous_grade: null, previous_percentage: null, sibling_studying_here: false,
  distance_from_school_km: null, category: null, source, meeting_date: "2026-11-01", meeting_notes: null, priority_score: null, status: "under_review",
  decision_notes: null, decided_by: null, decided_at: null, recorded_by: "u1", created_at: "", updated_at: "", intake: { id: "k1", grade: "Grade 5", academic_year: "2026-27", total_seats: 30 }, documents: [{ count: 0 }],
}) as any;

describe("lead source and score in the existing Applicants table", () => {
  beforeEach(() => vi.clearAllMocks());
  const table = (sortBy: any = undefined) => render(
    <ApplicantsTable applicants={[applicant("a1", "Aarav", "online_enquiry"), applicant("a2", "Walkin Kid", "walk_in")]} loading={false}
      intakes={[]} filters={{ intakeId: "all", status: "all", sortBy }} onFiltersChange={vi.fn()} onDecide={vi.fn()} integrations={INTEGRATIONS as any} />,
  );

  it("shows the integration source and merged-enquiry count for a lead, and the manual source for a walk-in", () => {
    table();
    expect(screen.getByText("Meta Lead Ads")).toBeTruthy();
    expect(screen.getByText("3 enquiries")).toBeTruthy();
    expect(screen.getByText("Walk-in")).toBeTruthy();
    // every lead (not only integration leads) has an activity / follow-up entry point now
    expect(screen.getByRole("button", { name: /Lead activity for Aarav/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Lead activity for Walkin Kid/ })).toBeTruthy();
  });

  it("shows each lead's score with a Hot/Warm/Cold indicator and when it was last updated", () => {
    table();
    expect(screen.getByRole("button", { name: /Lead score 87 out of 100, Hot for Aarav/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Lead score 20 out of 100, Cold for Walkin Kid/ })).toBeTruthy();
    expect(screen.getAllByText("Hot").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cold").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Updated /).length).toBe(2);
  });

  it("can sort by lead score, highest first", () => {
    table("lead_score");
    const names = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(names[0]).toContain("Aarav");   // 87 before 20 even though Walkin Kid is not first in the data order... (data order is a1, a2)
    cleanup();
    render(<ApplicantsTable applicants={[applicant("a2", "Walkin Kid", "walk_in"), applicant("a1", "Aarav", "online_enquiry")]} loading={false} intakes={[]}
      filters={{ intakeId: "all", status: "all", sortBy: "lead_score" }} onFiltersChange={vi.fn()} onDecide={vi.fn()} integrations={INTEGRATIONS as any} />);
    expect(screen.getAllByRole("row")[1].textContent).toContain("Aarav");
  });

  it("opens the score breakdown from the score: factors, weights, contributions, unknowns, last update and history", async () => {
    table();
    fireEvent.click(screen.getByRole("button", { name: /Lead score 87 out of 100, Hot for Aarav/ }));
    await waitFor(() => expect(screen.getByText("What contributes to this score")).toBeTruthy());
    expect(screen.getByText("Enquiry Interest")).toBeTruthy();
    expect(screen.getByText("Weight 30%")).toBeTruthy();
    expect(screen.getByText(/adds 41\.9 pts/)).toBeTruthy();
    expect(screen.getByText(/Came via referral/)).toBeTruthy();
    // missing information is shown as "no data yet", explicitly not counted as zero
    expect(screen.getAllByText("No data yet").length).toBe(2);
    expect(screen.getAllByText(/not counted against this lead|left out instead of being counted as zero/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Last updated/)).toBeTruthy();
    expect(screen.getByText("Documents changed")).toBeTruthy();   // history row
  });

  it("lets staff adjust the score only with a valid value and a reason", async () => {
    table();
    fireEvent.click(screen.getByRole("button", { name: /Lead score 87 out of 100, Hot for Aarav/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Adjust score manually/ }));
    const save = screen.getByRole("button", { name: /Save adjustment/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);                                         // no reason yet
    fireEvent.change(screen.getByLabelText(/New score/), { target: { value: "39" } });
    expect(screen.getByText(/Will be shown as/).textContent).toContain("Cold"); // live preview of the category
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "ok" } });
    expect(save.disabled).toBe(true);                                         // reason too short
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Family is relocating" } });
    fireEvent.change(screen.getByLabelText(/New score/), { target: { value: "140" } });
    expect(save.disabled).toBe(true);                                         // out of range
    fireEvent.change(screen.getByLabelText(/New score/), { target: { value: "39" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(scoreApi.setScoreOverride).toHaveBeenCalledWith("a1", 39, "Family is relocating"));
  });

  it("surfaces a database permission error instead of pretending the adjustment worked", async () => {
    scoreApi.setScoreOverride.mockResolvedValueOnce({ error: "Not allowed" } as any);
    table();
    fireEvent.click(screen.getByRole("button", { name: /Lead score 87 out of 100, Hot for Aarav/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Adjust score manually/ }));
    fireEvent.change(screen.getByLabelText(/New score/), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Spoke to the parent" } });
    fireEvent.click(screen.getByRole("button", { name: /Save adjustment/ }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not adjust score", description: "Not allowed", variant: "destructive" })));
  });

  it("logs a call outcome from the Activity tab for a walk-in lead (feeds Engagement)", async () => {
    table();
    fireEvent.click(screen.getByRole("button", { name: /Lead activity for Walkin Kid/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(scoreApi.logInteraction).toHaveBeenCalledWith(expect.objectContaining({ applicantId: "a2", type: "call_answered", schoolId: "s1" })));
  });
});

describe("Admissions dashboard", () => {
  it("adds a Lead Sources tab (no new sidebar entry) with integration status, and opens the panel", async () => {
    render(<AdmissionDashboard />);
    // overview strip: one chip per integration, with its count
    expect(screen.getAllByText("Spring Meta Ads").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Zoho CRM").length).toBeGreaterThan(0);
    // the tab flags the integration that needs attention
    const tab = screen.getByRole("button", { name: /Lead Sources/ });
    expect(tab.getAttribute("title") ?? tab.innerHTML).toMatch(/need attention|1/);
    // lead temperature counts from the automatic scores
    expect(screen.getByLabelText("4 hot leads")).toBeTruthy();
    expect(screen.getByLabelText("7 warm leads")).toBeTruthy();
    expect(screen.getByLabelText("2 cold leads")).toBeTruthy();
    fireEvent.click(tab);
    await waitFor(() => expect(screen.getByText("Add integration")).toBeTruthy());
    expect(screen.getByText("Needs attention")).toBeTruthy(); // Zoho in error state
    expect(screen.getByText("Connected")).toBeTruthy();
  });
});
