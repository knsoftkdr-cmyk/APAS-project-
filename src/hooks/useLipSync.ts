import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 2D lip-sync engine.
 *
 * There is no cross-browser way to pull raw PCM out of `speechSynthesis`
 * (the Web Speech API never exposes the audio it plays through an
 * AnalyserNode-able graph), and Capacitor's native TextToSpeech plugin
 * gives us nothing but a "done speaking" promise. So true frequency-based
 * lip-sync against those two engines isn't possible - only a real audio
 * file (e.g. from a TTS endpoint that returns mp3/wav) can be analysed
 * for real with the Web Audio API.
 *
 * This hook therefore does both, and prefers real audio whenever it's
 * available:
 *
 *  1. TIMING-BASED (default, used for speechSynthesis + native TTS): we
 *     turn the spoken text into a scheduled sequence of viseme frames
 *     (word-by-word, syllable-by-syllable) sized to an estimated speech
 *     duration, then play that schedule back on a requestAnimationFrame
 *     clock. When the browser fires SpeechSynthesisUtterance's
 *     `boundary` event (per-word), we nudge the clock so drift between
 *     the estimate and the real voice doesn't build up - the mouth stays
 *     locked to the actual speech instead of just guessing once and
 *     hoping.
 *
 *  2. AUDIO-BASED (opt-in via `attachAnalyser`): if you ever swap in a
 *     TTS provider that returns an actual audio buffer/element, call
 *     `attachAnalyser(audioEl)` and real-time amplitude (RMS) from a Web
 *     Audio AnalyserNode drives mouth intensity directly, layered on top
 *     of the same viseme shapes.
 */

export type Viseme = "REST" | "AA" | "EE" | "IH" | "OH" | "OU" | "MBP";

interface VisemeFrame {
  viseme: Viseme;
  start: number; // ms, relative to speech start
  end: number; // ms
  peakIntensity: number; // 0..1, target "openness" for this frame
}

const VOWEL_TO_VISEME: Record<string, Viseme> = {
  a: "AA",
  e: "EE",
  i: "IH",
  y: "IH",
  o: "OH",
  u: "OU",
};

// Words per minute used to estimate speech length when we have no other
// signal. ~155 wpm is a natural, unhurried speaking pace.
const WORDS_PER_MINUTE = 155;

/** Estimate how long a browser/native TTS engine will take to say `text`. */
export function estimateSpeechDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const base = (words.length / WORDS_PER_MINUTE) * 60000;
  // Small floor so very short utterances ("Yes.", "Okay!") still get a
  // believable amount of mouth movement instead of a single frame.
  return Math.max(600, Math.round(base));
}

function vowelGroupToViseme(group: string): Viseme {
  if (group.includes("oo") || group === "u" || group.includes("ou")) return "OU";
  if (group.includes("o")) return "OH";
  if (group.includes("ee") || group.includes("ea")) return "EE";
  const last = group[group.length - 1];
  return VOWEL_TO_VISEME[last] ?? "IH";
}

/**
 * Break one word into a short run of viseme sub-frames covering
 * `[0, durationMs]`, relative to the word's own start.
 */
