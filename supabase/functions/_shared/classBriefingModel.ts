// supabase/functions/_shared/classBriefingModel.ts
//
// AI class briefing (sheet row 41): pure logic shared by the handler and its tests. The handler collects FACTS
// (counts only - no student names ever reach the model); this file turns them into a prompt, validates the
// model's answer, and builds a rules-only briefing used when the AI is unavailable, so the card always works.

export interface ClassFacts {
  class_id: string;
  label: string;                 // "Class 7 - B"
  subject: string | null;
  roster: number;
  attendance_marked: number;     // students with an attendance row today
  live_sessions_today: Array<{ title: string; start: string }>;  // HH:MM local
  homework_due_soon: number;     // due today or tomorrow
  submissions_to_grade: number;  // homework submitted, not yet scored
  exam_attempts_to_review: number;
  high_risk: number;
  medium_risk: number;
  weak_topics: Array<{ topic: string; avg_mastery: number; students: number }>; // avg 0-100, weakest first
}

export interface BriefingFacts { date: string; weekday: string; teacher_first_name: string; classes: ClassFacts[] }

export interface BriefingClass { class_id: string; label: string; summary: string; focus: string | null }
export interface Briefing {
  headline: string;
  priorities: string[];          // top 3 actions for today
  classes: BriefingClass[];
  learning_issues: string[];
  outstanding: { attendance_unmarked: number; submissions_to_grade: number; exam_attempts_to_review: number; homework_due_soon: number; at_risk: number };
  source: "ai" | "rules";
}

export const BRIEFING_SYSTEM_PROMPT = [
  "You are a helpful teaching assistant writing a teacher's morning briefing. You output strict JSON only, no markdown.",
  "Use ONLY the facts given. Never invent numbers, students, topics or events. Be concrete and brief; a teacher reads this in 30 seconds.",
  "Prioritise: safety/at-risk students and anything due today first, then grading backlog, then teaching focus for weak topics.",
].join("\n");

