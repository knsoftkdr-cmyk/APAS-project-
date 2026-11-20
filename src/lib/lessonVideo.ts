// src/lib/lessonVideo.ts
//
// Content Studio lesson video, built entirely in the teacher's browser (free; no video server):
//   - the edge function narrates every scene with Google TTS (scene 0 = title, scene i = slide i);
//   - here each scene is drawn on a canvas in the chosen template's colours, with bullets appearing
//     one by one and subtitles from the narration;
//   - WebCodecs (VideoEncoder / AudioEncoder) encode H.264 + AAC and mp4-muxer writes the MP4.
// A slide with a `scene` is drawn as an animated explainer instead (pictures that move in step with
// the narration - see src/lib/explainerScene.ts).
// Works in Chrome / Edge and recent Safari. Check videoSupported() first.

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { ExplainerPainter, type ExplainerScene } from "./explainerScene";

export interface VideoTheme {
  cover: string;
  bg: string;
  accent: string;
  text: string;
}

export interface LessonVideoInput {
  title: string;
  subtitle: string;
  slides: { title: string; bullets: string[]; narration?: string; speaker_notes?: string; scene?: ExplainerScene | null }[];
  /** One MP3 per scene: [title, slide 1, slide 2, ...]. */
  sceneAudioUrls: string[];
  theme: VideoTheme;
  rtl: boolean;
  onProgress?: (fraction: number, stage: string) => void;
}

const W = 1280;
const H = 720;
const FPS = 24;
const SAMPLE_RATE = 48000;
const FONT = `"Inter", "Segoe UI", "Noto Sans Arabic", "Noto Sans Telugu", "Noto Sans Devanagari", Arial, sans-serif`;
const AUDIO_LEAD = 0.4; // seconds of silence before each scene's narration
const AUDIO_TAIL = 0.8; // seconds after it ends
const FADE = 0.35;

export function videoSupported(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window && "AudioEncoder" in window && "VideoFrame" in window && "AudioData" in window;
}

interface Scene {
  kind: "title" | "slide" | "end";
  start: number;
  duration: number;
  audioDuration: number;
  slideIndex: number;
  /** Subtitle pieces with their start/end time inside the scene. */
  captions: { text: string; from: number; to: number }[];
  /** Start of each narration sentence inside the scene, plus the end of the narration (explainer timing). */
  sentences: number[];
}

// ---------- audio ----------

async function loadSceneAudio(urls: string[], onProgress: (f: number) => void): Promise<Float32Array[]> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const out: Float32Array[] = [];
    for (let i = 0; i < urls.length; i++) {
      const res = await fetch(urls[i]);
      if (!res.ok) throw new Error(`Could not load the narration (${res.status}). Try again.`);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      // Mix down to mono.
      const mono = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const data = buf.getChannelData(c);
        for (let s = 0; s < data.length; s++) mono[s] += data[s] / buf.numberOfChannels;
      }
      out.push(mono);
      onProgress((i + 1) / urls.length);
    }
    return out;
  } finally {
    void ctx.close();
  }
}

// ---------- timeline ----------

/** Split narration into subtitle-sized pieces (sentences, long ones cut at word boundaries). */
function captionPieces(text: string, maxChars = 110): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?؟।]+[.!?؟।]*/g) ?? [];
  const out: string[] = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length <= maxChars) {
      out.push(s);
      continue;
    }
    let line = "";
    for (const w of s.split(" ")) {
      if ((line + " " + w).trim().length > maxChars && line) {
        out.push(line.trim());
        line = w;
      } else line += " " + w;
    }
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

function timedCaptions(text: string, audioDuration: number): Scene["captions"] {
  const pieces = captionPieces(text);
  const total = pieces.reduce((n, p) => n + p.length, 0) || 1;
  let t = AUDIO_LEAD;
  return pieces.map((p) => {
    const len = (p.length / total) * audioDuration;
    const c = { text: p, from: t, to: t + len };
    t += len;
    return c;
  });
}

