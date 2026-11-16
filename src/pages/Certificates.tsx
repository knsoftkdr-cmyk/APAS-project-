// src/pages/Certificates.tsx  (route /certificates: admin, principal, hod, school_admin)
//
// Templates (visual designer) · Issue (bulk, showing who qualifies) · Issued (download, revoke, verification link).
// The conditions are enforced by issue_certificates on the server: this page only shows the same answer in advance.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Award, Ban, Copy, Download, Loader2, Pencil, Plus, Search, Send, Zap } from "lucide-react";
import { toast } from "sonner";
import { CertificateDesigner, type CertificateTemplate } from "@/components/certificates/CertificateDesigner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { displayLocale } from "@/i18n/runtime";
import { supabase } from "@/integrations/supabase/client";
import { downloadCertificatesPdf, safeFileName, type IssuedCertificateRow } from "@/lib/certificates";
import { certificateVerifyUrl } from "@/lib/publicUrl";
import { cn } from "@/lib/utils";
import { localizeServerMessage } from "@/lib/serverMessages";

// deno-lint-ignore no-explicit-any
const db = supabase as any;

type Tab = "templates" | "issue" | "issued";

interface Candidate {
  student_id: string;
  full_name: string;
  class_label: string | null;
  block_reason: string | null;
  already_issued: boolean;
}

const criteriaLabel = (t: CertificateTemplate) =>
  t.criteria_type === "manual" ? "No condition" : t.criteria_type === "course_completion" ? "Course completion" : `Course score ${t.min_score}% or more`;

