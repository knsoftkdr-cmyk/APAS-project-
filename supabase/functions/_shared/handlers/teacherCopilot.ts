// supabase/functions/_shared/handlers/teacherCopilot.ts
//
// TEACHER COPILOT. Not a standalone edge function (deployment limit): `ai-teacher-assistant` routes to it
// via action "copilot" - see _shared/mergedRouter.ts. The anchor's original behaviour (body without an
// `action`) is untouched.
//
// Staff only. Body:
//   { action: "copilot", message, task?, class_id?, book_id?, student_id?, history? }
//   task: "auto" (default) | "lesson_plan" | "assessment" | "remediation" | "student_analysis" | "general"
//
// One assistant for lesson planning, assessment design, remediation and student analysis, GROUNDED in the
// same data the dashboards use: class weak topics, peer groups, remedial/regular/enrichment tiers, early-warning
// risk, misconceptions. Access follows the same rules as the dashboards (a teacher only reaches classes they
// teach and students on those rosters).
//
// Privacy: student names never leave the system. Names in the context AND in the teacher's own message /
// history are replaced with tokens (STU_01...) before the model call, and restored in the reply.

// deno-lint-ignore-file no-explicit-any
import { canStaffAccessClass, canStaffAccessStudent } from "../studentAccess.ts";
import { clusterPeerGroups, DEFAULT_TIER_OPTIONS, type StudentSignal } from "../learningGroupsCore.ts";
import {
  authenticateStaff, corsHeaders, json, loadClassSignals, parseBookId, UUID_RE, type AuthContext,
} from "../learningGroupsData.ts";
import { computeTierView } from "./dynamicGroups.ts";

type Row = Record<string, any>;

const MODEL = "google/gemini-2.5-flash";
const AI_URL = Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions";
const TASKS = ["auto", "lesson_plan", "assessment", "remediation", "student_analysis", "general"] as const;
type Task = typeof TASKS[number];
const MAX_MESSAGE = 4000;
const MAX_HISTORY = 8;

export function detectTask(message: string, hasStudent: boolean): Exclude<Task, "auto"> {
  const m = message.toLowerCase();
  if (/\b(lesson|period plan|warm-?up|starter|lesson plan)\b/.test(m)) return "lesson_plan";
  if (/\b(quiz|test|exam|assessment|worksheet|rubric|mcqs?|question paper|questions)\b/.test(m)) return "assessment";
  if (/\b(remedi\w*|catch[- ]?up|intervention|re-?teach|struggl\w*|misconception\w*|support plan)\b/.test(m)) return "remediation";
  if (hasStudent || /\b(analy[sz]e|progress|strengths?|weakness\w*|performance of|how is)\b/.test(m)) return "student_analysis";
  return "general";
}

const TASK_GUIDE: Record<Exclude<Task, "auto">, string> = {
  lesson_plan:
    "Produce a differentiated lesson plan: learning objective, duration split, warm-up, direct teaching, guided practice, and a " +
    "3-tier task set (support / core / extension) that maps to the remedial / regular / enrichment groups in CONTEXT when present, " +
    "plus an exit ticket. Target the class's weakest topics in CONTEXT unless the teacher names a topic.",
  assessment:
    "Design an assessment: a short blueprint (topics, question types, difficulty mix, marks), then sample questions with model " +
    "answers and a marking scheme/rubric. Weight it toward topics the CONTEXT shows are weak, and include a few stretch items. " +
    "Say which questions diagnose which misconception when misconceptions are present.",
  remediation:
    "Produce a remediation plan: the specific gaps and misconceptions to fix (from CONTEXT), a short sequenced set of activities " +
    "(re-teach, worked examples, practice, check for understanding), time needed, and a measurable success criterion for exiting remediation.",
  student_analysis:
    "Analyse the student(s) in CONTEXT: strengths, gaps, learning pace, risk signals and what is driving them, then 3-5 concrete next " +
    "steps for the teacher and suggested talking points for a parent conversation. Describe patterns, do not diagnose.",
  general:
    "Answer the teacher's question directly and practically, using CONTEXT where it is relevant.",
};

// ─────────────────────────────────────────────────────────────────────────────────────────────