/** Start time of every sentence (by its share of the characters), plus the end time. */
function sentenceTimes(text: string, audioDuration: number): number[] {
  const sentences = (text.replace(/\s+/g, " ").trim().match(/[^.!?؟।]+[.!?؟।]*/g) ?? []).map((x) => x.trim()).filter(Boolean);
  const total = sentences.reduce((n, p) => n + p.length, 0) || 1;
  const out = [AUDIO_LEAD];
  for (const p of sentences) out.push(out[out.length - 1] + (p.length / total) * audioDuration);
  return out;
}

function buildTimeline(input: LessonVideoInput, audio: Float32Array[]): Scene[] {
  const scenes: Scene[] = [];
  let t = 0;
  const push = (kind: Scene["kind"], slideIndex: number, audioDuration: number, narration: string) => {
    const duration = Math.max(3.5, AUDIO_LEAD + audioDuration + AUDIO_TAIL);
    scenes.push({
      kind, start: t, duration, audioDuration, slideIndex,
      captions: narration ? timedCaptions(narration, audioDuration) : [],
      sentences: sentenceTimes(narration, audioDuration),
    });
    t += duration;
  };
  push("title", -1, audio[0].length / SAMPLE_RATE, "");
  input.slides.forEach((s, i) => {
    const text = s.narration?.trim() || [s.speaker_notes, ...s.bullets].filter(Boolean).join(". ");
    push("slide", i, (audio[i + 1]?.length ?? 0) / SAMPLE_RATE, text);
  });
  push("end", -1, 0, "");
  return scenes;
}

// ---------- drawing ----------

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

class Painter {
  private explainers = new Map<number, ExplainerPainter>();

  constructor(private ctx: CanvasRenderingContext2D, private input: LessonVideoInput) {
    ctx.direction = input.rtl ? "rtl" : "ltr";
    ctx.textBaseline = "middle";
  }

  /** Mirror an x position for right-to-left languages. */
  private x(v: number) {
    return this.input.rtl ? W - v : v;
  }

  private get startAlign(): CanvasTextAlign {
    return this.input.rtl ? "right" : "left";
  }

  draw(scene: Scene, local: number, totalProgress: number) {
    if (scene.kind === "title") this.title(local);
    else if (scene.kind === "end") this.end(local);
    else this.slide(scene, local);

    if (scene.kind === "slide") this.progressBar(totalProgress);

    // Fade in / out at scene edges.
    const edge = Math.min(local, scene.duration - local);
    if (edge < FADE) {
      this.ctx.fillStyle = `rgba(0,0,0,${(1 - edge / FADE) * 0.85})`;
      this.ctx.fillRect(0, 0, W, H);
    }
  }

  private coverBackground(local: number) {
    const { ctx } = this;
    const { cover, accent } = this.input.theme;
    ctx.fillStyle = cover;
    ctx.fillRect(0, 0, W, H);
    const drift = Math.sin(local * 0.6) * 12;
    ctx.fillStyle = hexToRgba(accent, 0.35);
    ctx.beginPath();
    ctx.arc(this.x(W - 120 + drift), 90, 230, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexToRgba(accent, 0.2);
    ctx.beginPath();
    ctx.arc(this.x(140 - drift), H - 40, 160, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.arc(this.x(W - 330), H - 150, 70, 0, Math.PI * 2);
    ctx.fill();
  }

  private title(local: number) {
    const { ctx, input } = this;
    this.coverBackground(local);
    const a = easeOut(local / 0.9);
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.font = `800 64px ${FONT}`;
    const lines = wrap(ctx, input.title, W - 260).slice(0, 3);
    const lh = 78;
    const y0 = H / 2 - ((lines.length - 1) * lh) / 2 - 30 + (1 - a) * 24;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh));
    const barW = 220 * easeOut((local - 0.3) / 0.8);
    ctx.fillStyle = input.theme.accent;
    ctx.fillRect(W / 2 - barW / 2, y0 + (lines.length - 1) * lh + 58, barW, 6);
    if (input.subtitle) {
      ctx.font = `500 30px ${FONT}`;
      ctx.fillStyle = `rgba(255,255,255,${0.85 * easeOut((local - 0.5) / 0.8)})`;
      ctx.fillText(input.subtitle, W / 2, y0 + (lines.length - 1) * lh + 112);
    }
  }

