import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { governanceLink, inferCategory } from "@/lib/notificationModel";

// The reminder logic lives in SQL (it has to run on a server schedule), so these tests pin the properties that keep it
// safe: scheduled inside the database, de-duplicated, school-scoped, locked away from clients, and wired to the bell.

const root = resolve(__dirname, "../../");
const sql = readFileSync(resolve(root, "supabase/migrations/20261025000000_calendar_feed_and_reminders.sql"), "utf8");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
const page = readFileSync(resolve(root, "src/pages/AcademicCalendar.tsx"), "utf8");

describe("calendar reminder migration", () => {
  it("runs on a server-side pg_cron schedule that replaces itself instead of stacking", () => {
    expect(sql).toMatch(/cron\.unschedule\(jobid\)[^;]*calendar-reminders-hourly/);
    expect(sql).toMatch(/cron\.schedule\('calendar-reminders-hourly', '5 \* \* \* \*'/);
  });
  it("remembers what was sent with a unique key that includes the date the reminder was for", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_reminder_log/);
    expect(sql).toMatch(/occurrence\s+text NOT NULL/);
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
  });
  it("keeps the log private and the scheduler body away from clients", () => {
    expect(sql).toMatch(/ALTER TABLE public\.calendar_reminder_log ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.calendar_reminder_log FROM anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.calendar_run_reminders\(\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.calendar_recipients\([^)]*\) FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.calendar_run_reminders/);
  });
  it("only the read-only feed is callable by signed-in users, and it derives the caller from auth.uid()", () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_calendar_feed\(date, date\) TO authenticated/);
    expect(sql).toMatch(/v_uid\s+uuid := auth\.uid\(\)/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_calendar_feed\(date, date\) FROM PUBLIC, anon/);
  });
  it("scopes every recipient lookup to the item's own school", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.calendar_recipients"), sql.indexOf("-- Reminder log"));
    expect(fn).toMatch(/IF p_school IS NULL THEN RETURN/);
    // every profiles lookup in the function is filtered by the school
    const lookups = fn.match(/FROM public\.profiles \w+[\s\S]*?;/g) ?? [];
    expect(lookups.length).toBeGreaterThan(4);
    for (const l of lookups) expect(l).toMatch(/school_id\s*(=|IS NOT DISTINCT FROM)\s*p_school|\.id = p_owner/);
  });
  it("sends reschedule and cancel notices from triggers that can never block the edit", () => {
    for (const t of ["trg_calendar_event_change", "trg_exam_schedule_change", "trg_homework_deadline_change"]) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${t}()`));
      expect(body.slice(0, 2500)).toMatch(/EXCEPTION WHEN OTHERS THEN/);
    }
    expect(sql).toMatch(/'cancelled'/);
    expect(sql).toMatch(/'rescheduled'/);
  });
  it("does not rebuild or alter existing tables", () => {
    expect(sql).not.toMatch(/DROP TABLE|ALTER TABLE public\.(academic_calendar_events|exam_schedules|homework_assignments|governance_notifications)/);
    expect(sql).not.toMatch(/DROP POLICY/);
  });
});

describe("calendar page and bell wiring", () => {
  it("merges the role-scoped feed and keeps derived items read-only", () => {
    expect(page).toContain('rpc("get_calendar_feed"');
    expect(page).toContain("isAdmin && !e.derived");
  });
  it("refreshes when dates change", () => {
    expect(page).toContain('table: "exam_schedules"');
    expect(page).toContain('table: "homework_assignments"');
    expect(page).toContain("visibilitychange");
  });
  it("calendar notifications land in Academics and open the calendar for the roles that receive them", () => {
    for (const e of ["calendar_reminder_exam", "calendar_reminder_homework", "calendar_change_holiday"]) expect(inferCategory({ event_type: e, title: "x" })).toBe("academics");
    expect(app).toContain('path="/academic-calendar"');
    for (const r of ["student", "parent", "teacher", "hod", "admin", "principal", "school_admin"]) expect(governanceLink("calendar_reminder_exam", r)).toBe("/academic-calendar");
    expect(governanceLink("calendar_reminder_exam", "knsoft_admin")).toBeUndefined();
  });
});
