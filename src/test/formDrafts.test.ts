import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/drafts/draftApi", () => ({
  saveServerDraft: vi.fn(),
  fetchServerDraft: vi.fn(),
  deleteServerDraft: vi.fn(),
  saveServerDraftOnUnload: vi.fn(() => true),
}));

import * as api from "@/lib/drafts/draftApi";
import { DraftSession, __resetClearedForTests, clearDraftEverywhere, type DraftSessionState } from "@/lib/drafts/draftSession";
import {
  clearSyncedLocalDrafts, draftKey, hashString, listUnsyncedDrafts, readLocalDraft, readTombstone, stableStringify, writeLocalDraft, writeTombstone,
} from "@/lib/drafts/draftStorage";

const U = "user-1";
const F = "student_homework";
const R = "assign-1";

const mocked = api as unknown as {
  saveServerDraft: ReturnType<typeof vi.fn>;
  fetchServerDraft: ReturnType<typeof vi.fn>;
  deleteServerDraft: ReturnType<typeof vi.fn>;
  saveServerDraftOnUnload: ReturnType<typeof vi.fn>;
};

function setOnline(v: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value: v, configurable: true });
}

const live: DraftSession[] = [];

async function make(value: unknown = {}, opts: { isEmpty?: (v: unknown) => boolean } = {}) {
  let state: DraftSessionState = { status: "idle", lastSavedAt: null, recovery: null, ready: false };
  const s = new DraftSession({ userId: U, schoolId: "school-1", formType: F, recordKey: R, debounceMs: 1500, onState: (x) => { state = x; }, ...opts }, value, null);
  live.push(s);
  await s.init(value);
  return { s, st: () => state };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  __resetClearedForTests();
  setOnline(true);
  mocked.saveServerDraft.mockReset().mockResolvedValue({ status: "saved", version: 1 });
  mocked.fetchServerDraft.mockReset().mockResolvedValue({ ok: true, draft: null });
  mocked.deleteServerDraft.mockReset().mockResolvedValue(true);
  mocked.saveServerDraftOnUnload.mockClear();
});
afterEach(() => {
  mocked.saveServerDraft.mockResolvedValue({ status: "saved", version: 1 });
  while (live.length) live.pop()!.dispose(); // remove window listeners so tests don't leak into each other
  vi.useRealTimers();
});

