// APAS gamification sound engine.
// Pure Web Audio synthesis: no audio files, no network, no licensing. Everything is generated live.
//
// Backward compatible: every function the games already import (playCorrectSound, playWrongSound,
// playNextSound, playCountdownBeep, playGoSound, playVictorySound, playLevelUpSound, playClickSound)
// still exists with the same signature. New sounds are additions.
//
// Features: master volume + mute (remembered), optional gentle background music (off by default),
// a limiter so stacked sounds never clip, and respect for prefers-reduced-motion for music.

type Wave = OscillatorType;

const LS_SFX = "apas.sound.sfx";
const LS_MUSIC = "apas.sound.music";
const LS_VOL = "apas.sound.volume";

// The engine only works while the Gamification page is mounted (see activateGamificationAudio).
// Outside it nothing plays, no timers run, and no AudioContext exists.
let active = false;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;

const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

let sfxOn = read(LS_SFX, "1") === "1";
let musicOn = read(LS_MUSIC, "0") === "1";
let volume = Math.min(1, Math.max(0, parseFloat(read(LS_VOL, "0.8")) || 0.8));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function getCtx(): AudioContext | null {
  if (!active || typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // limiter keeps layered sounds from clipping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = volume;
    sfxBus = ctx.createGain(); sfxBus.gain.value = 1;
    musicBus = ctx.createGain(); musicBus.gain.value = 0.35;
    sfxBus.connect(master); musicBus.connect(master); master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/* ── low-level building blocks ─────────────────────────────────────────────────────────────────── */

interface ToneOpts {
  freq: number; start?: number; dur?: number; type?: Wave; vol?: number;
  slideTo?: number; attack?: number; detune?: number; bus?: GainNode | null; lp?: number;
}

/** One enveloped oscillator note. */
function tone(o: ToneOpts) {
  const c = getCtx(); if (!c) return;
  const t0 = c.currentTime + (o.start ?? 0);
  const dur = o.dur ?? 0.25;
  const vol = o.vol ?? 0.2;
  const atk = o.attack ?? 0.008;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
  if (o.detune) osc.detune.value = o.detune;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  if (o.lp) {
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.lp;
    osc.connect(f).connect(g);
  } else osc.connect(g);
  g.connect(o.bus ?? sfxBus ?? c.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

/** Short burst of filtered noise (whooshes, sparkles, swooshes). */
function noise(o: { bus?: GainNode | null; start?: number; dur?: number; vol?: number; from?: number; to?: number; q?: number; kind?: BiquadFilterType }) {
  const c = getCtx(); if (!c) return;
  const t0 = c.currentTime + (o.start ?? 0);
  const dur = o.dur ?? 0.3;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = o.kind ?? "bandpass"; f.Q.value = o.q ?? 1.2;
  f.frequency.setValueAtTime(o.from ?? 600, t0);
  f.frequency.exponentialRampToValueAtTime(o.to ?? 3000, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.vol ?? 0.15, t0 + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(o.bus ?? sfxBus ?? c.destination);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

/** Run a sound only when effects are on. Never throws: audio must never break a game. */
function sfx(fn: () => void) {
  if (!active || !sfxOn) return;
  try { fn(); } catch { /* audio unavailable */ }
}

// C major pentatonic across octaves: any random order still sounds happy.
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/* ── interface sounds ──────────────────────────────────────────────────────────────────────────── */

/** Soft pop for buttons and taps. */
export function playClickSound() {
  sfx(() => {
    tone({ freq: 700, slideTo: 1100, dur: 0.07, type: "sine", vol: 0.14 });
    tone({ freq: 1500, start: 0.01, dur: 0.05, type: "triangle", vol: 0.05 });
  });
}

/** Tab switch: a quick two-note "bloop" whose pitch rises with the tab position (0-3). */
export function playTabSound(index = 0) {
  sfx(() => {
    const n = PENTA[Math.min(index, 3)] * 0.5;
    tone({ freq: n, dur: 0.09, type: "triangle", vol: 0.14 });
    tone({ freq: n * 1.5, start: 0.06, dur: 0.12, type: "sine", vol: 0.12 });
  });
}

/** Choosing an option (game, subject, mode): bright upward blip. */
export function playSelectSound() {
  sfx(() => {
    tone({ freq: 660, slideTo: 990, dur: 0.1, type: "square", vol: 0.06 });
    tone({ freq: 1320, start: 0.05, dur: 0.12, type: "sine", vol: 0.12 });
  });
}

/** Un-choosing: the select blip played backwards and softer. */
export function playDeselectSound() {
  sfx(() => {
    tone({ freq: 990, slideTo: 600, dur: 0.1, type: "sine", vol: 0.1 });
  });
}

/** Big friendly "start" press: rising whoosh plus a bell. */
export function playStartSound() {
  sfx(() => {
    noise({ dur: 0.35, from: 300, to: 4000, vol: 0.12 });
    [523.25, 659.25, 783.99].forEach((f, i) => tone({ freq: f, start: 0.12 + i * 0.07, dur: 0.3, type: "triangle", vol: 0.14 }));
  });
}

/** Cute "boing" when the mascot appears or speaks. */
export function playMascotSound() {
  sfx(() => {
    tone({ freq: 280, slideTo: 620, dur: 0.16, type: "sine", vol: 0.2 });
    tone({ freq: 620, start: 0.16, slideTo: 420, dur: 0.14, type: "sine", vol: 0.14 });
    tone({ freq: 1240, start: 0.2, dur: 0.12, type: "triangle", vol: 0.06 });
  });
}

/* ── in-game feedback ──────────────────────────────────────────────────────────────────────────── */

let runStreak = 0;
/** Reset the answer streak (call when a new game or round starts). */
export function resetAnswerStreak() { runStreak = 0; }

/**
 * Correct answer. Pass the current streak (1, 2, 3...) and the pitch climbs a step each time,
 * so a run of right answers feels like a rising melody. Streak 5+ adds a sparkle.
 */
export function playCorrectSound(streakArg?: number) {
  // Games call this with no argument, so the engine tracks the run of right answers itself.
  runStreak = streakArg ?? runStreak + 1;
  const streak = runStreak;
  sfx(() => {
    if (streak > 0 && streak % 5 === 0) playComboSound();
    const step = Math.min(Math.max(streak, 1) - 1, 7);
    const base = PENTA[step];
    tone({ freq: base, slideTo: base * 1.5, dur: 0.14, type: "sine", vol: 0.26 });
    tone({ freq: base * 2, start: 0.05, dur: 0.3, type: "sine", vol: 0.12 });
    tone({ freq: base * 1.5, start: 0.08, dur: 0.22, type: "triangle", vol: 0.08 });
    if (streak >= 5) noise({ start: 0.05, dur: 0.25, from: 5000, to: 9000, vol: 0.05, kind: "highpass" });
  });
}

/** Wrong answer: gentle, not scary. Two falling "bwomp" notes. */
export function playWrongSound() {
  runStreak = 0;
  sfx(() => {
    tone({ freq: 330, slideTo: 250, dur: 0.16, type: "triangle", vol: 0.22 });
    tone({ freq: 247, start: 0.14, slideTo: 175, dur: 0.26, type: "triangle", vol: 0.2 });
    tone({ freq: 165, start: 0.14, dur: 0.24, type: "sine", vol: 0.1 });
  });
}

/** Moving on to the next question. */
export function playNextSound() {
  sfx(() => {
    noise({ dur: 0.16, from: 500, to: 2500, vol: 0.07, q: 0.8 });
    tone({ freq: 440, slideTo: 760, dur: 0.14, type: "sine", vol: 0.1 });
  });
}

/** Combo / streak milestone: three quick rising sparkles. */
export function playComboSound() {
  sfx(() => {
    [0, 1, 2, 3].forEach((i) => tone({ freq: PENTA[3 + i], start: i * 0.055, dur: 0.14, type: "triangle", vol: 0.13 }));
    noise({ start: 0.1, dur: 0.3, from: 4000, to: 9000, vol: 0.05, kind: "highpass" });
  });
}

/** Match found / pair snapped together. */
export function playMatchSound() {
  sfx(() => {
    tone({ freq: 784, dur: 0.1, type: "triangle", vol: 0.16 });
    tone({ freq: 1175, start: 0.07, dur: 0.22, type: "sine", vol: 0.16 });
  });
}

/** Card flip / tile reveal. */
export function playFlipSound() {
  sfx(() => {
    noise({ dur: 0.08, from: 1800, to: 5000, vol: 0.09, q: 2 });
    tone({ freq: 900, slideTo: 1400, dur: 0.05, type: "sine", vol: 0.06 });
  });
}

/** Time is almost up: soft tick. Call once per second in the last 5 seconds. */
export function playTickSound(urgent = false) {
  sfx(() => {
    tone({ freq: urgent ? 1000 : 800, dur: 0.05, type: "square", vol: urgent ? 0.09 : 0.06 });
  });
}

/** Round timer ran out. */
export function playTimeUpSound() {
  sfx(() => {
    [440, 370, 311].forEach((f, i) => tone({ freq: f, start: i * 0.14, dur: 0.22, type: "triangle", vol: 0.18 }));
  });
}

/* ── countdown ─────────────────────────────────────────────────────────────────────────────────── */

/** 3-2-1 beep. Pass the number being shown so it rises: 3 low, 2 mid, 1 high. */
export function playCountdownBeep(n?: number) {
  sfx(() => {
    const f = n === 3 ? 523.25 : n === 2 ? 587.33 : n === 1 ? 659.25 : 660;
    tone({ freq: f, dur: 0.16, type: "triangle", vol: 0.22 });
    tone({ freq: f * 2, dur: 0.08, type: "sine", vol: 0.06 });
  });
}

/** "GO!": big major chord with a whoosh. */
export function playGoSound() {
  sfx(() => {
    noise({ dur: 0.3, from: 400, to: 5000, vol: 0.1 });
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ freq: f, start: i * 0.04, dur: 0.5, type: "triangle", vol: 0.17 }));
    tone({ freq: 130.8, dur: 0.35, type: "sine", vol: 0.2 });
  });
}

/* ── rewards ───────────────────────────────────────────────────────────────────────────────────── */

/** Game finished: short fanfare in C major. */
export function playVictorySound() {
  sfx(() => {
    const seq: [number, number][] = [[523.25, 0], [659.25, 0.14], [783.99, 0.28], [1046.5, 0.42]];
    seq.forEach(([f, t]) => {
      tone({ freq: f, start: t, dur: 0.35, type: "triangle", vol: 0.2 });
      tone({ freq: f * 2, start: t, dur: 0.25, type: "sine", vol: 0.06 });
    });
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone({ freq: f, start: 0.62, dur: 0.9, type: "triangle", vol: 0.13 }));
    noise({ start: 0.62, dur: 0.6, from: 6000, to: 10000, vol: 0.05, kind: "highpass" });
  });
}

/** Whole session finished / big celebration: longer fanfare with a drum roll. */
export function playCelebrationSound() {
  sfx(() => {
    for (let i = 0; i < 10; i++) noise({ start: i * 0.045, dur: 0.05, from: 200, to: 400, vol: 0.08 + i * 0.008, kind: "lowpass", q: 0.5 });
    const melody = [523.25, 659.25, 783.99, 659.25, 783.99, 1046.5, 1318.51];
    melody.forEach((f, i) => tone({ freq: f, start: 0.5 + i * 0.11, dur: 0.28, type: "triangle", vol: 0.18 }));
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone({ freq: f, start: 1.3, dur: 1.2, type: "triangle", vol: 0.12 }));
    noise({ start: 1.3, dur: 1, from: 5000, to: 10000, vol: 0.06, kind: "highpass" });
  });
}

/** Level up: ascending arpeggio with a shimmer on top. */
export function playLevelUpSound() {
  sfx(() => {
    [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98].forEach((f, i) => {
      tone({ freq: f, start: i * 0.08, dur: 0.3, type: "triangle", vol: 0.17 });
      tone({ freq: f * 2, start: i * 0.08, dur: 0.2, type: "sine", vol: 0.05 });
    });
    [1046.5, 1318.51, 1567.98].forEach((f) => tone({ freq: f, start: 0.5, dur: 0.9, type: "sine", vol: 0.1 }));
    noise({ start: 0.45, dur: 0.7, from: 6000, to: 11000, vol: 0.05, kind: "highpass" });
  });
}

/** Badge unlocked: magical glissando and a bell. */
export function playBadgeSound() {
  sfx(() => {
    for (let i = 0; i < 8; i++) tone({ freq: PENTA[Math.min(i, 9)] * 1.5, start: i * 0.045, dur: 0.18, type: "sine", vol: 0.09 });
    tone({ freq: 1567.98, start: 0.38, dur: 0.8, type: "sine", vol: 0.2 });
    tone({ freq: 2349.3, start: 0.38, dur: 0.6, type: "sine", vol: 0.08 });
    tone({ freq: 784, start: 0.38, dur: 0.8, type: "triangle", vol: 0.1 });
  });
}

/** Mission completed: cheerful "task done" two-chord. */
export function playMissionCompleteSound() {
  sfx(() => {
    [523.25, 659.25, 783.99].forEach((f) => tone({ freq: f, dur: 0.22, type: "triangle", vol: 0.13 }));
    [587.33, 740, 880, 1174.66].forEach((f) => tone({ freq: f, start: 0.2, dur: 0.5, type: "triangle", vol: 0.13 }));
  });
}

/** Claim reward: coins pouring. */
export function playClaimSound() {
  sfx(() => {
    for (let i = 0; i < 7; i++) {
      const f = 1568 + (i % 3) * 220;
      tone({ freq: f, slideTo: f * 1.02, start: i * 0.06, dur: 0.12, type: "square", vol: 0.05 });
      tone({ freq: f * 1.5, start: i * 0.06 + 0.01, dur: 0.14, type: "sine", vol: 0.09 });
    }
    tone({ freq: 2093, start: 0.45, dur: 0.6, type: "sine", vol: 0.14 });
  });
}

/** XP counter tick, use while a number counts up. Pass 0..1 progress for rising pitch. */
export function playXpTickSound(progress = 0) {
  sfx(() => {
    tone({ freq: 900 + progress * 900, dur: 0.035, type: "square", vol: 0.04 });
  });
}

/** Streak flame lights up: low whoomph + warm chime. */
export function playStreakSound() {
  sfx(() => {
    noise({ dur: 0.45, from: 200, to: 1400, vol: 0.12, kind: "lowpass", q: 0.7 });
    tone({ freq: 196, slideTo: 392, dur: 0.3, type: "sawtooth", vol: 0.07 });
    [659.25, 880, 1318.51].forEach((f, i) => tone({ freq: f, start: 0.2 + i * 0.07, dur: 0.35, type: "triangle", vol: 0.14 }));
  });
}

/** Streak freeze earned or used: icy glassy chimes. */
export function playFreezeSound() {
  sfx(() => {
    [2093, 2637, 3136, 2637].forEach((f, i) => tone({ freq: f, start: i * 0.09, dur: 0.5, type: "sine", vol: 0.08 }));
    noise({ dur: 0.5, from: 8000, to: 4000, vol: 0.04, kind: "highpass" });
  });
}

/** Error / unavailable: soft double knock. */
export function playErrorSound() {
  sfx(() => {
    tone({ freq: 220, dur: 0.1, type: "triangle", vol: 0.16 });
    tone({ freq: 196, start: 0.12, dur: 0.14, type: "triangle", vol: 0.16 });
  });
}

/* ── background music (optional, off by default) ───────────────────────────────────────────────── */
// Two tracks, chosen by the student's class band:
//   "adventure": light, bouncy C-major loop (Class 1-5 / 11-12 look)
//   "arena":     energetic electronic track with drums, bass, arpeggio and a lead hook (Class 6-10)

export type MusicStyle = "adventure" | "arena";
let musicStyle: MusicStyle = "adventure";

let musicTimer: number | null = null;
let musicStep = 0;
let nextNoteTime = 0;

/* adventure ------------------------------------------------------------------------------------- */
const MUSIC_BPM = 100;
// 16-step phrase over a C - Am - F - G loop, in MIDI note numbers. 0 = rest.
const BASS = [48, 0, 48, 0, 45, 0, 45, 0, 41, 0, 41, 0, 43, 0, 43, 0];
const LEAD = [72, 0, 76, 79, 76, 0, 72, 0, 77, 0, 76, 72, 74, 0, 71, 0];

function musicBeat() {
  const c = getCtx(); if (!active || !c || !musicOn || !musicBus) return;
  const i = musicStep % 16;
  const b = BASS[i], l = LEAD[i];
  const dur = 60 / MUSIC_BPM / 2;
  if (b) tone({ freq: midi(b), dur: dur * 1.8, type: "triangle", vol: 0.16, bus: musicBus });
  if (l) {
    tone({ freq: midi(l), dur: dur * 1.4, type: "sine", vol: 0.13, bus: musicBus });
    tone({ freq: midi(l + 12), dur: dur * 0.8, type: "sine", vol: 0.03, bus: musicBus });
  }
  if (i % 4 === 2) noise({ dur: 0.04, from: 6000, to: 8000, vol: 0.03, kind: "highpass", bus: musicBus });
  musicStep++;
}

/* arena: A minor, 124 BPM, 8 bars (Am - F - C - G, twice; the lead hook enters on the second pass) -- */
const ARENA_BPM = 124;
const ARENA_STEPS = 128; // 8 bars x 16 sixteenth notes
const ARENA_CHORDS = [
  { root: 33, tones: [57, 60, 64, 69] }, // Am
  { root: 29, tones: [53, 57, 60, 65] }, // F
  { root: 36, tones: [60, 64, 67, 72] }, // C
  { root: 31, tones: [55, 59, 62, 67] }, // G
];
const ARP_SHAPE = [0, 2, 1, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 1, 3, 1];
const BASS_HITS: Record<number, number> = { 0: 0, 3: 0, 6: 12, 8: 0, 11: 0, 14: 12 }; // step -> octave offset
// Lead hook per chord (second pass only): step -> MIDI note
const ARENA_LEAD: Record<number, number>[] = [
  { 0: 76, 3: 79, 6: 81, 10: 79, 12: 76 },
  { 0: 77, 3: 81, 6: 77, 10: 76, 12: 72 },
  { 0: 76, 4: 79, 8: 84, 12: 79 },
  { 0: 79, 3: 74, 6: 79, 10: 83, 12: 81 },
];

function arenaStep(n: number, at: number) {
  const bus = musicBus; if (!bus) return;
  const bar = Math.floor(n / 16) % 8;
  const st = n % 16;
  const chord = ARENA_CHORDS[bar % 4];
  const secondPass = bar >= 4;
  const sixteenth = 60 / ARENA_BPM / 4;

  // drums: four-on-the-floor kick, clap on 2 and 4, hats on the off-beats
  if (st % 4 === 0) {
    tone({ freq: 150, slideTo: 42, start: at, dur: 0.2, vol: 0.5, attack: 0.002, bus });
  }
  if (st === 4 || st === 12) {
    noise({ start: at, dur: 0.13, from: 2600, to: 1600, vol: 0.16, q: 0.9, bus });
    tone({ freq: 200, slideTo: 150, start: at, dur: 0.08, type: "triangle", vol: 0.07, bus });
  }
  if (st % 4 === 2) noise({ start: at, dur: 0.07, from: 7000, to: 9000, vol: 0.07, kind: "highpass", bus });
  else if (st % 2 === 1) noise({ start: at, dur: 0.035, from: 8000, to: 9500, vol: 0.025, kind: "highpass", bus });

  // bass: syncopated, low-passed saw
  if (st in BASS_HITS) {
    tone({ freq: midi(chord.root + BASS_HITS[st]), start: at, dur: sixteenth * 2.4, type: "sawtooth", vol: 0.13, lp: 520, attack: 0.004, bus });
  }

  // arpeggio: quiet square-wave pluck through the chord tones
  tone({ freq: midi(chord.tones[ARP_SHAPE[st]] + 12), start: at, dur: sixteenth * 1.4, type: "square", vol: st % 4 === 0 ? 0.045 : 0.03, lp: 2600, attack: 0.003, bus });

  // pad: one soft chord per bar
  if (st === 0) {
    chord.tones.slice(0, 3).forEach((m) => tone({ freq: midi(m), start: at, dur: sixteenth * 15, type: "triangle", vol: 0.04, attack: 0.2, lp: 1800, bus }));
  }

  // lead hook on the second pass
  if (secondPass) {
    const m = ARENA_LEAD[bar % 4][st];
    if (m) {
      tone({ freq: midi(m), start: at, dur: sixteenth * 2.6, type: "sawtooth", vol: 0.055, lp: 3200, attack: 0.01, bus });
      tone({ freq: midi(m + 12), start: at, dur: sixteenth * 1.6, type: "sine", vol: 0.025, bus });
    }
  }
}

/** Look-ahead scheduler: keeps drums tight even if the browser is busy. */
function arenaTick() {
  const c = ctx; if (!active || !c || !musicOn || !musicBus) return;
  const stepLen = 60 / ARENA_BPM / 4;
  if (nextNoteTime < c.currentTime) nextNoteTime = c.currentTime + 0.05;
  while (nextNoteTime < c.currentTime + 0.18) {
    arenaStep(musicStep % ARENA_STEPS, nextNoteTime - c.currentTime);
    musicStep++;
    nextNoteTime += stepLen;
  }
}

function startMusicLoop() {
  if (!active || musicTimer != null || typeof window === "undefined") return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  getCtx();
  musicStep = 0; nextNoteTime = 0;
  musicTimer = musicStyle === "arena"
    ? window.setInterval(arenaTick, 40)
    : window.setInterval(musicBeat, (60 / MUSIC_BPM / 2) * 1000);
}
function stopMusicLoop() {
  if (musicTimer != null) { window.clearInterval(musicTimer); musicTimer = null; }
}

/** Pick the track. Switches live if music is already playing. Safe to call any time. */
export function setMusicStyle(style: MusicStyle) {
  if (style === musicStyle) return;
  musicStyle = style;
  if (musicTimer != null) { stopMusicLoop(); if (musicOn) startMusicLoop(); }
}

/* ── settings API (used by the SoundToggle) ────────────────────────────────────────────────────── */

export interface SoundSettings { sfx: boolean; music: boolean; volume: number }

let snapshot: SoundSettings = { sfx: sfxOn, music: musicOn, volume };
const refresh = () => { snapshot = { sfx: sfxOn, music: musicOn, volume }; notify(); };

export const getSoundSettings = () => snapshot;
export function subscribeSound(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function setSfxEnabled(on: boolean) {
  sfxOn = on; write(LS_SFX, on ? "1" : "0"); refresh();
  if (on) playClickSound();
}
export function setMusicEnabled(on: boolean) {
  musicOn = on; write(LS_MUSIC, on ? "1" : "0"); refresh();
  if (on) startMusicLoop(); else stopMusicLoop();
}
export function setSoundVolume(v: number) {
  volume = Math.min(1, Math.max(0, v)); write(LS_VOL, String(volume)); refresh();
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
}
/** Call after the first user gesture. Starts music if the student turned it on earlier. */
export function resumeAudio() {
  if (!active) return;
  getCtx();
  if (musicOn) startMusicLoop();
}
/** Duck the music during fanfares, restore after. */
export function duckMusic(ms = 2200) {
  const c = ctx; if (!c || !musicBus) return;
  const now = c.currentTime;
  musicBus.gain.cancelScheduledValues(now);
  musicBus.gain.setTargetAtTime(0.08, now, 0.05);
  musicBus.gain.setTargetAtTime(0.35, now + ms / 1000, 0.4);
}
/** Pause everything when the tab is hidden so it never plays in the background. */
function onVisibility() {
  if (!active) return;
  if (document.hidden) { stopMusicLoop(); void ctx?.suspend(); }
  else { void ctx?.resume(); if (musicOn) startMusicLoop(); }
}

/**
 * Call when the Gamification page mounts. Sounds are ignored until this is called.
 */
export function activateGamificationAudio() {
  if (active) return;
  active = true;
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
}

/**
 * Call when the Gamification page unmounts. Stops music, cancels pending sounds, removes listeners and
 * closes the audio context, so nothing can play anywhere else in the app.
 */
export function deactivateGamificationAudio() {
  if (!active) return;
  active = false;
  stopMusicLoop();
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  const c = ctx;
  ctx = null; master = null; sfxBus = null; musicBus = null;
  if (c && c.state !== "closed") void c.close().catch(() => { /* already closed */ });
}
