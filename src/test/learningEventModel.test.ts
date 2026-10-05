import { describe, it, expect } from "vitest";
import {
  sanitizeClientEvent, describeEvent, summarizeEvents, rollupByStudent, cleanPath, activityStatus, clampTzOffset, localDate, summarizeCohort,
} from "../../supabase/functions/_shared/learningEventModel";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const now = Date.UTC(2026, 9, 3, 10, 0, 0); // 3 Oct 2026, 10:00 UTC
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

describe("cleanPath", () => {
  it("drops query strings and hashes, which can carry tokens", () => {
    expect(cleanPath("/ai-tutor?mode=career&token=abc#x")).toBe("/ai-tutor");
  });
  it("rejects anything that is not an app path", () => {
    expect(cleanPath("https://evil.example/x")).toBeNull();
    expect(cleanPath(42)).toBeNull();
  });
});

describe("sanitizeClientEvent", () => {
  it("rejects types a browser is not allowed to report", () => {
    expect(sanitizeClientEvent({ event_type: "question_answered", is_correct: true }, now)).toBeNull();
    expect(sanitizeClientEvent({ event_type: "nope" }, now)).toBeNull();
    expect(sanitizeClientEvent(null, now)).toBeNull();
    expect(sanitizeClientEvent([], now)).toBeNull();
  });
  it("keeps only whitelisted payload fields", () => {
    const e = sanitizeClientEvent({
      event_type: "page_view", path: "/my-mastery?x=1", title: "My Mastery", email: "kid@school.org", secret: "x", score: 100,
    }, now)!;
    expect(e.payload).toEqual({ path: "/my-mastery", title: "My Mastery" });
    expect(JSON.stringify(e)).not.toContain("kid@school.org");
    expect(e.source).toBe("client");
  });
  it("needs a path for page_view and a resource_type for resource events", () => {
    expect(sanitizeClientEvent({ event_type: "page_view" }, now)).toBeNull();
    expect(sanitizeClientEvent({ event_type: "resource_opened" }, now)).toBeNull();
    const r = sanitizeClientEvent({ event_type: "resource_opened", resource_type: "lesson", resource_id: "abc-123" }, now)!;
    expect(r.ref_id).toBe("abc-123");
  });
  it("ignores resource ids that are not plain identifiers", () => {
    const r = sanitizeClientEvent({ event_type: "resource_opened", resource_type: "lesson", resource_id: "a b/../c" }, now)!;
    expect(r.ref_id).toBeNull();
  });
  it("clamps timestamps: no future events, little backdating", () => {
    const future = sanitizeClientEvent({ event_type: "session_heartbeat", occurred_at: iso(-DAY) }, now)!;
    expect(Date.parse(future.occurred_at)).toBeLessThanOrEqual(now + 60_000);
    const old = sanitizeClientEvent({ event_type: "session_heartbeat", occurred_at: iso(5 * DAY) }, now)!;
    expect(Date.parse(old.occurred_at)).toBeGreaterThanOrEqual(now - 10 * MIN);
  });
  it("defaults a heartbeat to 60s and caps it", () => {
    expect(sanitizeClientEvent({ event_type: "session_heartbeat" }, now)!.duration_seconds).toBe(60);
    expect(sanitizeClientEvent({ event_type: "session_heartbeat", duration_seconds: 99999 }, now)!.duration_seconds).toBe(120);
  });
  it("builds a dedupe key only from a well-formed client id", () => {
    expect(sanitizeClientEvent({ event_type: "session_heartbeat", client_event_id: "abc_123" }, now)!.dedupe_key).toBe("c:abc_123");
    expect(sanitizeClientEvent({ event_type: "session_heartbeat", client_event_id: "bad id!" }, now)!.dedupe_key).toBeNull();
  });
});

describe("describeEvent", () => {
  it("describes an answer with its mastery change", () => {
    const d = describeEvent({
      event_type: "question_answered", is_correct: true, source: "spaced_review",
      payload: { mastery_before: 0.4, mastery_after: 0.55 }, occurred_at: iso(0),
    });
    expect(d.label).toBe("Answered correctly");
    expect(d.detail).toContain("daily review");
    expect(d.detail).toContain("+15 pts");
  });
  it("does not crash on unknown types or empty payloads", () => {
    expect(describeEvent({ event_type: "something_new", occurred_at: iso(0) }).label).toBe("something new");
    expect(describeEvent({ event_type: "assessment_submitted", payload: null, occurred_at: iso(0) }).detail).toBeNull();
  });
});

