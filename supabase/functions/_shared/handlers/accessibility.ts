// supabase/functions/_shared/handlers/accessibility.ts
//
// Accessibility Engine: load / save one user's display preferences (dyslexia mode,
// screen-reader mode, keyboard navigation, text size).
//
// Not a standalone edge function (deployment limit): `get-mastery-history` routes to this handler via its
// `action` field - see _shared/mergedRouter.ts and CONSOLIDATION.md.
//
//   action "accessibility_get"   Body: {}  -> { preferences, saved, updated_at, persistence, suggestion? }
//   action "accessibility_save"  Body: { preferences: Partial<AccessibilityPrefs> } -> { preferences, saved: true }
//
// Access: any signed-in user, and only their OWN row (the user id always comes from the verified JWT, never
// from the body). Students who have no saved row also get a `suggestion` derived from their own active SEN
// accommodations (read through the caller's JWT, so RLS scopes it). A suggestion is never applied for them.
// If migration 20261013000000 hasn't been applied, get returns persistence "unavailable" and save returns 503;
// the app then keeps working from the device cache.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DEFAULT_PREFS, sanitizePrefs, suggestFromAccommodations } from "../accessibilityModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TABLE = "user_accessibility_preferences";

function tableMissing(err: any): boolean {
  const msg = String(err?.message ?? "");
  return err?.code === "42P01" || err?.code === "PGRST205" || /does not exist|schema cache/i.test(msg);
}

export async function handleAccessibility(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    const { data: row, error: readErr } = await admin
      .from(TABLE).select("preferences, updated_at").eq("user_id", user.id).maybeSingle();
    if (readErr && !tableMissing(readErr)) throw readErr;
    const persistence = readErr ? "unavailable" : "available";
    const current = row ? sanitizePrefs(row.preferences) : DEFAULT_PREFS;

    // ── save ───────────────────────────────────────────────────────────────────────────────────
    if (action === "save") {
      if (persistence === "unavailable") {
        return json({ error: "Saving accessibility settings to your account isn't set up yet.", code: "persistence_unavailable" }, 503);
      }
      if (!body?.preferences || typeof body.preferences !== "object" || Array.isArray(body.preferences)) {
        return json({ error: "preferences must be an object" }, 400);
      }
      const next = sanitizePrefs(body.preferences, current);
      const updated_at = new Date().toISOString();
      const { error: writeErr } = await admin.from(TABLE).upsert({ user_id: user.id, preferences: next, updated_at }, { onConflict: "user_id" });
      if (writeErr) throw writeErr;
      return json({ preferences: next, saved: true, updated_at, persistence });
    }

    // ── get ────────────────────────────────────────────────────────────────────────────────────
    if (action === "get") {
      let suggestion: { settings: Record<string, unknown>; reasons: string[] } | null = null;
      if (!row) {
        const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (profile?.role === "student") {
          // Through the caller's JWT so RLS keeps this to the student's own accommodations.
          const { data: accs } = await userClient
            .from("sen_accommodations").select("accommodation_type, description").eq("active", true);
          const s = suggestFromAccommodations(accs ?? []);
          if (Object.keys(s.settings).length) suggestion = s;
        }
      }
      return json({
        preferences: row ? current : null,
        saved: !!row,
        updated_at: row?.updated_at ?? null,
        persistence,
        suggestion,
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("accessibility handler error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