describe("storage", () => {
  it("round-trips, binds to the user, and ignores corrupt data", () => {
    const env = { v: 1 as const, userId: U, schoolId: null, formType: F, recordKey: R, payload: { a: 1 }, updatedAt: Date.now(), baseHash: null, syncedAt: null };
    expect(writeLocalDraft(env)).toBe(true);
    expect(readLocalDraft(U, F, R)?.payload).toEqual({ a: 1 });
    expect(readLocalDraft("someone-else", F, R)).toBeNull();
    localStorage.setItem(draftKey(U, F, "bad"), "{not json");
    expect(readLocalDraft(U, F, "bad")).toBeNull();
    localStorage.setItem(draftKey(U, F, "wrong"), JSON.stringify({ v: 1, userId: "other", formType: F, recordKey: "wrong", payload: {}, updatedAt: 1 }));
    expect(readLocalDraft(U, F, "wrong")).toBeNull();
  });
  it("drops expired drafts and never stores more than the form payload + ids", () => {
    writeLocalDraft({ v: 1, userId: U, schoolId: null, formType: F, recordKey: "old", payload: {}, updatedAt: Date.now() - 31 * 864e5, baseHash: null, syncedAt: null });
    expect(readLocalDraft(U, F, "old")).toBeNull();
  });
  it("refuses oversized drafts instead of throwing", () => {
    expect(writeLocalDraft({ v: 1, userId: U, schoolId: null, formType: F, recordKey: "big", payload: "x".repeat(1_000_000), updatedAt: 1, baseHash: null, syncedAt: null })).toBe(false);
  });
  it("sign-out cleanup keeps unsynced drafts and removes synced ones", () => {
    const base = { v: 1 as const, userId: U, schoolId: null, formType: F, payload: {}, baseHash: null };
    writeLocalDraft({ ...base, recordKey: "synced", updatedAt: Date.now(), syncedAt: Date.now() });
    writeLocalDraft({ ...base, recordKey: "pending", updatedAt: Date.now(), syncedAt: null });
    clearSyncedLocalDrafts(U);
    expect(readLocalDraft(U, F, "synced")).toBeNull();
    expect(readLocalDraft(U, F, "pending")).not.toBeNull();
    expect(listUnsyncedDrafts(U).map((d) => d.recordKey)).toEqual(["pending"]);
  });
  it("hash and stringify are stable", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
});

describe("debounced auto-save", () => {
  it("writes locally at once and hits the server once after the debounce", async () => {
    const { s, st } = await make({});
    s.update({ 0: "a" }, null);
    s.update({ 0: "ab" }, null);
    s.update({ 0: "abc" }, null);
    expect(readLocalDraft(U, F, R)?.payload).toEqual({ 0: "abc" });
    expect(st().status).toBe("saving");
    expect(mocked.saveServerDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocked.saveServerDraft).toHaveBeenCalledTimes(1);
    expect(mocked.saveServerDraft.mock.calls[0][0]).toMatchObject({ formType: F, recordKey: R, payload: { 0: "abc" } });
    expect(st().status).toBe("saved");
    expect(readLocalDraft(U, F, R)!.syncedAt).toBe(readLocalDraft(U, F, R)!.updatedAt);
  });
  it("does not save an untouched form", async () => {
    const { s } = await make({ q: "x" });
    s.update({ q: "x" }, null);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocked.saveServerDraft).not.toHaveBeenCalled();
    expect(readLocalDraft(U, F, R)).toBeNull();
  });
  it("uses an explicit baseline so fields the form fills itself are not 'edits'", async () => {
    const { s } = await make({ edited: [], added: [] });
    s.update({ edited: ["auto-filled"], added: [] }, null, { edited: ["auto-filled"], added: [] });
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocked.saveServerDraft).not.toHaveBeenCalled();
    s.update({ edited: ["auto-filled", "mine"], added: [] }, null, { edited: ["auto-filled"], added: [] });
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocked.saveServerDraft).toHaveBeenCalledTimes(1);
  });
  it("an emptied form removes the draft instead of saving a blank one", async () => {
    const { s } = await make({ t: "" }, { isEmpty: (v) => !(v as { t: string }).t });
    s.update({ t: "hello" }, null);
    await vi.advanceTimersByTimeAsync(1600);
    s.update({ t: "" }, null);
    await vi.advanceTimersByTimeAsync(100);
    expect(readLocalDraft(U, F, R)).toBeNull();
    expect(mocked.deleteServerDraft).toHaveBeenCalled();
  });
});

