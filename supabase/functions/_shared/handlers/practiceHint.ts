// supabase/functions/_shared/handlers/practiceHint.ts
//
// Hint Engine for adaptive-practice questions. Never a standalone edge function (Edge Function deployment
// limit): `cat-session` routes to it via action "practice_hint" - see _shared/mergedRouter.ts.
//
//   Body: { session_id: uuid, item_id: uuid, language?: "en" | "hi" | "te" | ... }
//
//   Response: { hint_level: 1|2|3, hint: string, max_level: 3, hints_used: number, more_available: boolean }
//
// PROGRESSIVE: each call hands out the NEXT hint for that (session, question): 1 = a nudge, 2 = narrows the
// approach, 3 = nearly there (rules out wrong directions) - never the answer. The level is decided here from
// practice_hint_usage, not by the client, so hint 3 can't be requested first. Once all three are used the
// last one is returned again.
//
// SAFE BY CONSTRUCTION
//   * Students only; the session must be theirs, in_progress, mode = "practice" (formal assessments get no
//     hints) and `item_id` must be the question currently pending in it. Hints are derived from the answer
//     key, so this stops anyone using the endpoint to harvest hints for questions they haven't been served.
//   * Generated hints are screened for answer leaks (correct option text / "the answer is B"); a hint that
//     leaks is replaced by a generic safe one rather than shown.
//   * Grading is untouched: hints are logged in practice_hint_usage but do not change scoring (yet).
//
// One model call per (question, language) ever - all three hints are generated together and cached in
// question_hints.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { languageDirective, normaliseLanguageCode, resolveTeachingLanguage } from "../languages.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-2.5-flash";
const AI_URL = Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_TIMEOUT_MS = 45_000;
export const MAX_LEVEL = 3;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export async function handlePracticeHint(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new HttpError(401, "Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userError } = await asCaller.auth.getUser();
    if (userError || !user) throw new HttpError(401, "Not authenticated");

    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!profile) throw new HttpError(403, "Profile not found");
    if (profile.role !== "student") throw new HttpError(403, "Hints are for students");

    const { data: student } = await admin.from("students").select("id").eq("profile_id", user.id).single();
    if (!student?.id) throw new HttpError(403, "Student record not found");

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.session_id ?? "");
    const itemId = String(body.item_id ?? "");
    if (!sessionId || !itemId) throw new HttpError(400, "session_id and item_id are required");
    const lang = resolveTeachingLanguage(body.language);
    const langCode = normaliseLanguageCode(body.language);

    // ── Gate: my live practice session, and this exact question is the one on screen ──
    const { data: session } = await admin.from("cat_sessions")
      .select("id, student_id, status, mode, pending_item_id").eq("id", sessionId).maybeSingle();
    if (!session || session.student_id !== student.id) throw new HttpError(403, "Not your session");
    if (session.status !== "in_progress") throw new HttpError(409, "This practice round is already finished", "session_not_active");
    if (session.mode !== "practice") throw new HttpError(403, "Hints are only available in practice, not in tests", "hints_not_allowed");
    if (session.pending_item_id !== itemId) throw new HttpError(409, "That question is not the current one", "item_not_pending");

    // ── Next level on the ladder ──
    const { data: usage } = await admin.from("practice_hint_usage")
      .select("hints_used").eq("session_id", sessionId).eq("item_id", itemId).maybeSingle();
    const used = Number(usage?.hints_used ?? 0);
    const level = Math.min(MAX_LEVEL, used + 1);

    // ── Hints: cache first, then generate all three at once ──
    let hints: string[] | null = null;
    let cacheUsable = true;
    {
      const { data: cached, error } = await admin.from("question_hints")
        .select("hints").eq("item_id", itemId).eq("language", langCode).maybeSingle();
      if (error) {
        cacheUsable = false;
        console.warn("question_hints read failed (migration applied?):", error.message);
      } else if (Array.isArray(cached?.hints) && cached.hints.length === MAX_LEVEL) {
        hints = cached.hints as string[];
      }
    }

    if (!hints) {
      const apiKey = Deno.env.get("LOVABLE_API_KEY");
      if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

      const { data: item } = await admin.from("question_bank")
        .select("id, stem, options, correct_option, explanation, learning_objective_id").eq("id", itemId).single();
      if (!item) throw new HttpError(404, "Question not found");

      const { data: lo } = await admin.from("learning_objectives")
        .select("objective_text").eq("id", item.learning_objective_id).maybeSingle();

      const raw = await callModel(apiKey, buildPrompt(item, lo?.objective_text ?? null, lang));
      hints = screenHints(raw, item);

      if (cacheUsable) {
        const { error } = await admin.from("question_hints")
          .insert({ item_id: itemId, language: langCode, hints, model: MODEL });
        if (error && error.code !== "23505") console.warn("question_hints write failed:", error.message);
      }
    }

    // ── Record usage (only after a hint is actually in hand) ──
    const hintsUsed = Math.max(used, level);
    const { error: uErr } = await admin.from("practice_hint_usage").upsert({
      session_id: sessionId, item_id: itemId, student_id: student.id,
      hints_used: hintsUsed, updated_at: new Date().toISOString(),
    }, { onConflict: "session_id,item_id" });
    if (uErr) console.warn("practice_hint_usage write failed:", uErr.message);

    return json({
      hint_level: level,
      hint: hints[level - 1],
      max_level: MAX_LEVEL,
      hints_used: hintsUsed,
      more_available: hintsUsed < MAX_LEVEL,
    });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error("practice-hint error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}

// ── Prompt / model ───────────────────────────────────────────────────────────
function buildPrompt(item: Row, objective: string | null, lang: ReturnType<typeof resolveTeachingLanguage>): string {
  const opts = Object.entries((item.options ?? {}) as Record<string, string>).map(([k, v]) => `${k}. ${v}`).join("\n");
  return `You are writing a 3-step HINT LADDER for a student who is stuck on a multiple-choice question. The student can see the question and options. You know the correct answer; the student must NOT be told it.

Question: ${item.stem}
Options:
${opts}
Correct option (SECRET): ${item.correct_option}
${item.explanation ? `Reference explanation (SECRET): ${item.explanation}\n` : ""}${objective ? `Learning objective: ${objective}\n` : ""}
Write exactly three hints, each one progressively more helpful:
1. A gentle nudge: what idea or concept to think about, or one question to ask themselves. No facts that decide between the options.
2. Narrow it down: which rule/fact/method applies and how to use it to compare the options, without saying which option is right.
3. Nearly there: show the key reasoning step and, if helpful, say which kinds of options can be ruled out and why - but still do NOT say or strongly imply which letter is correct, and do NOT quote the correct option's wording.

Rules: each hint 1-3 short sentences; never write the correct option letter as the answer; never say "the answer is"; never reveal the reference explanation verbatim; do not mention that you were given a secret answer.${languageDirective(lang)}

Return STRICT JSON ONLY, no markdown: {"hints": ["hint 1", "hint 2", "hint 3"]}`;
}

async function callModel(apiKey: string, prompt: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const resp = await fetch(AI_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "You output strict JSON only. No markdown, no commentary." },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
      }),
    });
    if (resp.status === 429) throw new HttpError(429, "Hints are busy right now. Please try again in a moment.");
    if (resp.status === 402) throw new HttpError(402, "AI credits exhausted. Please contact your administrator.");
    if (!resp.ok) throw new Error(`AI gateway error ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "{}";
    const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new HttpError(502, "Could not build a hint right now. Please try again.");
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new HttpError(504, "The hint took too long. Please try again.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Validation + leak screening ──────────────────────────────────────────────
const SAFE_FALLBACK = [
  "Re-read the question slowly and underline the key word or quantity it is really asking about.",
  "Think about which rule, fact or formula from this chapter connects to that key word, then test each option against it.",
  "Compare the options one by one against that rule and cross out any that clearly break it - the one that remains is worth choosing.",
];

const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}]+/g, " ").trim();

/** True when `hint` gives the answer away: states the correct letter as the answer, or quotes the correct option. */
export function leaksAnswer(hint: string, item: Row): boolean {
  const letter = String(item.correct_option ?? "").toUpperCase();
  const correctText = String((item.options ?? {})[letter] ?? "");

  // "the answer is B", "correct answer: (B)", "option B is correct", "B is the right answer"
  const L = letter.replace(/[^A-D]/g, "");
  if (L) {
    const patterns = [
      new RegExp(`(answer|correct|right)[^.\\n]{0,25}\\b\\(?${L}\\)?(?![a-z])`, "i"),
      new RegExp(`\\b(option|choice)\\s*\\(?${L}\\)?\\s*(is|would be|must be)\\b`, "i"),
      new RegExp(`\\b\\(?${L}\\)?\\s+is\\s+(the\\s+)?(correct|right)`, "i"),
    ];
    if (patterns.some((re) => re.test(hint))) return true;
  }

  // Quoting the correct option: only when it is distinctive (long enough, and not contained in a wrong option)
  const c = norm(correctText);
  if (c.length >= 4) {
    const otherHas = Object.entries((item.options ?? {}) as Record<string, string>)
      .some(([k, v]) => k.toUpperCase() !== letter && norm(String(v)).includes(c));
    if (!otherHas && norm(hint).includes(c)) return true;
  }
  return false;
}

export function screenHints(raw: unknown, item: Row): string[] {
  const arr = Array.isArray((raw as Row)?.hints) ? ((raw as Row).hints as unknown[]) : [];
  return Array.from({ length: MAX_LEVEL }, (_, i) => {
    const h = typeof arr[i] === "string" ? (arr[i] as string).trim().slice(0, 600) : "";
    return h && !leaksAnswer(h, item) ? h : SAFE_FALLBACK[i];
  });
}
