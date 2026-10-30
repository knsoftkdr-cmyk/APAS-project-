import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ---------------------------------------------------------------------------------------------------------------
// The HOD and School Admin assistant widgets, wired to hodNavigation.ts / schoolAdminNavigation.ts. The resolvers are
// covered in their own test files; this checks the WIRING: navigation never calls the AI, a normal question still does,
// permissions are honoured, and the chat survives the page change.
// ---------------------------------------------------------------------------------------------------------------

const navigateMock = vi.fn();
const invokeMock = vi.fn();
let role: "hod" | "school_admin" = "hod";
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

import { AIHODAssistantWidget } from "@/components/ai-assistant/AIHODAssistantWidget";
import { AISchoolAdminAssistantWidget } from "@/components/ai-assistant/AISchoolAdminAssistantWidget";

const roomy = () => {
  window.matchMedia = ((q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as any;
};
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

beforeEach(() => {
  cleanup();
  navigateMock.mockReset();
  invokeMock.mockReset();
  allowedModules = "all";
  roomy();
});

interface Case {
  name: string;
  role: "hod" | "school_admin";
  Widget: () => JSX.Element | null;
  openLabel: string;
  edgeFn: string;
  menu: string;
  home: string;
  // a navigation request, where it goes, and the confirmation shown
  go: { say: string; to: string; confirm: string };
  // a data question and a data request that names a page
  question: string;
  dataRequest: string;
  // a page this role is not allowed to open
  foreign: string;
  // a page on the role's own menu that a school can switch off (HOD/principal-style permission) + one that stays on
  gated?: { say: string; module: string; stays: { say: string; to: string } };
  // two-step "which one" flow
  ambiguous: { say: string; pick: string; to: string };
  // already-here
  here: { at: string; say: string; reply: string };
  // hand-off
  handoff: { from: string; say: string; to: string; confirm: string; other: string };
}

const CASES: Case[] = [
  {
    name: "HOD",
    role: "hod",
    Widget: AIHODAssistantWidget,
    openLabel: "Open HOD Assistant",
    edgeFn: "hod-assistant",
    menu: "HOD menu",
    home: "/hod-dashboard",
    go: { say: "Open class mastery", to: "/class-mastery", confirm: "Opening Class Mastery." },
    question: "which students are at risk in my department",
    dataRequest: "open class mastery for class 8",
    foreign: "open gamification", // listed for HOD in the sidebar, but its route only admits students
    gated: { say: "open billing", module: "Billing", stays: { say: "open alerts", to: "/alerts" } },
    ambiguous: { say: "open exams", pick: "mock exams", to: "/mock-exams" },
    here: { at: "/houses", say: "open houses", reply: "You're already on Houses." },
    handoff: { from: "/hod-dashboard", say: "open alerts", to: "/alerts", confirm: "Opening Alerts.", other: "/security" },
  },
  {
    name: "School Admin",
    role: "school_admin",
    Widget: AISchoolAdminAssistantWidget,
    openLabel: "Open School Admin Assistant",
    edgeFn: "school-admin-assistant",
    menu: "school admin menu",
    home: "/dashboard",
    go: { say: "Open admissions", to: "/admissions", confirm: "Opening Admissions." },
    question: "how many admissions this month",
    dataRequest: "open admissions for class 5",
    foreign: "open lesson plan generator",
    ambiguous: { say: "open exams", pick: "exam seating", to: "/exam-seating" },
    here: { at: "/transport", say: "open transport", reply: "You're already on Transport." },
    handoff: { from: "/dashboard", say: "take me to id cards", to: "/id-cards", confirm: "Opening ID Cards.", other: "/alumni" },
  },
];

describe.each(CASES)("$name assistant widget - navigation wiring", (c) => {
  const mount = (at = c.home) => render(<MemoryRouter initialEntries={[at]}><c.Widget /></MemoryRouter>);
  const open = () => fireEvent.click(screen.getByLabelText(c.openLabel));
  const ask = (text: string) => {
    const input = screen.getByPlaceholderText(/Ask me anything/i);
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
  };
  beforeEach(() => { role = c.role; });

  it("a navigation request goes to the page, shows the confirmation, and never calls the AI", () => {
    mount();
    open();
    ask(c.go.say);
    expect(navigateMock).toHaveBeenCalledWith(c.go.to);
    expect(screen.getByText(c.go.confirm)).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("a normal question still goes to the assistant", async () => {
    invokeMock.mockResolvedValue({ data: { text: "Here is the answer." }, error: null });
    mount();
    open();
    ask(c.question);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(c.edgeFn, expect.anything()));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(await screen.findByText("Here is the answer.")).toBeInTheDocument();
  });

  it("a data request that names a page is not a navigation or a 'page not found'", async () => {
    invokeMock.mockResolvedValue({ data: { text: "Here is the data." }, error: null });
    mount();
    open();
    ask(c.dataRequest);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(c.edgeFn, expect.anything()));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/couldn't find a page/)).not.toBeInTheDocument();
  });

  it("a page outside this role's menu is 'not available'", () => {
    mount();
    open();
    ask(c.foreign);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText(new RegExp(`isn't available from your ${c.menu}`))).toBeInTheDocument();
  });

  it("asks which one, then opens the one named", () => {
    mount();
    open();
    ask(c.ambiguous.say);
    expect(screen.getByText(/Which one do you mean/)).toBeInTheDocument();
    ask(c.ambiguous.pick);
    expect(navigateMock).toHaveBeenCalledWith(c.ambiguous.to);
  });

  it("says 'already here' for the page the user is on", () => {
    mount(c.here.at);
    open();
    ask(c.here.say);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText(c.here.reply)).toBeInTheDocument();
  });

  it("the new page's widget shows the conversation, still open - and a different page starts fresh", () => {
    mount(c.handoff.from);
    open();
    ask(c.handoff.say);
    expect(navigateMock).toHaveBeenCalledWith(c.handoff.to);
    cleanup();
    mount(c.handoff.to);
    expect(screen.getByText(c.handoff.confirm)).toBeInTheDocument();
    expect(screen.getByText(c.handoff.say)).toBeInTheDocument();
    cleanup();
    mount(c.handoff.other); // not where the assistant sent us
    expect(screen.queryByText(c.handoff.confirm)).not.toBeInTheDocument();
    expect(screen.getByLabelText(c.openLabel)).toBeInTheDocument();
  });

  if (c.gated) {
    const g = c.gated;
    it("only opens pages the school has enabled (the sidebar's own permission check)", () => {
      allowedModules = ["Home", "Alerts"]; // everything else off
      mount();
      open();
      ask(g.say);
      expect(navigateMock).not.toHaveBeenCalled();
      expect(screen.getByText(new RegExp(`isn't available from your ${c.menu}`))).toBeInTheDocument();
      ask(g.stays.say);
      expect(navigateMock).toHaveBeenCalledWith(g.stays.to);
    });
  }
});
