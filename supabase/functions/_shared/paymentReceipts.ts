// _shared/paymentReceipts.ts - receipts for one-shot fee payments of ANY gateway (instalments: see instalmentServer.ts).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "./email.ts";
import { generateReceiptPdf } from "./receipt.ts";
import { bytesToBase64, emailInstalmentReceipt } from "./instalmentServer.ts";

const CATEGORY_LABELS: Record<string, string> = {
  course_amount: "Course Amount", transport_amount: "Transport Amount", other_amount: "Other Amount",
  uniform_amount: "Uniform Amount", material_amount: "Material Amount", exam_amount: "Exam Amount",
};

export async function buildFeeReceipt(admin: SupabaseClient, transactionId: string) {
  const { data: txn } = await admin.from("payment_transactions")
    .select("id, student_id, school_id, fee_payment_id, amount, refunded_amount, status, receipt_no, gateway, gateway_payment_id, paid_at, student_name")
    .eq("id", transactionId).maybeSingle();
  if (!txn || !["success", "partially_refunded", "refunded"].includes(txn.status) || !txn.receipt_no) return null;
  const [{ data: fee }, { data: student }, { data: school }] = await Promise.all([
    txn.fee_payment_id ? admin.from("fee_payments").select("*").eq("id", txn.fee_payment_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("students").select("full_name, class, section, contact_email, parent_email").eq("id", txn.student_id).maybeSingle(),
    admin.from("schools").select("name, address").eq("id", txn.school_id).maybeSingle(),
  ]);
  let lineItems = Object.entries(CATEGORY_LABELS).map(([col, label]) => ({ label, amount: Number((fee as any)?.[col] ?? 0) })).filter((l) => l.amount > 0);
  if (lineItems.length === 0) lineItems = [{ label: "School fees", amount: Number(txn.amount) }];
  const refunded = Number(txn.refunded_amount ?? 0);
  const pdf = await generateReceiptPdf({
    schoolName: school?.name || "School", schoolAddress: school?.address,
    studentName: student?.full_name || txn.student_name || "Student", classGrade: student?.class, section: student?.section,
    paymentId: txn.receipt_no, razorpayPaymentId: `${String(txn.gateway).toUpperCase()} ${txn.gateway_payment_id || "N/A"}`,
    paidOn: txn.paid_at || new Date().toISOString(), lineItems, totalPaid: Number(txn.amount) - refunded,
  });
  return { pdf, filename: `receipt_${txn.receipt_no}.pdf`, receiptNo: txn.receipt_no as string, student, amount: Number(txn.amount) };
}

/** Best effort: the payment already succeeded, a mail hiccup must never look like a payment failure. */
export async function emailReceipt(admin: SupabaseClient, kind: "fee" | "instalment", transactionId: string): Promise<void> {
  if (kind === "instalment") return emailInstalmentReceipt(admin, transactionId);
  try {
    const r = await buildFeeReceipt(admin, transactionId);
    const to = r?.student?.contact_email || r?.student?.parent_email;
    if (!r || !to) return;
    await sendEmail({
      to, subject: `Fee Payment Receipt ${r.receiptNo} - ${r.student?.full_name}`,
      body: `Dear Parent,\n\nWe have received your payment of Rs. ${r.amount.toLocaleString("en-IN")} for ${r.student?.full_name}. Your receipt ${r.receiptNo} is attached.\n\nThank you.`,
      attachments: [{ filename: r.filename, content: bytesToBase64(r.pdf) }],
    });
  } catch (err) { console.error("Fee receipt email failed:", err); }
}