class Aliaser {
  private nameToToken = new Map<string, string>();
  private tokenToName = new Map<string, string>();
  constructor(students: Array<{ student_id: string; full_name: string }>) {
    [...students].sort((a, b) => a.student_id.localeCompare(b.student_id)).forEach((s, i) => {
      const token = `STU_${String(i + 1).padStart(2, "0")}`;
      this.nameToToken.set(s.student_id, token);
      this.tokenToName.set(token, s.full_name);
    });
    this.names = [...students].filter((s) => s.full_name && s.full_name.trim().length >= 3)
      .sort((a, b) => b.full_name.length - a.full_name.length); // longest first so "Anna Maria" wins over "Anna"
  }
  private names: Array<{ student_id: string; full_name: string }>;
  token(id: string) { return this.nameToToken.get(id) ?? "a student"; }
  /** Real names typed by the teacher -> tokens. */
  scrub(text: string): string {
    let out = text;
    for (const s of this.names) {
      const esc = s.full_name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`\\b${esc}\\b`, "gi"), this.token(s.student_id));
    }
    return out;
  }
  /** Tokens in the model's reply -> real names. Unknown tokens become a neutral phrase. */
  restore(text: string): string {
    return text.replace(/STU_(\d{2,3})/g, (m) => this.tokenToName.get(m) ?? "a student");
  }
}

const pct = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 100));

function classWeakTopics(signals: StudentSignal[]) {
  const tally = new Map<number, { name: string; chapter: string; scores: number[] }>();
  for (const s of signals) for (const t of s.topics) {
    const e = tally.get(t.topic_id) ?? { name: t.topic_name, chapter: t.chapter_name, scores: [] };
    e.scores.push(t.score); tally.set(t.topic_id, e);
  }
  return [...tally.entries()].map(([id, e]) => ({
    topic_id: id, topic: e.name, chapter: e.chapter,
    class_avg_pct: pct(e.scores.reduce((a, b) => a + b, 0) / e.scores.length),
    students_weak: e.scores.filter((x) => x < 0.5).length, students_assessed: e.scores.length,
  })).sort((a, b) => (a.class_avg_pct ?? 100) - (b.class_avg_pct ?? 100)).slice(0, 8);
}

async function buildClassContext(ctx: AuthContext, classId: string, studentIds: string[], bookId: number | null) {
  const view = await computeTierView(ctx, classId, studentIds, bookId, 3, DEFAULT_TIER_OPTIONS);
  const { loaded } = view;
  const peer = clusterPeerGroups(loaded.signals);
  const alias = new Aliaser(loaded.signals);
  const sig = new Map(loaded.signals.map((s) => [s.student_id, s]));
  const place = new Map(view.placements.map((p) => [p.student_id, p]));

  const context = {
    class: loaded.className,
    roster_size: studentIds.length,
    assessed_students: loaded.signals.filter((s) => s.score !== null).length,
    weakest_topics: classWeakTopics(loaded.signals),
    performance_groups: view.tiers.map((t) => ({
      group: t.tier, students: t.student_ids.map((id) => alias.token(id)), avg_performance_pct: pct(t.avg_composite),
      focus_topics: t.focus_topics.map((f) => f.topic_name),
    })),
    peer_groups: peer.groups.map((g) => ({
      kind: g.kind, label: g.label, students: g.members.map((m) => alias.token(m.student_id)),
      shared_needs: g.shared_needs.map((n) => n.topic_name),
    })),
    students: loaded.signals.map((s) => ({
      id: alias.token(s.student_id),
      mastery_pct: pct(s.score),
      group: place.get(s.student_id)?.tier ?? null,
      pace: s.pace, early_warning_risk: s.risk,
      weakest_topics: [...s.topics].sort((a, b) => a.score - b.score).slice(0, 2).filter((t) => t.score < 0.5).map((t) => t.topic_name),
    })),
  };
  return { context, alias, className: loaded.className, warnings: loaded.warnings, signals: loaded.signals };
}

