// supabase/functions/_shared/leadIngestionModel.ts
//
// Pure model for Admissions Lead Ads & Form Integrations (no Deno / network / DB imports, so it is
// unit-tested under vitest in src/test/leadIngestionModel.test.ts).
//
// Responsibilities
//   * normalise the very different payloads of Meta Lead Ads, Google Lead Forms, Zoho CRM, website forms
//     and Zapier/Make into ONE lead shape that `ingest_admission_lead()` (SQL) understands
//   * verify webhook authenticity (Meta HMAC signature, shared keys) in constant time
//   * AES-GCM encrypt / decrypt integration credentials and replay payloads
//
// Duplicate detection and persistence deliberately live in SQL (one transaction), not here.

export const LEAD_PROVIDERS = ["meta", "google", "zoho", "website", "zapier", "make"] as const;
export type LeadProvider = (typeof LEAD_PROVIDERS)[number];

export interface NormalizedLead {
  student_name?: string;
  parent_name?: string;
  phone?: string;
  email?: string;
  grade?: string;
  date_of_birth?: string;
  gender?: string;
  address?: string;
  previous_school?: string;
  message?: string;
  campaign?: Record<string, string>;
}

// ---------------------------------------------------------------- text helpers

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(v: unknown, max = 300): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = (Array.isArray(v) ? v.join(", ") : String(v)).replace(CONTROL, "").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.slice(0, max);
}

/** Meta test leads prefix numbers with "p:"; strip that and anything that is not a digit or leading "+". */
export function cleanPhone(v: unknown): string | undefined {
  const s = cleanText(v, 40);
  if (!s) return undefined;
  const stripped = s.replace(/^p:/i, "");
  const plus = stripped.trim().startsWith("+") ? "+" : "";
  const digits = stripped.replace(/\D/g, "");
  return digits ? plus + digits : undefined;
}

export function cleanEmail(v: unknown): string | undefined {
  const s = cleanText(v, 254)?.toLowerCase();
  return s || undefined;
}

export function maskPhone(p?: string): string {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length <= 3 ? "•••" : "•".repeat(d.length - 3) + d.slice(-3);
}

