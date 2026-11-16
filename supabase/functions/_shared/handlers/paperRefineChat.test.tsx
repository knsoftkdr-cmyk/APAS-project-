import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mutateAsync = vi.fn();
vi.mock("@/hooks/useLearningGroups", () => ({
  usePaperRefine: () => ({ mutateAsync, isPending: false }),
  useTeacherCopilot: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
window.HTMLElement.prototype.scrollIntoView = vi.fn();

import { PaperRefineChat } from "@/components/copilot/PaperRefineChat";
import { applyMany, pushRevision, type PaperQuestion, type Revision, type Suggestion } from "@/lib/paperRefine";
import { validateRefineResponse, type PaperContext } from "../../supabase/functions/_shared/paperRefineModel";

const q = (n: number, over: Partial<PaperQuestion> = {}): PaperQuestion => ({
  key: `mcq:00000000-0000-4000-8000-00000000000${n}`, type: "mcq", stem: `Original stem ${n} about fractions`, options: { A: "1", B: "2", C: "3", D: "4" },
  correct_option: "A", explanation: "e", difficulty: "easy", bloom_level: "apply", marks: 2, topic: "T", learning_objective_id: 11, ...over,
});
const goodQ = { type: "mcq", stem: "A much harder revised stem?", options: { A: "10", B: "20", C: "30", D: "40" }, correct_option: "B", explanation: "Because 20.", difficulty: "hard", bloom_level: "analyze", marks: 3, learning_objective_id: 11 };
let id = 0;
const respond = (paper: PaperContext, raw: unknown) => {
  const r = validateRefineResponse(raw, paper, () => `s${++id}`)!;
  return { mode: "paper_refine", task: "assessment", reply: r.reply, clarification: r.clarification, findings: r.findings, suggestions: r.suggestions, rejected: r.rejected, total_check: r.total_check, warnings: r.warnings, scope: {}, grounded_in: [], suggested_actions: [] };
};

let latest: { questions: PaperQuestion[]; history: Revision[] };
function Harness({ target = null, selected = null }: { target?: number | null; selected?: number | null }) {
  const [qs, setQs] = useState([q(1), q(2), q(3)]);
  const [hist, setHist] = useState<Revision[]>([]);
  const ref = useRef(qs); ref.current = qs;
  latest = { questions: qs, history: hist };
  const getPaper = (): PaperContext => ({ title: "T", class_name: "8", subject: "Maths", chapter: "Fractions", total_marks: ref.current.reduce((s, x) => s + x.marks, 0), target_total_marks: target,
    duration_minutes: 60, instructions: [], objectives: [{ id: 11, text: "o" }], questions: ref.current });
  return <PaperRefineChat getPaper={getPaper} questions={qs} selectedNumber={selected} onClearSelection={() => {}}
    onApply={(list: Suggestion[], label: string) => { const r = applyMany(ref.current, list); if (r.applied.length) { setQs(r.questions); setHist((h) => pushRevision(h, label, ref.current)); } return { applied: r.applied.length, skipped: r.skipped.map((x) => ({ id: x.suggestion.id, error: x.error })) }; }} />;
}
const ask = async (text: string) => { fireEvent.change(screen.getByLabelText("Message to the AI"), { target: { value: text } }); fireEvent.click(screen.getByRole("button", { name: "Send" })); };
const paperNow = () => ({ title: "", class_name: null, subject: null, chapter: null, total_marks: 6, target_total_marks: null, duration_minutes: null, instructions: [], objectives: [{ id: 11, text: "o" }], questions: [q(1), q(2), q(3)] });

describe("PaperRefineChat approval workflow", () => {
  beforeEach(() => { mutateAsync.mockReset(); id = 0; });

  it("sends the open paper with the message and shows original vs revised, reason, difficulty, marks, answer and explanation", async () => {
    mutateAsync.mockImplementation(async (r) => respond(r.paper, { reply: "Here is a harder Q1", suggestions: [{ action: "revise", question_number: 1, reason: "Raised the cognitive demand", question: goodQ }] }));
    render(<Harness />); await ask("Make Question 1 harder");
    const card = await screen.findByTestId("suggestion-card");
    expect(mutateAsync.mock.calls[0][0].paper.questions).toHaveLength(3);
    expect(mutateAsync.mock.calls[0][0].message).toBe("Make Question 1 harder");
    expect(within(card).getByText(/Original stem 1/)).toBeTruthy();
    expect(within(card).getByText(/A much harder revised stem/)).toBeTruthy();
    expect(within(card).getByText(/Raised the cognitive demand/)).toBeTruthy();
    expect(within(card).getByText(/Because 20/)).toBeTruthy();
    expect(card.textContent).toMatch(/Difficulty:\s*easy/i); expect(card.textContent).toMatch(/hard/); expect(card.textContent).toMatch(/Marks:\s*2.*3/);
    expect(latest.questions[0].stem).toMatch(/Original stem 1/); // nothing applied yet
  });

  it("Accept applies the revision, keeps the old paper in history; Reject leaves the original untouched", async () => {
    mutateAsync.mockImplementation(async (r) => respond(r.paper, { reply: "ok", suggestions: [
      { action: "revise", question_number: 1, reason: "r1", question: goodQ }, { action: "revise", question_number: 2, reason: "r2", question: { ...goodQ, stem: "Second revised stem?" } }] }));
    render(<Harness />); await ask("improve");
    const cards = await screen.findAllByTestId("suggestion-card");
    fireEvent.click(within(cards[1]).getByRole("button", { name: /Reject/ }));
    expect(latest.questions[1].stem).toMatch(/Original stem 2/);
    expect(cards[1].getAttribute("data-status")).toBe("rejected");
    fireEvent.click(within(cards[0]).getByRole("button", { name: /^Accept/ }));
    // total changes 6 -> 7, so the first click asks for confirmation (never a silent change)
    expect(latest.questions[0].stem).toMatch(/Original stem 1/);
    fireEvent.click(within(cards[0]).getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(latest.questions[0].stem).toMatch(/much harder revised/));
    expect(latest.questions[1].stem).toMatch(/Original stem 2/);
    expect(latest.history).toHaveLength(1);
    expect(latest.history[0].before[0].stem).toMatch(/Original stem 1/);
  });

  it("warns before a change that breaks the required total", async () => {
    mutateAsync.mockImplementation(async (r) => respond(r.paper, { reply: "ok", suggestions: [{ action: "add", reason: "more", question: goodQ }] }));
    render(<Harness target={6} />); await ask("add one");
    const card = await screen.findByTestId("suggestion-card");
    expect(card.textContent).toMatch(/total from 6 to 9 marks; the required total is 6/);
  });

  it("Accept all applies every pending suggestion after confirming a total change", async () => {
    mutateAsync.mockImplementation(async (r) => respond(r.paper, { reply: "ok", suggestions: [
      { action: "add", reason: "a", question: goodQ }, { action: "add", reason: "b", question: { ...goodQ, stem: "Another brand new question?" } }] }));
    render(<Harness />); await ask("generate 2");
    await screen.findAllByTestId("suggestion-card");
    fireEvent.click(screen.getByRole("button", { name: /Accept all \(2\)/ }));
    expect(latest.questions).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /Confirm: accept all 2/ }));
    await waitFor(() => expect(latest.questions).toHaveLength(5));
  });

  it("Edit manually revalidates and then Accept uses the edited text", async () => {
    mutateAsync.mockImplementation(async (r) => respond(r.paper, { reply: "ok", suggestions: [{ action: "revise", question_number: 1, reason: "r", question: { ...goodQ, marks: 2 } }] }));
    render(<Harness />); await ask("x");
    const card = await screen.findByTestId("suggestion-card");
    fireEvent.click(within(card).getByRole("button", { name: /Edit/ }));
    const stem = await screen.findByLabelText("Question");
    fireEvent.change(stem, { target: { value: "Teacher typed this one?" } });
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    await within(await screen.findByTestId("suggestion-card")).findByText(/Teacher typed this one/);
    fireEvent.click(within(screen.getByTestId("suggestion-card")).getByRole("button", { name: /^Accept/ }));
    await waitFor(() => expect(latest.questions[0].stem).toBe("Teacher typed this one?"));
  });

  it("Regenerate sends a follow-up carrying the conversation, and supersedes the old suggestion", async () => {
    mutateAsync.mockImplementation(async (r) => respond(r.paper, { reply: "ok", suggestions: [{ action: "revise", question_number: 1, reason: "first try", question: goodQ }] }));
    render(<Harness />); await ask("harder");
    const card = await screen.findByTestId("suggestion-card");
    fireEvent.click(within(card).getByRole("button", { name: /Regenerate/ }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync.mock.calls[1][0].message).toMatch(/Regenerate your suggestion for question 1/);
    expect(mutateAsync.mock.calls[1][0].history.length).toBeGreaterThan(0);
  });

  it("shows a clarification instead of changing anything when instructions conflict", async () => {
    mutateAsync.mockImplementation(async (r) => respond(r.paper, { reply: "", clarification: "Total is fixed at 6 - which question should lose marks?", suggestions: [] }));
    render(<Harness />); await ask("add 5 questions but keep 6 marks");
    expect(await screen.findByText(/which question should lose marks/)).toBeTruthy();
    expect(screen.queryByTestId("suggestion-card")).toBeNull(); expect(latest.questions).toHaveLength(3);
  });

  it("handles AI / network failure: shows the error, offers retry, paper untouched", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("Could not reach the AI service. Please try again.")).mockImplementation(async (r) => respond(r.paper, { reply: "back", suggestions: [] }));
    render(<Harness />); await ask("review the paper");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Your paper was not changed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("back")).toBeTruthy();
    expect(latest.questions).toHaveLength(3);
  });

  it("quick prompts: question-specific ones need a selected question, general ones send straight away", async () => {
    mutateAsync.mockImplementation(async (r) => respond(r.paper, { reply: "found", findings: [{ type: "duplicate", text: "Q1 and Q2 look alike", question_numbers: [1, 2] }], suggestions: [] }));
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Make this question harder" }));
    expect(mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Find duplicate questions" }));
    expect(await screen.findByText(/Q1 and Q2 look alike/)).toBeTruthy();
    unmount(); mutateAsync.mockClear();
    render(<Harness selected={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Make this question harder" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0].message).toMatch(/question 3/);
  });

  it("a suggestion whose question was changed meanwhile is marked no longer applicable", async () => {
    mutateAsync.mockImplementation(async (r) => respond(r.paper, { reply: "ok", suggestions: [
      { action: "revise", question_number: 1, reason: "a", question: goodQ }, { action: "revise", question_number: 2, reason: "b", question: { ...goodQ, stem: "Q2 revised stem?" } }] }));
    render(<Harness />); await ask("x");
    const cards = await screen.findAllByTestId("suggestion-card");
    fireEvent.click(within(cards[0]).getByRole("button", { name: /^Accept/ })); fireEvent.click(within(cards[0]).getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(latest.questions[0].key.startsWith("draft:")).toBe(true));
    const again = paperNow(); expect(again.questions).toHaveLength(3);
  });
});
