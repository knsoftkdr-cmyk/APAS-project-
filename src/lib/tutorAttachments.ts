// AI Tutor attachments (browser side): decide what a file is, reject what we can't use with a clear reason,
// shrink photos, and read text out of PDF / Word / text files. The server re-validates everything
// (supabase/functions/_shared/tutorAttachments.ts) - keep the limits below in sync with it.
//
// Nothing here uploads or stores a file: the prepared result goes straight into the chat request.

export const TUTOR_ATTACH = {
  maxImages: 4,
  maxDocuments: 2,
  maxImageBytes: 1_600_000,      // after compression (server limit)
  targetImageBytes: 1_200_000,   // what we aim for, leaving headroom for base64 overhead
  maxImageDimension: 1600,
  maxRawImageBytes: 15 * 1024 * 1024,   // what a phone camera might produce, before compression
  maxRawDocumentBytes: 10 * 1024 * 1024,
  maxDocChars: 30_000,
  maxPdfPages: 60,
  scannedPdfPages: 3,            // pages rendered to photos when a PDF has no text layer
} as const;

export type FileClass = "image" | "pdf" | "docx" | "text";

export interface TutorAttachment {
  id: string;
  kind: "image" | "document";
  name: string;
  mime: string;
  /** base64 (no data: prefix) - images only */
  data?: string;
  /** extracted text - documents only */
  text?: string;
  truncated?: boolean;
  /** small thumbnail data URL for the composer / chat bubble (images) */
  preview?: string;
  /** short human note, e.g. "3 pages read" or "scanned PDF: sent first 3 pages as photos" */
  note?: string;
}

const EXT_CLASS: Record<string, FileClass> = {
  jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image", heic: "image", heif: "image",
  pdf: "pdf", docx: "docx", txt: "text", md: "text", csv: "text",
};

const KNOWN_UNSUPPORTED: Record<string, string> = {
  doc: "Old Word files (.doc) can't be read. Please save it as .docx or PDF and try again.",
  xls: "Spreadsheets aren't supported. Please attach a photo or PDF of the page instead.",
  xlsx: "Spreadsheets aren't supported. Please attach a photo or PDF of the page instead.",
  ppt: "Presentations aren't supported. Please export the slides as a PDF and try again.",
  pptx: "Presentations aren't supported. Please export the slides as a PDF and try again.",
  zip: "Compressed folders aren't supported. Please attach the PDF or photo directly.",
  rar: "Compressed folders aren't supported. Please attach the PDF or photo directly.",
  exe: "That kind of file can't be attached.", apk: "That kind of file can't be attached.",
  mp3: "Audio files aren't supported. Use the microphone button to ask by voice.",
  wav: "Audio files aren't supported. Use the microphone button to ask by voice.",
  m4a: "Audio files aren't supported. Use the microphone button to ask by voice.",
  mp4: "Videos aren't supported. Please attach a photo of the question instead.",
  mov: "Videos aren't supported. Please attach a photo of the question instead.",
  svg: "SVG images aren't supported. Please attach a photo or screenshot instead.",
  html: "Web pages aren't supported. Please attach a PDF or photo instead.",
  rtf: "RTF files aren't supported. Please save it as .docx or PDF and try again.",
  odt: "OpenDocument files aren't supported. Please save it as .docx or PDF and try again.",
};

export const ATTACH_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.pdf,.docx,.txt,.md,.csv,image/*";
export const IMAGE_ACCEPT = "image/*";

export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

export type Classified = { ok: true; cls: FileClass } | { ok: false; reason: string };

/** What kind of file is this, or why can't we use it. Judged on extension first, then MIME type. */
export function classifyFile(file: { name: string; type: string; size: number }): Classified {
  const ext = extOf(file.name);
  if (file.size === 0) return { ok: false, reason: `"${file.name}" is empty.` };
  if (KNOWN_UNSUPPORTED[ext]) return { ok: false, reason: `"${file.name}": ${KNOWN_UNSUPPORTED[ext]}` };

  let cls: FileClass | undefined = EXT_CLASS[ext];
  if (!cls) {
    if (file.type.startsWith("image/") && !file.type.includes("svg")) cls = "image"; // e.g. camera files with odd names
    else if (file.type === "application/pdf") cls = "pdf";
    else if (file.type === "text/plain") cls = "text";
  }
  if (!cls) {
    return { ok: false, reason: `"${file.name}" isn't a supported file. You can attach photos (JPG, PNG, WebP), PDFs, Word (.docx) and text files (.txt, .md, .csv).` };
  }
  if (cls === "image" && file.size > TUTOR_ATTACH.maxRawImageBytes) {
    return { ok: false, reason: `"${file.name}" is too large (${(file.size / 1048576).toFixed(0)} MB). Photos can be up to ${TUTOR_ATTACH.maxRawImageBytes / 1048576} MB.` };
  }
  if (cls !== "image" && file.size > TUTOR_ATTACH.maxRawDocumentBytes) {
    return { ok: false, reason: `"${file.name}" is too large (${(file.size / 1048576).toFixed(0)} MB). Documents can be up to ${TUTOR_ATTACH.maxRawDocumentBytes / 1048576} MB.` };
  }
  return { ok: true, cls };
}