function TemplatesTab({ templates, loading, onChanged }: { templates: CertificateTemplate[]; loading: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<CertificateTemplate | "new" | null>(null);

  const archive = async (t: CertificateTemplate) => {
    const { error } = await db.from("certificate_templates").update({ is_archived: true, auto_issue: false }).eq("id", t.id);
    if (error) { toast.error(localizeServerMessage(error.message)); return; }
    toast.success("Template archived. Certificates already issued stay valid.");
    onChanged();
  };

  if (editing) {
    return (
      <CertificateDesigner
        key={editing === "new" ? "new" : editing.id}
        template={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); onChanged(); }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4 me-1.5" />New template</Button>
      {loading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
      {!loading && templates.length === 0 && <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No templates yet. Create one to start issuing certificates.</CardContent></Card>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {templates.map((t) => (
          <Card key={t.id}>
            <CardContent className="p-4 space-y-2">
              <p className="font-semibold text-sm break-words">{t.name}</p>
              <p className="text-xs text-muted-foreground break-words">{t.certificate_title}</p>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">{criteriaLabel(t)}</Badge>
                {t.auto_issue && <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200"><Zap className="h-3 w-3 me-1" />Automatic</Badge>}
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(t)}><Pencil className="h-4 w-4 me-1.5" />Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => archive(t)}><Archive className="h-4 w-4 me-1.5" />Archive</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function IssueTab({ templates, onIssued }: { templates: CertificateTemplate[]; onIssued: () => void }) {
  const queryClient = useQueryClient();
  const [templateId, setTemplateId] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [issuing, setIssuing] = useState(false);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ["certificate-candidates", templateId],
    enabled: !!templateId,
    queryFn: async () => {
      const { data, error } = await db.rpc("certificate_candidates", { p_template: templateId });
      if (error) throw error;
      return data as Candidate[];
    },
  });

  const classes = useMemo(() => [...new Set(candidates.map((c) => c.class_label).filter(Boolean) as string[])].sort(), [candidates]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((c) => (classFilter === "all" || c.class_label === classFilter) && (!q || c.full_name.toLowerCase().includes(q)));
  }, [candidates, classFilter, search]);
  const pickable = visible.filter((c) => !c.block_reason && !c.already_issued);

  const toggle = (id: string, on: boolean) => setPicked((p) => {
    const next = new Set(p);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const issue = async () => {
    setIssuing(true);
    const { data, error } = await db.rpc("issue_certificates", { p_template: templateId, p_students: [...picked] });
    setIssuing(false);
    if (error) { toast.error(localizeServerMessage(error.message)); return; }
    const blocked = (data.blocked ?? []).length;
    toast.success(`Issued ${data.issued} certificate${data.issued === 1 ? "" : "s"}${data.already_issued ? `, ${data.already_issued} already had one` : ""}${blocked ? `, ${blocked} no longer qualified` : ""}`);
    setPicked(new Set());
    queryClient.invalidateQueries({ queryKey: ["certificate-candidates", templateId] });
    onIssued();
  };

  return (
    <div className="space-y-3">
      <Select value={templateId} onValueChange={(v) => { setTemplateId(v); setPicked(new Set()); setClassFilter("all"); }}>
        <SelectTrigger className="sm:max-w-md"><SelectValue placeholder="Choose a template" /></SelectTrigger>
        <SelectContent>
          {templates.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Create a template first</div>}
          {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
        </SelectContent>
      </Select>

      {templateId && (
        <>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search students" className="ps-9" />
            </div>
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All classes</SelectItem>
                {classes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={pickable.length === 0} onClick={() => setPicked((p) => new Set([...p, ...pickable.map((c) => c.student_id)]))}>
              Select all who qualify ({pickable.length})
            </Button>
            <Button size="sm" variant="ghost" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>Clear</Button>
            <Button size="sm" className="sm:ms-auto" disabled={picked.size === 0 || issuing} onClick={issue}>
              {issuing ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <Send className="h-4 w-4 me-1.5" />}
              Issue to {picked.size} student{picked.size === 1 ? "" : "s"}
            </Button>
          </div>
          {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          <div className="rounded-lg border divide-y bg-card">
            {!isLoading && visible.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No students found.</p>}
            {visible.map((c) => {
              const disabled = !!c.block_reason || c.already_issued;
              return (
                <label key={c.student_id} className={cn("flex items-center gap-3 p-3 text-sm", disabled ? "opacity-70" : "cursor-pointer hover:bg-accent/40")}>
                  <Checkbox checked={picked.has(c.student_id)} disabled={disabled} onCheckedChange={(v) => toggle(c.student_id, v === true)} />
                  <span className="min-w-0 flex-1 break-words">{c.full_name}{c.class_label && <span className="text-xs text-muted-foreground"> · {c.class_label}</span>}</span>
                  {c.already_issued
                    ? <Badge variant="outline" className="shrink-0 bg-emerald-50 text-emerald-700 border-emerald-200">Issued</Badge>
                    : c.block_reason && <Badge variant="outline" className="shrink-0 bg-amber-50 text-amber-800 border-amber-200">{localizeServerMessage(c.block_reason)}</Badge>}
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function IssuedTab({ schoolId }: { schoolId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<IssuedCertificateRow | null>(null);
  const [reason, setReason] = useState("");

  const { data: issued = [], isLoading, error } = useQuery({
    queryKey: ["issued-certificates", schoolId],
    queryFn: async () => {
      const { data, error } = await db.from("issued_certificates").select("*").eq("school_id", schoolId).order("issued_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return data as IssuedCertificateRow[];
    },
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issued.filter((c) => !q || [c.recipient_name, c.certificate_title, c.verification_code, c.class_label ?? ""].some((v) => v.toLowerCase().includes(q)));
  }, [issued, search]);

  const download = async (rows: IssuedCertificateRow[], fileName: string) => {
    setProgress("Preparing...");
    try {
      const ids = [...new Set(rows.map((r) => r.template_id))];
      const { data, error } = await db.from("certificate_templates").select("id, background_image").in("id", ids);
      if (error) throw error;
      const backgrounds = new Map<string, string | null>((data ?? []).map((t: { id: string; background_image: string | null }) => [t.id, t.background_image]));
      await downloadCertificatesPdf(rows, backgrounds, fileName, (done, total) => setProgress(`${done} of ${total}`));
    } catch (e) {
      toast.error(e instanceof Error ? localizeServerMessage(e.message) : "Couldn't create the PDF.");
    } finally {
      setProgress(null);
    }
  };

  const copyVerifyLink = async (c: IssuedCertificateRow) => {
    try {
      await navigator.clipboard.writeText(certificateVerifyUrl(c.verification_code));
      toast.success("Verification link copied");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    const { error } = await db.rpc("revoke_certificate", { p_certificate: revoking.id, p_reason: reason });
    if (error) { toast.error(localizeServerMessage(error.message)); return; }
    toast.success("Certificate revoked. Its QR code now shows it as revoked.");
    setRevoking(null);
    setReason("");
    queryClient.invalidateQueries({ queryKey: ["issued-certificates", schoolId] });
  };

  const live = visible.filter((c) => !c.revoked_at);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by student, certificate or code" className="ps-9" />
        </div>
        <Button variant="outline" disabled={live.length === 0 || !!progress} onClick={() => download(live, "certificates.pdf")}>
          {progress ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <Download className="h-4 w-4 me-1.5" />}
          {progress ?? `Download all (${live.length})`}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">Couldn't load certificates: {(error as Error).message}</p>}
      {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
      <div className="rounded-lg border divide-y bg-card">
        {!isLoading && visible.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No certificates issued yet.</p>}
        {visible.map((c) => (
          <div key={c.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium break-words">{c.recipient_name}{c.class_label && <span className="text-xs text-muted-foreground font-normal"> · {c.class_label}</span>}</p>
              <p className="text-xs text-muted-foreground break-words">{c.certificate_title} · {new Date(c.issued_at).toLocaleDateString(displayLocale())} · {c.verification_code}</p>
              {c.revoked_at && <p className="text-xs text-destructive break-words">Revoked: {c.revoked_reason}</p>}
            </div>
            {!c.revoked_at && (
              <div className="flex flex-wrap gap-1 shrink-0">
                <Button size="sm" variant="outline" disabled={!!progress} onClick={() => download([c], `${safeFileName(c.recipient_name)}.pdf`)}><Download className="h-4 w-4 me-1.5" />PDF</Button>
                <Button size="sm" variant="ghost" onClick={() => copyVerifyLink(c)}><Copy className="h-4 w-4 me-1.5" />Link</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRevoking(c)}><Ban className="h-4 w-4 me-1.5" />Revoke</Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!revoking} onOpenChange={(o) => { if (!o) { setRevoking(null); setReason(""); } }}>
        <DialogContent className="sm:max-w-md w-[calc(100%-2rem)]">
          <DialogHeader><DialogTitle>Revoke this certificate?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{revoking?.recipient_name}'s certificate will show as revoked when anyone scans its QR code, and they can no longer download it. This can't be undone, but you can issue a new one.</p>
          <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, kept for your records" aria-label="Reason" />
          <Button variant="destructive" disabled={!reason.trim()} onClick={revoke}>Revoke certificate</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const TABS: { key: Tab; label: string }[] = [
  { key: "templates", label: "Templates" },
  { key: "issue", label: "Issue" },
  { key: "issued", label: "Issued" },
];

export default function Certificates() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("templates");
  const schoolId = profile?.school_id ?? null;

  const { data: templates = [], isLoading, error } = useQuery({
    queryKey: ["certificate-templates", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await db.from("certificate_templates").select("*").eq("school_id", schoolId).eq("is_archived", false).order("created_at", { ascending: false });
      if (error) throw error;
      return data as CertificateTemplate[];
    },
  });

  return (
    <AppLayout>
      <div className="p-3 sm:p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
        <div className="rounded-2xl p-5 bg-gradient-to-r from-amber-500 to-orange-600 shadow-lg flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0"><Award className="h-5 w-5 text-white" /></div>
          <div>
            <h1 className="text-xl font-bold text-white">Certificates</h1>
            <p className="text-amber-50 text-xs mt-0.5">Design certificates, issue them in bulk and let anyone verify them by QR code.</p>
          </div>
        </div>

        <div role="tablist" aria-label="Certificates" className="flex w-full gap-1 rounded-xl bg-muted p-1 sm:inline-flex sm:w-auto">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={cn("flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-none", tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>

        {!schoolId && <p className="text-sm text-muted-foreground">Your profile has no school, so certificates aren't available.</p>}
        {error && <p className="text-sm text-destructive">Couldn't load templates: {(error as Error).message}</p>}
        {schoolId && tab === "templates" && <TemplatesTab templates={templates} loading={isLoading} onChanged={() => queryClient.invalidateQueries({ queryKey: ["certificate-templates", schoolId] })} />}
        {schoolId && tab === "issue" && <IssueTab templates={templates} onIssued={() => queryClient.invalidateQueries({ queryKey: ["issued-certificates", schoolId] })} />}
        {schoolId && tab === "issued" && <IssuedTab schoolId={schoolId} />}
      </div>
    </AppLayout>
  );
}
