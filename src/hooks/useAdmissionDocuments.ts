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
  schoolId: string;
  uploadedBy: string;
}

/**
 * Standalone uploader — does the same validate -> upload -> insert -> rollback-on-failure
 * flow as the hook below, but doesn't depend on useAdmissionDocuments' state. Use this
 * directly from places that don't have a bound applicantId yet (e.g. the "Log New
 * Applicant" form, before the row exists).
 */
export async function uploadAdmissionDocument({
  file,
  documentType,
  applicantId,
  schoolId,
  uploadedBy,
}: UploadAdmissionDocumentParams): Promise<{ error: string | null }> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return { error: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { error: "File is too large. Max size is 10MB." };
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${schoolId}/${applicantId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    upsert: false,
  });

  if (uploadError) {
    return { error: uploadError.message };
  }

  const { error: dbError } = await supabase.from("admission_documents").insert({
    applicant_id: applicantId,
    document_type: documentType,
    file_path: storagePath,
    file_name: file.name,
    uploaded_by: uploadedBy,
  });

  if (dbError) {
    // Roll back the uploaded file if the DB row failed, so we don't leave orphaned storage objects.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { error: dbError.message };
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
      if (!applicantId || !schoolId || !profile?.id) {
        return { error: "Missing applicant or school context." };
      }

      setUploading(true);
      const result = await uploadAdmissionDocument({
        file,
        documentType,
        applicantId,
        schoolId,
        uploadedBy: profile.id,
      });
      setUploading(false);

      if (result.error) {
        return result;
      }

      await fetchDocuments();
      return { error: null };
    },
    [applicantId, schoolId, profile?.id, fetchDocuments]
  );

  const viewDocument = useCallback(async (doc: AdmissionDocument): Promise<{ url: string | null; error: string | null }> => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 60);
    if (error || !data) {
      return { url: null, error: error?.message ?? "Could not generate a link for this file." };
    }
    return { url: data.signedUrl, error: null };
  }, []);

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
