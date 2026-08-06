// supabase/functions/upload-admission-document/index.ts
//
// Server-side replacement for uploading straight to storage from the browser.
// The client now sends the file here instead. This function:
//   1. Verifies the caller's JWT and looks up their profile (role + school_id)
//      using a client scoped to that JWT, so normal RLS decides authorization.
//   2. Confirms the target applicant belongs to the caller's school.
//   3. Re-checks file size AND sniffs the file's real magic bytes (not just
//      the extension/MIME the browser claims) so a renamed .exe can't sneak
//      through as "report.pdf".
//   4. Sends the file to VirusTotal for a malware scan and rejects anything
//      flagged malicious/suspicious.
//   5. Only after all of that passes does it write to storage (via the
//      service role) and insert the admission_documents row.
//
// Deploy: supabase functions deploy upload-admission-document
// Secret:  supabase secrets set VIRUSTOTAL_API_KEY=your_key_here
// (Get a free key at https://www.virustotal.com/gui/join-us)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "admission-documents";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_DOCUMENT_TYPES = ["report_card", "birth_certificate", "id_proof", "transfer_certificate", "photo", "other"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Sniffs the first bytes of the file to confirm its real type, independent
// of the filename/extension/browser-reported MIME type.
function detectRealFileType(bytes: Uint8Array): "pdf" | "jpg" | "png" | "webp" | null {
  if (bytes.length < 12) return null;

  // %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  // WEBP: "RIFF"....."WEBP"
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff === "RIFF" && webp === "WEBP") return "webp";

  return null;
}

async function scanWithVirusTotal(file: File, apiKey: string): Promise<{ clean: boolean; reason?: string }> {
  const uploadForm = new FormData();
  uploadForm.append("file", file);

  const uploadResp = await fetch("https://www.virustotal.com/api/v3/files", {
    method: "POST",
    headers: { "x-apikey": apiKey },
    body: uploadForm,
  });

  if (!uploadResp.ok) {
    // Fail closed: if we can't scan it, don't accept it.
    return { clean: false, reason: "Could not reach the malware scanner. Please try again." };
  }

  const uploadJson = await uploadResp.json();
  const analysisId: string | undefined = uploadJson?.data?.id;
  if (!analysisId) {
    return { clean: false, reason: "Malware scanner returned an unexpected response." };
  }

  // Poll for the analysis result. VirusTotal scans usually finish in a few
  // seconds for common file types; cap total wait to stay within the
  // function's execution limit.
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const analysisResp = await fetch(`https://www.virustotal.com/api/v3/analyses/${analysisId}`, {
      headers: { "x-apikey": apiKey },
    });
    if (!analysisResp.ok) continue;

    const analysisJson = await analysisResp.json();
    const status = analysisJson?.data?.attributes?.status;
    if (status !== "completed") continue;

    const stats = analysisJson?.data?.attributes?.stats ?? {};
    const malicious = stats.malicious ?? 0;
    const suspicious = stats.suspicious ?? 0;

    if (malicious > 0 || suspicious > 0) {
      return { clean: false, reason: `Flagged by malware scan (${malicious} malicious, ${suspicious} suspicious).` };
    }
    return { clean: true };
  }

  // Scan didn't finish in time — fail closed rather than accept an unscanned file.
  return { clean: false, reason: "Malware scan did not complete in time. Please try again shortly." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization header" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const virusTotalKey = Deno.env.get("VIRUSTOTAL_API_KEY");

  // Scoped to the caller's own JWT — RLS applies normally on every query
  // made with this client, so authorization checks below are enforced by
  // the database itself, not just by this function's logic.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await callerClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }

  const { data: profile, error: profileError } = await callerClient
    .from("profiles")
    .select("id, role, school_id, erp_access")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return jsonResponse({ error: "Could not verify your profile" }, 403);
  }
  const ADMIN_ROLES = ["principal", "admin", "school_admin", "knsoft_admin"];
  if (!ADMIN_ROLES.includes(profile.role) && profile.erp_access !== true) {
    return jsonResponse({ error: "Your role cannot upload admission documents" }, 403);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonResponse({ error: "Expected multipart/form-data with a 'file' field" }, 400);
  }

  const file = formData.get("file");
  const applicantId = formData.get("applicantId");
  const documentType = formData.get("documentType");

  if (!(file instanceof File)) return jsonResponse({ error: "No file provided" }, 400);
  if (typeof applicantId !== "string" || !applicantId) return jsonResponse({ error: "Missing applicantId" }, 400);
  if (typeof documentType !== "string" || !ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
    return jsonResponse({ error: "Invalid documentType" }, 400);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return jsonResponse({ error: "File is too large. Max size is 10MB." }, 400);
  }

  // Confirm this applicant belongs to the caller's school. Uses the
  // caller-scoped client so admission_applicants RLS enforces it too —
  // this query simply fails to find a row for a different school.
  const { data: applicant, error: applicantError } = await callerClient
    .from("admission_applicants")
    .select("id, school_id")
    .eq("id", applicantId)
    .single();

  if (applicantError || !applicant) {
    return jsonResponse({ error: "Applicant not found, or you don't have access to it" }, 403);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const realType = detectRealFileType(bytes);
  if (!realType) {
    return jsonResponse({ error: "Unrecognized or unsupported file type" }, 400);
  }

  if (virusTotalKey) {
    // Re-wrap the already-read bytes into a fresh File for the scan call.
    const scanFile = new File([bytes], file.name, { type: file.type });
    const scanResult = await scanWithVirusTotal(scanFile, virusTotalKey);
    if (!scanResult.clean) {
      return jsonResponse({ error: scanResult.reason ?? "File failed malware scan" }, 422);
    }
  } else {
    console.warn("VIRUSTOTAL_API_KEY not set — skipping malware scan. Set it with `supabase secrets set`.");
  }

  // From here on we use the service role, since all authorization checks
  // above already passed.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${applicant.school_id}/${applicantId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await adminClient.storage.from(BUCKET).upload(storagePath, bytes, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });

  if (uploadError) {
    return jsonResponse({ error: uploadError.message }, 500);
  }

  const { data: docRow, error: dbError } = await adminClient
    .from("admission_documents")
    .insert({
      applicant_id: applicantId,
      document_type: documentType,
      file_path: storagePath,
      file_name: file.name,
      uploaded_by: user.id,
    })
    .select("id")
    .single();

  if (dbError) {
    await adminClient.storage.from(BUCKET).remove([storagePath]);
    return jsonResponse({ error: dbError.message }, 500);
  }

  return jsonResponse({ success: true, documentId: docRow.id });
});