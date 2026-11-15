/* eslint-disable @typescript-eslint/no-explicit-any -- hook / client stand-ins are intentionally loosely typed */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ role: "student" as string, listResponse: { sessions: [] as any[] }, subjectsCalls: 0 }));

vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: h.role } }) }));
vi.mock("@/hooks/useStudentSubjects", () => ({ useStudentSubjects: () => { h.subjectsCalls += 1; return { subjects: [], classLabel: "Class 7", loading: false }; } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/useAdaptiveTestScoring", () => ({
  useAdaptiveTestScoring: () => ({ data: { rules: { enabled: false, marks_per_correct: 1, negative_marks_per_wrong: 0.25 }, can_edit: true, school_id: "s" }, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useSaveAdaptiveTestScoring: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useSpacedRepetition", () => ({
  useDailyReviewScoring: () => ({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() }),
  useSaveDailyReviewScoring: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = { select: () => chain, eq: () => chain, then: (r: any) => Promise.resolve({ data: [] }).then(r) };
  return { supabase: { from: () => chain, functions: { invoke: vi.fn(async (_n: string, { body }: any) => ({ data: body.action === "list" ? h.listResponse : {}, error: null })) } } };
});

import AdaptiveTest, { QuestionView, ResultView } from "@/pages/AdaptiveTest";

const rules = { enabled: true, marks_per_correct: 1, negative_marks_per_wrong: 0.25 };
const session = (scoring?: any): any => ({
  id: "s1", scope_type: "topic", scope_id: 1, scope_label: "Fractions", status: "in_progress", items_administered: 1, correct_count: 1,
  min_items: 6, max_items: 15, precision_pct: 40, started_at: "2026-11-10T00:00:00Z", ...(scoring ? { scoring } : {}),
});
const item: any = { item_id: "i1", seq: 2, stem: "What is 1/2 + 1/2?", options: { A: "0", B: "1", C: "2", D: "3" }, bloom_level: null };
const noop = () => {};
const renderQV = (props: object) => render(<QuestionView session={session()} item={item} selectedOption={null} setSelectedOption={noop} feedback={null} submitting={false} onSubmit={noop} onContinue={noop} isLastKnown={false} {...props} />);

const result = (scoring?: any): any => ({
  session: { ...session(), status: "completed", items_administered: 8, completed_at: "2026-11-10T00:10:00Z", stop_reason: "precision" },
  theta: 0.42, se: 0.31, scaled_score: 553, band: "proficient", provisional: false, calibrated_fraction: 0.8, accuracy: 0.75,
  by_objective: [{ learning_objective_id: 7, text: "Add fractions", answered: 8, correct: 6, p_mastery: 0.7 }], misconceptions: [],
  ...(scoring ? { scoring } : {}),
});
const MARKED = {
  enabled: true, rules,
  score: { total_questions: 8, correct: 6, wrong: 2, skipped: 0, unanswered: 0, marks_gained: 6, marks_deducted: 0.5, net: 5.5, max_possible: 8 },
  items: [
    { seq: 1, stem: "What is 2+2?", outcome: "correct", selected: "B", correct_option: "B", marks: 1, topic: "Addition" },
    { seq: 2, stem: "Capital of France?", outcome: "wrong", selected: "A", correct_option: "C", marks: -0.25, topic: "Europe" },
  ],
};

const wrap = (ui: React.ReactElement) => render(<MemoryRouter initialEntries={["/adaptive-test"]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider></MemoryRouter>);
beforeEach(() => { h.role = "student"; h.listResponse = { sessions: [] }; h.subjectsCalls = 0; });

describe("question screen", () => {
  it("shows the marking rules before the first answer when the test is marked", () => {
    renderQV({ session: session({ enabled: true, rules }) });
    expect(screen.getByTestId("rules-banner").textContent).toBe("Marks: +1 correct · −0.25 wrong · skipped 0");
  });
  it("shows the marks won or lost with the feedback", () => {
    const base = { is_correct: true, correct_option: "B", explanation: "Because.", mastery_before: 0.4, mastery_after: 0.5 };
    const { unmount } = renderQV({ session: session({ enabled: true, rules }), selectedOption: "B", feedback: { ...base, scoring: { enabled: true, counted: true, outcome: "correct", marks: 1 } } });
    expect(screen.getByTestId("answer-marks").textContent).toBe("+1 marks");
    expect(screen.getByText("Correct!")).toBeTruthy();
    unmount();
    renderQV({ session: session({ enabled: true, rules }), selectedOption: "A", feedback: { ...base, is_correct: false, scoring: { enabled: true, counted: true, outcome: "wrong", marks: -0.25 } } });
    expect(screen.getByTestId("answer-marks").textContent).toBe("−0.25 marks deducted");
    expect(screen.getByText("Not quite")).toBeTruthy();
  });
  it("looks exactly as before when marking is off", () => {
    renderQV({ selectedOption: "B", feedback: { is_correct: true, correct_option: "B", explanation: "Because.", mastery_before: null, mastery_after: null } });
    expect(screen.queryByTestId("rules-banner")).toBeNull();
    expect(screen.queryByTestId("answer-marks")).toBeNull();
    expect(screen.getByText("Correct!")).toBeTruthy();
  });
});

describe("result screen", () => {
  it("adds a marks breakdown and keeps the ability result exactly as it was", () => {
    render(<ResultView result={result(MARKED)} onDone={noop} />);
    // unchanged ability result
    expect(screen.getByText("553")).toBeTruthy();
    expect(screen.getByText("Proficient")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("Skill breakdown")).toBeTruthy();
    // new: marks
    expect(screen.getByTestId("final-score").textContent).toBe("5.5 / 8");
    expect(screen.getByTestId("tile-correct").textContent).toContain("6");
    expect(screen.getByTestId("tile-correct").textContent).toContain("+6 marks");
    expect(screen.getByTestId("tile-wrong").textContent).toContain("2");
    expect(screen.getByTestId("tile-wrong").textContent).toContain("−0.5 deducted");
    expect(screen.queryByTestId("tile-unanswered")).toBeNull();          // an adaptive test has no skipped questions
    expect(screen.getByText(/you chose A, the answer was C/)).toBeTruthy();
  });
  it("shows a negative total honestly", () => {
    const s = { ...MARKED, score: { ...MARKED.score, correct: 0, wrong: 8, marks_gained: 0, marks_deducted: 2, net: -2 } };
    render(<ResultView result={result(s)} onDone={noop} />);
    expect(screen.getByTestId("final-score").textContent).toBe("−2 / 8");
  });
  it("has no marks card when the test wasn't marked", () => {
    const { unmount } = render(<ResultView result={result({ enabled: false })} onDone={noop} />);
    expect(screen.queryByTestId("adaptive-marks")).toBeNull();
    unmount();
    render(<ResultView result={result()} onDone={noop} />);                // older server response without the field
    expect(screen.queryByTestId("adaptive-marks")).toBeNull();
    expect(screen.getByText("553")).toBeTruthy();
  });
});

describe("Adaptive Test page", () => {
  it("students see the test picker and past marks, never the rules editor", async () => {
    h.listResponse = { sessions: [
      { id: "a", scope_label: "Fractions", status: "completed", items_administered: 10, scaled_score: 540, band: "proficient", provisional: false, completed_at: "x", marks: { net: 6.5, max_possible: 10, correct: 7, wrong: 3 } },
      { id: "b", scope_label: "Decimals", status: "completed", items_administered: 8, scaled_score: 500, band: "developing", provisional: true, completed_at: "x" },
    ] };
    wrap(<AdaptiveTest />);
    expect(screen.getByText("Adaptive Test")).toBeTruthy();
    expect(screen.queryByTestId("adaptive-scoring-settings")).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId("past-marks")).toHaveLength(1));         // only the marked test shows marks
    expect(screen.getByTestId("past-marks").textContent).toBe("6.5/10 marks");
  });
  it.each(["principal"])("%s sees the Adaptive Test scoring rules and loads no student data", (role) => {
    h.role = role;
    wrap(<AdaptiveTest />);
    expect(screen.getByTestId("adaptive-scoring-settings")).toBeTruthy();
    expect(screen.getByText(/Adaptive Tests only/)).toBeTruthy();
    expect(screen.getByText(/scaled score, band and which questions come next do not change/)).toBeTruthy();
    expect(h.subjectsCalls).toBe(0);
  });
});

describe("only the principal gets the rules editor", () => {
  it.each(["admin", "school_admin", "teacher", "hod", "student"])("%s does not", (role) => {
    h.role = role;
    wrap(<AdaptiveTest />);
    expect(screen.queryByTestId("adaptive-scoring-settings")).toBeNull();
  });
});
