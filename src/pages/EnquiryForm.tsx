// src/pages/EnquiryForm.tsx  (public route /enquiry/:schoolId, no login)
//
// The form a school shares with interested parents. Add ?src=facebook (or any label) to a link to see where enquiries
// come from. The server validates everything and throttles abuse: see migration 20261106020000.

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, GraduationCap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { localizeServerMessage } from "@/lib/serverMessages";

// deno-lint-ignore no-explicit-any
const db = supabase as any;

function detectSource(srcParam: string | null): string {
  if (srcParam?.trim()) return srcParam.trim();
  try {
    if (document.referrer) return new URL(document.referrer).hostname;
  } catch { /* a malformed referrer just means we don't know the source */ }
  return "web_form";
}

const shell = "min-h-screen bg-gradient-to-b from-indigo-50 to-white px-4 py-8 flex justify-center";

export default function EnquiryForm() {
  const { schoolId } = useParams();
  const [searchParams] = useSearchParams();
  const [school, setSchool] = useState<{ school_name: string; grades: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ student: "", parent: "", phone: "", email: "", grade: "", message: "", website: "" });
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await db.rpc("get_enquiry_form", { p_school: schoolId });
      if (!cancelled) { setSchool(data ?? null); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [schoolId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: rpcError } = await db.rpc("submit_admission_enquiry", {
      p_school: schoolId,
      p_student_name: form.student,
      p_parent_name: form.parent,
      p_parent_phone: form.phone,
      p_parent_email: form.email || null,
      p_grade: form.grade || null,
      p_message: form.message || null,
      p_source: detectSource(searchParams.get("src")),
      p_website: form.website || null,
    });
    setSubmitting(false);
    if (rpcError) { setError(localizeServerMessage(rpcError.message)); return; }
    setDone(true);
  };

  if (loading) {
    return <div className={shell}><Loader2 className="h-6 w-6 animate-spin text-indigo-600 mt-24" /></div>;
  }
  if (!school) {
    return <div className={shell}><p className="text-sm text-muted-foreground mt-24">This enquiry link is not valid. Please ask the school for a new one.</p></div>;
  }
  if (done) {
    return (
      <div className={shell}>
        <Card className="w-full max-w-lg self-start">
          <CardContent className="py-12 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto" />
            <h1 className="text-xl font-bold">Thank you!</h1>
            <p className="text-sm text-muted-foreground">{school.school_name} has received your enquiry and will contact you soon.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={shell}>
      <Card className="w-full max-w-lg self-start overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-5 flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0"><GraduationCap className="h-5 w-5 text-white" /></div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white break-words">{school.school_name}</h1>
            <p className="text-indigo-100 text-xs">Admission enquiry</p>
          </div>
        </div>
        <CardContent className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="enq-student">Student's name <span className="text-red-500">*</span></Label>
              <Input id="enq-student" required maxLength={120} value={form.student} onChange={(e) => set("student", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enq-parent">Parent's name <span className="text-red-500">*</span></Label>
              <Input id="enq-parent" required maxLength={120} autoComplete="name" value={form.parent} onChange={(e) => set("parent", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enq-phone">Phone number <span className="text-red-500">*</span></Label>
              <Input id="enq-phone" required type="tel" maxLength={20} autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enq-email">Email</Label>
              <Input id="enq-email" type="email" maxLength={200} autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enq-grade">Grade you're interested in</Label>
              {school.grades.length > 0 ? (
                <Select value={form.grade} onValueChange={(v) => set("grade", v)}>
                  <SelectTrigger id="enq-grade"><SelectValue placeholder="Choose a grade" /></SelectTrigger>
                  <SelectContent>{school.grades.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input id="enq-grade" maxLength={60} value={form.grade} onChange={(e) => set("grade", e.target.value)} />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enq-message">Message</Label>
              <Textarea id="enq-message" rows={3} maxLength={1000} value={form.message} onChange={(e) => set("message", e.target.value)} placeholder="Anything you'd like the school to know" />
            </div>
            {/* Honeypot: invisible to people, tempting to bots. Anything typed here means the enquiry is dropped. */}
            <div className="absolute -start-[9999px] h-0 overflow-hidden" aria-hidden="true">
              <label htmlFor="enq-website">Website</label>
              <input id="enq-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting && <Loader2 className="h-4 w-4 animate-spin me-1.5" />}
              Send enquiry
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
