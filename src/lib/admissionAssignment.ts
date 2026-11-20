// Client-side types and display helpers for counsellor assignment and the two SLA clocks.
// Nothing here decides who gets a lead or when a deadline falls: that is calculated in Postgres
// (supabase/migrations/20261115…, 20261116…). The helpers only turn the database's deadlines into
// "On track / Due soon / Overdue" text that keeps ticking without another request.
import type { LeadCategory } from "@/lib/leadScoring";

export type SlaState = "on_track" | "due_soon" | "overdue";
export type SlaClockKind = "first_response" | "follow_up";

export interface SlaClock {
  due_at: string;
  due_soon_at: string;
  state: SlaState;
  started_at?: string;
  kind?: "interval" | "scheduled" | "assignment";
}

export interface WorkbenchLead {
  applicant_id: string;
  full_name: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  status: string;
  source: string;
  grade: string | null;
  created_at: string;
  meeting_notes: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_at: string | null;
  assignment_method: string | null;
  score: number | null;
  category: LeadCategory | null;
  first_contact_at: string | null;
  last_contact_at: string | null;
  contact_count: number;
  note_count: number;
  last_event_type: string | null;
  last_event_at: string | null;
  next_follow_up_at: string | null;
  is_new: boolean;
  first_response: SlaClock | null;
  follow_up: SlaClock | null;
  sla_state: SlaState | null;
  follow_up_today: boolean;
  follow_up_pending: boolean;
}

export interface WorkbenchResult {
  server_now: string;
  timezone: string;
  due_soon_first_minutes: number;
  due_soon_follow_minutes: number;
  total: number;
  leads: WorkbenchLead[];
}

export type WorkbenchScope = "mine" | "all" | "unassigned" | "overdue";

export type WorkbenchView =
  | "assigned" | "new" | "hot" | "warm" | "cold" | "today" | "pending" | "overdue";

export const WORKBENCH_VIEWS: { value: WorkbenchView; label: string }[] = [
  { value: "assigned", label: "My Assigned Leads" },
  { value: "new", label: "New Leads" },
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" },
  { value: "today", label: "Today's Follow-ups" },
  { value: "pending", label: "Pending Follow-ups" },
  { value: "overdue", label: "Overdue" },
];

export const SLA_LABELS: Record<SlaState, string> = { on_track: "On Track", due_soon: "Due Soon", overdue: "Overdue" };
// Colour is never the only cue: every indicator also carries an icon and the words.
export const SLA_TONES: Record<SlaState, string> = {
  on_track: "bg-emerald-50 text-emerald-700 border-emerald-200",
  due_soon: "bg-amber-50 text-amber-800 border-amber-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
};
export const CLOCK_LABELS: Record<SlaClockKind, string> = { first_response: "First response", follow_up: "Follow-up" };

/** Same rule as the database's adm_sla_state(); lets the badge change colour as time passes. */
export function slaStateAt(clock: Pick<SlaClock, "due_at" | "due_soon_at"> | null | undefined, nowMs: number): SlaState | null {
  if (!clock) return null;
  const due = Date.parse(clock.due_at);
  if (!Number.isFinite(due)) return null;
  if (due <= nowMs) return "overdue";
  const soon = Date.parse(clock.due_soon_at);
  return Number.isFinite(soon) && soon <= nowMs ? "due_soon" : "on_track";
}

/** "2h 05m left" / "Overdue by 40m". Minutes granularity; days shown from 48h. */
export function formatRemaining(dueAt: string, nowMs: number): string {
  const diff = Date.parse(dueAt) - nowMs;
  if (!Number.isFinite(diff)) return "—";
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const body = mins < 1 ? "under a minute" : mins >= 2880 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  return diff >= 0 ? `${body} left` : `Overdue by ${body}`;
}

/** Worst state across both clocks, evaluated at nowMs. */
export function worstState(lead: Pick<WorkbenchLead, "first_response" | "follow_up">, nowMs: number): SlaState | null {
  const states = [slaStateAt(lead.first_response, nowMs), slaStateAt(lead.follow_up, nowMs)].filter(Boolean) as SlaState[];
  if (states.length === 0) return null;
  return states.includes("overdue") ? "overdue" : states.includes("due_soon") ? "due_soon" : "on_track";
}

