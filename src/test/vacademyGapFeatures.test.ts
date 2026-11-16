// Pure logic behind the doubt tickets, video links, certificates and document question generator.
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { DOC_LIMITS, chunkText, planDocumentBatches, readDocumentText, slideXmlToText } from "@/lib/documentText";
import { doubtStats, formatDuration } from "@/lib/doubts";
import { sampleValues, defaultDesign, fillPlaceholders, safeFileName } from "@/lib/certificates";
import { detectVideoProvider, meetingLinkProblem, newJitsiRoomUrl } from "@/lib/videoProviders";
import { cleanItem, shuffleOptions } from "../../supabase/functions/_shared/itemCleaning";

describe("video provider detection", () => {
  it.each([
    ["https://us02web.zoom.us/j/123?pwd=x", "zoom"],
    ["https://zoom.us/j/123", "zoom"],
    ["https://meet.google.com/abc-defg-hij", "google_meet"],
    ["https://teams.microsoft.com/l/meetup-join/abc", "teams"],
    ["https://meet.jit.si/apas-class", "jitsi"],
    ["https://www.youtube.com/watch?v=abc", "youtube"],
    ["https://youtu.be/abc", "youtube"],
    ["https://school.example/room", "other"],
    ["not a link", "other"],
  ])("%s is %s", (link, provider) => expect(detectVideoProvider(link)).toBe(provider));

  it("isn't fooled by a platform name inside another domain", () => {
    expect(detectVideoProvider("https://zoom.us.evil.example/j/1")).toBe("other");
    expect(detectVideoProvider("https://evil.example/meet.google.com")).toBe("other");
  });
});

describe("meeting link rules", () => {
  it("accepts https links", () => expect(meetingLinkProblem(" https://meet.google.com/abc ")).toBeNull());
  it("refuses links students can't safely open", () => {
    expect(meetingLinkProblem("javascript:alert(1)")).toMatch(/https/);
    expect(meetingLinkProblem("http://zoom.us/j/1")).toMatch(/https/);
    expect(meetingLinkProblem("meet.google.com/abc")).toMatch(/https/);
    expect(meetingLinkProblem("")).toBeTruthy();
  });
  it("explains RTMP instead of just refusing it", () => expect(meetingLinkProblem("rtmp://a.rtmp.youtube.com/live2")).toMatch(/streaming/));
  it("makes a clean, unguessable Jitsi room", () => {
    expect(newJitsiRoomUrl("Chapter 4: Revision!", "ab12cd34")).toBe("https://meet.jit.si/apas-chapter-4-revision-ab12cd34");
    expect(newJitsiRoomUrl("", "ab12cd34")).toBe("https://meet.jit.si/apas-ab12cd34");
  });
});

describe("doubt statistics", () => {
  const base = "2026-11-01T10:00:00Z";
  it("counts each status and averages only doubts that reached that stage", () => {
    const stats = doubtStats([
      { status: "new", created_at: base, first_response_at: null, resolved_at: null },
      { status: "in_progress", created_at: base, first_response_at: "2026-11-01T10:30:00Z", resolved_at: null },
      { status: "resolved", created_at: base, first_response_at: "2026-11-01T11:30:00Z", resolved_at: "2026-11-01T12:00:00Z" },
    ]);
    expect(stats).toMatchObject({ new: 1, inProgress: 1, resolved: 1, avgFirstResponseMinutes: 60, avgResolutionMinutes: 120 });
  });
  it("reports no average rather than zero when there's no data", () => {
    expect(doubtStats([]).avgFirstResponseMinutes).toBeNull();
    expect(formatDuration(null)).toBe("-");
  });
  it("formats durations for people", () => {
    expect(formatDuration(0.2)).toBe("1 min");
    expect(formatDuration(90)).toBe("1.5 hrs");
    expect(formatDuration(60 * 24 * 2)).toBe("2.0 days");
  });
});

describe("certificates", () => {
  it("fills known placeholders and leaves a typo visible", () => {
    expect(fillPlaceholders("{{student_name}} of {{ school_name }}", sampleValues())).toBe("Student Name of School Name");
    expect(fillPlaceholders("{{studnt_name}}", sampleValues())).toBe("{{studnt_name}}");
    expect(defaultDesign().elements.some((e) => e.kind === "text" && e.text === "Issued on {{issue_date}}")).toBe(true);
  });
  it("the default design has a QR code and stays on the page", () => {
    const design = defaultDesign();
    expect(design.elements.some((e) => e.kind === "qr")).toBe(true);
    for (const e of design.elements) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThanOrEqual(100);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeLessThanOrEqual(100);
    }
  });
  it("makes safe file names", () => {
    expect(safeFileName('A/B:"C"')).toBe("A B C");
    expect(safeFileName("???")).toBe("certificate");
  });
});

