// Real watch-time tracking for the video player (feeds the Student Engagement Score).
//
// A video counts as "watched" only for the seconds a student actually played it: opening a video, dragging the
// scrubber, or leaving it paused earns nothing. Seconds are tracked as a SET, so re-watching the same part never
// inflates the total and the number can never exceed the video's length.
//
// The reporter sends the CUMULATIVE unique seconds (not increments) through the existing learning-event stream
// (`video_progress`, see lib/learningEvents.ts). The server takes the maximum per video, so retries, repeated events
// and watching the same video on several devices cannot add up.
import { trackLearningEvent, flushLearningEvents } from "@/lib/learningEvents";

export class WatchAccumulator {
  private seconds = new Set<number>();
  private lastTime: number | null = null;
  private lastWall = 0;
  private duration = 0;

  setDuration(d: number): void {
    if (Number.isFinite(d) && d > 0) this.duration = d;
  }
  getDuration(): number { return this.duration; }

  /**
   * Report the playhead. `playing` must be true only while the video is really playing. A jump (seek) breaks the
   * run; only continuous forward playback is credited, and only for the seconds fully crossed.
   */
  tick(currentTime: number, playing: boolean, wallMs: number, rate = 1): void {
    if (!playing || !Number.isFinite(currentTime) || currentTime < 0) { this.lastTime = null; return; }
    if (this.lastTime !== null) {
      const dt = currentTime - this.lastTime;
      const wall = Math.max(0, (wallMs - this.lastWall) / 1000);
      // Real playback advances roughly at wall-clock speed; a seek advances media time much faster (or backwards).
      if (dt > 0 && dt <= wall * Math.max(rate, 1) + 1.5) {
        for (let k = Math.floor(this.lastTime); k < Math.floor(currentTime); k++) this.mark(k);
      }
    }
    this.lastTime = currentTime;
    this.lastWall = wallMs;
  }

  /** The video reached its end: credit the final partial second. */
  ended(): void {
    if (this.duration > 0 && this.lastTime !== null && this.duration - this.lastTime < 3) {
      for (let k = Math.floor(this.lastTime); k < Math.ceil(this.duration); k++) this.mark(k);
    }
    this.lastTime = null;
  }

  /** Playback paused / seeking / tab hidden: the next tick starts a fresh run. */
  breakRun(): void { this.lastTime = null; }

  private mark(k: number): void {
    if (k < 0) return;
    if (this.duration > 0 && k >= Math.ceil(this.duration)) return;
    this.seconds.add(k);
  }

  /** Unique seconds watched, never more than the video's length. */
  watched(): number {
    return this.duration > 0 ? Math.min(this.seconds.size, Math.ceil(this.duration)) : this.seconds.size;
  }
  fraction(): number { return this.duration > 0 ? Math.min(1, this.watched() / this.duration) : 0; }
}

export interface VideoProgressPayload { resource_id: string; title?: string; watched_seconds: number; video_duration: number }
export type ProgressSink = (p: VideoProgressPayload) => void;

const defaultSink: ProgressSink = (p) =>
  trackLearningEvent({
    event_type: "video_progress", resource_id: p.resource_id, title: p.title,
    watched_seconds: p.watched_seconds, video_duration: p.video_duration,
  });

/** One viewing session of one video: feeds the accumulator and reports progress at sensible moments. */
export class VideoWatchSession {
  readonly acc = new WatchAccumulator();
  private lastSent = 0;
  private lastSentWall = 0;

  constructor(
    private readonly resourceId: string,
    private readonly title: string | undefined,
    private readonly sink: ProgressSink = defaultSink,
    /** Report at most this often while playing. */
    private readonly everySeconds = 30,
  ) {}

  setDuration(d: number): void { this.acc.setDuration(d); }

  time(currentTime: number, playing: boolean, wallMs: number = Date.now(), rate = 1): void {
    this.acc.tick(currentTime, playing, wallMs, rate);
    if (!this.lastSentWall) this.lastSentWall = wallMs;
    if (playing && wallMs - this.lastSentWall >= this.everySeconds * 1000) this.report(wallMs);
  }

  pause(wallMs: number = Date.now()): void { this.acc.breakRun(); this.report(wallMs); }
  end(wallMs: number = Date.now()): void { this.acc.ended(); this.report(wallMs); }

  /** Send now if there is anything new. Called on pause, end, tab hide and unmount. */
  report(wallMs: number = Date.now()): void {
    const w = this.acc.watched(), d = this.acc.getDuration();
    this.lastSentWall = wallMs;
    if (w <= this.lastSent || d <= 0 || !this.resourceId) return;
    this.lastSent = w;
    this.sink({ resource_id: this.resourceId, title: this.title, watched_seconds: w, video_duration: Math.round(d) });
  }

  /** Final report, then push the telemetry queue out immediately (the page may be going away). */
  close(): void { this.report(); void flushLearningEvents(); }
}
