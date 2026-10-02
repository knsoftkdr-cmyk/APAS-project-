// supabase/functions/_shared/iepModel.ts
//
// Pure (no I/O) model for the Individual Education Plan (IEP) generator. Used by
// _shared/handlers/iepGenerator.ts and unit-tested in src/test/iepModel.test.ts.
//
// The output of this module is always a DRAFT for the case manager to review. Nothing here
// diagnoses a student: the category and notes come from the SEN record a staff member
// already entered. Dates are computed in code, never by the model.

export const IEP_DOMAINS = ["Academic", "Behavioral", "Communication", "Social", "Motor", "Self-Help"] as const;
export const ACCOMMODATION_TYPES = ["Extra Time", "Preferential Seating", "Assistive Technology", "Reduced Workload", "Scribe", "Other"] as const;
export const APPLIES_TO = ["classroom", "exam", "both"] as const;

export type IepDomain = (typeof IEP_DOMAINS)[number];
export type AccommodationType = (typeof ACCOMMODATION_TYPES)[number];
export type AppliesTo = (typeof APPLIES_TO)[number];

export interface IepInput {
  today: string; // YYYY-MM-DD
  category: string;
  diagnosis_notes: string | null;
  review_cycle_months: number;
  grade: string | null;
  duration_months: number;
  focus_domains: IepDomain[];
  teacher_notes: string | null;
  attendance_rate: number | null; // % over the last 90 days, null = no data
  marks: Array<{ subject: string; pct: number }> | null; // weakest first
  weak_topics: Array<{ topic: string; subject: string; mastery_pct: number }> | null;
  behaviour: { positive: number; negative: number; recent: string[] } | null;
  prior_plans: Array<{
    title: string; status: string; start_date: string | null; end_date: string | null;
    goals: Array<{ domain: string; goal_description: string; progress_status: string }>;
    last_review_summary: string | null;
  }>;
  accommodations: Array<{ accommodation_type: string; applies_to: string; description: string | null; active: boolean }>;
  therapy: Array<{ therapy_type: string; goals_addressed: string | null }>;
}

export interface DraftGoal {
  domain: IepDomain;
  goal_description: string;
  baseline: string;
  target_criteria: string;
  target_date: string; // YYYY-MM-DD
}

export interface DraftAccommodation {
  accommodation_type: AccommodationType;
  applies_to: AppliesTo;
  description: string;
}

export interface IepDraft {
  title: string;
  start_date: string;
  end_date: string;
  next_review_date: string;
  present_levels: string;
  strengths: string[];
  needs: string[];
  goals: DraftGoal[];
  accommodations: DraftAccommodation[];
  strategies: string[];
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** Adds whole months in UTC, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = (m - 1) + Math.trunc(months);
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(d, last))).toISOString().slice(0, 10);
}

export function clampDuration(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 12;
  return Math.min(12, Math.max(3, Math.round(n)));
}

