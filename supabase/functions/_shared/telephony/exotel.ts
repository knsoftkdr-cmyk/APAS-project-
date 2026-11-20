// supabase/functions/_shared/telephony/exotel.ts
//
// Exotel adapter. Everything here follows Exotel's published Voice v1 "Connect Two Numbers" and "Call Details" documentation
// (developer.exotel.com): POST /v1/Accounts/{sid}/Calls/connect with HTTP Basic auth and a form-encoded body; GET
// /v1/Accounts/{sid}/Calls/{callSid}.json for details. Nothing is invented: fields the documentation does not describe are not used.
// Status callbacks are NOT signed by Exotel, so authenticity comes from the HMAC token on the callback URL (see telephonyModel.ts).

import {
  normalizePhone, ProviderError, ProviderNotConfigured,
  type CallStatus, type InitiateCallInput, type InitiateCallResult, type NormalizedCallEvent, type PhoneResult, type TelephonyProvider,
} from "../telephonyModel.ts";

export interface ExotelConfig { accountSid: string; apiKey: string; apiToken: string; subdomain: string }
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) return AbortSignal.timeout(ms);
  const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal;
}
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Reads the secrets set with `supabase secrets set`. The subdomain is configurable because Exotel accounts are region-specific. */
export function exotelConfigFromEnv(get: (k: string) => string | undefined): Partial<ExotelConfig> {
  return {
    accountSid: get("EXOTEL_ACCOUNT_SID"), apiKey: get("EXOTEL_API_KEY"), apiToken: get("EXOTEL_API_TOKEN"),
    subdomain: get("EXOTEL_SUBDOMAIN") || "api.exotel.com",
  };
}

