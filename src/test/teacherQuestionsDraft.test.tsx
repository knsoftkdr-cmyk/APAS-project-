import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "teacher-1" }, profile: { school_id: "s1" } }) }));
const server = new Map<string, { payload: unknown; ms: number }>();
vi.mock("@/lib/drafts/draftApi", () => ({
  saveServerDraft: vi.fn(async (a: any) => { server.set(`${a.formType}|${a.recordKey}`, { payload: a.payload, ms: a.clientUpdatedMs }); return { status: "saved", version: 1 }; }),
  fetchServerDraft: vi.fn(async (_u: string, f: string, r: string) => { const d = server.get(`${f}|${r}`); return { ok: true, draft: d ? { payload: d.payload, baseHash: null, clientUpdatedMs: d.ms, version: 1 } : null }; }),
  deleteServerDraft: vi.fn(async () => true),
  saveServerDraftOnUnload: vi.fn(() => true),
}));

import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftRecoveryDialog } from "@/components/drafts/DraftRecoveryDialog";
import { __resetClearedForTests } from "@/lib/drafts/draftSession";

const EXIT: Record<string, string[]> = { "1": ["Q1 original", "Q2 original"], "2": ["P2 Q1", "P2 Q2"] };

// Same structure as AssignHomeworkTab: a period picker, an effect that resets the questions when the period
// changes, and the draft hook keyed by lesson+period with the untouched questions as baseline.
function Screen({ assigned }: { assigned?: string[] }) {
  const [period, setPeriod] = useState("1");
  const [edited, setEdited] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const extracted = EXIT[period];
  const baseline = assigned ?? extracted;
  useEffect(() => { setEdited(baseline); setAdded([]); }, [period]);
  const draft = useFormDraft<{ edited: string[]; added: string[] }>({
    formType: "teacher_homework_questions", recordKey: assigned ? null : `lesson-1|A|B|${period}`,
    value: { edited, added }, baseline: { edited: baseline, added: [] },
    onRestore: (p) => { setEdited(p.edited); setAdded(p.added); },
  });
  return (
    <div>
      <button onClick={() => setPeriod("1")}>period1</button><button onClick={() => setPeriod("2")}>period2</button>
      <ul>{edited.concat(added).map((q, i) => <li key={i}>{q}</li>)}</ul>
      <button onClick={() => setEdited((e) => [e[0] + " EDITED", ...e.slice(1)])}>edit</button>
      <DraftRecoveryDialog draft={draft} noun="question edits" />
    </div>
  );
}
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); server.clear(); __resetClearedForTests(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("teacher question edits survive switching periods", () => {
  it("offers the edited question back when the period is reopened, and never leaks it into another period", async () => {
    render(<Screen />);
    await flush();
    fireEvent.click(screen.getByText("edit"));
    await flush(100);               // switch away quickly (before the debounce) - must still be kept
    fireEvent.click(screen.getByText("period2"));
    await flush(200);
    expect(screen.queryByText(/EDITED/)).toBeNull();           // period 2 shows its own questions
    expect(screen.getByText("P2 Q1")).toBeTruthy();
    expect(screen.queryByText(/Restore your unsaved/)).toBeNull(); // and has no draft of its own (no leakage)

    fireEvent.click(screen.getByText("period1"));
    await flush(200);
    expect(screen.getByText(/Restore your unsaved question edits\?/)).toBeTruthy();
    fireEvent.click(screen.getByText("Restore draft"));
    await flush();
    expect(screen.getByText("Q1 original EDITED")).toBeTruthy();
  });
  it("an already-assigned period shows the assigned questions and creates no drafts", async () => {
    render(<Screen assigned={["Q1 as assigned (edited by teacher)", "Q2 original"]} />);
    await flush(200);
    expect(screen.getByText("Q1 as assigned (edited by teacher)")).toBeTruthy();
    expect(screen.queryByText("Q1 original")).toBeNull();
    await flush(3000);
    expect(server.size).toBe(0);
  });
});
