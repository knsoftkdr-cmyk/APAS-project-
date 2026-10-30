import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ---------------------------------------------------------------------------------------------------------------
// The Parent and Principal assistant widgets, wired to parentNavigation.ts / principalNavigation.ts. The resolvers are
// covered in their own test files; this checks the WIRING: navigation never calls the AI, a normal question still does,
// permissions are honoured (principal), and the chat survives the page change.
// ---------------------------------------------------------------------------------------------------------------

const navigateMock = vi.fn();
const invokeMock = vi.fn();
let role: "parent" | "principal" = "principal";
let allowedModules: string[] | "all" = "all";

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) }, from: () => ({}) },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { role, school_id: "school-1", full_name: "U" }, user: { id: "u1" } }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ can: (m: string) => allowedModules === "all" || allowedModules.includes(m), loading: false }),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@capacitor-community/text-to-speech", () => ({ TextToSpeech: { speak: vi.fn(), stop: vi.fn() } }));
vi.mock("@capgo/capacitor-speech-recognition", () => ({ SpeechRecognition: { available: vi.fn(), start: vi.fn(), stop: vi.fn() } }));
vi.mock("@/components/ai-assistant/RobotFace", () => ({ RobotFace: () => null }));
vi.mock("@/hooks/useLipSync", () => ({
  useLipSync: () => ({ start: vi.fn(), stop: vi.fn(), reanchor: vi.fn() }),
  estimateSpeechDurationMs: () => 1000,
}));

import { AIPrincipalAssistantWidget } from "@/components/ai-assistant/AIPrincipalAssistantWidget";
import { ParentBusAssistantWidget } from "@/components/parent-transport/ParentBusAssistantWidget";

const roomy = () => {
  window.matchMedia = ((q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as any;
};
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

const mountPrincipal = (at = "/dashboard") =>
  render(<MemoryRouter initialEntries={[at]}><AIPrincipalAssistantWidget /></MemoryRouter>);
const mountParent = (at = "/parent-dashboard") =>
  render(<MemoryRouter initialEntries={[at]}><ParentBusAssistantWidget studentId={null} studentName={null} /></MemoryRouter>);

const say = (placeholder: RegExp, text: string) => {
  const input = screen.getByPlaceholderText(placeholder);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
};

beforeEach(() => {
  cleanup();
  navigateMock.mockReset();
  invokeMock.mockReset();
  allowedModules = "all";
  roomy();
});

describe("Principal assistant widget - navigation wiring", () => {
  const open = () => fireEvent.click(screen.getByLabelText("Open Principal Assistant"));
  const ask = (t: string) => say(/Ask me anything/i, t);
  beforeEach(() => { role = "principal"; });

  it("'Open school intelligence' navigates, shows the confirmation, and never calls the AI", () => {
    mountPrincipal();
    open();
    ask("Open school intelligence");
    expect(navigateMock).toHaveBeenCalledWith("/school-analytics");
    expect(screen.getByText("Opening School Intelligence.")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("a data question still goes to the principal assistant", async () => {
    invokeMock.mockResolvedValue({ data: { text: "Attendance is 94% today." }, error: null });
    mountPrincipal();
    open();
    ask("how is attendance today");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("principal-assistant", expect.anything()));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(await screen.findByText("Attendance is 94% today.")).toBeInTheDocument();
  });

  it("'open attendance for class 5' is a data request, not a navigation or a 'page not found'", async () => {
    invokeMock.mockResolvedValue({ data: { text: "Class 5 attendance is 96%." }, error: null });
    mountPrincipal();
    open();
    ask("open attendance for class 5");
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/couldn't find a page/)).not.toBeInTheDocument();
  });

  it("only opens pages the principal's school has enabled", () => {
    allowedModules = ["Home", "Attendance"];
    mountPrincipal();
    open();
    ask("open school intelligence");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText(/isn't available from your principal menu/)).toBeInTheDocument();
    ask("open attendance");
    expect(navigateMock).toHaveBeenCalledWith("/attendance");
  });

  it("another role's page is 'not available'", () => {
    mountPrincipal();
    open();
    ask("open gamification");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText(/isn't available from your principal menu/)).toBeInTheDocument();
  });

  it("asks which one, then opens the one named", () => {
    mountPrincipal();
    open();
    ask("open exams");
    expect(screen.getByText(/Which one do you mean/)).toBeInTheDocument();
    ask("exam seating");
    expect(navigateMock).toHaveBeenCalledWith("/exam-seating");
  });

  it("says 'already here' for the page the principal is on", () => {
    mountPrincipal("/houses");
    open();
    ask("open houses");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText("You're already on Houses.")).toBeInTheDocument();
  });

  it("the new page's widget shows the conversation, still open - and a different page starts fresh", () => {
    mountPrincipal("/dashboard");
    open();
    ask("open alerts");
    expect(navigateMock).toHaveBeenCalledWith("/alerts");
    cleanup();
    mountPrincipal("/alerts");
    expect(screen.getByText("Opening Alerts.")).toBeInTheDocument();
    expect(screen.getByText("open alerts")).toBeInTheDocument();
    cleanup();
    mountPrincipal("/security"); // not where the assistant sent us
    expect(screen.queryByText("Opening Alerts.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Open Principal Assistant")).toBeInTheDocument();
  });
});

describe("Parent assistant widget - navigation wiring", () => {
  const open = () => fireEvent.click(screen.getByLabelText("Open APAS Agent"));
  const ask = (t: string) => say(/Ask about your child/i, t);
  beforeEach(() => { role = "parent"; });

  it("'Open my child's report card' navigates, shows the confirmation, and never calls the AI", () => {
    mountParent();
    open();
    ask("Open my child's report card");
    expect(navigateMock).toHaveBeenCalledWith("/report-cards");
    expect(screen.getByText("Opening Report Cards.")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("a question about the child still goes to the parent assistant", async () => {
    invokeMock.mockResolvedValue({ data: { text: "Your child was present 18 of 20 days." }, error: null });
    mountParent();
    open();
    ask("what is my child's attendance");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("parent-assistant", expect.anything()));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/present 18 of 20 days/)).toBeInTheDocument();
  });

  it.each(["open fees", "open transport", "show fee status"])("'%s' is left to the assistant (it answers fees and transport)", async (t) => {
    invokeMock.mockResolvedValue({ data: { text: "Here is what I found." }, error: null });
    mountParent();
    open();
    ask(t);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("parent-assistant", expect.anything()));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/isn't available|couldn't find a page/)).not.toBeInTheDocument();
  });

  it("a teacher's page is 'not available' from the parent menu", () => {
    mountParent();
    open();
    ask("open lesson plan generator");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText(/isn't available from your parent menu/)).toBeInTheDocument();
  });

  it("says 'already here' for the page the parent is on", () => {
    mountParent("/appointments");
    open();
    ask("open appointments");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText("You're already on Appointments.")).toBeInTheDocument();
  });

  it("the new page's widget shows the conversation, still open - and a different page starts fresh", () => {
    mountParent("/parent-dashboard");
    open();
    ask("take me to attendance");
    expect(navigateMock).toHaveBeenCalledWith("/attendance");
    cleanup();
    mountParent("/attendance");
    expect(screen.getByText("Opening Attendance.")).toBeInTheDocument();
    cleanup();
    mountParent("/surveys");
    expect(screen.queryByText("Opening Attendance.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Open APAS Agent")).toBeInTheDocument();
  });
});
