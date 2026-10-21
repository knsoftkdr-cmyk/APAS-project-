import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_QUERY_LENGTH,
  MAX_RECENT,
  addRecentSearch,
  categoriesForRole,
  clearAllRecentSearches,
  clearRecentSearches,
  describeSearchError,
  getRecentSearches,
  groupByCategory,
  isSearchable,
  mapRows,
  normalizeQuery,
  resolveResultRoute,
  splitHighlight,
  type SearchResult,
} from "@/lib/universalSearch";

const row = (over: Record<string, unknown> = {}) => ({
  r_category: "students", r_id: "id-1", r_title: "Asha Rao", r_subtitle: "Class 8 - A", r_meta: {}, r_rank: 1, ...over,
});
const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  category: "students", id: "abc", title: "Asha Rao", subtitle: null, meta: {}, rank: 0, ...over,
});

describe("normalizeQuery / isSearchable", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeQuery("  asha    rao \n")).toBe("asha rao");
  });
  it("is safe for empty, whitespace and non-string input", () => {
    expect(normalizeQuery("")).toBe("");
    expect(normalizeQuery("     ")).toBe("");
    expect(normalizeQuery(undefined)).toBe("");
    expect(normalizeQuery(null)).toBe("");
    expect(normalizeQuery(42 as unknown as string)).toBe("");
  });
  it("caps very long input", () => {
    expect(normalizeQuery("x".repeat(500)).length).toBe(MAX_QUERY_LENGTH);
  });
  it("needs at least 2 real characters", () => {
    expect(isSearchable("a")).toBe(false);
    expect(isSearchable(" a ")).toBe(false);
    expect(isSearchable("ab")).toBe(true);
    expect(isSearchable("   ")).toBe(false);
  });
});