/** snake_case a free-text key: "What class is your child applying for?" -> "what_class_is_your_child_applying_for" */
export function keyOf(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// ---------------------------------------------------------------- field mapping

type Field = keyof Omit<NormalizedLead, "campaign">;

const ALIASES: Record<Field, string[]> = {
  student_name: ["student_name", "student", "child_name", "child", "childs_name", "name_of_child", "name_of_student",
    "ward_name", "applicant_name", "student_full_name", "child_full_name", "pupil_name", "students_name", "student_first_name"],
  parent_name: ["parent_name", "parent", "father_name", "mother_name", "guardian_name", "parent_full_name",
    "parents_name", "full_name", "name", "your_name", "contact_name", "contact_person", "first_name"],
  phone: ["phone", "phone_number", "mobile", "mobile_number", "mobile_no", "phone_no", "contact_number", "contact_no",
    "whatsapp", "whatsapp_number", "telephone", "tel", "parent_phone", "parent_mobile", "cell"],
  email: ["email", "email_address", "e_mail", "mail", "parent_email", "work_email", "personal_email"],
  grade: ["grade", "class", "grade_applying_for", "class_applying_for", "admission_for", "admission_class", "standard",
    "grade_seeking_admission", "seeking_class", "class_seeking_admission", "applying_for", "grade_level", "std"],
  date_of_birth: ["date_of_birth", "dob", "birth_date", "birthdate", "child_dob", "student_dob"],
  gender: ["gender", "sex", "child_gender", "student_gender"],
  address: ["address", "street_address", "city", "location", "area", "locality", "residential_address", "post_code", "zip_code"],
  previous_school: ["previous_school", "current_school", "present_school", "last_school", "school_name", "previous_school_name"],
  message: ["message", "comments", "comment", "notes", "description", "query", "enquiry", "inquiry", "remarks", "additional_information", "question"],
};

/** Fallback for Meta/Google custom questions whose key is the question text. Order matters. */
const KEYWORD_RULES: [Field, (k: string) => boolean][] = [
  ["student_name", (k) => /(child|student|ward|pupil|kid)/.test(k) && /name/.test(k)],
  ["grade", (k) => /(^|_)(grade|class|standard|std)(_|$)/.test(k) && !/(name|teacher)/.test(k)],
  ["date_of_birth", (k) => /(dob|birth)/.test(k)],
  ["previous_school", (k) => /(previous|current|present|last).*school/.test(k)],
  ["phone", (k) => /(phone|mobile|whatsapp|contact_no|contact_number)/.test(k)],
  ["email", (k) => /e_?mail/.test(k)],
  ["parent_name", (k) => /(parent|father|mother|guardian)/.test(k) && /name/.test(k)],
  ["gender", (k) => /(gender)/.test(k)],
  ["message", (k) => /(message|comment|question|query|remark)/.test(k)],
];

export type RawFields = Record<string, unknown>;

/**
 * Map a flat { sourceKey: value } object to lead fields.
 *   1. an admin-defined mapping { apasField: "source key" } wins
 *   2. then exact aliases
 *   3. then keyword heuristics on the key text
 * Unrecognised fields are appended to `message` so no information the parent typed is lost.
 */
export function mapFields(raw: RawFields, customMapping: Record<string, string> = {}): NormalizedLead {
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(raw)) {
    const nk = keyOf(k);
    if (nk && !byKey.has(nk)) byKey.set(nk, v);
  }
  const used = new Set<string>();
  const out: NormalizedLead = {};
  const take = (field: Field, nk: string) => {
    const v = byKey.get(nk);
    const cleaned = field === "phone" ? cleanPhone(v) : field === "email" ? cleanEmail(v) : cleanText(v, field === "message" ? 2000 : 300);
    if (cleaned && out[field] === undefined) {
      out[field] = cleaned;
      used.add(nk);
    }
  };

  for (const [field, src] of Object.entries(customMapping)) {
    if (field in ALIASES && typeof src === "string") take(field as Field, keyOf(src));
  }
  for (const field of Object.keys(ALIASES) as Field[]) {
    if (out[field] !== undefined) continue;
    for (const a of ALIASES[field]) if (byKey.has(a)) take(field, a);
  }
  // first_name + last_name -> parent name when no fuller name was supplied
  if (!out.parent_name || out.parent_name === cleanText(byKey.get("first_name"))) {
    const first = cleanText(byKey.get("first_name"));
    const last = cleanText(byKey.get("last_name"));
    if (first && last) {
      out.parent_name = `${first} ${last}`;
      used.add("first_name"); used.add("last_name");
    }
  }
  for (const nk of byKey.keys()) {
    if (used.has(nk)) continue;
    for (const [field, test] of KEYWORD_RULES) {
      if (out[field] === undefined && test(nk)) { take(field, nk); break; }
    }
  }
  // keep everything else the parent told us
  const extras: string[] = [];
  for (const [nk, v] of byKey) {
    if (used.has(nk) || ["last_name", "id", "lead_id", "created_time", "form_id", "ad_id", "adset_id", "campaign_id", "platform",
      "google_key", "is_test", "token", "key", "api_key", "hp", "_hp"].includes(nk)) continue;
    const t = cleanText(v, 200);
    if (t && !/^(true|false)$/i.test(t) && extras.length < 12) extras.push(`${nk.replace(/_/g, " ")}: ${t}`);
  }
  if (extras.length) out.message = [out.message, ...extras].filter(Boolean).join("\n").slice(0, 2000);
  return out;
}

// ---------------------------------------------------------------- provider payloads

