import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { signOutUserEverywhere } from "@/lib/sessionManagement";
import { useToast } from "@/hooks/use-toast";
import {
  getSecurityOverview, updateSecurityAlert,
  type AlertSeverity, type AlertStatus, type SecurityAlert,
} from "@/lib/securityEvents";

const SEVERITY_STYLE: Record<AlertSeverity, string> = {
  critical: "bg-red-600 text-white hover:bg-red-600",
  high: "bg-orange-500 text-white hover:bg-orange-500",
  medium: "bg-amber-400 text-black hover:bg-amber-400",
  low: "bg-slate-200 text-slate-800 hover:bg-slate-200",
};

const RULE_LABEL: Record<string, string> = {
  brute_force: "Repeated failed logins",
  password_spray: "Many accounts, one address",
  success_after_failures: "Success after failures",
  new_device_and_network: "New device + network",
  odd_hours_login: "Unusual hour",
  rapid_network_change: "Several networks",
  bulk_export: "Many exports",
  large_export: "Large export",
  mass_record_access: "Mass record access",
};

const STATUS_FILTERS: { value: AlertStatus | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
  { value: "false_positive", label: "False positive" },
  { value: "all", label: "All" },
];

function evidenceLines(a: SecurityAlert): string[] {
  const e = a.evidence ?? {};
  const out: string[] = [];
  if (e.ip) out.push(`Address ${e.ip}`);
  if (Array.isArray(e.ips) && e.ips.length) out.push(`Addresses ${e.ips.join(", ")}`);
  if (Array.isArray(e.networks) && e.networks.length) out.push(`Networks ${e.networks.join(", ")}`);
  if (e.device) out.push(`Device ${String(e.device).replace("|", " on ")}`);
  if (Array.isArray(e.resources) && e.resources.length) out.push(`Data ${e.resources.join(", ")}`);
  if (e.resource) out.push(`Data ${e.resource}`);
  return out;
}

/**
 * Anomaly alerts + real sign-in activity. `schoolId` scopes a platform admin to one school; school staff are
 * always pinned to their own school by the server regardless of what is passed here.
 */
