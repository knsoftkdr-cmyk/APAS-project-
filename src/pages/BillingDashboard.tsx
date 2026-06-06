/**
 * BillingDashboard.tsx
 * KNSoft Admin — Billing & Subscription Management
 * Shows: revenue overview, subscription plans per school,
 *        invoice list, payment history
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { CreditCard, TrendingUp, Building2, DollarSign, CheckCircle, XCircle, Clock } from "lucide-react";
import billBanner from "@/assets/bill-banner.png";
// ─── Types ────────────────────────────────────────────────────────────────────

interface SchoolBilling {
  id: string;
  name: string;
  subscription_plan: string | null;
  is_active: boolean | null;
  created_at: string | null;
  email: string | null;
}

interface Invoice {
  id: string;
  school_id: string;
  school_name: string;
  plan: string;
  amount: number;
  status: "paid" | "pending" | "overdue";
  date: string;
}

// Plan pricing
const PLAN_PRICES: Record<string, number> = {
  basic: 999,
  standard: 2499,
  premium: 4999,
};

const PLAN_FEATURES: Record<string, string[]> = {
  basic: ["Up to 100 students", "Basic analytics", "Email support"],
  standard: ["Up to 500 students", "Advanced analytics", "AI Tutor", "Priority support"],
  premium: ["Unlimited students", "Full analytics suite", "AI Tutor + HOD", "24/7 support", "Custom integrations"],
};

// ─── Component ───────────────────────────────────────────────────────────────

const BillingDashboard = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [schools, setSchools] = useState<SchoolBilling[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [planFilter, setPlanFilter] = useState("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: schoolsData } = await supabase
        .from("schools")
        .select("id, name, subscription_plan, is_active, created_at, email")
        .order("created_at", { ascending: false });

      const schools = schoolsData ?? [];
      setSchools(schools);

      // Generate mock invoices from real school data
      const generated: Invoice[] = schools.flatMap((s: SchoolBilling, i: number) => {
        const plan = s.subscription_plan ?? "basic";
        const amount = PLAN_PRICES[plan] ?? 999;
        const statuses: Array<"paid" | "pending" | "overdue"> = ["paid", "paid", "pending", "paid", "overdue"];
        return [
          {
            id: `INV-${String(i + 1).padStart(4, "0")}-A`,
            school_id: s.id,
            school_name: s.name,
            plan,
            amount,
            status: statuses[i % statuses.length],
            date: new Date(Date.now() - i * 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
          },
          {
            id: `INV-${String(i + 1).padStart(4, "0")}-B`,
            school_id: s.id,
            school_name: s.name,
            plan,
            amount,
            status: "paid" as const,
            date: new Date(Date.now() - (i + 1) * 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
          },
        ];
      });
      setInvoices(generated);
    } catch (e: any) {
      toast({ title: "Error loading billing data", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalMRR = schools.reduce((sum, s) => {
    if (s.is_active === false) return sum;
    return sum + (PLAN_PRICES[s.subscription_plan ?? "basic"] ?? 999);
  }, 0);

  const activeSchools = schools.filter(s => s.is_active !== false).length;
  const paidInvoices = invoices.filter(i => i.status === "paid").length;
  const pendingInvoices = invoices.filter(i => i.status === "pending").length;
  const overdueInvoices = invoices.filter(i => i.status === "overdue").length;

  const filteredSchools = planFilter === "all"
    ? schools
    : schools.filter(s => (s.subscription_plan ?? "basic") === planFilter);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const planColor = (plan: string | null) => {
    if (plan === "premium") return "bg-yellow-100 text-yellow-800";
    if (plan === "standard") return "bg-blue-100 text-blue-800";
    return "bg-gray-100 text-gray-700";
  };

  const statusIcon = (status: string) => {
    if (status === "paid") return <CheckCircle className="h-4 w-4 text-green-600" />;
    if (status === "pending") return <Clock className="h-4 w-4 text-yellow-600" />;
    return <XCircle className="h-4 w-4 text-red-600" />;
  };

  const statusBadge = (status: string) => {
    if (status === "paid") return "bg-green-100 text-green-800";
    if (status === "pending") return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
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
            <CreditCard className="h-5 w-5" />
          </div>
      <div>
      <h1 className="text-3xl text-black/80 md:text-4xl font-bold">
        Billing Dashboard
      </h1>

      <p className="text-black/80 mt-1">
        Manage subscriptions, invoices and revenue across all schools
      </p>

    </div>

  </div>
          <img
            src={billBanner}
            alt="Billing Banner"
            /* className="absolute right-10 bottom-6 h-[160px]" */
            className="hidden md:block absolute right-10 bottom-0 w-[130px] z-10"
          />
</div>
{/*         <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Billing Dashboard</h1>
            <p className="text-sm text-muted-foreground">Manage subscriptions, invoices and revenue across all schools</p>
          </div>
        </div> */}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Monthly Revenue", value: `₹${totalMRR.toLocaleString()}`, icon: DollarSign, color: "text-green-600" },
            { label: "Active Schools", value: activeSchools, icon: Building2, color: "text-blue-600" },
            { label: "Paid Invoices", value: paidInvoices, icon: CheckCircle, color: "text-green-600" },
            { label: "Overdue", value: overdueInvoices, icon: XCircle, color: "text-red-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-6 pb-4 flex items-center gap-4">
                <div className={`rounded-lg bg-muted p-2 ${color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Plan Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {["basic", "standard", "premium"].map((plan) => {
            const count = schools.filter(s => (s.subscription_plan ?? "basic") === plan && s.is_active !== false).length;
            const revenue = count * PLAN_PRICES[plan];
            return (
              <Card key={plan} className="relative overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="capitalize">{plan}</span>
                    <Badge className={planColor(plan)}>₹{PLAN_PRICES[plan].toLocaleString()}/mo</Badge>
                  </CardTitle>
                  <CardDescription>{count} active school{count !== 1 ? "s" : ""}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-foreground mb-3">₹{revenue.toLocaleString()}</p>
                  <ul className="space-y-1">
                    {PLAN_FEATURES[plan].map((f) => (
                      <li key={f} className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />{f}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* School Subscriptions */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />School Subscriptions
              </CardTitle>
              <Select value={planFilter} onValueChange={setPlanFilter}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Plans</SelectItem>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Monthly Fee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSchools.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      <Badge className={planColor(s.subscription_plan)}>{s.subscription_plan ?? "basic"}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      ₹{(PLAN_PRICES[s.subscription_plan ?? "basic"]).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {s.is_active !== false
                        ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                        : <Badge variant="outline">Inactive</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredSchools.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No schools found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Invoice List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />Invoice History
            </CardTitle>
            <CardDescription>
              Paid: {paidInvoices} · Pending: {pendingInvoices} · Overdue: {overdueInvoices}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice ID</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.slice(0, 20).map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">{inv.id}</TableCell>
                    <TableCell className="font-medium">{inv.school_name}</TableCell>
                    <TableCell>
                      <Badge className={planColor(inv.plan)}>{inv.plan}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">₹{inv.amount.toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {statusIcon(inv.status)}
                        <Badge className={`${statusBadge(inv.status)} hover:${statusBadge(inv.status)}`}>
                          {inv.status}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{inv.date}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default BillingDashboard;
