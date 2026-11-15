import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { CreditCard, GraduationCap, Info, XCircle } from "lucide-react";
import { ParentInstalmentPanel } from "@/components/erp-fees/instalments/ParentInstalmentPanel";
import { GatewayPicker } from "@/components/erp-fees/payments/GatewayPicker";
import { PaymentHistoryList } from "@/components/erp-fees/payments/PaymentHistoryList";
import { readGatewayReturn, startPayment, type GatewayId } from "@/lib/paymentGateways";

type StudentFeeDetails = {
  student_id: string;
  school_id: string | null;
  full_name: string;
  class: string | null;
  section: string | null;
  father_name: string | null;
  mother_name: string | null;
  contact_email: string | null;
  mobile: string | null;
  branch_name: string | null;
  due_amount: number;
  course_amount: number;
  transport_amount: number;
  other_amount: number;
  uniform_amount: number;
  material_amount: number;
};

type ExamOption = { id: string; label: string };

const maskMobile = (mobile: string | null) => {
  if (!mobile) return "—";
  const digits = mobile.replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  return "X".repeat(digits.length - 4) + digits.slice(-4);
};

const num = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

const emptyParticulars = {
  course_amount: "0",
  other_amount: "0",
  transport_amount: "0",
  uniform_amount: "0",
  material_amount: "0",
  exam_amount: "0",
};

