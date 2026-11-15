// supabase/functions/_shared/handlers/leadWebhook.ts
//
// Supabase wiring for the public lead webhook (logic lives in ../leadWebhookCore.ts).
// Not a standalone edge function (deployment limit): `log-audit` (verify_jwt = false) hands any request that
// carries `?lead_hook=<token>` to this handler before its own code runs - see CONSOLIDATION.md.
//
// Required secret:  INTEGRATION_ENCRYPTION_KEY   (openssl rand -base64 32)
// Optional secrets: SMTP_*  (existing; used for email alerts), APP_URL (link in alert emails)

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptJson, encryptJson, newLeadEmail } from "../leadIngestionModel.ts";
import { handleLeadWebhook, type IngestResult, type IntegrationRow, type WebhookDeps } from "../leadWebhookCore.ts";

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

export function encryptionKey(): string | null {
  return Deno.env.get("INTEGRATION_ENCRYPTION_KEY") ?? null;
}

export function buildDeps(db: SupabaseClient, over: Partial<WebhookDeps> = {}): WebhookDeps {
  const key = encryptionKey();
  return {
    async getIntegration(token) {
      const { data, error } = await db.from("admission_integrations")
        .select("id, school_id, provider, name, status, config, field_mapping").eq("webhook_token", token).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as IntegrationRow) ?? null;
    },
    async getSecrets(id) {
      const { data, error } = await db.from("admission_integration_secrets").select("secrets_enc").eq("integration_id", id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return {};
      if (!key) throw new Error("INTEGRATION_ENCRYPTION_KEY is not set");
      return await decryptJson<Record<string, string>>(data.secrets_enc, key, `secrets:${id}`);
    },
    async ingest(i, lead, externalId, payloadEnc, isTest) {
      const { data, error } = await db.rpc("ingest_admission_lead", {
        p_integration_id: i.id, p_lead: lead, p_external_id: externalId, p_payload_enc: payloadEnc, p_is_test: isTest,
      });
      if (error) throw new Error(`ingest failed: ${error.message}`); // -> HTTP 500 -> sender retries
      return data as IngestResult;
    },
    async sealPayload(i, payload) {
      return key ? await encryptJson(payload, key, `ingestion:${i.id}`) : (null as unknown as string);
    },
    async logFailure(i, externalId, error, payloadEnc, permanent) {
      await db.from("admission_lead_ingestions").insert({
        school_id: i.school_id, integration_id: i.id, external_lead_id: externalId, status: "failed",
        error: error.slice(0, 500), payload_enc: payloadEnc, processed_at: new Date().toISOString(),
      });
      const { data: cur } = await db.from("admission_integrations").select("leads_failed, leads_received").eq("id", i.id).single();
      await db.from("admission_integrations").update({
        leads_failed: (cur?.leads_failed ?? 0) + 1, leads_received: (cur?.leads_received ?? 0) + 1,
        last_error: error.slice(0, 500), last_error_at: new Date().toISOString(),
        ...(permanent && /Meta|Zoho/.test(error) ? { status: "error" } : {}),
      }).eq("id", i.id);
    },
    async notify(i, r) {
      const { sendEmail } = await import("../email.ts"); // lazy: SMTP secrets are optional
      const mail = newLeadEmail({ provider: i.provider, integration: i.name, student: r.student, grade: r.grade, parent: r.parent,
        repeat: r.status === "duplicate", appUrl: Deno.env.get("APP_URL") ?? undefined });
      for (const to of r.notify_emails ?? []) await sendEmail({ to, subject: mail.subject, body: mail.body });
    },
    fetch: (u, init) => fetch(u, init),
    ...over,
  };
}

export async function handleLeadWebhookRequest(req: Request): Promise<Response> {
  try {
    return await handleLeadWebhook(req, buildDeps(adminClient()));
  } catch (e) {
    console.error("lead webhook error:", (e as Error).message);
    return new Response(JSON.stringify({ error: "temporarily_unavailable" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
