// supabase/functions/_shared/handlers/sessionManagement.ts
//
// Session & Device Management: see where you are signed in, and sign devices out.
//
// Not a standalone edge function (deployment limit): routed from the already-deployed `log-audit` on its `mode`
// field - see _shared/mergedRouter.ts and CONSOLIDATION.md.
//
//   mode "sess_heartbeat"          Body: { native? } -> { ok, revoked }   Called by the app every few minutes. Records
//                                   this device (label, address, last seen) and tells it if its login was ended.
//   mode "sess_list"               Body: {} -> { devices, current_session_id }   Your own active devices.
//   mode "sess_revoke"             Body: { session_id } -> { ok, revoked }   Sign one of your OTHER devices out.
//   mode "sess_revoke_others"      Body: {} -> { ok, revoked }   Sign out every device except this one.
//   mode "sess_admin_revoke_user"  Body: { user_id, reason? } -> { ok, revoked }   admin / principal / school_admin (same
//                                   school) or knsoft_admin: sign a user out everywhere, e.g. after a security alert.
//
// "Sign out" really ends the login: the row in auth.sessions is deleted (via service-role-only RPC), which cascades to
// its refresh tokens, so the device can't renew. Its current access token still verifies until it expires (Supabase
// default: 1 hour), so the app also asks this handler every few minutes and signs itself out as soon as it hears "revoked".
// Works without migration 20261018000000: heartbeat answers ok with persistence "unavailable", list returns no devices.

// deno-lint-ignore-file no-explicit-any
import { cleanIp } from "../securityAnomalyModel.ts";
import { describeDevice, isUuid, mergeSessions, sessionIdFromJwt } from "../sessionModel.ts";
import { VIEW_ROLES, corsHeaders, json, resolveCaller, str, tableMissing } from "./securityAnomaly.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

class Unavailable extends Error {}

/** Live logins of a user, or throws Unavailable when the migration has not been applied. */
async function liveSessions(admin: any, userId: string): Promise<any[]> {
  const { data, error } = await admin.rpc("list_auth_sessions", { p_user_id: userId });
  if (error) { if (tableMissing(error)) throw new Unavailable(); throw error; }
  return (data ?? []) as any[];
}

async function endSessions(admin: any, userId: string, opts: { sessionId?: string; except?: string }): Promise<number> {
  const { data, error } = await admin.rpc("revoke_auth_sessions", {
    p_user_id: userId, p_session_id: opts.sessionId ?? null, p_except: opts.except ?? null,
  });
  if (error) { if (tableMissing(error)) throw new Unavailable(); throw error; }
  return Number(data ?? 0);
}

async function markRevoked(admin: any, userId: string, by: string, reason: string, opts: { sessionId?: string; except?: string }) {
  let q = admin.from("user_sessions").update({ revoked_at: new Date().toISOString(), revoked_by: by, revoke_reason: reason })
    .eq("user_id", userId).is("revoked_at", null);
  if (opts.sessionId) q = q.eq("session_id", opts.sessionId);
  if (opts.except) q = q.neq("session_id", opts.except);
  await q.then(() => {}, () => {});
}

const audit = (admin: any, req: Request, userId: string, action: string, resourceId: string | null, details: Record<string, unknown>) =>
  admin.from("audit_logs").insert({
    user_id: userId, action, resource_type: "session", resource_id: resourceId, details,
    ip_address: cleanIp(req.headers.get("x-forwarded-for")), user_agent: req.headers.get("user-agent") || "unknown",
  }).then(() => {}, () => {});

const bearer = (req: Request) => req.headers.get("Authorization");