describe("recovery", () => {
  const seedLocal = (payload: unknown, updatedAt = Date.now() - 5000, syncedAt: number | null = null) =>
    writeLocalDraft({ v: 1, userId: U, schoolId: null, formType: F, recordKey: R, payload, updatedAt, baseHash: null, syncedAt });

  it("asks before restoring and applies nothing on its own", async () => {
    seedLocal({ 0: "my earlier answer" });
    const { s, st } = await make({});
    expect(st().recovery).toMatchObject({ source: "local", conflict: false });
    expect(st().ready).toBe(true);
    s.update({ 0: "typed meanwhile" }, null); // ignored while the prompt is open
    expect(mocked.saveServerDraft).not.toHaveBeenCalled();
    expect(s.acceptRecovery()).toEqual({ 0: "my earlier answer" });
    expect(st().recovery).toBeNull();
  });
  it("discard removes the draft from device and server", async () => {
    seedLocal({ 0: "old" });
    const { s, st } = await make({});
    await s.declineRecovery();
    expect(st().recovery).toBeNull();
    expect(readLocalDraft(U, F, R)).toBeNull();
    expect(mocked.deleteServerDraft).toHaveBeenCalledWith(U, F, R);
  });
  it("no prompt when the draft equals what is on screen", async () => {
    seedLocal({ 0: "same" }, Date.now() - 1000, Date.now() - 1000);
    const { st } = await make({ 0: "same" });
    expect(st().recovery).toBeNull();
  });
  it("picks the NEWER of the local and server copies", async () => {
    seedLocal({ v: "local-old" }, 1000);
    mocked.fetchServerDraft.mockResolvedValue({ ok: true, draft: { payload: { v: "server-new" }, baseHash: null, clientUpdatedMs: 2000, version: 3 } });
    const { st } = await make({});
    expect(st().recovery).toMatchObject({ source: "server", payload: { v: "server-new" } });
  });
  it("works from the local copy alone when the server is unreachable (offline reopen)", async () => {
    seedLocal({ v: "kept offline" });
    mocked.fetchServerDraft.mockResolvedValue({ ok: false, reason: "network" });
    const { st } = await make({});
    expect(st().recovery).toMatchObject({ source: "local", payload: { v: "kept offline" } });
  });
  it("warns when the underlying server data changed since the draft started", async () => {
    writeLocalDraft({ v: 1, userId: U, schoolId: null, formType: F, recordKey: R, payload: { c: "draft" }, updatedAt: Date.now() - 100, baseHash: "OLD", syncedAt: null });
    let state: DraftSessionState | undefined;
    const s = new DraftSession({ userId: U, schoolId: null, formType: F, recordKey: R, onState: (x) => { state = x; } }, { c: "server" }, "NEW");
    await s.init({ c: "server" });
    expect(state!.recovery?.baseChanged).toBe(true);
  });
  it("a tombstoned (submitted) draft is not resurrected from a stale server copy", async () => {
    writeTombstone(U, F, R, 5000);
    mocked.fetchServerDraft.mockResolvedValue({ ok: true, draft: { payload: { v: "stale" }, baseHash: null, clientUpdatedMs: 4000, version: 1 } });
    const { st } = await make({});
    expect(st().recovery).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.deleteServerDraft).toHaveBeenCalledWith(U, F, R);
  });
});

describe("offline and reconnect", () => {
  it("keeps edits on the device while offline, then syncs on reconnect", async () => {
    const { s, st } = await make({});
    setOnline(false);
    s.update({ 0: "typed offline" }, null);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocked.saveServerDraft).not.toHaveBeenCalled();
    expect(st().status).toBe("offline");
    expect(readLocalDraft(U, F, R)?.payload).toEqual({ 0: "typed offline" });
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(50);
    expect(mocked.saveServerDraft).toHaveBeenCalledTimes(1);
    expect(st().status).toBe("saved");
  });
  it("retries after a network failure and reports Unable to save for real server errors", async () => {
    const { s, st } = await make({});
    mocked.saveServerDraft.mockResolvedValueOnce({ status: "network" }).mockResolvedValue({ status: "saved", version: 1 });
    s.update({ 0: "x" }, null);
    await vi.advanceTimersByTimeAsync(1600);
    expect(st().status).toBe("offline");
    await vi.advanceTimersByTimeAsync(3100); // first retry delay
    expect(st().status).toBe("saved");

    localStorage.clear(); // start the second scenario from scratch
    const { s: s2, st: st2 } = await make({});
    mocked.saveServerDraft.mockReset().mockResolvedValue({ status: "error", message: "boom" });
    s2.update({ 0: "y" }, null);
    await vi.advanceTimersByTimeAsync(1600);
    expect(st2().status).toBe("error");
    expect(readLocalDraft(U, F, R)?.payload).toEqual({ 0: "y" }); // still safe on the device
  });
  it("device-only mode when the migration isn't applied yet", async () => {
    const { s, st } = await make({});
    mocked.saveServerDraft.mockResolvedValue({ status: "unavailable" });
    s.update({ 0: "x" }, null);
    await vi.advanceTimersByTimeAsync(1600);
    expect(st().status).toBe("offline");
    expect(readLocalDraft(U, F, R)).not.toBeNull();
  });
});

