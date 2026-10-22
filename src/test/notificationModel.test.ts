import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CATEGORY_ORDER, filterNotifications, governanceLink, inferCategory, isDuplicateOfRecent, isImportant,
  mapGovernanceRow, mergeNotifications, sortNewest, tabCounts, type NotificationLike,
} from "@/lib/notificationModel";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
const T0 = Date.parse("2026-10-22T10:00:00Z");
const n = (o: Partial<NotificationLike> = {}): NotificationLike => ({
  id: "a", title: "T", message: "M", type: "info", is_read: false, created_at: new Date(T0).toISOString(), ...o,
});

describe("categories", () => {
  it("classify real event types", () => {
    const c = (e: string) => inferCategory({ event_type: e, title: "", link: undefined });
    expect(c("attendance_marked")).toBe("attendance");
    expect(c("transport_boarding")).toBe("transport");
    expect(c("vehicle_overspeed")).toBe("safety");
    expect(c("unauthorized_boarding")).toBe("safety");
    expect(c("diagnostic_request_rejected")).toBe("approvals");
    expect(c("substitute_approved")).toBe("approvals");
    expect(c("diagnostic_completed")).toBe("academics");
    expect(c("tutor_message")).toBe("messages");
    expect(c("irt_calibration_flagged")).toBe("system");
    expect(c("automation_attendance_low")).toBe("system");
  });
  it("falls back to wording for browser-raised notifications that have no event type", () => {
    const t = (title: string) => inferCategory({ title, event_type: undefined, link: undefined });
    expect(t("New homework assigned")).toBe("academics");
    expect(t("You have a new message")).toBe("messages");
    expect(t("Performance drop detected")).toBe("safety");
    expect(t("Diagnostic request approved")).toBe("approvals");
  });
  it("an explicit category wins, and every category is listed", () => {
    expect(inferCategory({ title: "homework", category: "system", event_type: undefined, link: undefined })).toBe("system");
    expect(CATEGORY_ORDER.length).toBe(7);
  });
});

describe("important", () => {
  it("flags alerts, rejections, absences and warning/error styling", () => {
    expect(isImportant(n({ type: "warning" }))).toBe(true);
    expect(isImportant(n({ type: "error" }))).toBe(true);
    expect(isImportant(n({ event_type: "vehicle_overspeed" }))).toBe(true);
    expect(isImportant(n({ event_type: "diagnostic_request_rejected" }))).toBe(true);
    expect(isImportant(n({ event_type: "attendance_marked", message: "Asha was marked absent today." }))).toBe(true);
  });
  it("does not flag routine items", () => {
    expect(isImportant(n({ event_type: "attendance_marked", message: "Asha was marked present." }))).toBe(false);
    expect(isImportant(n({ event_type: "substitute_approved" }))).toBe(false);
    expect(isImportant(n())).toBe(false);
  });
});

