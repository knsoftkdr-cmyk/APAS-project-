/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getFcmAccessToken, sendPushToToken } from "../_shared/push.ts";
import { sendEmail } from "../_shared/email.ts";
import type { DispatchMessageRequest } from "../_shared/types.ts";

// dispatch-message
// -----------------
// Single fan-out entry point for omnichannel delivery. Call this AFTER you've
// already written the in-app row (e.g. into teacher_messages) — this function
// only handles the "also notify them elsewhere" part: push + email.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { source_table, source_id, recipient_id, title, body, channels } =
      (await req.json()) as DispatchMessageRequest;

    if (!source_table || !source_id || !recipient_id || !title || !body) {
      return Response.json(
        { success: false, message: "source_table, source_id, recipient_id, title and body are required" },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Resolve which channels to attempt
    let targetChannels: string[];
    if (Array.isArray(channels) && channels.length > 0) {
      targetChannels = channels;
    } else {
      const { data: prefs } = await supabase
        .from("notification_preferences")
        .select("push, email")
        .eq("user_id", recipient_id)
        .maybeSingle();

      // No row yet = defaults (both on), matching the table's column defaults
      targetChannels = [
        ...(prefs?.push !== false ? ["push"] : []),
        ...(prefs?.email !== false ? ["email"] : []),
      ];
    }

    if (targetChannels.length === 0) {
      return Response.json(
        { success: true, message: "Recipient has all channels disabled", sent: [] },
        { headers: corsHeaders }
      );
    }

    const { data: recipient } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", recipient_id)
      .maybeSingle();

    const results: Record<string, { status: string; error?: string }> = {};

    // ── Push ──────────────────────────────────────────────────────────────
    if (targetChannels.includes("push")) {
      const { data: devices } = await supabase
        .from("user_devices")
        .select("fcm_token")
        .eq("user_id", recipient_id)
        .eq("is_active", true);

      if (!devices || devices.length === 0) {
        results.push = { status: "skipped", error: "no active device" };
      } else {
        try {
          const accessToken = await getFcmAccessToken();
          const settled = await Promise.allSettled(
            devices.map((d: { fcm_token: string }) =>
              sendPushToToken(accessToken, {
                token: d.fcm_token,
                title,
                body,
                data: { source_table, source_id },
              })
            )
          );
          const anySucceeded = settled.some((r) => r.status === "fulfilled");
          results.push = anySucceeded ? { status: "sent" } : { status: "failed", error: "all devices failed" };
        } catch (e) {
          results.push = { status: "failed", error: String(e) };
        }
      }
    }

    // ── Email ─────────────────────────────────────────────────────────────
    if (targetChannels.includes("email")) {
      if (!recipient?.email) {
        results.email = { status: "skipped", error: "no email on file" };
      } else {
        try {
          await sendEmail({ to: recipient.email, subject: title, body });
          results.email = { status: "sent" };
        } catch (e) {
          results.email = { status: "failed", error: String(e) };
        }
      }
    }

    // ── Log every attempt ─────────────────────────────────────────────────
    const logRows = Object.entries(results).map(([channel, r]) => ({
      source_table,
      source_id,
      recipient_id,
      channel,
      status: r.status,
      error: r.error ?? null,
    }));
    if (logRows.length > 0) {
      await supabase.from("notification_channel_log").insert(logRows);
    }

    return Response.json({ success: true, results }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { success: false, message: String(error) },
      { status: 500, headers: corsHeaders }
    );
  }
});