// ── heartbeat ─────────────────────────────────────────────────────────────────────────────────────────────
async function heartbeat(admin: any, req: Request, body: any): Promise<Response> {
  const caller = await resolveCaller(admin, req);
  if (!caller) return json({ error: "Not authenticated" }, 401);
  const sid = sessionIdFromJwt(bearer(req));
  if (!sid) return json({ ok: true, tracking: false });   // token without a session claim: nothing to track

  const live = await liveSessions(admin, caller.user.id);
  if (!live.some((r) => r.id === sid)) return json({ ok: true, revoked: true });

  const { data: row, error } = await admin.from("user_sessions").select("id, revoked_at")
    .eq("user_id", caller.user.id).eq("session_id", sid).maybeSingle();
  if (error) { if (tableMissing(error)) throw new Unavailable(); throw error; }
  if (row?.revoked_at) return json({ ok: true, revoked: true });

  const ua = req.headers.get("user-agent");
  const d = describeDevice(ua, body?.native === true);
  const { error: upErr } = await admin.from("user_sessions").upsert({
    user_id: caller.user.id, school_id: caller.schoolId, session_id: sid,
    device_label: d.label, browser: d.browser, os: d.os, kind: d.kind,
    ip_address: cleanIp(req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip")),
    user_agent: ua ? ua.slice(0, 400) : null, last_seen: new Date().toISOString(),
  }, { onConflict: "user_id,session_id" });
  if (upErr) { if (tableMissing(upErr)) throw new Unavailable(); throw upErr; }
  return json({ ok: true, revoked: false });
}

// ── list ──────────────────────────────────────────────────────────────────────────────────────────────────
async function list(admin: any, req: Request): Promise<Response> {
  const caller = await resolveCaller(admin, req);
  if (!caller) return json({ error: "Not authenticated" }, 401);
  const sid = sessionIdFromJwt(bearer(req));
  const live = await liveSessions(admin, caller.user.id);
  const { data: own, error } = await admin.from("user_sessions").select("*").eq("user_id", caller.user.id);
  if (error && !tableMissing(error)) throw error;
  return json({ persistence: "available", current_session_id: sid, devices: mergeSessions(live, own ?? [], sid) });
}

// ── revoke one / all others ───────────────────────────────────────────────────────────────────────────────
async function revoke(admin: any, req: Request, body: any): Promise<Response> {
  const caller = await resolveCaller(admin, req);
  if (!caller) return json({ error: "Not authenticated" }, 401);
  const target = body?.session_id;
  if (!isUuid(target)) return json({ error: "session_id is required" }, 400);
  const sid = sessionIdFromJwt(bearer(req));
  if (target === sid) return json({ error: "That is this device. Use Sign out to end this session." }, 400);

  const live = await liveSessions(admin, caller.user.id);
  if (!live.some((r) => r.id === target)) return json({ error: "Device not found or already signed out" }, 404);

  const n = await endSessions(admin, caller.user.id, { sessionId: target });
  await markRevoked(admin, caller.user.id, caller.user.id, "user", { sessionId: target });
  await audit(admin, req, caller.user.id, "session_revoked", target, { scope: "one" });
  return json({ ok: true, revoked: n });
}

async function revokeOthers(admin: any, req: Request): Promise<Response> {
  const caller = await resolveCaller(admin, req);
  if (!caller) return json({ error: "Not authenticated" }, 401);
  const sid = sessionIdFromJwt(bearer(req));
  // Without knowing which session is "this device" we could sign the person out of the screen they are using.
  if (!sid) return json({ error: "Cannot identify this device. Sign in again and retry." }, 400);

  const n = await endSessions(admin, caller.user.id, { except: sid });
  await markRevoked(admin, caller.user.id, caller.user.id, "user_others", { except: sid });
  await audit(admin, req, caller.user.id, "session_revoked", null, { scope: "others", count: n });
  return json({ ok: true, revoked: n });
}

// ── admin: sign a user out everywhere ─────────────────────────────────────────────────────────────────────
async function adminRevokeUser(admin: any, req: Request, body: any): Promise<Response> {
  const caller = await resolveCaller(admin, req);
  if (!caller) return json({ error: "Not authenticated" }, 401);
  if (!caller.role || !VIEW_ROLES.includes(caller.role)) return json({ error: "Not allowed" }, 403);
  const platform = caller.role === "knsoft_admin";
  if (!platform && !caller.schoolId) return json({ error: "Your account has no school" }, 403);

  const userId = body?.user_id;
  if (!isUuid(userId)) return json({ error: "user_id is required" }, 400);
  if (userId === caller.user.id) return json({ error: "Use \"Sign out other devices\" for your own account." }, 400);

  const { data: target } = await admin.from("profiles").select("school_id, role").eq("id", userId).maybeSingle();
  if (!target) return json({ error: "User not found" }, 404);
  if (!platform && (target.school_id !== caller.schoolId || target.role === "knsoft_admin")) return json({ error: "Not allowed" }, 403);

  const n = await endSessions(admin, userId, {});
  await markRevoked(admin, userId, caller.user.id, "admin", {});
  await audit(admin, req, caller.user.id, "session_revoked_by_admin", userId, { count: n, reason: str(body?.reason, 200) || null });
  return json({ ok: true, revoked: n });
}

export async function handleSessionManagement(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    switch (body?.action) {
      case "heartbeat": return await heartbeat(admin, req, body);
      case "list": return await list(admin, req);
      case "revoke": return await revoke(admin, req, body);
      case "revoke_others": return await revokeOthers(admin, req);
      case "admin_revoke_user": return await adminRevokeUser(admin, req, body);
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof Unavailable) return json({ ok: true, persistence: "unavailable", devices: [] });
    console.error("session management handler error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
