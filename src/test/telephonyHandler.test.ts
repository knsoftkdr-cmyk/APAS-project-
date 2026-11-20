/* eslint-disable @typescript-eslint/no-explicit-any */
// Click-to-Call edge handler: start / refresh / recording and the provider status callback. The database and the provider's HTTP API
// are faked; the handler, provider adapter, token check and validation are the real code.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth: { ctx: unknown; deny?: boolean } = { ctx: null };
vi.mock("../../supabase/functions/_shared/learningGroupsData.ts", () => ({
  corsHeaders: {},
  json: (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } }),
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  authenticateStaff: async () => (auth.deny ? { ok: false, res: new Response(JSON.stringify({ error: "Not permitted" }), { status: 403 }) } : { ok: true, ctx: auth.ctx }),
}));

import { __setAdminFactory, handleTelephonyCalls, handleTelephonyWebhook } from "../../supabase/functions/_shared/handlers/telephonyCalls";
import { callbackToken } from "../../supabase/functions/_shared/telephonyModel";

const SCHOOL = "11111111-1111-1111-1111-111111111111", USER = "a0000000-0000-0000-0000-000000000001", LEAD = "b0000000-0000-0000-0000-000000000001", CALL = "c0000000-0000-0000-0000-000000000001";
const ENV: Record<string, string> = { SUPABASE_URL: "https://proj.supabase.co", EXOTEL_ACCOUNT_SID: "acme1", EXOTEL_API_KEY: "KEY", EXOTEL_API_TOKEN: "TOKEN", TELEPHONY_WEBHOOK_SECRET: "webhook-secret-value" };
let env: Record<string, string>;

interface FakeDb { rows: Record<string, unknown>; rpc: Record<string, (a: any) => unknown>; calls: Array<{ name: string; args: any }>; inserted: any[] }
function fakeAdmin(db: FakeDb) {
  return {
    from: (table: string) => {
      const q: any = { eq: () => q, select: () => q, maybeSingle: async () => ({ data: db.rows[table] ?? null }), insert: async (r: any) => { db.inserted.push({ table, r }); return {}; } };
      return q;
    },
    rpc: async (name: string, args: any) => { db.calls.push({ name, args }); const f = db.rpc[name]; return { data: f ? f(args) : null, error: null }; },
  };
}
let db: FakeDb; let fetchMock: ReturnType<typeof vi.fn>;
const baseDb = (): FakeDb => ({
  rows: {
    admission_applicants: { id: LEAD, parent_phone: "98765 43210" },
    telephony_school_settings: { provider: "exotel", enabled: true, caller_id: "+911140000000" },
    telephony_staff: { phone: "+919000000001" },
  },
  rpc: { tel_begin_call: () => ({ status: "ok", call_id: CALL, caller_id: "+911140000000", recording: false }) },
  calls: [], inserted: [],
});
const post = (body: unknown) => handleTelephonyCalls(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
const exotelOk = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  env = { ...ENV }; (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
  db = baseDb(); auth.deny = false; auth.ctx = { admin: fakeAdmin(db), userId: USER, caller: { schoolId: SCHOOL, role: "admin", isStaff: true } };
  __setAdminFactory(async () => fakeAdmin(db));
  if (typeof AbortSignal.timeout !== "function") (AbortSignal as any).timeout = () => new AbortController().signal; // Deno has it; jsdom does not
  fetchMock = vi.fn(); (globalThis as any).fetch = fetchMock;
});
afterEach(() => { delete (globalThis as any).Deno; });

