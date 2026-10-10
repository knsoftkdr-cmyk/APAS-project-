import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Laptop, Loader2, LogOut, Monitor, ShieldCheck, Smartphone, Tablet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { listMyDevices, revokeDevice, revokeOtherDevices, type Device } from "@/lib/sessionManagement";

const KIND_ICON: Record<string, typeof Laptop> = { desktop: Monitor, mobile: Smartphone, app: Smartphone, tablet: Tablet };
const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "unknown");

/** Everywhere the signed-in person is logged in, with a Sign out button per device. Shown to every role. */
export function MyDevicesPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<Device | "others" | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["my-devices"],
    queryFn: listMyDevices,
    staleTime: 30_000,
  });

  const done = (n: number) => {
    toast({ title: n > 0 ? `Signed out ${n} device${n === 1 ? "" : "s"}` : "Nothing to sign out" });
    qc.invalidateQueries({ queryKey: ["my-devices"] });
    setConfirm(null);
  };
  const fail = (e: Error) => { toast({ title: "Could not sign out", description: e.message, variant: "destructive" }); setConfirm(null); };

  const one = useMutation({ mutationFn: (id: string) => revokeDevice(id), onSuccess: (r) => done(r.revoked), onError: fail });
  const others = useMutation({ mutationFn: revokeOtherDevices, onSuccess: (r) => done(r.revoked), onError: fail });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (isError) return <Card><CardContent className="py-8 text-center text-destructive">{(error as Error).message}</CardContent></Card>;
  if (data?.persistence === "unavailable") {
    return (
      <Card><CardContent className="py-10 text-center text-muted-foreground">
        Device management isn't switched on for this project yet. Apply the <code>20261018000000_session_device_management</code> database migration to enable it.
      </CardContent></Card>
    );
  }

  const devices = data?.devices ?? [];
  const otherCount = devices.filter((d) => !d.current).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {devices.length} active {devices.length === 1 ? "device" : "devices"}. If you don't recognise one, sign it out and change your password.
        </p>
        <Button variant="outline" size="sm" disabled={otherCount === 0 || others.isPending} onClick={() => setConfirm("others")}>
          <LogOut className="h-4 w-4 mr-1.5" />Sign out all other devices
        </Button>
      </div>

      {devices.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground flex flex-col items-center gap-2">
          <ShieldCheck className="h-8 w-8 text-green-600" />No active devices found.
        </CardContent></Card>
      ) : devices.map((d) => {
        const Icon = KIND_ICON[d.kind ?? "desktop"] ?? Laptop;
        return (
          <Card key={d.session_id} className={d.current ? "border-blue-300" : ""}>
            <CardContent className="pt-4 flex items-center gap-4">
              <Icon className="h-8 w-8 text-slate-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium flex flex-wrap items-center gap-2">
                  {d.label}
                  {d.current && <Badge className="bg-blue-600 hover:bg-blue-600">This device</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  Last active {d.current ? "now" : ago(d.last_seen)} · Signed in {ago(d.first_seen)}
                  {d.ip_address ? ` · ${d.ip_address}` : ""}
                </p>
              </div>
              {!d.current && (
                <Button variant="outline" size="sm" disabled={one.isPending} onClick={() => setConfirm(d)}>Sign out</Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "others" ? "Sign out all other devices?" : `Sign out ${(confirm as Device | null)?.label ?? "this device"}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "others"
                ? "Every device except this one will be signed out. They will need to log in again."
                : "That device will be signed out within a few minutes and will need to log in again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => (confirm === "others" ? others.mutate() : confirm && one.mutate((confirm as Device).session_id))}>
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
