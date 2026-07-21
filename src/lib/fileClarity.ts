import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Downscale to ~600px wide, compute Laplacian-variance sharpness + brightness.
// Flags blurry, too-dark, or washed-out scans before they're ever uploaded.
// Checks images directly and the first page of PDFs. DOC/DOCX are skipped
// (can't be rendered to a canvas in-browser).
// Fails open (allows upload) if the check itself throws, so a bug here never
// blocks a legitimate submission.
export async function assessFileClarity(file: File): Promise<{ ok: boolean; reason?: string }> {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const isImage = [".jpg", ".jpeg", ".png", ".tiff", ".tif"].includes(ext) || file.type.startsWith("image/");
  const isPdf = ext === ".pdf" || file.type === "application/pdf";
  if (!isImage && !isPdf) return { ok: true };

  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: true };

    if (isPdf) {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      const page = await pdf.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1, 600 / baseViewport.width) || 0.5;
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    } else {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 600 / bitmap.width);
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    }

    const { width, height } = canvas;
    if (width < 10 || height < 10) return { ok: true };
    const imageData = ctx.getImageData(0, 0, width, height).data;

    const gray = new Float32Array(width * height);
    let brightnessSum = 0;
    for (let i = 0, p = 0; i < imageData.length; i += 4, p++) {
      const g = 0.299 * imageData[i] + 0.587 * imageData[i + 1] + 0.114 * imageData[i + 2];
      gray[p] = g;
      brightnessSum += g;
    }
    const avgBrightness = brightnessSum / gray.length;

    // Laplacian variance: low variance = few sharp edges = blurry image.
    let lapSum = 0;
    let lapSumSq = 0;
    let count = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const lap = gray[idx - width] + gray[idx + width] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx];
        lapSum += lap;
        lapSumSq += lap * lap;
        count++;
      }
    }
    const lapMean = lapSum / count;
    const variance = lapSumSq / count - lapMean * lapMean;

    const BLUR_VARIANCE_THRESHOLD = 15; // tuned for ~600px-wide downscaled scans; lower = stricter
    const TOO_DARK_THRESHOLD = 12;
    const TOO_BRIGHT_THRESHOLD = 252;

    if (variance < BLUR_VARIANCE_THRESHOLD) {
      return { ok: false, reason: "This file looks blurry. Please retake a clear, well-lit photo and upload again." };
    }
    if (avgBrightness < TOO_DARK_THRESHOLD) {
      return { ok: false, reason: "This file looks too dark to read. Please retake it in better lighting and upload again." };
    }
    if (avgBrightness > TOO_BRIGHT_THRESHOLD) {
      return { ok: false, reason: "This file looks washed out or overexposed. Please retake it and upload again." };
    }
    return { ok: true };
  } catch (e) {
    console.warn("Clarity check failed, allowing upload:", e);
    return { ok: true };
  }
}
