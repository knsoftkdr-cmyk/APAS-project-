import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Alert {
  id: string;
  student_group: string | null;
  lesson_type: string | null;
  trigger_condition: string | null;
  fail_rate: number | null;
  recommendation: string | null;
  status: string;
  created_at: string;
}

interface NotificationContextType {
  alerts: Alert[];
  unreadCount: number;
  markAsRead: (alertId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refreshAlerts: () => Promise<void>;
  readAlertIds: Set<string>;
}

const NotificationContext = createContext<NotificationContextType>({
  alerts: [],
  unreadCount: 0,
  markAsRead: async () => {},
  markAllAsRead: async () => {},
  refreshAlerts: async () => {},
  readAlertIds: new Set(),
});

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [readAlertIds, setReadAlertIds] = useState<Set<string>>(new Set());

  const fetchAlerts = useCallback(async () => {
    const { data } = await supabase
      .from("mismatch_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setAlerts(data);
  }, []);

  const fetchReadIds = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("alert_reads")
      .select("alert_id")
      .eq("user_id", user.id);
    if (data) setReadAlertIds(new Set(data.map((r: any) => r.alert_id)));
  }, [user]);

  const refreshAlerts = useCallback(async () => {
    await Promise.all([fetchAlerts(), fetchReadIds()]);
  }, [fetchAlerts, fetchReadIds]);

  useEffect(() => {
    if (!user) return;
    refreshAlerts();

    const channel = supabase
      .channel("mismatch_alerts_realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mismatch_alerts" },
        (payload) => {
          const newAlert = payload.new as Alert;
          setAlerts((prev) => [newAlert, ...prev].slice(0, 50));
          if (newAlert.status === "flagged") {
            toast.warning(
              `New mismatch: ${newAlert.student_group || "Unknown"} — ${newAlert.lesson_type || "Unknown"}`,
              { duration: 5000 }
            );
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "mismatch_alerts" },
        (payload) => {
          const updated = payload.new as Alert;
          setAlerts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, refreshAlerts]);

  const unreadCount = alerts.filter((a) => a.status === "flagged" && !readAlertIds.has(a.id)).length;

  const markAsRead = async (alertId: string) => {
    if (!user || readAlertIds.has(alertId)) return;
    await supabase.from("alert_reads").insert({ user_id: user.id, alert_id: alertId });
    setReadAlertIds((prev) => new Set(prev).add(alertId));
  };

  const markAllAsRead = async () => {
    if (!user) return;
    const unread = alerts.filter((a) => !readAlertIds.has(a.id));
    if (unread.length === 0) return;
    const rows = unread.map((a) => ({ user_id: user.id, alert_id: a.id }));
    await supabase.from("alert_reads").upsert(rows, { onConflict: "user_id,alert_id" });
    setReadAlertIds(new Set(alerts.map((a) => a.id)));
  };

  return (
    <NotificationContext.Provider value={{ alerts, unreadCount, markAsRead, markAllAsRead, refreshAlerts, readAlertIds }}>
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
