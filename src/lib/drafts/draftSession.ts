// Auto-save & Recovery - the engine behind useFormDraft (no React inside, so it is unit-testable).
//
// One DraftSession == one (user, form type, record) being edited.
//
// Guarantees
//  - Every edit is written to localStorage immediately; the server copy follows after a debounce.
//  - A draft is NEVER submitted or written to a real table. It only lives in form_drafts + localStorage.
//  - An older draft never replaces a newer one: the RPC rejects stale saves ("conflict") and on load the
//    newest of local/server wins. Nothing is applied to the form without the user choosing "Restore".
//  - After a successful submit (markSubmitted) both copies are removed; a tombstone makes sure a stale
//    server copy that could not be deleted (offline) is not resurrected later.

import {
  clearTombstone, readLocalDraft, readTombstone, removeLocalDraft, stableStringify, writeLocalDraft, writeTombstone,
  type DraftEnvelope,
} from "./draftStorage";
import {
  deleteServerDraft, fetchServerDraft, saveServerDraft, saveServerDraftOnUnload, type ServerDraft,
} from "./draftApi";

export type DraftStatus = "idle" | "saving" | "saved" | "offline" | "error";

export interface DraftRecovery {
  payload: unknown;
  savedAt: number;
  source: "local" | "server";
  /** The server data this draft was based on has changed since the draft was saved. */
  baseChanged: boolean;
  /** A newer draft from another device/tab was found while saving (nothing was overwritten). */
  conflict: boolean;
}

export interface DraftSessionState {
  status: DraftStatus;
  lastSavedAt: number | null;
  recovery: DraftRecovery | null;
  ready: boolean;
}

export interface DraftSessionOptions {
  userId: string;
  schoolId: string | null;
  formType: string;
  recordKey: string;
  debounceMs?: number;
  /** Values with no real content are not worth keeping (and clear an existing draft). */
  isEmpty?: (value: unknown) => boolean;
  onState: (s: DraftSessionState) => void;
}

const RETRY_DELAYS = [3000, 10000, 30000, 60000];

// When each draft was last cleared (submitted/discarded) in this page session. A save that was already
// in flight for an older edit must not resurrect a draft that was cleared meanwhile.
const clearedAt = new Map<string, number>();
const cacheKey = (u: string, f: string, r: string) => `${u}|${f}|${r}`;

/** Remove a draft from the device and the server. Works even if the form (and its session) is already gone. */
export async function clearDraftEverywhere(userId: string, formType: string, recordKey: string, tombstone = true): Promise<void> {
  clearedAt.set(cacheKey(userId, formType, recordKey), Date.now());
  removeLocalDraft(userId, formType, recordKey);
  if (tombstone) writeTombstone(userId, formType, recordKey);
  const ok = await deleteServerDraft(userId, formType, recordKey);
  if (ok && tombstone) clearTombstone(userId, formType, recordKey);
}

export class DraftSession {
  private o: Required<Omit<DraftSessionOptions, "isEmpty">> & Pick<DraftSessionOptions, "isEmpty">;
  private state: DraftSessionState = { status: "idle", lastSavedAt: null, recovery: null, ready: false };
  private latest: DraftEnvelope | null = null; // newest edit (also in localStorage when localOk)
  private localOk = true;
  private baselineKey: string;
  private baseHash: string | null;
  private touched = false;
  private closed = false; // submitted/discarded: never save again
  private disposed = false;
  private inFlight = false;
  private resync = false;
  private paused = false; // waiting for the user to resolve a recovery/conflict prompt
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private listening = false;

  constructor(opts: DraftSessionOptions, initialValue: unknown, initialBaseHash: string | null) {
    this.o = { debounceMs: 1500, ...opts } as DraftSession["o"];
    this.baselineKey = stableStringify(initialValue);
    this.baseHash = initialBaseHash;
  }

  // -- lifecycle ------------------------------------------------------------------------------

