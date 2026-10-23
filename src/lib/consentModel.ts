// Digital Consent Center - pure model (no network, no React). Unit-tested in src/test/consentModel.test.ts.
//
// A consent is one decision (granted / denied) a parent makes for ONE child about ONE category.
// A category with no saved decision is "pending": the school has not been told yes or no.

export type ConsentCategory = "activities" | "photos" | "field_trips" | "data_use";
export type ConsentStatus = "granted" | "denied" | "pending";

export interface ConsentCategoryInfo {
  key: ConsentCategory;
  title: string;
  description: string;
  detail: string;
}

export const CONSENT_CATEGORIES: ConsentCategoryInfo[] = [
  {
    key: "activities",
    title: "School activities",
    description: "Clubs, sports days, competitions and events held on campus.",
    detail: "Your child can take part in activities organised by the school.",
  },
  {
    key: "photos",
    title: "Photos and videos",
    description: "Photos or videos of your child in school newsletters, the website and social media.",
    detail: "The school may publish photos or videos that show your child.",
  },
  {
    key: "field_trips",
    title: "Field trips",
    description: "Visits outside the school campus, with school transport or supervision.",
    detail: "Your child can join trips that leave the school campus.",
  },
  {
    key: "data_use",
    title: "Learning data and AI",
    description: "Use of your child's learning data for personalised learning and AI-based recommendations.",
    detail: "The school may use your child's learning data to personalise their learning.",
  },
];

export interface ConsentRecord {
  student_id: string;
  category: ConsentCategory;
  status: Exclude<ConsentStatus, "pending">;
  updated_at: string;
}

export interface ConsentHistoryEntry {
  id: string;
  student_id: string;
  category: ConsentCategory;
  old_status: ConsentStatus;
  new_status: Exclude<ConsentStatus, "pending">;
  changed_at: string;
}

export const STATUS_LABELS: Record<ConsentStatus, string> = {
  granted: "Allowed",
  denied: "Not allowed",
  pending: "No answer yet",
};

export function isConsentCategory(value: unknown): value is ConsentCategory {
  return CONSENT_CATEGORIES.some((c) => c.key === value);
}

export function getCategoryInfo(key: ConsentCategory): ConsentCategoryInfo {
  const info = CONSENT_CATEGORIES.find((c) => c.key === key);
  if (!info) throw new Error(`Unknown consent category: ${String(key)}`);
  return info;
}

/** Status of one child + category. Anything that is not a saved decision is "pending". */
export function statusFor(records: ConsentRecord[], studentId: string, category: ConsentCategory): ConsentStatus {
  const record = records.find((r) => r.student_id === studentId && r.category === category);
  return record ? record.status : "pending";
}

export interface ConsentSummary {
  granted: number;
  denied: number;
  pending: number;
  total: number;
}

/** Counts across every category for one child. */
export function summariseChild(records: ConsentRecord[], studentId: string): ConsentSummary {
  const summary: ConsentSummary = { granted: 0, denied: 0, pending: 0, total: CONSENT_CATEGORIES.length };
  for (const c of CONSENT_CATEGORIES) summary[statusFor(records, studentId, c.key)] += 1;
  return summary;
}

/** True when there is nothing left for the parent to answer. */
export function isComplete(records: ConsentRecord[], studentId: string): boolean {
  return summariseChild(records, studentId).pending === 0;
}

/** Replace (or add) a decision, returning a new list. Used for instant on-screen updates after saving. */
export function applyDecision(
  records: ConsentRecord[],
  studentId: string,
  category: ConsentCategory,
  status: Exclude<ConsentStatus, "pending">,
  now: string,
): ConsentRecord[] {
  const others = records.filter((r) => !(r.student_id === studentId && r.category === category));
  return [...others, { student_id: studentId, category, status, updated_at: now }];
}

/** History for one child, newest first. Does not change the input list. */
export function historyForChild(entries: ConsentHistoryEntry[], studentId: string): ConsentHistoryEntry[] {
  return entries
    .filter((e) => e.student_id === studentId)
    .sort((a, b) => Date.parse(b.changed_at) - Date.parse(a.changed_at));
}

/** One plain sentence describing a history entry, e.g. 'Photos and videos: No answer yet to Allowed'. */
export function describeChange(entry: ConsentHistoryEntry): string {
  return `${getCategoryInfo(entry.category).title}: ${STATUS_LABELS[entry.old_status]} to ${STATUS_LABELS[entry.new_status]}`;
}