export function buildBriefingPrompt(f: BriefingFacts): string {
  return [
    `TODAY: ${f.weekday}, ${f.date}. TEACHER: ${f.teacher_first_name}.`,
    "FACTS PER CLASS (JSON):",
    JSON.stringify(f.classes.map((c) => ({ ...c, attendance_unmarked: Math.max(0, c.roster - c.attendance_marked) }))),
    "",
    "Return JSON exactly:",
    "{",
    '  "headline": "one friendly sentence summarising the day",',
    '  "priorities": ["up to 3 short imperative actions, most urgent first"],',
    '  "classes": [ { "class_id": "copy from facts", "summary": "one sentence about this class today", "focus": "one teaching tip for its weakest topic, or null" } ],',
    '  "learning_issues": ["up to 4 short observations about weak topics or risk patterns across classes"]',
    "}",
  ].join("\n");
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

export function outstandingOf(f: BriefingFacts): Briefing["outstanding"] {
  const sum = (fn: (c: ClassFacts) => number) => f.classes.reduce((s, c) => s + fn(c), 0);
  return {
    attendance_unmarked: sum((c) => Math.max(0, c.roster - c.attendance_marked)),
    submissions_to_grade: sum((c) => c.submissions_to_grade),
    exam_attempts_to_review: sum((c) => c.exam_attempts_to_review),
    homework_due_soon: sum((c) => c.homework_due_soon),
    at_risk: sum((c) => c.high_risk + c.medium_risk),
  };
}

/** Deterministic briefing: used when the AI is unavailable, and as the base the AI text is laid over. */
export function rulesBriefing(f: BriefingFacts): Briefing {
  const o = outstandingOf(f);
  const priorities: string[] = [];
  const highRisk = f.classes.reduce((s, c) => s + c.high_risk, 0);
  if (highRisk) priorities.push(`Check in with the ${highRisk} high-risk student${highRisk > 1 ? "s" : ""} flagged by Early Warning`);
  if (o.attendance_unmarked) priorities.push(`Mark attendance (${o.attendance_unmarked} student${o.attendance_unmarked > 1 ? "s" : ""} not marked yet)`);
  if (o.submissions_to_grade + o.exam_attempts_to_review) priorities.push(`Clear the grading queue: ${o.submissions_to_grade} homework, ${o.exam_attempts_to_review} exam answers`);
  if (priorities.length < 3 && o.homework_due_soon) priorities.push(`${o.homework_due_soon} homework assignment${o.homework_due_soon > 1 ? "s are" : " is"} due by tomorrow`);

  const learning_issues = f.classes
    .filter((c) => c.weak_topics.length)
    .slice(0, 4)
    .map((c) => `${c.label}: weakest topic is ${c.weak_topics[0].topic} (${c.weak_topics[0].avg_mastery}% average mastery across ${c.weak_topics[0].students} students)`);

  const sessions = f.classes.reduce((s, c) => s + c.live_sessions_today.length, 0);
  const headline = f.classes.length === 0
    ? "You don't have any classes assigned yet."
    : `${f.classes.length} class${f.classes.length > 1 ? "es" : ""}${sessions ? `, ${sessions} live session${sessions > 1 ? "s" : ""}` : ""} today` +
      (priorities.length ? ` and ${priorities.length} thing${priorities.length > 1 ? "s" : ""} to act on.` : " - nothing urgent.");

  return {
    headline,
    priorities: priorities.slice(0, 3),
    classes: f.classes.map((c) => {
      const bits: string[] = [];
      if (c.live_sessions_today.length) bits.push(`live at ${c.live_sessions_today.map((s) => s.start).join(", ")}`);
      const unmarked = Math.max(0, c.roster - c.attendance_marked);
      bits.push(unmarked ? `${unmarked}/${c.roster} attendance unmarked` : `attendance done (${c.roster})`);
      if (c.submissions_to_grade) bits.push(`${c.submissions_to_grade} to grade`);
      if (c.high_risk + c.medium_risk) bits.push(`${c.high_risk + c.medium_risk} at risk`);
      return {
        class_id: c.class_id, label: c.label, summary: bits.join(" · "),
        focus: c.weak_topics[0] ? `Revisit ${c.weak_topics[0].topic} with a quick check for understanding.` : null,
      };
    }),
    learning_issues,
    outstanding: o,
    source: "rules",
  };
}

/** Lays validated AI text over the rules briefing. Numbers always come from the facts, never from the model. */
export function mergeAiBriefing(raw: Record<string, unknown> | null, f: BriefingFacts): Briefing {
  const base = rulesBriefing(f);
  if (!raw) return base;
  const headline = clip(raw.headline, 240);
  const priorities = (Array.isArray(raw.priorities) ? raw.priorities : []).map((p) => clip(p, 160)).filter(Boolean).slice(0, 3);
  const issues = (Array.isArray(raw.learning_issues) ? raw.learning_issues : []).map((p) => clip(p, 200)).filter(Boolean).slice(0, 4);
  const aiClasses = new Map<string, Record<string, unknown>>();
  for (const c of Array.isArray(raw.classes) ? raw.classes : []) {
    if (c && typeof c === "object" && typeof (c as Record<string, unknown>).class_id === "string") aiClasses.set((c as Record<string, string>).class_id, c as Record<string, unknown>);
  }
  if (!headline && !priorities.length) return base;
  return {
    headline: headline || base.headline,
    priorities: priorities.length ? priorities : base.priorities,
    classes: base.classes.map((c) => {
      const ai = aiClasses.get(c.class_id);
      return ai ? { ...c, summary: clip(ai.summary, 240) || c.summary, focus: clip(ai.focus, 240) || c.focus } : c;
    }),
    learning_issues: issues.length ? issues : base.learning_issues,
    outstanding: base.outstanding,
    source: "ai",
  };
}
