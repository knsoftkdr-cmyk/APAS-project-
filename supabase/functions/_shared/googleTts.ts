// supabase/functions/_shared/googleTts.ts
//
// Google Cloud Text-to-Speech (REST, API key) for Content Studio narration.
// Secret: GOOGLE_TTS_API_KEY. Only WaveNet / Standard voices are used, so usage stays inside
// the monthly free tier (4M characters). No Deno-only APIs except fetch, so it is testable in Node.

const TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
// The API rejects input over 5000 bytes; keep a margin for the SSML tags.
const MAX_CHUNK_BYTES = 4000;

interface VoiceChoice {
  languageCode: string;
  name?: string;
}

// The teacher types the language as free text ("English", "Arabic", "ar", "తెలుగు"...).
const VOICES: { match: RegExp; voice: VoiceChoice }[] = [
  { match: /arab|عرب|^ar\b/i, voice: { languageCode: "ar-XA", name: "ar-XA-Wavenet-B" } },
  { match: /telugu|తెలుగు|^te\b/i, voice: { languageCode: "te-IN", name: "te-IN-Standard-A" } },
  { match: /hindi|हिन्दी|हिंदी|^hi\b/i, voice: { languageCode: "hi-IN", name: "hi-IN-Wavenet-A" } },
  { match: /tamil|தமிழ்|^ta\b/i, voice: { languageCode: "ta-IN", name: "ta-IN-Wavenet-A" } },
  { match: /kannada|ಕನ್ನಡ|^kn\b/i, voice: { languageCode: "kn-IN", name: "kn-IN-Wavenet-A" } },
  { match: /malayalam|മലയാളം|^ml\b/i, voice: { languageCode: "ml-IN", name: "ml-IN-Wavenet-A" } },
  { match: /urdu|اردو|^ur\b/i, voice: { languageCode: "ur-IN", name: "ur-IN-Wavenet-A" } },
  { match: /french|français|^fr\b/i, voice: { languageCode: "fr-FR", name: "fr-FR-Wavenet-A" } },
  { match: /spanish|español|^es\b/i, voice: { languageCode: "es-ES", name: "es-ES-Wavenet-B" } },
];
const DEFAULT_VOICE: VoiceChoice = { languageCode: "en-IN", name: "en-IN-Wavenet-D" };

export function voiceFor(language: string): VoiceChoice {
  return VOICES.find((v) => v.match.test(language.trim()))?.voice ?? DEFAULT_VOICE;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const byteLen = (s: string) => new TextEncoder().encode(s).length;

/** Split text into pieces under the byte limit, breaking at sentence ends where possible. */
export function splitForTts(text: string, maxBytes = MAX_CHUNK_BYTES): string[] {
  const sentences = text.match(/[^.!?。؟।]+[.!?。؟।]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (byteLen(current + sentence) <= maxBytes) {
      current += sentence;
      continue;
    }
    if (current.trim()) chunks.push(current.trim());
    current = "";
    // A single huge "sentence": hard-cut it by characters.
    let rest = sentence;
    while (byteLen(rest) > maxBytes) {
      let cut = Math.floor(rest.length * (maxBytes / byteLen(rest)));
      while (cut > 1 && byteLen(rest.slice(0, cut)) > maxBytes) cut--;
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
    current = rest;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/** One section of narration (a slide): optional heading, body text, and a pause after it. */
export interface NarrationSection {
  heading?: string;
  text: string;
}

/** SSML requests for one section: heading, short pause, body, longer pause at the end. */
function sectionSsml(section: NarrationSection): string[] {
  const out: string[] = [];
  const pieces = splitForTts(section.text.replace(/\s+/g, " ").trim());
  pieces.forEach((piece, i) => {
    const head = i === 0 && section.heading ? `${escapeXml(section.heading)}.<break time="500ms"/>` : "";
    const tail = i === pieces.length - 1 ? `<break time="900ms"/>` : "";
    out.push(`<speak>${head}${escapeXml(piece)}${tail}</speak>`);
  });
  if (pieces.length === 0 && section.heading) out.push(`<speak>${escapeXml(section.heading)}.<break time="900ms"/></speak>`);
  return out;
}

/** Build SSML requests for all sections, in order. */
export function buildSsmlChunks(sections: NarrationSection[]): string[] {
  return sections.flatMap(sectionSsml);
}

const concatBytes = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

async function synthesizeOne(apiKey: string, ssml: string, voice: VoiceChoice, timeoutMs: number): Promise<Uint8Array> {
  const call = (v: VoiceChoice) =>
    fetch(`${TTS_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { ssml },
        voice: v,
        audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

  let res = await call(voice);
  // A voice name Google no longer offers -> let Google pick a default voice for the language.
  if (res.status === 400 && voice.name) res = await call({ languageCode: voice.languageCode });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let message = detail;
    try { message = JSON.parse(detail)?.error?.message ?? detail; } catch { /* plain text */ }
    throw new Error(`Text-to-speech failed (${res.status}): ${String(message).slice(0, 300)}`);
  }
  const data = await res.json();
  if (typeof data?.audioContent !== "string") throw new Error("Text-to-speech returned no audio");
  const bin = atob(data.audioContent);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Narrate each section into its own MP3 (one per slide; the video needs per-slide timing).
 * MP3 frames from the same encoder can simply be joined, so a section's pieces are concatenated.
 * Calls run a few at a time to stay fast without hitting rate limits.
 */
export async function synthesizeSections(
  apiKey: string,
  sections: NarrationSection[],
  language: string,
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<Uint8Array[]> {
  const jobs = sections.flatMap((s, si) => sectionSsml(s).map((ssml) => ({ si, ssml })));
  if (jobs.length === 0) throw new Error("Nothing to narrate");
  const voice = voiceFor(language);
  const concurrency = opts.concurrency ?? 4;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const parts: Uint8Array[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      parts[i] = await synthesizeOne(apiKey, jobs[i].ssml, voice, timeoutMs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  return sections.map((_, si) => concatBytes(parts.filter((_, i) => jobs[i].si === si)));
}

/** Narrate the sections into a single MP3. */
export async function synthesizeNarration(
  apiKey: string,
  sections: NarrationSection[],
  language: string,
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<Uint8Array> {
  return concatBytes(await synthesizeSections(apiKey, sections, language, opts));
}

export { concatBytes };
