// Smart Universal Search - pure helpers (no React, no Supabase) so they are unit-testable.
//
// Authorization is NOT decided here. The `universal_search` Postgres function
// (migration 20261023000000) derives the caller's identity, role and school from
// the database and applies RLS. Everything in this file is presentation:
// which category headings exist, where a result links to, and a small
// per-user "recent searches" list.

export type SearchCategory =
  | "students"
  | "staff"
  | "lessons"
  | "exams"
  | "homework"
  | "classes"
  | "schools";

export interface SearchResult {
  category: SearchCategory;
  id: string;
  title: string;
  subtitle: string | null;
  meta: Record<string, unknown>;
  rank: number;
}

/** Row shape returned by the `universal_search` RPC. */
export interface SearchRpcRow {
  r_category: string;
  r_id: string;
  r_title: string;
  r_subtitle: string | null;
  r_meta: Record<string, unknown> | null;
  r_rank: number;
}

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 80;
export const DEBOUNCE_MS = 300;
export const RESULTS_PER_CATEGORY = 5;

/** Display order + headings. Order here is the order of the groups in the dialog. */
export const CATEGORY_META: Record<SearchCategory, { label: string; hint: string }> = {
  students: { label: "Students", hint: "name or roll number" },
  staff: { label: "Teachers & Staff", hint: "name, designation or department" },
  lessons: { label: "Lessons", hint: "title or subject" },
  exams: { label: "Exams & Assessments", hint: "exam title or subject" },
  homework: { label: "Homework & Assignments", hint: "title, subject or topic" },
  classes: { label: "Classes", hint: "e.g. \"8 A\"" },
  schools: { label: "Schools", hint: "school name" },
};

export const CATEGORY_ORDER: SearchCategory[] = [
  "students", "staff", "lessons", "exams", "homework", "classes", "schools",
];

const KNOWN_CATEGORIES = new Set<string>(CATEGORY_ORDER);

const STAFF_ROLES = ["teacher", "hod", "principal", "admin", "school_admin"];
const ADMIN_ROLES = ["principal", "admin", "school_admin"];

/**
 * Which categories to OFFER in the UI for a role. This is a presentation hint
 * only - the database function independently enforces what is returned.
 */
export function categoriesForRole(role: string | null | undefined): SearchCategory[] {
  if (!role) return [];
  if (role === "knsoft_admin") return ["schools"];
  if (role === "student") return ["lessons", "exams", "homework"];
  if (role === "parent") return ["students"];
  if (ADMIN_ROLES.includes(role)) {
    return ["students", "staff", "lessons", "exams", "homework", "classes"];
  }
  if (STAFF_ROLES.includes(role)) {
    return ["students", "lessons", "exams", "homework", "classes"];
  }
  return [];
}

/** Trim, collapse repeated whitespace, cap length. Empty/whitespace -> "". */
export function normalizeQuery(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

export function isSearchable(raw: string | null | undefined): boolean {
  return normalizeQuery(raw).length >= MIN_QUERY_LENGTH;
}

/**
 * Convert RPC rows to results: drops rows from an unknown category (e.g. a newer
 * server than client), drops rows with no id/title, de-duplicates by
 * category + id (keeping the best rank), and sorts category-grouped, best first.
 */
export function mapRows(rows: unknown): SearchResult[] {
  if (!Array.isArray(rows)) return [];
  const best = new Map<string, SearchResult>();
  for (const row of rows as Partial<SearchRpcRow>[]) {
    if (!row || typeof row.r_id !== "string" || !row.r_id) continue;
    if (typeof row.r_title !== "string" || !row.r_title.trim()) continue;
    if (typeof row.r_category !== "string" || !KNOWN_CATEGORIES.has(row.r_category)) continue;
    const result: SearchResult = {
      category: row.r_category as SearchCategory,
      id: row.r_id,
      title: row.r_title.trim(),
      subtitle: row.r_subtitle?.trim() ? row.r_subtitle.trim() : null,
      meta: row.r_meta && typeof row.r_meta === "object" ? row.r_meta : {},
      rank: typeof row.r_rank === "number" ? row.r_rank : 3,
    };
    const key = `${result.category}:${result.id}`;
    const prev = best.get(key);
    if (!prev || result.rank < prev.rank) best.set(key, result);
  }
  return [...best.values()].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.rank - b.rank ||
      a.title.localeCompare(b.title),
  );
}

export function groupByCategory(results: SearchResult[]): { category: SearchCategory; items: SearchResult[] }[] {
  const groups = new Map<SearchCategory, SearchResult[]>();
  for (const r of results) {
    const list = groups.get(r.category);
    if (list) list.push(r);
    else groups.set(r.category, [r]);
  }
  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => ({ category: c, items: groups.get(c)! }));
}

