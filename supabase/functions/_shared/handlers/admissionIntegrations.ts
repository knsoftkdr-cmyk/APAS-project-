// supabase/functions/_shared/handlers/admissionIntegrations.ts
//
// Admin API for Admissions > Integrations. Not a standalone edge function (deployment limit): `log-audit` routes
// `mode: "adm_int_*"` here (see CONSOLIDATION.md). Body: { mode: "adm_int_create" | ..., ...fields }.
//
//   adm_int_create   { provider, name, default_intake_id?, config?, field_mapping?, notify_emails?, credentials? }
//                    -> { integration, generated: { verify_token? google_key? api_key? } }   (generated shown ONCE)
//   adm_int_update   { id, name?, status?, default_intake_id?, config?, field_mapping?, notify_emails?, credentials? }
//   adm_int_rotate   { id, what: "secret" | "url" }   -> new generated secret (once) / new webhook token
//   adm_int_delete   { id }
//   adm_int_test     { id }   live check: Meta Graph page + subscription, Zoho OAuth, or a test lead through the pipeline
//   adm_int_subscribe{ id }   Meta: subscribe the Page to `leadgen`
//   adm_int_sync     { id, days? }   Zoho: pull recent leads through the same ingest path (idempotent)
//   adm_int_retry    { id, ingestion_id? }  replay failed / needs-review deliveries after the cause was fixed
//
// Access: principal / admin / school_admin of the integration's own school. Credentials are AES-GCM encrypted
// (INTEGRATION_ENCRYPTION_KEY) and are never returned to the browser.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decryptJson, encryptJson, LEAD_PROVIDERS, normalizeGenericLead, normalizeGoogleLead, normalizeMetaLead, normalizeZohoLead,
  PROVIDER_SECRET_FIELDS, randomToken, type LeadProvider,
} from "../leadIngestionModel.ts";
import { checkMetaPage, checkZoho, fetchMetaLead, isZohoDc, ProviderError, subscribeMetaPage, zohoRecentLeads } from "../leadProviders.ts";
import { ingestOne, type IngestResult, type IntegrationRow } from "../leadWebhookCore.ts";
import { adminClient, buildDeps, encryptionKey } from "./leadWebhook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ADMIN_ROLES = ["principal", "admin", "school_admin"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_KEYS = ["student_name", "parent_name", "phone", "email", "grade", "date_of_birth", "gender", "address", "previous_school", "message"];

