// The student's Interactive Video Player: the existing Marketplace video (uploaded file or YouTube link) with
//   * teacher questions that pause the video at their timestamp, with instant feedback,
//   * optional "no seeking ahead" / "no skipping questions" rules set by the teacher,
//   * resume from where the student stopped,
//   * real watch-time + completion tracking (same WatchAccumulator the Engagement Score telemetry uses),
//   * a doubt panel in the same screen.
// If the interactive service is unavailable the plain tracked player is shown instead, so playback never breaks.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronUp, Lock, MessageCircleQuestion, PlayCircle, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TrackedVideo, TrackedYouTube } from "@/components/video/TrackedVideo";
import { VideoDoubtPanel } from "@/components/video/VideoDoubtPanel";
import { WatchAccumulator } from "@/lib/videoWatchTracker";
import {
  answerVideoQuestion, fetchVideoConfig, formatTimestamp, saveVideoProgress,
  type AnswerResult, type PlayerConfig, type PlayerQuestion,
} from "@/lib/interactiveVideo";

interface Adapter { pause(): void; play(): void; seek(t: number): void; time(): number }

interface PlayerProps {
  listingId: string;
  title: string;
  /** Uploaded file / direct link. Ignored when `youTubeId` is set. */
  src?: string | null;
  youTubeId?: string | null;
}

const SAVE_EVERY_MS = 15_000;
const NATURAL_STEP = 2.5;   // a playhead move bigger than this (seconds) is a seek, not playback

/** The video plus everything interactive. Students only: callers should use <VideoLearningDialog>. */
export function InteractiveVideoPlayer({ listingId, title, src, youTubeId }: PlayerProps) {
  const cfgQ = useQuery({
    queryKey: ["video-config", listingId], queryFn: () => fetchVideoConfig<PlayerConfig>(listingId),
    staleTime: 0, gcTime: 0, retry: 1, refetchOnWindowFocus: false, refetchOnMount: "always",
  });

  if (cfgQ.isLoading) return <Skeleton className="aspect-video w-full rounded-xl" />;
  // Migration not applied / service down: keep the old, plain tracked player.
  if (cfgQ.isError || !cfgQ.data || cfgQ.data.persistence === "unavailable" || !cfgQ.data.settings) {
    return youTubeId
      ? <TrackedYouTube videoId={youTubeId} resourceId={listingId} title={title} className="aspect-video w-full rounded-xl" />
      : src ? <TrackedVideo src={src} resourceId={listingId} title={title} className="w-full rounded-xl" /> : null;
  }
  return <PlayerInner cfg={cfgQ.data} listingId={listingId} title={title} src={src} youTubeId={youTubeId} />;
}

