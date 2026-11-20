/* eslint-disable @typescript-eslint/no-explicit-any */
// supabase/functions/_shared/handlers/telephonyCalls.ts
//
// Click-to-Call server side. Not an edge function: `log-audit` (already deployed, already hosts merged routes and already accepts
// unsigned requests) routes to this file.
//   POST { mode: "tel_call", op: "start" | "refresh" | "recording", ... }   signed-in staff (JWT)
//   POST|GET ?telephony=<provider>&cid=<call id>&t=<token>                  provider status callback (HMAC-token authenticated)
//
// The browser only ever sends an applicant id. The phone number, school, staff phone and provider are all looked up here, so a
// forged request cannot call an arbitrary number or another school's lead. Credentials come from Supabase secrets only.

// deno-lint-ignore-file no-explicit-any
import { authenticateStaff, corsHeaders, json, UUID_RE } from "../learningGroupsData.ts";
import { getProvider } from "../telephony/providers.ts";
import {
  callbackToken, isTerminal, ProviderError, ProviderNotConfigured, verifyCallbackToken,
  type NormalizedCallEvent, type TelephonyProvider,
} from "../telephonyModel.ts";

const env = (k: string) => Deno.env.get(k);

// The service-role client is created lazily (and can be swapped in tests) - the callback path never uses a user JWT.
const SUPABASE_JS = "https://esm.sh/@supabase/supabase-js@2";
let adminFactory: () => Promise<any> = async () => {
  const mod = await import(/* @vite-ignore */ SUPABASE_JS);
  return mod.createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!);
};
const adminClient = () => adminFactory();
/** Test hook only. */
export function __setAdminFactory(f: () => Promise<any>) { adminFactory = f; }
const MAX_WEBHOOK_BYTES = 64 * 1024;
const MAX_RECORDING_BYTES = 60 * 1024 * 1024;

const START_ERRORS: Record<string, { status: number; error: string; code: string }> = {
  not_enabled: { status: 412, code: "not_enabled", error: "Calling is not switched on for your school. An administrator can enable it in Call settings." },
  forbidden: { status: 403, code: "forbidden", error: "You are not permitted to call this lead." },
  provider_mismatch: { status: 412, code: "provider_mismatch", error: "The school's calling provider does not match this request." },
  outside_window: { status: 409, code: "outside_window", error: "Calls are only allowed within the school's calling hours." },
  rate_limited: { status: 429, code: "rate_limited", error: "Too many calls in the last minute. Please wait a moment." },
};

async function audit(admin: any, userId: string | null, action: string, resourceId: string | null, details: Record<string, unknown>) {
  try { await admin.from("audit_logs").insert({ user_id: userId, action, resource_type: "admission_call", resource_id: resourceId, details }); } catch { /* best effort */ }
}

function webhookSecret(): string { return env("TELEPHONY_WEBHOOK_SECRET") ?? ""; }
function callbackUrl(provider: string, callId: string, token: string): string {
  return `${env("SUPABASE_URL")}/functions/v1/log-audit?telephony=${encodeURIComponent(provider)}&cid=${callId}&t=${token}`;
}

/** Applies a provider event through the idempotent database function. */
async function applyEvent(admin: any, provider: string, ev: NormalizedCallEvent): Promise<string> {
  const { data, error } = await admin.rpc("tel_record_event", {
    p_provider: provider, p_provider_call_id: ev.providerCallId, p_dedupe_key: ev.dedupeKey, p_event_type: ev.eventType, p_status: ev.status,
    p_started: ev.startedAt, p_answered: ev.answeredAt, p_ended: ev.endedAt, p_duration: ev.durationSeconds,
    p_conversation: ev.conversationSeconds, p_recording_ref: ev.recordingUrl, p_failure: ev.failureReason,
    p_payload: { status: ev.status, event: ev.eventType, duration: ev.durationSeconds, conversation: ev.conversationSeconds },
  });
  if (error) throw new Error(error.message);
  return String(data);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Browser -> server operations
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function handleTelephonyCalls(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await authenticateStaff(req);
    if (!auth.ok) return auth.res;
    const { admin, userId, caller } = auth.ctx;
    if (!caller.schoolId) return json({ error: "Your account is not linked to a school." }, 403);

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ error: "Invalid JSON body" }, 400);

    if (body.op === "start") return await startCall(admin, userId, caller.schoolId, body);
    if (body.op === "refresh") return await refreshCall(admin, userId, caller.schoolId, body);
    if (body.op === "recording") return await streamRecording(admin, userId, body);
    return json({ error: "Unknown operation" }, 400);
  } catch (e) {
    console.error("telephony error", e);
    return json({ error: "Something went wrong while handling the call. Please try again." }, 500);
  }
}