/** Which workbench tab(s) a lead belongs to. A lead can be in several (e.g. Hot + Overdue). */
export function inView(lead: WorkbenchLead, view: WorkbenchView, nowMs: number): boolean {
  switch (view) {
    case "assigned": return true;
    case "new": return lead.is_new;
    case "hot": case "warm": case "cold": return lead.category === view;
    case "today": return lead.follow_up_today;
    case "pending": return lead.follow_up_pending;
    case "overdue": return worstState(lead, nowMs) === "overdue";
  }
}

export function countViews(leads: WorkbenchLead[], nowMs: number): Record<WorkbenchView, number> {
  const out = {} as Record<WorkbenchView, number>;
  for (const v of WORKBENCH_VIEWS) out[v.value] = leads.filter((l) => inView(l, v.value, nowMs)).length;
  return out;
}

/** Offset between the server and this browser's clock, so countdowns are not skewed by a wrong device time. */
export function clockSkewMs(serverNow: string | undefined, receivedAtMs: number): number {
  const s = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isFinite(s) ? s - receivedAtMs : 0;
}

// ---- admin dashboard ----
export interface CounsellorStats {
  profile_id: string; name: string; is_active: boolean; is_available: boolean; unavailable_until: string | null;
  max_open_leads: number | null; accepting: boolean;
  open_leads: number; total_leads: number; converted: number; conversion_pct: number | null;
  overdue_now: number; due_soon_now: number;
  fr_total: number; fr_met: number; fr_avg_minutes: number | null; fu_total: number; fu_met: number;
}
export interface AssignmentDashboard {
  from: string; to: string; unassigned: number; open_leads: number;
  overdue_first_response: number; overdue_follow_up: number; due_soon_first_response: number; due_soon_follow_up: number;
  sla: { fr_total: number; fr_met: number; fr_avg_minutes: number | null; fu_total: number; fu_met: number };
  counsellors: CounsellorStats[];
  recent_assignments: { at: string; applicant_id: string; lead: string | null; method: string; reason: string | null; to: string | null; from: string | null; by: string | null }[];
}
export interface EligibleStaff {
  profile_id: string; name: string; role: string; is_counsellor: boolean; is_active: boolean; is_available: boolean;
  unavailable_until: string | null; max_open_leads: number | null; accepting: boolean;
}
export interface SlaConfig {
  school_id: string; first_response_minutes: number; follow_up_interval_minutes: number; follow_up_grace_minutes: number;
  due_soon_first_minutes: number; due_soon_follow_minutes: number; working_hours_enabled: boolean;
  work_start: string; work_end: string; work_days: number[]; timezone: string; first_response_events: string[]; auto_assign_enabled: boolean;
}

export const pct = (met: number, total: number): string => (total > 0 ? `${Math.round((100 * met) / total)}%` : "—");
export const formatMinutes = (m: number | null | undefined): string => {
  if (m == null) return "—";
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  return h >= 48 ? `${Math.round(h / 24)}d` : `${h}h ${Math.round(m % 60)}m`;
};
export const ASSIGNMENT_METHOD_LABELS: Record<string, string> = { auto: "Automatic", manual: "Manual", bulk: "Bulk", redistribute: "Redistributed" };
export const WEEKDAYS = [
  { n: 1, label: "Mon" }, { n: 2, label: "Tue" }, { n: 3, label: "Wed" }, { n: 4, label: "Thu" }, { n: 5, label: "Fri" }, { n: 6, label: "Sat" }, { n: 7, label: "Sun" },
];
export const RESPONSE_EVENT_OPTIONS = [
  { value: "call_answered", label: "Call answered" }, { value: "message_sent", label: "Message / email sent" },
  { value: "message_replied", label: "Parent replied" }, { value: "visit_scheduled", label: "Campus visit scheduled" },
  { value: "visit_completed", label: "Campus visit completed" },
];