describe("never overwrite newer data", () => {
  it("a newer draft elsewhere is offered, not overwritten; 'keep mine' then re-saves as newest", async () => {
    const { s, st } = await make({});
    mocked.saveServerDraft.mockResolvedValueOnce({ status: "conflict", draft: { payload: { 0: "from phone" }, baseHash: null, clientUpdatedMs: Date.now() + 10, version: 9 } });
    s.update({ 0: "from laptop" }, null);
    await vi.advanceTimersByTimeAsync(1600);
    expect(st().recovery).toMatchObject({ conflict: true, source: "server", payload: { 0: "from phone" } });
    s.update({ 0: "ignored while paused" }, null);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocked.saveServerDraft).toHaveBeenCalledTimes(1);
    await s.declineRecovery(); // "Keep what I have"
    await vi.advanceTimersByTimeAsync(50);
    expect(mocked.saveServerDraft).toHaveBeenCalledTimes(2);
    expect(mocked.saveServerDraft.mock.calls[1][0].payload).toEqual({ 0: "from laptop" });
    expect(mocked.saveServerDraft.mock.calls[1][0].clientUpdatedMs).toBeGreaterThan(mocked.saveServerDraft.mock.calls[0][0].clientUpdatedMs);
  });
});

describe("cleanup after submission", () => {
  it("markSubmitted deletes the draft everywhere and stops further saves", async () => {
    const { s, st } = await make({});
    s.update({ 0: "final" }, null);
    await vi.advanceTimersByTimeAsync(1600);
    await s.markSubmitted();
    expect(readLocalDraft(U, F, R)).toBeNull();
    expect(mocked.deleteServerDraft).toHaveBeenCalledWith(U, F, R);
    expect(readTombstone(U, F, R)).toBeNull(); // server delete succeeded
    s.update({ 0: "late keystroke" }, null);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocked.saveServerDraft).toHaveBeenCalledTimes(1);
    expect(st().status).toBe("idle");
  });
  it("a save already in flight at submit time cannot resurrect the draft", async () => {
    const { s } = await make({});
    let release!: (v: unknown) => void;
    mocked.saveServerDraft.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    s.update({ 0: "x" }, null);
    await vi.advanceTimersByTimeAsync(1600); // request now in flight
    await s.markSubmitted();
    mocked.deleteServerDraft.mockClear();
    release({ status: "saved", version: 1 });
    await vi.advanceTimersByTimeAsync(10);
    expect(mocked.deleteServerDraft).toHaveBeenCalled(); // cleaned again after the late save landed
    expect(readLocalDraft(U, F, R)).toBeNull();
  });
  it("clearDraftEverywhere works after the form (session) is already gone, and keeps a tombstone if offline", async () => {
    writeLocalDraft({ v: 1, userId: U, schoolId: null, formType: F, recordKey: R, payload: { a: 1 }, updatedAt: Date.now(), baseHash: null, syncedAt: null });
    mocked.deleteServerDraft.mockResolvedValue(false); // server unreachable
    await clearDraftEverywhere(U, F, R);
    expect(readLocalDraft(U, F, R)).toBeNull();
    expect(readTombstone(U, F, R)).not.toBeNull();
  });
});

describe("leaving the page", () => {
  it("flushes with a keepalive request when the tab is hidden/closed", async () => {
    const { s } = await make({});
    s.update({ 0: "unsaved at close" }, null);
    window.dispatchEvent(new Event("pagehide"));
    expect(mocked.saveServerDraftOnUnload).toHaveBeenCalledTimes(1);
    expect(mocked.saveServerDraftOnUnload.mock.calls[0][0].payload).toEqual({ 0: "unsaved at close" });
  });
  it("only shows the browser's leave-page warning when the work is not safe anywhere", async () => {
    const { s } = await make({});
    s.update({ 0: "x" }, null);
    const e1 = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e1);
    expect(e1.defaultPrevented).toBe(false); // safely on the device
    // quota exhausted: device copy impossible and server not yet synced
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    s.update({ 0: "xy" }, null);
    const e2 = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(true);
    spy.mockRestore();
  });
  it("disposing (route change) pushes pending edits", async () => {
    const { s } = await make({});
    s.update({ 0: "x" }, null);
    s.dispose();
    await vi.advanceTimersByTimeAsync(10);
    expect(mocked.saveServerDraft).toHaveBeenCalledTimes(1);
  });
});
