import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const saveMock = vi.fn();
let config: { rules: { enabled: boolean; marks_per_correct: number; negative_marks_per_wrong: number }; can_edit: boolean; school_id: string | null };
vi.mock("@/hooks/useSpacedRepetition", () => ({
  useDailyReviewScoring: () => ({ data: config, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useSaveDailyReviewScoring: () => ({ mutateAsync: saveMock, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ScoringSettings } from "@/components/dailyreview/ScoringSettings";
import { AnswerMarks, RulesBanner, SessionResults } from "@/components/dailyreview/MarksDisplay";

const rules = { enabled: true, marks_per_correct: 1, negative_marks_per_wrong: 0.25 };

describe("ScoringSettings (admin)", () => {
  beforeEach(() => {
    saveMock.mockReset(); saveMock.mockResolvedValue({});
    config = { rules: { enabled: false, marks_per_correct: 1, negative_marks_per_wrong: 0.25 }, can_edit: true, school_id: "s1" };
  });

  it("says it only affects Daily Review", () => {
    render(<ScoringSettings />);
    expect(screen.getByText(/Daily Review only/)).toBeTruthy();
    expect(screen.getByText(/assessments, quizzes, tests and exams are not affected/)).toBeTruthy();
  });

  it("saves valid rules with the numbers the admin typed", async () => {
    render(<ScoringSettings />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByLabelText("Marks for a correct answer"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Marks deducted for a wrong answer"), { target: { value: "1" } });
    expect(screen.getByTestId("scoring-example").textContent).toContain("= 26 / 40");
    fireEvent.click(screen.getByText("Save rules"));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ enabled: true, marks_per_correct: 4, negative_marks_per_wrong: 1 }));
  });

  it("blocks a penalty bigger than the marks and does not call the server", () => {
    render(<ScoringSettings />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByLabelText("Marks deducted for a wrong answer"), { target: { value: "3" } });
    expect(screen.getByRole("alert").textContent).toMatch(/more than the marks/);
    expect((screen.getByText("Save rules").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("is read-only for someone who can't edit", () => {
    config = { ...config, can_edit: false };
    render(<ScoringSettings />);
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Save rules").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Save stays disabled until something changes", () => {
    render(<ScoringSettings />);
    expect((screen.getByText("Save rules").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("what students see", () => {
  it("shows nothing at all when marking is off (legacy screen unchanged)", () => {
    const { container } = render(<><RulesBanner rules={{ ...rules, enabled: false }} /><AnswerMarks scoring={{ enabled: false, counted: false }} /></>);
    expect(container.textContent).toBe("");
  });

  it("explains the rules before the question", () => {
    render(<RulesBanner rules={rules} />);
    expect(screen.getByTestId("rules-banner").textContent).toBe("Marks: +1 correct · −0.25 wrong · skipped 0");
  });

  it("shows marks won, marks deducted, and a repeat submit", () => {
    const { rerender } = render(<AnswerMarks scoring={{ enabled: true, counted: true, outcome: "correct", marks: 1 }} />);
    expect(screen.getByTestId("answer-marks").textContent).toBe("+1 marks");
    rerender(<AnswerMarks scoring={{ enabled: true, counted: true, outcome: "wrong", marks: -0.25 }} />);
    expect(screen.getByTestId("answer-marks").textContent).toBe("−0.25 marks deducted");
    rerender(<AnswerMarks scoring={{ enabled: true, counted: false, duplicate: true }} />);
    expect(screen.getByTestId("answer-marks").textContent).toMatch(/already marked/);
  });

  it("final breakdown: correct, wrong, marks deducted, not answered, final score", () => {
    render(<SessionResults rules={rules} score={{ total_questions: 10, correct: 7, wrong: 2, skipped: 1, unanswered: 1, marks_gained: 7, marks_deducted: 0.5, net: 6.5, max_possible: 10 }}
      items={[
        { key: "a", stem: "What is 2+2?", outcome: "correct", marks: 1, topic: "Addition" },
        { key: "b", stem: "Capital of France?", outcome: "wrong", selected: "B", correctOption: "C", marks: -0.25, topic: "Europe" },
        { key: "c", stem: "Skipped one", outcome: "skipped", marks: 0, topic: "Misc" },
      ]} />);
    expect(screen.getByTestId("final-score").textContent).toBe("6.5 / 10");
    expect(screen.getByTestId("tile-correct").textContent).toContain("7");
    expect(screen.getByTestId("tile-correct").textContent).toContain("+7 marks");
    expect(screen.getByTestId("tile-wrong").textContent).toContain("2");
    expect(screen.getByTestId("tile-wrong").textContent).toContain("−0.5 deducted");
    expect(screen.getByTestId("tile-unanswered").textContent).toContain("0 marks");
    expect(screen.getByText(/you chose B, the answer was C/)).toBeTruthy();
  });

  it("shows a negative final score honestly", () => {
    render(<SessionResults rules={rules} score={{ total_questions: 3, correct: 0, wrong: 3, skipped: 0, unanswered: 0, marks_gained: 0, marks_deducted: 0.75, net: -0.75, max_possible: 3 }} items={[]} />);
    expect(screen.getByTestId("final-score").textContent).toBe("−0.75 / 3");
  });
});
