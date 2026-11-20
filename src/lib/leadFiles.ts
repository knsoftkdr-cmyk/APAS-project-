// Reading and saving lead import/export files. Works in the browser and inside the Capacitor Android app
// (same Filesystem + Share approach as exportSelectedApplicants).
import * as XLSX from "xlsx";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { shapeSheet, validateImportFile, type ParsedSheet } from "@/lib/leadImport";

export async function readLeadFile(file: File): Promise<{ sheet?: ParsedSheet; error?: string }> {
  const bad = validateImportFile(file);
  if (bad) return { error: bad };
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const ext = file.name.toLowerCase().split(".").pop();
  try {
    let wb: XLSX.WorkBook;
    if (ext === "xlsx") {
      if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return { error: "This doesn't look like a real .xlsx file." };
      // formulas are never evaluated and dates stay as serial numbers (no timezone drift)
      wb = XLSX.read(bytes, { type: "array", cellDates: false, cellFormula: false, cellHTML: false, cellStyles: false });
    } else {
      if (bytes.subarray(0, 4096).includes(0)) return { error: "This doesn't look like a text CSV file." };
      wb = XLSX.read(new TextDecoder("utf-8").decode(bytes), { type: "string", raw: true, cellFormula: false });
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { error: "No data found in this file." };
    return shapeSheet(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true, blankrows: false }));
  } catch {
    return { error: "Couldn't read this file. It may be damaged or password-protected." };
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}

/** Saves text/binary to the user's device: a normal download on the web, the share sheet in the Android app. */
export async function saveFile(fileName: string, data: { text: string } | { workbook: XLSX.WorkBook }, shareTitle: string): Promise<void> {
  const isText = "text" in data;
  const mime = isText ? "text/csv;charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (Capacitor.isNativePlatform()) {
    const base64 = isText
      ? bytesToBase64(new TextEncoder().encode(data.text))
      : XLSX.write(data.workbook, { type: "base64", bookType: "xlsx" });
    const written = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
    await Share.share({ title: shareTitle, url: written.uri, dialogTitle: shareTitle });
    return;
  }
  if (!isText) { XLSX.writeFile(data.workbook, fileName); return; }
  const url = URL.createObjectURL(new Blob([data.text], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
