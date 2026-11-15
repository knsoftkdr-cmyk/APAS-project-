import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleLeadWebhook, type IngestResult, type IntegrationRow, type WebhookDeps } from "../../supabase/functions/_shared/leadWebhookCore";
import { hmacSha256Hex } from "../../supabase/functions/_shared/leadIngestionModel";
import { checkMetaPage, fetchMetaLead, subscribeMetaPage, zohoAccessToken, zohoRecentLeads } from "../../supabase/functions/_shared/leadProviders";

const BASE = "https://proj.supabase.co/functions/v1/log-audit";
const TOKEN = "t".repeat(48);

function integ(provider: IntegrationRow["provider"], config: any = {}): IntegrationRow {
  return { id: "int-1", school_id: "sch-1", provider, name: `${provider} test`, status: "active", config, field_mapping: {} };
}

function makeDeps(i: IntegrationRow, secrets: Record<string, string>, fetchImpl?: any) {
  const ingested: any[] = [];
  const failures: any[] = [];
  const notified: IngestResult[] = [];
  const deps: WebhookDeps = {
    getIntegration: async (t) => (t === TOKEN ? i : null),
    getSecrets: async () => secrets,
    ingest: async (_i, lead, externalId, _p, isTest) => {
      ingested.push({ lead, externalId, isTest });
      return { status: isTest ? "test" : "created", applicant_id: "app-1", notify_emails: ["a@school.test"], student: lead.student_name } as IngestResult;
    },
    sealPayload: async (_i, p) => "sealed:" + JSON.stringify(p).length,
    logFailure: async (_i, externalId, error, payload, permanent) => { failures.push({ externalId, error, payload, permanent }); },
    notify: async (_i, r) => { notified.push(r); },
    fetch: fetchImpl ?? (async () => { throw new Error("unexpected network call"); }),
    graphBase: "https://graph.test",
    zohoOverrides: { accounts: "https://accounts.test", api: "https://api.test" },
  };
  return { deps, ingested, failures, notified };
}

const post = (qs: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}?lead_hook=${TOKEN}${qs}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

