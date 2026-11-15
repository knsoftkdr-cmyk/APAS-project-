// supabase/functions/_shared/leadWebhookCore.ts
//
// Provider-agnostic request handling for the PUBLIC lead webhook:
//   https://<project>.supabase.co/functions/v1/log-audit?lead_hook=<webhook_token>
// (served through the `log-audit` anchor - see CONSOLIDATION.md; no new edge function).
//
// All I/O goes through `deps`, so the whole flow (authentication, parsing, provider fetches, status codes) is
// unit-tested with in-memory deps and a mock Graph / Zoho in src/test/leadWebhookCore.test.ts.
//
// Response contract (important for retry behaviour):
//   200  accepted, OR permanently unprocessable (a retry cannot help; the failure is logged for the admin)
//   401/403/404  bad credentials / unknown token / origin not allowed
//   413  body too large      429  rate limited      500  TRANSIENT failure -> Meta / Zapier / Make retry

import {
  extractApiKey, normalizeGenericLead, normalizeGoogleLead, normalizeMetaLead, normalizeZohoLead,
  safeEqual, validateLead, verifyMetaSignature, type NormalizedLead,
} from "./leadIngestionModel.ts";
import { fetchMetaLead, ProviderError, zohoLeadsByIds, type FetchLike } from "./leadProviders.ts";

export interface IntegrationRow {
  id: string; school_id: string; provider: "meta" | "google" | "zoho" | "website" | "zapier" | "make";
  name: string; status: string; config: Record<string, any>; field_mapping: Record<string, string>;
}
export interface IngestResult {
  status: "created" | "duplicate" | "failed" | "needs_review" | "rejected" | "rate_limited" | "idempotent" | "test";
  applicant_id?: string; ingestion_id?: string; error?: string;
  notify_emails?: string[]; student?: string; grade?: string; parent?: string; provider?: string; integration?: string;
}
export interface WebhookDeps {
  getIntegration(token: string): Promise<IntegrationRow | null>;
  getSecrets(integrationId: string): Promise<Record<string, string>>;
  ingest(i: IntegrationRow, lead: NormalizedLead, externalId: string | null, payloadEnc: string | null, isTest: boolean): Promise<IngestResult>;
  /** encrypt a replay payload (only used when ingestion cannot complete) */
  sealPayload(i: IntegrationRow, payload: unknown): Promise<string>;
  /** record a delivery that never reached ingest (e.g. Graph API unreachable) and flag the integration */
  logFailure(i: IntegrationRow, externalId: string | null, error: string, payloadEnc: string | null, permanent: boolean): Promise<void>;
  notify(i: IntegrationRow, r: IngestResult): Promise<void>;
  fetch: FetchLike;
  graphBase?: string;
  zohoOverrides?: { accounts?: string; api?: string };
}

const MAX_BODY = 256 * 1024;
const MAX_BATCH = 50;

function cors(origin: string | null, allow: string | null) {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-api-key, authorization",
    "Vary": "Origin",
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  else if (origin === null) h["Access-Control-Allow-Origin"] = "*";
  return h;
}
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });

function originAllowed(i: IntegrationRow, req: Request): string | null | false {
  const list: string[] = Array.isArray(i.config?.allowed_origins) ? i.config.allowed_origins.filter(Boolean) : [];
  const origin = req.headers.get("origin");
  if (list.length === 0) return origin; // no allow-list configured: any site may post (honeypot + rate limit still apply)
  let o = origin;
  if (!o) { try { o = new URL(req.headers.get("referer") ?? "").origin; } catch { o = null; } }
  if (!o) return false;
  const norm = (s: string) => s.replace(/\/+$/, "").toLowerCase();
  return list.some((a) => norm(a) === norm(o!)) ? o : false;
}

async function parseBody(req: Request, raw: string): Promise<any> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  if (ct.includes("multipart/form-data")) {
    const fd = await new Request(req.url, { method: "POST", headers: { "content-type": ct }, body: raw }).formData();
    const o: Record<string, string> = {};
    fd.forEach((v, k) => { if (typeof v === "string") o[k] = v; });
    return o;
  }
  try { return JSON.parse(raw); } catch { return null; }
}

async function finish(deps: WebhookDeps, i: IntegrationRow, r: IngestResult) {
  if ((r.status === "created" || r.status === "duplicate") && r.notify_emails?.length) {
    try { await deps.notify(i, r); } catch (e) { console.warn("lead notify failed (non-fatal):", (e as Error).message); }
  }
  return r;
}

