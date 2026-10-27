// supabase/functions/_shared/handlers/securityAnomaly.ts
//
// Security Anomaly Detection: records login / data-access events and raises alerts for unusual patterns.
//
// Not a standalone edge function (deployment limit): the already-deployed `log-audit` function routes to this
// handler on its `mode` field - see _shared/mergedRouter.ts and CONSOLIDATION.md. log-audit's own audit-row
// insert (body with `action` + `resource_type`, no `mode`) is untouched.
//
//   mode "sec_record"  Body: { event, identifier?, resource?, resource_id?, count? } -> { ok, alerts_raised }
//        event: login_success | login_failed | data_export | record_view
//        login_failed needs no session (the person is not signed in); every other event needs one and the
//        user is always taken from the verified JWT, never from the body.
//   mode "sec_list"    Body: { school_id?, status?, refresh? } -> { alerts, summary, recent_logins, persistence }
//        admin / principal / school_admin: their own school only. knsoft_admin: every school (or school_id).
//   mode "sec_update"  Body: { alert_id, status, note? } -> { alert }   (same access as sec_list)
//
// Rules live in securityAnomalyModel.ts. Works without migration 20261017000000: the tables are missing, so
// sec_record answers ok with persistence "unavailable" and sec_list returns an empty list saying so.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  THRESHOLDS, cleanIp, detectAnomalies, deviceKey, maskIdentifier, normalizeIdentifier, sha256Hex,
  type AlertDraft, type EventType, type SecEvent,
} from "../securityAnomalyModel.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const VIEW_ROLES = ["admin", "principal", "school_admin", "knsoft_admin"];
const EVENTS: EventType[] = ["login_success", "login_failed", "data_export", "record_view"];
const STATUSES = ["open", "acknowledged", "resolved", "false_positive"];
const RECENT_HOURS = 24;
const FAILED_PER_IP_PER_HOUR = 100;   // beyond this we stop storing, so a flood cannot fill the table
const EVENTS_PER_USER_PER_HOUR = 600;
const EVENT_FETCH_CAP = 8000;

export const tableMissing = (err: any) =>
  err?.code === "42P01" || err?.code === "PGRST205" || /does not exist|schema cache/i.test(String(err?.message ?? ""));
export const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function fetchEvents(admin: any, filter: { schoolId?: string | null; or?: string }) {
  const since = new Date(Date.now() - THRESHOLDS.historyDays * 86_400_000).toISOString();
  let q = admin.from("security_events")
    .select("id, user_id, school_id, role, event_type, identifier_hash, ip_address, device_key, metadata, created_at")
    .gte("created_at", since).order("created_at", { ascending: false }).limit(EVENT_FETCH_CAP);
  if (filter.schoolId) q = q.eq("school_id", filter.schoolId);
  if (filter.or) q = q.or(filter.or);
  const { data, error } = await q;
  if (error) throw error;
  const cut = Date.now() - RECENT_HOURS * 3_600_000;
  const all = (data ?? []) as SecEvent[];
  return { recent: all.filter((e) => Date.parse(e.created_at) >= cut), history: all.filter((e) => Date.parse(e.created_at) < cut) };
}