// ------------------------------------------------------------------- generic
describe("routing", () => {
  it("404s on missing / short / unknown tokens without revealing which", async () => {
    const { deps } = makeDeps(integ("website"), {});
    for (const url of [`${BASE}`, `${BASE}?lead_hook=short`, `${BASE}?lead_hook=${"z".repeat(48)}`]) {
      const r = await handleLeadWebhook(new Request(url, { method: "POST", body: "{}" }), deps);
      expect(r.status).toBe(404);
    }
  });
  it("rejects oversized bodies", async () => {
    const { deps, ingested } = makeDeps(integ("website"), {});
    const r = await handleLeadWebhook(post("", "x".repeat(300_000)), deps);
    expect(r.status).toBe(413);
    expect(ingested).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------- Meta
describe("Meta Lead Ads", () => {
  const secrets = { verify_token: "vt-123", app_secret: "app-secret", page_access_token: "PAGE_TOKEN" };
  const eventBody = (leadgen_id = "LG1", page_id = "111", form_id = "F1") => JSON.stringify({
    object: "page", entry: [{ id: page_id, time: 1, changes: [{ field: "leadgen", value: { leadgen_id, page_id, form_id, created_time: 1 } }] }],
  });
  const sign = async (body: string, secret = "app-secret") => ({ "x-hub-signature-256": "sha256=" + (await hmacSha256Hex(secret, body)) });
  const graph = (over: any = {}) => vi.fn(async (url: string) => {
    expect(url).toContain("https://graph.test/");
    expect(url).toContain("access_token=PAGE_TOKEN");
    expect(url).toContain("appsecret_proof=");
    return new Response(JSON.stringify({ id: "LG1", form_id: "F1", ad_id: "ad9", field_data: [
      { name: "full_name", values: ["Priya Sharma"] }, { name: "phone_number", values: ["p:+919876543210"] },
      { name: "email", values: ["p@x.com"] }, { name: "student_name", values: ["Aarav"] }, { name: "grade", values: ["5"] }], ...over }), { status: 200 });
  });

  it("answers the subscription handshake only with the right verify token", async () => {
    const { deps } = makeDeps(integ("meta"), secrets);
    const ok = await handleLeadWebhook(new Request(`${BASE}?lead_hook=${TOKEN}&hub.mode=subscribe&hub.verify_token=vt-123&hub.challenge=987654`), deps);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("987654");
    for (const q of ["&hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1", "&hub.mode=subscribe&hub.challenge=1", "&hub.verify_token=vt-123&hub.challenge=1"]) {
      expect((await handleLeadWebhook(new Request(`${BASE}?lead_hook=${TOKEN}${q}`), deps)).status).toBe(403);
    }
  });

  it("rejects unsigned / wrongly signed deliveries BEFORE calling Graph or the DB", async () => {
    const f = graph();
    const { deps, ingested } = makeDeps(integ("meta"), secrets, f);
    const body = eventBody();
    expect((await handleLeadWebhook(post("", body), deps)).status).toBe(401);
    expect((await handleLeadWebhook(post("", body, await sign(body, "attacker")), deps)).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
    expect(ingested).toHaveLength(0);
  });

  it("fetches the lead from Graph and ingests it, then notifies", async () => {
    const f = graph();
    const { deps, ingested, notified } = makeDeps(integ("meta", { page_id: "111" }), secrets, f);
    const body = eventBody();
    const r = await handleLeadWebhook(post("", body, await sign(body)), deps);
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledOnce();
    expect(ingested[0].externalId).toBe("LG1");
    expect(ingested[0].lead).toMatchObject({ parent_name: "Priya Sharma", phone: "+919876543210", student_name: "Aarav", grade: "5" });
    expect(ingested[0].lead.campaign).toMatchObject({ ad_id: "ad9", page_id: "111" });
    expect(notified).toHaveLength(1);
  });

  it("ignores events for other Pages / forms", async () => {
    const f = graph();
    const { deps, ingested } = makeDeps(integ("meta", { page_id: "111", form_ids: ["F1"] }), secrets, f);
    for (const b of [eventBody("L", "222", "F1"), eventBody("L", "111", "OTHER")]) {
      expect((await handleLeadWebhook(post("", b, await sign(b)), deps)).status).toBe(200);
    }
    expect(f).not.toHaveBeenCalled();
    expect(ingested).toHaveLength(0);
  });

  it("returns 500 (so Meta retries) when Graph is down, and keeps a replayable record", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: "oops", code: 2 } }), { status: 500 }));
    const { deps, failures, ingested } = makeDeps(integ("meta"), secrets, f);
    const body = eventBody();
    const r = await handleLeadWebhook(post("", body, await sign(body)), deps);
    expect(r.status).toBe(500);
    expect(failures[0]).toMatchObject({ externalId: "LG1", permanent: false });
    expect(failures[0].payload).toMatch(/^sealed:/);
    expect(ingested).toHaveLength(0);
  });

  it("returns 500 on a network error too", async () => {
    const { deps } = makeDeps(integ("meta"), secrets, vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const body = eventBody();
    expect((await handleLeadWebhook(post("", body, await sign(body)), deps)).status).toBe(500);
  });

  it("an expired token is permanent: 200 (no pointless retries) + flagged for the admin", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Error validating access token: Session has expired", code: 190 } }), { status: 400 }));
    const { deps, failures } = makeDeps(integ("meta"), secrets, f);
    const body = eventBody();
    const r = await handleLeadWebhook(post("", body, await sign(body)), deps);
    expect(r.status).toBe(200);
    expect(failures[0]).toMatchObject({ permanent: true });
    expect(failures[0].error).toMatch(/expired/);
  });

  it("handles several leads in one delivery", async () => {
    const f = graph();
    const { deps, ingested } = makeDeps(integ("meta"), secrets, f);
    const body = JSON.stringify({ entry: [{ id: "111", changes: [
      { field: "leadgen", value: { leadgen_id: "A", page_id: "111" } }, { field: "leadgen", value: { leadgen_id: "B", page_id: "111" } },
      { field: "feed", value: { item: "post" } }] }] });
    await handleLeadWebhook(post("", body, await sign(body)), deps);
    expect(ingested).toHaveLength(2);
  });

  it("does not leak the access token in any error path", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 400 }));
    const { deps, failures } = makeDeps(integ("meta"), secrets, f);
    const body = eventBody();
    await handleLeadWebhook(post("", body, await sign(body)), deps);
    expect(JSON.stringify(failures)).not.toContain("PAGE_TOKEN");
  });
});