  private end(local: number) {
    const { ctx, input } = this;
    this.coverBackground(local);
    const a = easeOut(local / 0.8);
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.font = `800 72px ${FONT}`;
    ctx.fillText(input.rtl ? "شكراً لكم!" : "Thank you!", W / 2, H / 2 - 30);
    ctx.font = `500 30px ${FONT}`;
    ctx.fillStyle = `rgba(255,255,255,${0.8 * a})`;
    ctx.fillText(input.title, W / 2, H / 2 + 50);
  }

  private slide(scene: Scene, local: number) {
    const { ctx, input } = this;
    const { bg, accent, text } = input.theme;
    const slide = input.slides[scene.slideIndex];
    if (slide.scene) return this.explainer(scene, local);

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // Side accent bar + soft corner circle.
    ctx.fillStyle = accent;
    ctx.fillRect(input.rtl ? W - 16 : 0, 0, 16, H);
    ctx.fillStyle = hexToRgba(accent, 0.12);
    ctx.beginPath();
    ctx.arc(this.x(W - 40), 40, 150, 0, Math.PI * 2);
    ctx.fill();

    // Slide number pill.
    const num = `${scene.slideIndex + 1} / ${input.slides.length}`;
    ctx.font = `600 22px ${FONT}`;
    const pillW = ctx.measureText(num).width + 36;
    ctx.fillStyle = accent;
    roundRect(ctx, input.rtl ? 50 : W - 50 - pillW, 40, pillW, 40, 20);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.direction = "ltr"; // keep "1 / 5" in reading order in RTL videos too
    ctx.fillText(num, input.rtl ? 50 + pillW / 2 : W - 50 - pillW / 2, 61);
    ctx.direction = input.rtl ? "rtl" : "ltr";

    // Title (slides in from the start side).
    const ta = easeOut(local / 0.6);
    ctx.textAlign = this.startAlign;
    ctx.fillStyle = text;
    ctx.globalAlpha = ta;
    ctx.font = `800 46px ${FONT}`;
    const titleLines = wrap(ctx, slide.title, W - 300).slice(0, 2);
    const shift = (1 - ta) * 30 * (input.rtl ? 1 : -1);
    titleLines.forEach((l, i) => ctx.fillText(l, this.x(80) + shift, 120 + i * 54));
    ctx.globalAlpha = 1;
    const underlineY = 120 + (titleLines.length - 1) * 54 + 44;
    const ulW = 140 * easeOut((local - 0.2) / 0.6);
    ctx.fillStyle = accent;
    ctx.fillRect(input.rtl ? W - 80 - ulW : 80, underlineY, ulW, 6);

    // Bullets appear one by one across the first ~70% of the narration.
    const top = underlineY + 50;
    const bottom = scene.captions.length ? 560 : 650;
    const bullets = slide.bullets;
    let size = 32;
    let laid: string[][] = [];
    for (; size >= 22; size -= 2) {
      ctx.font = `500 ${size}px ${FONT}`;
      laid = bullets.map((b) => wrap(ctx, b, W - 260));
      const height = laid.reduce((h, ls) => h + ls.length * size * 1.3 + size * 0.7, 0);
      if (height <= bottom - top) break;
    }
    const revealWindow = Math.max(1, scene.audioDuration * 0.7);
    let y = top;
    laid.forEach((lines, k) => {
      const appearAt = AUDIO_LEAD + (k / Math.max(1, bullets.length)) * revealWindow;
      const a = easeOut((local - appearAt) / 0.5);
      if (a <= 0) {
        y += lines.length * size * 1.3 + size * 0.7;
        return;
      }
      ctx.globalAlpha = a;
      const dx = (1 - a) * 24 * (input.rtl ? 1 : -1);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(this.x(100) + dx, y + size * 0.5, size * 0.22, 0, Math.PI * 2); // level with the first line
      ctx.fill();
      ctx.fillStyle = text;
      ctx.font = `500 ${size}px ${FONT}`;
      ctx.textAlign = this.startAlign;
      lines.forEach((l, i) => ctx.fillText(l, this.x(130) + dx, y + size * 0.5 + i * size * 1.3));
      ctx.globalAlpha = 1;
      y += lines.length * size * 1.3 + size * 0.7;
    });

    this.caption(scene, local);
  }

