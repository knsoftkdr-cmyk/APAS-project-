// End-to-end: public webhook -> signature check -> (mock) Meta Graph / Zoho -> REAL Postgres ingest_admission_lead().
// Skipped unless a scratch database with the migration applied is provided:
//   createdb apas_e2e && psql apas_e2e -f supabase/tests/admission_lead_ingest_stub.sql \
//        -f supabase/migrations/20261113000000_admission_lead_integrations.sql
//   npm i --no-save pg && APAS_TEST_PG=postgres:///apas_e2e npx vitest run src/test/leadIngestE2E.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { handleLeadWebhook, type IngestResult, type WebhookDeps } from "../../supabase/functions/_shared/leadWebhookCore";
import { decryptJson, encryptJson, hmacSha256Hex } from "../../supabase/functions/_shared/leadIngestionModel";

const PG = process.env.APAS_TEST_PG;
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => 200 - i)));
const BASE = "https://proj.supabase.co/functions/v1/log-audit";

describe.skipIf(!PG)("lead webhook -> real database", () => {
  let pool: any; let server: http.Server; let mockBase = ""; const graphLeads: Record<string, any> = {}; let graphDown = false;
  const SCHOOL = "11111111-1111-1111-1111-111111111111", ADMIN = "22222222-2222-2222-2222-222222222222", INTAKE = "33333333-3333-3333-3333-333333333333";
  const ids: Record<string, string> = {}, tokens: Record<string, string> = {};

  const deps = (): WebhookDeps => ({
    async getIntegration(t) { const r = await pool.query("select id, school_id, provider, name, status, config, field_mapping from admission_integrations where webhook_token=$1", [t]); return r.rows[0] ?? null; },
    async getSecrets(id) { const r = await pool.query("select secrets_enc from admission_integration_secrets where integration_id=$1", [id]); return r.rows[0] ? decryptJson(r.rows[0].secrets_enc, KEY, `secrets:${id}`) : {}; },
    async ingest(i, lead, ext, payload, isTest) { const r = await pool.query("select ingest_admission_lead($1,$2,$3,$4,$5) as r", [i.id, JSON.stringify(lead), ext, payload, isTest]); return r.rows[0].r as IngestResult; },
    sealPayload: (i, p) => encryptJson(p, KEY, `ingestion:${i.id}`),
    async logFailure(i, ext, err, payload) { await pool.query("insert into admission_lead_ingestions(school_id,integration_id,external_lead_id,status,error,payload_enc) values($1,$2,$3,'failed',$4,$5)", [i.school_id, i.id, ext, err, payload]); },
    async notify() {},
    fetch: (u, init) => fetch(u, init),
    graphBase: mockBase,
  });

  beforeAll(async () => {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString: PG });
    server = http.createServer((req, res) => {
      const m = /\/v[\d.]+\/([\w-]+)/.exec(req.url ?? "");
      if (graphDown) { res.writeHead(503).end("{}"); return; }
      const lead = m && graphLeads[m[1]];
      res.writeHead(lead ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify(lead ?? { error: { message: "not found", code: 100 } }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    mockBase = `http://127.0.0.1:${(server.address() as any).port}`;

    await cleanup(); // a previous (possibly aborted) run must not break this one
    await pool.query("insert into schools(id,name) values($1,'E2E School')", [SCHOOL]);
    await pool.query("insert into profiles(id,school_id,role) values($1,$2,'principal')", [ADMIN, SCHOOL]);
    await pool.query("insert into admission_intakes(id,school_id,academic_year,grade,is_open) values($1,$2,'2026-27','Grade 5',true)", [INTAKE, SCHOOL]);
    const mk = async (provider: string, secrets: any, config: any = {}) => {
      const r = await pool.query("insert into admission_integrations(school_id,provider,name,default_intake_id,created_by,config,notify_emails) values($1,$2,$3,$4,$5,$6,'{ops@school.test}') returning id, webhook_token",
        [SCHOOL, provider, `${provider} e2e`, INTAKE, ADMIN, JSON.stringify(config)]);
      ids[provider] = r.rows[0].id; tokens[provider] = r.rows[0].webhook_token;
      if (secrets) await pool.query("insert into admission_integration_secrets values($1,$2)", [ids[provider], await encryptJson(secrets, KEY, `secrets:${ids[provider]}`)]);
    };
    await mk("meta", { verify_token: "vt", app_secret: "as", page_access_token: "PT" }, { page_id: "111" });
    await mk("google", { google_key: "gk" });
    await mk("zapier", { api_key: "zk" });
    await mk("website", null, { allowed_origins: ["https://school.edu"] });
  });
  // Fixed ids are used above, so remove everything they own (children first; the stub schema has few cascades).
  const cleanup = async () => {
    for (const [sql, arg] of [
      ["delete from governance_notifications where user_id = $1", ADMIN],
      ["delete from admission_applicants where school_id = $1", SCHOOL],   // cascades lead_meta / lead_events
      ["delete from admission_integrations where school_id = $1", SCHOOL], // cascades secrets / ingestions
      ["delete from admission_intakes where school_id = $1", SCHOOL],
      ["delete from profiles where id = $1", ADMIN],
      ["delete from schools where id = $1", SCHOOL],
    ]) await pool.query(sql, [arg]);
  };
  afterAll(async () => { server?.close(); try { await cleanup(); } finally { await pool?.end(); } });

  const req = (p: string, body: any, headers: Record<string, string> = {}, ct = "application/json") =>
    new Request(`${BASE}?lead_hook=${tokens[p]}`, { method: "POST", headers: { "content-type": ct, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const count = async (sql: string, args: any[] = []) => Number((await pool.query(sql, args)).rows[0].n);

  it("Meta: signed webhook -> Graph -> CRM applicant with source, timeline, notification", async () => {
    graphLeads["LG-1"] = { id: "LG-1", form_id: "F", ad_id: "AD", field_data: [
      { name: "full_name", values: ["Priya Sharma"] }, { name: "phone_number", values: ["p:+919876543210"] }, { name: "email", values: ["priya@x.com"] },
      { name: "child's_name", values: ["Aarav Sharma"] }, { name: "which_class_is_your_child_applying_for?", values: ["Grade 5"] }] };
    const body = JSON.stringify({ entry: [{ id: "111", changes: [{ field: "leadgen", value: { leadgen_id: "LG-1", page_id: "111", form_id: "F" } }] }] });
    const sig = { "x-hub-signature-256": "sha256=" + (await hmacSha256Hex("as", body)) };
    const r = await handleLeadWebhook(req("meta", body, sig), deps());
    expect(r.status).toBe(200);
    const a = (await pool.query("select * from admission_applicants where full_name='Aarav Sharma'")).rows[0];
    expect(a).toMatchObject({ parent_name: "Priya Sharma", parent_phone: "+919876543210", parent_email: "priya@x.com", source: "online_enquiry", status: "under_review", intake_id: INTAKE });
    const meta = (await pool.query("select * from admission_lead_meta where applicant_id=$1", [a.id])).rows[0];
    expect(meta).toMatchObject({ lead_source: "meta", external_lead_id: "LG-1" });
    expect(meta.campaign).toMatchObject({ ad_id: "AD", page_id: "111" });
    expect(await count("select count(*) n from governance_notifications where reference_id=$1 and event_type='admission_lead'", [a.id])).toBe(1);
    // ...and the lead is scored from its real data the moment it lands (online enquiry, parent email, grade known; nothing else yet)
    const sc = (await pool.query("select score, category, coverage, factors from admission_lead_scores where applicant_id=$1", [a.id])).rows[0];
    expect(sc.score).toBeGreaterThanOrEqual(40);              // a fresh enquiry with unknowns is not Cold
    expect(sc.score).toBeLessThan(70);
    expect(sc.category).toBe("warm");
    expect(sc.factors.engagement.available).toBe(false);      // no calls yet: unknown, not zero
    expect(sc.factors.interest.signals.some((x: any) => x.key === "channel")).toBe(true);
  });

  it("Meta: Meta re-delivering the same event does not create a second lead", async () => {
    const body = JSON.stringify({ entry: [{ id: "111", changes: [{ field: "leadgen", value: { leadgen_id: "LG-1", page_id: "111" } }] }] });
    const sig = { "x-hub-signature-256": "sha256=" + (await hmacSha256Hex("as", body)) };
    expect((await handleLeadWebhook(req("meta", body, sig), deps())).status).toBe(200);
    expect(await count("select count(*) n from admission_applicants where full_name='Aarav Sharma'")).toBe(1);
  });

  it("Zapier: same child via another channel is detected as a duplicate", async () => {
    const r = await handleLeadWebhook(req("zapier", { name: "P Sharma", child_name: "aarav  sharma", phone: "098765 43210", id: "ZP-1" }, { "x-api-key": "zk" }), deps());
    expect(r.status).toBe(200);
    expect(await count("select count(*) n from admission_applicants where full_name ilike 'aarav%'")).toBe(1);
    expect(await count("select enquiry_count n from admission_lead_meta where lead_source='meta'")).toBe(2);
    expect(await count("select count(*) n from admission_lead_events where event_type='repeat_enquiry'")).toBe(1);
  });

  it("Google: valid key creates a lead; test lead and bad key create nothing", async () => {
    const p = (extra: any = {}) => ({ lead_id: "GL-1", google_key: "gk", form_id: "1", user_column_data: [
      { column_id: "FULL_NAME", string_value: "Ravi Kumar" }, { column_id: "PHONE_NUMBER", string_value: "+91 90000 11111" },
      { column_id: "Q1", column_name: "Student name", string_value: "Diya Kumar" }, { column_id: "Q2", column_name: "Grade", string_value: "5" }], ...extra });
    expect((await handleLeadWebhook(req("google", p({ google_key: "bad" })), deps())).status).toBe(401);
    expect((await handleLeadWebhook(req("google", p({ is_test: true, lead_id: "GL-T" })), deps())).status).toBe(200);
    expect(await count("select count(*) n from admission_applicants where full_name='Diya Kumar'")).toBe(0);
    expect((await handleLeadWebhook(req("google", p()), deps())).status).toBe(200);
    expect(await count("select count(*) n from admission_applicants where full_name='Diya Kumar'")).toBe(1);
    expect(await count("select count(*) n from admission_lead_meta where lead_source='google'")).toBe(1);
  });

  it("Website: allowed origin creates a lead; other origin and honeypot create nothing", async () => {
    const form = (b: string, origin = "https://school.edu") => req("website", b, { origin }, "application/x-www-form-urlencoded");
    expect((await handleLeadWebhook(form("name=Meena&child_name=Tara+Rao&phone=9222233333&class=5"), deps())).status).toBe(200);
    expect((await handleLeadWebhook(form("name=X&child_name=Evil&phone=9222233334", "https://evil.example"), deps())).status).toBe(403);
    expect((await handleLeadWebhook(form("name=Bot&child_name=Bot&phone=9222233335&_hp=1"), deps())).status).toBe(200);
    expect(await count("select count(*) n from admission_applicants where full_name in ('Evil','Bot')")).toBe(0);
    expect(await count("select count(*) n from admission_applicants where full_name='Tara Rao'")).toBe(1);
  });

  it("Meta outage: 500 so Meta retries; once Graph is back the retry succeeds and is not duplicated", async () => {
    graphLeads["LG-2"] = { id: "LG-2", field_data: [{ name: "full_name", values: ["Anil"] }, { name: "phone_number", values: ["9333344444"] }, { name: "child_name", values: ["Zoya"] }] };
    const body = JSON.stringify({ entry: [{ id: "111", changes: [{ field: "leadgen", value: { leadgen_id: "LG-2", page_id: "111" } }] }] });
    const sig = { "x-hub-signature-256": "sha256=" + (await hmacSha256Hex("as", body)) };
    graphDown = true;
    expect((await handleLeadWebhook(req("meta", body, sig), deps())).status).toBe(500);
    expect(await count("select count(*) n from admission_applicants where full_name='Zoya'")).toBe(0);
    expect(await count("select count(*) n from admission_lead_ingestions where status='failed' and external_lead_id='LG-2' and payload_enc is not null")).toBe(1);
    graphDown = false;
    expect((await handleLeadWebhook(req("meta", body, sig), deps())).status).toBe(200);
    expect(await count("select count(*) n from admission_applicants where full_name='Zoya'")).toBe(1);
  });

  it("stored replay payloads are ciphertext (no phone numbers in the log), summaries are masked", async () => {
    await handleLeadWebhook(req("zapier", { name: "NoIntake", phone: "9444455555", child_name: "Nia", class: "Grade 12" }, { "x-api-key": "zk" }), deps());
    await pool.query("update admission_integrations set default_intake_id=null where id=$1", [ids.zapier]);
    await pool.query("update admission_intakes set is_open=false");
    const r = await handleLeadWebhook(req("zapier", { name: "Q", phone: "9555566666", child_name: "Quin", class: "Grade 5", id: "ZP-NI" }, { "x-api-key": "zk" }), deps());
    expect(r.status).toBe(200);
    const row = (await pool.query("select payload_enc, summary, status from admission_lead_ingestions where external_lead_id='ZP-NI'")).rows[0];
    expect(row.status).toBe("needs_review");
    expect(row.payload_enc.startsWith("v1.")).toBe(true);
    expect(JSON.stringify(row)).not.toContain("9555566666");
    expect(JSON.stringify(row.summary)).toMatch(/•/);
    // reopen + fix + replay from the stored encrypted payload
    await pool.query("update admission_intakes set is_open=true");
    const payload: any = await decryptJson(row.payload_enc, KEY, `ingestion:${ids.zapier}`);
    expect(payload.body.child_name).toBe("Quin");
  });
});
