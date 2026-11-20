// Pure helpers behind the workbench / SLA indicators. The deadlines themselves come from the database.
import { describe, it, expect } from "vitest";
import {
  slaStateAt, formatRemaining, worstState, inView, countViews, clockSkewMs, pct, formatMinutes, type WorkbenchLead,
} from "@/lib/admissionAssignment";

const NOW = Date.parse("2026-11-16T10:00:00Z");
const min = (m: number) => new Date(NOW + m * 60000).toISOString();
const clock = (dueInMin: number, soonWindow = 10) => ({ due_at: min(dueInMin), due_soon_at: min(dueInMin - soonWindow), state: "on_track" as const });
const lead = (o: Partial<WorkbenchLead> = {}): WorkbenchLead => ({
  applicant_id: "a", full_name: "A", parent_name: null, parent_phone: null, parent_email: null, status: "under_review", source: "walk_in", grade: null,
  created_at: min(-60), meeting_notes: null, assigned_to: "c1", assigned_to_name: "C", assigned_at: min(-60), assignment_method: "auto",
  score: 50, category: "warm", first_contact_at: null, last_contact_at: null, contact_count: 0, note_count: 0, last_event_type: null, last_event_at: null,
  next_follow_up_at: null, is_new: false, first_response: null, follow_up: null, sla_state: null, follow_up_today: false, follow_up_pending: false, ...o,
});

describe("slaStateAt", () => {
  it("is on track before the due-soon window, due soon inside it, overdue at and after the deadline", () => {
    expect(slaStateAt(clock(30), NOW)).toBe("on_track");
    expect(slaStateAt(clock(11), NOW)).toBe("on_track");
    expect(slaStateAt(clock(10), NOW)).toBe("due_soon");     // exactly at the window start
    expect(slaStateAt(clock(1), NOW)).toBe("due_soon");
    expect(slaStateAt(clock(0), NOW)).toBe("overdue");       // exactly at the deadline
    expect(slaStateAt(clock(-90), NOW)).toBe("overdue");
  });
  it("has no state without a running clock, and a state keeps changing as time passes", () => {
    expect(slaStateAt(null, NOW)).toBeNull();
    const c = clock(30);
    expect(slaStateAt(c, NOW)).toBe("on_track");
    expect(slaStateAt(c, NOW + 21 * 60000)).toBe("due_soon");
    expect(slaStateAt(c, NOW + 31 * 60000)).toBe("overdue");
  });
});

describe("formatRemaining", () => {
  it("shows time left or how late", () => {
    expect(formatRemaining(min(25), NOW)).toBe("25m left");
    expect(formatRemaining(min(125), NOW)).toBe("2h 05m left");
    expect(formatRemaining(min(60 * 60), NOW)).toBe("2d 12h left");
    expect(formatRemaining(min(-40), NOW)).toBe("Overdue by 40m");
    expect(formatRemaining(min(-150), NOW)).toBe("Overdue by 2h 30m");
    expect(formatRemaining(new Date(NOW + 20000).toISOString(), NOW)).toBe("under a minute left");
  });
});

describe("worstState / views", () => {
  it("takes the worse of the two clocks", () => {
    expect(worstState(lead({ first_response: clock(30), follow_up: clock(-5) }), NOW)).toBe("overdue");
    expect(worstState(lead({ first_response: clock(30), follow_up: clock(5) }), NOW)).toBe("due_soon");
    expect(worstState(lead({ first_response: clock(30) }), NOW)).toBe("on_track");
    expect(worstState(lead(), NOW)).toBeNull();
  });
  it("puts a lead in every view it belongs to", () => {
    const leads = [
      lead({ applicant_id: "1", is_new: true, category: "hot", first_response: clock(5) }),
      lead({ applicant_id: "2", category: "warm", follow_up: clock(-20), follow_up_today: true }),
      lead({ applicant_id: "3", category: "cold", follow_up: clock(3000), follow_up_pending: true }),
      lead({ applicant_id: "4", category: null }),
    ];
    const c = countViews(leads, NOW);
    expect(c).toEqual({ assigned: 4, new: 1, hot: 1, warm: 1, cold: 1, today: 1, pending: 1, overdue: 1 });
    expect(inView(leads[1], "overdue", NOW) && inView(leads[1], "today", NOW) && inView(leads[1], "warm", NOW)).toBe(true);
  });
  it("overdue is recomputed from the clock, not trusted from a stale server value", () => {
    const l = lead({ first_response: { ...clock(5), state: "on_track" } });
    expect(inView(l, "overdue", NOW)).toBe(false);
    expect(inView(l, "overdue", NOW + 6 * 60000)).toBe(true);
  });
});

describe("misc", () => {
  it("corrects for a wrong device clock", () => {
    expect(clockSkewMs("2026-11-16T10:00:00Z", NOW - 3_600_000)).toBe(3_600_000);
    expect(clockSkewMs(undefined, NOW)).toBe(0);
    expect(clockSkewMs("garbage", NOW)).toBe(0);
  });
  it("formats percentages and durations without inventing numbers", () => {
    expect(pct(3, 4)).toBe("75%"); expect(pct(0, 0)).toBe("—");
    expect(formatMinutes(null)).toBe("—"); expect(formatMinutes(12.4)).toBe("12m"); expect(formatMinutes(125)).toBe("2h 5m");
  });
});