  async init(currentValue: unknown): Promise<void> {
    this.attachListeners();
    const { userId, formType, recordKey } = this.o;
    const tomb = readTombstone(userId, formType, recordKey);
    const local = readLocalDraft(userId, formType, recordKey);
    const server = await fetchServerDraft(userId, formType, recordKey);
    if (this.disposed) return;

    const serverDraft: ServerDraft | null = server.ok ? server.draft : null;
    const tombAt = tomb?.at ?? 0;

    // A cleared draft whose server delete never completed: finish the delete, ignore the stale copy.
    if (tomb && serverDraft && serverDraft.clientUpdatedMs <= tombAt) {
      void deleteServerDraft(userId, formType, recordKey).then((ok) => { if (ok) clearTombstone(userId, formType, recordKey); });
    } else if (tomb && server.ok && !serverDraft) {
      clearTombstone(userId, formType, recordKey);
    }

    const usableServer = serverDraft && serverDraft.clientUpdatedMs > tombAt ? serverDraft : null;
    const usableLocal = local && local.updatedAt > tombAt ? local : null;

    // Newest wins. Equal timestamps: prefer local (identical anyway after a successful sync).
    let pick: { payload: unknown; savedAt: number; source: "local" | "server"; baseHash: string | null } | null = null;
    if (usableLocal && (!usableServer || usableLocal.updatedAt >= usableServer.clientUpdatedMs)) {
      pick = { payload: usableLocal.payload, savedAt: usableLocal.updatedAt, source: "local", baseHash: usableLocal.baseHash };
    } else if (usableServer) {
      pick = { payload: usableServer.payload, savedAt: usableServer.clientUpdatedMs, source: "server", baseHash: usableServer.baseHash };
    }

    const pickKey = pick ? stableStringify(pick.payload) : "";
    if (pick && !this.isEmptyValue(pick.payload) && pickKey !== stableStringify(currentValue) && pickKey !== this.baselineKey) {
      this.paused = true;
      this.latest = usableLocal ?? null;
      this.set({
        ready: true,
        recovery: {
          payload: pick.payload,
          savedAt: pick.savedAt,
          source: pick.source,
          baseChanged: !!(pick.baseHash && this.baseHash && pick.baseHash !== this.baseHash),
          conflict: false,
        },
      });
      return;
    }

    // Nothing to recover (or it equals the form): if an unsynced local copy exists, push it quietly.
    if (usableLocal) {
      this.latest = usableLocal;
      this.touched = true;
      if (usableLocal.syncedAt == null || usableLocal.syncedAt < usableLocal.updatedAt) this.schedule(0);
      else this.set({ status: "saved", lastSavedAt: usableLocal.updatedAt });
    }
    this.set({ ready: true });
  }

