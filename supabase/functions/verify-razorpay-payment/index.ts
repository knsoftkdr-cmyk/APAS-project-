import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/email.ts";
import { generateReceiptPdf } from "../_shared/receipt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const CATEGORY_COLUMNS = [
  "course_amount",
  "transport_amount",
  "other_amount",
  "uniform_amount",
  "material_amount",
  "exam_amount",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  course_amount: "Course Amount",
  transport_amount: "Transport Amount",
  other_amount: "Other Amount",
  uniform_amount: "Uniform Amount",
  material_amount: "Material Amount",
  exam_amount: "Exam Amount",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { fee_payment_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      await req.json();

    if (!fee_payment_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;

    const expectedSignature = await hmacSha256Hex(
      `${razorpay_order_id}|${razorpay_payment_id}`,
      keySecret
    );

    if (expectedSignature !== razorpay_signature) {
      return new Response(
        JSON.stringify({ error: "Payment verification failed \u2014 signature mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: fee, error: feeError } = await supabaseAdmin
      .from("fee_payments")
      .select(
        "id, student_id, amount_due, razorpay_order_id, course_amount, transport_amount, other_amount, uniform_amount, material_amount, exam_amount"
      )
      .eq("id", fee_payment_id)
      .single();

    if (feeError || !fee) {
      return new Response(
        JSON.stringify({ error: "Fee record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (fee.razorpay_order_id !== razorpay_order_id) {
      return new Response(
        JSON.stringify({ error: "Order does not match this fee record" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("fee_payments")
      .update({
        amount_paid: fee.amount_due,
        status: "paid",
        razorpay_payment_id,
        razorpay_signature,
      })
      .eq("id", fee_payment_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decrease the outstanding pending fee record(s) for this student by the
    // amounts just paid, so the "still owed" figure per category (and
    // overall) actually goes down instead of staying frozen forever.
    const { data: pendingRows, error: pendingError } = await supabaseAdmin
      .from("fee_payments")
      .select(
        "id, amount_due, course_amount, transport_amount, other_amount, uniform_amount, material_amount, exam_amount"
      )
      .eq("student_id", fee.student_id)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (!pendingError && pendingRows && pendingRows.length > 0) {
      const remaining: Record<string, number> = {};
      for (const col of CATEGORY_COLUMNS) {
        remaining[col] = Number((fee as any)[col] ?? 0);
      }

      for (const row of pendingRows) {
        const updates: Record<string, number> = {};
        let rowDueReduction = 0;

        for (const col of CATEGORY_COLUMNS) {
          if (remaining[col] > 0) {
            const rowVal = Number((row as any)[col] ?? 0);
            const deduct = Math.min(rowVal, remaining[col]);
            if (deduct > 0) {
              updates[col] = rowVal - deduct;
              remaining[col] -= deduct;
              rowDueReduction += deduct;
            }
          }
        }

        if (Object.keys(updates).length > 0) {
          updates["amount_due"] = Math.max(Number(row.amount_due) - rowDueReduction, 0);
          await supabaseAdmin.from("fee_payments").update(updates).eq("id", row.id);
        }

        if (Object.values(remaining).every((v) => v <= 0)) break;
      }
    }

    // Generate and email the receipt. Failures here are logged but never
    // fail the payment response itself \u2014 the payment already succeeded,
    // a receipt-email hiccup shouldn't look like a payment failure to the parent.
    try {
      const { data: student } = await supabaseAdmin
        .from("students")
        .select("full_name, class, section, contact_email, parent_email, school_id")
        .eq("id", fee.student_id)
        .single();

      const recipientEmail = student?.contact_email || student?.parent_email;

      if (student && recipientEmail) {
        const { data: school } = await supabaseAdmin
          .from("schools")
          .select("name, address")
          .eq("id", student.school_id)
          .single();

        const lineItems = CATEGORY_COLUMNS.map((col) => ({
          label: CATEGORY_LABELS[col],
          amount: Number((fee as any)[col] ?? 0),
        }));

        const pdfBytes = await generateReceiptPdf({
          schoolName: school?.name || "School",
          schoolAddress: school?.address,
          studentName: student.full_name,
          classGrade: student.class,
          section: student.section,
          paymentId: fee.id,
          razorpayPaymentId: razorpay_payment_id,
          paidOn: new Date().toISOString(),
          lineItems,
          totalPaid: Number(fee.amount_due),
        });

        await sendEmail({
          to: recipientEmail,
          subject: `Fee Payment Receipt \u2014 ${student.full_name}`,
          body: `Dear Parent,\n\nWe have received your payment of Rs. ${Number(fee.amount_due).toLocaleString("en-IN")} for ${student.full_name}. Please find the receipt attached.\n\nThank you.`,
          attachments: [
            {
              filename: `receipt_${fee.id}.pdf`,
              content: bytesToBase64(pdfBytes),
            },
          ],
        });
      }
    } catch (receiptErr) {
      console.error("Receipt generation/email failed:", receiptErr);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});