// Enquiries tab of the Admissions page: the share link + QR for the public form, and every enquiry it has captured.
// "Convert" opens the normal applicant form, already filled in, and links the two records once it's saved.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Inbox, Loader2, Mail, Phone, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { displayLocale } from "@/i18n/runtime";
import type { ApplicantFormInput } from "@/hooks/useAdmissionApplicants";
import { supabase } from "@/integrations/supabase/client";
import { enquiryFormUrl } from "@/lib/publicUrl";
import type { AdmissionIntake } from "@/types/admission";
import { ApplicantFormDialog } from "./ApplicantFormDialog";

// deno-lint-ignore no-explicit-any
const db = supabase as any;

type EnquiryStatus = "new" | "contacted" | "converted" | "closed";

interface Enquiry {
  id: string;
  student_name: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string | null;
  grade_interested: string | null;
  message: string | null;
  source_channel: string;
  status: EnquiryStatus;
  staff_notes: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<EnquiryStatus, string> = { new: "New", contacted: "Contacted", converted: "Converted", closed: "Closed" };
const STATUS_STYLE: Record<EnquiryStatus, string> = {
  new: "bg-sky-100 text-sky-800 border-sky-200",
  contacted: "bg-amber-100 text-amber-800 border-amber-200",
  converted: "bg-emerald-100 text-emerald-800 border-emerald-200",
  closed: "bg-slate-100 text-slate-700 border-slate-200",
};

export function EnquiriesPanel({ intakes, onCreateApplicant, onConverted }: {
  intakes: AdmissionIntake[];
  onCreateApplicant: (input: ApplicantFormInput) => Promise<{ error: string | null; id?: string | null }>;
  onConverted: () => void;
}) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const schoolId = profile?.school_id ?? null;
  const [statusFilter, setStatusFilter] = useState<EnquiryStatus | "all">("all");
  const [qr, setQr] = useState<string | null>(null);
  const [converting, setConverting] = useState<Enquiry | null>(null);
  const link = schoolId ? enquiryFormUrl(schoolId) : "";

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(link, { width: 320, margin: 1 })).then((url) => { if (!cancelled) setQr(url); });
    return () => { cancelled = true; };
  }, [link]);

  const { data: enquiries = [], isLoading, error } = useQuery({
    queryKey: ["admission-enquiries", schoolId],
    enabled: !!schoolId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("admission_enquiries").select("*").eq("school_id", schoolId).order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data as Enquiry[];
    },
  });
  const visible = useMemo(() => enquiries.filter((e) => statusFilter === "all" || e.status === statusFilter), [enquiries, statusFilter]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admission-enquiries", schoolId] });

  const update = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await db.from("admission_enquiries").update({ ...patch, handled_by: profile?.id, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(`Couldn't save: ${error.message}`); return false; }
    refresh();
    return true;
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy. Please select the link and copy it.");
    }
  };

  const prefill: Partial<ApplicantFormInput> | undefined = converting ? {
    full_name: converting.student_name,
    parent_name: converting.parent_name,
    parent_phone: converting.parent_phone,
    parent_email: converting.parent_email ?? "",
    source: "online_enquiry",
    meeting_notes: converting.message ?? "",
    intake_id: intakes.find((i) => i.is_open && i.grade === converting.grade_interested)?.id ?? "",
  } : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row gap-4 sm:items-center">
          {qr && <img src={qr} alt="QR code for the enquiry form" className="h-28 w-28 rounded border self-center shrink-0" />}
          <div className="min-w-0 flex-1 space-y-2">
            <p className="font-semibold text-sm">Share your enquiry form</p>
            <p className="text-xs text-muted-foreground">
              Put this link on your website, WhatsApp or social media, or print the QR code. Parents don't need to log in.
              Add <code>?src=facebook</code> to the link to see which channel an enquiry came from.
            </p>
            <Input readOnly value={link} className="text-xs" onFocus={(e) => e.target.select()} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={copyLink}><Copy className="h-4 w-4 me-1.5" />Copy link</Button>
              {qr && <Button size="sm" variant="outline" asChild><a href={qr} download="enquiry-form-qr.png"><Download className="h-4 w-4 me-1.5" />Download QR</a></Button>}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">{visible.length} {visible.length === 1 ? "enquiry" : "enquiries"}</p>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as EnquiryStatus | "all")}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_LABELS) as EnquiryStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive">Couldn't load enquiries: {(error as Error).message}</p>}
      {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
      {!isLoading && !error && visible.length === 0 && (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          <Inbox className="h-8 w-8 mx-auto mb-2 text-slate-400" />
          {enquiries.length === 0 ? "No enquiries yet. Share the form above to start collecting them." : "No enquiries match this filter."}
        </CardContent></Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((e) => (
          <Card key={e.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm break-words">{e.student_name}{e.grade_interested ? ` · ${e.grade_interested}` : ""}</p>
                  <p className="text-xs text-muted-foreground break-words">{e.parent_name}</p>
                </div>
                <Badge variant="outline" className={`shrink-0 ${STATUS_STYLE[e.status]}`}>{STATUS_LABELS[e.status]}</Badge>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <a className="inline-flex items-center gap-1 text-primary" href={`tel:${e.parent_phone}`}><Phone className="h-3 w-3" />{e.parent_phone}</a>
                {e.parent_email && <a className="inline-flex items-center gap-1 text-primary break-all" href={`mailto:${e.parent_email}`}><Mail className="h-3 w-3 shrink-0" />{e.parent_email}</a>}
              </div>
              {e.message && <p className="text-xs whitespace-pre-wrap break-words rounded bg-muted p-2">{e.message}</p>}
              <p className="text-[11px] text-muted-foreground">{new Date(e.created_at).toLocaleString(displayLocale())} · from {e.source_channel}</p>
              <Input key={e.staff_notes ?? ""} defaultValue={e.staff_notes ?? ""} placeholder="Add a note (saved when you click away)" className="h-8 text-xs"
                onBlur={(ev) => { if (ev.target.value !== (e.staff_notes ?? "")) void update(e.id, { staff_notes: ev.target.value || null }); }} />
              <div className="flex flex-wrap gap-2">
                <Select value={e.status} onValueChange={(v) => void update(e.id, { status: v })} disabled={e.status === "converted"}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="contacted">Contacted</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    {e.status === "converted" && <SelectItem value="converted">Converted</SelectItem>}
                  </SelectContent>
                </Select>
                {e.status !== "converted" && (
                  <Button size="sm" className="h-8" onClick={() => setConverting(e)}><UserPlus className="h-4 w-4 me-1.5" />Convert to applicant</Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ApplicantFormDialog
        intakes={intakes}
        onCreate={onCreateApplicant}
        hideTrigger
        open={!!converting}
        onOpenChange={(next) => { if (!next) setConverting(null); }}
        prefill={prefill}
        onCreated={async (applicantId) => {
          if (converting) await update(converting.id, { status: "converted", converted_applicant_id: applicantId });
          onConverted();
        }}
      />
    </div>
  );
}