function flattenTopics(tree: Row[]): Array<{ topic: string; chapter: string; subject: string; p: number; attempted: number }> {
  const out: Array<{ topic: string; chapter: string; subject: string; p: number; attempted: number }> = [];
  for (const subj of tree ?? []) for (const ch of subj.chapters ?? []) for (const t of ch.topics ?? []) {
    out.push({ topic: t.name, chapter: ch.name, subject: subj.subject, p: Number(t.p_mastery), attempted: Number(t.attempted_count ?? 0) });
  }
  return out;
}

async function buildStudentContext(ctx: AuthContext, studentId: string, bookId: number | null, alias: Aliaser | null) {
  const { admin } = ctx;
  const [{ data: st }, tree, misc, risk] = await Promise.all([
    admin.from("students").select("id, full_name, class, section").eq("id", studentId).maybeSingle(),
    ctx.userClient.rpc("get_student_mastery_tree", { p_student_id: studentId, p_book_id: bookId }),
    ctx.userClient.rpc("get_student_misconceptions", { p_student_id: studentId, p_min_occurrences: 2, p_book_id: bookId }),
    ctx.userClient.rpc("get_student_risk_core", { p_student_id: studentId }),
  ]);
  const a = alias ?? new Aliaser([{ student_id: studentId, full_name: st?.full_name ?? "Student" }]);
  const topics = flattenTopics(Array.isArray(tree.data) ? tree.data : []).filter((t) => t.attempted > 0);
  const byWeak = [...topics].sort((x, y) => x.p - y.p);
  const context = {
    student: a.token(studentId),
    grade: st ? `${st.class ?? ""} ${st.section ?? ""}`.trim() || null : null,
    weakest_topics: byWeak.slice(0, 6).map((t) => ({ topic: t.topic, chapter: t.chapter, subject: t.subject, mastery_pct: pct(t.p) })),
    strongest_topics: [...topics].sort((x, y) => y.p - x.p).slice(0, 4).map((t) => ({ topic: t.topic, subject: t.subject, mastery_pct: pct(t.p) })),
    misconceptions: (Array.isArray(misc.data) ? misc.data : []).slice(0, 5).map((m: Row) => ({
      misconception: m.misconception_text, topic: m.topic_name, severity: m.severity, times_seen: m.occurrence_count, correction_hint: m.correction_hint,
    })),
    risk_signals: ((risk.data?.causes ?? []) as Row[]).filter((c) => ["strong", "moderate"].includes(c.evidence_strength)).map((c) => ({
      signal: c.cause_type, strength: c.evidence_strength, detail: c.explanation,
    })),
  };
  return { context, alias: a, studentName: st?.full_name ?? "Student" };
}

