// Personalized dashboard widgets - persistence. Device copy (instant, works offline / before the migration)
// plus a server copy (public.user_dashboard_layouts) so the layout follows the user across devices.
// Only widget ids, order and visibility are stored - never tokens or school data.

import { supabase } from "@/integrations/supabase/client";
import { isLayout, type DashboardLayout } from "./dashboardLayout";
import { isMissingBackend } from "./drafts/draftApi";

const PREFIX = "apas.dashboard-layout.v1";
const key = (userId: string, dashboardKey: string) => `${PREFIX}:${userId}:${dashboardKey}`;

export function readLocalLayout(userId: string, dashboardKey: string): DashboardLayout | null {
  try {
    const raw = window.localStorage.getItem(key(userId, dashboardKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isLayout(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLocalLayout(userId: string, dashboardKey: string, layout: DashboardLayout): boolean {
  try {
    window.localStorage.setItem(key(userId, dashboardKey), JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;
let serverUnavailable = false;
export const __resetLayoutStoreForTests = () => { serverUnavailable = false; };

export type ServerLayoutResult =
  | { ok: true; layout: DashboardLayout | null }
  | { ok: false; reason: "unavailable" | "error" };

export async function fetchServerLayout(userId: string, dashboardKey: string): Promise<ServerLayoutResult> {
  if (serverUnavailable) return { ok: false, reason: "unavailable" };
  try {
    const { data, error } = await db().from("user_dashboard_layouts").select("layout").eq("user_id", userId).eq("dashboard_key", dashboardKey).maybeSingle();
    if (error) {
      if (isMissingBackend(error)) { serverUnavailable = true; return { ok: false, reason: "unavailable" }; }
      return { ok: false, reason: "error" };
    }
    return { ok: true, layout: data && isLayout(data.layout) ? data.layout : null };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export type SaveLayoutResult = "saved" | "unavailable" | "error";

export async function saveServerLayout(userId: string, dashboardKey: string, layout: DashboardLayout): Promise<SaveLayoutResult> {
  if (serverUnavailable) return "unavailable";
  try {
    const { error } = await db().from("user_dashboard_layouts").upsert(
      { user_id: userId, dashboard_key: dashboardKey, layout, updated_at: new Date().toISOString() },
      { onConflict: "user_id,dashboard_key" },
    );
    if (!error) return "saved";
    if (isMissingBackend(error)) { serverUnavailable = true; return "unavailable"; }
    return "error";
  } catch {
    return "error";
  }
}