export function parseFocusDomains(v: unknown): IepDomain[] {
  if (!Array.isArray(v)) return [];
  const out: IepDomain[] = [];
  for (const x of v) {
    const hit = IEP_DOMAINS.find((d) => d.toLowerCase() === String(x).trim().toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

const clip = (s: unknown, max: number): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Default domains per SEN category, most important first. */
export function defaultDomains(category: string): IepDomain[] {
  const c = category.toLowerCase();
  if (c.includes("autism")) return ["Communication", "Social", "Behavioral", "Academic"];
  if (c.includes("adhd")) return ["Behavioral", "Academic", "Self-Help", "Social"];
  if (c.includes("dyslexia") || c.includes("learning")) return ["Academic", "Self-Help", "Communication"];
  if (c.includes("speech")) return ["Communication", "Social", "Academic"];
  if (c.includes("physical") || c.includes("motor")) return ["Motor", "Self-Help", "Academic"];
  if (c.includes("intellectual")) return ["Academic", "Self-Help", "Communication", "Social"];
  return ["Academic", "Social", "Behavioral"];
}

function defaultAccommodations(category: string): DraftAccommodation[] {
  const c = category.toLowerCase();
  const acc = (accommodation_type: AccommodationType, applies_to: AppliesTo, description: string): DraftAccommodation =>
    ({ accommodation_type, applies_to, description });
  if (c.includes("adhd")) return [
    acc("Preferential Seating", "classroom", "Seat away from distractions and close to the teacher."),
    acc("Extra Time", "exam", "Extra time in tests, with short movement breaks if needed."),
    acc("Reduced Workload", "classroom", "Break long tasks into short steps with check-ins."),
  ];
  if (c.includes("dyslexia") || c.includes("learning")) return [
    acc("Extra Time", "both", "Extra time for reading and writing tasks."),
    acc("Scribe", "exam", "A scribe or reader for written examinations."),
    acc("Assistive Technology", "classroom", "Text-to-speech or audio versions of reading material where available."),
  ];
  if (c.includes("autism")) return [
    acc("Preferential Seating", "classroom", "A predictable seat with low sensory distraction."),
    acc("Reduced Workload", "classroom", "Clear, chunked instructions and a visual schedule."),
    acc("Extra Time", "exam", "Extra time and a quiet space for tests."),
  ];
  if (c.includes("speech")) return [
    acc("Extra Time", "both", "Extra time to respond orally or in writing."),
    acc("Assistive Technology", "classroom", "Visual supports or a communication aid where recommended by the therapist."),
  ];
  if (c.includes("physical") || c.includes("motor")) return [
    acc("Extra Time", "both", "Extra time for writing and practical tasks."),
    acc("Scribe", "exam", "A scribe for written examinations if writing is a barrier."),
    acc("Preferential Seating", "classroom", "A seat with easy access and enough space."),
  ];
  if (c.includes("intellectual")) return [
    acc("Reduced Workload", "classroom", "Simplified tasks aligned to the student's current level."),
    acc("Extra Time", "both", "Extra time and repeated instructions."),
  ];
  return [
    acc("Extra Time", "both", "Extra time for classwork and tests."),
    acc("Preferential Seating", "classroom", "A seat chosen to support attention and access."),
  ];
}

const DOMAIN_TEMPLATES: Record<IepDomain, (i: IepInput) => { goal: string; criteria: string }> = {
  Academic: (i) => {
    const weakest = i.marks?.[0]?.subject ?? i.weak_topics?.[0]?.subject ?? null;
    return {
      goal: weakest
        ? `Improve classroom performance in ${weakest} using the agreed supports and accommodations.`
        : "Improve classroom performance in core subjects using the agreed supports and accommodations.",
      criteria: "Completes at least 4 of 5 assigned tasks per week at the agreed level, checked at each review.",
    };
  },
  Behavioral: () => ({
    goal: "Use agreed self-regulation strategies to stay on task and manage frustration in class.",
    criteria: "Uses a strategy independently in at least 4 of 5 observed situations over 4 consecutive weeks.",
  }),
  Communication: () => ({
    goal: "Express needs, ideas and answers clearly to teachers and peers.",
    criteria: "Initiates or responds appropriately in at least 4 of 5 teacher-observed opportunities per week.",
  }),
  Social: () => ({
    goal: "Take part in a structured group activity with peers in a positive way.",
    criteria: "Takes part for the full activity in at least 3 of 4 sessions per month.",
  }),
  Motor: () => ({
    goal: "Improve the motor skills needed for writing and classroom tasks.",
    criteria: "Completes a short writing or fine-motor task within the agreed time in 4 of 5 trials.",
  }),
  "Self-Help": () => ({
    goal: "Organise own materials and complete routines with fewer reminders.",
    criteria: "Completes the morning and end-of-day routine with no more than one prompt in 4 of 5 school days.",
  }),
};

// ---------------------------------------------------------------------------------------------
// rules-based draft (no AI)
// ---------------------------------------------------------------------------------------------

function strengthsAndNeeds(i: IepInput): { strengths: string[]; needs: string[] } {
  const strengths: string[] = [];
  const needs: string[] = [];
  if (i.marks?.length) {
    const best = i.marks[i.marks.length - 1];
    const worst = i.marks[0];
    if (best && best.pct >= 60) strengths.push(`${best.subject}: recent results around ${best.pct}%.`);
    if (worst && worst.pct < 50) needs.push(`${worst.subject}: recent results around ${worst.pct}%.`);
  }
  if (i.attendance_rate != null) {
    if (i.attendance_rate >= 90) strengths.push(`Attendance is ${i.attendance_rate}% over the last 90 days.`);
    else if (i.attendance_rate < 85) needs.push(`Attendance is ${i.attendance_rate}% over the last 90 days.`);
  }
  for (const t of (i.weak_topics ?? []).slice(0, 3)) needs.push(`${t.subject}: ${t.topic} (mastery about ${t.mastery_pct}%).`);
  if (i.behaviour && i.behaviour.negative > i.behaviour.positive && i.behaviour.negative >= 3) {
    needs.push("More behaviour concerns than positive records recently.");
  } else if (i.behaviour && i.behaviour.positive > 0 && i.behaviour.positive >= i.behaviour.negative) {
    strengths.push("Positive behaviour records outnumber concerns.");
  }
  return { strengths: strengths.slice(0, 5), needs: needs.slice(0, 6) };
}

export function buildFallbackIep(i: IepInput): IepDraft {
  const domains = (i.focus_domains.length ? i.focus_domains : defaultDomains(i.category)).slice(0, 6);
  const end = addMonths(i.today, i.duration_months);
  const { strengths, needs } = strengthsAndNeeds(i);

  const goals: DraftGoal[] = domains.map((d) => {
    const t = DOMAIN_TEMPLATES[d](i);
    const carried = i.prior_plans.flatMap((p) => p.goals).find((g) => g.domain === d && g.progress_status !== "achieved" && g.progress_status !== "discontinued");
    return {
      domain: d,
      goal_description: t.goal,
      baseline: carried ? `Carried over from the previous plan (${carried.progress_status.replace("_", " ")}): ${clip(carried.goal_description, 160)}` : "Not on record. Assess at the start of the plan and fill in.",
      target_criteria: t.criteria,
      target_date: end,
    };
  });

  const activeKeys = new Set(i.accommodations.filter((a) => a.active).map((a) => `${a.accommodation_type}|${a.applies_to}`));
  const accommodations = defaultAccommodations(i.category).filter((a) => !activeKeys.has(`${a.accommodation_type}|${a.applies_to}`));

  const gradePart = i.grade ? ` (${i.grade})` : "";
  return {
    title: `IEP ${i.today.slice(0, 4)}: ${i.category}`,
    start_date: i.today,
    end_date: end,
    next_review_date: addMonths(i.today, Math.min(i.review_cycle_months, i.duration_months)),
    present_levels:
      `Student${gradePart} is enrolled in the SEN programme under the category "${i.category}". ` +
      (strengths.length || needs.length
        ? "The strengths and needs below come from attendance, marks, behaviour and mastery records."
        : "There was too little recorded data to describe present levels, so complete this section from classroom observation."),
    strengths,
    needs,
    goals,
    accommodations,
    strategies: [
      "Give instructions in short steps and check understanding before moving on.",
      "Use visual supports and worked examples.",
      "Give specific, immediate praise when a goal behaviour is shown.",
      "Share progress with the family at each review.",
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// AI prompt + parsing
// ---------------------------------------------------------------------------------------------

export const AI_SYSTEM_PROMPT =
  "You help a school's special-needs case manager DRAFT an Individual Education Plan (IEP). You output strict JSON only, " +
  "no markdown. You never diagnose and never invent facts: use only what is in the input. If a baseline is not in the input, " +
  "write exactly \"Not on record. Assess at the start of the plan.\" Goals must be specific, measurable and achievable within the " +
  "plan length. Refer to the student only as STU_01. Keep language plain and respectful, suitable to share with parents.";

export function buildAiUserPrompt(i: IepInput, scrub: (t: string) => string): string {
  const domains = (i.focus_domains.length ? i.focus_domains : defaultDomains(i.category)).join(", ");
  const lines: string[] = [];
  lines.push(`Plan length: ${i.duration_months} months starting ${i.today}. Review cycle: every ${i.review_cycle_months} months.`);
  lines.push(`Student: STU_01${i.grade ? `, ${i.grade}` : ""}. SEN category: ${i.category}.`);
  if (i.diagnosis_notes) lines.push(`Case notes: ${scrub(clip(i.diagnosis_notes, 1200))}`);
  if (i.teacher_notes) lines.push(`Case manager's request/notes: ${scrub(clip(i.teacher_notes, 1500))}`);
  lines.push(`Preferred goal domains (use these first): ${domains}.`);
  if (i.attendance_rate != null) lines.push(`Attendance, last 90 days: ${i.attendance_rate}%.`);
  if (i.marks?.length) lines.push(`Recent marks by subject (weakest first): ${i.marks.slice(0, 6).map((m) => `${m.subject} ${m.pct}%`).join("; ")}.`);
  if (i.weak_topics?.length) lines.push(`Weakest topics: ${i.weak_topics.slice(0, 5).map((t) => `${t.subject} - ${t.topic} (${t.mastery_pct}%)`).join("; ")}.`);
  if (i.behaviour) lines.push(`Behaviour records: ${i.behaviour.positive} positive, ${i.behaviour.negative} concerns. Recent: ${i.behaviour.recent.slice(0, 4).map((r) => scrub(clip(r, 80))).join("; ") || "none"}.`);
  for (const p of i.prior_plans.slice(0, 2)) {
    lines.push(`Previous plan "${scrub(clip(p.title, 80))}" (${p.status}): goals - ${p.goals.slice(0, 6).map((g) => `${g.domain}: ${scrub(clip(g.goal_description, 120))} [${g.progress_status}]`).join(" | ") || "none"}.` +
      (p.last_review_summary ? ` Last review: ${scrub(clip(p.last_review_summary, 300))}` : ""));
  }
  if (i.accommodations.length) lines.push(`Current accommodations: ${i.accommodations.filter((a) => a.active).map((a) => `${a.accommodation_type} (${a.applies_to})`).join("; ") || "none active"}.`);
  if (i.therapy.length) lines.push(`Recent therapy: ${i.therapy.slice(0, 5).map((t) => `${t.therapy_type}${t.goals_addressed ? ` - ${scrub(clip(t.goals_addressed, 100))}` : ""}`).join("; ")}.`);

  return [
    ...lines,
    "",
    "Return JSON with exactly this shape:",
    "{",
    '  "present_levels": "2-4 sentences on current strengths and needs, from the input only",',
    '  "strengths": ["up to 5 short items"],',
    '  "needs": ["up to 6 short items"],',
    `  "goals": [ { "domain": one of ${IEP_DOMAINS.join("|")}, "goal_description": "...", "baseline": "...", "target_criteria": "measurable, e.g. 4 of 5 trials", "target_months": integer 1-${i.duration_months} } ]  (3 to 6 goals; do not repeat an achieved goal; carry over unmet goals only if still relevant),`,
    `  "accommodations": [ { "accommodation_type": one of ${ACCOMMODATION_TYPES.join("|")}, "applies_to": one of ${APPLIES_TO.join("|")}, "description": "..." } ]  (only ones not already active),`,
    '  "strategies": ["3 to 6 classroom strategies for teachers"]',
    "}",
  ].join("\n");
}

export function parseAiJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(cleaned.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const strList = (v: unknown, max: number, len: number, restore: (t: string) => string): string[] =>
  Array.isArray(v) ? v.map((x) => restore(clip(x, len))).filter(Boolean).slice(0, max) : [];

/**
 * Validates model output against the allowed vocab and the plan window. Returns null if there is no
 * usable goal, so the caller falls back to the rules-based draft. Dates are always computed here.
 */
export function sanitiseAiIep(raw: Record<string, unknown> | null, i: IepInput, fallback: IepDraft, restore: (t: string) => string): IepDraft | null {
  if (!raw) return null;
  const end = fallback.end_date;

  const goals: DraftGoal[] = [];
  for (const g of Array.isArray(raw.goals) ? raw.goals : []) {
    if (!g || typeof g !== "object") continue;
    const r = g as Record<string, unknown>;
    const domain = IEP_DOMAINS.find((d) => d.toLowerCase() === String(r.domain ?? "").trim().toLowerCase());
    const description = restore(clip(r.goal_description, 400));
    if (!domain || description.length < 10) continue;
    const months = Number(r.target_months);
    const target_date = Number.isFinite(months) && months >= 1 ? addMonths(i.today, Math.min(Math.round(months), i.duration_months)) : end;
    goals.push({
      domain,
      goal_description: description,
      baseline: restore(clip(r.baseline, 300)) || "Not on record. Assess at the start of the plan.",
      target_criteria: restore(clip(r.target_criteria, 300)) || "To be agreed with the case manager.",
      target_date,
    });
    if (goals.length >= 6) break;
  }
  if (!goals.length) return null;

  const activeKeys = new Set(i.accommodations.filter((a) => a.active).map((a) => `${a.accommodation_type}|${a.applies_to}`));
  const seen = new Set<string>();
  const accommodations: DraftAccommodation[] = [];
  for (const a of Array.isArray(raw.accommodations) ? raw.accommodations : []) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const type = ACCOMMODATION_TYPES.find((t) => t.toLowerCase() === String(r.accommodation_type ?? "").trim().toLowerCase()) ?? "Other";
    const applies = APPLIES_TO.find((t) => t === String(r.applies_to ?? "").trim().toLowerCase()) ?? "both";
    const key = `${type}|${applies}`;
    const description = restore(clip(r.description, 300));
    if (activeKeys.has(key) || seen.has(key) || !description) continue;
    seen.add(key);
    accommodations.push({ accommodation_type: type, applies_to: applies, description });
    if (accommodations.length >= 6) break;
  }

  const present = restore(clip(raw.present_levels, 900));
  const aiStrengths = strList(raw.strengths, 5, 200, restore);
  const aiNeeds = strList(raw.needs, 6, 200, restore);
  const aiStrategies = strList(raw.strategies, 6, 240, restore);
  return {
    ...fallback,
    present_levels: present || fallback.present_levels,
    strengths: aiStrengths.length ? aiStrengths : fallback.strengths,
    needs: aiNeeds.length ? aiNeeds : fallback.needs,
    goals,
    accommodations,
    strategies: aiStrategies.length ? aiStrategies : fallback.strategies,
  };
}

/** Plain-text version of a draft, used by the "Copy full IEP" button. */
export function draftToText(d: IepDraft, studentName: string): string {
  const out: string[] = [];
  out.push(`${d.title} - ${studentName}`, `Plan period: ${d.start_date} to ${d.end_date}. Next review: ${d.next_review_date}.`, "");
  out.push("PRESENT LEVELS", d.present_levels, "");
  if (d.strengths.length) out.push("STRENGTHS", ...d.strengths.map((s) => `- ${s}`), "");
  if (d.needs.length) out.push("NEEDS", ...d.needs.map((s) => `- ${s}`), "");
  out.push("GOALS");
  d.goals.forEach((g, n) => out.push(`${n + 1}. [${g.domain}] ${g.goal_description}`, `   Baseline: ${g.baseline}`, `   Target: ${g.target_criteria} (by ${g.target_date})`));
  out.push("");
  if (d.accommodations.length) out.push("ACCOMMODATIONS", ...d.accommodations.map((a) => `- ${a.accommodation_type} (${a.applies_to}): ${a.description}`), "");
  if (d.strategies.length) out.push("TEACHING STRATEGIES", ...d.strategies.map((s) => `- ${s}`));
  return out.join("\n");
}
