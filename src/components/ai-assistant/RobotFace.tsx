import { useState } from "react";
import type { Viseme } from "@/hooks/useLipSync";

interface MouthCalibration {
  /** Center of the mouth, as a % of the image's rendered width/height. */
  xPct: number;
  yPct: number;
  /** Size of the patch/overlay box, as a % of image width/height. */
  widthPct: number;
  heightPct: number;
}

// ---------------------------------------------------------------------
// CALIBRATE ME: these four numbers position the mouth overlay on top of
// YOUR robot PNG. Defaults are centered a little below the middle of the
// image (roughly where a face-screen robot's mouth usually sits).
//
// Fastest way to tune them: open the widget's voice mode, add
// `?calibrate=1` to the page URL, and click on the robot's real mouth -
// the exact xPct/yPct/widthPct/heightPct to paste in here are logged to
// the console.
// ---------------------------------------------------------------------
const DEFAULT_MOUTH: MouthCalibration = {
  xPct: 50,
  yPct: 62,
  widthPct: 30,
  heightPct: 16,
};

// Color of the patch drawn under the animated mouth to cover the PNG's
// original static mouth. Match this to your robot's face/visor color.
const PATCH_COLOR = "#0b1830";
const GLOW_COLOR = "#7dd3fc";

const MOUTH_PATHS: Record<Viseme, string> = {
  // Gentle closed "smile" curve - resting state, matches a typical
  // digital-face robot's idle mouth.
  REST: "M 15 30 Q 60 38 105 30",
  // Pressed-together lips for M/B/P sounds.
  MBP: "M 20 30 L 100 30",
  // Wide open (AA - "father").
  AA: "M 20 18 Q 60 52 100 18 Q 60 30 20 18 Z",
  // Wide, flat smile-open (EE - "see").
  EE: "M 12 26 Q 60 12 108 26 Q 60 40 12 26 Z",
  // Small, slightly open (IH - "sit").
  IH: "M 35 25 Q 60 36 85 25 Q 60 31 35 25 Z",
  // Rounded open (OH - "go").
  OH: "M 40 12 Q 80 12 80 30 Q 80 48 40 48 Q 40 30 40 12 Z",
  // Small rounded/pursed (OU - "you").
  OU: "M 46 20 Q 74 20 74 30 Q 74 40 46 40 Q 46 30 46 20 Z",
};

interface RobotFaceProps {
  src: string;
  alt?: string;
  viseme: Viseme;
  /** 0..1 smoothed openness from useLipSync - scales the mouth shape. */
  intensity: number;
  /** Only animate while actually speaking; otherwise hold REST. */
  active: boolean;
  className?: string;
  mouthCalibration?: Partial<MouthCalibration>;
}

export function RobotFace({
  src,
  alt = "AI assistant robot",
  viseme,
  intensity,
  active,
  className,
  mouthCalibration,
}: RobotFaceProps) {
  const mouth: MouthCalibration = { ...DEFAULT_MOUTH, ...mouthCalibration };
  const shownViseme = active ? viseme : "REST";
  const shownIntensity = active ? intensity : 0;

  // Dev-only calibration helper: add ?calibrate=1 to the URL, click the
  // robot's real mouth to log the box you should paste into
  // DEFAULT_MOUTH above.
  const [calibrating] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("calibrate") === "1"
  );

  const handleCalibrateClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!calibrating) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    // eslint-disable-next-line no-console
    console.log(
      `[lip-sync calibration] mouthCalibration={ xPct: ${xPct.toFixed(1)}, yPct: ${yPct.toFixed(
        1
      )}, widthPct: 30, heightPct: 16 } - adjust widthPct/heightPct visually, then hardcode into DEFAULT_MOUTH.`
    );
  };

  return (
    <div
      className={`relative h-full w-full select-none ${className ?? ""}`}
      onClick={handleCalibrateClick}
    >
      <img src={src} alt={alt} draggable={false} className="h-full w-full select-none object-cover object-top" />

      {calibrating && (
        <div
          className="pointer-events-none absolute rounded-full border-2 border-dashed border-red-400/80"
          style={{
            left: `${mouth.xPct - mouth.widthPct / 2}%`,
            top: `${mouth.yPct - mouth.heightPct / 2}%`,
            width: `${mouth.widthPct}%`,
            height: `${mouth.heightPct}%`,
          }}
        />
      )}

      {/* Patch: covers the PNG's original static mouth so only the
          animated one is visible. Soft-edged so it blends into the face
          instead of reading as a sticker. */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: `${mouth.xPct - mouth.widthPct / 2}%`,
          top: `${mouth.yPct - mouth.heightPct / 2}%`,
          width: `${mouth.widthPct}%`,
          height: `${mouth.heightPct}%`,
          background: `radial-gradient(ellipse at center, ${PATCH_COLOR} 55%, transparent 85%)`,
        }}
      />

      {/* Animated mouth overlay. A single SVG per viseme, cross-faded via
          opacity so shape changes never flicker; intensity scales it
          slightly for a breathing/talking feel within a held shape. */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: `${mouth.xPct - mouth.widthPct / 2}%`,
          top: `${mouth.yPct - mouth.heightPct / 2}%`,
          width: `${mouth.widthPct}%`,
          height: `${mouth.heightPct}%`,
          transform: `scale(${1 + shownIntensity * 0.12})`,
          transformOrigin: "center",
          transition: "transform 90ms ease-out",
        }}
      >
        {(Object.keys(MOUTH_PATHS) as Viseme[]).map((v) => (
          <svg
            key={v}
            viewBox="0 0 120 60"
            className="absolute inset-0 h-full w-full"
            style={{
              opacity: shownViseme === v ? 1 : 0,
              transition: "opacity 110ms ease-out",
              filter: `drop-shadow(0 0 4px ${GLOW_COLOR})`,
            }}
          >
            <path
              d={MOUTH_PATHS[v]}
              fill={v === "REST" || v === "MBP" ? "none" : GLOW_COLOR}
              stroke={GLOW_COLOR}
              strokeWidth={v === "REST" || v === "MBP" ? 4 : 1.5}
              strokeLinecap="round"
              opacity={v === "REST" || v === "MBP" ? 0.9 : 0.85}
            />
          </svg>
        ))}
      </div>
    </div>
  );
}