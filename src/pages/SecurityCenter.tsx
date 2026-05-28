import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Shield, Activity, AlertTriangle, Download } from "lucide-react";
import { format } from "date-fns";

const SecurityCenter = () => {
  const { data: auditLogs, isLoading } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });

  const actionStats = auditLogs?.reduce((acc, log) => {
    acc[log.action] = (acc[log.action] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const suspiciousLogs = auditLogs?.filter(log =>
    log.action.includes("delete") || log.action.includes("export") || log.action.includes("bulk")
  ) || [];

  return (
    <AppLayout>
      <PageHeader title="Security Center" subtitle="Monitor activity and audit logs" />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <Shield className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{auditLogs?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Total Events</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <Activity className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{Object.keys(actionStats).length}</p>
              <p className="text-xs text-muted-foreground">Action Types</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <div>
              <p className="text-2xl font-bold">{suspiciousLogs.length}</p>
              <p className="text-xs text-muted-foreground">Suspicious Actions</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <Download className="h-8 w-8 text-accent" />
            <div>
              <p className="text-2xl font-bold">{auditLogs?.filter(l => l.action.includes("export")).length || 0}</p>
              <p className="text-xs text-muted-foreground">Data Exports</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">All Logs</TabsTrigger>
          <TabsTrigger value="suspicious">Suspicious Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : !auditLogs?.length ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No audit logs recorded yet.</CardContent></Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell><Badge variant="outline">{log.action}</Badge></TableCell>
                      <TableCell className="text-sm">{log.resource_type}{log.resource_id ? ` / ${log.resource_id.substring(0, 8)}...` : ""}</TableCell>
                      <TableCell className="text-sm font-mono">{log.ip_address || "—"}</TableCell>
                      <TableCell className="text-sm">{format(new Date(log.created_at), "MMM d, h:mm a")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="suspicious">
          {!suspiciousLogs.length ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No suspicious activity detected.</CardContent></Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suspiciousLogs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell><Badge variant="destructive">{log.action}</Badge></TableCell>
                      <TableCell className="text-sm">{log.resource_type}</TableCell>
                      <TableCell className="text-sm font-mono">{log.ip_address || "—"}</TableCell>
                      <TableCell className="text-sm">{format(new Date(log.created_at), "MMM d, h:mm a")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
};

export default SecurityCenter;
