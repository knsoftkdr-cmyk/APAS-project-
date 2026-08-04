import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/email.ts";
import { generateReceiptPdf } from "../_shared/receipt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const { fee_payment_id } = await req.json();
    if (!fee_payment_id) {
      return new Response(
        JSON.stringify({ error: "fee_payment_id is required" }),
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
        "id, student_id, status, amount_due, razorpay_payment_id, course_amount, transport_amount, other_amount, uniform_amount, material_amount, exam_amount"
      )
      .eq("id", fee_payment_id)
      .single();

    if (feeError || !fee || fee.status !== "paid") {
      return new Response(
        JSON.stringify({ error: "Paid fee record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: student } = await supabaseAdmin
      .from("students")
      .select("full_name, class, section, contact_email, parent_email, school_id")
      .eq("id", fee.student_id)
      .single();

    const recipientEmail = student?.contact_email || student?.parent_email;
    if (!student || !recipientEmail) {
      return new Response(
        JSON.stringify({ error: "No contact email on file for this student" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
      razorpayPaymentId: fee.razorpay_payment_id || "N/A",
      paidOn: new Date().toISOString(),
      lineItems,
      totalPaid: Number(fee.amount_due),
    });

    await sendEmail({
      to: recipientEmail,
      subject: `Fee Payment Receipt (Resent) \u2014 ${student.full_name}`,
      body: `Dear Parent,\n\nAs requested, here is a copy of the fee payment receipt for ${student.full_name}.\n\nThank you.`,
      attachments: [
        {
          filename: `receipt_${fee.id}.pdf`,
          content: bytesToBase64(pdfBytes),
        },
      ],
    });

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