  /** Animated picture scene with a heading tag, slide counter and subtitles on top. */
  private explainer(scene: Scene, local: number) {
    const { ctx, input } = this;
    const slide = input.slides[scene.slideIndex];
    let painter = this.explainers.get(scene.slideIndex);
    if (!painter) {
      painter = new ExplainerPainter(ctx, slide.scene!, W, H, input.theme, input.rtl, scene.sentences);
      this.explainers.set(scene.slideIndex, painter);
    }
    ctx.save();
    painter.draw(local);
    ctx.restore();
    ctx.direction = input.rtl ? "rtl" : "ltr";
    ctx.textBaseline = "middle";

    // Heading tag (top, start side).
    const a = easeOut(local / 0.6);
    ctx.font = `800 30px ${FONT}`;
    const title = wrap(ctx, slide.title, W - 360)[0] ?? "";
    const tw = ctx.measureText(title).width + 48;
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.shadowColor = "rgba(15,23,42,0.15)";
    ctx.shadowBlur = 12;
    roundRect(ctx, input.rtl ? W - 40 - tw : 40, 34, tw, 56, 16);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = input.theme.accent;
    ctx.fillRect(input.rtl ? W - 40 - 6 : 40, 34 + 12, 6, 32);
    ctx.fillStyle = "#0F172A";
    ctx.textAlign = this.startAlign;
    ctx.fillText(title, this.x(40 + 26), 63);
    ctx.globalAlpha = 1;

    // Slide counter.
    const num = `${scene.slideIndex + 1} / ${input.slides.length}`;
    ctx.font = `600 22px ${FONT}`;
    const pillW = ctx.measureText(num).width + 36;
    ctx.fillStyle = input.theme.accent;
    roundRect(ctx, input.rtl ? 40 : W - 40 - pillW, 42, pillW, 40, 20);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.direction = "ltr";
    ctx.fillText(num, input.rtl ? 40 + pillW / 2 : W - 40 - pillW / 2, 63);
    ctx.direction = input.rtl ? "rtl" : "ltr";

    this.caption(scene, local);
  }

  private caption(scene: Scene, local: number) {
    const cap = scene.captions.find((c) => local >= c.from && local < c.to + 0.15);
    if (!cap) return;
    const { ctx } = this;
    ctx.font = `500 26px ${FONT}`;
    const lines = wrap(ctx, cap.text, W - 260).slice(0, 2);
    const boxH = lines.length * 36 + 26;
    const boxW = Math.min(W - 160, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 56);
    const bx = (W - boxW) / 2;
    const by = H - 40 - boxH;
    ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
    roundRect(ctx, bx, by, boxW, boxH, 14);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    lines.forEach((l, i) => ctx.fillText(l, W / 2, by + 13 + 18 + i * 36));
  }