function PlayerInner({ cfg, listingId, title, src, youTubeId }: PlayerProps & { cfg: PlayerConfig }) {
  const { settings } = cfg;
  const questions = useMemo(() => [...cfg.questions].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds), [cfg.questions]);

  // ── state ─────────────────────────────────────────────────────────────────────────────────────
  const [resolved, setResolved] = useState<Set<string>>(() => new Set(cfg.answered.map((a) => a.question_id)));
  const [correctIds, setCorrectIds] = useState<Set<string>>(() => new Set(cfg.answered.filter((a) => a.is_correct).map((a) => a.question_id)));
  const [active, setActive] = useState<PlayerQuestion | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [failedOnce, setFailedOnce] = useState(false);
  const [duration, setDuration] = useState(cfg.progress?.duration_seconds ?? 0);
  const [pct, setPct] = useState(cfg.progress?.completion_pct ?? 0);
  const [completed, setCompleted] = useState(cfg.progress?.completed ?? false);
  const [notice, setNotice] = useState<string | null>(cfg.resume_at > 0 ? `Resumed from ${formatTimestamp(cfg.resume_at)}` : null);
  const [showDoubts, setShowDoubts] = useState(false);

  // ── refs (the player callbacks run outside React's render cycle) ──────────────────────────────
  const acc = useMemo(() => { const a = new WatchAccumulator(); a.seed(cfg.progress?.watched_ranges); if (cfg.progress?.duration_seconds) a.setDuration(cfg.progress.duration_seconds); return a; }, [cfg.progress]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const yt = useRef({ time: cfg.resume_at, state: -1, duration: 0 });
  const lastRef = useRef<number | null>(null);
  const furthestRef = useRef(Math.max(cfg.progress?.furthest_seconds ?? 0, cfg.resume_at));
  const resolvedRef = useRef(resolved); resolvedRef.current = resolved;
  const activeRef = useRef<PlayerQuestion | null>(null); activeRef.current = active;
  const shownAt = useRef(0);
  const lastSave = useRef(0);
  const lastSaved = useRef({ watched: cfg.progress?.watched_seconds ?? 0, pos: cfg.progress?.last_position_seconds ?? 0 });
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);
  useEffect(() => { if (cfg.resume_at > 0) { noticeTimer.current = setTimeout(() => setNotice(null), 5000); } return () => clearTimeout(noticeTimer.current); }, [cfg.resume_at]);

  // ── adapter: one interface over the <video> element and the YouTube iframe ────────────────────
  const ytCommand = (func: string, args: unknown[] = []) =>
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "https://www.youtube.com");
  const adapter: Adapter = useMemo(() => youTubeId ? {
    pause: () => ytCommand("pauseVideo"),
    play: () => ytCommand("playVideo"),
    seek: (t) => { yt.current.time = t; ytCommand("seekTo", [t, true]); },
    time: () => yt.current.time,
  } : {
    pause: () => videoRef.current?.pause(),
    play: () => { void videoRef.current?.play().catch(() => undefined); },
    seek: (t) => { if (videoRef.current) videoRef.current.currentTime = t; },
    time: () => videoRef.current?.currentTime ?? 0,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youTubeId]);

  const programmaticSeek = useCallback((t: number) => { lastRef.current = t; acc.breakRun(); adapter.seek(t); }, [acc, adapter]);

  // ── saving progress (resume position, unique watched seconds, completion) ─────────────────────
  const save = useCallback((force: boolean) => {
    const dur = acc.getDuration();
    if (dur <= 0) return;
    const now = Date.now();
    if (!force && now - lastSave.current < SAVE_EVERY_MS) return;
    const pos = adapter.time();
    if (acc.watched() === lastSaved.current.watched && Math.abs(pos - lastSaved.current.pos) < 1) return;
    lastSave.current = now;
    lastSaved.current = { watched: acc.watched(), pos };
    saveVideoProgress({ listingId, position: pos, furthest: furthestRef.current, duration: dur, ranges: acc.ranges() })
      .then((r) => { setPct(r.completion_pct); setCompleted(r.completed); })
      .catch(() => { lastSaved.current = { watched: -1, pos: -1 }; });   // try again at the next save
  }, [acc, adapter, listingId]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") { acc.breakRun(); save(true); } };
    document.addEventListener("visibilitychange", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); save(true); };
  }, [acc, save]);

  // ── the heart of it: every playhead update ────────────────────────────────────────────────────
  const openQuestion = useCallback((q: PlayerQuestion) => {
    adapter.pause();
    acc.breakRun();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);   // the overlay must be visible
    shownAt.current = Date.now();
    setSelected(null); setResult(null); setAnswerError(null); setFailedOnce(false);
    setActive(q);
    save(true);
  }, [acc, adapter, save]);

  const onTick = useCallback((t: number, playing: boolean, dur: number, rate = 1) => {
    if (dur > 0 && Math.abs(dur - acc.getDuration()) > 0.5) { acc.setDuration(dur); setDuration(dur); }
    const prev = lastRef.current;
    const jump = prev === null ? 0 : t - prev;
    const seekedForward = prev !== null && jump > NATURAL_STEP;
    const pending = questions.filter((q) => !resolvedRef.current.has(q.id));

    // A question is open: the video stays paused until it is dealt with.
    if (activeRef.current) { if (playing) adapter.pause(); lastRef.current = t; return; }

    if (seekedForward && !settings.allow_video_skip && t > furthestRef.current + 1.5) {
      programmaticSeek(furthestRef.current);
      flash("Skipping ahead is turned off for this video");
      return;
    }
    if (seekedForward && !settings.allow_question_skip) {
      const missed = pending.find((q) => q.timestamp_seconds > (prev as number) && q.timestamp_seconds <= t);
      if (missed) { programmaticSeek(missed.timestamp_seconds); openQuestion(missed); return; }
    }

    const natural = playing && prev !== null && jump >= 0 && jump <= NATURAL_STEP;
    acc.tick(t, playing, Date.now(), rate);
    if (natural) {
      furthestRef.current = Math.max(furthestRef.current, t);
      const due = pending.find((q) => q.timestamp_seconds > (prev as number) && q.timestamp_seconds <= t);
      if (due) { lastRef.current = t; openQuestion(due); return; }
      save(false);
    }
    lastRef.current = t;
  }, [acc, adapter, flash, openQuestion, programmaticSeek, questions, save, settings.allow_question_skip, settings.allow_video_skip]);

  // YouTube: no Google script (the app's CSP forbids it); the embedded player reports over postMessage.
  useEffect(() => {
    if (!youTubeId) return;
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== frameRef.current?.contentWindow || typeof ev.data !== "string") return;
      if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(ev.origin)) return;
      let msg: { info?: { currentTime?: number; duration?: number; playerState?: number } };
      try { msg = JSON.parse(ev.data); } catch { return; }
      const info = msg.info; if (!info) return;
      if (typeof info.duration === "number" && info.duration > 0) yt.current.duration = info.duration;
      if (typeof info.currentTime === "number") yt.current.time = info.currentTime;
      if (typeof info.playerState === "number") {
        const was = yt.current.state; yt.current.state = info.playerState;
        if (info.playerState === 0) { acc.ended(); lastRef.current = null; save(true); return; }
        if (info.playerState !== 1 && was === 1) { acc.breakRun(); save(true); }
      }
      if (typeof info.currentTime === "number") onTick(yt.current.time, yt.current.state === 1 && document.visibilityState === "visible", yt.current.duration);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [youTubeId, onTick, acc, save]);

  // ── answering ─────────────────────────────────────────────────────────────────────────────────
  const finishQuestion = (q: PlayerQuestion, correct: boolean | null) => {
    setResolved((s) => new Set(s).add(q.id));
    if (correct) setCorrectIds((s) => new Set(s).add(q.id));
  };

  const submit = async () => {
    if (!active || selected === null || submitting) return;
    setSubmitting(true); setAnswerError(null);
    try {
      const r = await answerVideoQuestion(active.id, { selectedIndex: selected, timeToAnswerMs: Date.now() - shownAt.current });
      setResult(r);
      finishQuestion(active, r.is_correct);
    } catch (e) {
      setAnswerError(e instanceof Error ? e.message : "Couldn't save your answer. Please try again.");
      setFailedOnce(true);
    } finally { setSubmitting(false); }
  };

  const skip = async () => {
    if (!active || submitting) return;
    setSubmitting(true); setAnswerError(null);
    try {
      await answerVideoQuestion(active.id, { skipped: true, timeToAnswerMs: Date.now() - shownAt.current });
      finishQuestion(active, null);
      closeAndPlay();
    } catch (e) {
      setAnswerError(e instanceof Error ? e.message : "Couldn't skip. Please try again.");
      setFailedOnce(true);
    } finally { setSubmitting(false); }
  };

  const closeAndPlay = () => {
    const q = activeRef.current;
    if (q) { lastRef.current = Math.max(adapter.time(), q.timestamp_seconds); }
    setActive(null); setResult(null); setSelected(null);
    adapter.play();
  };

  /** Network failure and the teacher allows continuing: never trap a student behind a question they cannot submit. */
  const continueUnsaved = () => { if (active) setResolved((s) => new Set(s).add(active.id)); closeAndPlay(); };

  const rewatch = () => {
    const q = activeRef.current;
    closeAndPlay();
    if (q) programmaticSeek(Math.max(0, q.timestamp_seconds - 20));
  };

  // ── render ────────────────────────────────────────────────────────────────────────────────────
  const totalQ = questions.length;
  const answeredQ = questions.filter((q) => resolved.has(q.id)).length;
  const correctQ = questions.filter((q) => correctIds.has(q.id)).length;
  const startAt = cfg.resume_at;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-3">
        <div className={cn("relative w-full overflow-hidden rounded-xl bg-black aspect-video", active && "min-h-[26rem] sm:min-h-0")}>
          {youTubeId ? (
            <iframe
              ref={frameRef}
              src={`https://www.youtube.com/embed/${youTubeId}?enablejsapi=1&rel=0${startAt > 0 ? `&start=${Math.floor(startAt)}` : ""}&origin=${encodeURIComponent(window.location.origin)}`}
              title={title}
              className="absolute inset-0 h-full w-full"
              onLoad={() => frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*")}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <video
              ref={videoRef}
              src={src ?? undefined}
              controls
              playsInline
              className="absolute inset-0 h-full w-full object-contain"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (Number.isFinite(v.duration) && v.duration > 0) { acc.setDuration(v.duration); setDuration(v.duration); }
                if (startAt > 0 && startAt < v.duration - 3) programmaticSeek(startAt);
              }}
              onTimeUpdate={(e) => { const v = e.currentTarget; onTick(v.currentTime, !v.paused && !v.ended && !v.seeking && document.visibilityState === "visible", v.duration, v.playbackRate); }}
              onPlay={(e) => { if (activeRef.current) e.currentTarget.pause(); }}
              onPause={() => { acc.breakRun(); save(true); }}
              onEnded={() => { acc.ended(); lastRef.current = null; save(true); }}
            />
          )}

          {notice && !active && (
            <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
              {notice.startsWith("Resumed") ? <PlayCircle className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}{notice}
            </div>
          )}

          {active && (
            <QuestionOverlay
              q={active} index={questions.findIndex((x) => x.id === active.id) + 1} total={totalQ}
              selected={selected} onSelect={setSelected} result={result} submitting={submitting} error={answerError}
              canSkip={settings.allow_question_skip && !result} canContinueUnsaved={failedOnce && !result}
              onSubmit={submit} onSkip={skip} onContinue={closeAndPlay} onRewatch={rewatch} onContinueUnsaved={continueUnsaved}
            />
          )}
        </div>

        <Timeline duration={duration} questions={questions} resolved={resolved} pct={pct} />

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Chip>{Math.round(pct)}% watched{completed ? " · completed" : ""}</Chip>
          {totalQ > 0 && <Chip>Questions {answeredQ}/{totalQ}{answeredQ > 0 ? ` · ${correctQ} correct` : ""}</Chip>}
          {!settings.allow_video_skip && <Chip tone="amber"><Lock className="me-1 inline h-3 w-3" />No skipping ahead</Chip>}
          {!settings.allow_question_skip && totalQ > 0 && <Chip tone="amber"><Lock className="me-1 inline h-3 w-3" />Questions required</Chip>}
          <Button type="button" size="sm" variant="outline" className="ms-auto h-8 rounded-full lg:hidden" onClick={() => setShowDoubts((v) => !v)}>
            <MessageCircleQuestion className="me-1 h-3.5 w-3.5" /> Ask a doubt {showDoubts ? <ChevronUp className="ms-1 h-3.5 w-3.5" /> : <ChevronDown className="ms-1 h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className={cn(showDoubts ? "block" : "hidden", "lg:block")}>
        <VideoDoubtPanel
          listingId={listingId}
          getTime={() => adapter.time()}
          onSeek={(t) => programmaticSeek(t)}
          onAsked={() => { acc.breakRun(); adapter.pause(); }}
        />
      </div>
    </div>
  );
}

