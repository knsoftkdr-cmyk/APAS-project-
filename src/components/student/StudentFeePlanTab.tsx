import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { HISTORY_LABELS, describeChange } from "@/lib/feePlan";
import { getStudentFeePlan } from "@/lib/feePlanApi";
import { FeeBreakdown, PaymentPill } from "@/components/erp-fees/feeplan/FeePlanParts";

/**
 * Fee plan assigned at admission, as shown on the student profile. Read-only here: staff correct it from ERP Fees,
 * and parents pay from the existing parent fee page. Parents/students see their own plan; the change history is staff-only.
 */
export default function StudentFeePlanTab({ studentId }: { studentId: string }) {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["student-fee-plan", studentId], queryFn: () => getStudentFeePlan(studentId), enabled: !!studentId });

  if (isLoading) return <p className="text-sm text-slate-500">Loading fee plan…</p>;
  if (isError) return <p className="text-sm text-red-600" role="alert">Couldn't load the fee plan: {error instanceof Error ? error.message : "unknown error"}</p>;
  if (!data || data.plans.length === 0) {
    return (
      <Card><CardContent className="pt-6 text-center space-y-1">
        <Wallet className="h-8 w-8 mx-auto text-slate-300" aria-hidden />
        <p className="font-medium text-slate-800">No admission fee plan linked</p>
        <p className="text-sm text-slate-500">A fee plan appears here once the student's admission is confirmed and the plan is linked to this student. Other fees are listed in ERP Fees.</p>
      </CardContent></Card>
    );
  }
  return (
    <div className="space-y-4">
      {data.plans.map((p) => (
        <Card key={p.id}><CardContent className="pt-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-900">{p.structure_name ?? "Fee plan"}</p>
              <p className="text-sm text-slate-500">{p.class_grade} · {p.academic_year}{p.category ? ` · ${p.category}` : ""}{p.due_date ? ` · due ${new Date(p.due_date).toLocaleDateString()}` : ""}</p>
            </div>
            <PaymentPill plan={p} />
          </div>
          <FeeBreakdown plan={p} />
        </CardContent></Card>
      ))}
      {data.history.length > 0 && (
        <Card><CardContent className="pt-6">
          <p className="text-sm font-semibold text-slate-800 mb-2">Fee plan history</p>
          <ul className="space-y-2 text-sm">
            {data.history.map((h) => (
              <li key={h.id}>
                <span className="font-medium text-slate-900">{HISTORY_LABELS[h.action] ?? h.action}</span>
                {describeChange(h) && <span className="text-slate-600"> · {describeChange(h)}</span>}
                <span className="block text-xs text-slate-500">{new Date(h.created_at).toLocaleString()} · {h.actor_name || "System"}{h.reason ? ` · ${h.reason}` : ""}</span>
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}
    </div>
  );
}
