/**
 * Reliable long-text speech for the browser's speechSynthesis.
 *
 * Why this exists: Chrome silently stops a single utterance after ~15s / a few
 * hundred characters, and the old 15s "safety net" then switched the mic on while
 * the robot was still talking - so the agent heard its own voice as the next
 * question. This helper speaks the answer as short sentence-sized chunks, only
 * reports "done" when the LAST chunk really finishes, and recovers from a
 * stuck chunk by skipping it (never by starting the mic mid-speech).
 */

export function splitIntoSpeechChunks(text: string, maxLen = 170): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  // Sentences first (keep the punctuation)
  const sentences = clean.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [clean];
  const chunks: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ""; };
  for (const s of sentences) {
    if (s.length > maxLen) {
      // very long sentence: break on commas, then on words
      push();
      let part = "";
      for (const piece of s.split(/(?<=,)\s+/)) {
        if ((part + " " + piece).length > maxLen && part) { chunks.push(part.trim()); part = ""; }
        if (piece.length > maxLen) {
          for (const w of piece.split(" ")) {
            if ((part + " " + w).length > maxLen && part) { chunks.push(part.trim()); part = ""; }
            part += (part ? " " : "") + w;
          }
        } else {
          part += (part ? " " : "") + piece;
        }
      }
      if (part.trim()) chunks.push(part.trim());
    } else if ((cur + s).length > maxLen) {
      push();
      cur = s;
    } else {
      cur += s;
    }
  }
  push();
  return chunks;
}

export interface SpeakChunkedOptions {
  voice?: SpeechSynthesisVoice | null;
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Return false once a newer speak()/exit has superseded this one. */
  isCurrent: () => boolean;
  /** Fired once, when the first chunk actually starts. */
  onStart: () => void;
  /** charIndex is relative to the WHOLE text. */
  onBoundary?: (charIndex: number) => void;
  /** Fired once after the LAST chunk has finished (plus a short echo-tail delay). */
  onDone: () => void;
  /** Fired when speech genuinely fails (not for interrupt/cancel). */
  onFail: () => void;
  /** Gives the caller the live utterance (for utteranceRef). */
  onUtterance?: (u: SpeechSynthesisUtterance | null) => void;
}

const ECHO_TAIL_MS = 350;

export function speakChunked(text: string, opts: SpeakChunkedOptions): void {
  const synth = window.speechSynthesis;
  const chunks = splitIntoSpeechChunks(text);
  if (chunks.length === 0) { opts.onDone(); return; }

  // start offset of each chunk inside the original (whitespace-normalised) text
  const normalised = text.replace(/\s+/g, " ").trim();
  const offsets: number[] = [];
  let searchFrom = 0;
  for (const c of chunks) {
    const idx = normalised.indexOf(c, searchFrom);
    offsets.push(idx >= 0 ? idx : searchFrom);
    searchFrom = (idx >= 0 ? idx : searchFrom) + c.length;
  }

  let started = false;
  let finished = false;

  const finish = (kind: "done" | "fail") => {
    if (finished) return;
    finished = true;
    opts.onUtterance?.(null);
    if (!opts.isCurrent()) return;
    if (kind === "fail") { opts.onFail(); return; }
    // let the speaker tail die out before the mic opens
    setTimeout(() => { if (opts.isCurrent()) opts.onDone(); }, ECHO_TAIL_MS);
  };

  const speakChunk = (i: number) => {
    if (finished || !opts.isCurrent()) return;
    if (i >= chunks.length) { finish("done"); return; }

    const chunk = chunks[i];
    const u = new SpeechSynthesisUtterance(chunk);
    opts.onUtterance?.(u);
    if (opts.voice) u.voice = opts.voice;
    if (opts.rate != null) u.rate = opts.rate;
    if (opts.pitch != null) u.pitch = opts.pitch;
    if (opts.volume != null) u.volume = opts.volume;

    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const settle = (next: () => void) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      next();
    };

    // A chunk that never starts/ends is skipped (after cancelling it) - the mic is
    // NEVER opened mid-speech. Before the first chunk starts we only wait a short
    // time (TTS dead); once a chunk is running we allow generously for its length.
    const words = chunk.split(/\s+/).length;
    const runLimit = words * 600 + 4000;
    const armWatchdog = (ms: number) => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        settle(() => {
          try { synth.cancel(); } catch { /* ignore */ }
          if (!started) { finish("fail"); return; } // TTS never started at all
          setTimeout(() => speakChunk(i + 1), 80);
        });
      }, ms);
    };
    armWatchdog(started ? runLimit : 6000);

    u.onstart = () => {
      if (!opts.isCurrent()) return;
      if (!started) { started = true; opts.onStart(); }
      if (!settled) armWatchdog(runLimit);
    };
    u.onboundary = (e: SpeechSynthesisEvent) => {
      if (!opts.isCurrent()) return;
      opts.onBoundary?.(offsets[i] + (e.charIndex ?? 0));
    };
    u.onend = () => settle(() => speakChunk(i + 1));
    u.onerror = (e: any) => {
      settle(() => {
        const reason = e?.error;
        if (reason === "interrupted" || reason === "canceled") {
          // cancelled on purpose (newer answer / exit) - stop quietly, don't open the mic
          finished = true;
          opts.onUtterance?.(null);
          return;
        }
        finish("fail");
      });
    };

    synth.speak(u);
    setTimeout(() => { if (synth.paused) synth.resume(); }, 60);
  };

  speakChunk(0);
}
