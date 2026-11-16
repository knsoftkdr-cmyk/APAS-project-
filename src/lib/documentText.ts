// Reads a whole teaching document in the browser for the question generator, and splits it into pieces small enough
// for one AI call. The AI Tutor's reader (tutorAttachments.ts) stops at 30,000 characters, too little for a chapter.

import { extOf, looksLikeText } from "@/lib/tutorAttachments";

export const DOC_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  maxPdfPages: 300,
  maxChars: 200_000,
  charsPerChunk: 12_000,      // keep in sync with MAX_CHUNK_CHARS in generateItemsFromDocument.ts
  maxQuestions: 200,
  questionsPerCall: 20,       // keep in sync with MAX_PER_CALL in generateItemsFromDocument.ts
} as const;

export const DOC_ACCEPT = ".pdf,.docx,.pptx,.txt,.md";

export interface DocumentText {
  name: string;
  text: string;
  truncated: boolean;
  note: string;
}

const UNSUPPORTED: Record<string, string> = {
  doc: "Old Word files (.doc) can't be read. Please save it as .docx or PDF.",
  ppt: "Old PowerPoint files (.ppt) can't be read. Please save it as .pptx or PDF.",
};

async function readPdf(file: File): Promise<{ text: string; note: string }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if ((e as { name?: string })?.name === "PasswordException") throw new Error(`"${file.name}" is password-protected. Please remove the password and try again.`);
    throw new Error(`"${file.name}" couldn't be read. The PDF may be damaged.`);
  }
  try {
    const pages = Math.min(doc.numPages, DOC_LIMITS.maxPdfPages);
    const parts: string[] = [];
    for (let p = 1; p <= pages; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      const line = content.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ").trim();
      if (line) parts.push(line);
    }
    const text = parts.join("\n\n");
    if (text.length < 40) throw new Error(`"${file.name}" looks like a scanned PDF with no readable text. Please upload a PDF with selectable text, or a Word file.`);
    return { text, note: `${pages} of ${doc.numPages} pages read` };
  } finally {
    try { void task.destroy(); } catch { /* cleanup must not turn a good read into an error */ }
  }
}

async function readDocx(file: File): Promise<{ text: string; note: string }> {
  const mammoth = (await import("mammoth")).default ?? (await import("mammoth"));
  try {
    const raw = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: raw.value, note: "Word document read" };
  } catch {
    throw new Error(`"${file.name}" couldn't be read. Please check it's a valid .docx file.`);
  }
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Slide text lives in <a:t> runs, grouped into paragraphs by <a:p>. Speaker notes are left out. */
export function slideXmlToText(xml: string): string {
  return [...xml.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)]
    .map((p) => [...p[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => decodeXml(t[1])).join(""))
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

async function readPptx(file: File): Promise<{ text: string; note: string }> {
  const JSZip = (await import("jszip")).default;
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error(`"${file.name}" couldn't be read. Please check it's a valid .pptx file.`);
  }
  const slides = Object.keys(zip.files)
    .map((name) => ({ name, n: Number(name.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1]) }))
    .filter((s) => s.n > 0)
    .sort((a, b) => a.n - b.n);
  const parts = await Promise.all(slides.map(async (s) => slideXmlToText(await zip.files[s.name].async("string"))));
  return { text: parts.filter(Boolean).join("\n\n"), note: `${slides.length} slides read` };
}

async function readPlainText(file: File): Promise<{ text: string; note: string }> {
  const text = await file.text();
  if (!looksLikeText(text.slice(0, 4000))) throw new Error(`"${file.name}" doesn't look like a text file.`);
  return { text, note: "Text file read" };
}

/** Never returns empty text: a file we can't get text from throws a message that's safe to show the teacher. */
export async function readDocumentText(file: File): Promise<DocumentText> {
  const ext = extOf(file.name);
  if (UNSUPPORTED[ext]) throw new Error(`"${file.name}": ${UNSUPPORTED[ext]}`);
  if (file.size === 0) throw new Error(`"${file.name}" is empty.`);
  if (file.size > DOC_LIMITS.maxBytes) throw new Error(`"${file.name}" is too large. Documents can be up to ${DOC_LIMITS.maxBytes / 1048576} MB.`);

  let read;
  if (ext === "pdf") read = await readPdf(file);
  else if (ext === "docx") read = await readDocx(file);
  else if (ext === "pptx") read = await readPptx(file);
  else if (ext === "txt" || ext === "md") read = await readPlainText(file);
  else throw new Error(`"${file.name}" isn't supported. Please upload a PDF, Word (.docx), PowerPoint (.pptx) or text file.`);

  const clean = read.text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length < 40) throw new Error(`"${file.name}" has too little text to write questions from.`);
  return {
    name: file.name,
    text: clean.slice(0, DOC_LIMITS.maxChars),
    truncated: clean.length > DOC_LIMITS.maxChars,
    note: read.note,
  };
}

/** Splits on paragraph breaks where possible, so a chunk doesn't start mid-sentence. */
export function chunkText(text: string, size: number = DOC_LIMITS.charsPerChunk): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > size) {
    const window = rest.slice(0, size);
    const paragraph = window.lastIndexOf("\n\n");
    const sentence = window.lastIndexOf(". ");
    const cut = paragraph > size / 2 ? paragraph : sentence > size / 2 ? sentence + 1 : size;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export interface DocumentBatch { chunk: string; count: number }

/** Shares the requested questions evenly over the document, in calls small enough to finish before the server times out. */
export function planDocumentBatches(text: string, total: number): DocumentBatch[] {
  const wanted = Math.min(DOC_LIMITS.maxQuestions, Math.max(1, Math.round(total)));
  const chunks = chunkText(text);
  // A long document with few questions wanted: use evenly spaced chunks rather than only the first pages.
  const used = chunks.length <= wanted
    ? chunks
    : Array.from({ length: wanted }, (_, i) => chunks[Math.floor((i * chunks.length) / wanted)]);

  const batches: DocumentBatch[] = [];
  used.forEach((chunk, i) => {
    let share = Math.floor(wanted / used.length) + (i < wanted % used.length ? 1 : 0);
    while (share > 0) {
      const count = Math.min(share, DOC_LIMITS.questionsPerCall);
      batches.push({ chunk, count });
      share -= count;
    }
  });
  return batches;
}