async function storeAlerts(admin: any, drafts: AlertDraft[]): Promise<number> {
  if (!drafts.length) return 0;
  // ignoreDuplicates: an alert someone already acknowledged / resolved is never reopened or overwritten.
  const { data, error } = await admin.from("security_alerts")
    .upsert(drafts, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function resolveCaller(admin: any, req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const { data: profile } = await admin.from("profiles").select("role, school_id").eq("id", user.id).maybeSingle();
  return { user, role: (profile?.role ?? null) as string | null, schoolId: (profile?.school_id ?? null) as string | null };
}

/** Best-effort school for a failed login (the person is not signed in). Unresolved -> null (platform admins only). */
async function schoolForIdentifier(admin: any, identifier: string): Promise<string | null> {
  try {
    const id = normalizeIdentifier(identifier);
    if (!id) return null;
    if (id.includes("@")) {
      const { data } = await admin.from("profiles").select("school_id").ilike("email", id).maybeSingle();
      if (data?.school_id) return data.school_id;
    } else {
      const { data: st } = await admin.from("students").select("profile_id").ilike("roll_number", id).maybeSingle();
      if (st?.profile_id) {
        const { data } = await admin.from("profiles").select("school_id").eq("id", st.profile_id).maybeSingle();
        if (data?.school_id) return data.school_id;
      }
    }
  } catch { /* lookup is optional */ }
  return null;
}

// ── sec_record ────────────────────────────────────────────────────────────────────────────────────────────
async function record(admin: any, req: Request, body: any): Promise<Response> {
  const event = body?.event as EventType;
  if (!EVENTS.includes(event)) return json({ error: "Unknown event" }, 400);

  const ip = cleanIp(req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip"));
  const device = deviceKey(req.headers.get("user-agent"));
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  let row: Record<string, any>;
  let orFilter: string;

  if (event === "login_failed") {
    const identifier = str(body?.identifier, 200);
    if (!identifier) return json({ error: "identifier required" }, 400);
    if (ip) {
      const { count, error } = await admin.from("security_events").select("id", { count: "exact", head: true })
        .eq("event_type", "login_failed").eq("ip_address", ip).gte("created_at", hourAgo);
      if (error) return tableMissing(error) ? json({ ok: true, persistence: "unavailable" }) : json({ error: error.message }, 500);
      if ((count ?? 0) >= FAILED_PER_IP_PER_HOUR) return json({ ok: true, throttled: true });
    }
    const hash = await sha256Hex(normalizeIdentifier(identifier));
    row = {
      school_id: await schoolForIdentifier(admin, identifier), user_id: null, role: null, event_type: event,
      identifier_hash: hash, ip_address: ip, device_key: device,
      metadata: { identifier_hint: maskIdentifier(identifier), role_attempted: str(body?.role_attempted, 40) || null },
    };
    orFilter = `identifier_hash.eq.${hash}${ip ? `,ip_address.eq.${ip}` : ""}`;
  } else {
    const caller = await resolveCaller(admin, req);
    if (!caller) return json({ error: "Not authenticated" }, 401);
    const { count, error } = await admin.from("security_events").select("id", { count: "exact", head: true })
      .eq("user_id", caller.user.id).gte("created_at", hourAgo);
    if (error) return tableMissing(error) ? json({ ok: true, persistence: "unavailable" }) : json({ error: error.message }, 500);
    if ((count ?? 0) >= EVENTS_PER_USER_PER_HOUR) return json({ ok: true, throttled: true });

    const hash = caller.user.email ? await sha256Hex(normalizeIdentifier(caller.user.email)) : null;
    const countN = Math.max(0, Math.min(1_000_000, Math.floor(Number(body?.count) || 0)));
    row = {
      school_id: caller.schoolId, user_id: caller.user.id, role: caller.role, event_type: event,
      identifier_hash: event === "login_success" ? hash : null, ip_address: ip, device_key: device,
      metadata: event === "login_success" ? {} : {
        resource: str(body?.resource, 80) || null,
        resource_id: str(body?.resource_id, 80) || null,
        count: countN || null,
      },
    };
    orFilter = `user_id.eq.${caller.user.id}${hash && event === "login_success" ? `,identifier_hash.eq.${hash}` : ""}`;
  }

  const { error: insErr } = await admin.from("security_events").insert(row);
  if (insErr) return tableMissing(insErr) ? json({ ok: true, persistence: "unavailable" }) : json({ error: insErr.message }, 500);

  // Detection must never break the thing being recorded.
  let raised = 0;
  try {
    const { recent, history } = await fetchEvents(admin, { or: orFilter });
    raised = await storeAlerts(admin, detectAnomalies({ recent, history }));
  } catch (e) {
    console.error("security detection error:", e);
  }
  return json({ ok: true, alerts_raised: raised });
}

// ── sec_list / sec_update ─────────────────────────────────────────────────────────────────────────────────
async function authorise(admin: any, req: Request, body: any) {
  const caller = await resolveCaller(admin, req);
  if (!caller) return { error: json({ error: "Not authenticated" }, 401) };
  if (!caller.role || !VIEW_ROLES.includes(caller.role)) return { error: json({ error: "Not allowed" }, 403) };
  const platform = caller.role === "knsoft_admin";
  if (!platform && !caller.schoolId) return { error: json({ error: "Your account has no school" }, 403) };
  const schoolId = platform ? (str(body?.school_id, 64) || null) : caller.schoolId;   // null = every school (platform only)
  return { caller, platform, schoolId };
}

async function list(admin: any, req: Request, body: any): Promise<Response> {
  const a = await authorise(admin, req, body);
  if (a.error) return a.error;
  const { schoolId, platform } = a as any;

  let scanned = false;
  if (body?.refresh !== false && schoolId) {
    try {
      const { recent, history } = await fetchEvents(admin, { schoolId });
      await storeAlerts(admin, detectAnomalies({ recent, history }));
      scanned = true;
    } catch (e) {
      if (tableMissing(e)) return json({ alerts: [], summary: null, recent_logins: [], persistence: "unavailable" });
      console.error("security scan error:", e);
    }
  }

  let q = admin.from("security_alerts").select("*").order("detected_at", { ascending: false }).limit(200);
  if (schoolId) q = q.eq("school_id", schoolId);
  else if (!platform) q = q.eq("school_id", "00000000-0000-0000-0000-000000000000");
  const status = str(body?.status, 20);
  if (STATUSES.includes(status)) q = q.eq("status", status);
  const { data: alerts, error } = await q;
  if (error) {
    if (tableMissing(error)) return json({ alerts: [], summary: null, recent_logins: [], persistence: "unavailable" });
    throw error;
  }

  // Recent sign-in activity (real data) for the same scope.
  let lq = admin.from("security_events")
    .select("id, user_id, role, event_type, ip_address, device_key, metadata, created_at")
    .in("event_type", ["login_success", "login_failed"]).order("created_at", { ascending: false }).limit(60);
  if (schoolId) lq = lq.eq("school_id", schoolId);
  const { data: logins } = await lq;

  const userIds = [...new Set([...(alerts ?? []), ...(logins ?? [])].map((r: any) => r.user_id).filter(Boolean))];
  const names = new Map<string, { name: string | null; role: string | null }>();
  if (userIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name, role").in("id", userIds);
    for (const p of profs ?? []) names.set(p.id, { name: p.full_name ?? null, role: p.role ?? null });
  }

  const since = new Date(Date.now() - RECENT_HOURS * 3_600_000).toISOString();
  const countOf = async (type: string) => {
    let c = admin.from("security_events").select("id", { count: "exact", head: true }).eq("event_type", type).gte("created_at", since);
    if (schoolId) c = c.eq("school_id", schoolId);
    const { count } = await c;
    return count ?? 0;
  };
  const [logins24, failed24, exports24] = await Promise.all([countOf("login_success"), countOf("login_failed"), countOf("data_export")]);
  const open = (alerts ?? []).filter((x: any) => x.status === "open");

  return json({
    persistence: "available", scanned,
    alerts: (alerts ?? []).map((x: any) => ({ ...x, user_name: names.get(x.user_id)?.name ?? null, user_role: names.get(x.user_id)?.role ?? null })),
    recent_logins: (logins ?? []).map((x: any) => ({ ...x, user_name: names.get(x.user_id)?.name ?? null })),
    summary: {
      open: open.length,
      open_by_severity: { critical: open.filter((x: any) => x.severity === "critical").length, high: open.filter((x: any) => x.severity === "high").length, medium: open.filter((x: any) => x.severity === "medium").length, low: open.filter((x: any) => x.severity === "low").length },
      logins_24h: logins24, failed_logins_24h: failed24, exports_24h: exports24,
    },
  });
}

async function update(admin: any, req: Request, body: any): Promise<Response> {
  const a = await authorise(admin, req, body);
  if (a.error) return a.error;
  const { caller, platform, schoolId } = a as any;
  const alertId = str(body?.alert_id, 64);
  const status = str(body?.status, 20);
  if (!alertId || !STATUSES.includes(status)) return json({ error: "alert_id and a valid status are required" }, 400);

  const { data: existing, error } = await admin.from("security_alerts").select("id, school_id, rule").eq("id", alertId).maybeSingle();
  if (error) return tableMissing(error) ? json({ error: "Security alerts are not set up yet", code: "persistence_unavailable" }, 503) : json({ error: error.message }, 500);
  if (!existing) return json({ error: "Alert not found" }, 404);
  if (!platform && existing.school_id !== schoolId) return json({ error: "Not allowed" }, 403);

  const reopen = status === "open";
  const { data: updated, error: upErr } = await admin.from("security_alerts").update({
    status, review_note: str(body?.note, 500) || null,
    reviewed_by: reopen ? null : caller.user.id, reviewed_at: reopen ? null : new Date().toISOString(),
  }).eq("id", alertId).select("*").maybeSingle();
  if (upErr) throw upErr;

  // Leave a trail in the existing audit log so the Security Center "All Logs" tab shows the review.
  await admin.from("audit_logs").insert({
    user_id: caller.user.id, action: "security_alert_reviewed", resource_type: "security_alert", resource_id: alertId,
    details: { rule: existing.rule, status }, ip_address: cleanIp(req.headers.get("x-forwarded-for")),
    user_agent: req.headers.get("user-agent") || "unknown",
  }).then(() => {}, () => {});

  return json({ alert: updated });
}

export async function handleSecurityAnomaly(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    switch (body?.action) {
      case "record": return await record(admin, req, body);
      case "list": return await list(admin, req, body);
      case "update": return await update(admin, req, body);
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("security anomaly handler error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
