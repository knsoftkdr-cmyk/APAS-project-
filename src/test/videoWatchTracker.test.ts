import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/learningEvents", () => ({ trackLearningEvent: vi.fn(), flushLearningEvents: vi.fn() }));

import { WatchAccumulator, VideoWatchSession, type VideoProgressPayload } from "@/lib/videoWatchTracker";
import { sanitizeClientEvent } from "../../supabase/functions/_shared/learningEventModel";
import { videoActivity, DEFAULT_CONFIG } from "../../supabase/functions/_shared/engagementModel";

/** Simulate continuous playback from `from` to `to` seconds, ticking every 250ms of wall-clock time. */
function play(acc: WatchAccumulator, from: number, to: number, wall = { t: 1_000_000 }) {
  for (let t = from; t <= to + 1e-9; t += 0.25) { acc.tick(t, true, wall.t); wall.t += 250; }
  return wall;
}

describe("WatchAccumulator", () => {
  it("opening a video without playing earns nothing", () => {
    const a = new WatchAccumulator(); a.setDuration(600);
    a.tick(0, false, 1000);
    expect(a.watched()).toBe(0);
  });
  it("credits continuous playback", () => {
    const a = new WatchAccumulator(); a.setDuration(600);
    play(a, 0, 60);
    expect(a.watched()).toBeGreaterThanOrEqual(59);
    expect(a.watched()).toBeLessThanOrEqual(60);
  });
  it("a seek forward does not credit the skipped part", () => {
    const a = new WatchAccumulator(); a.setDuration(600);
    const wall = play(a, 0, 10);
    a.tick(500, true, wall.t + 250); // jump
    play(a, 500, 505, { t: wall.t + 500 });
    expect(a.watched()).toBeLessThan(20);
  });
  it("re-watching the same part never inflates the total", () => {
    const a = new WatchAccumulator(); a.setDuration(600);
    const wall = play(a, 0, 30);
    const once = a.watched();
    a.breakRun();
    play(a, 0, 30, { t: wall.t + 1000 });
    expect(a.watched()).toBe(once);
  });
  it("pausing breaks the run", () => {
    const a = new WatchAccumulator(); a.setDuration(600);
    a.tick(10, true, 1000); a.tick(10.2, false, 1200);
    a.tick(400, true, 5000); // resumes somewhere else with no continuous run
    expect(a.watched()).toBe(0);
  });
  it("never exceeds the video length", () => {
    const a = new WatchAccumulator(); a.setDuration(20);
    play(a, 0, 20); a.ended();
    expect(a.watched()).toBeLessThanOrEqual(20);
    expect(a.fraction()).toBeLessThanOrEqual(1);
  });
  it("watching to the end counts as (nearly) fully watched", () => {
    const a = new WatchAccumulator(); a.setDuration(30);
    play(a, 0, 29.8); a.ended();
    expect(a.fraction()).toBeGreaterThanOrEqual(0.95);
  });
  it("tab sleep (huge media jump with little wall time) is not credited", () => {
    const a = new WatchAccumulator(); a.setDuration(600);
    a.tick(0, true, 0); a.tick(300, true, 500);
    expect(a.watched()).toBe(0);
  });
});

describe("VideoWatchSession reporting", () => {
  const make = () => { const sent: VideoProgressPayload[] = []; return { sent, s: new VideoWatchSession("vid1", "Fractions", (p) => sent.push(p), 30) }; };

  it("sends nothing when nothing was watched", () => {
    const { s, sent } = make(); s.setDuration(600);
    s.time(0, false, 1000); s.pause(2000);
    expect(sent).toHaveLength(0);
  });
  it("reports cumulative seconds on pause", () => {
    const { s, sent } = make(); s.setDuration(600);
    for (let t = 0, w = 1000; t <= 20; t += 0.25, w += 250) s.time(t, true, w);
    s.pause(10_000);
    expect(sent).toHaveLength(1);
    expect(sent[0].resource_id).toBe("vid1");
    expect(sent[0].video_duration).toBe(600);
    expect(sent[0].watched_seconds).toBeGreaterThanOrEqual(19);
  });
  it("reports about every 30 seconds while playing, not on every tick", () => {
    const { s, sent } = make(); s.setDuration(600);
    for (let t = 0, w = 0; t <= 95; t += 0.25, w += 250) s.time(t, true, w);
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent.length).toBeLessThanOrEqual(4);
  });
  it("does not resend an unchanged value", () => {
    const { s, sent } = make(); s.setDuration(600);
    for (let t = 0, w = 1000; t <= 10; t += 0.25, w += 250) s.time(t, true, w);
    s.pause(5000); s.pause(6000); s.pause(7000);
    expect(sent).toHaveLength(1);
  });
});

describe("server accepts and bounds video_progress events", () => {
  const now = Date.UTC(2026, 10, 9, 10, 0, 0);
  it("keeps a valid event", () => {
    const e = sanitizeClientEvent({ event_type: "video_progress", resource_id: "abc-123", watched_seconds: 120.4, video_duration: 600, client_event_id: "c1" }, now);
    expect(e?.event_type).toBe("video_progress");
    expect(e?.ref_id).toBe("abc-123");
    expect(e?.payload).toMatchObject({ watched_seconds: 120, video_duration: 600 });
  });
  it("clamps watched seconds to the video length", () => {
    const e = sanitizeClientEvent({ event_type: "video_progress", resource_id: "v", watched_seconds: 9999, video_duration: 100 }, now);
    expect(e?.payload.watched_seconds).toBe(100);
  });
  it("drops events without a resource id, or with impossible numbers", () => {
    expect(sanitizeClientEvent({ event_type: "video_progress", watched_seconds: 5, video_duration: 100 }, now)).toBeNull();
    expect(sanitizeClientEvent({ event_type: "video_progress", resource_id: "v", watched_seconds: -1, video_duration: 100 }, now)).toBeNull();
    expect(sanitizeClientEvent({ event_type: "video_progress", resource_id: "v", watched_seconds: 5, video_duration: 0 }, now)).toBeNull();
    expect(sanitizeClientEvent({ event_type: "video_progress", resource_id: "bad id!", watched_seconds: 5, video_duration: 10 }, now)).toBeNull();
  });
  it("end to end: events from the sanitizer feed the engagement video score", () => {
    const ev = (w: number) => sanitizeClientEvent({ event_type: "video_progress", resource_id: "v1", watched_seconds: w, video_duration: 600 }, now)!;
    const events = [ev(30), ev(30), ev(300), ev(300), ev(300)].map((e) => ({
      ref_id: e.ref_id!, watched_seconds: Number(e.payload.watched_seconds), video_duration: Number(e.payload.video_duration),
    }));
    const r = videoActivity(["v1"], events, DEFAULT_CONFIG);
    expect(r.credit).toBe(0.5); // the maximum (300/600), not the sum of repeated events
  });
});
