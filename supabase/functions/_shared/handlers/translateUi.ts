// supabase/functions/_shared/handlers/translateUi.ts
//
// UI translation: sends English interface text to Google Cloud Translation and
// returns the translations. Used only by tools/translate-ui.mjs when a developer
// regenerates src/i18n/locales/<lang>.json - the app itself never calls it, it
// reads the committed JSON.
//
// Not a standalone edge function (deployment limit): the already-deployed
// `log-audit` function routes here on `mode: "ui_translate"` - see
// _shared/mergedRouter.ts and CONSOLIDATION.md.
//
//   Body: { strings: string[], target: "ar" | "hi" | "te" }
//   ->    { translations: (string | null)[], characters: number }
//   A null entry means Google's output dropped or invented a {n} placeholder;
//   the caller keeps English for that string rather than show a broken sentence.
//
// Access: platform admins only (see TRANSLATOR_ROLES), so the public anon key
// cannot be used to spend the translation quota.
// Secret: CLOUD_TRANSLATION_API (a Google Cloud API key). It is sent to Google
// in a request header, never in the URL, and never returned or logged.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TRANSLATOR_ROLES = ["knsoft_admin", "super_admin", "admin"];
const TARGETS = ["ar", "hi", "te"];
const MAX_STRINGS = 100;        // Google allows 128 segments per request
const MAX_STRING_CHARS = 2000;
const MAX_TOTAL_CHARS = 25000;  // Google recommends staying under 30K per request
const GOOGLE_URL = "https://translation.googleapis.com/language/translate/v2";

/** Names that must reach the user exactly as written. */
const KEEP_AS_IS = ["APAS", "BKT", "IRT", "OCR", "SEN", "IEP", "CSV", "PDF", "ERP", "RFID", "KnSoft", "Excellencia"];

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Marks placeholders and product names so Google leaves them untouched. */
function protect(s: string): string {
  let out = escapeHtml(s).replace(/\{(\d+)\}/g, '<span translate="no">{$1}</span>');
  for (const word of KEEP_AS_IS) {
    out = out.replace(new RegExp(`\\b${word}\\b`, "g"), `<span translate="no">${word}</span>`);
  }
  return out;
}

function unprotect(s: string): string {
  return s
    .replace(/<span translate="no">\s*([^<]*?)\s*<\/span>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .trim();
}

const placeholders = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join(",");

export async function handleTranslateUi(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Sign in as a platform admin to translate the UI." }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Your session is invalid or expired. Sign in again." }, 401);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || !TRANSLATOR_ROLES.includes(profile.role)) {
    return json({ error: `Only these roles can translate the UI: ${TRANSLATOR_ROLES.join(", ")}.` }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON: { strings: string[], target }." }, 400);
  }
  const { strings, target } = body ?? {};
  if (!TARGETS.includes(target)) return json({ error: `target must be one of: ${TARGETS.join(", ")}.` }, 400);
  if (!Array.isArray(strings) || strings.length === 0 || strings.length > MAX_STRINGS) {
    return json({ error: `strings must be an array of 1 to ${MAX_STRINGS} items.` }, 400);
  }
  if (!strings.every((s) => typeof s === "string" && s.length > 0 && s.length <= MAX_STRING_CHARS)) {
    return json({ error: `Each string must be 1 to ${MAX_STRING_CHARS} characters.` }, 400);
  }
  const characters = strings.reduce((n: number, s: string) => n + s.length, 0);
  if (characters > MAX_TOTAL_CHARS) return json({ error: `At most ${MAX_TOTAL_CHARS} characters per request.` }, 400);

  const apiKey = Deno.env.get("CLOUD_TRANSLATION_API");
  if (!apiKey) return json({ error: "CLOUD_TRANSLATION_API is not set in Supabase secrets." }, 500);

  const google = await fetch(GOOGLE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
    body: JSON.stringify({ q: strings.map(protect), source: "en", target, format: "html" }),
  });
  const result = await google.json().catch(() => null);
  if (!google.ok) {
    // Google's own message (e.g. API not enabled, key restricted); never the key.
    const reason = result?.error?.message ?? `HTTP ${google.status}`;
    return json({ error: `Google Cloud Translation refused the request: ${reason}` }, 502);
  }

  const translated: any[] = result?.data?.translations ?? [];
  if (translated.length !== strings.length) {
    return json({ error: "Google Cloud Translation returned a different number of results than requested." }, 502);
  }

  const translations = translated.map((t, i) => {
    const text = unprotect(String(t?.translatedText ?? ""));
    return text && placeholders(text) === placeholders(strings[i]) ? text : null;
  });

  return json({ translations, characters });
}
