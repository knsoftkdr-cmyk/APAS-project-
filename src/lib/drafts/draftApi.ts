// Auto-save & Recovery - server calls (table public.form_drafts, RPC public.save_form_draft).
// All authorization is enforced in Postgres (RLS + the RPC); nothing here is trusted by the server.

import { supabase } from "@/integrations/supabase/client";

export interface ServerDraft {
  payload: unknown;
  baseHash: string | null;
  clientUpdatedMs: number;
  version: number;
}

export type SaveResult =
  | { status: "saved"; version: number }
  | { status: "conflict"; draft: ServerDraft }
  | { status: "forbidden" }
  | { status: "unavailable" } // table/RPC not deployed yet -> device-only mode
  | { status: "network" } // offline / request failed to reach the server
  | { status: "error"; message: string };

// The table is new and not in the generated types yet, so go through an untyped handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

let serverUnavailable = false;
/** Set when the migration has not been applied; avoids hammering a missing endpoint all session. */
export const isServerDraftsUnavailable = () => serverUnavailable;
export const resetServerDraftsAvailability = () => { serverUnavailable = false; };

export function isMissingBackend(err: unknown): boolean {
  const e = err as { code?: string; message?: string; status?: number } | null;
  if (!e) return false;
  const msg = (e.message || "").toLowerCase();
  return (
    e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42883" ||
    e.status === 404 ||
    msg.includes("form_drafts") && (msg.includes("does not exist") || msg.includes("schema cache")) ||
    msg.includes("save_form_draft") && (msg.includes("does not exist") || msg.includes("schema cache"))
  );
}

export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const e = err as { message?: string; name?: string } | null;
  const msg = (e?.message || "").toLowerCase();
  return e?.name === "TypeError" || msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed") || msg.includes("load failed");
}

export async function saveServerDraft(args: {
  formType: string;
  recordKey: string;
  payload: unknown;
  baseHash: string | null;
  clientUpdatedMs: number;
}): Promise<SaveResult> {
  if (serverUnavailable) return { status: "unavailable" };
  try {
    const { data, error } = await db().rpc("save_form_draft", {
      p_form_type: args.formType,
      p_record_key: args.recordKey,
      p_payload: args.payload,
      p_base_hash: args.baseHash,
      p_client_ms: args.clientUpdatedMs,
    });
    if (error) {
      if (isMissingBackend(error)) { serverUnavailable = true; return { status: "unavailable" }; }
      if (isNetworkError(error)) return { status: "network" };
      return { status: "error", message: error.message || "save failed" };
    }
    const r = data as { status?: string; version?: number; draft?: { payload: unknown; base_hash: string | null; client_updated_ms: number; version: number } } | null;
    if (r?.status === "saved") return { status: "saved", version: r.version ?? 0 };
    if (r?.status === "conflict" && r.draft) {
      return { status: "conflict", draft: { payload: r.draft.payload, baseHash: r.draft.base_hash ?? null, clientUpdatedMs: Number(r.draft.client_updated_ms), version: r.draft.version } };
    }
    if (r?.status === "forbidden") return { status: "forbidden" };
    return { status: "error", message: "unexpected response" };
  } catch (e) {
    if (isNetworkError(e)) return { status: "network" };
    return { status: "error", message: e instanceof Error ? e.message : "save failed" };
  }
}

export type FetchResult =
  | { ok: true; draft: ServerDraft | null }
  | { ok: false; reason: "unavailable" | "network" | "error" };

export async function fetchServerDraft(userId: string, formType: string, recordKey: string): Promise<FetchResult> {
  if (serverUnavailable) return { ok: false, reason: "unavailable" };
  try {
    const { data, error } = await db()
      .from("form_drafts")
      .select("payload, base_hash, client_updated_ms, version, expires_at")
      .eq("user_id", userId) // redundant with RLS; keeps the query index-friendly
      .eq("form_type", formType)
      .eq("record_key", recordKey)
      .maybeSingle();
    if (error) {
      if (isMissingBackend(error)) { serverUnavailable = true; return { ok: false, reason: "unavailable" }; }
      return { ok: false, reason: isNetworkError(error) ? "network" : "error" };
    }
    if (!data || (data.expires_at && new Date(data.expires_at).getTime() < Date.now())) return { ok: true, draft: null };
    return { ok: true, draft: { payload: data.payload, baseHash: data.base_hash ?? null, clientUpdatedMs: Number(data.client_updated_ms), version: data.version } };
  } catch (e) {
    return { ok: false, reason: isNetworkError(e) ? "network" : "error" };
  }
}

/** Returns true when the row is gone (or never existed / backend not deployed). */
export async function deleteServerDraft(userId: string, formType: string, recordKey: string): Promise<boolean> {
  if (serverUnavailable) return true;
  try {
    const { error } = await db().from("form_drafts").delete().eq("user_id", userId).eq("form_type", formType).eq("record_key", recordKey);
    if (!error) return true;
    if (isMissingBackend(error)) { serverUnavailable = true; return true; }
    return false;
  } catch {
    return false;
  }
}

/** Best-effort, once per session: remove this user's expired drafts (RLS limits it to their own). */
export async function purgeExpiredServerDrafts(userId: string): Promise<void> {
  if (serverUnavailable) return;
  try {
    const { error } = await db().from("form_drafts").delete().eq("user_id", userId).lt("expires_at", new Date().toISOString());
    if (error && isMissingBackend(error)) serverUnavailable = true;
  } catch {
    /* ignore */
  }
}

// --- page-unload flush -----------------------------------------------------------------------
// fetch(..., {keepalive:true}) is allowed to outlive the page. It needs the access token as a header,
// so we hold it in memory only (never written to storage by this feature) via the auth listener.
let memoryToken: string | null = null;
let listening = false;
function ensureTokenListener() {
  if (listening) return;
  listening = true;
  supabase.auth.getSession().then(({ data }) => { memoryToken = data.session?.access_token ?? null; }).catch(() => undefined);
  supabase.auth.onAuthStateChange((_e, session) => { memoryToken = session?.access_token ?? null; });
}
ensureTokenListener();

const KEEPALIVE_MAX_BYTES = 60_000; // browsers cap keepalive bodies at ~64 KB

/** Fire-and-forget save that survives tab close. Returns false if it could not even be attempted. */
export function saveServerDraftOnUnload(args: { formType: string; recordKey: string; payload: unknown; baseHash: string | null; clientUpdatedMs: number }): boolean {
  if (serverUnavailable || !memoryToken) return false;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return false;
  try {
    const body = JSON.stringify({ p_form_type: args.formType, p_record_key: args.recordKey, p_payload: args.payload, p_base_hash: args.baseHash, p_client_ms: args.clientUpdatedMs });
    if (body.length > KEEPALIVE_MAX_BYTES) return false;
    void fetch(`${url}/rest/v1/rpc/save_form_draft`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${memoryToken}` },
      body,
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
