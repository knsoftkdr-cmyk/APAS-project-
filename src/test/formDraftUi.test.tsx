import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "student-1" }, profile: { school_id: "school-1" } }),
}));

// In-memory fake of the server (form_drafts) behind the api module.
const server = new Map<string, { payload: unknown; clientUpdatedMs: number }>();
vi.mock("@/lib/drafts/draftApi", () => ({
  saveServerDraft: vi.fn(async (a: { formType: string; recordKey: string; payload: unknown; clientUpdatedMs: number }) => {
    const k = `${a.formType}|${a.recordKey}`;
    const cur = server.get(k);
    if (cur && cur.clientUpdatedMs > a.clientUpdatedMs) return { status: "conflict", draft: { payload: cur.payload, baseHash: null, clientUpdatedMs: cur.clientUpdatedMs, version: 2 } };
    server.set(k, { payload: a.payload, clientUpdatedMs: a.clientUpdatedMs });
    return { status: "saved", version: 1 };
  }),
  fetchServerDraft: vi.fn(async (_u: string, f: string, r: string) => {
    const d = server.get(`${f}|${r}`);
    return { ok: true, draft: d ? { payload: d.payload, baseHash: null, clientUpdatedMs: d.clientUpdatedMs, version: 1 } : null };
  }),
  deleteServerDraft: vi.fn(async (_u: string, f: string, r: string) => { server.delete(`${f}|${r}`); return true; }),
  saveServerDraftOnUnload: vi.fn(() => true),
}));

import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftStatus } from "@/components/drafts/DraftStatus";
import { DraftRecoveryDialog } from "@/components/drafts/DraftRecoveryDialog";
import { readLocalDraft } from "@/lib/drafts/draftStorage";
import { __resetClearedForTests } from "@/lib/drafts/draftSession";

let submitted: string[] = [];

function Form() {
  const [answer, setAnswer] = useState("");
  const draft = useFormDraft<{ answer: string }>({
    formType: "student_homework", recordKey: "hw-1", value: { answer },
    isEmpty: (v) => !v.answer.trim(),
    onRestore: (p) => setAnswer(p.answer),
  });
  return (
    <div>
      <textarea aria-label="answer" value={answer} onChange={(e) => setAnswer(e.target.value)} />
      <DraftStatus draft={draft} />
      <DraftRecoveryDialog draft={draft} noun="answers draft" />
      <button onClick={async () => { submitted.push(answer); await draft.markSubmitted(); setAnswer(""); }}>Submit</button>
    </div>
  );
}

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); server.clear(); submitted = []; __resetClearedForTests(); Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Auto-save UI flow", () => {
  it("shows Saving... then Saved, restores after a refresh when the user agrees, and clears on submit", async () => {
    const first = render(<Form />);
    await flush();
    fireEvent.change(screen.getByLabelText("answer"), { target: { value: "photosynthesis is..." } });
    expect(screen.getByTestId("draft-status").textContent).toContain("Saving...");
    await flush(1600);
    expect(screen.getByTestId("draft-status").textContent).toContain("Saved");
    expect(server.size).toBe(1);

    // "refresh": the page and its in-memory state are gone, storage and server remain.
    first.unmount();
    render(<Form />);
    await flush();
    expect(screen.getByText(/Restore your unsaved answers draft\?/)).toBeTruthy();
    expect((screen.getByLabelText("answer") as HTMLTextAreaElement).value).toBe(""); // nothing applied yet
    fireEvent.click(screen.getByText("Restore draft"));
    await flush();
    expect((screen.getByLabelText("answer") as HTMLTextAreaElement).value).toBe("photosynthesis is...");

    expect(submitted).toEqual([]); // auto-save never submits
    fireEvent.click(screen.getByText("Submit"));
    await flush(2000);
    expect(submitted).toEqual(["photosynthesis is..."]);
    expect(server.size).toBe(0);
    expect(readLocalDraft("student-1", "student_homework", "hw-1")).toBeNull();
  });

  it("Discard throws the recovered draft away", async () => {
    const first = render(<Form />);
    await flush();
    fireEvent.change(screen.getByLabelText("answer"), { target: { value: "draft text" } });
    await flush(1600);
    first.unmount();
    render(<Form />);
    await flush();
    fireEvent.click(screen.getByText("Discard draft"));
    await flush();
    expect((screen.getByLabelText("answer") as HTMLTextAreaElement).value).toBe("");
    expect(server.size).toBe(0);
    expect(readLocalDraft("student-1", "student_homework", "hw-1")).toBeNull();
  });

  it("shows 'Saved offline' while disconnected and syncs when back online", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    render(<Form />);
    await flush();
    fireEvent.change(screen.getByLabelText("answer"), { target: { value: "offline work" } });
    await flush(2000);
    expect(screen.getByTestId("draft-status").textContent).toContain("Saved offline");
    expect(server.size).toBe(0);
    expect(readLocalDraft("student-1", "student_homework", "hw-1")?.payload).toEqual({ answer: "offline work" });
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    await act(async () => { window.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(50); });
    expect(screen.getByTestId("draft-status").textContent).toBe("Saved");
    expect(server.size).toBe(1);
  });
});
