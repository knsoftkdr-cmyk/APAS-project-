// src/pages/VerifyCertificate.tsx  (public routes /verify-certificate and /verify-certificate/:code, no login)
//
// Where a certificate's QR code leads. Shows only what is already printed on the certificate, and whether it's valid.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, SearchCheck, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { displayLocale } from "@/i18n/runtime";

// deno-lint-ignore no-explicit-any
const db = supabase as any;

interface VerifyResult {
  recipient_name: string;
  certificate_title: string;
  school_name: string | null;
  course_name: string | null;
  issued_at: string;
  is_valid: boolean;
  revoked_at: string | null;
}

type State = { kind: "idle" } | { kind: "loading" } | { kind: "found"; result: VerifyResult } | { kind: "missing" } | { kind: "error" };

const longDate = (iso: string) => new Date(iso).toLocaleDateString(displayLocale(), { day: "numeric", month: "long", year: "numeric" });

export default function VerifyCertificate() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(code ?? "");
  const [state, setState] = useState<State>({ kind: code ? "loading" : "idle" });

  const check = useCallback(async (value: string) => {
    setState({ kind: "loading" });
    const { data, error } = await db.rpc("verify_certificate", { p_code: value });
    if (error) setState({ kind: "error" });
    else if (!data) setState({ kind: "missing" });
    else setState({ kind: "found", result: data as VerifyResult });
  }, []);

  useEffect(() => { if (code) { setInput(code); void check(code); } }, [code, check]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = input.trim();
    if (value) navigate(`/verify-certificate/${encodeURIComponent(value)}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white px-4 py-8 flex justify-center">
      <div className="w-full max-w-lg space-y-4">
        <div className="text-center space-y-1">
          <SearchCheck className="h-10 w-10 text-indigo-600 mx-auto" />
          <h1 className="text-xl font-bold">Verify a certificate</h1>
          <p className="text-sm text-muted-foreground">Scan the QR code on the certificate, or type its verification code.</p>
        </div>

        <form onSubmit={submit} className="flex gap-2">
          <Input value={input} maxLength={40} aria-label="Verification code" placeholder="Verification code" onChange={(e) => setInput(e.target.value)} />
          <Button type="submit" disabled={!input.trim()}>Verify</Button>
        </form>

        {state.kind === "loading" && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-indigo-600" /></div>}
        {state.kind === "error" && <p role="alert" className="text-sm text-destructive text-center">Couldn't check right now. Please try again.</p>}
        {state.kind === "missing" && (
          <Card className="border-red-200"><CardContent className="py-8 text-center space-y-2">
            <ShieldX className="h-10 w-10 text-red-600 mx-auto" />
            <p className="font-semibold">No certificate found</p>
            <p className="text-sm text-muted-foreground">This code doesn't match any certificate. Please check it and try again.</p>
          </CardContent></Card>
        )}
        {state.kind === "found" && (
          <Card className={state.result.is_valid ? "border-emerald-300" : "border-amber-300"}>
            <CardContent className="py-6 space-y-4">
              <div className="text-center space-y-1">
                {state.result.is_valid
                  ? <><ShieldCheck className="h-10 w-10 text-emerald-600 mx-auto" /><p className="font-semibold text-emerald-700">Valid certificate</p></>
                  : <><ShieldAlert className="h-10 w-10 text-amber-600 mx-auto" /><p className="font-semibold text-amber-700">This certificate was revoked</p>{state.result.revoked_at && <p className="text-sm text-amber-700">Revoked on {longDate(state.result.revoked_at)}</p>}</>}
              </div>
              <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">Awarded to</dt><dd className="font-medium break-words">{state.result.recipient_name}</dd>
                <dt className="text-muted-foreground">Certificate</dt><dd className="break-words">{state.result.certificate_title}</dd>
                {state.result.course_name && <><dt className="text-muted-foreground">Course</dt><dd className="break-words">{state.result.course_name}</dd></>}
                {state.result.school_name && <><dt className="text-muted-foreground">Issued by</dt><dd className="break-words">{state.result.school_name}</dd></>}
                <dt className="text-muted-foreground">Issued on</dt><dd>{longDate(state.result.issued_at)}</dd>
              </dl>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