/** Run a lead through validation + ingest. Never throws for bad data: returns the IngestResult. */
export async function ingestOne(deps: WebhookDeps, i: IntegrationRow, lead: NormalizedLead, externalId: string | null, replay: unknown, isTest = false) {
  const v = validateLead(lead);
  const payloadEnc = await deps.sealPayload(i, replay);
  if (!v.ok && !isTest) {
    await deps.logFailure(i, externalId, v.reason, payloadEnc, true);
    return { status: "failed", error: v.reason } as IngestResult;
  }
  return finish(deps, i, await deps.ingest(i, lead, externalId, payloadEnc, isTest));
}

export async function handleLeadWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("lead_hook");
  if (!token || token.length < 16) return json({ error: "not_found" }, 404);

  const integration = await deps.getIntegration(token);
  if (!integration) return json({ error: "not_found" }, 404);
  const i = integration;
  const origin = req.headers.get("origin");

  // ---- CORS preflight (website forms post from the browser) ----
  if (req.method === "OPTIONS") {
    const allow = i.provider === "website" ? originAllowed(i, req) : null;
    return new Response(null, { status: allow === false ? 403 : 204, headers: cors(origin, typeof allow === "string" ? allow : null) });
  }

  const secrets = await deps.getSecrets(i.id);

  // ---- Meta subscription handshake ----
  if (req.method === "GET") {
    if (i.provider !== "meta") return json({ error: "method_not_allowed" }, 405);
    const mode = url.searchParams.get("hub.mode");
    const vt = url.searchParams.get("hub.verify_token") ?? "";
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (mode === "subscribe" && secrets.verify_token && safeEqual(vt, secrets.verify_token)) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return json({ error: "forbidden" }, 403);
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "payload_too_large" }, 413);

  let corsHeaders: Record<string, string> = {};
  const results: IngestResult[] = [];
  let transientFailure = false;

  switch (i.provider) {
    // ------------------------------------------------------------------ Meta
    case "meta": {
      if (!(await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secrets.app_secret ?? ""))) {
        return json({ error: "invalid_signature" }, 401);
      }
      const body = await parseBody(req, raw);
      if (!body || typeof body !== "object") return json({ error: "invalid_json" }, 400);
      const wantedPage = i.config?.page_id ? String(i.config.page_id) : null;
      const wantedForms: string[] = Array.isArray(i.config?.form_ids) ? i.config.form_ids.map(String) : [];
      const events: { leadgen_id: string; page_id?: string; form_id?: string }[] = [];
      for (const entry of Array.isArray(body.entry) ? body.entry : [])
        for (const ch of Array.isArray(entry?.changes) ? entry.changes : [])
          if (ch?.field === "leadgen" && ch?.value?.leadgen_id) events.push({
            leadgen_id: String(ch.value.leadgen_id), page_id: String(ch.value.page_id ?? entry.id ?? ""), form_id: ch.value.form_id ? String(ch.value.form_id) : undefined,
          });
      for (const ev of events.slice(0, MAX_BATCH)) {
        if (wantedPage && ev.page_id && ev.page_id !== wantedPage) continue;
        if (wantedForms.length && ev.form_id && !wantedForms.includes(ev.form_id)) continue;
        try {
          const lead = await fetchMetaLead(ev.leadgen_id, { page_access_token: secrets.page_access_token ?? "", app_secret: secrets.app_secret ?? "" }, deps.fetch, { base: deps.graphBase });
          const { lead: norm, externalId } = normalizeMetaLead(lead, i.field_mapping);
          norm.campaign = { ...(norm.campaign ?? {}), page_id: ev.page_id ?? "" };
          results.push(await ingestOne(deps, i, norm, externalId ?? ev.leadgen_id, { provider: "meta", lead }));
        } catch (e) {
          if (e instanceof ProviderError) {
            const sealed = await deps.sealPayload(i, { provider: "meta", leadgen_id: ev.leadgen_id });
            await deps.logFailure(i, ev.leadgen_id, e.message, sealed, !e.transient);
            if (e.transient) transientFailure = true;
            results.push({ status: "failed", error: e.message });
          } else throw e;
        }
      }
      break;
    }

    // ---------------------------------------------------------------- Google
    case "google": {
      const body = await parseBody(req, raw);
      if (!body || typeof body !== "object") return json({ error: "invalid_json" }, 400);
      if (!secrets.google_key || !safeEqual(String(body.google_key ?? ""), secrets.google_key)) return json({ error: "invalid_key" }, 401);
      const formIds: string[] = Array.isArray(i.config?.form_ids) ? i.config.form_ids.map(String) : [];
      if (formIds.length && body.form_id && !formIds.includes(String(body.form_id))) { results.push({ status: "rejected", error: "form_not_configured" }); break; }
      const { lead, externalId, isTest } = normalizeGoogleLead(body, i.field_mapping);
      const replay = { provider: "google", body: { ...body, google_key: undefined } };
      results.push(await ingestOne(deps, i, lead, externalId ?? null, replay, isTest));
      break;
    }

    // ------------------------------------------------------ Zoho / Zapier / Make
    case "zoho":
    case "zapier":
    case "make": {
      const key = extractApiKey(req.headers, url);
      if (!secrets.api_key || !key || !safeEqual(key, secrets.api_key)) return json({ error: "invalid_api_key" }, 401);
      const body = await parseBody(req, raw);
      if (body === null || typeof body !== "object") return json({ error: "invalid_json" }, 400);

      if (i.provider === "zoho") {
        // Zoho workflow webhook -> record fields; Zoho "notifications" API -> { module, ids:[...] }
        let records: any[] = [];
        const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];
        if (ids.length && !body.Last_Name && !body.Email) {
          try {
            records = await zohoLeadsByIds(ids.slice(0, 100), { client_id: secrets.client_id, client_secret: secrets.client_secret, refresh_token: secrets.refresh_token }, i.config?.zoho_dc ?? "com", deps.fetch, deps.zohoOverrides);
          } catch (e) {
            if (e instanceof ProviderError) {
              await deps.logFailure(i, ids[0], e.message, await deps.sealPayload(i, { provider: "zoho", ids }), !e.transient);
              return e.transient ? json({ error: "upstream_unavailable" }, 500) : json({ ok: false, error: e.message }, 200);
            }
            throw e;
          }
        } else records = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [body];
        for (const rec of records.slice(0, MAX_BATCH)) {
          const { lead, externalId } = normalizeZohoLead(rec, i.field_mapping);
          results.push(await ingestOne(deps, i, lead, externalId ?? null, { provider: "zoho", record: rec }));
        }
      } else {
        const items: any[] = Array.isArray(body) ? body : [body];
        for (const item of items.slice(0, MAX_BATCH)) {
          const { lead, externalId } = normalizeGenericLead(item, i.field_mapping);
          const idem = externalId ?? req.headers.get("idempotency-key");
          results.push(await ingestOne(deps, i, lead, idem ?? null, { provider: i.provider, body: item }));
        }
      }
      break;
    }

    // --------------------------------------------------------------- Website
    case "website": {
      const allow = originAllowed(i, req);
      if (allow === false) return json({ error: "origin_not_allowed" }, 403, cors(origin, null));
      corsHeaders = cors(origin, typeof allow === "string" ? allow : null);
      const body = await parseBody(req, raw);
      if (body === null || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_body" }, 400, corsHeaders);
      // honeypot: real people never fill hidden fields; answer 200 so bots learn nothing
      if (String(body._hp ?? body.hp ?? body.website_url ?? "").trim() !== "") return json({ ok: true }, 200, corsHeaders);
      const { lead, externalId } = normalizeGenericLead(body, i.field_mapping);
      const isHtmlPost = (req.headers.get("content-type") ?? "").includes("form");
      const r = await ingestOne(deps, i, lead, externalId ?? null, { provider: "website", body });
      results.push(r);
      const redirect = typeof i.config?.success_redirect === "string" ? i.config.success_redirect : null;
      if (isHtmlPost && redirect && /^https?:\/\//i.test(redirect) && ["created", "duplicate", "idempotent"].includes(r.status)) {
        return new Response(null, { status: 303, headers: { Location: redirect, ...corsHeaders } });
      }
      break;
    }
  }

  const rl = results.find((r) => r.status === "rate_limited");
  if (rl) return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": "60", ...corsHeaders });
  if (transientFailure) return json({ ok: false, error: "upstream_unavailable", results: summarize(results) }, 500, corsHeaders);
  const anyFailed = results.some((r) => r.status === "failed" || r.status === "needs_review");
  // 200 even for validation failures: re-sending the same bad payload can never succeed. Visible in the integration log.
  // A website visitor only needs to hear about problems THEY can fix (no phone / email). "No intake yet" is ours to fix.
  const visitorError = results.some((r) => r.status === "failed");
  return json({ ok: !anyFailed, results: summarize(results) }, i.provider === "website" && visitorError ? 422 : 200, corsHeaders);
}

const summarize = (rs: IngestResult[]) => rs.map((r) => ({ status: r.status, error: r.error ?? undefined }));
