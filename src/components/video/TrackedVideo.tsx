// Drop-in <video> / YouTube players that report real watch time for the Student Engagement Score.
// Only students are tracked; for everyone else these render exactly like the plain elements they replace.
import { useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { VideoWatchSession } from "@/lib/videoWatchTracker";

function useSession(resourceId: string, title?: string): VideoWatchSession | null {
  const { profile } = useAuth();
  const enabled = profile?.role === "student" && !!resourceId;
  const session = useMemo(() => (enabled ? new VideoWatchSession(resourceId, title) : null), [enabled, resourceId, title]);
  useEffect(() => {
    if (!session) return;
    const onHide = () => { if (document.visibilityState === "hidden") { session.pause(); session.close(); } };
    document.addEventListener("visibilitychange", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); session.close(); };
  }, [session]);
  return session;
}

interface TrackedVideoProps {
  src: string;
  /** Stable id of the video (e.g. the marketplace listing id). Required for tracking. */
  resourceId: string;
  title?: string;
  className?: string;
}

export function TrackedVideo({ src, resourceId, title, className }: TrackedVideoProps) {
  const session = useSession(resourceId, title);
  const ref = useRef<HTMLVideoElement>(null);

  const sync = (playing?: boolean) => {
    const v = ref.current;
    if (!v || !session) return;
    if (Number.isFinite(v.duration)) session.setDuration(v.duration);
    const isPlaying = playing ?? (!v.paused && !v.ended && !v.seeking && document.visibilityState === "visible");
    session.time(v.currentTime, isPlaying, Date.now(), v.playbackRate);
  };

  return (
    <video
      ref={ref}
      src={src}
      controls
      className={className}
      onLoadedMetadata={() => sync(false)}
      onPlay={() => sync()}
      onTimeUpdate={() => sync()}
      onSeeking={() => session?.acc.breakRun()}
      onPause={() => { sync(false); session?.pause(); }}
      onEnded={() => { sync(false); session?.end(); }}
    />
  );
}

interface TrackedYouTubeProps { videoId: string; resourceId: string; title?: string; className?: string }

/**
 * YouTube without loading Google's script (the app's CSP does not allow it): with `enablejsapi=1` the embedded
 * player answers a `listening` handshake over postMessage with its state, position and duration.
 */
export function TrackedYouTube({ videoId, resourceId, title, className }: TrackedYouTubeProps) {
  const session = useSession(resourceId, title);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!session) return;
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== frame.current?.contentWindow || typeof ev.data !== "string") return;
      if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(ev.origin)) return;
      let msg: { event?: string; info?: { currentTime?: number; duration?: number; playerState?: number } };
      try { msg = JSON.parse(ev.data); } catch { return; }
      const info = msg.info;
      if (!info) return;
      if (typeof info.duration === "number") session.setDuration(info.duration);
      if (typeof info.playerState === "number") {
        if (info.playerState === 0) { session.end(); return; }          // ended
        if (info.playerState !== 1) { session.pause(); return; }        // paused / buffering / cued
      }
      if (typeof info.currentTime === "number" && info.playerState === 1) {
        session.time(info.currentTime, document.visibilityState === "visible");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [session]);

  const handshake = () => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
  };

  return (
    <iframe
      ref={frame}
      src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
      title={title ?? "Video"}
      className={className}
      onLoad={handshake}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  );
}
