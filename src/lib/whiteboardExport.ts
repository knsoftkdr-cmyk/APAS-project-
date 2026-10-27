// Whiteboard export: the board as a PDF, a Word document or a PNG, ready to share with students or print.
// Each file has the board title, the date, the picture of the board and - when AI Draw was used - the
// step-by-step explanation the AI gave, so the handout explains itself.
// jspdf and docx are loaded only when an export is asked for; they are large and most sessions never export.
import { exportToBlob } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export type ExportFormat = "pdf" | "docx" | "png";

/** One AI Draw explanation shown on the board: its title and the caption of every step. */
export interface BoardNote { title: string; steps: string[] }

const MAX_PX = 4000; // longest side of the exported picture; keeps files small and canvases within browser limits

interface BoardPicture { blob: Blob; width: number; height: number }

async function renderBoard(api: ExcalidrawImperativeAPI): Promise<BoardPicture> {
  const elements = api.getSceneElements();
  if (!elements.length) throw new Error("The board is empty - draw something first.");
  let size = { width: 0, height: 0 };
  const blob = await exportToBlob({
    elements,
    appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
    files: api.getFiles(),
    mimeType: "image/png",
    exportPadding: 32,
    // Twice the screen resolution so text stays sharp when printed, capped for very large boards.
    getDimensions: (w: number, h: number) => {
      const scale = Math.min(2, MAX_PX / Math.max(w, h));
      size = { width: Math.round(w * scale), height: Math.round(h * scale) };
      return { ...size, scale };
    },
  });
  return { blob, ...size };
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Whiteboard";
const today = () => new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

async function toBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

async function deliver(blob: Blob, fileName: string, title: string) {
  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({ path: fileName, data: await toBase64(blob), directory: Directory.Cache });
    await Share.share({ title, url: written.uri, dialogTitle: "Save or share the whiteboard" });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function buildPdf(title: string, pic: BoardPicture, notes: BoardNote[]): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const landscape = pic.width >= pic.height;
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const m = 14;

  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(30, 41, 59);
  doc.text(title, m, m + 4);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(100, 116, 139);
  doc.text(today(), m, m + 11);
  doc.setDrawColor(203, 213, 225).line(m, m + 15, pageW - m, m + 15);

  // Picture: as large as the page allows below the header, keeping its proportions.
  const top = m + 20;
  const boxW = pageW - 2 * m, boxH = pageH - top - m;
  const k = Math.min(boxW / pic.width, boxH / pic.height);
  const w = pic.width * k, h = pic.height * k;
  const png = new Uint8Array(await pic.blob.arrayBuffer());
  doc.addImage(png, "PNG", m + (boxW - w) / 2, top, w, h, undefined, "FAST");

  for (const note of notes) {
    doc.addPage(undefined, "portrait");
    const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
    let y = m + 4;
    doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(30, 41, 59);
    doc.text(`Explanation: ${note.title}`, m, y, { maxWidth: pw - 2 * m });
    y += 12;
    doc.setFont("helvetica", "normal").setFontSize(12).setTextColor(30, 41, 59);
    note.steps.forEach((step, i) => {
      const lines = doc.splitTextToSize(`${i + 1}. ${step}`, pw - 2 * m - 4) as string[];
      if (y + lines.length * 6 > ph - m) { doc.addPage(undefined, "portrait"); y = m + 4; }
      doc.text(lines, m + 2, y);
      y += lines.length * 6 + 3;
    });
  }
  return doc.output("blob");
}

async function buildDocx(title: string, pic: BoardPicture, notes: BoardNote[]): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType } = await import("docx");
  // A4 portrait with 2 cm margins leaves about 640 px of usable width at Word's 96 dpi.
  const maxW = 640, maxH = 820;
  const k = Math.min(maxW / pic.width, maxH / pic.height, 1);
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }),
    new Paragraph({ children: [new TextRun({ text: today(), color: "64748B" })] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      children: [new ImageRun({
        type: "png",
        data: new Uint8Array(await pic.blob.arrayBuffer()),
        transformation: { width: Math.round(pic.width * k), height: Math.round(pic.height * k) },
      })],
    }),
  ];
  for (const note of notes) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`Explanation: ${note.title}`)] }));
    note.steps.forEach((step, i) => {
      children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: `${i + 1}. `, bold: true }), new TextRun(step)] }));
    });
  }
  const doc = new Document({
    creator: "APAS",
    title,
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  });
  return Packer.toBlob(doc);
}

export async function exportWhiteboard(api: ExcalidrawImperativeAPI, format: ExportFormat, title: string, notes: BoardNote[]) {
  const pic = await renderBoard(api);
  const name = safeName(title);
  if (format === "png") return deliver(pic.blob, `${name}.png`, title);
  if (format === "pdf") return deliver(await buildPdf(title, pic, notes), `${name}.pdf`, title);
  return deliver(await buildDocx(title, pic, notes), `${name}.docx`, title);
}