/** Validate + whitelist the non-secret config. Throws Error(message) -> 400. */
export function sanitizeConfig(provider: LeadProvider, c: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!c || typeof c !== "object") return out;
  if (c.page_id !== undefined && c.page_id !== "") {
    if (!/^\d{5,25}$/.test(String(c.page_id))) throw new Error("Facebook Page ID must be numeric");
    out.page_id = String(c.page_id);
  }
  if (c.form_ids !== undefined) {
    if (!Array.isArray(c.form_ids) || c.form_ids.length > 50 || c.form_ids.some((x: any) => !/^[\w-]{1,60}$/.test(String(x)))) throw new Error("form_ids must be a list of form ids");
    out.form_ids = c.form_ids.map(String);
  }
  if (c.allowed_origins !== undefined) {
    if (!Array.isArray(c.allowed_origins) || c.allowed_origins.length > 20) throw new Error("allowed_origins must be a list of site addresses");
    out.allowed_origins = c.allowed_origins.map((o: any) => {
      let u: URL; try { u = new URL(String(o).trim()); } catch { throw new Error(`"${o}" is not a valid site address (use https://example.com)`); }
      if (!/^https?:$/.test(u.protocol)) throw new Error("allowed_origins must be http(s) addresses");
      return u.origin;
    });
  }
  if (c.zoho_dc !== undefined) {
    if (!isZohoDc(String(c.zoho_dc))) throw new Error("Unknown Zoho data centre");
    out.zoho_dc = String(c.zoho_dc);
  }
  for (const [k, lo, hi] of [["followup_hours", 1, 720], ["rate_limit_per_min", 1, 1000], ["sync_days", 1, 90]] as const) {
    if (c[k] !== undefined && c[k] !== "") {
      const n = Number(c[k]);
      if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${k} must be a whole number between ${lo} and ${hi}`);
      out[k] = n;
    }
  }
  if (c.success_redirect) {
    let u: URL; try { u = new URL(String(c.success_redirect)); } catch { throw new Error("success_redirect must be a full URL"); }
    if (!/^https?:$/.test(u.protocol)) throw new Error("success_redirect must be http(s)");
    out.success_redirect = u.toString();
  }
  if (c.notify_user_ids !== undefined) {
    if (!Array.isArray(c.notify_user_ids) || c.notify_user_ids.length > 50 || c.notify_user_ids.some((x: any) => !UUID_RE.test(String(x)))) throw new Error("notify_user_ids must be user ids");
    out.notify_user_ids = c.notify_user_ids;
  }
  void provider;
  return out;
}

export function sanitizeMapping(m: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!m || typeof m !== "object") return out;
  for (const [k, v] of Object.entries(m)) {
    if (!FIELD_KEYS.includes(k)) throw new Error(`Unknown APAS field "${k}"`);
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 100);
  }
  return out;
}

export function sanitizeEmails(e: any): string[] {
  if (e === undefined) return [];
  if (!Array.isArray(e) || e.length > 10) throw new Error("notify_emails must be a list of up to 10 addresses");
  const list = e.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  if (list.some((x) => !EMAIL_RE.test(x))) throw new Error("One of the notification emails is not valid");
  return [...new Set(list)];
}

function sanitizeCredentials(provider: LeadProvider, creds: any): Record<string, string> {
  const spec = PROVIDER_SECRET_FIELDS[provider];
  const allowed = [...spec.required, ...spec.optional];
  const out: Record<string, string> = {};
  if (!creds || typeof creds !== "object") return out;
  for (const [k, v] of Object.entries(creds)) {
    if (!allowed.includes(k)) throw new Error(`Unexpected credential "${k}" for ${provider}`);
    if (typeof v === "string" && v.trim()) {
      if (v.length > 4000) throw new Error(`${k} is too long`);
      out[k] = v.trim();
    }
  }
  return out;
}

export async function handleAdmissionIntegrations(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json({ error: "Not authenticated" }, 401);

    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("id, role, school_id").eq("id", user.id).single();
    if (!profile?.school_id || !ADMIN_ROLES.includes(profile.role)) return json({ error: "Only school administrators can manage integrations" }, 403);
    const key = encryptionKey();
    if (!key) return json({ error: "Server is missing INTEGRATION_ENCRYPTION_KEY. Ask your platform admin to set it (openssl rand -base64 32)." }, 503);

    const body = await req.json().catch(() => ({}));
    const action: string = body.action;

    const load = async (id: unknown) => {
      if (typeof id !== "string" || !UUID_RE.test(id)) throw new HttpError("Invalid integration id", 400);
      const { data } = await db.from("admission_integrations").select("*").eq("id", id).eq("school_id", profile.school_id).maybeSingle();
      if (!data) throw new HttpError("Integration not found", 404);
      return data as any;
    };
    const readSecrets = async (id: string): Promise<Record<string, string>> => {
      const { data } = await db.from("admission_integration_secrets").select("secrets_enc").eq("integration_id", id).maybeSingle();
      return data ? await decryptJson<Record<string, string>>(data.secrets_enc, key, `secrets:${id}`) : {};
    };
    const writeSecrets = async (id: string, s: Record<string, string>) => {
      const { error } = await db.from("admission_integration_secrets").upsert({ integration_id: id, secrets_enc: await encryptJson(s, key, `secrets:${id}`), updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    };
    const checkIntake = async (intakeId: unknown) => {
      if (intakeId === null || intakeId === undefined || intakeId === "") return null;
      if (typeof intakeId !== "string" || !UUID_RE.test(intakeId)) throw new HttpError("Invalid default intake", 400);
      const { data } = await db.from("admission_intakes").select("id").eq("id", intakeId).eq("school_id", profile.school_id).maybeSingle();
      if (!data) throw new HttpError("That intake does not belong to your school", 400);
      return intakeId;
    };
    const publicRow = (r: any) => r; // table has no secrets; safe to return

    switch (action) {
      // ------------------------------------------------------------------ create
      case "create": {
        const provider = body.provider as LeadProvider;
        if (!LEAD_PROVIDERS.includes(provider)) throw new HttpError("Unknown provider", 400);
        const name = String(body.name ?? "").trim().slice(0, 80);
        if (!name) throw new HttpError("Give the integration a name", 400);
        const spec = PROVIDER_SECRET_FIELDS[provider];
        const creds = sanitizeCredentials(provider, body.credentials);
        const missing = spec.required.filter((f) => !creds[f]);
        if (missing.length) throw new HttpError(`Missing credentials: ${missing.join(", ")}`, 400);
        const generated: Record<string, string> = {};
        for (const g of spec.generated) generated[g] = randomToken(g === "verify_token" ? 16 : 24);
        const config = sanitizeConfig(provider, body.config);
        if (provider === "zoho" && !config.zoho_dc) config.zoho_dc = "com";
        const default_intake_id = await checkIntake(body.default_intake_id);

        const { data: row, error } = await db.from("admission_integrations").insert({
          school_id: profile.school_id, provider, name, webhook_token: randomToken(24), default_intake_id, config,
          field_mapping: sanitizeMapping(body.field_mapping), notify_emails: sanitizeEmails(body.notify_emails), created_by: profile.id,
        }).select("*").single();
        if (error) throw new Error(error.message);
        if (Object.keys(creds).length || Object.keys(generated).length) await writeSecrets(row.id, { ...creds, ...generated });
        return json({ integration: publicRow(row), generated });
      }

      // ------------------------------------------------------------------ update
      case "update": {
        const cur = await load(body.id);
        const patch: Record<string, unknown> = {};
        if (body.name !== undefined) { const n = String(body.name).trim().slice(0, 80); if (!n) throw new HttpError("Name cannot be empty", 400); patch.name = n; }
        if (body.status !== undefined) {
          if (!["active", "paused"].includes(body.status)) throw new HttpError("status must be active or paused", 400);
          patch.status = body.status;
        }
        if (body.default_intake_id !== undefined) patch.default_intake_id = await checkIntake(body.default_intake_id);
        if (body.config !== undefined) patch.config = { ...cur.config, ...sanitizeConfig(cur.provider, body.config) };
        if (body.field_mapping !== undefined) patch.field_mapping = sanitizeMapping(body.field_mapping);
        if (body.notify_emails !== undefined) patch.notify_emails = sanitizeEmails(body.notify_emails);
        if (body.credentials !== undefined) {
          const incoming = sanitizeCredentials(cur.provider, body.credentials);
          if (Object.keys(incoming).length) {
            await writeSecrets(cur.id, { ...(await readSecrets(cur.id)), ...incoming });
            if (cur.status === "error") patch.status = "active"; // new credentials: give it another go
          }
        }
        if (Object.keys(patch).length) {
          const { error } = await db.from("admission_integrations").update(patch).eq("id", cur.id);
          if (error) throw new Error(error.message);
        }
        return json({ integration: publicRow((await load(cur.id))) });
      }

      // ------------------------------------------------------------------ rotate
      case "rotate": {
        const cur = await load(body.id);
        if (body.what === "url") {
          const { error } = await db.from("admission_integrations").update({ webhook_token: randomToken(24) }).eq("id", cur.id);
          if (error) throw new Error(error.message);
          return json({ integration: publicRow(await load(cur.id)) });
        }
        const gen = PROVIDER_SECRET_FIELDS[cur.provider as LeadProvider].generated;
        if (!gen.length) throw new HttpError("This integration has no secret to rotate", 400);
        const s = await readSecrets(cur.id);
        const generated: Record<string, string> = {};
        for (const g of gen) { generated[g] = randomToken(g === "verify_token" ? 16 : 24); s[g] = generated[g]; }
        await writeSecrets(cur.id, s);
        return json({ integration: publicRow(cur), generated });
      }

      // ------------------------------------------------------------------ delete
      case "delete": {
        const cur = await load(body.id);
        const { error } = await db.from("admission_integrations").delete().eq("id", cur.id);
        if (error) throw new Error(error.message);
        return json({ deleted: true }); // leads already in the CRM are kept (admission_lead_meta.integration_id -> null)
      }

      // ------------------------------------------------------------------ test
      case "test": {
        const cur = await load(body.id);
        const s = await readSecrets(cur.id);
        try {
          if (cur.provider === "meta") {
            if (!cur.config.page_id) throw new HttpError("Enter the Facebook Page ID first", 400);
            const r = await checkMetaPage(cur.config.page_id, { page_access_token: s.page_access_token, app_secret: s.app_secret });
            return json({ ok: true, provider: "meta", detail: r,
              message: r.leadgen_subscribed ? `Connected to “${r.page_name}”. Lead notifications are on.` : `Connected to “${r.page_name}”, but the Page is not subscribed to lead notifications yet. Use “Subscribe Page”.` });
          }
          if (cur.provider === "zoho") {
            const r = await checkZoho({ client_id: s.client_id, client_secret: s.client_secret, refresh_token: s.refresh_token }, cur.config.zoho_dc ?? "com");
            return json({ ok: true, provider: "zoho", detail: r, message: `Connected to Zoho CRM${r.org_name ? ` (${r.org_name})` : ""}.` });
          }
          // google / website / zapier / make: push a TEST lead through the real pipeline (creates nothing)
          const deps = buildDeps(db);
          const res = await deps.ingest(cur as IntegrationRow, { student_name: "Test Student", phone: "9999999999" }, `test-${Date.now()}`, null, true);
          return json({ ok: res.status === "test", provider: cur.provider, message: res.status === "test"
            ? "The pipeline is working. Now send a test submission from the source — it will show up in the activity log."
            : `Unexpected result: ${res.status}${res.error ? ` (${res.error})` : ""}` });
        } catch (e) {
          if (e instanceof HttpError) throw e;
          const msg = (e as Error).message;
          await db.from("admission_integrations").update({ last_error: msg.slice(0, 500), last_error_at: new Date().toISOString(), ...(e instanceof ProviderError && !e.transient ? { status: "error" } : {}) }).eq("id", cur.id);
          return json({ ok: false, message: msg });
        }
      }

      // --------------------------------------------------------------- subscribe (Meta)
      case "subscribe": {
        const cur = await load(body.id);
        if (cur.provider !== "meta" || !cur.config.page_id) throw new HttpError("Only a Meta integration with a Page ID can be subscribed", 400);
        const s = await readSecrets(cur.id);
        try {
          const ok = await subscribeMetaPage(cur.config.page_id, { page_access_token: s.page_access_token, app_secret: s.app_secret });
          return json({ ok, message: ok ? "Page subscribed to lead notifications." : "Meta did not confirm the subscription." });
        } catch (e) { return json({ ok: false, message: (e as Error).message }); }
      }

      // --------------------------------------------------------------- sync (Zoho pull)
      case "sync": {
        const cur = await load(body.id);
        if (cur.provider !== "zoho") throw new HttpError("Sync is only available for Zoho CRM", 400);
        if (cur.status === "paused") throw new HttpError("Integration is paused", 400);
        const s = await readSecrets(cur.id);
        const days = Math.min(Math.max(Number(body.days ?? cur.config.sync_days ?? 7) || 7, 1), 90);
        const since = cur.last_sync_at ?? new Date(Date.now() - days * 86400_000).toISOString();
        try {
          const recs = await zohoRecentLeads({ client_id: s.client_id, client_secret: s.client_secret, refresh_token: s.refresh_token },
            cur.config.zoho_dc ?? "com", since);
          const quiet = buildDeps(db, { notify: async () => {} });
          const tally: Record<string, number> = { created: 0, duplicate: 0, idempotent: 0, failed: 0, needs_review: 0 };
          for (const rec of recs.filter((r) => !r.Created_Time || Date.parse(r.Created_Time) >= Date.parse(since)).slice(0, 200)) {
            const { lead, externalId } = normalizeZohoLead(rec, cur.field_mapping);
            const r = await ingestOne(quiet, cur, lead, externalId ?? null, { provider: "zoho", record: rec });
            tally[r.status] = (tally[r.status] ?? 0) + 1;
          }
          await db.from("admission_integrations").update({ last_sync_at: new Date().toISOString() }).eq("id", cur.id);
          return json({ ok: true, fetched: recs.length, ...tally });
        } catch (e) {
          const msg = (e as Error).message;
          await db.from("admission_integrations").update({ last_error: msg.slice(0, 500), last_error_at: new Date().toISOString() }).eq("id", cur.id);
          return json({ ok: false, message: msg });
        }
      }

      // ------------------------------------------------------------------ retry
      case "retry": {
        const cur = await load(body.id);
        const s = await readSecrets(cur.id);
        let q = db.from("admission_lead_ingestions").select("id, external_lead_id, payload_enc, status")
          .eq("integration_id", cur.id).in("status", ["failed", "needs_review"]).not("payload_enc", "is", null)
          .order("received_at", { ascending: true }).limit(100);
        if (body.ingestion_id) q = q.eq("id", String(body.ingestion_id));
        const { data: rows } = await q;
        const quiet = buildDeps(db);
        const tally: Record<string, number> = { created: 0, duplicate: 0, failed: 0, needs_review: 0, skipped: 0 };
        for (const row of rows ?? []) {
          let payload: any;
          try { payload = await decryptJson(row.payload_enc, key, `ingestion:${cur.id}`); } catch { tally.skipped++; continue; }
          let norm: { lead: any; externalId?: string } | null = null;
          try {
            if (payload.provider === "meta") {
              const lead = payload.lead ?? await fetchMetaLead(payload.leadgen_id, { page_access_token: s.page_access_token, app_secret: s.app_secret });
              norm = normalizeMetaLead(lead, cur.field_mapping);
            } else if (payload.provider === "google") norm = normalizeGoogleLead(payload.body, cur.field_mapping);
            else if (payload.provider === "zoho") norm = normalizeZohoLead(payload.record, cur.field_mapping);
            else norm = normalizeGenericLead(payload.body, cur.field_mapping);
          } catch { tally.skipped++; continue; }
          const r: IngestResult = await ingestOne(quiet, cur, norm.lead, row.external_lead_id ?? norm.externalId ?? null, payload);
          tally[r.status] = (tally[r.status] ?? 0) + 1;
          // generic leads have no external id, so SQL opened a fresh log row: retire the old failed one
          if ((r.status === "created" || r.status === "duplicate") && r.ingestion_id && r.ingestion_id !== row.id) {
            await db.from("admission_lead_ingestions").delete().eq("id", row.id);
          }
        }
        return json({ ok: true, ...tally });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error("admission integrations error:", (e as Error).message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}

class HttpError extends Error { constructor(msg: string, public status: number) { super(msg); } }
