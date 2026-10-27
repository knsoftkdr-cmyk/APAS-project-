import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { prepareFile, truncateText, looksLikeText, classifyFile, limitProblem, toRequestAttachments, speechLangFor, TUTOR_ATTACH, type TutorAttachment } from "@/lib/tutorAttachments";

// Test-runner seams only (a browser needs neither): PDF.js's worker must be a real file path here, and mammoth's
// Node build takes `buffer` where its browser build takes `arrayBuffer`. The real parsers still read the real files.
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({ default: `${process.cwd()}/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs` }));
vi.mock("mammoth", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const real = await vi.importActual<any>("mammoth");
  const lib = real.default ?? real;
  return { default: { ...lib, extractRawText: (o: { arrayBuffer?: ArrayBuffer }) => lib.extractRawText(o.arrayBuffer ? { buffer: Buffer.from(o.arrayBuffer) } : o) } };
});

// jsdom lacks DOMMatrix (PDF.js needs it) and Blob.arrayBuffer()/text(); real browsers have all of these.
class FakeDOMMatrix { a = 1; b = 0; c = 0; d = 1; e = 0; f = 0; multiplySelf() { return this; } preMultiplySelf() { return this; } translate() { return this; } scale() { return this; } invertSelf() { return this; } }
vi.stubGlobal("DOMMatrix", FakeDOMMatrix);
// NOTE: no Promise.try / Uint8Array.toHex polyfills here on purpose - the legacy PDF.js build must work without them.

const mk = (bytes: Uint8Array | Buffer, name: string, type = ""): File => {
  const f = new File([bytes], name, { type });
  const ab = () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  Object.defineProperty(f, "arrayBuffer", { value: ab });
  Object.defineProperty(f, "text", { value: () => Promise.resolve(Buffer.from(bytes).toString("utf8")) });
  return f;
};
const real = (name: string, type: string) => mk(readFileSync(resolve(process.cwd(), "src/test/fixtures", name)), name, type);

describe("reading real files with the real extraction code", () => {
  it("extracts the text of a real PDF", async () => {
    const r = await prepareFile(real("algebra-worksheet.pdf", "application/pdf"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.attachments).toHaveLength(1);
      expect(r.attachments[0].kind).toBe("document");
      expect(r.attachments[0].text).toContain("Solve for x: 2x + 5 = 17");
      expect(r.attachments[0].text).toContain("Factorise");
      expect(r.attachments[0].note).toMatch(/1 of 1 page read/);
    }
  }, 30_000);

  it("extracts the text of a real Word (.docx) file", async () => {
    const r = await prepareFile(real("science-notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.attachments[0].text).toMatch(/Photosynthesis converts light energy[\s\S]*Name the gas released/);
  }, 30_000);

  it("reads a plain text file and refuses a binary file renamed to .txt", async () => {
    const good = await prepareFile(mk(Buffer.from("Chapter 1: Fractions\n1/2 + 1/4 = 3/4"), "notes.txt", "text/plain"));
    expect(good.ok && good.attachments[0].text).toContain("1/2 + 1/4 = 3/4");
    const bin = mk(new Uint8Array(400).map((_, i) => (i % 7 === 0 ? 0 : i % 5)), "fake.txt", "text/plain");
    const bad = await prepareFile(bin);
    expect(bad.ok).toBe(false);
  });

  it("gives a clear error for a damaged PDF and a damaged .docx", async () => {
    const badPdf = await prepareFile(mk(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "broken.pdf", "application/pdf"));
    expect(badPdf).toMatchObject({ ok: false });
    expect(!badPdf.ok && badPdf.error).toMatch(/couldn't be read|damaged/i);
    const badDocx = await prepareFile(mk(new Uint8Array([1, 2, 3, 4]), "broken.docx"));
    expect(!badDocx.ok && badDocx.error).toMatch(/couldn't be read|valid \.docx/i);
  });
});

describe("helpers", () => {
  it("classifies by extension, then MIME type", () => {
    const c = (name: string, type = "", size = 10) => classifyFile({ name, type, size });
    expect(c("a.JPG")).toEqual({ ok: true, cls: "image" });
    expect(c("a.pdf")).toEqual({ ok: true, cls: "pdf" });
    expect(c("a.docx")).toEqual({ ok: true, cls: "docx" });
    expect(c("a.csv")).toEqual({ ok: true, cls: "text" });
    expect(c("camera-photo", "image/jpeg")).toEqual({ ok: true, cls: "image" });
    expect(c("a.svg", "image/svg+xml").ok).toBe(false);
    expect(c("a.pdf.exe").ok).toBe(false);
    expect(c("a.pdf", "application/pdf", TUTOR_ATTACH.maxRawDocumentBytes + 1).ok).toBe(false);
  });
  it("truncates and detects text", () => {
    expect(truncateText("a".repeat(50), 10)).toEqual({ text: "a".repeat(10), truncated: true });
    expect(looksLikeText("hello world")).toBe(true);
    expect(looksLikeText("\u0000\u0001\u0002\u0003 abc")).toBe(false);
  });
  it("enforces attachment counts and strips client-only fields from the request", () => {
    const img = (id: string): TutorAttachment => ({ id, kind: "image", name: id, mime: "image/jpeg", data: "AAAA", preview: "data:big" });
    expect(limitProblem([img("1"), img("2"), img("3")], [img("4")])).toBeNull();
    expect(limitProblem([img("1"), img("2"), img("3"), img("4")], [img("5")])).toMatch(/4 photos/);
    expect(JSON.stringify(toRequestAttachments([img("1")]))).not.toMatch(/preview|"id"/);
  });
  it("maps teaching languages to speech-recognition languages", () => {
    expect(speechLangFor("te")).toBe("te-IN");
    expect(speechLangFor("en")).toBe("en-IN");
    expect(speechLangFor("zz")).toBe("en-IN");
  });
});
