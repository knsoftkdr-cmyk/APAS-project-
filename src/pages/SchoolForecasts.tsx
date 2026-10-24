/**
 * SchoolForecasts.tsx (feature 59)
 *
 * Read-only forecasts for a school admin: fee collection, staffing, and capacity.
 * No new tables, nothing is written, and only the signed-in user's own school is read.
 *
 * Data sources (all existing tables):
 * - Fee collection -> fee_payments (amount_due, amount_paid, due_date, class_grade). RLS only returns rows
 *                     when the user's profile has erp_access = true, so without it the section explains that.
 * - Staffing       -> students and profiles (role = teacher) counts for the school
 * - Capacity       -> subscriptions + plans (max_students, max_teachers). subscriptions only stores school_name,
 *                     so the plan is matched by school name and the section hides itself when no plan is found.
 *
 * The fee and staffing maths lives in src/lib/forecastModel.ts (unit tested).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { TrendingUp } from "lucide-react";
import { TARGET_STUDENTS_PER_TEACHER, num, pct, summariseFees, type FeeRow } from "@/lib/forecastModel";

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

interface PlanLimits {
  max_students: number;
  max_teachers: number;
}

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const SchoolForecasts = () => {
  const { profile } = useAuth();
  const profileId = (profile as any)?.id as string | undefined;
  const schoolId = profile?.school_id;

  const { data, isLoading, error } = useQuery({
    queryKey: ["school-forecasts", profileId, schoolId],
    enabled: !!schoolId && !!profileId,
    queryFn: async () => {
      const db = supabase as any; // some tables are missing from the generated types

      const { data: me, error: meErr } = await db
        .from("profiles")
        .select("erp_access, schools(name)")
        .eq("id", profileId)
        .maybeSingle();
      if (meErr) throw meErr;
      const erpAccess = me?.erp_access === true;
      const schoolName: string | null = me?.schools?.name ?? null;

      const studentsRes = await db.from("students").select("id", { count: "exact", head: true }).eq("school_id", schoolId);
      if (studentsRes.error) throw studentsRes.error;
      const teachersRes = await db
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .eq("role", "teacher");
      if (teachersRes.error) throw teachersRes.error;

      let fees: FeeRow[] | null = null;
      if (erpAccess) {
        fees = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const { data: rows, error: fErr } = await db
            .from("fee_payments")
            .select("class_grade, amount_due, amount_paid, due_date")
            .eq("school_id", schoolId)
            .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
          if (fErr) throw fErr;
          fees.push(...((rows || []) as FeeRow[]));
          if (!rows || rows.length < PAGE_SIZE) break;
        }
      }

      // The plan is optional: any failure here just hides the capacity limits.
      let plan: PlanLimits | null = null;
      if (schoolName) {
        const { data: subs } = await db
          .from("subscriptions")
          .select("status, plans(max_students, max_teachers)")
          .eq("school_name", schoolName)
          .eq("status", "active")
          .limit(1);
        const p = subs?.[0]?.plans;
        if (p) plan = { max_students: num(p.max_students), max_teachers: num(p.max_teachers) };
      }

      return {
        erpAccess,
        students: (studentsRes.count as number) || 0,
        teachers: (teachersRes.count as number) || 0,
        fees,
        plan,
      };
    },
  });

  const fee = useMemo(() => (data?.fees ? summariseFees(data.fees, format(new Date(), "yyyy-MM-dd")) : null), [data]);

  const ratio = data && data.teachers > 0 ? Math.round((data.students / data.teachers) * 10) / 10 : null;
  const teachersNeeded = data ? Math.ceil(data.students / TARGET_STUDENTS_PER_TEACHER) : 0;

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <TrendingUp className="h-6 w-6" /> School forecasts
          </h1>
          <p className="text-muted-foreground">Fee collection, staffing and capacity for your school. Read-only.</p>
        </div>

        {!schoolId ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">No school is linked to this account.</CardContent>
          </Card>
        ) : isLoading ? (
          <LoadingSpinner />
        ) : error || !data ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">Could not load forecasts. Try again later.</CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="font-medium">Fee collection</div>
                {!fee ? (
                  <p className="text-sm text-muted-foreground">
                    Fee data needs ERP access on your account. Ask your administrator to turn it on.
                  </p>
                ) : fee.due === 0 ? (
                  <p className="text-sm text-muted-foreground">No fee records yet. Add fees in ERP Fee Management and they will appear here.</p>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <Stat label="Total due" value={money(fee.due)} />
                      <Stat label="Collected" value={`${money(fee.paid)} (${fee.collectedPct}%)`} />
                      <Stat label="Overdue" value={money(fee.overdue)} />
                      <Stat label="Upcoming dues" value={money(fee.upcomingDue)} />
                    </div>
                    <p className="text-sm">
                      {fee.expectedMore === null
                        ? "Not enough past dues to forecast yet. It needs at least 5 records with a due date that has passed."
                        : `Expected to collect about ${money(fee.expectedMore)} more on upcoming dues, because ${fee.pastRatePct}% of past dues were collected.`}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-2 pr-4 font-normal">Class</th>
                            <th className="py-2 pr-4 font-normal">Due</th>
                            <th className="py-2 pr-4 font-normal">Collected</th>
                            <th className="py-2 font-normal">Overdue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fee.byClass.map((c) => (
                            <tr key={c.grade} className="border-b last:border-0">
                              <td className="py-2 pr-4">{c.grade}</td>
                              <td className="py-2 pr-4">{money(c.due)}</td>
                              <td className="py-2 pr-4">
                                {money(c.paid)} ({pct(c.paid, c.due)}%)
                              </td>
                              <td className="py-2">{money(c.overdue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="font-medium">Staffing</div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Stat label="Students" value={String(data.students)} />
                  <Stat label="Teachers" value={String(data.teachers)} />
                  <Stat label="Students per teacher" value={ratio === null ? "No teachers yet" : String(ratio)} />
                </div>
                <p className="text-sm">
                  {data.students === 0
                    ? "No students yet."
                    : data.teachers >= teachersNeeded
                      ? `At ${TARGET_STUDENTS_PER_TEACHER} students per teacher you need ${teachersNeeded} teachers. You have ${data.teachers}.`
                      : `At ${TARGET_STUDENTS_PER_TEACHER} students per teacher you need ${teachersNeeded} teachers. You have ${data.teachers}, so about ${teachersNeeded - data.teachers} more are needed.`}
                </p>
              </CardContent>
            </Card>

            {data.plan && (
              <Card>
                <CardContent className="space-y-4 p-5">
                  <div className="font-medium">Capacity</div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Stat
                      label="Students on your plan"
                      value={`${data.students} of ${data.plan.max_students} (${pct(data.students, data.plan.max_students)}%)`}
                    />
                    <Stat
                      label="Teachers on your plan"
                      value={`${data.teachers} of ${data.plan.max_teachers} (${pct(data.teachers, data.plan.max_teachers)}%)`}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    This is your subscription limit, not classroom seats.{" "}
                    {data.students > data.plan.max_students || data.teachers > data.plan.max_teachers
                      ? "You are over a plan limit."
                      : "You are within your plan limits."}
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-sm text-muted-foreground">{label}</div>
    <div className="text-lg font-medium">{value}</div>
  </div>
);

export default SchoolForecasts;
