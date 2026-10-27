// Auto-save & Recovery - on-device copy of a draft.
//
// Why a local copy at all: it is what survives a dropped connection, a closed tab, or a crash. The
// server copy (form_drafts) is what follows the user to another device.
//
// Safety rules enforced here:
//   * Only form data is stored. Never passwords, tokens or session objects (callers pass plain form
//     values; the envelope only adds ids and timestamps).
//   * Keys and envelopes are bound to the signed-in user id; an envelope for another user is ignored.
//   * Every read is defensive: corrupt JSON, wrong shape or storage errors yield "no draft".

export const DRAFT_STORAGE_PREFIX = "apas.draft.v1";
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // matches form_drafts.expires_at
export const MAX_LOCAL_DRAFT_CHARS = 900_000; // stays under the 1 MB server limit and typical quotas

export interface DraftEnvelope<T = unknown> {
  v: 1;
  userId: string;
  schoolId: string | null;
  formType: string;
  recordKey: string;
  payload: T;
  /** ms since epoch of the user's last edit (client clock). */
  updatedAt: number;
  /** Fingerprint of the server data the draft was started from (see hashString). */
  baseHash: string | null;
  /** ms of the last edit that is confirmed on the server; null/older than updatedAt => unsynced. */
  syncedAt: number | null;
}

export interface Tombstone {
  /** Draft was cleared (submitted/discarded) at this time; server rows at or before it are stale. */
  at: number;
}

const safeStorage = (): Storage | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

export const draftKey = (userId: string, formType: string, recordKey: string) =>
  `${DRAFT_STORAGE_PREFIX}:${userId}:${formType}:${recordKey}`;
const tombKey = (userId: string, formType: string, recordKey: string) =>
  `${DRAFT_STORAGE_PREFIX}.tomb:${userId}:${formType}:${recordKey}`;

/** Small, stable, non-cryptographic fingerprint (djb2) used only to detect "server data changed". */
export function hashString(input: string | null | undefined): string {
  const s = input ?? "";
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

export function isEnvelope(x: unknown): x is DraftEnvelope {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return (
    e.v === 1 &&
    typeof e.userId === "string" &&
    typeof e.formType === "string" &&
    typeof e.recordKey === "string" &&
    typeof e.updatedAt === "number" &&
    Number.isFinite(e.updatedAt) &&
    "payload" in e
  );
}

export function readLocalDraft<T = unknown>(userId: string, formType: string, recordKey: string): DraftEnvelope<T> | null {
  const st = safeStorage();
  if (!st || !userId) return null;
  try {
    const raw = st.getItem(draftKey(userId, formType, recordKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isEnvelope(parsed) || parsed.userId !== userId || parsed.formType !== formType || parsed.recordKey !== recordKey) return null;
    if (Date.now() - parsed.updatedAt > DRAFT_TTL_MS) {
      st.removeItem(draftKey(userId, formType, recordKey));
      return null;
    }
    return parsed as DraftEnvelope<T>;
  } catch {
    return null;
  }
}

/** Returns false when the draft could not be stored (quota, private mode, too large). */
export function writeLocalDraft<T>(env: DraftEnvelope<T>): boolean {
  const st = safeStorage();
  if (!st) return false;
  try {
    const raw = JSON.stringify(env);
    if (raw.length > MAX_LOCAL_DRAFT_CHARS) return false;
    st.setItem(draftKey(env.userId, env.formType, env.recordKey), raw);
    return true;
  } catch {
    return false;
  }
}

export function removeLocalDraft(userId: string, formType: string, recordKey: string): void {
  try {
    safeStorage()?.removeItem(draftKey(userId, formType, recordKey));
  } catch {
    /* ignore */
  }
}

export function readTombstone(userId: string, formType: string, recordKey: string): Tombstone | null {
  const st = safeStorage();
  if (!st) return null;
  try {
    const raw = st.getItem(tombKey(userId, formType, recordKey));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p.at === "number" ? { at: p.at } : null;
  } catch {
    return null;
  }
}

export function writeTombstone(userId: string, formType: string, recordKey: string, at = Date.now()): void {
  try {
    safeStorage()?.setItem(tombKey(userId, formType, recordKey), JSON.stringify({ at }));
  } catch {
    /* ignore */
  }
}

export function clearTombstone(userId: string, formType: string, recordKey: string): void {
  try {
    safeStorage()?.removeItem(tombKey(userId, formType, recordKey));
  } catch {
    /* ignore */
  }
}

function listKeys(prefix: string): string[] {
  const st = safeStorage();
  if (!st) return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * Housekeeping for shared devices: drop this user's drafts that are expired or already safely on the
 * server. Unsynced drafts are kept - removing them would lose the user's work.
 */
export function clearSyncedLocalDrafts(userId: string): number {
  const st = safeStorage();
  if (!st || !userId) return 0;
  let removed = 0;
  for (const k of listKeys(`${DRAFT_STORAGE_PREFIX}:${userId}:`)) {
    try {
      const parsed = JSON.parse(st.getItem(k) || "null");
      const expired = isEnvelope(parsed) && Date.now() - parsed.updatedAt > DRAFT_TTL_MS;
      const synced = isEnvelope(parsed) && parsed.syncedAt != null && parsed.syncedAt >= parsed.updatedAt;
      if (!isEnvelope(parsed) || expired || synced) {
        st.removeItem(k);
        removed++;
      }
    } catch {
      st.removeItem(k);
      removed++;
    }
  }
  return removed;
}

/** Keys of this user's drafts that still need to reach the server (used to resync on reconnect). */
export function listUnsyncedDrafts(userId: string): DraftEnvelope[] {
  const st = safeStorage();
  if (!st || !userId) return [];
  const out: DraftEnvelope[] = [];
  for (const k of listKeys(`${DRAFT_STORAGE_PREFIX}:${userId}:`)) {
    try {
      const parsed = JSON.parse(st.getItem(k) || "null");
      if (isEnvelope(parsed) && parsed.userId === userId && (parsed.syncedAt == null || parsed.syncedAt < parsed.updatedAt)) out.push(parsed);
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Stable JSON used to compare form values (key order independent). */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v && typeof v === "object") {
      if (seen.has(v as object)) return null;
      seen.add(v as object);
      if (Array.isArray(v)) return v.map(walk);
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) o[k] = walk((v as Record<string, unknown>)[k]);
      return o;
    }
    return v;
  };
  try {
    return JSON.stringify(walk(value)) ?? "null";
  } catch {
    return "null";
  }
}