async function startCall(admin: any, userId: string, schoolId: string, body: Record<string, unknown>): Promise<Response> {
  const applicantId = String(body.applicant_id ?? "");
  if (!UUID_RE.test(applicantId)) return json({ error: "applicant_id is required" }, 400);

  // Trusted lookups: the lead must belong to the caller's school, and the number comes from the database, not the browser.
  const { data: lead } = await admin.from("admission_applicants").select("id, parent_phone").eq("id", applicantId).eq("school_id", schoolId).maybeSingle();
  if (!lead) return json({ error: "Lead not found", code: "not_found" }, 404);

  const { data: settings } = await admin.from("telephony_school_settings").select("provider, enabled, caller_id").eq("school_id", schoolId).maybeSingle();
  if (!settings?.enabled) return json(START_ERRORS.not_enabled, START_ERRORS.not_enabled.status);

  let provider: TelephonyProvider;
  try { provider = getProvider(settings.provider, env); provider.assertConfigured(); }
  catch (e) {
    if (e instanceof ProviderNotConfigured) return json({ error: e.message, code: "provider_not_configured" }, 503);
    throw e;
  }
  if (!webhookSecret()) {
    return json({ error: "Calling is not fully configured: TELEPHONY_WEBHOOK_SECRET is missing, so call status could not be tracked safely.", code: "provider_not_configured" }, 503);
  }

  const parent = provider.validatePhoneNumber(lead.parent_phone);
  if (!parent.ok) return json({ error: parent.error, code: "invalid_phone" }, 400);
  const { data: staff } = await admin.from("telephony_staff").select("phone").eq("user_id", userId).maybeSingle();
  const staffPhone = staff?.phone ? provider.validatePhoneNumber(staff.phone) : null;
  if (!staffPhone?.ok) return json({ error: "Add your own phone number first - the system rings you, then connects the parent.", code: "staff_phone_missing" }, 400);

  const wantsRecording = body.record === true && body.recording_consent === true;
  const { data: begun, error: beginErr } = await admin.rpc("tel_begin_call", {
    p_school: schoolId, p_staff: userId, p_applicant: applicantId, p_provider: settings.provider,
    p_phone: parent.e164, p_staff_phone: staffPhone.e164, p_record: wantsRecording,
  });
  if (beginErr) throw new Error(beginErr.message);
  if (begun.status === "duplicate") return json({ error: "A call to this lead is already in progress.", code: "duplicate", call_id: begun.call_id }, 409);
  if (begun.status !== "ok") { const m = START_ERRORS[begun.status] ?? START_ERRORS.forbidden; return json({ ...m, details: begun }, m.status); }

  const callId = String(begun.call_id);
  try {
    const token = await callbackToken(webhookSecret(), `call:${callId}`);
    const result = await provider.initiateCall({
      staffPhone: staffPhone.e164, parentPhone: parent.e164, callerId: begun.caller_id, customField: callId,
      callbackUrl: callbackUrl(settings.provider, callId, token), record: !!begun.recording,
    });
    await admin.rpc("tel_mark_dialed", { p_call: callId, p_provider_call_id: result.providerCallId });
    await audit(admin, userId, "call_initiated", callId, { applicant_id: applicantId, provider: settings.provider, recording: !!begun.recording });
    return json({ call_id: callId, status: "initiating", recording: !!begun.recording });
  } catch (e) {
    const message = e instanceof ProviderError || e instanceof ProviderNotConfigured ? e.message : "The call could not be started.";
    await admin.rpc("tel_fail_call", { p_call: callId, p_reason: message });
    await audit(admin, userId, "call_failed_to_start", callId, { applicant_id: applicantId, reason: message });
    const status = e instanceof ProviderError && (e.status === 429 || e.status === 409 || e.status === 400) ? e.status : 502;
    return json({ error: message, code: "provider_error", call_id: callId }, status);
  }
}