export function SecurityAnomalyPanel({ schoolId }: { schoolId?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<AlertStatus | "all">("open");
  const key = ["security-overview", schoolId ?? "own", status];

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: key,
    queryFn: () => getSecurityOverview({ schoolId, status: status === "all" ? undefined : status }),
    staleTime: 60_000,
  });

  const review = useMutation({
    mutationFn: ({ id, next }: { id: string; next: AlertStatus }) => updateSecurityAlert(id, next),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["security-overview"] }); },
    onError: (e: Error) => toast({ title: "Could not update alert", description: e.message, variant: "destructive" }),
  });

  const signOutUser = useMutation({
    mutationFn: (a: SecurityAlert) => signOutUserEverywhere(a.user_id!, `Security alert: ${a.rule}`),
    onSuccess: (r) => toast({ title: r.revoked ? `Signed the account out of ${r.revoked} device${r.revoked === 1 ? "" : "s"}` : "That account had no active devices" }),
    onError: (e: Error) => toast({ title: "Could not sign the account out", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (isError) return <Card><CardContent className="py-8 text-center text-destructive">{(error as Error).message}</CardContent></Card>;
  if (data?.persistence === "unavailable") {
    return (
      <Card><CardContent className="py-10 text-center text-muted-foreground">
        Anomaly detection isn't switched on for this project yet. Apply the <code>20261017000000_security_anomaly_detection</code> database migration to enable it.
      </CardContent></Card>
    );
  }

  const s = data?.summary;
  const alerts = data?.alerts ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4"><p className="text-2xl font-bold">{s?.open ?? 0}</p><p className="text-xs text-muted-foreground">Open alerts</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-2xl font-bold text-red-600">{(s?.open_by_severity.critical ?? 0) + (s?.open_by_severity.high ?? 0)}</p><p className="text-xs text-muted-foreground">High / critical</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-2xl font-bold">{s?.failed_logins_24h ?? 0}<span className="text-sm font-normal text-muted-foreground"> / {s?.logins_24h ?? 0}</span></p><p className="text-xs text-muted-foreground">Failed / successful logins (24h)</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-2xl font-bold">{s?.exports_24h ?? 0}</p><p className="text-xs text-muted-foreground">Data exports (24h)</p></CardContent></Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button key={f.value} size="sm" variant={status === f.value ? "default" : "outline"} onClick={() => setStatus(f.value)}>{f.label}</Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />Scan now
        </Button>
      </div>

      {alerts.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground flex flex-col items-center gap-2">
          <ShieldCheck className="h-8 w-8 text-green-600" />
          {status === "open" ? "No open alerts. Nothing unusual in recent login and data-access activity." : "No alerts with this status."}
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <Card key={a.id} className={a.status === "open" && (a.severity === "critical" || a.severity === "high") ? "border-red-300" : ""}>
              <CardContent className="pt-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={SEVERITY_STYLE[a.severity]}>{a.severity}</Badge>
                  <Badge variant="outline">{RULE_LABEL[a.rule] ?? a.rule}</Badge>
                  {a.status !== "open" && <Badge variant="secondary" className="capitalize">{a.status.replace("_", " ")}</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{format(new Date(a.detected_at), "MMM d, h:mm a")}</span>
                </div>
                <p className="font-medium flex items-center gap-1.5"><ShieldAlert className="h-4 w-4 text-orange-500" />{a.title}</p>
                <p className="text-sm">{a.detail}</p>
                <p className="text-xs text-muted-foreground">
                  {a.user_name ? `${a.user_name}${a.user_role ? ` (${a.user_role})` : ""}` : "Account not signed in"}
                  {evidenceLines(a).length ? ` · ${evidenceLines(a).join(" · ")}` : ""}
                </p>
                {a.status === "open" ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ id: a.id, next: "acknowledged" })}>Acknowledge</Button>
                    <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: a.id, next: "resolved" })}><CheckCircle2 className="h-4 w-4 mr-1" />Resolve</Button>
                    <Button size="sm" variant="ghost" disabled={review.isPending} onClick={() => review.mutate({ id: a.id, next: "false_positive" })}>False positive</Button>
                    {a.user_id && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-200" disabled={signOutUser.isPending}>Sign out everywhere</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Sign {a.user_name ?? "this account"} out of every device?</AlertDialogTitle>
                            <AlertDialogDescription>All of their logins end within a few minutes and they must sign in again. Use this if you think the account is compromised.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => signOutUser.mutate(a)}>Sign out everywhere</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" disabled={review.isPending} onClick={() => review.mutate({ id: a.id, next: "open" })}>Reopen</Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500" />Recent sign-in activity</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data?.recent_logins?.length ? (
            <Table>
              <TableHeader><TableRow><TableHead>Result</TableHead><TableHead>Who</TableHead><TableHead>Address</TableHead><TableHead>Device</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.recent_logins.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell><Badge variant={l.event_type === "login_failed" ? "destructive" : "outline"}>{l.event_type === "login_failed" ? "Failed" : "Success"}</Badge></TableCell>
                    <TableCell className="text-sm">{l.user_name ?? l.metadata?.identifier_hint ?? "—"}{l.role ? <span className="text-muted-foreground"> · {l.role}</span> : null}</TableCell>
                    <TableCell className="text-sm font-mono">{l.ip_address ?? "—"}</TableCell>
                    <TableCell className="text-sm">{l.device_key?.replace("|", " on ") ?? "—"}</TableCell>
                    <TableCell className="text-sm">{format(new Date(l.created_at), "MMM d, h:mm a")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="py-8 text-center text-sm text-muted-foreground">No sign-ins recorded yet. They appear here as people log in.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