describe("summarizeEvents", () => {
  it("reports no_data for an empty window instead of inventing activity", () => {
    const s = summarizeEvents([], now, 7);
    expect(s.status).toBe("no_data");
    expect(s.total_events).toBe(0);
    expect(s.questions.accuracy_pct).toBeNull();
    expect(s.daily).toHaveLength(7);
  });
  it("computes accuracy from answered questions only", () => {
    const s = summarizeEvents([
      { event_type: "question_answered", is_correct: true, occurred_at: iso(10 * MIN) },
      { event_type: "question_answered", is_correct: true, occurred_at: iso(9 * MIN) },
      { event_type: "question_answered", is_correct: false, occurred_at: iso(8 * MIN) },
      { event_type: "tutor_message", occurred_at: iso(7 * MIN) },
    ], now, 7);
    expect(s.questions).toEqual({ answered: 3, correct: 2, accuracy_pct: 67 });
    expect(s.total_events).toBe(4);
  });
  it("counts distinct active minutes, not raw events", () => {
    const s = summarizeEvents([
      { event_type: "session_heartbeat", occurred_at: iso(5 * MIN + 1000) },
      { event_type: "page_view", occurred_at: iso(5 * MIN + 2000) },
      { event_type: "session_heartbeat", occurred_at: iso(3 * MIN + 1000) },
    ], now, 1);
    expect(s.active_minutes).toBe(2);
  });
  it("keeps heartbeats out of the event total but in active time", () => {
    const s = summarizeEvents([{ event_type: "session_heartbeat", occurred_at: iso(MIN) }], now, 1);
    expect(s.total_events).toBe(0);
    expect(s.active_minutes).toBe(1);
  });
  it("splits sessions on a 30 minute gap", () => {
    const s = summarizeEvents([
      { event_type: "page_view", occurred_at: iso(3 * 60 * MIN) },
      { event_type: "page_view", occurred_at: iso(3 * 60 * MIN - 5 * MIN) },
      { event_type: "page_view", occurred_at: iso(60 * MIN) },
    ], now, 1);
    expect(s.sessions).toBe(2);
  });
  it("ignores events outside the window", () => {
    const s = summarizeEvents([{ event_type: "page_view", occurred_at: iso(10 * DAY) }], now, 7);
    expect(s.total_events).toBe(0);
    expect(s.status).toBe("no_data");
  });
  it("buckets days in the viewer's time zone (India, UTC+5:30)", () => {
    // 20:00 UTC on 2 Oct is 01:30 on 3 Oct in India.
    const at = Date.UTC(2026, 9, 2, 20, 0, 0);
    expect(localDate(at, 330)).toBe("2026-10-03");
    expect(localDate(at, 0)).toBe("2026-10-02");
  });
  it("derives status from recency", () => {
    expect(activityStatus(now - 2 * MIN, now)).toBe("active_now");
    expect(activityStatus(now - 2 * 60 * MIN, now)).toBe("active_today");
    expect(activityStatus(now - 2 * DAY, now)).toBe("idle");
    expect(activityStatus(now - 9 * DAY, now)).toBe("inactive");
    expect(activityStatus(null, now)).toBe("no_data");
  });
  it("clamps time-zone offsets", () => {
    expect(clampTzOffset(330)).toBe(330);
    expect(clampTzOffset(99999)).toBe(840);
    expect(clampTzOffset("junk")).toBe(0);
  });
});

describe("rollupByStudent", () => {
  it("lists silent students too, last, so a teacher can see who has not been on", () => {
    const r = rollupByStudent(["a", "b", "c"], [
      { student_id: "b", event_type: "question_answered", is_correct: true, occurred_at: iso(MIN) },
      { student_id: "a", event_type: "question_answered", is_correct: false, occurred_at: iso(2 * DAY) },
    ], now, 7);
    expect(r.map((x) => x.student_id)).toEqual(["b", "a", "c"]);
    expect(r[2].status).toBe("no_data");
    expect(r[0].accuracy_pct).toBe(100);
  });
});

describe("summarizeCohort", () => {
  const ev = [
    { student_id: "a", event_type: "question_answered", is_correct: true, occurred_at: iso(2 * MIN) },
    { student_id: "a", event_type: "question_answered", is_correct: true, occurred_at: iso(MIN) },
    { student_id: "b", event_type: "question_answered", is_correct: false, occurred_at: iso(2 * MIN) },
  ];
  it("sums across students and counts who is active, idle or silent", () => {
    const c = summarizeCohort(["a", "b", "c"], ev, now, 7);
    expect(c.summary.questions).toEqual({ answered: 3, correct: 2, accuracy_pct: 67 });
    expect(c.summary.active_minutes).toBe(3); // a: 2 minutes, b: 1 minute (student-minutes)
    expect(c.status_counts.active_now).toBe(2);
    expect(c.status_counts.no_data).toBe(1);
    expect(c.summary.daily).toHaveLength(7);
    expect(c.summary.daily[6].questions).toBe(3);
  });
  it("is sane for an empty roster", () => {
    const c = summarizeCohort([], [], now, 7);
    expect(c.students).toEqual([]);
    expect(c.summary.status).toBe("no_data");
  });
});