/** Fallback when a callback is late: ask the provider directly (with our credentials) and apply what it says. */
async function refreshCall(admin: any, userId: string, schoolId: string, body: Record<string, unknown>): Promise<Response> {
  const callId = String(body.call_id ?? "");
  if (!UUID_RE.test(callId)) return json({ error: "call_id is required" }, 400);
  const { data: call } = await admin.from("admission_calls").select("id, school_id, provider, provider_call_id, status").eq("id", callId).maybeSingle();
  if (!call || call.school_id !== schoolId) return json({ error: "Call not found" }, 404);
  const { data: allowed } = await admin.rpc("tel_user_can_call", { p_user: userId });
  if (allowed !== true) return json({ error: "Not permitted" }, 403);
  if (isTerminal(call.status) || !call.provider_call_id) return json({ status: call.status });
  try {
    const provider = getProvider(call.provider, env);
    const ev = await provider.getCallDetails(call.provider_call_id);
    ev.eventType = "poll";
    ev.dedupeKey = `${ev.dedupeKey}:poll`;
    await applyEvent(admin, call.provider, ev);
  } catch { /* provider unreachable: the stored status is still returned */ }
  const { data: fresh } = await admin.from("admission_calls").select("status").eq("id", callId).maybeSingle();
  return json({ status: fresh?.status ?? call.status });
}

function isSafeRecordingHost(u: URL): boolean {
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.endsWith(".internal") || h.endsWith(".local")) return false;
  return true;
}

