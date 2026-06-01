import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, CreditCard, Users, Cpu, HardDrive, Check } from "lucide-react";
import { format } from "date-fns";
import billBanner from "@/assets/bill-banner.png";

const PLAN_TIERS = [
  {
    name: "Starter",
    tier: "starter",
    price: "₹4,999/mo",
    features: ["Up to 50 students", "5 teachers", "100 AI generations/mo", "500 MB storage", "Email support"],
  },
  {
    name: "Pro",
    tier: "pro",
    price: "₹14,999/mo",
    features: ["Up to 500 students", "25 teachers", "1,000 AI generations/mo", "5 GB storage", "Priority support", "Automation workflows"],
    popular: true,
  },
  {
    name: "Enterprise",
    tier: "enterprise",
    price: "Custom",
    features: ["Unlimited students", "Unlimited teachers", "Unlimited AI generations", "50 GB storage", "Dedicated support", "Custom integrations", "SLA guarantee"],
  },
];

const Billing = () => {
  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("*").eq("is_active", true).order("price_monthly");
      if (error) throw error;
      return data;
    },
  });

  const { data: subscriptions } = useQuery({
    queryKey: ["subscriptions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subscriptions").select("*, plans(name, tier)").order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      return data;
    },
  });

  const { data: invoices } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("*, subscriptions(school_name)").order("invoice_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const currentSub = subscriptions?.[0];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-[#EDE9FE] via-[#DDD6FE] to-[#C4B5FD] p-8 relative min-h-[220px]">

          <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/40"></div>
          <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/40"></div>
          <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>

                    <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
          <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
          <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>
          
          <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
          <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
          <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
          <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

          <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

          <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

          <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>


          <div className="max-w-xl">
            <h1 className="text-5xl font-bold text-slate-900">
              Billing & Plans
            </h1>

            <p className="mt-3 text-slate-700 text-lg">
              Manage your subscription and billing
            </p>
          </div>

          <img
            src={billBanner}
            alt="Billing Banner"
            className="absolute right-10 bottom-6 h-[160px]"
          />
        </div>

      <Tabs defaultValue="plans" className="space-y-6">
        <TabsList>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="plans">
          {currentSub && (
            <Card className="mb-6 border-primary">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" /> Current Subscription
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold">{currentSub.school_name}</p>
                  <p className="text-sm text-muted-foreground capitalize">{(currentSub as any).plans?.name || currentSub.plan_id} — {currentSub.billing_cycle}</p>
                </div>
                <Badge variant={currentSub.status === "active" ? "default" : "secondary"} className="text-sm">{currentSub.status}</Badge>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLAN_TIERS.map(plan => (
              <Card key={plan.tier} className={plan.popular ? "border-primary shadow-lg relative" : ""}>
                {plan.popular && <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Most Popular</Badge>}
                <CardHeader className="text-center">
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription className="text-2xl font-bold text-foreground">{plan.price}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {plan.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-primary shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                  <Button variant={plan.popular ? "default" : "outline"} className="w-full mt-4">
                    {plan.tier === "enterprise" ? "Contact Sales" : "Select Plan"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="usage">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Students</CardTitle></CardHeader>
              <CardContent>
                <div className="flex justify-between mb-2 text-sm"><span>32 / 50</span><span>64%</span></div>
                <Progress value={64} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Teachers</CardTitle></CardHeader>
              <CardContent>
                <div className="flex justify-between mb-2 text-sm"><span>3 / 5</span><span>60%</span></div>
                <Progress value={60} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Cpu className="h-4 w-4" /> AI Generations</CardTitle></CardHeader>
              <CardContent>
                <div className="flex justify-between mb-2 text-sm"><span>47 / 100</span><span>47%</span></div>
                <Progress value={47} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><HardDrive className="h-4 w-4" /> Storage</CardTitle></CardHeader>
              <CardContent>
                <div className="flex justify-between mb-2 text-sm"><span>120 MB / 500 MB</span><span>24%</span></div>
                <Progress value={24} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="invoices">
          {!invoices?.length ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No invoices yet.</CardContent></Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map(inv => (
                    <TableRow key={inv.id}>
                      <TableCell>{format(new Date(inv.invoice_date), "MMM d, yyyy")}</TableCell>
                      <TableCell className="font-medium">₹{inv.amount}</TableCell>
                      <TableCell><Badge variant={inv.status === "paid" ? "default" : "secondary"}>{inv.status}</Badge></TableCell>
                      <TableCell>{format(new Date(inv.due_date), "MMM d, yyyy")}</TableCell>
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

export default Billing;
