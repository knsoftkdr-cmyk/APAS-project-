import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeHistory, historyToContents, type HistoryTurn } from "../_shared/history.ts";

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
          class_name: { type: "STRING", description: "Class/grade of the student if mentioned - also when it comes as a short follow-up like 'Class one' or '1 A'. Plain value, e.g. 'one' -> '1', 'Class 1' -> '1', 'UKG'." },
          section: { type: "STRING", description: "Section letter of the student if mentioned, e.g. 'A'." },
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

const jsonRes = (obj: unknown) =>
  new Response(JSON.stringify(obj), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ---- class / section matching (handles "Class one", "1st", "Grade 1", "1 A", "UKG") ----
const WORD_NUM: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
  first: "1", second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10", eleventh: "11", twelfth: "12",
};
function normClass(v: unknown): string {
  let t = String(v ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/\b(class|grade|std|standard)\b/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1");
  t = t.split(" ").map((w) => WORD_NUM[w] ?? w).join(" ");
  return t.replace(/\s+/g, "");
}
function narrowByClass<T>(rows: T[], cls: (r: T) => unknown, sec: (r: T) => unknown, args: any): T[] {
  const wantClass = normClass(args.class_name);
  const wantSec = normClass(args.section);
  if (!wantClass && !wantSec) return rows;
  return rows.filter((r) => {
    const rc = normClass(cls(r));
    const rs = normClass(sec(r));
    const classOk = !wantClass || wantClass === rc || wantClass === rc + rs; // "1" or "1a"
    const secOk = !wantSec || wantSec === rs;
    return classOk && secOk;
  });
}
const classLabel = (cls: unknown, sec: unknown) => (cls ? ` (${cls}${sec ? ` ${sec}` : ""})` : "");

// For fee_payments rows: narrow by class/section if given, then make sure only ONE student remains.
function resolveFeeRows(rows: any[], args: any): { rows: any[]; message?: string } {
  const narrowed = narrowByClass(rows, (r) => r.class_grade, (r) => r.section, args);
  const uniqLabels = (list: any[]) =>
    [...new Set(list.map((r) => `${r.student_name}${classLabel(r.class_grade, r.section)}`))].join(", ");
  if (rows.length > 0 && narrowed.length === 0) {
    return { rows: [], message: `I couldn't find "${args.student_name}" in that class. Students with that name: ${uniqLabels(rows)}.` };
  }
  const keys = new Set(narrowed.map((r) => `${String(r.student_name).toLowerCase()}|${normClass(r.class_grade)}|${normClass(r.section)}`));
  if (keys.size > 1) {
    return { rows: [], message: `I found multiple students matching "${args.student_name}": ${uniqLabels(narrowed)}. Which class (and section) do you mean?` };
  }
  return { rows: narrowed };
}

// If the last assistant turn asked "which student?" and the user just replied with a short
// class/section answer, glue it back onto the ORIGINAL request so nothing gets lost.
const AMBIG_RE = /I found multiple students matching/i;
const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
function mergeClarification(message: string, history: HistoryTurn[]): string {
  let i = history.length - 1;
  if (!(i >= 1 && history[i].role === "assistant" && AMBIG_RE.test(history[i].text) && wordCount(message) <= 8)) return message;
  const clarifications = [message.trim()];
  let original = "";
  while (i >= 1 && history[i].role === "assistant" && AMBIG_RE.test(history[i].text) && history[i - 1]?.role === "user") {
    const u = history[i - 1].text;
    const earlierAmbig = i - 2 >= 1 && history[i - 2].role === "assistant" && AMBIG_RE.test(history[i - 2].text);
    if (earlierAmbig && wordCount(u) <= 8) { clarifications.unshift(u); i -= 2; continue; }
    original = u;
    break;
  }
  if (!original) return message;
  return `${original}\n(Which student: ${clarifications.join(", ")})`;
}

async function callGemini(systemPrompt: string, userPrompt: string, keys: string[], history: HistoryTurn[] = []): Promise<any | null> {
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
              contents: [...historyToContents(history), { role: "user", parts: [{ text: userPrompt }] }],
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
    const { message, school_id, history: rawHistory } = await req.json();
    const history = sanitizeHistory(rawHistory);
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
- chat: ONLY for greetings, small talk, or truly unrelated questions - reply briefly in chat_reply. Do NOT use chat to say a fee-related action is unsupported; every fee-related request maps to one of the intents above.

Whenever the user mentions a class or section for the student - even as a short reply such as "Class one" or "1 A" - set class_name (and section). Always keep the other fields (student_name, amount, category, due_date) from the original request.\n\nCONVERSATION MEMORY: Earlier turns are provided. If the user's message is a short follow-up (e.g. just a student name, an amount, "yes that one", "and for him?"), combine it with what was asked earlier and pick the intent and fields for the ORIGINAL request - do not treat it as a new unrelated message.`;

    const effectiveMessage = mergeClarification(message, history);
    const candidate = await callGemini(systemPrompt, effectiveMessage, keys, history);
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
        if (!args.student_name) return jsonRes({ type: "message", text: "Which student's fees would you like me to look up?" });
        const { data: rows } = await supabase
          .from("fee_payments")
          .select("student_name, class_grade, section, amount_due, amount_paid, due_date, status")
          .eq("school_id", school_id)
          .ilike("student_name", `%${args.student_name}%`)
          .order("due_date", { ascending: false })
          .limit(30);
        if (!rows || rows.length === 0) return jsonRes({ type: "message", text: `No fee record found for "${args.student_name}".` });
        const r = resolveFeeRows(rows as any[], args);
        if (r.message) return jsonRes({ type: "message", text: r.message });
        const f = r.rows[0] as any;
        const balance = Math.max((f.amount_due || 0) - (f.amount_paid || 0), 0);
        const text = `${f.student_name}${classLabel(f.class_grade, f.section)}: ${inr(f.amount_due)} due, ${inr(f.amount_paid)} paid, balance ${inr(balance)}. Status: ${f.status}${f.due_date ? `, due ${new Date(f.due_date).toLocaleDateString()}` : ""}.`;
        return jsonRes({ type: "message", text });
      }

      case "resend_receipt": {
        if (!args.student_name) return jsonRes({ type: "message", text: "Which student's receipt would you like resent?" });
        const { data: rows } = await supabase
          .from("fee_payments")
          .select("id, student_name, class_grade, section")
          .eq("school_id", school_id)
          .eq("status", "paid")
          .ilike("student_name", `%${args.student_name}%`)
          .order("due_date", { ascending: false })
          .limit(30);
        if (!rows || rows.length === 0) {
          return jsonRes({ type: "message", text: `I couldn't find a paid fee record for "${args.student_name}" to resend a receipt for.` });
        }
        const r = resolveFeeRows(rows as any[], args);
        if (r.message) return jsonRes({ type: "message", text: r.message });
        const paidRecord = r.rows[0] as any;
        return jsonRes({
          type: "action_confirm",
          action: "resend_receipt",
          fee_id: paidRecord.id,
          student_name: paidRecord.student_name,
          text: `Resend the payment receipt to ${paidRecord.student_name}${classLabel(paidRecord.class_grade, paidRecord.section)}?`,
        });
      }

      case "add_fee": {
        if (!args.student_name || !args.amount) {
          return jsonRes({ type: "message", text: "Tell me the student's name and the fee amount to add." });
        }
        const amount = Number(args.amount);
        if (!amount || amount <= 0) return jsonRes({ type: "message", text: "That doesn't look like a valid amount." });
        const category = VALID_CATEGORIES.includes(args.category) ? args.category : "other";
        const { data: students } = await supabase
          .from("students")
          .select("id, full_name, class, section")
          .eq("school_id", school_id)
          .ilike("full_name", `%${args.student_name}%`)
          .limit(30);
        const all = (students || []) as any[];
        if (all.length === 0) return jsonRes({ type: "message", text: `No student found matching "${args.student_name}".` });
        const list = narrowByClass(all, (s: any) => s.class, (s: any) => s.section, args);
        const labels = (l: any[]) => l.map((s: any) => `${s.full_name}${classLabel(s.class, s.section)}`).join(", ");
        if (list.length === 0) {
          return jsonRes({ type: "message", text: `I couldn't find "${args.student_name}" in that class. Students with that name: ${labels(all)}.` });
        }
        if (list.length > 1) {
          return jsonRes({ type: "message", text: `I found multiple students matching "${args.student_name}": ${labels(list)}. Could you specify which one, e.g. with their class and section?` });
        }
        const student = list[0] as any;
        const dueDate = typeof args.due_date === "string" && args.due_date.length > 0 ? args.due_date : null;
        return jsonRes({
          type: "action_confirm",
          action: "add_fee",
          student_id: student.id,
          student_name: student.full_name,
          class_grade: student.class,
          section: student.section,
          amount,
          category,
          due_date: dueDate,
          text: `Add a ${CATEGORY_LABELS[category]} fee of ${inr(amount)} for ${student.full_name}${classLabel(student.class, student.section)}${dueDate ? ` due ${new Date(dueDate).toLocaleDateString()}` : " with no due date set"}?`,
        });
      }

      case "record_payment": {
        if (!args.student_name || !args.amount) {
          return jsonRes({ type: "message", text: "Tell me the student's name and how much they paid." });
        }
        const amount = Number(args.amount);
        if (!amount || amount <= 0) return jsonRes({ type: "message", text: "That doesn't look like a valid amount." });
        const { data: rows } = await supabase
          .from("fee_payments")
          .select("id, student_name, class_grade, section, amount_due, amount_paid, due_date, status")
          .eq("school_id", school_id)
          .ilike("student_name", `%${args.student_name}%`)
          .order("due_date", { ascending: true })
          .limit(30);
        if (!rows || rows.length === 0) return jsonRes({ type: "message", text: `No fee record found for "${args.student_name}".` });
        const r = resolveFeeRows(rows as any[], args);
        if (r.message) return jsonRes({ type: "message", text: r.message });
        // earliest open (pending/overdue) record, otherwise the latest record
        const record = (r.rows.find((x: any) => x.status === "pending" || x.status === "overdue") ?? r.rows[r.rows.length - 1]) as any;
        return jsonRes({
          type: "action_confirm",
          action: "record_payment",
          fee_id: record.id,
          student_name: record.student_name,
          amount,
          amount_due: record.amount_due,
          current_paid: record.amount_paid,
          due_date: record.due_date,
          text: `Record a payment of ${inr(amount)} for ${record.student_name}${classLabel(record.class_grade, record.section)}${record.due_date ? ` (due ${new Date(record.due_date).toLocaleDateString()})` : ""}?`,
        });
      }

      case "delete_fee": {
        if (!args.student_name) return jsonRes({ type: "message", text: "Which student's fee record should I delete?" });
        const { data: rows } = await supabase
          .from("fee_payments")
          .select("id, student_name, class_grade, section, amount_due, amount_paid, due_date, status")
          .eq("school_id", school_id)
          .ilike("student_name", `%${args.student_name}%`)
          .order("due_date", { ascending: false })
          .limit(30);
        if (!rows || rows.length === 0) return jsonRes({ type: "message", text: `No fee record found for "${args.student_name}".` });
        const r = resolveFeeRows(rows as any[], args);
        if (r.message) return jsonRes({ type: "message", text: r.message });
        const list = r.rows.slice(0, 5) as any[];
        let target = list[0];
        if (args.due_date) {
          const match = list.find((x) => x.due_date === args.due_date);
          if (match) target = match;
        } else {
          const openOnes = list.filter((x) => x.status !== "paid");
          if (openOnes.length > 0) target = openOnes[0];
        }
        const multipleNote = list.length > 1
          ? " This student has more than one fee record - if this isn't the one you meant, cancel and tell me the due date of the record to delete."
          : "";
        return jsonRes({
          type: "action_confirm",
          action: "delete_fee",
          fee_id: target.id,
          student_name: target.student_name,
          amount_due: target.amount_due,
          due_date: target.due_date,
          text: `Delete the fee record for ${target.student_name}${classLabel(target.class_grade, target.section)} (${inr(target.amount_due)} due${target.due_date ? `, due ${new Date(target.due_date).toLocaleDateString()}` : ""})? This cannot be undone.${multipleNote}`,
        });
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
