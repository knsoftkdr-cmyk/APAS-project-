// A student's own certificates, on the Credentials page. RLS only returns their own rows.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileBadge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { displayLocale } from "@/i18n/runtime";
import { downloadCertificatesPdf, safeFileName, type IssuedCertificateRow } from "@/lib/certificates";
import { localizeServerMessage } from "@/lib/serverMessages";

// deno-lint-ignore no-explicit-any
const db = supabase as any;

export function MyCertificates({ studentId }: { studentId: string }) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const { data: certificates = [] } = useQuery({
    queryKey: ["my-certificates", studentId],
    queryFn: async () => {
      const { data, error } = await db.from("issued_certificates").select("*").eq("student_id", studentId).is("revoked_at", null).order("issued_at", { ascending: false });
      if (error) throw error;
      return data as IssuedCertificateRow[];
    },
  });

  if (certificates.length === 0) return null;

  const download = async (c: IssuedCertificateRow) => {
    setDownloading(c.id);
    try {
      const { data } = await db.from("certificate_templates").select("id, background_image").eq("id", c.template_id).maybeSingle();
      await downloadCertificatesPdf([c], new Map([[c.template_id, data?.background_image ?? null]]), `${safeFileName(c.certificate_title)}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? localizeServerMessage(e.message) : "Couldn't create the PDF.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <FileBadge className="h-4 w-4 text-sky-500" />
        <h2 className="font-semibold text-sm text-gray-700">My Certificates ({certificates.length})</h2>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {certificates.map((c) => (
          <Card key={c.id} className="border-sky-100 bg-white/80">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium break-words">{c.certificate_title}</p>
                <p className="text-xs text-muted-foreground break-words">{c.course_name ? `${c.course_name} · ` : ""}{new Date(c.issued_at).toLocaleDateString(displayLocale())}</p>
              </div>
              <Button size="sm" variant="outline" className="shrink-0" disabled={downloading === c.id} onClick={() => download(c)}>
                {downloading === c.id ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <Download className="h-4 w-4 me-1.5" />}
                PDF
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
