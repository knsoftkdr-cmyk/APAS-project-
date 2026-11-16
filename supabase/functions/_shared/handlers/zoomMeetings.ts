// supabase/functions/_shared/handlers/zoomMeetings.ts
//
// Served by ai-teacher-assistant, actions "zoom_status" / "zoom_create" / "zoom_start" (Edge Function limit, see
// _shared/mergedRouter.ts). Creates Zoom meetings for live classes using a Server-to-Server OAuth app.
//
// Secrets needed (Zoom Marketplace > Develop > Server-to-Server OAuth, scopes meeting:write:admin, meeting:read:admin,
// user:read:admin): ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET. Without them zoom_status reports
// configured: false and the page simply doesn't offer the button.
//
// The host link is never saved: it lets whoever holds it start the class as the host, and students can read the
// session row. zoom_start fetches a fresh one for the session's own teacher instead.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const ZOOM_API = "https://api.zoom.us/v2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function zoomCreds() {
  const accountId = Deno.env.get("ZOOM_ACCOUNT_ID");
  const clientId = Deno.env.get("ZOOM_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOOM_CLIENT_SECRET");
  return accountId && clientId && clientSecret ? { accountId, clientId, clientSecret } : null;
}

async function zoomToken(c: NonNullable<ReturnType<typeof zoomCreds>>): Promise<string> {
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(c.accountId)}`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${c.clientId}:${c.clientSecret}`)}` },
  });
  if (!res.ok) {
    console.error("zoom token error", res.status, await res.text());
    throw new Error("Zoom rejected the school's credentials. Please check the Zoom app settings.");
  }
  return (await res.json()).access_token;
}

/** Creates under the teacher's own Zoom user when their email is on the account, otherwise under the account owner. */
async function createMeeting(token: string, email: string | undefined, payload: Record<string, unknown>) {
  const post = (user: string) => fetch(`${ZOOM_API}/users/${encodeURIComponent(user)}/meetings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let res = email ? await post(email) : await post("me");
  if (email && (res.status === 404 || res.status === 400)) res = await post("me");
  if (!res.ok) {
    console.error("zoom create error", res.status, await res.text());
    throw new Error("Zoom couldn't create the meeting. Please try again, or paste a link instead.");
  }
  return await res.json();
}

export async function handleZoomMeetings(req: Request): Promise<Response> {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await asCaller.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "teacher") return json({ error: "Only teachers can manage class meetings" }, 403);

    const body = await req.json().catch(() => ({}));
    const creds = zoomCreds();
    if (body.action === "status") return json({ configured: !!creds });
    if (!creds) return json({ error: "Zoom isn't connected for this school yet." }, 400);

    if (body.action === "create") {
      const start = new Date(body.start);
      const end = new Date(body.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return json({ error: "Please set a valid start and end time first." }, 400);
      const topic = String(body.topic ?? "").trim().slice(0, 190) || "Online class";
      const meeting = await createMeeting(await zoomToken(creds), user.email, {
        topic,
        // Type 3 keeps one link working every day, which is how repeating classes here work. Type 2 is a single class.
        type: body.recurring ? 3 : 2,
        start_time: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
        duration: Math.min(1440, Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))),
        settings: { join_before_host: false, waiting_room: true, mute_upon_entry: true },
      });
      return json({ meeting_id: String(meeting.id), join_url: meeting.join_url });
    }

    if (body.action === "start") {
      // Read as the caller: RLS and the teacher check below both have to agree this is their own class.
      const { data: session } = await asCaller.from("virtual_classroom_sessions")
        .select("teacher_id, external_provider, external_meeting_id").eq("id", body.session_id).maybeSingle();
      if (!session || session.teacher_id !== user.id) return json({ error: "Class not found" }, 404);
      if (session.external_provider !== "zoom" || !session.external_meeting_id) return json({ error: "This class wasn't created through Zoom here." }, 400);
      const res = await fetch(`${ZOOM_API}/meetings/${encodeURIComponent(session.external_meeting_id)}`, {
        headers: { Authorization: `Bearer ${await zoomToken(creds)}` },
      });
      if (!res.ok) {
        console.error("zoom get error", res.status, await res.text());
        return json({ error: "Zoom couldn't find this meeting. It may have been deleted." }, 502);
      }
      return json({ start_url: (await res.json()).start_url });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("zoom handler error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
