import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

// Session & Device Management - client side.
// Goes through the already-deployed `log-audit` function, routed on `mode` ("sess_*"); no new edge function.

export interface Device {
  session_id: string;
  label: string;
  browser: string | null;
  os: string | null;
  kind: "desktop" | "mobile" | "tablet" | "app" | string | null;
  ip_address: string | null;
  first_seen: string | null;
  last_seen: string | null;
  current: boolean;
}

export interface DeviceList {
  persistence?: "available" | "unavailable";
  current_session_id: string | null;
  devices: Device[];
}

async function call<T>(mode: string, body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("log-audit", { body: { mode, ...body } });
  if (error) throw new Error((await unwrapFunctionError(error, fallback)).message);
  return data as T;
}

/** Tells the server this device is still in use; answers `revoked: true` once its login has been ended elsewhere. */
export async function sendSessionHeartbeat(native: boolean): Promise<{ revoked: boolean; status?: number }> {
  const { data, error } = await supabase.functions.invoke("log-audit", { body: { mode: "sess_heartbeat", native } });
  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status;
    return { revoked: false, status };
  }
  return { revoked: data?.revoked === true };
}

export const listMyDevices = () => call<DeviceList>("sess_list", {}, "Could not load your devices.");

export const revokeDevice = (sessionId: string) =>
  call<{ ok: boolean; revoked: number }>("sess_revoke", { session_id: sessionId }, "Could not sign that device out.");

export const revokeOtherDevices = () =>
  call<{ ok: boolean; revoked: number }>("sess_revoke_others", {}, "Could not sign the other devices out.");

/** admin / principal / school_admin (same school) or knsoft_admin: end every login of one user. */
export const signOutUserEverywhere = (userId: string, reason?: string) =>
  call<{ ok: boolean; revoked: number }>("sess_admin_revoke_user", { user_id: userId, reason }, "Could not sign that user out.");
