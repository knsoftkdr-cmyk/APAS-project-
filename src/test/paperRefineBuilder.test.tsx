// Chat to Refine Questions inside the Assessment Builder: tabs, restore-after-refresh, manual edit + history, and saving refined questions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const build = vi.fn();
const assign = vi.fn();
vi.mock("@/hooks/useExamIntelligence", () => ({
  useBuildManualPaper: () => ({ mutateAsync: build, isPending: false }),
  useAssignPaper: () => ({ mutateAsync: assign, isPending: false }),
}));
vi.mock("@/hooks/useLearningGroups", () => ({
  usePaperRefine: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTeacherCopilot: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useClassSubjectPicker", () => ({
  useClassSubjectPicker: () => ({
    classes: [{ id: "c1", name: "Class 8", label: "Class 8 - A" }], classId: "c1", setClassId: vi.fn(), selectedClass: { id: "c1", name: "Class 8", label: "Class 8 - A" },
    subjects: [{ bookId: 1, subject: "Maths" }], bookId: "", setBookId: vi.fn(), selectedSubject: { bookId: 1, subject: "Maths" }, loadingClasses: false, loadingSubjects: false,
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "teacher-1" }, profile: { id: "teacher-1" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }) }) } }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
window.HTMLElement.prototype.scrollIntoView = vi.fn();

import AssessmentBuilder from "@/pages/AssessmentBuilder";

const picked = (n: number, over: Record<string, unknown> = {}) => ({
  key: `mcq:00000000-0000-4000-8000-00000000000${n}`, kind: "mcq", id: `00000000-0000-4000-8000-00000000000${n}`, type: "mcq", stem: `Saved stem ${n}`,
  options: { A: "1", B: "2", C: "3", D: "4" }, correct_option: "A", explanation: "e", difficulty: "easy", bloom_level: "apply", default_marks: 2, topic: "Fractions", learning_objective_id: 11, marks: 2, ...over,
});
const seed = (items: unknown[]) => localStorage.setItem("apas.paperDraft.teacher-1", JSON.stringify({ v: 1, savedAt: new Date().toISOString(), title: "Unit test", instructions: "Answer all", targetTotal: "4", picked: items, history: [] }));
const renderIt = () => render(<MemoryRouter><AssessmentBuilder embedded /></MemoryRouter>);

describe("Assessment Builder + AI refine", () => {
  beforeEach(() => { localStorage.clear(); build.mockReset(); assign.mockReset(); });

  it("keeps the paper after a refresh (draft restored) and still lists its questions", async () => {
    seed([picked(1), picked(2)]);
    renderIt();
    expect(await screen.findByText(/Restored your unsaved test/)).toBeTruthy();
    expect(screen.getAllByText(/Saved stem/)).toHaveLength(2);
    expect((screen.getByPlaceholderText(/Test title/) as HTMLInputElement).value).toBe("Unit test");
    expect((screen.getByLabelText(/Required total marks/) as HTMLInputElement).value).toBe("4");
  });

  it("the ✨ button on a question opens the AI refine tab with that question selected", async () => {
    seed([picked(1), picked(2)]);
    renderIt(); await screen.findByText(/Restored your unsaved test/);
    expect(screen.getByRole("tab", { name: /Question bank/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Refine question 2 with AI" }));
    expect(screen.getByRole("tab", { name: /AI refine/ }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText(/Question 2 selected/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Convert to MCQ" })).toBeTruthy();
  });

  it("a manual edit replaces the question in the paper, records history, and can be restored", async () => {
    seed([picked(1), picked(2)]);
    renderIt(); await screen.findByText(/Restored your unsaved test/);
    fireEvent.click(screen.getByRole("button", { name: "Edit question 1" }));
    const stem = await screen.findByLabelText("Question");
    fireEvent.change(stem, { target: { value: "Edited by the teacher?" } });
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    await screen.findByText(/Edited by the teacher/);
    expect(screen.queryByText("Saved stem 1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /History \(1\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await screen.findByText("Saved stem 1");
    expect(screen.queryByText(/Edited by the teacher/)).toBeNull();
  });

  it("saving sends untouched questions by id and edited ones as validated custom questions", async () => {
    seed([picked(1), picked(2)]);
    build.mockResolvedValue({ paper_id: "p1", item_count: 2, total_marks: 4 }); assign.mockResolvedValue({ student_count: 3 });
    renderIt(); await screen.findByText(/Restored your unsaved test/);
    fireEvent.click(screen.getByRole("button", { name: "Edit question 1" }));
    fireEvent.change(await screen.findByLabelText("Question"), { target: { value: "Edited by the teacher?" } });
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    await screen.findByText(/Edited by the teacher/);
    fireEvent.click(screen.getByRole("button", { name: /Save & assign/ }));
    await waitFor(() => expect(build).toHaveBeenCalled());
    const items = build.mock.calls[0][0].items;
    expect(items[0]).toMatchObject({ kind: "custom", marks: 2, question: { stem: "Edited by the teacher?", type: "mcq", correct_option: "A", learning_objective_id: 11 } });
    expect(items[1]).toEqual({ kind: "mcq", id: "00000000-0000-4000-8000-000000000002", marks: 2 });
    await waitFor(() => expect(localStorage.getItem("apas.paperDraft.teacher-1")).toBeNull()); // draft cleared after a successful save
  });

  it("an invalid manual edit is blocked by validation (duplicate options)", async () => {
    seed([picked(1)]);
    renderIt(); await screen.findByText(/Restored your unsaved test/);
    fireEvent.click(screen.getByRole("button", { name: "Edit question 1" }));
    fireEvent.change(await screen.findByLabelText("Option B"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/same text/)).toBeTruthy();
    expect(screen.getAllByText("Saved stem 1").length).toBeGreaterThan(0);
  });
});
