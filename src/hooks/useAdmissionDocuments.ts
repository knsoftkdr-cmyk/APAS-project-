import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AdmissionDocument, AdmissionDocumentType } from "@/types/admission";
 
const BUCKET = "admission-documents";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "webp"];
 
export interface UploadAdmissionDocumentParams {
  file: File;
  documentType: AdmissionDocumentType;
  applicantId: string;
}
 
/**
 * Standalone uploader. Sends the file to the upload-admission-document Edge
 * Function, which does server-side type/size validation, a malware scan,
 * and only then writes to storage + inserts the DB row using the service
 * role. schoolId/uploadedBy are no longer taken from the caller — the
 * function derives both from the authenticated JWT and the applicant's own
 * row, so the browser can no longer just assert them.
 */
export async function uploadAdmissionDocument({
  file,
  documentType,
  applicantId,
}: UploadAdmissionDocumentParams): Promise<{ error: string | null }> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return { error: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { error: "File is too large. Max size is 10MB." };
  }
 
  const formData = new FormData();
  formData.append("file", file);
  formData.append("applicantId", applicantId);
  formData.append("documentType", documentType);
 
  const { data, error } = await supabase.functions.invoke("upload-admission-document", {
    body: formData,
  });
 
  if (error) {
    // supabase-js's default error.message for a non-2xx response is just
    // "Edge Function returned a non-2xx status code" — the function's own
    // { error: "..." } JSON body (with the real reason) is on error.context,
    // the raw Response object. Unwrap it so the user sees the actual cause.
    let message = error.message ?? "Upload failed.";
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const body = await context.json();
        if (body?.error) message = body.error;
      } catch {
        // context wasn't JSON; fall back to the generic message above
      }
    }
    return { error: message };
  }
  if (data?.error) {
    return { error: data.error };
  }
 
  return { error: null };
}
 
export function useAdmissionDocuments(applicantId: string | null) {
  const { profile } = useAuth();
  const schoolId = profile?.school_id ?? null;
 
  const [documents, setDocuments] = useState<AdmissionDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
 
  const fetchDocuments = useCallback(async () => {
    if (!applicantId) {
      setDocuments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("admission_documents")
      .select("*")
      .eq("applicant_id", applicantId)
      .order("uploaded_at", { ascending: false });
 
    if (error) {
      console.error("Failed to load documents:", error);
      setDocuments([]);
    } else {
      setDocuments((data ?? []) as AdmissionDocument[]);
    }
    setLoading(false);
  }, [applicantId]);
 
  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);
 
  const uploadDocument = useCallback(
    async (file: File, documentType: AdmissionDocumentType): Promise<{ error: string | null }> => {
      if (!applicantId) {
        return { error: "Missing applicant context." };
      }
 
      setUploading(true);
      const result = await uploadAdmissionDocument({ file, documentType, applicantId });
      setUploading(false);
 
      if (result.error) {
        return result;
      }
 
      await fetchDocuments();
      return { error: null };
    },
    [applicantId, fetchDocuments]
  );
 
  const viewDocument = useCallback(async (doc: AdmissionDocument): Promise<{ url: string | null; error: string | null }> => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 60);
    if (error || !data) {
      return { url: null, error: error?.message ?? "Could not generate a link for this file." };
    }
 
    // Best-effort audit log — don't block the view on this.
    supabase
      .from("admission_document_views")
      .insert({ document_id: doc.id, viewed_by: profile?.id ?? null })
      .then(({ error: logError }) => {
        if (logError) console.error("Failed to log document view:", logError);
      });
 
    return { url: data.signedUrl, error: null };
  }, [profile?.id]);
 
  const deleteDocument = useCallback(
    async (doc: AdmissionDocument): Promise<{ error: string | null }> => {
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([doc.file_path]);
      if (storageError) {
        return { error: storageError.message };
      }
      const { error: dbError } = await supabase.from("admission_documents").delete().eq("id", doc.id);
      if (dbError) {
        return { error: dbError.message };
      }
      await fetchDocuments();
      return { error: null };
    },
    [fetchDocuments]
  );
 
  return { documents, loading, uploading, refetch: fetchDocuments, uploadDocument, viewDocument, deleteDocument };
}