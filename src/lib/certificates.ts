// Certificate designs: what's stored, how placeholders fill in, and how a certificate is drawn.
//
// Drawn on a canvas (then placed in the PDF as an image) rather than with jsPDF text, because the browser shapes
// Arabic and Indian-language names correctly and jsPDF's built-in fonts can't.

import { displayLocale } from "@/i18n/runtime";
import { certificateVerifyUrl } from "@/lib/publicUrl";

export const PAGE = { width: 1754, height: 1240 } as const; // A4 landscape at about 150 dpi

export type CertificateFrame = "none" | "classic" | "double" | "modern";
export type ElementAlign = "start" | "center" | "end";
export type ElementFont = "serif" | "sans" | "script";

export interface TextElement {
  id: string;
  kind: "text";
  text: string;       // may contain {{placeholders}}
  x: number;          // anchor position as % of page width (the point `align` lines up on)
  y: number;          // % of page height (vertical middle of the text)
  size: number;       // % of page height, so it scales with whatever it's drawn on
  color: string;
  bold: boolean;
  font: ElementFont;
  align: ElementAlign;
}

export interface QrElement {
  id: string;
  kind: "qr";
  x: number;          // % of page width (left edge)
  y: number;          // % of page height (top edge)
  size: number;       // % of page height
}

export type CertificateElement = TextElement | QrElement;

export interface CertificateDesign {
  frame: CertificateFrame;
  accent: string;
  background: string;
  elements: CertificateElement[];
}

export interface CertificateValues {
  student_name: string;
  certificate_title: string;
  course_name: string;
  school_name: string;
  class_name: string;
  issue_date: string;
  verification_code: string;
}

export const PLACEHOLDERS: { key: keyof CertificateValues; label: string }[] = [
  { key: "student_name", label: "Student name" },
  { key: "certificate_title", label: "Certificate title" },
  { key: "course_name", label: "Course name" },
  { key: "school_name", label: "School name" },
  { key: "class_name", label: "Class" },
  { key: "issue_date", label: "Issue date" },
  { key: "verification_code", label: "Verification code" },
];

// The words a new template starts with, and the sample values the designer shows, are in the user's language,
// so an Arabic-speaking school starts from an Arabic certificate. {{slots}} go through slot() so the i18n step
// keeps them as placeholders inside the translated sentence.
const slot = (key: keyof CertificateValues) => `{{${key}}}`;

type DefaultPart = "intro" | "reason" | "date" | "sign" | "code" | "student" | "title" | "course" | "school" | "class";

function defaultCertificateText(part: DefaultPart): string {
  switch (part) {
    case "intro": return "This is proudly presented to";
    case "reason": return `for successfully completing ${slot("course_name")}`;
    case "date": return `Issued on ${slot("issue_date")}`;
    case "sign": return "Principal";
    case "code": return `Verify: ${slot("verification_code")}`;
    case "student": return "Student Name";
    case "title": return "Certificate of Completion";
    case "course": return "Course Name";
    case "school": return "School Name";
    case "class": return "Class 8 A";
  }
}

const longDate = (d: Date) => d.toLocaleDateString(displayLocale(), { day: "numeric", month: "long", year: "numeric" });

export function sampleValues(): CertificateValues {
  return {
    student_name: defaultCertificateText("student"),
    certificate_title: defaultCertificateText("title"),
    course_name: defaultCertificateText("course"),
    school_name: defaultCertificateText("school"),
    class_name: defaultCertificateText("class"),
    issue_date: longDate(new Date(2026, 10, 6)),
    verification_code: "A1B2C3D4E5F60718",
  };
}

const text = (id: string, value: string, y: number, size: number, extra: Partial<TextElement> = {}): TextElement => ({
  id, kind: "text", text: value, x: 50, y, size, color: "#1f2937", bold: false, font: "serif", align: "center", ...extra,
});

export function defaultDesign(): CertificateDesign {
  return {
    frame: "classic",
    accent: "#1e3a8a",
    background: "#fffdf7",
    elements: [
      text("school", "{{school_name}}", 14, 3.2, { color: "#475569", font: "sans" }),
      text("title", "{{certificate_title}}", 26, 6.4, { color: "#1e3a8a", bold: true }),
      text("intro", defaultCertificateText("intro"), 39, 2.8, { color: "#475569" }),
      text("name", "{{student_name}}", 50, 7, { color: "#111827", font: "script", bold: true }),
      text("reason", defaultCertificateText("reason"), 62, 3, { color: "#374151" }),
      text("date", defaultCertificateText("date"), 72, 2.4, { color: "#475569", font: "sans" }),
      { id: "sign", kind: "text", text: defaultCertificateText("sign"), x: 22, y: 86, size: 2.4, color: "#475569", bold: false, font: "sans", align: "center" },
      { id: "code", kind: "text", text: defaultCertificateText("code"), x: 50, y: 92, size: 1.8, color: "#64748b", bold: false, font: "sans", align: "center" },
      { id: "qr", kind: "qr", x: 78, y: 72, size: 17 },
    ],
  };
}

