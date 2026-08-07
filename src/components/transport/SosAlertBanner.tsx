import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { AlertTriangle, MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface SosAlertRow {
  id: string;
  driver_id: string;
  vehicle_id: string | null;
  route_id: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  created_at: string;
}

interface SosAlertWithDriver extends SosAlertRow {
  driver_name: string | null;
}

export function SosAlertBanner() {
  const { profile } = useAuth();
  const schoolId = profile?.school_id as string | undefined;
  const [alerts, setAlerts] = useState<SosAlertWithDriver[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const attachDriverNames = async (rows: SosAlertRow[]): Promise<SosAlertWithDriver[]> => {
    const driverIds = Array.from(new Set(rows.map((r) => r.driver_id)));
    if (driverIds.length === 0) return rows.map((r) => ({ ...r, driver_name: null }));
    const { data: drivers } = await supabase
      .from("drivers")
      .select("id, name")
      .in("id", driverIds);
    const nameById = new Map((drivers || []).map((d: any) => [d.id, d.name]));
    return rows.map((r) => ({ ...r, driver_name: nameById.get(r.driver_id) || null }));
  };

  const fetchActiveAlerts = async () => {
    if (!schoolId) return;
    const { data, error } = await supabase
      .from("sos_alerts")
      .select("id, driver_id, vehicle_id, route_id, latitude, longitude, status, created_at")
      .eq("school_id", schoolId)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("[SOS BANNER] failed to load active alerts", error);
      return;
    }
    const withNames = await attachDriverNames((data || []) as SosAlertRow[]);
    setAlerts(withNames);
  };

  useEffect(() => {
    if (!schoolId) return;
    fetchActiveAlerts();

    const channel = supabase
      .channel(`sos-alerts-${schoolId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sos_alerts", filter: `school_id=eq.${schoolId}` },
        async (payload) => {
          const row = payload.new as SosAlertRow;
          if (row.status !== "active") return;
          const [withName] = await attachDriverNames([row]);
          setAlerts((prev) => [withName, ...prev.filter((a) => a.id !== row.id)]);
          toast.error(`SOS: ${withName.driver_name || "A driver"} triggered an emergency alert`, {
            duration: 10000,
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sos_alerts", filter: `school_id=eq.${schoolId}` },
        (payload) => {
          const row = payload.new as SosAlertRow;
          if (row.status !== "active") {
            setAlerts((prev) => prev.filter((a) => a.id !== row.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [schoolId]);

  const resolveAlert = async (alertId: string) => {
    if (!profile?.id) return;
    setResolvingId(alertId);
    const { error } = await supabase
      .from("sos_alerts")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: profile.id,
      })
      .eq("id", alertId);
    setResolvingId(null);
    if (error) {
      toast.error("Failed to resolve alert: " + error.message);
      return;
    }
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    toast.success("SOS alert marked resolved.");
  };

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-3">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="rounded-2xl border border-red-300 bg-red-50 p-5 shadow-sm animate-pulse-slow"
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-100 p-2 shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="font-semibold text-red-700">
                  SOS — {alert.driver_name || "Driver"} triggered an emergency alert
                </p>
                <p className="text-sm text-red-600/80 mt-0.5">
                  {new Date(alert.created_at).toLocaleString()}
                </p>
                {alert.latitude != null && alert.longitude != null && (
                  <a
                    href={`https://www.google.com/maps?q=${alert.latitude},${alert.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-red-700 hover:text-red-800 underline mt-1"
                  >
                    <MapPin className="h-3.5 w-3.5" /> View location
                  </a>
                )}
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => resolveAlert(alert.id)}
              disabled={resolvingId === alert.id}
              className="shrink-0"
            >
              {resolvingId === alert.id && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Mark Resolved
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
