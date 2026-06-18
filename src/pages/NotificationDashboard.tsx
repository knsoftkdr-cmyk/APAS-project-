/**
 * NotificationDashboard.tsx — Notification Center for KNSoft Admin
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Bell, CheckCircle, AlertCircle, RefreshCw, Mail, MessageSquare } from "lucide-react";
import notificationbanner from "@/assets/notification-banner.png";
interface Notification {
  id: string;
  title: string;
  message: string;
  event_type: string;
  channel: string;
  is_read: boolean;
  created_at: string;
  user_id: string | null;
  reference_type: string | null;
  reference_id: string | null;
}

export default function NotificationDashboard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("governance_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      setNotifications(data ?? []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const markAllRead = async () => {
    const { error } = await supabase
      .from("governance_notifications")
      .update({ is_read: true })
      .eq("is_read", false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "All notifications marked as read" });
      fetchAll();
    }
  };

  const markRead = async (id: string) => {
    await supabase.from("governance_notifications").update({ is_read: true }).eq("id", id);
    fetchAll();
  };

  const filtered = notifications.filter(n =>
    filter === "all" ? true : filter === "unread" ? !n.is_read : n.is_read
  );

  const unreadCount = notifications.filter(n => !n.is_read).length;

  // Group by event type
  const byType: Record<string, number> = {};
  for (const n of notifications) {
    const t = n.event_type ?? "other";
    byType[t] = (byType[t] ?? 0) + 1;
  }

  // Group by channel
  const byChannel: Record<string, number> = {};
  for (const n of notifications) {
    const c = n.channel ?? "unknown";
    byChannel[c] = (byChannel[c] ?? 0) + 1;
  }

  if (loading) return <AppLayout><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div></AppLayout>;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
<div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-500 via-blue-600 to-blue-500 p-8 text-white mb-6">

  {/* Decorations */}
  <div className="hidden md:block absolute top-6 right-40 w-14 h-14 rounded-full border border-white/60"></div>
  <div className="hidden md:block absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/60"></div>
  <div className="hidden md:block absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/60"></div>

  <div className="hidden md:block absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
  <div className="hidden md:block absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
  <div className="hidden md:block absolute top-24 right-[35%] text-white/80 text-lg">✦</div>

  <div className="hidden md:block absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

  <div className="relative z-10 flex items-center gap-4">
          <div className="h-14 w-14 rounded-xl bg-white/20 flex items-center justify-center">
            <Bell className="h-5 w-5" />
          </div>
    <div>
      <h1 className="text-3xl text-black/80 md:text-4xl font-bold">
        Notification Dashboard
      </h1>

      <p className="text-black/80 mt-1">
        Alerts, announcements, unread messages
      </p>

    </div>

  </div>
          <img
            src={notificationbanner}
            alt="Notification Banner"
            /* className="absolute right-10 bottom-6 h-[160px]" */
            className="hidden md:block absolute right-5 bottom-3 w-[90px] z-10"
          />
</div>

        {/* <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Notification Dashboard</h1>
              <p className="text-sm text-muted-foreground">Alerts, announcements, unread messages</p>
            </div>
          </div> */}
          <div className="flex gap-2">
            <Button variant="outline" onClick={fetchAll} className="gap-1.5"><RefreshCw className="h-4 w-4" /> Refresh</Button>
            {unreadCount > 0 && (
              <Button onClick={markAllRead} className="gap-1.5"><CheckCircle className="h-4 w-4" /> Mark All Read</Button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total", value: notifications.length, icon: Bell, color: "text-blue-600" },
            { label: "Unread", value: unreadCount, icon: AlertCircle, color: unreadCount > 0 ? "text-red-600" : "text-green-600" },
            { label: "Read", value: notifications.length - unreadCount, icon: CheckCircle, color: "text-green-600" },
            { label: "Channels", value: Object.keys(byChannel).length, icon: MessageSquare, color: "text-purple-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-6 pb-4 flex items-center gap-4">
                <div className={`rounded-lg bg-muted p-2 ${color}`}><Icon className="h-5 w-5" /></div>
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="notifications" className="space-y-4">
          <TabsList>
            <TabsTrigger value="notifications">Notification Center</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          {/* Notifications */}
          <TabsContent value="notifications" className="space-y-4">
            <div className="flex gap-2">
              {(["all", "unread", "read"] as const).map(f => (
                <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)} className="capitalize">{f}</Button>
              ))}
            </div>
            <Card>
              <CardContent className="p-0">
                {filtered.length === 0 ? (
                  <p className="p-6 text-center text-muted-foreground text-sm">No notifications.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Event Type</TableHead>
                        <TableHead>Channel</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="w-20"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((n) => (
                        <TableRow key={n.id} className={!n.is_read ? "bg-blue-50/30" : ""}>
                          <TableCell>
                            <p className="font-medium text-sm">{n.title ?? "—"}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">{n.message ?? ""}</p>
                          </TableCell>
                          <TableCell><Badge variant="outline" className="text-xs capitalize">{n.event_type ?? "—"}</Badge></TableCell>
                          <TableCell className="flex items-center gap-1 text-sm">
                            {n.channel === "email" ? <Mail className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                            {n.channel ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</TableCell>
                          <TableCell className="text-center">
                            {n.is_read ? <Badge className="bg-green-100 text-green-800">Read</Badge> : <Badge className="bg-blue-100 text-blue-800">Unread</Badge>}
                          </TableCell>
                          <TableCell>
                            {!n.is_read && (
                              <Button variant="ghost" size="sm" onClick={() => markRead(n.id)} className="text-xs">Mark read</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics */}
          <TabsContent value="analytics" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle>By Event Type</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(byType).length === 0 ? <p className="text-center text-muted-foreground py-4">No data.</p> : (
                    Object.entries(byType).sort((a,b) => b[1]-a[1]).map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between">
                        <span className="text-sm capitalize">{type.replace(/_/g, " ")}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round((count / notifications.length) * 100)}%` }} />
                          </div>
                          <span className="text-sm font-medium w-6 text-right">{count}</span>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>By Channel</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(byChannel).length === 0 ? <p className="text-center text-muted-foreground py-4">No data.</p> : (
                    Object.entries(byChannel).sort((a,b) => b[1]-a[1]).map(([channel, count]) => (
                      <div key={channel} className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm capitalize">
                          {channel === "email" ? <Mail className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                          {channel}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.round((count / notifications.length) * 100)}%` }} />
                          </div>
                          <span className="text-sm font-medium w-6 text-right">{count}</span>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
    </AppLayout>
  );
}