/** Meta Graph API lead: { id, created_time, ad_id, form_id, field_data:[{name, values:[...]}] } */
export function normalizeMetaLead(lead: any, customMapping: Record<string, string> = {}): { lead: NormalizedLead; externalId?: string } {
  const flat: RawFields = {};
  for (const f of Array.isArray(lead?.field_data) ? lead.field_data : []) {
    if (f && typeof f.name === "string") flat[f.name] = Array.isArray(f.values) ? f.values.join(", ") : f.values;
  }
  const out = mapFields(flat, customMapping);
  const campaign: Record<string, string> = {};
  for (const k of ["ad_id", "adset_id", "campaign_id", "form_id", "page_id", "platform", "ad_name", "campaign_name", "form_name"]) {
    const v = cleanText(lead?.[k], 120);
    if (v) campaign[k] = v;
  }
  out.campaign = campaign;
  const id = cleanText(lead?.id, 120);
  return { lead: out, externalId: id };
}

/** Google Ads lead form webhook: user_column_data:[{column_id, column_name, string_value}] */
export function normalizeGoogleLead(body: any, customMapping: Record<string, string> = {}): { lead: NormalizedLead; externalId?: string; isTest: boolean } {
  const flat: RawFields = {};
  const idMap: Record<string, string> = {
    FULL_NAME: "full_name", FIRST_NAME: "first_name", LAST_NAME: "last_name", EMAIL: "email",
    PHONE_NUMBER: "phone", CITY: "city", POSTAL_CODE: "post_code", STREET_ADDRESS: "street_address",
  };
  for (const c of Array.isArray(body?.user_column_data) ? body.user_column_data : []) {
    const key = idMap[c?.column_id] ?? (typeof c?.column_name === "string" && c.column_name ? c.column_name : c?.column_id);
    if (typeof key === "string") flat[key] = c?.string_value;
  }
  const out = mapFields(flat, customMapping);
  const campaign: Record<string, string> = {};
  for (const k of ["campaign_id", "adgroup_id", "creative_id", "form_id", "gcl_id", "api_version"]) {
    const v = cleanText(body?.[k], 120);
    if (v) campaign[k] = v;
  }
  out.campaign = campaign;
  return { lead: out, externalId: cleanText(body?.lead_id, 120), isTest: body?.is_test === true || body?.is_test === "true" };
}

/** Zoho CRM Lead record (webhook or API). Zoho's own Last_Name is the contact (parent) name. */
export function normalizeZohoLead(rec: any, customMapping: Record<string, string> = {}): { lead: NormalizedLead; externalId?: string } {
  const flat: RawFields = {};
  for (const [k, v] of Object.entries(rec ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const name = (v as any).name ?? (v as any).display_value; // lookup / owner objects
      if (name) flat[k] = name;
    } else flat[k] = v;
  }
  // Zoho uses Mobile before Phone for personal numbers; surface it first
  if (flat["Mobile"] && !flat["Phone"]) flat["Phone"] = flat["Mobile"];
  const first = cleanText(flat["First_Name"]);
  const last = cleanText(flat["Last_Name"]);
  if (last) flat["parent_name"] = [first, last].filter(Boolean).join(" ");
  delete flat["First_Name"]; delete flat["Last_Name"];
  const out = mapFields(flat, customMapping);
  out.campaign = { zoho_lead_source: cleanText(rec?.Lead_Source, 80) ?? "" };
  if (!out.campaign.zoho_lead_source) delete out.campaign.zoho_lead_source;
  return { lead: out, externalId: cleanText(rec?.id ?? rec?.Id, 120) };
}

/** Website form / Zapier / Make: flat JSON or form fields. Accepts a few id spellings for idempotency. */
export function normalizeGenericLead(body: any, customMapping: Record<string, string> = {}): { lead: NormalizedLead; externalId?: string } {
  const src: RawFields = body && typeof body === "object" ? body : {};
  const out = mapFields(src, customMapping);
  const campaign: Record<string, string> = {};
  for (const k of Object.keys(src)) {
    if (/^utm_/i.test(k) || ["page_url", "referrer", "form_name", "campaign"].includes(k)) {
      const v = cleanText(src[k], 200);
      if (v) campaign[k.toLowerCase()] = v;
    }
  }
  out.campaign = campaign;
  const id = src.lead_id ?? src.external_id ?? src.id ?? src.submission_id;
  return { lead: out, externalId: cleanText(id, 120) };
}