  private progressBar(p: number) {
    const { ctx } = this;
    ctx.fillStyle = hexToRgba(this.input.theme.accent, 0.25);
    ctx.fillRect(0, H - 8, W, 8);
    ctx.fillStyle = this.input.theme.accent;
    const w = W * p;
    ctx.fillRect(this.input.rtl ? W - w : 0, H - 8, w, 8);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- encoding ----------

async function pickVideoConfig(): Promise<VideoEncoderConfig> {
  for (const codec of ["avc1.42001f", "avc1.4d001f", "avc1.640028", "avc1.42002a"]) {
    const config: VideoEncoderConfig = { codec, width: W, height: H, bitrate: 1_200_000, framerate: FPS };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch { /* try the next one */ }
  }
  throw new Error("This browser cannot create MP4 video. Please use the latest Chrome or Edge.");
}

async function pickAudioConfig(): Promise<{ config: AudioEncoderConfig; muxCodec: "aac" | "opus" }> {
  const aac: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate: SAMPLE_RATE, numberOfChannels: 1, bitrate: 96_000 };
  try {
    if ((await AudioEncoder.isConfigSupported(aac)).supported) return { config: aac, muxCodec: "aac" };
  } catch { /* fall back to Opus */ }
  const opus: AudioEncoderConfig = { codec: "opus", sampleRate: SAMPLE_RATE, numberOfChannels: 1, bitrate: 64_000 };
  if ((await AudioEncoder.isConfigSupported(opus)).supported) return { config: opus, muxCodec: "opus" };
  throw new Error("This browser cannot encode audio for the video. Please use the latest Chrome or Edge.");
}

const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function buildLessonVideo(input: LessonVideoInput): Promise<Blob> {
  if (!videoSupported()) throw new Error("This browser cannot create video. Please use the latest Chrome or Edge.");
  if (input.sceneAudioUrls.length !== input.slides.length + 1) throw new Error("Narration does not match the slides.");
  const progress = input.onProgress ?? (() => {});

  progress(0, "Loading narration");
  const audio = await loadSceneAudio(input.sceneAudioUrls, (f) => progress(f * 0.1, "Loading narration"));
  const scenes = buildTimeline(input, audio);
  const totalDuration = scenes[scenes.length - 1].start + scenes[scenes.length - 1].duration;

  // One mono track for the whole video, each scene's narration placed after a short lead-in.
  const pcm = new Float32Array(Math.ceil(totalDuration * SAMPLE_RATE));
  for (const s of scenes) {
    const clip = s.kind === "end" ? null : audio[s.kind === "title" ? 0 : s.slideIndex + 1];
    if (!clip) continue;
    const at = Math.floor((s.start + AUDIO_LEAD) * SAMPLE_RATE);
    pcm.set(clip.subarray(0, Math.max(0, pcm.length - at)), at);
  }

  const videoConfig = await pickVideoConfig();
  const { config: audioConfig, muxCodec } = await pickAudioConfig();
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H, frameRate: FPS },
    audio: { codec: muxCodec, numberOfChannels: 1, sampleRate: SAMPLE_RATE },
    fastStart: "in-memory",
  });

  let encodeError: unknown = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  videoEncoder.configure(videoConfig);
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  audioEncoder.configure(audioConfig);

  try {
    // Audio first (fast).
    const block = 4800;
    for (let i = 0; i < pcm.length; i += block) {
      const n = Math.min(block, pcm.length - i);
      const data = new AudioData({
        format: "f32-planar", sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 1,
        timestamp: Math.round((i / SAMPLE_RATE) * 1e6), data: pcm.slice(i, i + n),
      });
      audioEncoder.encode(data);
      data.close();
    }

    // Video frames.
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not draw the video.");
    const painter = new Painter(ctx, input);
    const totalFrames = Math.ceil(totalDuration * FPS);
    const slideScenes = scenes.filter((s) => s.kind === "slide");
    const slidesStart = slideScenes[0]?.start ?? 0;
    const slidesEnd = slideScenes.length ? slideScenes[slideScenes.length - 1].start + slideScenes[slideScenes.length - 1].duration : 1;
    let sceneIdx = 0;
    for (let f = 0; f < totalFrames; f++) {
      if (encodeError) throw encodeError;
      const t = f / FPS;
      while (sceneIdx < scenes.length - 1 && t >= scenes[sceneIdx].start + scenes[sceneIdx].duration) sceneIdx++;
      const scene = scenes[sceneIdx];
      const lessonProgress = Math.min(1, Math.max(0, (t - slidesStart) / (slidesEnd - slidesStart)));
      ctx.save();
      painter.draw(scene, t - scene.start, lessonProgress);
      ctx.restore();
      const frame = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      videoEncoder.encode(frame, { keyFrame: f % (FPS * 3) === 0 });
      frame.close();
      while (videoEncoder.encodeQueueSize > 6) await nextTick();
      if (f % 12 === 0) {
        progress(0.1 + 0.85 * (f / totalFrames), "Creating video");
        await nextTick();
      }
    }

    progress(0.96, "Finishing");
    await videoEncoder.flush();
    await audioEncoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    progress(1, "Done");
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    if (videoEncoder.state !== "closed") videoEncoder.close();
    if (audioEncoder.state !== "closed") audioEncoder.close();
  }
}