/** Unknown placeholders stay visible on purpose: a typo shows up in the preview instead of printing as a blank. */
export function fillPlaceholders(template: string, values: CertificateValues): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key: string) =>
    key in values ? String(values[key as keyof CertificateValues] ?? "") : whole);
}

export interface IssuedCertificateRow {
  id: string;
  template_id: string;
  student_id: string;
  recipient_name: string;
  certificate_title: string;
  school_name: string | null;
  course_name: string | null;
  class_label: string | null;
  design: CertificateDesign;
  verification_code: string;
  issued_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export function valuesFromIssued(c: IssuedCertificateRow): CertificateValues {
  return {
    student_name: c.recipient_name,
    certificate_title: c.certificate_title,
    course_name: c.course_name ?? "",
    school_name: c.school_name ?? "",
    class_name: c.class_label ?? "",
    issue_date: longDate(new Date(c.issued_at)),
    verification_code: c.verification_code,
  };
}

export const FONT_STACK: Record<ElementFont, string> = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: "Arial, Helvetica, sans-serif",
  script: '"Brush Script MT", "Segoe Script", cursive',
};

function drawFrame(ctx: CanvasRenderingContext2D, design: CertificateDesign) {
  const { width: w, height: h } = PAGE;
  ctx.strokeStyle = design.accent;
  ctx.fillStyle = design.accent;
  if (design.frame === "classic") {
    ctx.lineWidth = 10;
    ctx.strokeRect(40, 40, w - 80, h - 80);
    ctx.lineWidth = 2;
    ctx.strokeRect(62, 62, w - 124, h - 124);
  } else if (design.frame === "double") {
    ctx.lineWidth = 5;
    ctx.strokeRect(36, 36, w - 72, h - 72);
    ctx.strokeRect(52, 52, w - 104, h - 104);
  } else if (design.frame === "modern") {
    ctx.fillRect(0, 0, w, 34);
    ctx.fillRect(0, h - 34, w, 34);
    ctx.fillRect(0, 0, 34, h);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The certificate background image couldn't be loaded."));
    img.src = src;
  });
}

/** Draws one full-size certificate. The QR always points at values.verification_code, a sample code in the designer. */
export async function renderCertificate(
  design: CertificateDesign,
  values: CertificateValues,
  backgroundImage?: string | null,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE.width;
  canvas.height = PAGE.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw certificates.");

  ctx.fillStyle = design.background || "#ffffff";
  ctx.fillRect(0, 0, PAGE.width, PAGE.height);
  if (backgroundImage) ctx.drawImage(await loadImage(backgroundImage), 0, 0, PAGE.width, PAGE.height);
  drawFrame(ctx, design);

  for (const el of design.elements) {
    if (el.kind === "qr") {
      const QRCode = (await import("qrcode")).default;
      const px = Math.round((el.size / 100) * PAGE.height);
      const qr = document.createElement("canvas");
      await QRCode.toCanvas(qr, certificateVerifyUrl(values.verification_code), { width: px, margin: 1, errorCorrectionLevel: "M" });
      ctx.drawImage(qr, (el.x / 100) * PAGE.width, (el.y / 100) * PAGE.height, px, px);
    } else {
      ctx.fillStyle = el.color;
      ctx.font = `${el.bold ? "bold " : ""}${(el.size / 100) * PAGE.height}px ${FONT_STACK[el.font]}`;
      ctx.textAlign = el.align === "start" ? "left" : el.align === "end" ? "right" : "center";
      ctx.textBaseline = "middle";
      const line = fillPlaceholders(el.text, values);
      // Arabic lines keep their word order when they also hold a code or a number.
      ctx.direction = /^[^A-Za-z\u0590-\u08FF]*[\u0590-\u08FF]/.test(line) ? "rtl" : "ltr";
      ctx.fillText(line, (el.x / 100) * PAGE.width, (el.y / 100) * PAGE.height, PAGE.width * 0.9);
    }
  }
  return canvas;
}

/** One PDF page per certificate. `backgrounds` maps template id to its background image, when it has one. */
export async function downloadCertificatesPdf(
  certificates: IssuedCertificateRow[],
  backgrounds: Map<string, string | null>,
  fileName: string,
  onProgress?: (done: number, total: number) => void,
) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < certificates.length; i++) {
    const c = certificates[i];
    const canvas = await renderCertificate(c.design, valuesFromIssued(c), backgrounds.get(c.template_id));
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, w, h);
    onProgress?.(i + 1, certificates.length);
  }
  pdf.save(fileName);
}

/** Student names go into file names, so keep them to characters every device accepts. */
export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "certificate";