function Chip({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "amber" }) {
  return <span className={cn("rounded-full border px-2.5 py-1", tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-blue-200 bg-blue-50 text-blue-800")}>{children}</span>;
}

/** Where the questions sit along the video, and how much of it has been watched. */
function Timeline({ duration, questions, resolved, pct }: { duration: number; questions: PlayerQuestion[]; resolved: Set<string>; pct: number }) {
  if (duration <= 0) return null;
  return (
    <div className="relative h-2 w-full rounded-full bg-slate-200" aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full bg-blue-400/70" style={{ width: `${Math.min(100, pct)}%` }} />
      {questions.map((q) => (
        <span
          key={q.id}
          title={`Question at ${formatTimestamp(q.timestamp_seconds)}`}
          className={cn("absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white", resolved.has(q.id) ? "bg-emerald-500" : "bg-amber-500")}
          style={{ left: `${Math.min(98, (q.timestamp_seconds / duration) * 100)}%` }}
        />
      ))}
    </div>
  );
}

interface OverlayProps {
  q: PlayerQuestion; index: number; total: number; selected: number | null; onSelect: (i: number) => void;
  result: AnswerResult | null; submitting: boolean; error: string | null; canSkip: boolean; canContinueUnsaved: boolean;
  onSubmit: () => void; onSkip: () => void; onContinue: () => void; onRewatch: () => void; onContinueUnsaved: () => void;
}

function QuestionOverlay(p: OverlayProps) {
  const { q, result } = p;
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-3 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-label="Video question">
      <div className="w-full max-w-xl space-y-3 rounded-2xl bg-white p-4 shadow-2xl sm:p-5">
        <div className="flex items-center justify-between text-[11px] font-medium text-blue-700">
          <span>Question {p.index} of {p.total}</span>
          <span className="rounded-full bg-blue-50 px-2 py-0.5">at {formatTimestamp(q.timestamp_seconds)}</span>
        </div>
        <p className="break-words text-base font-semibold text-slate-900">{q.question_text}</p>

        <div className="space-y-2" role="radiogroup" aria-label="Answer options">
          {q.options.map((opt, i) => {
            const isPicked = p.selected === i;
            const showCorrect = !!result && i === result.correct_index;
            const showWrong = !!result && isPicked && !result.is_correct;
            return (
              <button
                key={i} type="button" role="radio" aria-checked={isPicked} disabled={!!result || p.submitting}
                onClick={() => p.onSelect(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-start text-sm transition-colors",
                  !result && (isPicked ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"),
                  showCorrect && "border-emerald-500 bg-emerald-50",
                  showWrong && "border-red-400 bg-red-50",
                  result && !showCorrect && !showWrong && "border-slate-200 opacity-60",
                )}
              >
                <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", isPicked || showCorrect ? "border-transparent bg-blue-600 text-white" : "bg-white text-slate-600", showCorrect && "bg-emerald-600", showWrong && "bg-red-500")}>
                  {q.question_type === "true_false" ? opt[0] : String.fromCharCode(65 + i)}
                </span>
                <span className="min-w-0 flex-1 break-words">{opt}</span>
                {showCorrect && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
                {showWrong && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
              </button>
            );
          })}
        </div>

        {result && (
          <div className={cn("rounded-xl border p-3 text-sm", result.is_correct ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900")} aria-live="polite">
            <p className="font-semibold">{result.is_correct ? "Correct! Well done." : `Not quite. The right answer is ${q.options[result.correct_index]}.`}</p>
            {result.explanation && <p className="mt-1 text-[13px] leading-snug">{result.explanation}</p>}
          </div>
        )}

        {p.error && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700" aria-live="assertive">{p.error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {p.canSkip && <Button type="button" variant="ghost" size="sm" className="me-auto" disabled={p.submitting} onClick={p.onSkip}>Skip question</Button>}
          {p.canContinueUnsaved && <Button type="button" variant="ghost" size="sm" className="me-auto" onClick={p.onContinueUnsaved}>Continue anyway</Button>}
          {result ? (
            <>
              {!result.is_correct && <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={p.onRewatch}><RotateCcw className="me-1 h-3.5 w-3.5" />Rewatch this part</Button>}
              <Button type="button" size="sm" className="rounded-full bg-blue-600 hover:bg-blue-700" onClick={p.onContinue}>Continue video</Button>
            </>
          ) : (
            <Button type="button" size="sm" className="rounded-full bg-blue-600 hover:bg-blue-700" disabled={p.selected === null || p.submitting} onClick={p.onSubmit}>
              {p.submitting ? "Checking..." : "Check answer"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The student's video learning screen, opened from the existing Play button on a Marketplace video. */
export function VideoLearningDialog({ open, onOpenChange, ...player }: PlayerProps & { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[96vw] max-w-5xl overflow-y-auto p-3 sm:p-5">
        <DialogHeader>
          <DialogTitle className="pe-6 text-blue-950">{player.title}</DialogTitle>
          <DialogDescription className="sr-only">Watch the video, answer the questions that appear and ask doubts.</DialogDescription>
        </DialogHeader>
        {open && <InteractiveVideoPlayer {...player} />}
      </DialogContent>
    </Dialog>
  );
}
