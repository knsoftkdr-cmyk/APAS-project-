import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface GovernanceNotification {
  id: string;
  user_id: string;
  event_type: string;
  title: string;
  message: string;
  reference_id: string | null;
  reference_type: string | null;
  channel: string;
  is_read: boolean;
  created_at: string;
}

interface GovernanceNotificationContextType {
  notifications: GovernanceNotification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

const GovernanceNotificationContext = createContext<GovernanceNotificationContextType>({
  notifications: [],
  unreadCount: 0,
  markAsRead: async () => {},
  markAllAsRead: async () => {},
  refresh: async () => {},
});

export function GovernanceNotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<GovernanceNotification[]>([]);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("governance_notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setNotifications(data as GovernanceNotification[]);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchNotifications();

    const channel = supabase
      .channel("governance_notifications_realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "governance_notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as GovernanceNotification;
          setNotifications((prev) => [n, ...prev].slice(0, 50));
          toast.info(n.title, { description: n.message, duration: 5000 });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, fetchNotifications]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markAsRead = async (id: string) => {
    await supabase.from("governance_notifications").update({ is_read: true } as any).eq("id", id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const markAllAsRead = async () => {
    if (!user) return;
    const unread = notifications.filter((n) => !n.is_read);
    for (const n of unread) {
      await supabase.from("governance_notifications").update({ is_read: true } as any).eq("id", n.id);
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  return (
    <GovernanceNotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllAsRead, refresh: fetchNotifications }}>
      {children}
    </GovernanceNotificationContext.Provider>
  );
}

export const useGovernanceNotifications = () => useContext(GovernanceNotificationContext);