function wordToVisemeFrames(word: string, durationMs: number): Array<{ viseme: Viseme; weight: number }> {
  const clean = word.toLowerCase().replace(/[^a-z']/g, "");
  if (!clean) return [{ viseme: "REST", weight: 1 }];

  const vowelGroups = clean.match(/[aeiouy]+/g) ?? [];
  const startsBilabial = /^[bmp]/.test(clean);
  const endsBilabial = /[bmp]$/.test(clean);

  const frames: Array<{ viseme: Viseme; weight: number }> = [];
  if (startsBilabial) frames.push({ viseme: "MBP", weight: 0.6 });

  if (vowelGroups.length === 0) {
    // All-consonant "word" (numbers, abbreviations, stray tokens) - a
    // brief neutral shape reads better than forcing a vowel mouth.
    frames.push({ viseme: "IH", weight: 1 });
  } else {
    for (const g of vowelGroups) {
      frames.push({ viseme: vowelGroupToViseme(g), weight: 1 });
    }
  }

  if (endsBilabial) frames.push({ viseme: "MBP", weight: 0.5 });

  return frames;
}

/** Turn full utterance text into a timed sequence of viseme frames. */
function buildVisemeSchedule(text: string, totalDurationMs: number): VisemeFrame[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || totalDurationMs <= 0) return [];

  const words = tokens.map((t) => t.replace(/[^a-zA-Z']/g, ""));
  const weights = tokens.map((t) => Math.max(t.length, 2));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const frames: VisemeFrame[] = [];
  let cursor = 0;

  tokens.forEach((token, i) => {
    const wordSlice = (weights[i] / totalWeight) * totalDurationMs;
    const subFrames = wordToVisemeFrames(words[i], wordSlice);
    const subTotalWeight = subFrames.reduce((a, f) => a + f.weight, 0);

    let subCursor = cursor;
    for (const sf of subFrames) {
      const dur = (sf.weight / subTotalWeight) * wordSlice;
      const isMbp = sf.viseme === "MBP";
      const isRest = sf.viseme === "REST";
      frames.push({
        viseme: sf.viseme,
        start: subCursor,
        end: subCursor + dur,
        peakIntensity: isMbp ? 0.25 : isRest ? 0.05 : 0.65 + Math.random() * 0.3,
      });
      subCursor += dur;
    }
    cursor += wordSlice;

    // Pause for punctuation - sentence-enders get a longer beat than commas.
    const trailingPunct = /[.!?]$/.test(token) ? 260 : /[,;:]$/.test(token) ? 130 : 40;
    frames.push({
      viseme: "REST",
      start: cursor,
      end: cursor + trailingPunct,
      peakIntensity: 0.05,
    });
    cursor += trailingPunct;
  });

  // Rescale so the schedule fits exactly into totalDurationMs even after
  // adding pause time, then close on REST.
  const builtDuration = cursor || 1;
  const scale = totalDurationMs / builtDuration;
  for (const f of frames) {
    f.start *= scale;
    f.end *= scale;
  }
  frames.push({ viseme: "REST", start: totalDurationMs, end: totalDurationMs + 200, peakIntensity: 0 });

  return frames;
}

export interface UseLipSyncResult {
  /** Current mouth shape to render. */
  viseme: Viseme;
  /** 0..1 smoothed "openness" for the current shape - drives scale/opacity. */
  intensity: number;
  /** True while a scheduled or audio-driven speech animation is playing. */
  isAnimating: boolean;
  /** Start animating the mouth for `text`, over `estimatedDurationMs`. */
  start: (text: string, estimatedDurationMs?: number) => void;
  /** Nudge the internal clock to match a real per-word boundary event. */
  reanchor: (charIndex: number, textLength: number) => void;
  /** Stop animating and return the mouth to REST. */
  stop: () => void;
  /**
   * Optional: point a real <audio> element playing TTS output at the
   * engine so intensity is driven by actual amplitude via Web Audio's
   * AnalyserNode instead of the timing estimate. Viseme *shape* still
   * comes from the text schedule; only openness is audio-driven.
   */
  attachAnalyser: (audioEl: HTMLAudioElement) => void;
  detachAnalyser: () => void;
}

export function useLipSync(): UseLipSyncResult {
  const [viseme, setViseme] = useState<Viseme>("REST");
  const [intensity, setIntensity] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const scheduleRef = useRef<VisemeFrame[]>([]);
  const startTimeRef = useRef(0);
  const totalDurationRef = useRef(0);
  const textLengthRef = useRef(0);
  const playingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const currentIntensityRef = useRef(0);
  const targetIntensityRef = useRef(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserDataRef = useRef<Uint8Array | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  const stopLoop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const tick = useCallback(() => {
    if (!playingRef.current) return;
    const now = performance.now();
    const elapsed = now - startTimeRef.current;

    if (elapsed >= totalDurationRef.current + 200) {
      playingRef.current = false;
      setIsAnimating(false);
      setViseme("REST");
      targetIntensityRef.current = 0;
      currentIntensityRef.current = 0;
      setIntensity(0);
      stopLoop();
      return;
    }

    const frame = scheduleRef.current.find((f) => elapsed >= f.start && elapsed < f.end);
    if (frame) {
      setViseme((prev) => (prev === frame.viseme ? prev : frame.viseme));
      targetIntensityRef.current = frame.peakIntensity;
    }

    // Real audio takes priority over the timing estimate for *intensity*
    // (openness), while the frame above still supplies the mouth *shape*.
    const analyser = analyserRef.current;
    const data = analyserDataRef.current;
    if (analyser && data) {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      targetIntensityRef.current = Math.min(1, rms * 3.2);
    }

    // Smooth toward the target so shape changes crossfade instead of
    // flickering between discrete states.
    currentIntensityRef.current += (targetIntensityRef.current - currentIntensityRef.current) * 0.22;
    setIntensity(currentIntensityRef.current);

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback((text: string, estimatedDurationMs?: number) => {
    const duration = estimatedDurationMs ?? estimateSpeechDurationMs(text);
    scheduleRef.current = buildVisemeSchedule(text, duration);
    totalDurationRef.current = duration;
    textLengthRef.current = text.length || 1;
    startTimeRef.current = performance.now();
    playingRef.current = true;
    setIsAnimating(true);
    stopLoop();
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const reanchor = useCallback((charIndex: number, textLength: number) => {
    if (!playingRef.current || textLength <= 0) return;
    const expectedElapsed = (charIndex / textLength) * totalDurationRef.current;
    const actualElapsed = performance.now() - startTimeRef.current;
    const drift = actualElapsed - expectedElapsed;
    // Correct half the drift each time rather than snapping fully, so the
    // mouth doesn't visibly jump if one word's estimate was off.
    startTimeRef.current += drift * 0.5;
  }, []);

  const stop = useCallback(() => {
    playingRef.current = false;
    stopLoop();
    setIsAnimating(false);
    setViseme("REST");
    targetIntensityRef.current = 0;
    currentIntensityRef.current = 0;
    setIntensity(0);
  }, []);

  const attachAnalyser = useCallback((audioEl: HTMLAudioElement) => {
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = audioCtxRef.current ?? new AudioContextCtor();
      audioCtxRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyserDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      const source = ctx.createMediaElementSource(audioEl);
      source.connect(analyser);
      analyser.connect(ctx.destination);

      sourceNodeRef.current = source;
      analyserRef.current = analyser;
    } catch (err) {
      // If the element is already connected elsewhere, or the browser
      // blocks it, just fall back silently to timing-based animation.
      console.warn("[lip-sync] attachAnalyser failed, falling back to timing-based mode:", err);
    }
  }, []);

  const detachAnalyser = useCallback(() => {
    analyserRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    analyserRef.current = null;
    sourceNodeRef.current = null;
    analyserDataRef.current = null;
  }, []);

  useEffect(() => stopLoop, []);

  return { viseme, intensity, isAnimating, start, reanchor, stop, attachAnalyser, detachAnalyser };
}