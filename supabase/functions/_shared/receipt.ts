// _shared/receipt.ts
// Generates a professional fee payment receipt PDF using pdf-lib.
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

export interface ReceiptData {
  schoolName: string;
  schoolAddress?: string | null;
  studentName: string;
  classGrade?: string | null;
  section?: string | null;
  paymentId: string;
  razorpayPaymentId: string;
  paidOn: string; // ISO date string
  lineItems: { label: string; amount: number }[];
  totalPaid: number;
}

function formatCurrency(n: number): string {
  return `Rs. ${n.toLocaleString("en-IN")}`;
}

const NAVY = rgb(0.09, 0.16, 0.36);
const BLUE = rgb(0.15, 0.39, 0.85);
const LIGHT_GRAY = rgb(0.95, 0.96, 0.98);
const BORDER_GRAY = rgb(0.85, 0.87, 0.9);
const TEXT_DARK = rgb(0.15, 0.17, 0.2);
const TEXT_MUTED = rgb(0.45, 0.48, 0.53);
const GREEN = rgb(0.04, 0.47, 0.29);
const GREEN_BG = rgb(0.9, 0.97, 0.93);

export async function generateReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 50;
  const contentWidth = width - marginX * 2;

  // ---- Header band ----
  const headerHeight = 100;
  page.drawRectangle({
    x: 0,
    y: 841.89 - headerHeight,
    width,
    height: headerHeight,
    color: NAVY,
  });
  page.drawText(data.schoolName, {
    x: marginX,
    y: 841.89 - 45,
    size: 20,
    font: bold,
    color: rgb(1, 1, 1),
  });
  if (data.schoolAddress) {
    page.drawText(data.schoolAddress, {
      x: marginX,
      y: 841.89 - 65,
      size: 10,
      font,
      color: rgb(0.85, 0.87, 0.92),
    });
  }
  const receiptLabel = "FEE PAYMENT RECEIPT";
  const receiptLabelWidth = bold.widthOfTextAtSize(receiptLabel, 12);
  page.drawText(receiptLabel, {
    x: width - marginX - receiptLabelWidth,
    y: 841.89 - 45,
    size: 12,
    font: bold,
    color: rgb(0.75, 0.82, 1),
  });

  let y = 841.89 - headerHeight - 40;

  // ---- Info card ----
  const infoRows: [string, string][] = [
    ["Student Name", data.studentName],
    ["Class / Section", [data.classGrade, data.section].filter(Boolean).join(" / ") || "-"],
    ["Payment ID", data.paymentId],
    ["Razorpay Payment ID", data.razorpayPaymentId],
    ["Paid On", new Date(data.paidOn).toLocaleString("en-IN")],
  ];
  const infoCardPaddingY = 18;
  const rowHeight = 22;
  const infoCardHeight = infoRows.length * rowHeight + infoCardPaddingY * 2 - 6;

  page.drawRectangle({
    x: marginX,
    y: y - infoCardHeight,
    width: contentWidth,
    height: infoCardHeight,
    color: LIGHT_GRAY,
    borderColor: BORDER_GRAY,
    borderWidth: 1,
  });

  let rowY = y - infoCardPaddingY - 10;
  for (const [label, value] of infoRows) {
    page.drawText(label.toUpperCase(), {
      x: marginX + 20,
      y: rowY,
      size: 9,
      font: bold,
      color: TEXT_MUTED,
    });
    page.drawText(value, {
      x: marginX + 220,
      y: rowY,
      size: 11,
      font,
      color: TEXT_DARK,
    });
    rowY -= rowHeight;
  }

  y = y - infoCardHeight - 35;

  // ---- Line items table ----
  const tableHeaderHeight = 30;
  page.drawRectangle({
    x: marginX,
    y: y - tableHeaderHeight,
    width: contentWidth,
    height: tableHeaderHeight,
    color: NAVY,
  });
  page.drawText("PARTICULARS", { x: marginX + 16, y: y - 20, size: 10, font: bold, color: rgb(1, 1, 1) });
  const amountHeaderWidth = bold.widthOfTextAtSize("AMOUNT", 10);
  page.drawText("AMOUNT", {
    x: width - marginX - 16 - amountHeaderWidth,
    y: y - 20,
    size: 10,
    font: bold,
    color: rgb(1, 1, 1),
  });

  y -= tableHeaderHeight;

  const visibleItems = data.lineItems.filter((item) => item.amount > 0);
  const itemRowHeight = 26;

  visibleItems.forEach((item, idx) => {
    const rowTop = y - idx * itemRowHeight;
    if (idx % 2 === 1) {
      page.drawRectangle({
        x: marginX,
        y: rowTop - itemRowHeight,
        width: contentWidth,
        height: itemRowHeight,
        color: LIGHT_GRAY,
      });
    }
    page.drawText(item.label, {
      x: marginX + 16,
      y: rowTop - itemRowHeight + 8,
      size: 10.5,
      font,
      color: TEXT_DARK,
    });
    const amountText = formatCurrency(item.amount);
    const amountWidth = font.widthOfTextAtSize(amountText, 10.5);
    page.drawText(amountText, {
      x: width - marginX - 16 - amountWidth,
      y: rowTop - itemRowHeight + 8,
      size: 10.5,
      font,
      color: TEXT_DARK,
    });
  });

  const tableBottom = y - visibleItems.length * itemRowHeight;
  page.drawRectangle({
    x: marginX,
    y: tableBottom,
    width: contentWidth,
    height: visibleItems.length * itemRowHeight,
    borderColor: BORDER_GRAY,
    borderWidth: 1,
  });

  y = tableBottom - 30;

  // ---- Total paid box ----
  const totalBoxHeight = 46;
  page.drawRectangle({
    x: marginX,
    y: y - totalBoxHeight,
    width: contentWidth,
    height: totalBoxHeight,
    color: GREEN_BG,
    borderColor: GREEN,
    borderWidth: 1,
  });
  page.drawText("TOTAL PAID", {
    x: marginX + 20,
    y: y - totalBoxHeight / 2 - 5,
    size: 13,
    font: bold,
    color: NAVY,
  });
  const totalText = formatCurrency(data.totalPaid);
  const totalWidth = bold.widthOfTextAtSize(totalText, 16);
  page.drawText(totalText, {
    x: width - marginX - 20 - totalWidth,
    y: y - totalBoxHeight / 2 - 6,
    size: 16,
    font: bold,
    color: GREEN,
  });

  y = y - totalBoxHeight - 40;

  // ---- Footer ----
  page.drawLine({
    start: { x: marginX, y },
    end: { x: width - marginX, y },
    thickness: 1,
    color: BORDER_GRAY,
  });
  y -= 20;
  const footerText = "This is a system-generated receipt and does not require a signature.";
  const footerWidth = font.widthOfTextAtSize(footerText, 9);
  page.drawText(footerText, {
    x: (width - footerWidth) / 2,
    y,
    size: 9,
    font,
    color: TEXT_MUTED,
  });

  return await doc.save();
}