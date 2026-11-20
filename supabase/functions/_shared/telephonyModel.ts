// supabase/functions/_shared/telephonyModel.ts
//
// Click-to-Call - pure model (no Deno / DOM globals) shared by the edge handler, the provider adapters and the browser.
// Provider-neutral: phone validation, APAS call states, webhook authenticity tokens, and a common provider interface.
// Provider-specific request/response shapes live in telephony/<provider>.ts.

export const CALL_STATUSES = ["initiating", "ringing", "connected", "completed", "missed", "busy", "failed", "cancelled"] as const;
export type CallStatus = typeof CALL_STATUSES[number];
export const TERMINAL_STATUSES: readonly CallStatus[] = ["completed", "missed", "busy", "failed", "cancelled"];
export const ACTIVE_STATUSES: readonly CallStatus[] = ["initiating", "ringing", "connected"];
export const PROVIDERS = ["exotel", "airtel_iq"] as const;
export type ProviderName = typeof PROVIDERS[number];

export const isTerminal = (s: string) => (TERMINAL_STATUSES as readonly string[]).includes(s);

// ── phone numbers ──────────────────────────────────────────────────────────────────────────────────────────────────
export type PhoneResult = { ok: true; e164: string } | { ok: false; error: string };

/**
 * Parent numbers are typed by hand in many shapes ("98765 43210", "09876543210", "+91-9876543210", "919876543210").
 * Indian mobiles are normalised to +91XXXXXXXXXX (must start 6-9). Anything with an explicit +CC for another country is
 * accepted if it has 8-15 digits. Anything else is rejected, never guessed.
 */
export function normalizePhone(raw: unknown, defaultCountry = "91"): PhoneResult {
  if (typeof raw !== "string") return { ok: false, error: "No phone number on this lead" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "No phone number on this lead" };
  if (/[^\d\s+\-().]/.test(trimmed)) return { ok: false, error: "The phone number contains characters that are not allowed" };
  const plus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (plus) {
    if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return { ok: false, error: "That international number looks wrong" };
    if (digits.startsWith("91") && !/^91[6-9]\d{9}$/.test(digits)) return { ok: false, error: "That is not a valid Indian mobile number" };
    return { ok: true, e164: `+${digits}` };
  }
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.startsWith(defaultCountry) && digits.length === defaultCountry.length + 10) digits = digits.slice(defaultCountry.length);
  if (/^[6-9]\d{9}$/.test(digits)) return { ok: true, e164: `+${defaultCountry}${digits}` };
  return { ok: false, error: "That is not a valid 10-digit mobile number" };
}

export const last10 = (s: string) => s.replace(/\D/g, "").slice(-10);
/** "+919876543210" -> "+91 98765 43210" for display. */
export function formatPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

// ── calling window ───────────────────────────────────────────────────────────────────────────────────────────────
/** Is `now` inside [start, end) when read in the school's timezone? (The database enforces the same rule; this is for the UI.) */
export function withinCallWindow(now: Date, tz: string, start: string, end: string): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const cur = hh * 60 + mm;
  const toMin = (t: string) => { const [h, m] = t.split(":"); return Number(h) * 60 + Number(m); };
  return cur >= toMin(start) && cur < toMin(end);
}

// ── duration text ───────────────────────────────────────────────────────────────────────────────────────────────
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return s ? `${m} minute${m === 1 ? "" : "s"} ${s} second${s === 1 ? "" : "s"}` : `${m} minute${m === 1 ? "" : "s"}`;
}

// ── webhook authenticity ─────────────────────────────────────────────────────────────────────────────────────────
// Exotel's documentation describes no signature on status callbacks, so every callback URL we hand out carries an HMAC token
// derived from a server-only secret and the call id. A guessed or replayed URL for a different call fails verification.
const enc = new TextEncoder();
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const callbackToken = (secret: string, scope: string) => hmacHex(secret, `apas-telephony:${scope}`);

/** Constant-time compare so the token can't be guessed by timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function verifyCallbackToken(secret: string, scope: string, token: unknown): Promise<boolean> {
  if (!secret || typeof token !== "string" || token.length < 32) return false;
  return safeEqual(await callbackToken(secret, scope), token);
}

// ── provider contract ────────────────────────────────────────────────────────────────────────────────────────────
/** What the rest of APAS sees, whatever the provider. */
export interface NormalizedCallEvent {
  providerCallId: string;
  eventType: string;                 // provider's own event name, kept for the audit trail
  status: CallStatus | null;
  direction: "outbound" | "inbound" | null;
  from: string | null;
  to: string | null;
  startedAt: string | null;          // ISO
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  conversationSeconds: number | null;
  recordingUrl: string | null;
  failureReason: string | null;
  dedupeKey: string;
  customField: string | null;
}

export interface InitiateCallInput {
  staffPhone: string;                // E.164 - rung first
  parentPhone: string;               // E.164
  callerId: string;                  // school's provider number
  callbackUrl: string;
  customField: string;               // our call id, echoed back by the provider
  record: boolean;
}
export interface InitiateCallResult { providerCallId: string; status: CallStatus }

export interface TelephonyProvider {
  readonly name: ProviderName;
  /** Missing credentials -> throws ProviderNotConfigured (never pretends to dial). */
  assertConfigured(): void;
  validatePhoneNumber(raw: unknown): PhoneResult;
  initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;
  getCallStatus(providerCallId: string): Promise<NormalizedCallEvent>;
  getCallDetails(providerCallId: string): Promise<NormalizedCallEvent>;
  processWebhook(payload: Record<string, unknown>): NormalizedCallEvent | null;
}

export class ProviderNotConfigured extends Error {
  readonly code = "provider_not_configured";
  constructor(message: string) { super(message); this.name = "ProviderNotConfigured"; }
}
export class ProviderError extends Error {
  constructor(message: string, readonly status: number, readonly providerCode?: string, readonly retryable = false) { super(message); this.name = "ProviderError"; }
}

// ── labels for the UI ────────────────────────────────────────────────────────────────────────────────────────────
export const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  initiating: "Initiating", ringing: "Ringing", connected: "Connected", completed: "Completed",
  missed: "Missed", busy: "Busy", failed: "Failed", cancelled: "Cancelled",
};
