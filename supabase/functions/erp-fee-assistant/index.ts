import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function getGeminiKeys(): string[] {
  return [
    Deno.env.get("Worksheet_gemini_api_key"),
    Deno.env.get("GOOGLE_GEMINI_API_KEY_2"),
    Deno.env.get("GEMINI_KEY_2"),
    Deno.env.get("GEMINI_KEY_3"),
    Deno.env.get("GEMINI_KEY_4"),
  ].filter((k): k is string => !!k && k.trim().length > 0);
}

const VALID_TABS = ["records", "history"];
const VALID_CATEGORIES = ["course", "transport", "uniform", "material", "exam", "other"];

const FEE_TOOL = {
  functionDeclarations: [
    {
      name: "handle_fee_query",
      description: "Classify what a school fee administrator wants and extract relevant details.",
      parameters: {
        type: "OBJECT",
        properties: {
          intent: {
            type: "STRING",
            description:
              "One of: fee_summary, pending_list, overdue_list, collections_summary, student_lookup, resend_receipt, add_fee, record_payment, delete_fee, navigate, chat",
          },
          student_name: { type: "STRING", description: "Student name mentioned, if any." },
          amount: { type: "NUMBER", description: "A rupee amount mentioned, for add_fee or record_payment." },
          category: {
            type: "STRING",
            description: `For add_fee only: which fee category this is, one of ${VALID_CATEGORIES.join(", ")}. E.g. "transport fee" or "bus fee" -> transport, "uniform fee" -> uniform, "exam fee" -> exam, "course fee"/"tuition" -> course, "books"/"material fee" -> material. Default to "other" if no specific category is mentioned.`,
          },
          due_date: { type: "STRING", description: "A due date mentioned, normalized to YYYY-MM-DD if you can determine it. Used for add_fee, and optionally to disambiguate record_payment/delete_fee when a student has multiple records." },
          target_tab: {
            type: "STRING",
            description: `For navigate only. One of: ${VALID_TABS.join(", ")}`,
          },
          chat_reply: { type: "STRING", description: "For chat intent only: a short natural reply to greetings or general questions." },
        },
        required: ["intent"],
      },
    },
  ],
};

async function callGemini(systemPrompt: string, userPrompt: string, keys: string[]): Promise<any | null> {
  const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
  for (const key of keys) {
    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              tools: [FEE_TOOL],
              toolConfig: { functionCallingConfig: { mode: "ANY" } },
              generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
            }),
          },
        );
        if (response.status === 429 || response.status === 503) continue;
        if (!response.ok) continue;
        const data = await response.json();
        const candidate = data?.candidates?.[0];
        if (!candidate) continue;
        return candidate;
      } catch (_e) {
        // try next key/model
      }
    }
  }
  return null;
}