describe("mapRows", () => {
  it("returns [] for non-arrays", () => {
    expect(mapRows(null)).toEqual([]);
    expect(mapRows({})).toEqual([]);
  });
  it("drops rows with a missing id/title or an unknown category", () => {
    const out = mapRows([row({ r_id: "" }), row({ r_title: "  " }), row({ r_category: "secrets" }), row({ r_id: "ok" })]);
    expect(out.map((r) => r.id)).toEqual(["ok"]);
  });
  it("de-duplicates by category+id, keeping the best rank", () => {
    const out = mapRows([row({ r_rank: 3 }), row({ r_rank: 0 }), row({ r_rank: 2 })]);
    expect(out).toHaveLength(1);
    expect(out[0].rank).toBe(0);
  });
  it("keeps same id in different categories", () => {
    expect(mapRows([row(), row({ r_category: "staff" })])).toHaveLength(2);
  });
  it("sorts by category order, then rank (exact before partial), then title", () => {
    const out = mapRows([
      row({ r_id: "1", r_title: "Zed", r_rank: 3 }),
      row({ r_id: "2", r_title: "Asha", r_rank: 0 }),
      row({ r_id: "3", r_category: "lessons", r_title: "Algebra", r_rank: 0 }),
      row({ r_id: "4", r_title: "Amit", r_rank: 3 }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["2", "4", "1", "3"]);
  });
  it("normalises empty subtitles to null", () => {
    expect(mapRows([row({ r_subtitle: "  " })])[0].subtitle).toBeNull();
  });
});

describe("groupByCategory", () => {
  it("groups in display order and omits empty groups", () => {
    const g = groupByCategory([result({ category: "homework", id: "h" }), result({ category: "students", id: "s" })]);
    expect(g.map((x) => x.category)).toEqual(["students", "homework"]);
  });
});

describe("categoriesForRole (UI hint only)", () => {
  it("offers nothing without a role", () => {
    expect(categoriesForRole(null)).toEqual([]);
    expect(categoriesForRole("mystery")).toEqual([]);
  });
  it("students never get people categories", () => {
    const c = categoriesForRole("student");
    expect(c).not.toContain("students");
    expect(c).not.toContain("staff");
    expect(c).not.toContain("classes");
  });
  it("parents only search their children", () => {
    expect(categoriesForRole("parent")).toEqual(["students"]);
  });
  it("only admin roles are offered staff; only the platform admin gets schools", () => {
    expect(categoriesForRole("teacher")).not.toContain("staff");
    expect(categoriesForRole("principal")).toContain("staff");
    expect(categoriesForRole("knsoft_admin")).toEqual(["schools"]);
    expect(categoriesForRole("school_admin")).not.toContain("schools");
  });
});

describe("resolveResultRoute (existing routes only)", () => {
  it("students open the per-record exam route", () => {
    expect(resolveResultRoute(result({ category: "exams", id: "a1" }), "student")).toBe("/exam/a1");
  });
  it("encodes ids so they cannot alter the path", () => {
    expect(resolveResultRoute(result({ category: "exams", id: "../admin" }), "student")).toBe("/exam/..%2Fadmin");
  });
  it("staff open the student verify page; parents open the profile page", () => {
    expect(resolveResultRoute(result({ id: "s1" }), "teacher")).toBe("/verify-student/s1");
    expect(resolveResultRoute(result({ id: "s1" }), "parent")).toBe("/student-profile");
  });
  it("returns null where the role has no page (no dead-end navigation)", () => {
    expect(resolveResultRoute(result({ id: "s1" }), "hod")).toBeNull();
    expect(resolveResultRoute(result({ id: "s1" }), "student")).toBeNull();
    expect(resolveResultRoute(result({ category: "staff" }), "teacher")).toBeNull();
    expect(resolveResultRoute(result({ category: "schools" }), "school_admin")).toBeNull();
    expect(resolveResultRoute(result(), null)).toBeNull();
  });
  it("schools are platform-admin only", () => {
    expect(resolveResultRoute(result({ category: "schools" }), "knsoft_admin")).toBe("/knsoft-admin");
  });
});

describe("splitHighlight", () => {
  it("marks case-insensitive matches", () => {
    expect(splitHighlight("Asha Rao", "RA")).toEqual([
      { text: "Asha ", match: false }, { text: "Ra", match: true }, { text: "o", match: false },
    ]);
  });
  it("treats regex/like characters literally", () => {
    expect(splitHighlight("50% (maths)", "(m")).toEqual([
      { text: "50% ", match: false }, { text: "(m", match: true }, { text: "aths)", match: false },
    ]);
    expect(() => splitHighlight("abc", ".*")).not.toThrow();
  });
  it("does nothing for too-short queries", () => {
    expect(splitHighlight("Asha", "a")).toEqual([{ text: "Asha", match: false }]);
  });
});

describe("describeSearchError", () => {
  it("never leaks raw database text", () => {
    const msg = describeSearchError({ code: "XX000", message: 'relation "students" column "x" does not exist' });
    expect(msg).toBe("Search failed. Please try again.");
  });
  it("explains a missing function and a network failure", () => {
    expect(describeSearchError({ code: "PGRST202" })).toMatch(/migration/i);
    expect(describeSearchError(new TypeError("Failed to fetch"))).toMatch(/connection/i);
  });
  it("is silent for aborted requests", () => {
    expect(describeSearchError({ name: "AbortError" })).toBe("");
  });
});

describe("recent searches", () => {
  beforeEach(() => window.localStorage.clear());

  it("stores only normalised query text, most recent first, without duplicates", () => {
    addRecentSearch("u1", "  asha  rao ");
    addRecentSearch("u1", "algebra");
    addRecentSearch("u1", "ASHA RAO");
    expect(getRecentSearches("u1")).toEqual(["ASHA RAO", "algebra"]);
  });
  it("ignores too-short queries and missing users", () => {
    addRecentSearch("u1", "a");
    addRecentSearch(null, "algebra");
    expect(getRecentSearches("u1")).toEqual([]);
    expect(getRecentSearches(null)).toEqual([]);
  });
  it("caps the list", () => {
    for (let i = 0; i < MAX_RECENT + 5; i++) addRecentSearch("u1", `query ${i}`);
    expect(getRecentSearches("u1")).toHaveLength(MAX_RECENT);
  });
  it("is isolated per user", () => {
    addRecentSearch("u1", "asha");
    addRecentSearch("u2", "maths");
    expect(getRecentSearches("u1")).toEqual(["asha"]);
    expect(getRecentSearches("u2")).toEqual(["maths"]);
  });
  it("clears one user, or everyone (logout)", () => {
    addRecentSearch("u1", "asha");
    addRecentSearch("u2", "maths");
    clearRecentSearches("u1");
    expect(getRecentSearches("u1")).toEqual([]);
    expect(getRecentSearches("u2")).toEqual(["maths"]);
    clearAllRecentSearches();
    expect(getRecentSearches("u2")).toEqual([]);
  });
  it("survives corrupt storage", () => {
    window.localStorage.setItem("apas.search.recent.v1:u1", "{not json");
    expect(getRecentSearches("u1")).toEqual([]);
    window.localStorage.setItem("apas.search.recent.v1:u1", JSON.stringify([1, null, "ok query", { a: 1 }]));
    expect(getRecentSearches("u1")).toEqual(["ok query"]);
  });
});