/**
 * Where a result opens. Only EXISTING routes are used. Most APAS pages are list
 * pages without a per-record URL, so most results open the module page that
 * contains the record; the only true per-record routes are /exam/:id (student)
 * and /verify-student/:id (staff). Returns null when no page exists for this
 * role + category (the UI then says so instead of navigating to a dead end).
 */
export function resolveResultRoute(result: SearchResult, role: string | null | undefined): string | null {
  if (!role) return null;
  const id = encodeURIComponent(result.id);
  switch (result.category) {
    case "students":
      if (role === "parent") return "/student-profile";
      // /verify-student/:id is allowed for admin, principal, school_admin, teacher.
      if (["admin", "principal", "school_admin", "teacher"].includes(role)) return `/verify-student/${id}`;
      return null;
    case "staff":
      if (role === "admin" || role === "principal") return "/admin?tab=teachers";
      if (role === "school_admin") return "/super-admin";
      return null;
    case "lessons":
      if (role === "student") return "/student-dashboard";
      if (role === "teacher" || role === "hod") return "/teacher";
      if (ADMIN_ROLES.includes(role)) return "/admin?tab=lesson-plans";
      return null;
    case "exams":
      if (role === "student") return `/exam/${id}`;
      if (STAFF_ROLES.includes(role)) return "/item-bank";
      return null;
    case "homework":
      if (role === "student" || STAFF_ROLES.includes(role)) return "/dashboard";
      return null;
    case "classes":
      if (STAFF_ROLES.includes(role)) return "/admin?tab=classes";
      return null;
    case "schools":
      if (role === "knsoft_admin") return "/knsoft-admin";
      return null;
    default:
      return null;
  }
}

/**
 * Split `text` into segments, flagging case-insensitive matches of `query` so the
 * UI can highlight them. Built from literal string search (no regex built from
 * user input), so special characters in the query can never break or hang it.
 */
export function splitHighlight(text: string, query: string): { text: string; match: boolean }[] {
  const q = normalizeQuery(query).toLowerCase();
  if (!text) return [];
  if (q.length < MIN_QUERY_LENGTH) return [{ text, match: false }];
  const lower = text.toLowerCase();
  // toLowerCase can change string length for a few characters; fall back safely.
  if (lower.length !== text.length) return [{ text, match: false }];
  const out: { text: string; match: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(q, i);
    if (at === -1) {
      out.push({ text: text.slice(i), match: false });
      break;
    }
    if (at > i) out.push({ text: text.slice(i, at), match: false });
    out.push({ text: text.slice(at, at + q.length), match: true });
    i = at + q.length;
  }
  return out;
}

/** Short, human error text. Never includes raw database messages. */
export function describeSearchError(err: unknown): string {
  const e = err as { code?: string; message?: string; name?: string } | null;
  if (e?.name === "AbortError") return "";
  const msg = (e?.message ?? "").toLowerCase();
  if (e?.code === "42501" || msg.includes("permission denied")) {
    return "You don't have permission to search some of these records.";
  }
  if (e?.code === "PGRST202" || e?.code === "42883" || msg.includes("could not find the function")) {
    return "Search isn't set up on the server yet. Ask an administrator to apply the latest database migration.";
  }
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("timeout")) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return "Search failed. Please try again.";
}

// ─── Recent searches ─────────────────────────────────────────────────────────
// Stores ONLY the text the user typed - never result titles, ids or any record
// detail. Keyed by user id so one person's history is never shown to another on
// a shared device, and removable on sign-out.

const RECENT_PREFIX = "apas.search.recent.v1:";
export const MAX_RECENT = 6;

function recentKey(userId: string): string {
  return `${RECENT_PREFIX}${userId}`;
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // storage can throw (private mode, blocked)
  }
}

export function getRecentSearches(userId: string | null | undefined): string[] {
  if (!userId) return [];
  const store = safeStorage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(recentKey(userId)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map(normalizeQuery)
      .filter((x) => x.length >= MIN_QUERY_LENGTH)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function addRecentSearch(userId: string | null | undefined, raw: string): string[] {
  const q = normalizeQuery(raw);
  if (!userId || q.length < MIN_QUERY_LENGTH) return getRecentSearches(userId);
  const next = [q, ...getRecentSearches(userId).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
  try {
    safeStorage()?.setItem(recentKey(userId), JSON.stringify(next));
  } catch {
    /* storage full / blocked - history is a convenience only */
  }
  return next;
}

export function clearRecentSearches(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    safeStorage()?.removeItem(recentKey(userId));
  } catch {
    /* ignore */
  }
}

/** Remove every user's history on this device (call on sign-out). */
export function clearAllRecentSearches(): void {
  const store = safeStorage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(RECENT_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => store.removeItem(k));
  } catch {
    /* ignore */
  }
}
