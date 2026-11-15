/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory Supabase / hook stand-ins are intentionally loosely typed */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ role: "student" as string, answers: [] as any[], snoozes: [] as any[], queueCalls: 0 }));

const R = (n: number, id: string) => ({
  schedule_id: id, learning_objective_id: 7, objective_text: "o", difficulty: "easy", subtopic_id: 1, subtopic_name: "s", topic_id: 1,
  topic_name: `Topic ${n}`, chapter_name: "Ch", subject: "Maths", class_name: "7", p_mastery: 0.4, due_at: "2026-11-10T00:00:00Z", days_overdue: 0,
  repetitions: 1, lapses: 0, ease_factor: 2.5,
  item: { item_id: `item-${n}`, stem: `Question ${n}?`, options: { A: "a", B: "b", C: "c", D: "d" }, bloom_level: null },
});
const QUEUE = { count: 3, reviews: [R(1, "s1"), R(2, "s2"), R(3, "s3")], scoring: { enabled: true, marks_per_correct: 1, negative_marks_per_wrong: 0.25 } };
const QUEUE_OFF = { ...QUEUE, scoring: { enabled: false, marks_per_correct: 1, negative_marks_per_wrong: 0.25 } };
let queue: any = QUEUE;

vi.mock("@/components/layout/PageShell", () => ({ PageShell: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: h.role } }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useSpacedRepetition", () => ({
  useDueReviews: () => { h.queueCalls += 1; return { data: queue, isLoading: false, isError: false, isFetching: false, error: null, refetch: vi.fn() }; },
  useReviewForecast: () => ({ data: undefined }),
  useAnswerReview: () => ({ isPending: false, mutateAsync: async (a: any) => { h.answers.push(a); return h.nextAnswer(a); } }),
  useSnoozeReview: () => ({ mutateAsync: async (a: any) => { h.snoozes.push(a); return {}; } }),
  useDailyReviewScoring: () => ({ data: { rules: { enabled: false, marks_per_correct: 1, negative_marks_per_wrong: 0.25 }, can_edit: true, school_id: "s" }, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useSaveDailyReviewScoring: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
(h as any).nextAnswer = (_a: any) => ({});

import DailyReview from "@/pages/DailyReview";

const session = (o: object) => ({ total_questions: 3, correct: 0, wrong: 0, skipped: 0, unanswered: 3, marks_gained: 0, marks_deducted: 0, net: 0, max_possible: 3, ...o });
const submitOption = (letter: string) => { fireEvent.click(screen.getByText(letter.toLowerCase(), { selector: "span" })); fireEvent.click(screen.getByText("Submit")); };

beforeEach(() => { h.role = "student"; h.answers = []; h.snoozes = []; h.queueCalls = 0; queue = QUEUE; });

describe("Daily Review page - student with negative marking ON", () => {
  it("shows the rules, marks each answer, and ends with the full breakdown and final score", async () => {
    const results = [
      { is_correct: true, correct_option: "B", explanation: null, p_mastery_before: .4, p_mastery_after: .5, scoring: { enabled: true, counted: true, outcome: "correct", marks: 1, session: session({ correct: 1, marks_gained: 1, net: 1, unanswered: 2 }) } },
      { is_correct: false, correct_option: "C", explanation: null, p_mastery_before: .4, p_mastery_after: .3, scoring: { enabled: true, counted: true, outcome: "wrong", marks: -0.25, session: session({ correct: 1, wrong: 1, marks_gained: 1, marks_deducted: 0.25, net: 0.75, unanswered: 1 }) } },
    ];
    (h as any).nextAnswer = () => results.shift();
    render(<DailyReview />);

    expect(screen.getByTestId("rules-banner").textContent).toBe("Marks: +1 correct · −0.25 wrong · skipped 0");

    submitOption("B");                                           // correct
    await waitFor(() => expect(screen.getByTestId("answer-marks").textContent).toBe("+1 marks"));
    fireEvent.click(screen.getByText("Next"));

    submitOption("A");                                           // wrong
    await waitFor(() => expect(screen.getByTestId("answer-marks").textContent).toBe("−0.25 marks deducted"));
    fireEvent.click(screen.getByText("Next"));

    fireEvent.click(screen.getByText("Remind me tomorrow"));     // skipped: 0 marks
    await waitFor(() => expect(screen.getByTestId("session-results")).toBeTruthy());

    expect(screen.getByTestId("final-score").textContent).toBe("0.75 / 3");
    expect(screen.getByTestId("tile-correct").textContent).toContain("+1 marks");
    expect(screen.getByTestId("tile-wrong").textContent).toContain("−0.25 deducted");
    expect(screen.getByTestId("tile-unanswered").textContent).toContain("1");
    expect(screen.getByText(/you chose A, the answer was C/)).toBeTruthy();
  });

  it("sends the session id + size with every answer and the schedule with a skip, so the server can score them", async () => {
    (h as any).nextAnswer = () => ({ is_correct: true, correct_option: "B", explanation: null, p_mastery_before: 0, p_mastery_after: 0, scoring: { enabled: true, counted: true, outcome: "correct", marks: 1, session: session({}) } });
    render(<DailyReview />);
    submitOption("B");
    await waitFor(() => expect(h.answers).toHaveLength(1));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Remind me tomorrow"));
    await waitFor(() => expect(h.snoozes).toHaveLength(1));
    expect(h.answers[0]).toMatchObject({ scheduleId: "s1", itemId: "item-1", selectedOption: "B", sessionTotal: 3 });
    expect(typeof h.answers[0].sessionId).toBe("string");
    expect(h.snoozes[0]).toMatchObject({ scheduleId: "s2", sessionId: h.answers[0].sessionId });
  });

  it("a negative final score is shown as negative, not hidden", async () => {
    (h as any).nextAnswer = () => ({ is_correct: false, correct_option: "C", explanation: null, p_mastery_before: 0, p_mastery_after: 0, scoring: { enabled: true, counted: true, outcome: "wrong", marks: -0.25, session: session({ wrong: 3, marks_deducted: 0.75, net: -0.75, unanswered: 0 }) } });
    render(<DailyReview />);
    for (let i = 0; i < 3; i++) { submitOption("A"); await waitFor(() => screen.getByText(i === 2 ? "Finish" : "Next")); fireEvent.click(screen.getByText(i === 2 ? "Finish" : "Next")); }
    await waitFor(() => expect(screen.getByTestId("final-score").textContent).toBe("−0.75 / 3"));
  });
});

describe("Daily Review page - marking OFF is the screen it always was", () => {
  it("no banner, no marks, plain 'x of y correct' summary", async () => {
    queue = QUEUE_OFF;
    (h as any).nextAnswer = () => ({ is_correct: true, correct_option: "B", explanation: "Because", p_mastery_before: 0, p_mastery_after: 0, scoring: { enabled: false, counted: false } });
    render(<DailyReview />);
    expect(screen.queryByTestId("rules-banner")).toBeNull();
    submitOption("B");
    await waitFor(() => screen.getByText("Remembered it!"));
    expect(screen.queryByTestId("answer-marks")).toBeNull();
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Remind me tomorrow"));
    fireEvent.click(screen.getByText("Remind me tomorrow"));
    await waitFor(() => screen.getByText("Review complete!"));
    expect(screen.getByText("1 of 1 correct this session.")).toBeTruthy();
    expect(screen.queryByTestId("session-results")).toBeNull();
  });
});

describe("Daily Review page - admins", () => {
  it.each(["principal"])("%s sees the scoring rules and never loads a student queue", (role) => {
    h.role = role;
    render(<MemoryRouter initialEntries={["/daily-review"]}><DailyReview /></MemoryRouter>);
    expect(screen.getByTestId("scoring-settings")).toBeTruthy();
    expect(screen.queryByText("Submit")).toBeNull();
    expect(h.queueCalls).toBe(0);
  });
  it.each(["admin", "school_admin", "teacher", "hod"])("%s is not shown the rules editor (principal only)", (role) => {
    h.role = role;
    render(<DailyReview />);
    expect(screen.queryByTestId("scoring-settings")).toBeNull();
  });
  it("a student never sees the rules editor", () => {
    render(<DailyReview />);
    expect(screen.queryByTestId("scoring-settings")).toBeNull();
  });
});
