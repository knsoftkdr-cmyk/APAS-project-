// supabase/functions/_shared/googleMeet.ts
//
// Minimal Google Meet REST API + Drive client for live-class recordings. Authentication is a Google Cloud SERVICE
// ACCOUNT using Workspace DOMAIN-WIDE DELEGATION: the school's Workspace admin authorises the service account's
// client ID for the three scopes below, and APAS then acts as the teacher who organised the meeting (the Meet API
// only supports user-level authentication, and conference/recording lists are scoped to the organiser).
//
// Secret (Supabase function secret, never in the database or the browser):
//   GOOGLE_MEET_SA_JSON   the service account key file, as one JSON string
//
// Not exercised in CI: it needs a real Workspace tenant. The pure parts (response parsing, filters, scopes) are in
// liveRecordingsModel.ts and are unit-tested.

import {
  GOOGLE_SCOPES, meetConferenceFilter, parseConferenceRecords, parseRecordings,
  type ProviderRecording,
} from "./liveRecordingsModel.ts";

export interface ServiceAccount { client_email: string; private_key: string; client_id?: string }

export class GoogleError extends Error {
  constructor(message: string, public status = 0, public code = "") { super(message); }
}

export function loadServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get("GOOGLE_MEET_SA_JSON");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    return typeof j?.client_email === "string" && typeof j?.private_key === "string" ? j : null;
  } catch { return null; }
}

const enc = new TextEncoder();
const b64url = (input: ArrayBuffer | string) => {
  const bytes = typeof input === "string" ? enc.encode(input) : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function signJwt(sa: ServiceAccount, sub: string): Promise<string> {
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, sub, scope: GOOGLE_SCOPES.join(" "),
    aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600,
  }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

const tokens = new Map<string, { token: string; exp: number }>();

/** An access token that acts as `userEmail` (cached for the life of this invocation). */
export async function accessTokenFor(sa: ServiceAccount, userEmail: string): Promise<string> {
  const hit = tokens.get(userEmail);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const assertion = await signJwt(sa, userEmail);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new GoogleError(body.error_description || body.error || `Token request failed (${res.status})`, res.status, body.error ?? "token");
  }
  tokens.set(userEmail, { token: body.access_token, exp: Date.now() + (Number(body.expires_in) || 3600) * 1000 });
  return body.access_token;
}

async function gfetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 206) {
    const text = await res.text().catch(() => "");
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text)?.error?.message ?? msg; } catch { /* keep raw */ }
    throw new GoogleError(msg || `Google API error ${res.status}`, res.status);
  }
  return res;
}

// ── Meet ────────────────────────────────────────────────────────────────────────────────────────────

/** The space behind a meeting code. Only works for the signed-in (impersonated) user's own meetings. */
export async function getSpace(token: string, meetingCode: string): Promise<{ name: string }> {
  const res = await gfetch(token, `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(meetingCode)}`);
  const j = await res.json();
  if (typeof j?.name !== "string") throw new GoogleError("Meet returned no space for this link");
  return { name: j.name };
}

/** Turn Meet's auto-recording ON/OFF for the space. Meet starts recording when someone with the privilege joins. */
export async function setAutoRecording(token: string, spaceName: string, on: boolean): Promise<void> {
  await gfetch(
    token,
    `https://meet.googleapis.com/v2/${spaceName}?updateMask=config.artifactConfig.recordingConfig.autoRecordingGeneration`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { artifactConfig: { recordingConfig: { autoRecordingGeneration: on ? "ON" : "OFF" } } } }),
    },
  );
}

export async function listConferenceRecords(token: string, meetingCode: string, sinceIso: string) {
  const out: Array<{ name: string; startTime: string | null; endTime: string | null }> = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({ filter: meetConferenceFilter(meetingCode, sinceIso), pageSize: "50" });
    if (pageToken) qs.set("pageToken", pageToken);
    const j = await (await gfetch(token, `https://meet.googleapis.com/v2/conferenceRecords?${qs}`)).json();
    out.push(...parseConferenceRecords(j));
    pageToken = j?.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return out;
}

export async function listRecordings(token: string, conferenceName: string): Promise<ProviderRecording[]> {
  const j = await (await gfetch(token, `https://meet.googleapis.com/v2/${conferenceName}/recordings`)).json();
  return parseRecordings(j);
}

// ── Drive ───────────────────────────────────────────────────────────────────────────────────────────

export async function driveFileInfo(token: string, fileId: string): Promise<{ size: number; mimeType: string }> {
  const j = await (await gfetch(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=size,mimeType`)).json();
  return { size: Number(j.size) || 0, mimeType: String(j.mimeType || "video/mp4") };
}

/** Bytes [start, end] (inclusive) of the file. */
export async function driveRange(token: string, fileId: string, start: number, end: number): Promise<Uint8Array> {
  const res = await gfetch(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Range: `bytes=${start}-${end}` },
  });
  if (res.status !== 206) throw new GoogleError("Drive did not honour the byte range", res.status);
  return new Uint8Array(await res.arrayBuffer());
}

/** A message an admin or teacher can act on, instead of a raw Google error. */
export function describeGoogleError(e: unknown): string {
  const err = e as GoogleError;
  const m = String(err?.message ?? e);
  if (/unauthorized_client/i.test(m) || err?.code === "unauthorized_client") {
    return "Google has not authorised APAS for this school's domain. A Workspace admin must add the APAS service account under Admin console > Security > API controls > Domain-wide delegation.";
  }
  if (/invalid_grant/i.test(m)) return "Google rejected the teacher's account. Check it is a Google Workspace account with the same email as in APAS.";
  if (err?.status === 404) return "Google Meet could not find this meeting for the teacher. Create the Meet link from the teacher's own Google account.";
  if (err?.status === 403) return "Google refused: the teacher must be the organiser of this meeting, and their Workspace edition must allow recording.";
  if (err?.status === 429) return "Google is rate-limiting requests; this will be retried.";
  return m.slice(0, 300);
}