/** Would adding these (already prepared) attachments break the per-message limits? Returns a message or null. */
export function limitProblem(existing: TutorAttachment[], adding: TutorAttachment[]): string | null {
  const all = [...existing, ...adding];
  if (all.filter((a) => a.kind === "image").length > TUTOR_ATTACH.maxImages) return `You can attach up to ${TUTOR_ATTACH.maxImages} photos at a time.`;
  if (all.filter((a) => a.kind === "document").length > TUTOR_ATTACH.maxDocuments) return `You can attach up to ${TUTOR_ATTACH.maxDocuments} documents at a time.`;
  return null;
}

/* eslint-disable no-control-regex -- intentionally strips control characters from extracted text */
export function truncateText(text: string, max = TUTOR_ATTACH.maxDocChars): { text: string; truncated: boolean } {
  const clean = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > max ? { text: clean.slice(0, max), truncated: true } : { text: clean, truncated: false };
}

/** True when text looks like real text (not a renamed binary file). */
export function looksLikeText(sample: string): boolean {
  if (!sample) return false;
  const bad = (sample.match(/[\u0000-\u0008\u000e-\u001f\ufffd]/g) ?? []).length;
  return bad / sample.length < 0.02;
}

/* eslint-enable no-control-regex */

let counter = 0;
const newId = () => `att-${Date.now().toString(36)}-${(counter++).toString(36)}`;

// ---------------------------------------------------------------- photos

async function loadBitmap(file: File): Promise<{ w: number; h: number; draw: (ctx: CanvasRenderingContext2D, dw: number, dh: number) => void; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { w: bmp.width, h: bmp.height, draw: (c, dw, dh) => c.drawImage(bmp, 0, 0, dw, dh), close: () => bmp.close() };
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode"));
      i.src = url;
    });
    return { w: img.naturalWidth, h: img.naturalHeight, draw: (c, dw, dh) => c.drawImage(img, 0, 0, dw, dh), close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function canvasToBase64(canvas: HTMLCanvasElement, quality: number): { b64: string; bytes: number } {
  const url = canvas.toDataURL("image/jpeg", quality);
  const b64 = url.slice(url.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return { b64, bytes: Math.floor((b64.length * 3) / 4) - pad };
}

/** Shrinks to at most 1600px and re-encodes as JPEG until it fits the size budget. */
export function encodeCanvas(source: HTMLCanvasElement, name: string): TutorAttachment {
  let canvas = source;
  let quality = 0.85;
  let out = canvasToBase64(canvas, quality);
  while (out.bytes > TUTOR_ATTACH.targetImageBytes && (quality > 0.5 || Math.max(canvas.width, canvas.height) > 900)) {
    if (quality > 0.5) quality -= 0.1;
    else {
      const scaled = document.createElement("canvas");
      scaled.width = Math.round(canvas.width * 0.8);
      scaled.height = Math.round(canvas.height * 0.8);
      scaled.getContext("2d")!.drawImage(canvas, 0, 0, scaled.width, scaled.height);
      canvas = scaled;
    }
    out = canvasToBase64(canvas, quality);
  }
  if (out.bytes > TUTOR_ATTACH.maxImageBytes) throw new Error(`"${name}" is too detailed to send. Please take the photo from a bit further away.`);

  const thumb = document.createElement("canvas");
  const k = 160 / Math.max(canvas.width, canvas.height);
  thumb.width = Math.max(1, Math.round(canvas.width * Math.min(1, k)));
  thumb.height = Math.max(1, Math.round(canvas.height * Math.min(1, k)));
  thumb.getContext("2d")!.drawImage(canvas, 0, 0, thumb.width, thumb.height);

  return { id: newId(), kind: "image", name, mime: "image/jpeg", data: out.b64, preview: thumb.toDataURL("image/jpeg", 0.7) };
}

export async function prepareImage(file: File): Promise<TutorAttachment> {
  let bmp;
  try {
    bmp = await loadBitmap(file);
  } catch {
    throw new Error(`"${file.name}" couldn't be opened as a photo. Please use a JPG, PNG or WebP image${/hei[cf]$/i.test(file.name) ? " (HEIC photos aren't supported by this browser - change your camera to 'Most Compatible' or take a screenshot)" : ""}.`);
  }
  try {
    const k = Math.min(1, TUTOR_ATTACH.maxImageDimension / Math.max(bmp.w, bmp.h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.w * k));
    canvas.height = Math.max(1, Math.round(bmp.h * k));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't process photos.");
    ctx.fillStyle = "#fff"; // PNG transparency -> white, so diagrams don't turn black in JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    bmp.draw(ctx, canvas.width, canvas.height);
    return encodeCanvas(canvas, file.name);
  } finally {
    bmp.close();
  }
}

// ---------------------------------------------------------------- documents

async function readPdf(file: File): Promise<TutorAttachment[]> {
  // The "legacy" build carries its own fallbacks for newer JavaScript features, so PDFs also read on older
  // phones / Android WebViews (the standard build needs a very recent Chrome/Safari).
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  let doc;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "PasswordException") throw new Error(`"${file.name}" is password-protected. Please remove the password and try again.`);
    throw new Error(`"${file.name}" couldn't be read. The PDF may be damaged.`);
  }
  try {
    const pages = Math.min(doc.numPages, TUTOR_ATTACH.maxPdfPages);
    const parts: string[] = [];
    let total = 0;
    for (let p = 1; p <= pages && total <= TUTOR_ATTACH.maxDocChars; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const line = content.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ").trim();
      if (line) { parts.push(`--- Page ${p} ---\n${line}`); total += line.length; }
    }
    const joined = parts.join("\n\n");
    if (joined.replace(/---\s*Page \d+\s*---/g, "").trim().length >= 40) {
      const { text, truncated } = truncateText(joined);
      return [{
        id: newId(), kind: "document", name: file.name, mime: "application/pdf", text,
        truncated: truncated || doc.numPages > pages,
        note: `${Math.min(pages, doc.numPages)} of ${doc.numPages} page${doc.numPages === 1 ? "" : "s"} read`,
      }];
    }
    // No text layer: a scanned book/worksheet. Send the first pages as photos so the AI can read them visually.
    const out: TutorAttachment[] = [];
    const n = Math.min(doc.numPages, TUTOR_ATTACH.scannedPdfPages);
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, TUTOR_ATTACH.maxImageDimension / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
      const att = encodeCanvas(canvas, `${file.name} (page ${p})`);
      if (p === 1) att.note = doc.numPages > n ? `Scanned PDF: sent the first ${n} of ${doc.numPages} pages as photos` : `Scanned PDF: sent as ${n} photo${n === 1 ? "" : "s"}`;
      out.push(att);
    }
    return out;
  } finally {
    // Free the PDF's memory; cleanup problems must never turn a successful read into an error.
    try { void task.destroy(); } catch { /* ignore */ }
  }
}

