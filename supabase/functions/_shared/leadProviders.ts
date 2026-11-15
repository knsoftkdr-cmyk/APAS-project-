// supabase/functions/_shared/leadProviders.ts
//
// Thin, fetch-injectable clients for the third-party APIs the integrations call:
//   * Meta Graph API   - read a lead by leadgen_id, check/subscribe a Page to `leadgen`
//   * Zoho CRM v6      - OAuth refresh-token exchange, read Leads (single / recent)
// `fetchImpl` and the base URLs are parameters so tests can point them at a local mock server.

import { metaAppSecretProof } from "./leadIngestionModel.ts";

export class ProviderError extends Error {
  /** true when retrying later may succeed (5xx, 429, network); false for bad credentials / permissions */
  constructor(message: string, public transient: boolean, public status?: number) { super(message); }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_GRAPH_VERSION = "v21.0";

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

function graphError(res: Response, body: any): ProviderError {
  const msg = body?.error?.message ?? `HTTP ${res.status}`;
  const code = body?.error?.code;
  // 190 = invalid/expired token, 10/200-299 = permissions, 100 = bad parameter -> permanent
  const transient = res.status >= 500 || res.status === 429 || code === 1 || code === 2 || code === 4 || code === 17 || code === 341;
  return new ProviderError(`Meta: ${msg}${code ? ` (code ${code})` : ""}`, transient, res.status);
}

export interface MetaCreds { page_access_token: string; app_secret: string }

export async function fetchMetaLead(leadgenId: string, creds: MetaCreds, fetchImpl: FetchLike = fetch,
  opts: { base?: string; version?: string } = {}) {
  const base = opts.base ?? "https://graph.facebook.com";
  const proof = await metaAppSecretProof(creds.page_access_token, creds.app_secret);
  const qs = new URLSearchParams({
    fields: "id,created_time,ad_id,ad_name,adset_id,campaign_id,campaign_name,form_id,platform,field_data",
    access_token: creds.page_access_token,
    appsecret_proof: proof,
  });
  let res: Response;
  try { res = await fetchImpl(`${base}/${opts.version ?? DEFAULT_GRAPH_VERSION}/${encodeURIComponent(leadgenId)}?${qs}`); }
  catch (e) { throw new ProviderError(`Meta: network error (${(e as Error).message})`, true); }
  const body = await readJson(res);
  if (!res.ok) throw graphError(res, body);
  return body;
}

export async function checkMetaPage(pageId: string, creds: MetaCreds, fetchImpl: FetchLike = fetch,
  opts: { base?: string; version?: string } = {}) {
  const base = opts.base ?? "https://graph.facebook.com";
  const v = opts.version ?? DEFAULT_GRAPH_VERSION;
  const proof = await metaAppSecretProof(creds.page_access_token, creds.app_secret);
  const auth = new URLSearchParams({ access_token: creds.page_access_token, appsecret_proof: proof });
  const get = async (path: string, extra = "") => {
    let res: Response;
    try { res = await fetchImpl(`${base}/${v}/${path}?${auth}${extra}`); }
    catch (e) { throw new ProviderError(`Meta: network error (${(e as Error).message})`, true); }
    const body = await readJson(res);
    if (!res.ok) throw graphError(res, body);
    return body;
  };
  const page = await get(encodeURIComponent(pageId), "&fields=id,name");
  let subscribed = false;
  try {
    const subs = await get(`${encodeURIComponent(pageId)}/subscribed_apps`);
    subscribed = (subs?.data ?? []).some((a: any) => (a.subscribed_fields ?? []).includes("leadgen"));
  } catch { /* token may lack pages_manage_metadata; reported as "unknown" by caller */ subscribed = false; }
  return { page_id: page?.id, page_name: page?.name, leadgen_subscribed: subscribed };
}

export async function subscribeMetaPage(pageId: string, creds: MetaCreds, fetchImpl: FetchLike = fetch,
  opts: { base?: string; version?: string } = {}) {
  const base = opts.base ?? "https://graph.facebook.com";
  const proof = await metaAppSecretProof(creds.page_access_token, creds.app_secret);
  const body = new URLSearchParams({ subscribed_fields: "leadgen", access_token: creds.page_access_token, appsecret_proof: proof });
  let res: Response;
  try {
    res = await fetchImpl(`${base}/${opts.version ?? DEFAULT_GRAPH_VERSION}/${encodeURIComponent(pageId)}/subscribed_apps`, { method: "POST", body });
  } catch (e) { throw new ProviderError(`Meta: network error (${(e as Error).message})`, true); }
  const json = await readJson(res);
  if (!res.ok) throw graphError(res, json);
  return json?.success === true;
}

// ----------------------------------------------------------------------- Zoho

export interface ZohoCreds { client_id: string; client_secret: string; refresh_token: string }
const ZOHO_DCS = ["com", "eu", "in", "com.au", "jp", "ca", "sa"];
export const isZohoDc = (dc: string) => ZOHO_DCS.includes(dc);

export function zohoHosts(dc: string, overrides: { accounts?: string; api?: string } = {}) {
  const d = isZohoDc(dc) ? dc : "com";
  return { accounts: overrides.accounts ?? `https://accounts.zoho.${d}`, api: overrides.api ?? `https://www.zohoapis.${d}` };
}

export async function zohoAccessToken(creds: ZohoCreds, dc: string, fetchImpl: FetchLike = fetch, overrides = {}): Promise<string> {
  const { accounts } = zohoHosts(dc, overrides);
  const body = new URLSearchParams({ grant_type: "refresh_token", client_id: creds.client_id, client_secret: creds.client_secret, refresh_token: creds.refresh_token });
  let res: Response;
  try { res = await fetchImpl(`${accounts}/oauth/v2/token`, { method: "POST", body }); }
  catch (e) { throw new ProviderError(`Zoho: network error (${(e as Error).message})`, true); }
  const json = await readJson(res);
  if (!res.ok || !json?.access_token) {
    // Zoho returns 200 with {error:"invalid_code"} for bad credentials
    throw new ProviderError(`Zoho: could not get an access token (${json?.error ?? res.status}). Check client id/secret, refresh token and data centre.`, res.status >= 500 || res.status === 429, res.status);
  }
  return json.access_token as string;
}

async function zohoGet(path: string, token: string, dc: string, fetchImpl: FetchLike, overrides: any, headers: Record<string, string> = {}) {
  const { api } = zohoHosts(dc, overrides);
  let res: Response;
  try { res = await fetchImpl(`${api}/crm/v6/${path}`, { headers: { Authorization: `Zoho-oauthtoken ${token}`, ...headers } }); }
  catch (e) { throw new ProviderError(`Zoho: network error (${(e as Error).message})`, true); }
  if (res.status === 204 || res.status === 304) return { data: [] };
  const json = await readJson(res);
  if (!res.ok) throw new ProviderError(`Zoho: ${json?.message ?? json?.code ?? res.status}`, res.status >= 500 || res.status === 429, res.status);
  return json;
}

export async function zohoRecentLeads(creds: ZohoCreds, dc: string, sinceIso: string | null, fetchImpl: FetchLike = fetch, overrides = {}) {
  const token = await zohoAccessToken(creds, dc, fetchImpl, overrides);
  const out: any[] = [];
  for (let page = 1; page <= 4; page++) { // up to 800 leads per sync
    const json = await zohoGet(`Leads?fields=id,First_Name,Last_Name,Email,Phone,Mobile,Description,Lead_Source,City,Street,Created_Time&sort_by=Created_Time&sort_order=desc&per_page=200&page=${page}`,
      token, dc, fetchImpl, overrides, sinceIso ? { "If-Modified-Since": sinceIso } : {});
    out.push(...(json.data ?? []));
    if (!json?.info?.more_records) break;
  }
  return out;
}

export async function zohoLeadsByIds(ids: string[], creds: ZohoCreds, dc: string, fetchImpl: FetchLike = fetch, overrides = {}) {
  const token = await zohoAccessToken(creds, dc, fetchImpl, overrides);
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100).map((x) => encodeURIComponent(x)).join(",");
    const json = await zohoGet(`Leads?ids=${chunk}`, token, dc, fetchImpl, overrides);
    out.push(...(json.data ?? []));
  }
  return out;
}

export async function checkZoho(creds: ZohoCreds, dc: string, fetchImpl: FetchLike = fetch, overrides = {}) {
  const token = await zohoAccessToken(creds, dc, fetchImpl, overrides);
  const json = await zohoGet("org", token, dc, fetchImpl, overrides);
  return { org_name: json?.org?.[0]?.company_name ?? null };
}