// -------------------------------------------------------------------- Google
describe("Google Lead Forms", () => {
  const secrets = { google_key: "gkey-1" };
  const payload = (over: any = {}) => ({ lead_id: "GL1", form_id: "77", google_key: "gkey-1", is_test: false,
    user_column_data: [{ column_id: "FULL_NAME", string_value: "Ravi" }, { column_id: "PHONE_NUMBER", string_value: "+919000011111" }], ...over });

  it("accepts a lead with the right google_key", async () => {
    const { deps, ingested } = makeDeps(integ("google"), secrets);
    const r = await handleLeadWebhook(post("", payload()), deps);
    expect(r.status).toBe(200);
    expect(ingested[0]).toMatchObject({ externalId: "GL1", isTest: false });
  });
  it("rejects wrong / missing key", async () => {
    const { deps, ingested } = makeDeps(integ("google"), secrets);
    expect((await handleLeadWebhook(post("", payload({ google_key: "nope" })), deps)).status).toBe(401);
    expect((await handleLeadWebhook(post("", payload({ google_key: undefined })), deps)).status).toBe(401);
    expect(ingested).toHaveLength(0);
  });
  it("routes Google's 'send test data' as a test (nothing created)", async () => {
    const { deps, ingested } = makeDeps(integ("google"), secrets);
    await handleLeadWebhook(post("", payload({ is_test: true })), deps);
    expect(ingested[0].isTest).toBe(true);
  });
  it("ignores forms that are not configured", async () => {
    const { deps, ingested } = makeDeps(integ("google", { form_ids: ["1"] }), secrets);
    expect((await handleLeadWebhook(post("", payload()), deps)).status).toBe(200);
    expect(ingested).toHaveLength(0);
  });
  it("never stores the google_key in the replay payload", async () => {
    const sealed: any[] = [];
    const { deps } = makeDeps(integ("google"), secrets);
    deps.sealPayload = async (_i, p) => { sealed.push(p); return "x"; };
    await handleLeadWebhook(post("", payload()), deps);
    expect(JSON.stringify(sealed)).not.toContain("gkey-1");
  });
});