  dispose(): void {
    if (this.disposed) return;
    this.flush(false);
    this.disposed = true;
    this.detachListeners();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  // -- edits ----------------------------------------------------------------------------------

  /** baseline = what the form looks like when the user has changed nothing (defaults to the initial value). */
  update(value: unknown, baseHash: string | null, baseline?: unknown): void {
    if (this.disposed || this.closed || this.paused || !this.state.ready) return;
    this.baseHash = baseHash;
    if (baseline !== undefined) this.baselineKey = stableStringify(baseline);
    const key = stableStringify(value);
    if (!this.touched && key === this.baselineKey) return; // untouched form: nothing to save
    this.touched = true;

    if (this.isEmptyValue(value)) {
      void this.clear(true); // user emptied the form: drop the draft instead of keeping a blank one
      this.touched = false;
      this.baselineKey = key;
      return;
    }

    const { userId, schoolId, formType, recordKey } = this.o;
    const env: DraftEnvelope = {
      v: 1, userId, schoolId, formType, recordKey, payload: value,
      updatedAt: Math.max(Date.now(), (this.latest?.updatedAt ?? 0) + 1),
      baseHash, syncedAt: this.latest?.syncedAt ?? null,
    };
    this.latest = env;
    this.localOk = writeLocalDraft(env);
    this.retryCount = 0;
    this.set({ status: this.offline() ? "offline" : "saving" });
    this.schedule(this.o.debounceMs);
  }

  // -- recovery prompt ---------------------------------------------------------------------------

  /** The user chose "Restore". Returns the payload to apply to the form. */
  acceptRecovery(): unknown {
    const r = this.state.recovery;
    if (!r) return undefined;
    this.paused = false;
    this.touched = true;
    // Adopt the recovered draft as our latest so it is re-saved (and kept newest) after being applied.
    const { userId, schoolId, formType, recordKey } = this.o;
    this.latest = {
      v: 1, userId, schoolId, formType, recordKey, payload: r.payload,
      updatedAt: Math.max(Date.now(), r.savedAt + 1), baseHash: this.baseHash,
      syncedAt: r.source === "server" && !r.conflict ? r.savedAt : null,
    };
    this.localOk = writeLocalDraft(this.latest);
    this.set({ recovery: null, status: "saving" });
    this.schedule(this.o.debounceMs);
    return r.payload;
  }

  /** The user chose "Discard" (or "Keep mine" on a conflict, which is handled by keepMine()). */
  async declineRecovery(): Promise<void> {
    const r = this.state.recovery;
    if (!r) return;
    if (r.conflict) { this.keepMine(); return; }
    this.paused = false;
    this.set({ recovery: null });
    await this.clear(true);
  }

  /** Conflict: keep what is on screen; re-save it as the newest version. */
  keepMine(): void {
    this.paused = false;
    if (this.latest) {
      this.latest = { ...this.latest, updatedAt: Date.now(), syncedAt: null };
      this.localOk = writeLocalDraft(this.latest);
      this.set({ recovery: null, status: "saving" });
      this.schedule(0);
    } else {
      this.set({ recovery: null });
    }
  }

  // -- clearing -------------------------------------------------------------------------------------

  /** Call ONLY after the real submit/save succeeded. Removes the draft everywhere. */
  async markSubmitted(): Promise<void> {
    this.closed = true;
    await this.clear(true);
    this.set({ status: "idle", lastSavedAt: null });
  }

  private async clear(tombstone: boolean): Promise<void> {
    const { userId, formType, recordKey } = this.o;
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.latest = null;
    await clearDraftEverywhere(userId, formType, recordKey, tombstone);
    if (!this.closed) this.set({ status: "idle", lastSavedAt: null });
  }

  // -- saving ----------------------------------------------------------------------------------------

  private offline(): boolean {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  }

  private schedule(ms: number): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => { this.debounceTimer = null; void this.sync(); }, ms);
  }

  private unsynced(): boolean {
    return !!this.latest && (this.latest.syncedAt == null || this.latest.syncedAt < this.latest.updatedAt);
  }

  async sync(): Promise<void> {
    if (this.disposed && !this.latest) return;
    if (this.closed || this.paused || !this.unsynced()) return;
    if (this.offline()) { this.set({ status: this.localOk ? "offline" : "error" }); return; }
    if (this.inFlight) { this.resync = true; return; }

    const env = this.latest!;
    const ck = cacheKey(env.userId, env.formType, env.recordKey);
    if ((clearedAt.get(ck) ?? 0) >= env.updatedAt) return; // cleared after this edit was made
    this.inFlight = true;
    this.set({ status: "saving" });
    const res = await saveServerDraft({ formType: env.formType, recordKey: env.recordKey, payload: env.payload, baseHash: env.baseHash, clientUpdatedMs: env.updatedAt });
    this.inFlight = false;

    if (this.closed || (clearedAt.get(ck) ?? 0) >= env.updatedAt) { // cleared while the save was in flight
      await deleteServerDraft(this.o.userId, this.o.formType, this.o.recordKey);
      return;
    }

    switch (res.status) {
      case "saved": {
        this.retryCount = 0;
        if (this.latest && this.latest.updatedAt === env.updatedAt) {
          this.latest = { ...this.latest, syncedAt: env.updatedAt };
          if (this.localOk) this.localOk = writeLocalDraft(this.latest);
          this.set({ status: "saved", lastSavedAt: Date.now() });
        } else {
          this.schedule(0); // edited again while saving
        }
        break;
      }
      case "conflict": {
        // A newer draft exists elsewhere. Do not overwrite it; let the user choose.
        this.paused = true;
        this.set({
          status: "saved",
          recovery: {
            payload: res.draft.payload, savedAt: res.draft.clientUpdatedMs, source: "server",
            baseChanged: !!(res.draft.baseHash && this.baseHash && res.draft.baseHash !== this.baseHash),
            conflict: true,
          },
        });
        break;
      }
      case "unavailable": // migration not applied: keep working device-only
        this.set({ status: this.localOk ? "offline" : "error" });
        break;
      case "network":
        this.set({ status: this.localOk ? "offline" : "error" });
        this.scheduleRetry();
        break;
      case "forbidden":
        this.set({ status: "error" });
        break;
      default:
        this.set({ status: "error" });
        this.scheduleRetry();
    }
    if (this.resync) { this.resync = false; this.schedule(0); }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.retryCount >= RETRY_DELAYS.length) return;
    const d = RETRY_DELAYS[this.retryCount++];
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.sync(); }, d);
  }

  // -- leaving the page ---------------------------------------------------------------------------------

  /** Push whatever is pending right now. onUnload=true uses a keepalive request that outlives the tab. */
  flush(onUnload: boolean): void {
    if (this.closed || this.paused || !this.unsynced()) return;
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    const env = this.latest!;
    if (this.localOk) writeLocalDraft(env);
    if (onUnload) {
      if (!this.offline()) saveServerDraftOnUnload({ formType: env.formType, recordKey: env.recordKey, payload: env.payload, baseHash: env.baseHash, clientUpdatedMs: env.updatedAt });
    } else {
      void this.sync();
    }
  }

  /** True when closing the page now could lose work (not on the device AND not on the server). */
  atRisk(): boolean {
    return this.unsynced() && !this.localOk;
  }

  private onOnline = () => { this.retryCount = 0; if (this.unsynced()) this.schedule(0); else this.set({}); };
  private onOffline = () => { if (this.unsynced()) this.set({ status: this.localOk ? "offline" : "error" }); };
  private onHide = () => { if (typeof document === "undefined" || document.visibilityState === "hidden") this.flush(true); };
  private onPageHide = () => this.flush(true);
  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    this.flush(true);
    if (this.atRisk()) { e.preventDefault(); e.returnValue = ""; }
  };

  private attachListeners(): void {
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("beforeunload", this.onBeforeUnload);
    document.addEventListener("visibilitychange", this.onHide);
  }

  private detachListeners(): void {
    if (!this.listening || typeof window === "undefined") return;
    this.listening = false;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    document.removeEventListener("visibilitychange", this.onHide);
  }

  // -- helpers ----------------------------------------------------------------------------------------------

  private isEmptyValue(v: unknown): boolean {
    return this.o.isEmpty ? this.o.isEmpty(v) : false;
  }

  private set(patch: Partial<DraftSessionState>): void {
    this.state = { ...this.state, ...patch };
    this.o.onState(this.state);
  }

  matches(formType: string, recordKey: string): boolean {
    return this.o.formType === formType && this.o.recordKey === recordKey;
  }

  getState(): DraftSessionState {
    return this.state;
  }
}

/** Test helper. */
export const __resetClearedForTests = () => clearedAt.clear();