describe("start a call", () => {
  it("rings through Exotel with a per-call callback URL and records the provider id", async () => {
    fetchMock.mockResolvedValue(exotelOk({ Call: { Sid: "callsid12345", Status: "queued" } }));
    const r = await post({ mode: "tel_call", op: "start", applicant_id: LEAD });
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ call_id: CALL, status: "initiating" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.exotel.com/v1/Accounts/acme1/Calls/connect");
    const form = new URLSearchParams(init.body);
    expect(form.get("To")).toBe("+919876543210");            // from the database, normalised - never from the browser
    expect(form.get("From")).toBe("+919000000001");
    const cb = new URL(form.get("StatusCallback")!);
    expect(cb.pathname).toBe("/functions/v1/log-audit"); expect(cb.searchParams.get("cid")).toBe(CALL);
    expect(cb.searchParams.get("t")).toBe(await callbackToken(ENV.TELEPHONY_WEBHOOK_SECRET, `call:${CALL}`));
    expect(db.calls.find((c) => c.name === "tel_mark_dialed")!.args).toEqual({ p_call: CALL, p_provider_call_id: "callsid12345" });
    expect(db.inserted.some((i) => i.r.action === "call_initiated")).toBe(true);
  });
  it("ignores a phone number or school sent by the browser", async () => {
    fetchMock.mockResolvedValue(exotelOk({ Call: { Sid: "callsid12345", Status: "queued" } }));
    await post({ mode: "tel_call", op: "start", applicant_id: LEAD, phone: "+910000000000", school_id: "evil", to: "+911111111111" });
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("To")).toBe("+919876543210");
    expect(db.calls[0].args.p_school).toBe(SCHOOL);
  });
  it("does not record unless the school allowed it AND the counsellor confirmed consent", async () => {
    fetchMock.mockResolvedValue(exotelOk({ Call: { Sid: "callsid12345", Status: "queued" } }));
    await post({ op: "start", applicant_id: LEAD, record: true });
    const begins = () => db.calls.filter((c) => c.name === "tel_begin_call");
    expect(begins()[0].args.p_record).toBe(false);
    await post({ op: "start", applicant_id: LEAD, record: true, recording_consent: true });
    expect(begins()[1].args.p_record).toBe(true);
  });
  it("is refused for unauthorised staff", async () => { auth.deny = true; expect((await post({ op: "start", applicant_id: LEAD })).status).toBe(403); expect(fetchMock).not.toHaveBeenCalled(); });
  it("rejects a bad applicant id and an unknown lead", async () => {
    expect((await post({ op: "start", applicant_id: "nope" })).status).toBe(400);
    db.rows.admission_applicants = null; expect((await post({ op: "start", applicant_id: LEAD })).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects an invalid parent number before any call is created", async () => {
    db.rows.admission_applicants = { id: LEAD, parent_phone: "12345" };
    const r = await post({ op: "start", applicant_id: LEAD });
    expect(r.status).toBe(400); expect((await r.json()).code).toBe("invalid_phone");
    expect(db.calls.length).toBe(0); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("asks for the counsellor's own number when missing", async () => {
    db.rows.telephony_staff = null;
    const r = await post({ op: "start", applicant_id: LEAD }); expect(r.status).toBe(400); expect((await r.json()).code).toBe("staff_phone_missing");
  });
  it("says so clearly when calling is off or the provider is not configured - and never dials", async () => {
    db.rows.telephony_school_settings = { provider: "exotel", enabled: false, caller_id: null };
    expect((await post({ op: "start", applicant_id: LEAD })).status).toBe(412);
    db.rows.telephony_school_settings = { provider: "exotel", enabled: true, caller_id: "+911140000000" };
    delete env.EXOTEL_API_TOKEN;
    const r = await post({ op: "start", applicant_id: LEAD }); expect(r.status).toBe(503); expect((await r.json()).code).toBe("provider_not_configured");
    env = { ...ENV }; delete env.TELEPHONY_WEBHOOK_SECRET;
    expect((await post({ op: "start", applicant_id: LEAD })).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("Airtel IQ school setting reports not integrated", async () => {
    db.rows.telephony_school_settings = { provider: "airtel_iq", enabled: true, caller_id: "+911140000000" };
    const r = await post({ op: "start", applicant_id: LEAD }); expect(r.status).toBe(503); expect((await r.json()).error).toMatch(/Airtel IQ is not integrated/);
  });
  it.each([["duplicate", 409], ["rate_limited", 429], ["outside_window", 409], ["forbidden", 403], ["not_enabled", 412]])("maps database decision %s to HTTP %i without dialing", async (status, http) => {
    db.rpc.tel_begin_call = () => ({ status, call_id: CALL });
    const r = await post({ op: "start", applicant_id: LEAD }); expect(r.status).toBe(http); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("marks the call failed and shows the provider's reason when Exotel refuses", async () => {
    fetchMock.mockResolvedValue(exotelOk({ RestException: { Message: "" } }, 401));
    const r = await post({ op: "start", applicant_id: LEAD });
    expect(r.status).toBe(502); expect((await r.json()).error).toMatch(/credentials/);
    expect(db.calls.find((c) => c.name === "tel_fail_call")!.args.p_call).toBe(CALL);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no automatic retry
  });
  it("marks the call failed on a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const r = await post({ op: "start", applicant_id: LEAD }); expect(r.status).toBe(502); expect(db.calls.some((c) => c.name === "tel_fail_call")).toBe(true);
  });
  it("rejects unknown operations", async () => { expect((await post({ op: "format_disk" })).status).toBe(400); });
});

describe("provider status callback", () => {
  const cb = async (body: unknown, opts: { token?: string | null; cid?: string; inbound?: boolean; ct?: string; method?: string } = {}) => {
    const t = opts.token === undefined ? await callbackToken(ENV.TELEPHONY_WEBHOOK_SECRET, opts.inbound ? "inbound" : `call:${opts.cid ?? CALL}`) : opts.token;
    const u = new URL("https://proj.supabase.co/functions/v1/log-audit");
    u.searchParams.set("telephony", "exotel"); if (opts.inbound) u.searchParams.set("inbound", "1"); else u.searchParams.set("cid", opts.cid ?? CALL); if (t) u.searchParams.set("t", t);
    const ct = opts.ct ?? "application/json";
    const payload = typeof body === "string" ? body : ct.includes("json") ? JSON.stringify(body) : new URLSearchParams(body as any).toString();
    return handleTelephonyWebhook(new Request(u.toString(), { method: opts.method ?? "POST", headers: { "Content-Type": ct }, body: payload }));
  };
  const terminal = { CallSid: "callsid12345", EventType: "terminal", Status: "completed", Duration: 280, ConversationDuration: 275, From: "+919000000001", To: "+919876543210", Direction: "outbound-api", CustomField: CALL };
  beforeEach(() => {
    db.rows.admission_calls = { id: CALL, provider: "exotel", provider_call_id: "callsid12345" };
    db.rpc.tel_record_event = () => "applied";
    fetchMock.mockRejectedValue(new Error("no provider in tests"));
  });

  it("applies an authenticated callback through the idempotent database function", async () => {
    const r = await cb(terminal); expect(r.status).toBe(200); expect(await r.json()).toEqual({ result: "applied" });
    const a = db.calls.find((c) => c.name === "tel_record_event")!.args;
    expect(a).toMatchObject({ p_provider: "exotel", p_provider_call_id: "callsid12345", p_status: "completed", p_duration: 280, p_conversation: 275 });
    expect(a.p_dedupe_key).toContain("callsid12345");
  });
  it("accepts Exotel's default form-encoded body too", async () => { expect((await cb(terminal, { ct: "application/x-www-form-urlencoded" })).status).toBe(200); });
  it("rejects a wrong, missing, or another call's token", async () => {
    expect((await cb(terminal, { token: "0".repeat(64) })).status).toBe(401);
    expect((await cb(terminal, { token: null })).status).toBe(401);
    const other = await callbackToken(ENV.TELEPHONY_WEBHOOK_SECRET, "call:c0000000-0000-0000-0000-0000000000ff");
    expect((await cb(terminal, { token: other })).status).toBe(401);
    expect(db.calls.length).toBe(0);
  });
  it("rejects everything when the server has no secret configured", async () => { delete env.TELEPHONY_WEBHOOK_SECRET; expect((await cb(terminal)).status).toBe(401); });
  it("rejects malformed bodies and unrecognised payloads", async () => {
    expect((await cb("{not json")).status).toBe(400);
    expect((await cb({ Status: "completed" })).status).toBe(400);
    expect((await cb("x".repeat(70_000))).status).toBe(400);
  });
  it("a callback naming a different provider call id than the one on record is refused", async () => {
    db.rows.admission_calls = { id: CALL, provider: "exotel", provider_call_id: "someothercall" };
    expect((await cb(terminal)).status).toBe(409);
  });
  it("links the provider id when the callback arrives before the dial was recorded", async () => {
    db.rows.admission_calls = { id: CALL, provider: "exotel", provider_call_id: null };
    await cb(terminal); expect(db.calls.find((c) => c.name === "tel_mark_dialed")!.args.p_provider_call_id).toBe("callsid12345");
  });
  it("unknown call -> 404", async () => { db.rows.admission_calls = null; expect((await cb(terminal)).status).toBe(404); });
  it("duplicate delivery is acknowledged without error", async () => { db.rpc.tel_record_event = () => "duplicate"; const r = await cb(terminal); expect(r.status).toBe(200); expect(await r.json()).toEqual({ result: "duplicate" }); });
  it("confirms a finished call with Exotel's Call Details and prefers its duration", async () => {
    fetchMock.mockResolvedValue(exotelOk({ Call: { Sid: "callsid12345", Status: "completed", Duration: 281, RecordingUrl: "https://rec.example.com/x.mp3" } }));
    await cb(terminal);
    expect(fetchMock.mock.calls[0][0]).toContain("/Calls/callsid12345.json");
    expect(db.calls.find((c) => c.name === "tel_record_event")!.args).toMatchObject({ p_duration: 281, p_recording_ref: "https://rec.example.com/x.mp3" });
  });
  it("routes incoming calls to the inbound function using the inbound token", async () => {
    db.rpc.tel_record_inbound = () => "applied";
    const r = await cb({ CallSid: "incoming1234", Status: "no-answer", Direction: "inbound", From: "+919876543210", To: "+911140000000" }, { inbound: true });
    expect(await r.json()).toEqual({ result: "applied" });
    expect(db.calls.find((c) => c.name === "tel_record_inbound")!.args).toMatchObject({ p_from: "+919876543210", p_to: "+911140000000", p_status: "missed" });
    expect((await cb({ CallSid: "incoming1234", Status: "no-answer" }, { inbound: true, token: await callbackToken(ENV.TELEPHONY_WEBHOOK_SECRET, `call:${CALL}`) })).status).toBe(401);
  });
  it("rejects unknown providers and bad methods", async () => {
    expect((await handleTelephonyWebhook(new Request("https://x/?telephony=evil&cid=" + CALL + "&t=" + "a".repeat(64), { method: "POST", body: "{}" }))).status).toBe(400);
    expect((await handleTelephonyWebhook(new Request("https://x/?telephony=exotel", { method: "DELETE" }))).status).toBe(405);
  });
});

describe("refresh and recording", () => {
  it("refresh asks the provider when a callback is late and returns the stored status", async () => {
    db.rows.admission_calls = { id: CALL, school_id: SCHOOL, provider: "exotel", provider_call_id: "callsid12345", status: "ringing" };
    db.rpc.tel_user_can_call = () => true; db.rpc.tel_record_event = () => "applied";
    fetchMock.mockResolvedValue(exotelOk({ Call: { Sid: "callsid12345", Status: "completed", Duration: 30 } }));
    const r = await post({ op: "refresh", call_id: CALL }); expect(r.status).toBe(200);
    expect(db.calls.find((c) => c.name === "tel_record_event")!.args.p_event_type).toBe("poll");
  });
  it("refresh is school-scoped and permission-checked", async () => {
    db.rows.admission_calls = { id: CALL, school_id: "22222222-2222-2222-2222-222222222222", provider: "exotel", provider_call_id: "x", status: "ringing" };
    expect((await post({ op: "refresh", call_id: CALL })).status).toBe(404);
    db.rows.admission_calls = { id: CALL, school_id: SCHOOL, provider: "exotel", provider_call_id: "x", status: "ringing" }; db.rpc.tel_user_can_call = () => false;
    expect((await post({ op: "refresh", call_id: CALL })).status).toBe(403);
  });
  it("recording playback is refused unless the database authorises it, and every failure reason is explained", async () => {
    for (const [status, http] of [["forbidden", 403], ["disabled", 409], ["unavailable", 404], ["expired", 410]] as const) {
      db.rpc.tel_authorize_recording = () => ({ status }); expect((await post({ op: "recording", call_id: CALL })).status).toBe(http);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("streams an authorised recording through the server and never returns the provider URL", async () => {
    db.rpc.tel_authorize_recording = () => ({ status: "ok", ref: "https://rec.example.com/x.mp3" });
    fetchMock.mockResolvedValue(new Response("AUDIO", { headers: { "Content-Type": "audio/mpeg" } }));
    const r = await post({ op: "recording", call_id: CALL });
    expect(r.status).toBe(200); expect(r.headers.get("content-type")).toBe("audio/mpeg"); expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.text()).toBe("AUDIO"); expect(db.inserted.some((i) => i.r.action === "call_recording_played")).toBe(true);
  });
  it("refuses recording links that point at private hosts", async () => {
    for (const ref of ["http://rec.example.com/x.mp3", "https://127.0.0.1/x.mp3", "https://localhost/x", "https://meta.internal/x"]) {
      db.rpc.tel_authorize_recording = () => ({ status: "ok", ref }); expect((await post({ op: "recording", call_id: CALL })).status).toBe(502);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
