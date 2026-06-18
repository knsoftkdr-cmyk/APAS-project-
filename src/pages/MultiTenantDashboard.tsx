/**
 * MultiTenantDashboard.tsx
 * KNSoft Admin — Multi-Tenant Management
 * School tenancy, storage usage, active tenants
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Building2, HardDrive, Users, Activity, RefreshCw, TrendingUp } from "lucide-react";
import multitenantbanner from "@/assets/multitenant-banner.png";
interface TenantData {
  id: string;
  name: string;
  plan: string | null;
  is_active: boolean | null;
  created_at: string | null;
  storage_used_mb: number;
  files_count: number;
  ai_calls_count: number;
  active_users: number;
  user_count: number;
}

const MultiTenantDashboard = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantData[]>([]);
  const [activeTab, setActiveTab] = useState<"tenants" | "storage" | "usage">("tenants");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: schools } = await supabase
        .from("schools")
        .select("id, name, subscription_plan, is_active, created_at")
        .order("created_at", { ascending: false });

            // Fetch real storage stats via edge function (uses service role key)
      let totalFiles = 0;
      let realStorageMb = 0;
      try {
        const statsRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hyper-api`,
          { headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` } }
        );
        if (statsRes.ok) {
          const stats = await statsRes.json();
          totalFiles = stats.totalFiles ?? stats.totalfiles ?? 0;
          realStorageMb = stats.totalMb ?? stats.totalmb ?? 0;
        }
      } catch {}
      // Fetch real AI calls count from ai_usage_logs
      const { count: aiCallsCount } = await supabase
        .from("ai_usage_logs")
        .select("*", { count: "exact", head: true });

      const metrics = (schools ?? []).map((s: any) => ({
        school_id: s.id,
        storage_used_mb: realStorageMb,
        files_count: totalFiles,
        ai_calls_count: aiCallsCount ?? 0,
        active_users: 0,
      }));

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, school_id");

      const metricsMap = new Map(metrics.map((m: any) => [m.school_id, m]));
      const userCountMap = new Map<string, number>();
      for (const p of (profiles ?? []) as any[]) {
        if (p.school_id) userCountMap.set(p.school_id, (userCountMap.get(p.school_id) ?? 0) + 1);
      }

      const tenantData: TenantData[] = (schools ?? []).map((s: any) => {
        const m = metricsMap.get(s.id) as any;
        return {
          id: s.id,
          name: s.name,
          plan: s.subscription_plan,
          is_active: s.is_active,
          created_at: s.created_at,
          storage_used_mb: m?.storage_used_mb ?? 0,
          files_count: m?.files_count ?? 0,
          ai_calls_count: m?.ai_calls_count ?? 0,
          active_users: m?.active_users ?? 0,
          user_count: userCountMap.get(s.id) ?? 0,
        };
      });

      setTenants(tenantData);
    } catch (e: any) {
      toast({ title: "Error loading tenant data", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalStorage = tenants.reduce((a, t) => a + t.storage_used_mb, 0);
  const totalAICalls = tenants.reduce((a, t) => a + t.ai_calls_count, 0);
  const activeTenants = tenants.filter(t => t.is_active !== false).length;
  const totalUsers = tenants.reduce((a, t) => a + t.user_count, 0);

  const planColor = (plan: string | null) => {
    if (plan === "premium") return "bg-yellow-100 text-yellow-800";
    if (plan === "standard") return "bg-blue-100 text-blue-800";
    return "bg-gray-100 text-gray-700";
  };

  const storageBar = (used: number) => {
    const max = 1000; // 1GB max per school
    const pct = Math.min((used / max) * 100, 100);
    const color = pct > 80 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-green-500";
    return { pct, color };
  };

  if (loading) return <AppLayout><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div></AppLayout>;

  const tabs = [
    { id: "tenants", label: "Tenant Cards" },
    { id: "storage", label: "Storage Charts" },
    { id: "usage", label: "Usage Analytics" },
  ] as const;

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
                            <Building2 className="h-7 w-7" />
                          </div>
                    <div>
                      <h1 className="text-3xl text-black/80 md:text-4xl font-bold">
                        Tenant Dashboard
                      </h1>
        
                      <p className="text-black/80 mt-1">
                        School tenancy, storage usage, active tenant management
                      </p>
        
                    </div>
        
                  </div>
                  <img
                    src={multitenantbanner}
                    alt="Multi-Tenant Banner"
                    /* className="absolute right-10 bottom-6 h-[160px]" */
                    className="hidden md:block absolute right-5 bottom-3 w-[90px] z-10"
                  />      
                </div>
        
        {/* <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Multi-Tenant Dashboard</h1>
              <p className="text-sm text-muted-foreground">School tenancy, storage usage and active tenant management</p>
            </div>
          </div> */}
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Active Tenants", value: activeTenants, icon: Building2, color: "text-blue-600" },
            { label: "Total Users", value: totalUsers, icon: Users, color: "text-green-600" },
            { label: "Total Storage", value: `${totalStorage.toFixed(0)} MB`, icon: HardDrive, color: "text-purple-600" },
            { label: "Total AI Calls", value: totalAICalls, icon: Activity, color: "text-orange-600" },
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

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tenant Cards */}
        {activeTab === "tenants" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tenants.map(t => (
              <Card key={t.id} className={t.is_active === false ? "opacity-60" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    {t.is_active !== false
                      ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                      : <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <Badge className={`w-fit ${planColor(t.plan)}`}>{t.plan ?? "basic"}</Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    ["Users", t.user_count],
                    ["Files", t.files_count],
                    ["AI Calls", t.ai_calls_count],
                  ].map(([label, value]) => (
                    <div key={label as string} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{value}</span>
                    </div>
                  ))}
                  <div className="pt-1">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Storage</span>
                      <span>{t.storage_used_mb.toFixed(0)} MB</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${storageBar(t.storage_used_mb).color}`}
                        style={{ width: `${storageBar(t.storage_used_mb).pct}%` }} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Since {t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Storage Charts */}
        {activeTab === "storage" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><HardDrive className="h-5 w-5" />Storage Usage by School</CardTitle>
              <CardDescription>Storage consumption per tenant (max 1GB per school)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {tenants.map(t => {
                const { pct, color } = storageBar(t.storage_used_mb);
                return (
                  <div key={t.id}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-muted-foreground">{t.storage_used_mb.toFixed(0)} MB / 1000 MB</span>
                    </div>
                    <div className="h-3 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Usage Analytics */}
        {activeTab === "usage" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" />Usage Analytics</CardTitle>
              <CardDescription>AI calls and file activity per school</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-center">Users</TableHead>
                    <TableHead className="text-center">Files</TableHead>
                    <TableHead className="text-center">AI Calls</TableHead>
                    <TableHead className="text-center">Storage (MB)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell><Badge className={planColor(t.plan)}>{t.plan ?? "basic"}</Badge></TableCell>
                      <TableCell className="text-center">{t.user_count}</TableCell>
                      <TableCell className="text-center">{t.files_count}</TableCell>
                      <TableCell className="text-center">{t.ai_calls_count}</TableCell>
                      <TableCell className="text-center">{t.storage_used_mb.toFixed(0)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold bg-muted/30">
                    <TableCell>Total</TableCell>
                    <TableCell></TableCell>
                    <TableCell className="text-center">{totalUsers}</TableCell>
                    <TableCell className="text-center">{tenants.reduce((a, t) => a + t.files_count, 0)}</TableCell>
                    <TableCell className="text-center">{totalAICalls}</TableCell>
                    <TableCell className="text-center">{totalStorage.toFixed(0)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
    </AppLayout>
  );
};

export default MultiTenantDashboard;