/** Plays a recording through the server so the provider's URL is never given to the browser. Every access is logged. */
async function streamRecording(admin: any, userId: string, body: Record<string, unknown>): Promise<Response> {
  const callId = String(body.call_id ?? "");
  if (!UUID_RE.test(callId)) return json({ error: "call_id is required" }, 400);
  const { data: auth } = await admin.rpc("tel_authorize_recording", { p_call: callId, p_user: userId });
  const messages: Record<string, [number, string]> = {
    forbidden: [403, "Not permitted"], disabled: [409, "Call recording is not enabled for this school."],
    unavailable: [404, "There is no recording for this call."], expired: [410, "This recording passed the school's retention period and was removed."],
  };
  if (!auth || auth.status !== "ok") { const m = messages[auth?.status] ?? [403, "Not permitted"]; return json({ error: m[1] }, m[0]); }
  let target: URL;
  try { target = new URL(auth.ref); } catch { return json({ error: "The stored recording link is invalid." }, 502); }
  if (!isSafeRecordingHost(target)) return json({ error: "The recording link is not allowed." }, 502);

  const upstream = await fetch(target.toString(), { signal: AbortSignal.timeout(30_000) });
  if (!upstream.ok || !upstream.body) return json({ error: "The provider could not return the recording." }, 502);
  const len = Number(upstream.headers.get("content-length") ?? 0);
  if (len > MAX_RECORDING_BYTES) return json({ error: "The recording is too large to play here." }, 502);
  await audit(admin, userId, "call_recording_played", callId, {});
  return new Response(upstream.body, { headers: { ...corsHeaders, "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "no-store" } });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Provider -> server callback
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function readPayload(req: Request, url: URL): Promise<Record<string, unknown> | null> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of url.searchParams) if (!["telephony", "cid", "t", "inbound"].includes(k)) out[k] = v;
  if (req.method === "GET") return out;
  const raw = await req.arrayBuffer();
  if (raw.byteLength > MAX_WEBHOOK_BYTES) return null;
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  const text = new TextDecoder().decode(raw);
  try {
    if (ct.includes("application/json")) {
      const j = JSON.parse(text);
      return j && typeof j === "object" && !Array.isArray(j) ? { ...out, ...j } : null;
    }
    if (ct.includes("application/x-www-form-urlencoded")) { for (const [k, v] of new URLSearchParams(text)) out[k] = v; return out; }
    if (ct.includes("multipart/form-data")) {
      const fd = await new Request(req.url, { method: "POST", headers: req.headers, body: raw }).formData();
      for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
      return out;
    }
  } catch { return null; }
  return text ? null : out;
}

export async function handleTelephonyWebhook(req: Request): Promise<Response> {
  const ok = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  try {
    if (req.method !== "POST" && req.method !== "GET") return ok({ error: "Method not allowed" }, 405);
    const url = new URL(req.url);
    const providerName = url.searchParams.get("telephony") ?? "";
    const cid = url.searchParams.get("cid") ?? "";
    const inbound = url.searchParams.get("inbound") === "1";
    const token = url.searchParams.get("t");
    if (!["exotel", "airtel_iq"].includes(providerName)) return ok({ error: "Unknown provider" }, 400);

    // 1. Authenticity: the token is derived from a server-only secret and the call id (or the inbound scope).
    const scope = inbound ? "inbound" : `call:${cid}`;
    if (!inbound && !UUID_RE.test(cid)) return ok({ error: "Unauthorized" }, 401);
    if (!(await verifyCallbackToken(webhookSecret(), scope, token))) return ok({ error: "Unauthorized" }, 401);

    // 2. Validate the payload.
    const payload = await readPayload(req, url);
    if (!payload) return ok({ error: "Malformed request" }, 400);
    const provider = getProvider(providerName, env);
    const ev = provider.processWebhook(payload);
    if (!ev) return ok({ error: "Unrecognised callback" }, 400);

    const admin = await adminClient();

    // 3. Confirm with the provider using OUR credentials where possible (the callback itself is unsigned); fall back to the payload.
    let confirmed: NormalizedCallEvent = ev;
    if (ev.status && isTerminal(ev.status)) {
      try {
        const details = await provider.getCallDetails(ev.providerCallId);
        confirmed = { ...ev, durationSeconds: details.durationSeconds ?? ev.durationSeconds,
          conversationSeconds: details.conversationSeconds ?? ev.conversationSeconds, recordingUrl: details.recordingUrl ?? ev.recordingUrl,
          endedAt: details.endedAt ?? ev.endedAt, startedAt: details.startedAt ?? ev.startedAt };
      } catch { /* not configured / provider slow: the authenticated callback is still applied */ }
    }

    if (inbound || ev.direction === "inbound") {
      const { data } = await admin.rpc("tel_record_inbound", {
        p_provider: providerName, p_provider_call_id: ev.providerCallId, p_from: ev.from ?? "", p_to: ev.to ?? "", p_dedupe_key: confirmed.dedupeKey,
        p_status: confirmed.status ?? "missed", p_started: confirmed.startedAt, p_ended: confirmed.endedAt, p_duration: confirmed.durationSeconds,
        p_payload: { status: confirmed.status },
      });
      return ok({ result: data });
    }

    // Outbound: the callback must belong to the call named in the URL (link the provider id on first sight).
    const { data: call } = await admin.from("admission_calls").select("id, provider, provider_call_id").eq("id", cid).maybeSingle();
    if (!call || call.provider !== providerName) return ok({ error: "Unknown call" }, 404);
    if (call.provider_call_id && call.provider_call_id !== ev.providerCallId) return ok({ error: "Call id mismatch" }, 409);
    if (!call.provider_call_id) await admin.rpc("tel_mark_dialed", { p_call: cid, p_provider_call_id: ev.providerCallId });

    const result = await applyEvent(admin, providerName, confirmed);
    return ok({ result });
  } catch (e) {
    console.error("telephony webhook error", e);
    return ok({ error: "Could not process the callback" }, 500);
  }
}