describe("document text", () => {
  it("reads slide text in paragraphs and decodes entities", () => {
    const xml = '<p:sld><a:p><a:r><a:t>Force &amp; </a:t></a:r><a:r><a:t>Motion</a:t></a:r></a:p><a:p><a:endParaRPr/></a:p><a:p><a:r><a:t>F = ma</a:t></a:r></a:p></p:sld>';
    expect(slideXmlToText(xml)).toBe("Force & Motion\nF = ma");
  });

  it("reads a real .pptx with slides in order", async () => {
    const zip = new JSZip();
    const slide = (t: string) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    zip.file("ppt/slides/slide2.xml", slide("Second slide about photosynthesis in plants"));
    zip.file("ppt/slides/slide10.xml", slide("Tenth slide about respiration in plants"));
    zip.file("ppt/slides/slide1.xml", slide("First slide about chlorophyll in leaves"));
    zip.file("ppt/notesSlides/notesSlide1.xml", slide("Speaker notes must not be used"));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const file = new File([bytes], "lesson.pptx");
    (file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const doc = await readDocumentText(file);
    expect(doc.text.indexOf("First")).toBeLessThan(doc.text.indexOf("Second"));
    expect(doc.text.indexOf("Second")).toBeLessThan(doc.text.indexOf("Tenth"));
    expect(doc.text).not.toContain("Speaker notes");
    expect(doc.note).toBe("3 slides read");
  });

  it("explains files it can't read", async () => {
    await expect(readDocumentText(new File(["x"], "old.doc"))).rejects.toThrow(/\.docx/);
    await expect(readDocumentText(new File(["x"], "old.ppt"))).rejects.toThrow(/\.pptx/);
    await expect(readDocumentText(new File(["x"], "data.xlsx"))).rejects.toThrow(/isn't supported/);
    await expect(readDocumentText(new File([""], "empty.pdf"))).rejects.toThrow(/empty/);
    const short = new File(["too short"], "a.txt");
    (short as unknown as { text: () => Promise<string> }).text = async () => "too short"; // jsdom has no File.text
    await expect(readDocumentText(short)).rejects.toThrow(/too little/);
  });

  it("chunks without losing text, on sentence or paragraph breaks", () => {
    const text = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const chunks = chunkText(text, 1000);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
    expect(chunks.every((c) => c.endsWith("."))).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  it("still splits text that has no breaks at all", () => {
    expect(chunkText("x".repeat(2500), 1000).map((c) => c.length)).toEqual([1000, 1000, 500]);
  });

  it("asks for exactly the requested questions, per call under the server limit", () => {
    const longDoc = "Plants make food. ".repeat(5000);
    for (const total of [1, 7, 30, 200]) {
      const batches = planDocumentBatches(longDoc, total);
      expect(batches.reduce((s, b) => s + b.count, 0)).toBe(total);
      expect(batches.every((b) => b.count >= 1 && b.count <= DOC_LIMITS.questionsPerCall)).toBe(true);
      expect(batches.every((b) => b.chunk.length <= DOC_LIMITS.charsPerChunk)).toBe(true);
    }
    // A short document with many questions reuses its one chunk over several calls.
    expect(planDocumentBatches("Plants make food using sunlight in their leaves.", 45).map((b) => b.count)).toEqual([20, 20, 5]);
    expect(planDocumentBatches(longDoc, 9999).reduce((s, b) => s + b.count, 0)).toBe(DOC_LIMITS.maxQuestions);
  });

  it("covers the whole of a long document when few questions are wanted", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Part${i} `.repeat(2500)).join("\n\n");
    const batches = planDocumentBatches(text, 2);
    expect(batches).toHaveLength(2);
    expect(batches[0].chunk).not.toBe(batches[1].chunk);
    expect(batches[1].chunk).toMatch(/Part(9|1\d)/);
  });
});

describe("MCQ cleaning (moved out of generate-item-bank unchanged)", () => {
  const good = { stem: "What do plants need to make food?", options: { A: "Sunlight", B: "Rocks", C: "Plastic", D: "Metal" }, correct: "a", explanation: "Photosynthesis." };
  it("keeps a good question", () => expect(cleanItem(good, new Set())?.correct).toBe("A"));
  it("rejects broken questions", () => {
    expect(cleanItem({ ...good, stem: "Short" }, new Set())).toBeNull();
    expect(cleanItem({ ...good, correct: "E" }, new Set())).toBeNull();
    expect(cleanItem({ ...good, options: { ...good.options, D: "All of the above" } }, new Set())).toBeNull();
    expect(cleanItem({ ...good, options: { ...good.options, D: "sunlight" } }, new Set())).toBeNull();
  });
  it("shuffling keeps the right answer right", () => {
    const item = cleanItem(good, new Set())!;
    for (let i = 0; i < 25; i++) {
      const dealt = shuffleOptions(item);
      expect(dealt.options[dealt.correct]).toBe("Sunlight");
    }
  });
});

describe("server messages shown in the user's language", () => {
  it("passes known messages through (English build) and fills the parts that vary", async () => {
    const { localizeServerMessage } = await import("@/lib/serverMessages");
    expect(localizeServerMessage("Please enter a valid phone number.")).toBe("Please enter a valid phone number.");
    expect(localizeServerMessage("Scored 80, needs 90")).toBe("Scored 80, needs 90");
    expect(localizeServerMessage('"notes.pdf" is empty.')).toBe('"notes.pdf" is empty.');
    expect(localizeServerMessage("Something new from the server")).toBe("Something new from the server");
    expect(localizeServerMessage(null)).toBe("");
  });
  it("doubt status labels", async () => {
    const { doubtStatusLabel } = await import("@/lib/doubts");
    expect([doubtStatusLabel("new"), doubtStatusLabel("in_progress"), doubtStatusLabel("resolved")]).toEqual(["New", "In Progress", "Resolved"]);
  });
});
