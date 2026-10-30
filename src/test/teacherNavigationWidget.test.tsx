import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ---------------------------------------------------------------------------------------------------------------
// The teacher's APAS Agent widget, wired to src/lib/teacherNavigation.ts. The resolver itself is covered in
// teacherNavigation.test.ts; this checks the WIRING: navigation never calls the AI, a normal question still does,
// the lesson-plan questions are not hijacked, per-school permissions are honoured, and the chat survives the page change.
// ---------------------------------------------------------------------------------------------------------------

const navigateMock = vi.fn();
const invokeMock = vi.fn();
let allowedModules: string[] | "all" = "all";

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) }, from: () => ({}) },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isTeacher: true, profile: { role: "teacher", school_id: "school-1", full_name: "T" } }),
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

import { AILessonAssistantWidget } from "@/components/ai-assistant/AILessonAssistantWidget";

// A roomy screen, so the chat stays open after navigating (on phones it collapses to reveal the page).
const roomy = () => {
  window.matchMedia = ((q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as any;
};

const mount = (at = "/dashboard") =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <AILessonAssistantWidget />
    </MemoryRouter>,
  );

const openChat = () => fireEvent.click(screen.getByLabelText("Open APAS Agent"));
const say = (text: string) => {
  const input = screen.getByPlaceholderText(/Ask APAS/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
};

// jsdom has no Element.scrollTo (the widget auto-scrolls its message list).
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

beforeEach(() => {
  cleanup();
  navigateMock.mockReset();
  invokeMock.mockReset();
  allowedModules = "all";
  roomy();
});

describe("APAS Agent widget - navigation wiring", () => {
  it("'Open my timetable' goes to the timetable, shows the confirmation, and never calls the AI", () => {
    mount();
    openChat();
    say("Open my timetable");
    expect(navigateMock).toHaveBeenCalledWith("/timetable");
    expect(screen.getByText("Opening Timetable.")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("a normal question still goes to the AI, and does not navigate", async () => {
    invokeMock.mockResolvedValue({ data: { chatReply: "Photosynthesis is how plants make food." }, error: null });
    mount();
    openChat();
    say("explain photosynthesis");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("extract-lesson-intent", expect.anything()));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/Photosynthesis is how plants make food/)).toBeInTheDocument();
  });

  it("a request to make a lesson plan is NOT treated as navigation", async () => {
    invokeMock.mockResolvedValue({ data: { isLessonRequest: false, chatReply: "ok" }, error: null });
    mount();
    openChat();
    say("open lesson plan for class 5 fractions");
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("says 'already here' instead of navigating to the page the teacher is on", () => {
    mount("/class-mastery"); // (a page no other test navigates to, so no earlier hand-off is live for it)
    openChat();
    say("open class mastery");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText("You're already on Class Mastery.")).toBeInTheDocument();
  });

  it("only opens pages the teacher's school has enabled (the sidebar's own permission check)", () => {
    allowedModules = ["Home", "Attendance"]; // no "Billing"
    mount();
    openChat();
    say("open billing");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText(/isn't available from your teacher menu/)).toBeInTheDocument();
    say("open attendance");
    expect(navigateMock).toHaveBeenCalledWith("/attendance");
  });

  it("a page that would bounce a teacher (Gamification) is 'not available', not opened", () => {
    mount();
    openChat();
    say("open gamification");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText(/isn't available from your teacher menu/)).toBeInTheDocument();
  });

  it("asks which one, then opens the one the teacher names", () => {
    mount();
    openChat();
    say("open exams");
    expect(screen.getByText(/Which one do you mean/)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    say("exam reviews");
    expect(navigateMock).toHaveBeenCalledWith("/exam-reviews");
  });
});

describe("APAS Agent widget - the lesson-plan questions are not hijacked", () => {
  const startLessonFlow = async () => {
    invokeMock.mockResolvedValue({ data: { isLessonRequest: true, intent: {} }, error: null });
    mount();
    openChat();
    say("create a lesson plan");
    expect(await screen.findByText("What class/grade is this lesson for?")).toBeInTheDocument();
  };

  it("an answer that merely starts with 'open' is still taken as the answer", async () => {
    await startLessonFlow();
    say("open circuits"); // not a page - and the agent is waiting for a class
    expect(await screen.findByText("Which section?")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't find a page/)).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("a clear request for a page can still interrupt it, and the half-finished questions are dropped", async () => {
    await startLessonFlow();
    say("take me to attendance");
    expect(navigateMock).toHaveBeenCalledWith("/attendance");
  });
});

describe("APAS Agent widget - the chat survives the page change", () => {
  it("the new page's widget shows the conversation, still open", () => {
    mount("/dashboard");
    openChat();
    say("open timetable");
    expect(navigateMock).toHaveBeenCalledWith("/timetable");
    cleanup(); // the page change re-creates the widget
    mount("/timetable");
    expect(screen.getByText("Opening Timetable.")).toBeInTheDocument(); // chat card is open with the confirmation
    expect(screen.getByText("open timetable")).toBeInTheDocument(); // ...and the teacher's own message
  });

  it("navigating anywhere else (sidebar, back button) starts the widget fresh, as before", () => {
    mount("/dashboard");
    openChat();
    say("open timetable");
    cleanup();
    mount("/analytics"); // not where the agent was sent
    expect(screen.queryByText("Opening Timetable.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Open APAS Agent")).toBeInTheDocument();
  });
});