async function readDocx(file: File): Promise<TutorAttachment[]> {
  const mammoth = (await import("mammoth")).default ?? (await import("mammoth"));
  let raw: string;
  try {
    raw = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  } catch {
    throw new Error(`"${file.name}" couldn't be read. Please check it's a valid .docx file.`);
  }
  const { text, truncated } = truncateText(raw);
  if (!text) throw new Error(`"${file.name}" has no readable text. If it only contains pictures, attach them as photos.`);
  return [{ id: newId(), kind: "document", name: file.name, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", text, truncated }];
}

async function readText(file: File): Promise<TutorAttachment[]> {
  const raw = await file.text();
  if (!looksLikeText(raw.slice(0, 4000))) throw new Error(`"${file.name}" doesn't look like a text file.`);
  const { text, truncated } = truncateText(raw);
  if (!text) throw new Error(`"${file.name}" is empty.`);
  return [{ id: newId(), kind: "document", name: file.name, mime: "text/plain", text, truncated }];
}

export type PrepareResult = { ok: true; attachments: TutorAttachment[] } | { ok: false; error: string };

/** Validate + convert one file. Never throws: failures come back as a clear message. */
export async function prepareFile(file: File): Promise<PrepareResult> {
  const c = classifyFile(file);
  if (!c.ok) return { ok: false, error: c.reason };
  try {
    if (c.cls === "image") return { ok: true, attachments: [await prepareImage(file)] };
    if (c.cls === "pdf") return { ok: true, attachments: await readPdf(file) };
    if (c.cls === "docx") return { ok: true, attachments: await readDocx(file) };
    return { ok: true, attachments: await readText(file) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : `"${file.name}" couldn't be read.` };
  }
}

/** The request payload: only what the server needs (no previews, ids or notes). */
export function toRequestAttachments(list: TutorAttachment[]) {
  return list.map((a) =>
    a.kind === "image"
      ? { kind: "image" as const, name: a.name, mime: a.mime, data: a.data }
      : { kind: "document" as const, name: a.name, mime: a.mime, text: a.text, truncated: !!a.truncated },
  );
}

/** Speech-recognition language for each tutor teaching language (same codes as TUTOR_LANGUAGES). */
export const SPEECH_LANG: Record<string, string> = {
  en: "en-IN", hi: "hi-IN", te: "te-IN", ta: "ta-IN", kn: "kn-IN", ml: "ml-IN", mr: "mr-IN", bn: "bn-IN",
};
export const speechLangFor = (code: string) => SPEECH_LANG[code] ?? "en-IN";