describe("links: only real routes that admit the role", () => {
  const EVENTS = [
    "transport_boarding", "transport_drop", "vehicle_overspeed", "route_deviation", "unauthorized_stop", "unauthorized_boarding",
    "restricted_zone_entry", "student_incident", "weather_alert", "round_completed", "attendance_marked",
    "diagnostic_request_approved", "diagnostic_request_rejected", "diagnostic_request_submitted", "diagnostic_questions_assigned",
    "diagnostic_completed", "substitute_approved", "tutor_message", "irt_calibration_flagged", "open_ended_calibration_adjusted", "automation_x",
  ];
  const ROLES = ["student", "teacher", "parent", "admin", "principal", "hod", "school_admin", "knsoft_admin", "driver"];
  it("every link resolves to a route in App.tsx whose guard admits that role", () => {
    const routes = new Map<string, string[] | null>();
    for (const line of read("src/App.tsx").split("\n")) {
      const p = line.match(/<Route\s+path="([^"]+)"/);
      if (!p) continue;
      const g = line.match(/allowedRoles=\{\[([^\]]*)\]\}/);
      routes.set(p[1], g ? [...g[1].matchAll(/["']([a-z_]+)["']/g)].map((m) => m[1]) : null);
    }
    const bad: string[] = [];
    for (const e of EVENTS) for (const r of ROLES) {
      const link = governanceLink(e, r);
      if (!link) continue;
      const base = link.split("?")[0];
      if (!routes.has(base)) bad.push(`${e}/${r} -> ${link} (no such route)`);
      else if (routes.get(base) && !routes.get(base)!.includes(r)) bad.push(`${e}/${r} -> ${link} (role not allowed)`);
    }
    expect(bad).toEqual([]);
  });
  it("the old '/admin-panel' link (not a route) is gone", () => {
    expect(read("src/contexts/NotificationContext.tsx").includes("/admin-panel")).toBe(false);
  });
  it("unknown events have no link instead of a guessed one", () => {
    expect(governanceLink("something_new", "teacher")).toBe(undefined);
  });
  it("role-specific: parents and admins get different pages for the same transport event", () => {
    expect(governanceLink("vehicle_overspeed", "parent")).toBe("/parent-dashboard");
    expect(governanceLink("vehicle_overspeed", "principal")).toBe("/transport");
    expect(governanceLink("vehicle_overspeed", "student")).toBe(undefined);
  });
});

describe("mapGovernanceRow", () => {
  const row = { id: "r1", event_type: "diagnostic_request_rejected", title: "Request Rejected", message: "m", is_read: false, created_at: "2026-10-22T10:00:00Z" };
  it("keeps the existing type mapping and adds category, link, source", () => {
    const m = mapGovernanceRow(row, "teacher");
    expect(m).toMatchObject({ id: "r1", type: "warning", source: "db", category: "approvals", link: "/requests", is_read: false });
    expect(mapGovernanceRow({ ...row, event_type: "diagnostic_request_approved" }, "teacher").type).toBe("success");
    expect(mapGovernanceRow({ ...row, event_type: "attendance_marked" }, "parent").type).toBe("info");
    expect(mapGovernanceRow({ ...row, event_type: "vehicle_overspeed" }, "parent").type).toBe("warning");
  });
});

describe("filtering", () => {
  const list = [
    n({ id: "1", title: "Homework submitted", message: "Asha submitted Maths", event_type: undefined, is_read: false }),
    n({ id: "2", title: "Attendance Update", message: "Ravi was marked absent", event_type: "attendance_marked", is_read: true }),
    n({ id: "3", title: "Overspeed", message: "Bus 4 exceeded the limit", event_type: "vehicle_overspeed", type: "warning", is_read: false }),
  ];
  const f = (o: Partial<Parameters<typeof filterNotifications>[1]>) => filterNotifications(list, { tab: "all", category: "all", query: "", ...o }).map((x) => x.id);
  it("tabs", () => {
    expect(f({})).toEqual(["1", "2", "3"]);
    expect(f({ tab: "unread" })).toEqual(["1", "3"]);
    expect(f({ tab: "read" })).toEqual(["2"]);
    expect(f({ tab: "important" })).toEqual(["2", "3"]);
  });
  it("search is case-insensitive over title and message and tolerates extra spaces", () => {
    expect(f({ query: "  ASHA " })).toEqual(["1"]);
    expect(f({ query: "limit" })).toEqual(["3"]);
    expect(f({ query: "zzz" })).toEqual([]);
  });
  it("category and combined filters", () => {
    expect(f({ category: "attendance" })).toEqual(["2"]);
    expect(f({ category: "safety", tab: "unread" })).toEqual(["3"]);
    expect(f({ category: "attendance", tab: "unread" })).toEqual([]);
  });
  it("counts", () => {
    expect(tabCounts(list)).toEqual({ all: 3, unread: 2, read: 1, important: 2 });
  });
});

describe("duplicates", () => {
  const at = (ms: number) => new Date(T0 + ms).toISOString();
  it("same event within a minute is a duplicate; later or different is not", () => {
    const e = [n({ title: "A", message: "B", link: "/x", created_at: at(0) })];
    expect(isDuplicateOfRecent(e, { title: "A", message: "B", link: "/x", created_at: at(30_000) })).toBe(true);
    expect(isDuplicateOfRecent(e, { title: "A", message: "B", link: "/x", created_at: at(120_000) })).toBe(false);
    expect(isDuplicateOfRecent(e, { title: "A", message: "C", link: "/x", created_at: at(1_000) })).toBe(false);
  });
  it("an explicit key keeps two senders' identical messages apart", () => {
    const e = [n({ title: "msg", message: "Open", dedupe_key: "msg:alice", created_at: at(0) })];
    expect(isDuplicateOfRecent(e, { title: "msg", message: "Open", created_at: at(1_000), dedupe_key: "msg:bob" })).toBe(false);
    expect(isDuplicateOfRecent(e, { title: "msg", message: "Open", created_at: at(1_000), dedupe_key: "msg:alice" })).toBe(true);
  });
  it("merge is by id: first copy wins, nothing collapsed by wording, newest first", () => {
    const fresh = [n({ id: "1", is_read: true, created_at: at(0) })];
    const history = [n({ id: "1", is_read: false, created_at: at(0) }), n({ id: "2", created_at: at(5_000) }), n({ id: "3", created_at: at(6_000) })];
    const m = mergeNotifications(fresh, history);
    expect(m.map((x) => x.id)).toEqual(["3", "2", "1"]);
    expect(m.find((x) => x.id === "1")!.is_read).toBe(true);
    expect(sortNewest([n({ id: "o", created_at: at(0) }), n({ id: "p", created_at: at(9) })]).map((x) => x.id)).toEqual(["p", "o"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Static guards for what cannot be executed in a unit test (database trigger SQL, context queries).
// ---------------------------------------------------------------------------------------------------------------
describe("migration 20261024000000_notification_inbox_support.sql", () => {
  const sql = read("supabase/migrations/20261024000000_notification_inbox_support.sql").replace(/--[^\n]*/g, "");
  it("is additive: no drop of tables/columns, no delete/truncate of rows, no new broad RLS", () => {
    expect(/\bDROP\s+(TABLE|COLUMN|POLICY)\b/i.test(sql)).toBe(false);
    expect(/\b(DELETE\s+FROM|TRUNCATE)\b/i.test(sql)).toBe(false);
    expect(/CREATE\s+POLICY/i.test(sql)).toBe(false);
  });
  it("no recipient query is left that selects every admin on the platform", () => {
    expect(/FROM profiles p WHERE p\.role IN \('admin', 'school_admin'\)/.test(sql)).toBe(false);
    expect(/WHERE role IN \('admin', 'school_admin'\)/.test(sql)).toBe(false);
    expect((sql.match(/school_admin_recipients\(v_school\)/g) ?? []).length).toBe(3);
  });
  it("every SECURITY DEFINER function pins its search_path and is not callable by clients", () => {
    const defs = sql.match(/SECURITY DEFINER[\s\S]{0,60}?SET search_path/gi) ?? [];
    expect(defs.length).toBe((sql.match(/SECURITY DEFINER/gi) ?? []).length);
    expect(sql.includes("REVOKE ALL ON FUNCTION public.governance_notifications_dedupe() FROM PUBLIC, anon, authenticated")).toBe(true);
    expect(sql.includes("REVOKE ALL ON FUNCTION public.school_admin_recipients(uuid) FROM PUBLIC, anon, authenticated")).toBe(true);
  });
  it("the duplicate trigger skips the row (RETURN NULL) instead of raising, so bulk inserts never fail", () => {
    expect(sql.includes("RETURN NULL")).toBe(true);
    expect(/RAISE\s+EXCEPTION/i.test(sql)).toBe(false);
  });
});

describe("NotificationContext", () => {
  const ctx = read("src/contexts/NotificationContext.tsx");
  it("every governance_notifications query is keyed to the signed-in user", () => {
    // Statement by statement: any statement that touches the table must mention user_id (RLS also enforces it).
    const statements = ctx.split(";").filter((st) => st.includes('from("governance_notifications")'));
    expect(statements.length >= 5).toBe(true);
    const unkeyed = statements.filter((st) => !st.includes('"user_id"')).map((st) => st.trim().slice(0, 80));
    expect(unkeyed).toEqual([]);
  });
  it("the realtime channel is filtered to this user", () => {
    expect(ctx.includes('filter: `user_id=eq.${user.id}`')).toBe(true);
    expect(ctx.includes("row.user_id !== user.id")).toBe(true);
  });
  it("superseded channels that duplicated governance rows are gone", () => {
    for (const name of ["notif_transport_alerts", "notif_gov_approved", "notif_request_status", "notif_diag_request_admin"]) {
      expect(ctx.includes(name)).toBe(false);
    }
  });
  it("exposes dismiss and persists read state", () => {
    expect(ctx.includes("dismiss,")).toBe(true);
    expect(ctx.includes('update({ is_read: true })')).toBe(true);
  });
});

describe("wiring", () => {
  it("the inbox route is open to any signed-in user (data is per-user) and the sidebar links to it", () => {
    const app = read("src/App.tsx");
    const line = app.split("\n").find((l) => l.includes('path="/notifications"'))!;
    expect(!!line).toBe(true);
    expect(line.includes("RoleGuard")).toBe(false);
    expect(line.includes("ProtectedRoute")).toBe(true);
    expect(read("src/components/layout/AppSidebar.tsx").includes('path: "/notifications"')).toBe(true);
  });
});