export default function ParentFeePayment() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedStudentId = (location.state as { studentId?: string } | null)?.studentId ?? null;
  const [gatewayChoice, setGatewayChoice] = useState<GatewayId | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  // Coming back from Stripe / PayU / Cashfree (?gw=...&order=...): the server asks the gateway what happened, then we tell the parent.
  useEffect(() => {
    let alive = true;
    readGatewayReturn().then((r) => {
      if (!alive || !r) return;
      const o = r.outcome;
      if (r.kind === "instalment") setMode("finance");
      setHistoryKey((k) => k + 1);
      if (o.status === "success") toast({ title: "Payment successful", description: o.receiptNo ? `Receipt ${o.receiptNo} is ready - find it in your payment history.` : "Your payment has been recorded." });
      else if (o.status === "pending") toast({ title: "Payment is being confirmed", description: "Your bank is still processing it. This updates automatically once confirmed." });
      else if (o.status === "failed") toast({ title: "Payment failed", description: `${o.message}. No money was recorded - you can try again.`, variant: "destructive" });
      else if (o.status === "cancelled") toast({ title: "Payment not completed", description: "Nothing was charged. You can pay whenever you're ready." });
      else if (o.status === "error") toast({ title: "Couldn't confirm the payment", description: o.message, variant: "destructive" });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<StudentFeeDetails | null>(null);
  const [noLink, setNoLink] = useState(false);
  const [mode, setMode] = useState<"gateway" | "finance">("gateway");
  const [particulars, setParticulars] = useState(emptyParticulars);
  const [includeUniform, setIncludeUniform] = useState(false);
  const [includeMaterial, setIncludeMaterial] = useState(false);
  const [includeExam, setIncludeExam] = useState(false);
  const [examOptions, setExamOptions] = useState<ExamOption[]>([]);
  const [selectedExam, setSelectedExam] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Load the parent's linked child automatically — no manual Student ID /
  // mobile entry. requestedStudentId lets the dashboard tell us which of
  // several children the parent was viewing.
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_parent_fee_details", {
        p_student_id: requestedStudentId,
      });

      if (error) {
        toast({ title: "Couldn't load fee details", description: error.message, variant: "destructive" });
        setLoading(false);
        return;
      }

      if (!data) {
        setNoLink(true);
        setLoading(false);
        return;
      }

      setStudent(data as StudentFeeDetails);
      setLoading(false);
    };

    load();
  }, [requestedStudentId, toast]);

  useEffect(() => {
    const loadExams = async () => {
      if (!student?.school_id) return;
      try {
        const { data, error } = await supabase
          .from("exam_schedules" as any)
          .select("id, exam_name, exam_date")
          .eq("school_id", student.school_id)
          .order("exam_date", { ascending: false })
          .limit(20);
        if (!error && data) {
          setExamOptions(
            (data as any[]).map((e) => ({
              id: e.id,
              label: e.exam_name ?? "Exam",
            }))
          );
        }
      } catch {
        // exam_schedules schema can vary by deployment — fail quietly, the
        // exam checkbox just won't have options to pick from
        setExamOptions([]);
      }
    };
    loadExams();
  }, [student?.school_id]);

  const handleProceed = async () => {
    if (!student) return;

    const breakdown = {
      course_amount: num(particulars.course_amount),
      other_amount: num(particulars.other_amount),
      transport_amount: num(particulars.transport_amount),
      uniform_amount: includeUniform ? num(particulars.uniform_amount) : 0,
      material_amount: includeMaterial ? num(particulars.material_amount) : 0,
      exam_amount: includeExam ? num(particulars.exam_amount) : 0,
    };

    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);

    if (total <= 0) {
      toast({ title: "Enter at least one amount to proceed", variant: "destructive" });
      return;
    }
    if (includeExam && !selectedExam && examOptions.length > 0) {
      toast({ title: "Please select an exam", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const { data: sessionData } = await supabase.auth.getSession();

    // Clean up any abandoned pending attempts for this student before
    // creating a new one, so repeated clicks / cancelled checkouts don't
    // pile up and inflate the due amount.
    await supabase
      .from("fee_payments" as any)
      .delete()
      .eq("student_id", student.student_id)
      .eq("status", "pending");

    const { data: inserted, error } = await supabase
      .from("fee_payments" as any)
      .insert({
        school_id: student.school_id,
        student_id: student.student_id,
        student_name: student.full_name,
        class_grade: student.class,
        section: student.section,
        amount_due: total,
        amount_paid: 0,
        due_date: new Date().toISOString().slice(0, 10),
        status: "pending",
        created_by: sessionData.session?.user.id,
        ...breakdown,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      setSubmitting(false);
      toast({
        title: "Couldn't create payment request",
        description: error?.message,
        variant: "destructive",
      });
      return;
    }

    // mode === "gateway" - pay through the gateway the parent chose (Razorpay, Stripe, PayU or Cashfree).
    // The server decides the amount and confirms the payment with the gateway; nothing here marks anything paid.
    const outcome = await startPayment({ feeId: inserted.id }, {
      gateway: gatewayChoice as GatewayId,
      businessName: student.branch_name || "School Fee Payment",
      description: "Fee payment for " + student.full_name,
      customer: { name: student.father_name || student.mother_name || student.full_name, email: student.contact_email, phone: student.mobile },
    });
    if (outcome.status === "redirecting") return;   // the browser is on its way to the gateway; the result is settled when it returns
    setSubmitting(false);
    if (outcome.status === "success") {
      toast({ title: "Payment successful", description: outcome.receiptNo ? `Receipt ${outcome.receiptNo} has been emailed to you.` : "Your fee payment has been recorded." });
      navigate("/dashboard");
    } else if (outcome.status === "pending") {
      toast({ title: "Payment is being confirmed", description: "Your bank is still processing it. We'll update your fee record as soon as it's confirmed." });
    } else if (outcome.status === "failed") {
      toast({ title: "Payment failed", description: `${outcome.message}. No money was recorded - please try again.`, variant: "destructive" });
    } else if (outcome.status === "cancelled") {
      toast({ title: "Payment cancelled", description: "Your fee request has been saved as pending - you can complete payment anytime from your dashboard." });
    } else {
      toast({ title: "Couldn't start payment", description: outcome.message, variant: "destructive" });
    }
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

  if (noLink || !student) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-6">
          <Card>
            <CardContent className="py-12 text-center">
              <GraduationCap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-lg font-semibold mb-2">No Students Linked</h2>
              <p className="text-muted-foreground text-sm">
                Please contact the school admin to link your child's account.
              </p>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-center mb-6">
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as "gateway" | "finance")}
                className="flex items-center gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="gateway" id="mode-gateway" />
                  <Label htmlFor="mode-gateway" className="font-medium">
                    Payment Gateway
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="finance" id="mode-finance" />
                  <Label htmlFor="mode-finance" className="font-medium">
                    Finance (Easy Monthly Installments)
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {mode === "finance" && (
              <ParentInstalmentPanel
                studentId={student.student_id}
                studentName={student.full_name}
                businessName={student.branch_name || "School"}
                prefill={{ name: student.father_name || student.mother_name || student.full_name, email: student.contact_email, contact: student.mobile }}
                schoolId={student.school_id}
              />
            )}

            {mode === "gateway" && (<>
            <div className="grid md:grid-cols-2 gap-6">
              {/* Student Information */}
              <div className="border border-slate-200 rounded-xl p-4">
                <h2 className="font-semibold text-slate-900 mb-4">Student Information</h2>
                <div className="grid grid-cols-2 gap-3">
                  <ReadOnlyField label="Student Name" value={student.full_name} />
                  <ReadOnlyField label="Mobile Number" value={maskMobile(student.mobile)} />
                  <ReadOnlyField label="Father Name" value={student.father_name || "—"} />
                  <ReadOnlyField label="Mother Name" value={student.mother_name || "—"} />
                  <ReadOnlyField label="Email Address" value={student.contact_email || "—"} />
                  <ReadOnlyField label="Branch Name" value={student.branch_name || "—"} />
                  <ReadOnlyField
                    label="Class Name"
                    value={[student.class, student.section].filter(Boolean).join(" / ") || "—"}
                  />
                  <ReadOnlyField label="Due Amount" value={`₹${student.due_amount.toLocaleString()}`} />
                  <ReadOnlyField label="Course Amount" value={`₹${student.course_amount.toLocaleString()}`} />
                  <ReadOnlyField label="Transport Amount" value={`₹${student.transport_amount.toLocaleString()}`} />
                  <ReadOnlyField label="Other Amount" value={`₹${student.other_amount.toLocaleString()}`} />
                  <ReadOnlyField label="Uniform Amount" value={`₹${student.uniform_amount.toLocaleString()}`} />
                  <ReadOnlyField label="Material Amount" value={`₹${student.material_amount.toLocaleString()}`} />
                </div>
              </div>

              {/* Fee Particulars */}
              <div className="border border-slate-200 rounded-xl p-4">
                <h2 className="font-semibold text-slate-900 mb-4">Fee Particulars</h2>
                <div className="grid grid-cols-2 gap-3">
                  <AmountField
                    label="Course Amount"
                    value={particulars.course_amount}
                    onChange={(v) => setParticulars({ ...particulars, course_amount: v })}
                  />
                  <AmountField
                    label="Other Amount"
                    value={particulars.other_amount}
                    onChange={(v) => setParticulars({ ...particulars, other_amount: v })}
                  />
                  <AmountField
                    label="Transport Amount"
                    value={particulars.transport_amount}
                    onChange={(v) => setParticulars({ ...particulars, transport_amount: v })}
                  />
                  <AmountField
                    label="Uniform Amount"
                    value={particulars.uniform_amount}
                    onChange={(v) => setParticulars({ ...particulars, uniform_amount: v })}
                    checkable
                    checked={includeUniform}
                    onCheckedChange={setIncludeUniform}
                    tooltip="Include this year's uniform charge in this payment"
                  />
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Checkbox checked={includeMaterial} onCheckedChange={(c) => setIncludeMaterial(!!c)} />
                      <Label className="text-xs">Material Amount</Label>
                      <InfoTip text="Include textbook/material charges in this payment" />
                    </div>
                    <Input
                      type="number"
                      disabled={!includeMaterial}
                      value={particulars.material_amount}
                      onChange={(e) => setParticulars({ ...particulars, material_amount: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Checkbox checked={includeExam} onCheckedChange={(c) => setIncludeExam(!!c)} />
                      <Label className="text-xs">Select Exam</Label>
                      <InfoTip text="Include an exam fee in this payment" />
                    </div>
                    <Select value={selectedExam} onValueChange={setSelectedExam} disabled={!includeExam}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {examOptions.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-slate-400">No exams found</div>
                        ) : (
                          examOptions.map((ex) => (
                            <SelectItem key={ex.id} value={ex.id}>
                              {ex.label}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <AmountField
                    label="Exam Amount"
                    value={particulars.exam_amount}
                    onChange={(v) => setParticulars({ ...particulars, exam_amount: v })}
                    disabled={!includeExam}
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 max-w-2xl mx-auto">
              <GatewayPicker schoolId={student.school_id} value={gatewayChoice} onChange={setGatewayChoice} disabled={submitting} />
            </div>

            <div className="flex flex-wrap justify-center gap-3 mt-6">
              <Button
                onClick={handleProceed}
                disabled={submitting || !gatewayChoice}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6"
              >
                <CreditCard className="h-4 w-4 me-1.5" />
                {submitting ? "Processing..." : "Proceed For Payment"}
              </Button>
              <Button variant="destructive" onClick={() => navigate("/dashboard")} className="px-6">
                <XCircle className="h-4 w-4 me-1.5" /> Cancel
              </Button>
            </div>
            </>)}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader><CardTitle className="text-lg text-[#12203a]">Payment history</CardTitle></CardHeader>
          <CardContent><PaymentHistoryList studentId={student.student_id} refreshKey={historyKey} /></CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

const ReadOnlyField = ({ label, value }: { label: string; value: string }) => (
  <div className="space-y-1">
    <Label className="text-xs text-slate-500">{label}</Label>
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 truncate">
      {value}
    </div>
  </div>
);

const InfoTip = ({ text }: { text: string }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-blue-400 cursor-help" />
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-[200px] text-xs">{text}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

const AmountField = ({
  label,
  value,
  onChange,
  disabled,
  checkable,
  checked,
  onCheckedChange,
  tooltip,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  checkable?: boolean;
  checked?: boolean;
  onCheckedChange?: (v: boolean) => void;
  tooltip?: string;
}) => (
  <div className="space-y-1.5">
    <div className="flex items-center gap-1.5">
      {checkable && <Checkbox checked={checked} onCheckedChange={(c) => onCheckedChange?.(!!c)} />}
      <Label className="text-xs">{label}</Label>
      {tooltip && <InfoTip text={tooltip} />}
    </div>
    <Input
      type="number"
      value={value}
      disabled={disabled || (checkable && !checked)}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);
