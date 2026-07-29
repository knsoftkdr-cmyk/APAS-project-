import { useState } from "react";
import axios from "axios";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FileUp, Loader2, CheckCircle2, AlertCircle, School } from "lucide-react";

const TEXTBOOK_API_URL = import.meta.env.VITE_TEXTBOOK_API_URL as string | undefined;

interface TextbookLoaderPanelProps {
  schoolId: string | null;
}

interface SchoolInfo {
  name: string;
  curriculum: string | null;
}

export function TextbookLoaderPanel({ schoolId }: TextbookLoaderPanelProps) {
  const [file, setFile] = useState<File | null>(null);

  const { data: school, isLoading: schoolLoading } = useQuery({
    queryKey: ["textbook-loader-school", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schools")
        .select("name, curriculum")
        .eq("id", schoolId!)
        .single();
      if (error) throw error;
      return data as SchoolInfo;
    },
    enabled: !!schoolId,
  });

  const boardType = school?.curriculum ? school.curriculum.toUpperCase() : null;

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!TEXTBOOK_API_URL) {
        throw new Error("Textbook engine URL is not configured (VITE_TEXTBOOK_API_URL)");
      }
      if (!boardType) {
        throw new Error("This school has no curriculum/board set yet. Contact KNSoft admin to configure it.");
      }
      const formData = new FormData();
      formData.append("file", file!);
      formData.append("book_type", boardType);
      if (schoolId) formData.append("school_id", schoolId);

      const res = await axios.post(`${TEXTBOOK_API_URL}/api/upload-textbook`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return res.data;
    },
    onSuccess: () => setFile(null),
  });

  const canSubmit = !!file && !!boardType && !uploadMutation.isPending;

  return (
    <Card className="max-w-xl border-2 border-blue-200 rounded-2xl bg-gradient-to-br from-blue-50/60 via-white to-white">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileUp className="h-4 w-4 text-blue-600" /> Textbook Loader
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Upload a textbook PDF to automatically extract its curriculum structure (units, chapters, topics) into APAS.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {schoolLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : school ? (
          <div className="flex items-center gap-2 text-xs bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <School className="h-3.5 w-3.5 text-blue-600 shrink-0" />
            <span>
              Uploading for <span className="font-semibold">{school.name}</span>
              {boardType ? (
                <> &middot; <span className="font-semibold">{boardType}</span></>
              ) : (
                <span className="text-red-600"> &middot; no curriculum/board set</span>
              )}
            </span>
          </div>
        ) : null}

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Textbook PDF</label>
          <Input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>

        <Button
          onClick={() => uploadMutation.mutate()}
          disabled={!canSubmit}
          className="w-full bg-blue-600 hover:bg-blue-700 rounded-full"
        >
          {uploadMutation.isPending ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing textbook...
            </span>
          ) : (
            "Run Extraction Pipeline"
          )}
        </Button>

        {uploadMutation.isSuccess && (
          <div className="flex items-start gap-2 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Ingestion complete. Book record ID: {uploadMutation.data?.book_id}</span>
          </div>
        )}

        {uploadMutation.isError && (
          <div className="flex items-start gap-2 text-xs bg-red-50 border border-red-200 text-red-800 rounded-lg p-3">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              {(uploadMutation.error as any)?.response?.data?.detail ||
                (uploadMutation.error as Error)?.message ||
                "Upload failed."}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