// ------------------------------------------------------------- Zapier / Make
describe.each(["zapier", "make"] as const)("%s", (provider) => {
  const secrets = { api_key: "key-abc" };
  const lead = { name: "Meena", child_name: "Tara", phone: "9222233333", class: "Nursery", id: "z-1" };
  it("requires the API key (header, bearer or query)", async () => {
    const { deps, ingested } = makeDeps(integ(provider), secrets);
    expect((await handleLeadWebhook(post("", lead), deps)).status).toBe(401);
    expect((await handleLeadWebhook(post("", lead, { "x-api-key": "bad" }), deps)).status).toBe(401);
    expect(ingested).toHaveLength(0);
    for (const r of [post("", lead, { "x-api-key": "key-abc" }), post("", lead, { authorization: "Bearer key-abc" }), post("&key=key-abc", lead)]) {
      expect((await handleLeadWebhook(r, deps)).status).toBe(200);
    }
    expect(ingested).toHaveLength(3);
    expect(ingested[0].externalId).toBe("z-1");
  });
  it("accepts a batch (array) and caps it", async () => {
    const { deps, ingested } = makeDeps(integ(provider), secrets);
    const many = Array.from({ length: 80 }, (_, n) => ({ name: "P" + n, phone: "92222333" + String(n).padStart(2, "0") }));
    await handleLeadWebhook(post("", many, { "x-api-key": "key-abc" }), deps);
    expect(ingested).toHaveLength(50);
  });
  it("fails closed when no key is configured", async () => {
    const { deps } = makeDeps(integ(provider), {});
    expect((await handleLeadWebhook(post("", lead, { "x-api-key": "" }), deps)).status).toBe(401);
  });
  it("accepts form-encoded bodies (Zapier 'Form' payload type)", async () => {
    const { deps, ingested } = makeDeps(integ(provider), secrets);
    const r = await handleLeadWebhook(new Request(`${BASE}?lead_hook=${TOKEN}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-api-key": "key-abc" },
      body: "name=Meena&phone=9222233333&child_name=Tara" }), deps);
    expect(r.status).toBe(200);
    expect(ingested[0].lead.student_name).toBe("Tara");
  });
  it("reports a lead with no contact details as a failure, but with HTTP 200 (retrying can't help)", async () => {
    const { deps, failures, ingested } = makeDeps(integ(provider), secrets);
    const r = await handleLeadWebhook(post("", { name: "Nobody" }, { "x-api-key": "key-abc" }), deps);
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(false);
    expect(failures[0].error).toMatch(/missing_contact/);
    expect(ingested).toHaveLength(0);
  });
  it("uses Idempotency-Key when the body has no id", async () => {
    const { deps, ingested } = makeDeps(integ(provider), secrets);
    await handleLeadWebhook(post("", { name: "M", phone: "9222233333" }, { "x-api-key": "key-abc", "idempotency-key": "idem-1" }), deps);
    expect(ingested[0].externalId).toBe("idem-1");
  });
  it("returns 429 when the database says rate limited", async () => {
    const { deps } = makeDeps(integ(provider), secrets);
    deps.ingest = async () => ({ status: "rate_limited" });
    const r = await handleLeadWebhook(post("", lead, { "x-api-key": "key-abc" }), deps);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
  });
  it("returns 500 when the database is unavailable so the sender retries", async () => {
    const { deps } = makeDeps(integ(provider), secrets);
    deps.ingest = async () => { throw new Error("db down"); };
    await expect(handleLeadWebhook(post("", lead, { "x-api-key": "key-abc" }), deps)).rejects.toThrow("db down"); // wrapper turns this into 500
  });
});

// ---------------------------------------------------------------------- Zoho
describe("Zoho CRM", () => {
  const secrets = { api_key: "zk", client_id: "cid", client_secret: "cs", refresh_token: "rt" };
  it("ingests a workflow-webhook record", async () => {
    const { deps, ingested } = makeDeps(integ("zoho"), secrets);
    const r = await handleLeadWebhook(post("", { id: "Z9", First_Name: "Anita", Last_Name: "Rao", Phone: "9111122222", Email: "a@x.com", Student_Name: "Kabir" }, { "x-api-key": "zk" }), deps);
    expect(r.status).toBe(200);
    expect(ingested[0].externalId).toBe("Z9");
    expect(ingested[0].lead).toMatchObject({ parent_name: "Anita Rao", student_name: "Kabir" });
  });
  it("resolves a notification-API delivery ({ids}) via the Zoho API", async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string, init?: any) => {
      calls.push(url);
      if (url.startsWith("https://accounts.test/oauth/v2/token")) return new Response(JSON.stringify({ access_token: "AT" }));
      expect(init.headers.Authorization).toBe("Zoho-oauthtoken AT");
      return new Response(JSON.stringify({ data: [{ id: "Z1", Last_Name: "Rao", Phone: "9111122222" }, { id: "Z2", Last_Name: "Das", Email: "d@x.com" }] }));
    });
    const { deps, ingested } = makeDeps(integ("zoho"), secrets, f);
    const r = await handleLeadWebhook(post("", { module: "Leads", ids: ["Z1", "Z2"] }, { "x-api-key": "zk" }), deps);
    expect(r.status).toBe(200);
    expect(ingested.map((x) => x.externalId)).toEqual(["Z1", "Z2"]);
    expect(calls.some((c) => c.includes("Leads?ids=Z1,Z2"))).toBe(true);
  });
  it("500s on a Zoho outage, 200 + flag on bad credentials", async () => {
    const down = makeDeps(integ("zoho"), secrets, vi.fn(async () => new Response("{}", { status: 503 })));
    expect((await handleLeadWebhook(post("", { ids: ["Z1"] }, { "x-api-key": "zk" }), down.deps)).status).toBe(500);
    const bad = makeDeps(integ("zoho"), secrets, vi.fn(async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 200 })));
    expect((await handleLeadWebhook(post("", { ids: ["Z1"] }, { "x-api-key": "zk" }), bad.deps)).status).toBe(200);
    expect(bad.failures[0].permanent).toBe(true);
  });
  it("requires the API key", async () => {
    const { deps } = makeDeps(integ("zoho"), secrets);
    expect((await handleLeadWebhook(post("", { Last_Name: "x" }), deps)).status).toBe(401);
  });
});

// ------------------------------------------------------------------- Website
describe("website form", () => {
  const origin = "https://myschool.edu";
  const form = (body: string, extra: Record<string, string> = {}) =>
    new Request(`${BASE}?lead_hook=${TOKEN}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin, ...extra }, body });

  it("accepts an HTML form post and echoes the allowed origin for CORS", async () => {
    const { deps, ingested } = makeDeps(integ("website", { allowed_origins: [origin] }), {});
    const r = await handleLeadWebhook(form("name=Meena&phone=9222233333&child_name=Tara&class=LKG"), deps);
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(origin);
    expect(ingested[0].lead).toMatchObject({ parent_name: "Meena", student_name: "Tara", grade: "LKG" });
  });
  it("blocks posts from a site that is not on the allow-list", async () => {
    const { deps, ingested } = makeDeps(integ("website", { allowed_origins: [origin] }), {});
    const r = await handleLeadWebhook(form("name=M&phone=9222233333", { origin: "https://evil.example" }), deps);
    expect(r.status).toBe(403);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    expect(ingested).toHaveLength(0);
  });
  it("blocks a post with no Origin / Referer when an allow-list exists", async () => {
    const { deps } = makeDeps(integ("website", { allowed_origins: [origin] }), {});
    const req = new Request(`${BASE}?lead_hook=${TOKEN}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "M", phone: "9222233333" }) });
    expect((await handleLeadWebhook(req, deps)).status).toBe(403);
  });
  it("answers CORS preflight only for allowed origins", async () => {
    const { deps } = makeDeps(integ("website", { allowed_origins: [origin] }), {});
    const ok = await handleLeadWebhook(new Request(`${BASE}?lead_hook=${TOKEN}`, { method: "OPTIONS", headers: { origin } }), deps);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(origin);
    const bad = await handleLeadWebhook(new Request(`${BASE}?lead_hook=${TOKEN}`, { method: "OPTIONS", headers: { origin: "https://evil.example" } }), deps);
    expect(bad.status).toBe(403);
  });
  it("silently drops bot submissions that fill the honeypot", async () => {
    const { deps, ingested } = makeDeps(integ("website"), {});
    const r = await handleLeadWebhook(form("name=Bot&phone=9222233333&_hp=http%3A%2F%2Fspam"), deps);
    expect(r.status).toBe(200);
    expect(ingested).toHaveLength(0);
  });
  it("redirects HTML-form posts to the success page when configured", async () => {
    const { deps } = makeDeps(integ("website", { success_redirect: "https://myschool.edu/thanks" }), {});
    const r = await handleLeadWebhook(form("name=M&phone=9222233333"), deps);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("https://myschool.edu/thanks");
  });
  it("tells the visitor when they left out phone AND email (422), but not about our own setup problems", async () => {
    const a = makeDeps(integ("website"), {});
    expect((await handleLeadWebhook(form("name=OnlyName"), a.deps)).status).toBe(422);
    const b = makeDeps(integ("website"), {});
    b.deps.ingest = async () => ({ status: "needs_review", error: "no_open_intake" });
    expect((await handleLeadWebhook(form("name=M&phone=9222233333"), b.deps)).status).toBe(200);
  });
  it("rejects GET", async () => {
    const { deps } = makeDeps(integ("website"), {});
    expect((await handleLeadWebhook(new Request(`${BASE}?lead_hook=${TOKEN}`), deps)).status).toBe(405);
  });
  it("rejects invalid JSON", async () => {
    const { deps } = makeDeps(integ("website"), {});
    expect((await handleLeadWebhook(post("", "{not json"), deps)).status).toBe(400);
  });
});

// ---------------------------------------------------------- provider clients
describe("provider clients (mock servers)", () => {
  const creds = { page_access_token: "PAGE_TOKEN", app_secret: "app-secret" };
  it("Meta: reads a lead, with an appsecret_proof", async () => {
    let seen = "";
    const lead = await fetchMetaLead("123", creds, async (u) => { seen = u; return new Response(JSON.stringify({ id: "123", field_data: [] })); }, { base: "https://g.test" });
    expect(lead.id).toBe("123");
    const proof = new URL(seen).searchParams.get("appsecret_proof");
    expect(proof).toBe(await hmacSha256Hex("app-secret", "PAGE_TOKEN"));
  });
  it("Meta: reports Page + whether leadgen is subscribed", async () => {
    const f = async (u: string) => new Response(JSON.stringify(u.includes("subscribed_apps")
      ? { data: [{ id: "app", subscribed_fields: ["leadgen"] }] } : { id: "111", name: "My School" }));
    expect(await checkMetaPage("111", creds, f, { base: "https://g.test" })).toEqual({ page_id: "111", page_name: "My School", leadgen_subscribed: true });
  });
  it("Meta: subscribe POSTs subscribed_fields=leadgen", async () => {
    let init: any; let url = "";
    expect(await subscribeMetaPage("111", creds, async (u, i) => { url = u; init = i; return new Response('{"success":true}'); }, { base: "https://g.test" })).toBe(true);
    expect(url).toContain("/111/subscribed_apps");
    expect(String(init.body)).toContain("subscribed_fields=leadgen");
    expect(init.method).toBe("POST");
  });
  it("Zoho: exchanges the refresh token against the right data-centre host", async () => {
    let url = ""; let body = "";
    const t = await zohoAccessToken({ client_id: "c", client_secret: "s", refresh_token: "r" }, "in", async (u, i) => { url = u; body = String(i!.body); return new Response('{"access_token":"AT"}'); });
    expect(t).toBe("AT");
    expect(url).toBe("https://accounts.zoho.in/oauth/v2/token");
    expect(body).toContain("grant_type=refresh_token");
  });
  it("Zoho: a bad credential surfaces a clear permanent error", async () => {
    await expect(zohoAccessToken({ client_id: "c", client_secret: "s", refresh_token: "r" }, "com", async () => new Response('{"error":"invalid_code"}')))
      .rejects.toMatchObject({ transient: false, message: expect.stringContaining("invalid_code") });
  });
  it("Zoho: pages through recent leads and sends If-Modified-Since", async () => {
    const seen: any[] = [];
    const f = async (u: string, init?: any) => {
      if (u.includes("oauth")) return new Response('{"access_token":"AT"}');
      seen.push({ u, h: init.headers });
      const page = Number(new URL(u).searchParams.get("page"));
      return new Response(JSON.stringify({ data: [{ id: "P" + page }], info: { more_records: page < 2 } }));
    };
    const recs = await zohoRecentLeads({ client_id: "c", client_secret: "s", refresh_token: "r" }, "com", "2026-11-01T00:00:00Z", f, { accounts: "https://a.test", api: "https://api.test" });
    expect(recs.map((r) => r.id)).toEqual(["P1", "P2"]);
    expect(seen[0].h["If-Modified-Since"]).toBe("2026-11-01T00:00:00Z");
  });
});
