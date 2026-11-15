import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rateMock = vi.fn();
const reportMock = vi.fn();
vi.mock("@/hooks/useFlashcards", () => ({
  useRateFlashcard: () => ({ mutateAsync: rateMock, isPending: false }),
  useReportFlashcard: () => ({ mutateAsync: reportMock, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { FlipCard } from "@/components/flashcards/FlipCard";
import { StudySession } from "@/components/flashcards/StudySession";
import type { StudyCard } from "@/lib/flashcards";

const mk = (id: string, over: Partial<StudyCard> = {}): StudyCard => ({
  id, card_type: "definition", question: `Question ${id}?`, answer: `Answer ${id}`, hint: null, difficulty: "easy",
  topic_id: 1, topic_name: "Photosynthesis", chapter_name: "Plants", source_pages: [12], grounding: "textbook",
  state: "new", times_seen: 0, times_correct: 0, last_rating: null,
  preview: { easy: "in 3 days", medium: "tomorrow", difficult: "in 10 min" }, ...over,
});

beforeEach(() => { rateMock.mockReset(); reportMock.mockReset(); rateMock.mockResolvedValue({ correct: true, daily_review_pulled: false, duplicate: false }); });

describe("FlipCard", () => {
  it("shows the question first and flips to the answer on tap", () => {
    const onFlip = vi.fn();
    const { rerender } = render(<FlipCard card={mk("a")} flipped={false} onFlip={onFlip} />);
    expect(screen.getByTestId("flip-card").dataset.flipped).toBe("false");
    fireEvent.click(screen.getByLabelText("Show the answer"));
    expect(onFlip).toHaveBeenCalledTimes(1);
    rerender(<FlipCard card={mk("a")} flipped onFlip={onFlip} />);
    expect(screen.getByTestId("flip-card").dataset.flipped).toBe("true");
    expect(screen.getByTestId("card-answer").textContent).toBe("Answer a");
  });

  it("names the textbook page the card came from, and reveals the hint only on request", () => {
    render(<FlipCard card={mk("a", { hint: "Think of sunlight" })} flipped={false} onFlip={() => {}} />);
    expect(screen.getByText(/page 12/)).toBeTruthy();
    expect(screen.queryByText("Think of sunlight")).toBeNull();
    fireEvent.click(screen.getByText(/Need a hint/));
    expect(screen.getByText("Think of sunlight")).toBeTruthy();
  });
});

describe("StudySession", () => {
  it("only offers Easy / Medium / Difficult after the card is flipped, with the next-review time", () => {
    render(<StudySession cards={[mk("a")]} onExit={() => {}} />);
    expect(screen.queryByText("Difficult")).toBeNull();
    fireEvent.click(screen.getByText("Show answer"));
    expect(screen.getByText("Easy")).toBeTruthy();
    expect(screen.getByText("Medium")).toBeTruthy();
    expect(screen.getByText("Difficult")).toBeTruthy();
    expect(screen.getByText("in 3 days")).toBeTruthy();
    expect(screen.getByText("in 10 min")).toBeTruthy();
  });

  it("saves the chosen rating, moves on, and finishes with a summary", async () => {
    render(<StudySession cards={[mk("a")]} onExit={() => {}} />);
    fireEvent.click(screen.getByText("Show answer"));
    fireEvent.click(screen.getByText("Easy"));
    await waitFor(() => expect(screen.getByTestId("session-summary")).toBeTruthy());
    expect(rateMock).toHaveBeenCalledWith(expect.objectContaining({ flashcardId: "a", rating: "easy" }));
  });

  it("brings a Difficult card back later in the same session", async () => {
    rateMock.mockResolvedValue({ correct: false, daily_review_pulled: true, duplicate: false });
    render(<StudySession cards={[mk("a"), mk("b")]} onExit={() => {}} />);
    fireEvent.click(screen.getByText("Show answer"));
    fireEvent.click(screen.getByText("Difficult"));
    await waitFor(() => expect(screen.getByText("Question b?")).toBeTruthy());
    expect(screen.getByText(/of 3/)).toBeTruthy();                     // queue grew: a, b, a
    fireEvent.click(screen.getByText("Show answer"));
    fireEvent.click(screen.getByText("Easy"));
    await waitFor(() => expect(screen.getByText("Question a?")).toBeTruthy());
  });

  it("does not move on when saving fails", async () => {
    rateMock.mockRejectedValue(new Error("offline"));
    render(<StudySession cards={[mk("a")]} onExit={() => {}} />);
    fireEvent.click(screen.getByText("Show answer"));
    fireEvent.click(screen.getByText("Medium"));
    await waitFor(() => expect(rateMock).toHaveBeenCalled());
    expect(screen.queryByTestId("session-summary")).toBeNull();
    expect(screen.getByText("Question a?")).toBeTruthy();
  });

  it("supports keyboard: Space flips, 1/2/3 rate", async () => {
    render(<StudySession cards={[mk("a")]} onExit={() => {}} />);
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByText("How was that one?")).toBeTruthy();
    fireEvent.keyDown(window, { key: "3" });
    await waitFor(() => expect(rateMock).toHaveBeenCalledWith(expect.objectContaining({ rating: "difficult" })));
  });

  it("lets the student report a wrong card and drops it from the session", async () => {
    reportMock.mockResolvedValue({ reported: true, retired: false });
    render(<StudySession cards={[mk("a"), mk("b")]} onExit={() => {}} />);
    fireEvent.click(screen.getByText(/Something looks wrong/));
    await waitFor(() => expect(screen.getByText("Question b?")).toBeTruthy());
    expect(reportMock).toHaveBeenCalledWith("a");
  });
});