function inr(n: number): string {
  return `₹${(n || 0).toLocaleString("en-IN")}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  course: "course",
  transport: "transport",
  uniform: "uniform",
  material: "material",
  exam: "exam",
  other: "general",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message, school_id } = await req.json();
    if (!school_id) {
      return new Response(JSON.stringify({ type: "message", text: "I need to know which school this is for." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const keys = getGeminiKeys();
    if (keys.length === 0) {
      return new Response(JSON.stringify({ error: "No AI API keys configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const todayIso = new Date().toISOString().slice(0, 10);

    const systemPrompt = `You are APAS Fee Management AI Assistant, helping a school fee administrator. You have real tools to add fees, record payments, and delete records - always use handle_fee_query, never answer from your own knowledge about what you can or cannot do.
Today's date is ${todayIso}.
Available navigation tabs: ${VALID_TABS.join(", ")} (records = Fee Records, history = Payment History).
Fee categories that exist in the system: ${VALID_CATEGORIES.join(", ")} (course = tuition/course fee, transport = bus/transport fee, uniform, material = books/supplies, exam, other = anything else/general).
Classify the message and call handle_fee_query with the right intent:
- fee_summary: asking about fees overall - how many pending, total due, how many overdue/paid
- pending_list: asking which students have pending (not yet overdue) fees
- overdue_list: asking which students are overdue or past due date
- collections_summary: asking how much has been collected total or this month
- student_lookup: asking about a specific student's fee/dues/balance/payment status (extract student_name)
- resend_receipt: asking to resend/email a payment receipt to a student (extract student_name)
- add_fee: asking to add/create a new fee for a student, for ANY category including transport/bus fee, uniform fee, exam fee, course/tuition fee, material fee, or a general/unspecified fee (extract student_name, amount, category, and due_date if mentioned - normalize due_date to YYYY-MM-DD)
- record_payment: asking to record/log a payment a student has made (extract student_name and amount)
- delete_fee: asking to delete/remove a fee record for a student (extract student_name, and due_date if they specify which record)
- navigate: asking to go to/open/show a specific screen (extract target_tab from the list above)
- chat: ONLY for greetings, small talk, or truly unrelated questions - reply briefly in chat_reply. Do NOT use chat to say a fee-related action is unsupported; every fee-related request maps to one of the intents above.`;

    const candidate = await callGemini(systemPrompt, message, keys);
    const parts = candidate?.content?.parts || [];
    const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;

    if (!fnCall) {
      return new Response(JSON.stringify({
        type: "message",
        text: parts.find((p: any) => p.text)?.text?.trim() || "I can help with fee summaries, dues lookups, collections, adding fees (any category), recording payments, deleting records, or navigating the fee module.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const args = fnCall.args || {};

    switch (args.intent) {
      case "navigate": {
        const tab = VALID_TABS.includes(args.target_tab) ? args.target_tab : null;
        if (!tab) {
          return new Response(JSON.stringify({ type: "message", text: "I couldn't tell which screen you meant - could you say 'fee records' or 'payment history'?" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ type: "navigate", target_tab: tab, text: `Opening ${tab === "records" ? "Fee Records" : "Payment History"}...` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "fee_summary": {
        const { data: fees } = await supabase
          .from("fee_payments")
          .select("amount_due, amount_paid, status")
          .eq("school_id", school_id);
        const list = fees || [];
        const pending = list.filter((f: any) => f.status === "pending");
        const overdue = list.filter((f: any) => f.status === "overdue");
        const paid = list.filter((f: any) => f.status === "paid");
        const totalDue = [...pending, ...overdue].reduce(
          (sum: number, f: any) => sum + Math.max((f.amount_due || 0) - (f.amount_paid || 0), 0), 0
        );
        let text = `You have ${pending.length} pending fee record${pending.length === 1 ? "" : "s"} and ${overdue.length} overdue.`;
        text += ` Total outstanding is ${inr(totalDue)}.`;
        text += ` ${paid.length} record${paid.length === 1 ? "" : "s"} fully paid.`;
        return new Response(JSON.stringify({ type: "message", text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "pending_list": {
        const { data: pendingFees } = await supabase
          .from("fee_payments")
          .select("student_name, class_grade, section, amount_due, amount_paid, due_date")
          .eq("school_id", school_id)
          .eq("status", "pending")
          .order("due_date", { ascending: true })
          .limit(10);
        const list = pendingFees || [];
        if (list.length === 0) {
          return new Response(JSON.stringify({ type: "message", text: "No pending fees right now." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const lines = list.map((f: any) =>
          `${f.student_name}${f.class_grade ? ` (${f.class_grade}${f.section ? ` ${f.section}` : ""})` : ""}: ${inr(Math.max((f.amount_due || 0) - (f.amount_paid || 0), 0))} pending`
        );
        return new Response(JSON.stringify({ type: "message", text: lines.join(". ") }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "overdue_list": {
        const { data: overdueFees } = await supabase
          .from("fee_payments")
          .select("student_name, class_grade, section, amount_due, amount_paid, due_date")
          .eq("school_id", school_id)
          .eq("status", "overdue")
          .order("due_date", { ascending: true })
          .limit(10);
        const list = overdueFees || [];
        if (list.length === 0) {
          return new Response(JSON.stringify({ type: "message", text: "No overdue fees right now." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const lines = list.map((f: any) =>
          `${f.student_name}${f.class_grade ? ` (${f.class_grade}${f.section ? ` ${f.section}` : ""})` : ""}: ${inr(Math.max((f.amount_due || 0) - (f.amount_paid || 0), 0))} overdue`
        );
        return new Response(JSON.stringify({ type: "message", text: lines.join(". ") }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "collections_summary": {
        const { data: allFees } = await supabase
          .from("fee_payments")
          .select("amount_paid, due_date")
          .eq("school_id", school_id);
        const list = allFees || [];
        const totalCollected = list.reduce((sum: number, f: any) => sum + (f.amount_paid || 0), 0);
        const now = new Date();
        const thisMonthCollected = list
          .filter((f: any) => {
            if (!f.due_date) return false;
            const d = new Date(f.due_date);
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
          })
          .reduce((sum: number, f: any) => sum + (f.amount_paid || 0), 0);
        const text = `Total collected so far is ${inr(totalCollected)}. Based on due dates falling in this month, approximately ${inr(thisMonthCollected)} is tied to this month's fees - note this school doesn't track a separate payment date, so the monthly figure is estimated from due dates rather than actual payment timing.`;
        return new Response(JSON.stringify({ type: "message", text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "student_lookup": {
        if (!args.student_name) {
          return new Response(JSON.stringify({ type: "message", text: "Which student's fees would you like me to look up?" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const { data: records } = await supabase
          .from("fee_payments")
          .select("student_name, class_grade, section, amount_due, amount_paid, due_date, status")
          .eq("school_id", school_id)
          .ilike("student_name", `%${args.student_name}%`)
          .order("due_date", { ascending: false })
          .limit(1);
        if (!records || records.length === 0) {
          return new Response(JSON.stringify({ type: "message", text: `No fee record found for "${args.student_name}".` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const f = records[0] as any;
        const balance = Math.max((f.amount_due || 0) - (f.amount_paid || 0), 0);
        const text = `${f.student_name}${f.class_grade ? ` (${f.class_grade}${f.section ? ` ${f.section}` : ""})` : ""}: ${inr(f.amount_due)} due, ${inr(f.amount_paid)} paid, balance ${inr(balance)}. Status: ${f.status}${f.due_date ? `, due ${new Date(f.due_date).toLocaleDateString()}` : ""}.`;
        return new Response(JSON.stringify({ type: "message", text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "resend_receipt": {
        if (!args.student_name) {
          return new Response(JSON.stringify({ type: "message", text: "Which student's receipt would you like resent?" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const { data: paidRecord } = await supabase
          .from("fee_payments")
          .select("id, student_name")
          .eq("school_id", school_id)
          .eq("status", "paid")
          .ilike("student_name", `%${args.student_name}%`)
          .order("due_date", { ascending: false })
          .maybeSingle();
        if (!paidRecord) {
          return new Response(JSON.stringify({ type: "message", text: `I couldn't find a paid fee record for "${args.student_name}" to resend a receipt for.` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          type: "action_confirm",
          action: "resend_receipt",
          fee_id: (paidRecord as any).id,
          student_name: (paidRecord as any).student_name,
          text: `Resend the payment receipt to ${(paidRecord as any).student_name}?`,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "add_fee": {
        if (!args.student_name || !args.amount) {
          return new Response(JSON.stringify({ type: "message", text: "Tell me the student's name and the fee amount to add." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const amount = Number(args.amount);
        if (!amount || amount <= 0) {
          return new Response(JSON.stringify({ type: "message", text: "That doesn't look like a valid amount." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const category = VALID_CATEGORIES.includes(args.category) ? args.category : "other";
        const { data: students } = await supabase
          .from("students")
          .select("id, full_name, class, section")
          .eq("school_id", school_id)
          .ilike("full_name", `%${args.student_name}%`)
          .limit(5);
        const list = students || [];
        if (list.length === 0) {
          return new Response(JSON.stringify({ type: "message", text: `No student found matching "${args.student_name}".` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (list.length > 1) {
          const names = list.map((s: any) => `${s.full_name}${s.class ? ` (${s.class}${s.section ? ` ${s.section}` : ""})` : ""}`).join(", ");
          return new Response(JSON.stringify({ type: "message", text: `I found multiple students matching "${args.student_name}": ${names}. Could you specify which one, e.g. with their class?` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const student = list[0] as any;
        const dueDate = typeof args.due_date === "string" && args.due_date.length > 0 ? args.due_date : null;
        return new Response(JSON.stringify({
          type: "action_confirm",
          action: "add_fee",
          student_id: student.id,
          student_name: student.full_name,
          class_grade: student.class,
          section: student.section,
          amount,
          category,
          due_date: dueDate,
          text: `Add a ${CATEGORY_LABELS[category]} fee of ${inr(amount)} for ${student.full_name}${dueDate ? ` due ${new Date(dueDate).toLocaleDateString()}` : " with no due date set"}?`,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "record_payment": {
        if (!args.student_name || !args.amount) {
          return new Response(JSON.stringify({ type: "message", text: "Tell me the student's name and how much they paid." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const amount = Number(args.amount);
        if (!amount || amount <= 0) {
          return new Response(JSON.stringify({ type: "message", text: "That doesn't look like a valid amount." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const { data: openRecords } = await supabase
          .from("fee_payments")
          .select("id, student_name, amount_due, amount_paid, due_date, status")
          .eq("school_id", school_id)
          .ilike("student_name", `%${args.student_name}%`)
          .in("status", ["pending", "overdue"])
          .order("due_date", { ascending: true })
          .limit(1);
        let record = (openRecords || [])[0] as any;
        if (!record) {
          const { data: anyRecords } = await supabase
            .from("fee_payments")
            .select("id, student_name, amount_due, amount_paid, due_date, status")
            .eq("school_id", school_id)
            .ilike("student_name", `%${args.student_name}%`)
            .order("due_date", { ascending: false })
            .limit(1);
          record = (anyRecords || [])[0];
        }
        if (!record) {
          return new Response(JSON.stringify({ type: "message", text: `No fee record found for "${args.student_name}".` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          type: "action_confirm",
          action: "record_payment",
          fee_id: record.id,
          student_name: record.student_name,
          amount,
          amount_due: record.amount_due,
          current_paid: record.amount_paid,
          due_date: record.due_date,
          text: `Record a payment of ${inr(amount)} for ${record.student_name}${record.due_date ? ` (due ${new Date(record.due_date).toLocaleDateString()})` : ""}?`,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "delete_fee": {
        if (!args.student_name) {
          return new Response(JSON.stringify({ type: "message", text: "Which student's fee record should I delete?" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const { data: records } = await supabase
          .from("fee_payments")
          .select("id, student_name, amount_due, amount_paid, due_date, status")
          .eq("school_id", school_id)
          .ilike("student_name", `%${args.student_name}%`)
          .order("due_date", { ascending: false })
          .limit(5);
        const list = (records || []) as any[];
        if (list.length === 0) {
          return new Response(JSON.stringify({ type: "message", text: `No fee record found for "${args.student_name}".` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        let target = list[0];
        if (args.due_date) {
          const match = list.find((r) => r.due_date === args.due_date);
          if (match) target = match;
        } else {
          const openOnes = list.filter((r) => r.status !== "paid");
          if (openOnes.length > 0) target = openOnes[0];
        }
        const multipleNote = list.length > 1
          ? " This student has more than one fee record - if this isn't the one you meant, cancel and tell me the due date of the record to delete."
          : "";
        return new Response(JSON.stringify({
          type: "action_confirm",
          action: "delete_fee",
          fee_id: target.id,
          student_name: target.student_name,
          amount_due: target.amount_due,
          due_date: target.due_date,
          text: `Delete the fee record for ${target.student_name} (${inr(target.amount_due)} due${target.due_date ? `, due ${new Date(target.due_date).toLocaleDateString()}` : ""})? This cannot be undone.${multipleNote}`,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      default:
        return new Response(JSON.stringify({ type: "message", text: args.chat_reply || "I can help with fee summaries, dues lookups, collections, adding fees (any category), recording payments, deleting records, or navigating the fee module." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (e) {
    console.error("erp-fee-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
