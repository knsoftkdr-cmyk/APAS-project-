// Which video platform a class link belongs to. Worked out from the link itself, so links saved before this existed
// (and links from any platform a teacher pastes) get the right label with no data change.

export type VideoProvider = "zoom" | "google_meet" | "teams" | "jitsi" | "youtube" | "other";

export const VIDEO_PROVIDER_LABELS: Record<VideoProvider, string> = {
  zoom: "Zoom",
  google_meet: "Google Meet",
  teams: "Microsoft Teams",
  jitsi: "Jitsi Meet",
  youtube: "YouTube Live",
  other: "Online class",
};

const HOST_RULES: { provider: VideoProvider; matches: (host: string) => boolean }[] = [
  { provider: "zoom", matches: (h) => h === "zoom.us" || h.endsWith(".zoom.us") || h === "zoomgov.com" || h.endsWith(".zoomgov.com") },
  { provider: "google_meet", matches: (h) => h === "meet.google.com" },
  { provider: "teams", matches: (h) => h === "teams.microsoft.com" || h === "teams.live.com" },
  { provider: "jitsi", matches: (h) => h === "meet.jit.si" || h === "8x8.vc" },
  { provider: "youtube", matches: (h) => h === "youtube.com" || h === "www.youtube.com" || h === "m.youtube.com" || h === "youtu.be" },
];

function parseUrl(link: string): URL | null {
  try {
    return new URL(link.trim());
  } catch {
    return null;
  }
}

export function detectVideoProvider(link: string): VideoProvider {
  const url = parseUrl(link);
  if (!url) return "other";
  const host = url.hostname.toLowerCase();
  return HOST_RULES.find((r) => r.matches(host))?.provider ?? "other";
}

/** Why this can't be saved as a class link, or null when it's fine. Students open it directly, so only https passes. */
export function meetingLinkProblem(link: string): string | null {
  const value = link.trim();
  if (!value) return "Please add the class link.";
  if (/^rtmps?:\/\//i.test(value)) {
    return "RTMP is a streaming address, students can't open it. Paste the viewer link instead, such as the YouTube Live watch link.";
  }
  const url = parseUrl(value);
  if (!url || url.protocol !== "https:") return "The class link must start with https://";
  return null;
}

/** Jitsi rooms exist as soon as someone opens the link, so no account or API key is needed. */
export function newJitsiRoomUrl(title: string, randomPart: string = crypto.randomUUID().slice(0, 8)): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  return `https://meet.jit.si/apas-${slug ? `${slug}-` : ""}${randomPart}`;
}