/** Last line of defence before the DB: drop empties, enforce minimum contact info. */
export function validateLead(lead: NormalizedLead): { ok: true } | { ok: false; reason: string } {
  const digits = (lead.phone ?? "").replace(/\D/g, "");
  if (!digits && !lead.email) return { ok: false, reason: "missing_contact: no phone number or email in the submission" };
  return { ok: true };
}

// ---------------------------------------------------------------- authenticity

const enc = new TextEncoder();
const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Constant-time string compare (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Meta signs the RAW request body: X-Hub-Signature-256: sha256=<hex hmac with the app secret>. */
export async function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !appSecret) return false;
  const m = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!m) return false;
  return safeEqual(m[1].toLowerCase(), await hmacSha256Hex(appSecret, rawBody));
}

/** Meta's recommended `appsecret_proof` for Graph calls made with a page token. */
export const metaAppSecretProof = (accessToken: string, appSecret: string) => hmacSha256Hex(appSecret, accessToken);

export function randomToken(bytes = 24): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Bearer token, x-api-key header or ?key= — whichever the sender can do (Zapier and Make can all set headers). */
export function extractApiKey(headers: { get(name: string): string | null }, url: URL): string | null {
  const auth = headers.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  return headers.get("x-api-key") ?? headers.get("x-apas-key") ?? url.searchParams.get("key");
}

// ---------------------------------------------------------------- credential encryption (AES-256-GCM)

function b64decode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const b64encode = (b: Uint8Array) => btoa(String.fromCharCode(...b));

async function aesKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64decode(keyB64);
  if (raw.length !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY must be 32 random bytes, base64 encoded (openssl rand -base64 32)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Output format "v1.<iv b64>.<ciphertext b64>". `aad` binds the ciphertext to its owner row. */
export async function encryptJson(value: unknown, keyB64: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, await aesKey(keyB64), enc.encode(JSON.stringify(value)));
  return `v1.${b64encode(iv)}.${b64encode(new Uint8Array(ct))}`;
}

export async function decryptJson<T = unknown>(blob: string, keyB64: string, aad: string): Promise<T> {
  const [v, iv, ct] = blob.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Unsupported ciphertext format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64decode(iv), additionalData: enc.encode(aad) }, await aesKey(keyB64), b64decode(ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

// ---------------------------------------------------------------- display helpers (UI + email)

export const PROVIDER_LABELS: Record<LeadProvider, string> = {
  meta: "Meta Lead Ads (Facebook / Instagram)",
  google: "Google Lead Forms",
  zoho: "Zoho CRM",
  website: "Website form",
  zapier: "Zapier",
  make: "Make",
};

/** Credential keys each provider may store. `generated` ones are created server-side and shown once. */
export const PROVIDER_SECRET_FIELDS: Record<LeadProvider, { required: string[]; optional: string[]; generated: string[] }> = {
  meta: { required: ["app_secret", "page_access_token"], optional: [], generated: ["verify_token"] },
  google: { required: [], optional: [], generated: ["google_key"] },
  zoho: { required: ["client_id", "client_secret", "refresh_token"], optional: [], generated: ["api_key"] },
  website: { required: [], optional: [], generated: [] },
  zapier: { required: [], optional: [], generated: ["api_key"] },
  make: { required: [], optional: [], generated: ["api_key"] },
};

export function newLeadEmail(args: { provider: string; integration: string; student?: string | null; grade?: string | null; parent?: string | null; repeat?: boolean; appUrl?: string }) {
  const kind = args.repeat ? "Repeat enquiry" : "New admission enquiry";
  const lines = [
    `${kind} via ${args.integration} (${args.provider}).`,
    args.student ? `Student: ${args.student}` : null,
    args.grade ? `Grade: ${args.grade}` : null,
    args.parent ? `Parent: ${args.parent}` : null,
    "",
    "Open Admissions → Applicants in APAS to see the full details and follow up.",
    args.appUrl ?? "",
  ].filter((l) => l !== null);
  return { subject: `${kind}${args.student ? ` – ${args.student}` : ""}`, body: lines.join("\n") };
}
