// _shared/instalmentServer.ts
// Server plumbing shared by the instalment edge functions: CORS/JSON helpers, caller authentication, Razorpay REST calls,
// and the receipt (PDF + email). Pure decision logic lives in instalmentGateway.ts.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "./email.ts";
import { generateReceiptPdf } from "./receipt.ts";
import type { GatewayPayment } from "./instalmentGateway.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature, stripe-signature, x-webhook-signature, x-webhook-timestamp",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const adminClient = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

/** A client that acts AS the caller, so row-level security decides what they may see. Null when there is no valid session. */
export async function callerClient(req: Request): Promise<{ client: SupabaseClient; userId: string } | null> {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return { client, userId: data.user.id };
}

const rzpAuth = () => `Basic ${btoa(`${Deno.env.get("RAZORPAY_KEY_ID")!}:${Deno.env.get("RAZORPAY_KEY_SECRET")!}`)}`;

export async function razorpayCreateOrder(body: Record<string, unknown>): Promise<{ ok: boolean; order?: any; error?: string }> {
  const res = await fetch("https://api.razorpay.com/v1/orders", { method: "POST", headers: { Authorization: rzpAuth(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, order: data } : { ok: false, error: data?.error?.description || "Razorpay order creation failed" };
}

/** The gateway's own record of every payment attempt on an order (authoritative; never trust the browser). */
export async function razorpayOrderPayments(orderId: string): Promise<GatewayPayment[]> {
  const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}/payments`, { headers: { Authorization: rzpAuth() } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.description || "Could not confirm the payment with the gateway");
  return (data.items ?? []) as GatewayPayment[];
}

export async function razorpayPayment(paymentId: string): Promise<GatewayPayment> {
  const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: rzpAuth() } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.description || "Could not fetch the payment from the gateway");
  return data as GatewayPayment;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Receipt PDF for one successful instalment payment (reuses the existing receipt layout). */
export async function buildInstalmentReceipt(admin: SupabaseClient, transactionId: string) {
  const { data: txn } = await admin.from("instalment_transactions")
    .select("id, student_id, school_id, plan_id, item_id, amount, refunded_amount, status, receipt_no, razorpay_payment_id, paid_at, method")
    .eq("id", transactionId).maybeSingle();
  if (!txn || !["success", "partially_refunded", "refunded"].includes(txn.status) || !txn.receipt_no) return null;
  const [{ data: item }, { data: student }, { data: school }] = await Promise.all([
    admin.from("instalment_items").select("seq, plan_id").eq("id", txn.item_id).single(),
    admin.from("students").select("full_name, class, section, contact_email, parent_email").eq("id", txn.student_id).single(),
    admin.from("schools").select("name, address").eq("id", txn.school_id).single(),
  ]);
  const { count } = await admin.from("instalment_items").select("id", { count: "exact", head: true }).eq("plan_id", txn.plan_id).neq("status", "cancelled");
  const refunded = Number(txn.refunded_amount ?? 0);
  const lineItems = [{ label: `Instalment ${item?.seq ?? ""} of ${count ?? ""} - school fees`, amount: Number(txn.amount) }];
  const pdf = await generateReceiptPdf({
    schoolName: school?.name || "School", schoolAddress: school?.address,
    studentName: student?.full_name || "Student", classGrade: student?.class, section: student?.section,
    paymentId: txn.receipt_no, razorpayPaymentId: txn.razorpay_payment_id || "N/A",
    paidOn: txn.paid_at || new Date().toISOString(), lineItems, totalPaid: Number(txn.amount) - refunded,
  });
  return { pdf, filename: `receipt_${txn.receipt_no}.pdf`, receiptNo: txn.receipt_no as string, student, amount: Number(txn.amount) };
}

/** Best effort: the payment already succeeded, a mail hiccup must never look like a payment failure. */
export async function emailInstalmentReceipt(admin: SupabaseClient, transactionId: string): Promise<void> {
  try {
    const r = await buildInstalmentReceipt(admin, transactionId);
    const to = r?.student?.contact_email || r?.student?.parent_email;
    if (!r || !to) return;
    await sendEmail({
      to, subject: `Fee Instalment Receipt ${r.receiptNo} - ${r.student?.full_name}`,
      body: `Dear Parent,\n\nWe have received your instalment payment of Rs. ${r.amount.toLocaleString("en-IN")} for ${r.student?.full_name}. Your receipt ${r.receiptNo} is attached.\n\nThank you.`,
      attachments: [{ filename: r.filename, content: bytesToBase64(r.pdf) }],
    });
  } catch (err) {
    console.error("Instalment receipt email failed:", err);
  }
}

export { bytesToBase64 };