async function callModel(system: string, messages: Array<{ role: string; content: string }>) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw Object.assign(new Error("LOVABLE_API_KEY not configured"), { status: 500 });
  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, temperature: 0.4, max_tokens: 2200,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (resp.status === 429) throw Object.assign(new Error("The AI service is busy. Please try again in a moment."), { status: 429 });
  if (resp.status === 402) throw Object.assign(new Error("AI credits are exhausted. Please contact your administrator."), { status: 402 });
  if (!resp.ok) throw new Error(`AI gateway error ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (!text || !text.trim()) throw new Error("The AI returned an empty response");
  return text.trim();
}

export async function handleTeacherCopilot(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await authenticateStaff(req);
    if (!auth.ok) return auth.res;
    const { ctx } = auth;

    const body: Row = await req.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return json({ error: "message is required" }, 400);
    if (message.length > MAX_MESSAGE) return json({ error: `message must be at most ${MAX_MESSAGE} characters` }, 400);

    const taskIn: string = body.task ?? "auto";
    if (!(TASKS as readonly string[]).includes(taskIn)) return json({ error: `Unknown task "${taskIn}"` }, 400);

    const classId = body.class_id ?? null;
    if (classId !== null && (typeof classId !== "string" || !UUID_RE.test(classId))) return json({ error: "class_id must be a valid id" }, 400);
    const studentId = body.student_id ?? null;
    if (studentId !== null && (typeof studentId !== "string" || !UUID_RE.test(studentId))) return json({ error: "student_id must be a valid id" }, 400);
    const book = parseBookId(body.book_id);
    if (!book.ok) return json({ error: "book_id must be a positive integer" }, 400);

    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (body.history != null) {
      if (!Array.isArray(body.history)) return json({ error: "history must be an array" }, 400);
      for (const h of body.history.slice(-MAX_HISTORY)) {
        if (!h || (h.role !== "user" && h.role !== "assistant") || typeof h.content !== "string") return json({ error: "history entries need a role (user|assistant) and content" }, 400);
        history.push({ role: h.role, content: h.content.slice(0, MAX_MESSAGE) });
      }
    }

    const task: Exclude<Task, "auto"> = taskIn === "auto" ? detectTask(message, !!studentId) : (taskIn as Exclude<Task, "auto">);

    // ── access + grounding ───────────────────────────────────────────────────────────────────
    const grounded: string[] = [];
    const warnings: string[] = [];
    const contextParts: Row = {};
    let alias: Aliaser | null = null;
    let className: string | null = null;
    let studentName: string | null = null;

    if (classId) {
      const access = await canStaffAccessClass(ctx.admin, ctx.caller, classId);
      if (!access.ok) return json({ error: access.error }, access.status ?? 403);
      if (studentId && !(access.studentIds ?? []).includes(studentId)) return json({ error: "That student is not on the selected class roster" }, 400);
      if (access.studentIds?.length) {
        const built = await buildClassContext(ctx, classId, access.studentIds, book.value);
        contextParts.class = built.context; alias = built.alias; className = built.className; warnings.push(...built.warnings);
        grounded.push("class weak topics", "peer groups", "remedial / regular / enrichment groups", "learning pace and early-warning risk");
      } else {
        warnings.push("The selected class has no students on its roster.");
      }
    }

    if (studentId) {
      if (!classId) {
        const access = await canStaffAccessStudent(ctx.admin, ctx.caller, studentId);
        if (!access.ok) return json({ error: access.error }, access.status ?? 403);
      }
      const built = await buildStudentContext(ctx, studentId, book.value, alias);
      contextParts.focus_student = built.context; alias = built.alias; studentName = built.studentName;
      grounded.push("student mastery by topic", "misconceptions", "risk signals");
    }

    if (!classId && !studentId) {
      warnings.push("No class or student selected, so this answer is general. Pick a class to ground it in your students' data.");
    }

    // ── model call ───────────────────────────────────────────────────────────────────────────
    const scrub = (t: string) => (alias ? alias.scrub(t) : t);
    const system = [
      "You are APAS Teacher Copilot, an assistant for school teachers (K-12, Indian curriculum context).",
      "RULES:",
      "- Facts about the class or students come ONLY from CONTEXT. Never invent scores, topics, misconceptions or students. If CONTEXT lacks something you need, say so in one line and continue with clearly-labelled general assumptions.",
      "- Students appear as tokens like STU_01. Refer to them ONLY by these tokens, exactly as written. Never guess real names.",
      "- Describe learning patterns; do not diagnose disabilities or medical/psychological conditions.",
      "- Be concise and practical. Markdown with short headings and bullets. No filler, no preamble.",
      `TASK: ${task}. ${TASK_GUIDE[task]}`,
      `CONTEXT (JSON): ${JSON.stringify(contextParts)}`,
    ].join("\n");

    const raw = await callModel(system, [
      ...history.map((h) => ({ role: h.role, content: scrub(h.content) })),
      { role: "user", content: scrub(message) },
    ]);
    const reply = alias ? alias.restore(raw) : raw;

    const actions: Array<{ label: string; route: string }> = [];
    if (classId) actions.push({ label: "View learning groups", route: "/class-mastery" });
    if (task === "lesson_plan") actions.push({ label: "Open lesson plan generator", route: "/curative" });
    if (task === "assessment") actions.push({ label: "Open worksheets", route: "/worksheets" });
    if (task === "remediation" || task === "student_analysis") actions.push({ label: "Open early-warning dashboard", route: "/early-warning" });

    return json({
      task, reply,
      scope: { class_id: classId, class_name: className, student_id: studentId, student_name: studentName, book_id: book.value },
      grounded_in: [...new Set(grounded)],
      suggested_actions: actions,
      warnings,
      model: MODEL,
    });
  } catch (e: any) {
    console.error("copilot error", e);
    const status = typeof e?.status === "number" ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, status);
  }
}