// Documented statuses: queued | in-progress | completed | failed | busy | no-answer
export function mapExotelStatus(status: unknown, eventType?: unknown): CallStatus | null {
  const s = String(status ?? "").toLowerCase();
  switch (s) {
    case "queued": return "initiating";
    case "ringing": return "ringing";
    case "in-progress": case "in_progress": return "connected";
    case "completed": return "completed";
    case "busy": return "busy";
    case "no-answer": case "no_answer": case "noanswer": return "missed";
    case "failed": case "canceled": case "cancelled": return s.startsWith("cancel") ? "cancelled" : "failed";
    default:
      return String(eventType ?? "").toLowerCase() === "answered" ? "connected" : null;
  }
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
const text = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Exotel timestamps are "YYYY-MM-DD HH:MM:SS" without a zone. The documentation does not state the zone; Exotel accounts in India
 * report IST, so a zone-less value is read as +05:30. Durations (seconds) are authoritative; these times are informational.
 */
export function parseExotelTime(v: unknown): string | null {
  const s = text(v, 40);
  if (!s) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(" ", "T") : `${s.replace(" ", "T")}+05:30`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Normalises either a status-callback body or a Call Details response (`{ Call: {...} }`) into one event. */
export function normalizeExotel(raw: Record<string, unknown>, fallbackEvent = "status"): NormalizedCallEvent | null {
  const p = (raw.Call && typeof raw.Call === "object" ? raw.Call : raw) as Record<string, unknown>;
  const sid = text(p.CallSid ?? p.Sid, 80);
  if (!sid || !/^[A-Za-z0-9_-]{6,80}$/.test(sid)) return null;
  const eventType = text(raw.EventType ?? p.EventType, 40) ?? fallbackEvent;
  const status = mapExotelStatus(p.Status, eventType);
  const details = (p.Details && typeof p.Details === "object" ? p.Details : {}) as Record<string, unknown>;
  const direction = String(p.Direction ?? "").toLowerCase();
  const duration = num(p.Duration);
  const conversation = num(p.ConversationDuration ?? details.ConversationDuration);
  const start = parseExotelTime(p.StartTime);
  const end = parseExotelTime(p.EndTime);
  const rec = text(p.RecordingUrl, 500);
  const failed = status === "failed" || status === "busy" || status === "missed";
  return {
    providerCallId: sid, eventType, status,
    direction: direction === "inbound" ? "inbound" : direction.startsWith("outbound") ? "outbound" : null,
    from: text(p.From, 40), to: text(p.To, 40),
    startedAt: start, answeredAt: status === "connected" ? new Date().toISOString() : null, endedAt: end,
    durationSeconds: duration, conversationSeconds: conversation,
    recordingUrl: rec && /^https:\/\//i.test(rec) ? rec : null,
    failureReason: failed ? `Exotel reported "${String(p.Status)}"` : null,
    dedupeKey: `exotel:${sid}:${eventType}:${String(p.Status ?? "")}:${duration ?? ""}:${end ?? ""}`,
    customField: text(p.CustomField, 128),
  };
}

export class ExotelProvider implements TelephonyProvider {
  readonly name = "exotel" as const;
  constructor(private cfg: Partial<ExotelConfig>, private fetchFn: FetchLike = (u, i) => fetch(u, i)) {}

  assertConfigured(): void {
    const missing = (["accountSid", "apiKey", "apiToken"] as const).filter((k) => !this.cfg[k]);
    if (missing.length) {
      throw new ProviderNotConfigured(
        "Exotel is not configured yet. An administrator must set EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY and EXOTEL_API_TOKEN as Supabase secrets.");
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(this.cfg.subdomain ?? "")) throw new ProviderNotConfigured("EXOTEL_SUBDOMAIN is not a valid host name.");
  }

  validatePhoneNumber(raw: unknown): PhoneResult { return normalizePhone(raw); }

  private url(path: string) { return `https://${this.cfg.subdomain}/v1/Accounts/${encodeURIComponent(this.cfg.accountSid!)}${path}`; }
  private auth() { return { Authorization: `Basic ${btoa(`${this.cfg.apiKey}:${this.cfg.apiToken}`)}` }; }

  /** The documented "Connect Two Numbers" call: Exotel rings `From` (the counsellor) first, then dials `To` (the parent). */
  buildConnectForm(i: InitiateCallInput): URLSearchParams {
    const f = new URLSearchParams();
    f.set("From", i.staffPhone);
    f.set("To", i.parentPhone);
    f.set("CallerId", i.callerId);
    f.set("CallType", "trans");
    f.set("TimeLimit", "3600");
    f.set("TimeOut", "45");
    f.set("StatusCallback", i.callbackUrl);
    f.append("StatusCallbackEvents[]", "terminal");
    f.append("StatusCallbackEvents[]", "answered");
    f.set("StatusCallbackContentType", "application/json");
    f.set("CustomField", i.customField.slice(0, 128));
    if (i.record) { f.set("Record", "true"); f.set("RecordingChannels", "dual"); }
    return f;
  }

  async initiateCall(i: InitiateCallInput): Promise<InitiateCallResult> {
    this.assertConfigured();
    let res: Response;
    try {
      res = await this.fetchFn(this.url("/Calls/connect"), {
        method: "POST",
        headers: { ...this.auth(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: this.buildConnectForm(i).toString(),
        signal: timeoutSignal(20_000),
      });
    } catch {
      // The request may or may not have reached Exotel, so it is NOT retried: a retry could ring the parent twice.
      throw new ProviderError("Could not reach Exotel. The call may not have started - check before trying again.", 502, "network", false);
    }
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok) throw this.errorFor(res.status, body);
    const ev = body ? normalizeExotel(body, "initiate") : null;
    if (!ev) throw new ProviderError("Exotel accepted the request but did not return a call id.", 502, "bad_response");
    return { providerCallId: ev.providerCallId, status: ev.status ?? "initiating" };
  }

  async getCallDetails(callSid: string): Promise<NormalizedCallEvent> {
    this.assertConfigured();
    const res = await this.fetchFn(`${this.url(`/Calls/${encodeURIComponent(callSid)}.json`)}?details=true`, {
      headers: { ...this.auth(), Accept: "application/json" }, signal: timeoutSignal(15_000),
    });
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok) throw this.errorFor(res.status, body);
    const ev = body ? normalizeExotel(body, "details") : null;
    if (!ev) throw new ProviderError("Exotel returned call details in an unexpected format.", 502, "bad_response");
    return ev;
  }
  getCallStatus(callSid: string) { return this.getCallDetails(callSid); }

  processWebhook(payload: Record<string, unknown>) { return normalizeExotel(payload); }

  private errorFor(status: number, body: Record<string, unknown> | null): ProviderError {
    const rest = (body?.RestException ?? body) as Record<string, unknown> | null;
    const detail = text(rest?.Message, 200);
    if (status === 401) return new ProviderError("Exotel rejected the credentials. Check the API key and token.", 502, "unauthorized");
    if (status === 429) return new ProviderError("Exotel rate limit reached. Wait a minute and try again.", 429, "rate_limited", true);
    if (status === 409) return new ProviderError(detail ?? "The counsellor's phone is busy or switched off.", 409, "agent_unavailable");
    if (status === 400) return new ProviderError(`Exotel refused the request${detail ? `: ${detail}` : ""}.`, 400, "bad_request");
    return new ProviderError(`Exotel error (${status}).`, 502, "provider_error", status >= 500);
  }
}
