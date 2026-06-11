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
import securitycenterbanner from "@/assets/securitycenter-banner.png";

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
    <div className="space-y-6">

      {/* Hero Banner */}
      <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-blue-400 via-blue-0 to-blue-400 p-8 relative min-h-[220px]">
        {/* Decorative Circles */}
        <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/40"></div>
        <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/40"></div>
        <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>
<div className="hidden md:block">
        {/* Stars */}
        <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
        <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
        <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>

        <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
        <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
        <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
        <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

        {/* Triangles */}
        <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

        <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

        <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>
</div>
        {/* Content */}
        <div className="relative z-10 max-w-xl">
          <h1 className="text-5xl font-bold text-slate-900">
            Security Center
          </h1>

          <p className="mt-3 text-lg text-slate-700">
            Monitor activity and audit logs
          </p>
        </div>

        {/* Banner Image */}
        <img
          src={securitycenterbanner}
          alt="Security Center Banner"
          /* className="absolute right-10 bottom-8 h-[130px] object-contain" */
          className="hidden md:block absolute right-10 bottom-8 w-[140px] z-10"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="group border-2 border-blue-500/40 hover:border-blue-500 hover:shadow-blue-500/30 hover:shadow-2xl hover:-translate-y-2 hover:bg-blue-50 transition-all duration-500 cursor-pointer ">
          <CardContent className="pt-4 flex items-center gap-3 bg-blue-100">
            <Shield className="h-8 w-8 text-blue-600 group-hover:scale-125 group-hover:rotate-12 transition-all duration-500" />
            <div>
              <p className="text-2xl font-bold text-black">{auditLogs?.length || 0}</p>
              <p className="text-xs text-black">Total Events</p>
            </div>
          </CardContent>
        </Card>
        <Card className="group border-2 border-green-500/40 hover:border-green-500 hover:shadow-green-500/30 hover:shadow-2xl hover:-translate-y-2 hover:bg-green-50 transition-all duration-500 cursor-pointer ">
          <CardContent className="pt-4 flex items-center gap-3 bg-green-100">
            <Activity className="h-8 w-8 text-green-600 group-hover:scale-125 group-hover:rotate-12 transition-all duration-500" />
            <div>
              <p className="text-2xl font-bold">{Object.keys(actionStats).length}</p>
              <p className="text-xs text-muted-foreground">Action Types</p>
            </div>
          </CardContent>
        </Card>
        <Card className="group border-2 border-red-500/40 hover:border-red-500 hover:shadow-red-500/30 hover:shadow-2xl hover:-translate-y-2 hover:bg-red-50 transition-all duration-500 cursor-pointer ">
          <CardContent className="pt-4 flex items-center gap-3 bg-red-100">
            <AlertTriangle className="h-8 w-8 text-red-600 group-hover:scale-125 group-hover:rotate-12 transition-all duration-500" />
            <div>
              <p className="text-2xl font-bold">{suspiciousLogs.length}</p>
              <p className="text-xs text-muted-foreground">Suspicious Actions</p>
            </div>
          </CardContent>
        </Card>
        <Card className="group border-2 border-violet-500/40 hover:border-violet-500 hover:shadow-violet-500/30 hover:shadow-2xl hover:-translate-y-2 hover:bg-violet-50 transition-all duration-500 cursor-pointer">
          <CardContent className="pt-4 flex items-center gap-3 bg-violet-100">
            <Download className="h-8 w-8 text-violet-600 group-hover:scale-125 group-hover:rotate-12 transition-all duration-500"/>
            <div>
              <p className="text-2xl font-bold">{auditLogs?.filter(l => l.action.includes("export")).length || 0}</p>
              <p className="text-xs text-muted-foreground">Data Exports</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all" className="gap-1 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md text-slate-600 hover:text-blue-600 rounded-lg transition-all duration-300">All Logs</TabsTrigger>
          <TabsTrigger value="suspicious" className="gap-1 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md text-slate-600 hover:text-blue-600 rounded-lg transition-all duration-300">Suspicious Activity</TabsTrigger>
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
      </div>
    </AppLayout>
  );
};

export default SecurityCenter;
