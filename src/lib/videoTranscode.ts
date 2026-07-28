import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

let ffmpeg: FFmpeg | null = null;

async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => {
    console.log("[ffmpeg]", message);
  });
  console.log("[transcode] loading local ffmpeg core...");
  await ffmpeg.load({ coreURL, wasmURL });
  console.log("[transcode] ffmpeg core loaded");
  return ffmpeg;
}

const TRANSCODE_TIMEOUT_MS = 90_000;

export async function transcodeToH264(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<File> {
  console.log("[transcode] starting for", file.name, file.size, "bytes");

  const transcodePromise = (async () => {
    const ff = await getFFmpeg();
    if (onProgress) {
      ff.on("progress", ({ progress }) => {
        console.log("[transcode] progress", progress);
        onProgress(progress);
      });
    }

    const inputName = "input" + (file.name.match(/\.\w+$/)?.[0] || ".mp4");
    const outputName = "output.mp4";

    console.log("[transcode] writing input file...");
    await ff.writeFile(inputName, await fetchFile(file));
    console.log("[transcode] input file written, starting exec...");

    await ff.exec([
      "-i", inputName,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outputName,
    ]);
    console.log("[transcode] exec complete, reading output...");

    const data = await ff.readFile(outputName);
    await ff.deleteFile(inputName);
    await ff.deleteFile(outputName);
    console.log("[transcode] done, output size", (data as Uint8Array).length);

    return new File([data], file.name.replace(/\.\w+$/, ".mp4"), { type: "video/mp4" });
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      console.warn("[transcode] TIMED OUT after", TRANSCODE_TIMEOUT_MS, "ms — falling back to original file");
      reject(new Error("transcode_timeout"));
    }, TRANSCODE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([transcodePromise, timeoutPromise]);
  } catch (err) {
    console.warn("[transcode] failed or timed out, uploading original file instead:", err);
    return file;
  }
}
