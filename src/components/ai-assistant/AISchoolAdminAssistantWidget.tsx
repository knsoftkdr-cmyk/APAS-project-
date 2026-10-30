import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, X, Send, Mic, MicOff } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { SpeechRecognition } from "@capgo/capacitor-speech-recognition";
import robotAvatar from "@/assets/ai-assistant-robot.png";
import { useLipSync, estimateSpeechDurationMs } from "@/hooks/useLipSync";
import { RobotFace } from "@/components/ai-assistant/RobotFace";
import { cleanForSpeech } from "@/lib/speechText";
import { speakChunked } from "@/lib/speakChunked";
import { resolveSchoolAdminNavigation, getSchoolAdminDestinations, type NavResolution, type SchoolAdminDestination } from "@/lib/schoolAdminNavigation";
import { createNavHandoff, once } from "@/lib/navHandoff";
import { isSafeRoute } from "@/lib/commandBar";

const isNativePlatform = Capacitor.isNativePlatform();

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

type VoiceState = "idle" | "listening" | "thinking" | "speaking";

// When the assistant itself navigates the next page re-creates this widget; this parks the chat for a few seconds so the
// confirmation and conversation carry over. Tied to the destination path (see src/lib/navHandoff.ts).
const navHandoff = createNavHandoff<{ messages: ChatMessage[]; open: boolean }>();

function VoiceWaveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="2.5" y="9" width="2.2" height="6" rx="1.1" fill="currentColor" />
      <rect x="7.2" y="5" width="2.2" height="14" rx="1.1" fill="currentColor" />
      <rect x="11.9" y="2" width="2.2" height="20" rx="1.1" fill="currentColor" />
      <rect x="16.6" y="5" width="2.2" height="14" rx="1.1" fill="currentColor" />
      <rect x="21.3" y="9" width="2.2" height="6" rx="1.1" fill="currentColor" />
    </svg>
  );
}

// Rejects with a timeout error if the wrapped promise takes too long -
// prevents the widget from being stuck on "Thinking..." forever if the
// backend AI call hangs.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// ---------------------------------------------------------------------
// ANSWERING LOGIC
// ---------------------------------------------------------------------
// Backed by the `school-admin-assistant` Supabase edge function, which
// verifies the caller's JWT, requires role "school_admin", and scopes
// every query to that admin's own school.
// See supabase/functions/school-admin-assistant/index.ts.
async function getAssistantReply(userText: string, recentHistory: ChatMessage[]): Promise<string> {
  const { data, error } = await supabase.functions.invoke("school-admin-assistant", {
    body: {
      message: userText,
      history: recentHistory.slice(-6).map((m) => ({ role: m.role, text: m.text })),
    },
  });
  if (error) throw error;
  return data?.text || "I couldn't come up with an answer just now - please try again.";
}
// ---------------------------------------------------------------------

export function AISchoolAdminAssistantWidget() {
  const { profile } = useAuth();
  const isSchoolAdmin = profile?.role === "school_admin";
  // The same per-school permission check the sidebar uses, so the assistant only opens pages this school admin can see in their menu.
  const { can, loading: permsLoading } = usePermissions();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const here = location.pathname + location.search;
  const [open, setOpen] = useState(() => navHandoff.peek(here)?.open ?? false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => navHandoff.peek(here)?.messages ?? []);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  // Options from the last "which one do you mean?", so a short reply ("the second one", "yes") can be answered.
  const pendingNavRef = useRef<SchoolAdminDestination[] | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const recognitionRef = useRef<any>(null);

  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");

  // Speech-synced mouth animation (real timing schedule + boundary
  // re-anchoring for the web voice, estimated timing for native TTS).
  // See src/hooks/useLipSync.ts.
  const lipSync = useLipSync();

  const [voiceError, setVoiceError] = useState<string | null>(null);
  const ttsSupported = isNativePlatform || (typeof window !== "undefined" && "speechSynthesis" in window);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Speech-recognition callbacks are wired up once (effect deps: []) but
  // call sendMessageWithText, which is declared later in this component
  // and recreated every render. Calling it through a ref (set right after
  // its declaration, below) means those callbacks never depend on
  // closure/declaration order.
  const sendMessageWithTextRef = useRef<(overrideText?: string) => void>(() => {});
  const voiceRequestInFlightRef = useRef(false);
  const listeningInProgressRef = useRef(false);
  // Incremented on every speak() call - see speak() for why.
  const speechGenerationRef = useRef(0);
  const updateVoiceMode = (v: boolean) => {
    voiceModeRef.current = v;
    setVoiceMode(v);
  };

  const handleVoiceTranscript = (transcript: string) => {
    const text = transcript.trim();
    if (!text) return;

    // Ignore duplicate recognition results firing close together.
    if (voiceRequestInFlightRef.current) return;
    // Ignore stray results if voice mode was exited in the meantime.
    if (!voiceModeRef.current) return;

    // Lock immediately - this is a ref, so it takes effect synchronously,
    // unlike React state which could let a second transcript slip through.
    voiceRequestInFlightRef.current = true;

    setInput(text);
    setVoiceState("thinking");
    setVoiceError(null);
    sendMessageWithTextRef.current(text);
  };

  // Builds a brand-new SpeechRecognition instance for a single listen turn.
  // We deliberately do NOT reuse one long-lived instance across turns:
  // calling .start() repeatedly on the same instance can leave old
  // recognition results/session state around in some browsers, which
  // causes transcripts to accumulate across turns. A fresh instance per
  // turn guarantees a clean session.
  const createRecognition = () => {
    const BrowserSpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!BrowserSpeechRecognition) return null;

    const recognition = new BrowserSpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    // Some browsers fire onresult more than once for a single utterance
    // (e.g. once per detected phrase/pause) even with continuous=false.
    // Reacting to - and stopping on - the FIRST onresult was cutting
    // sentences short. Instead we accumulate every result this session
    // reports, and only act once on the session's natural end (onend).
    let consumed = false;
    let latestTranscript = "";

    recognition.onresult = (event: any) => {
      let combined = "";
      for (let i = 0; i < event.results.length; i++) {
        combined += event.results[i][0]?.transcript ?? "";
      }
      latestTranscript = combined.trim();
    };

    recognition.onerror = (event: any) => {
      if (consumed) return;
      consumed = true;
      listeningInProgressRef.current = false;
      setIsListening(false);
      if (event.error === "aborted") return;

      if (voiceModeRef.current && event.error === "no-speech") {
        setTimeout(() => startListeningSafely(), 400);
        return;
      }

      const messagesMap: Record<string, string> = {
        "no-speech": "No speech detected. Please try again.",
        "not-allowed": "Microphone access was denied. Check the site permissions (padlock icon in the address bar) and allow microphone access.",
        "audio-capture": "No microphone found. Please check your microphone is connected.",
        "network": "Voice recognition needs an internet connection. Please check your connection and try again.",
      };
      const msg = messagesMap[event.error] || `Could not hear you clearly (${event.error}). Please try again or type instead.`;
      if (voiceModeRef.current) {
        setVoiceError(msg);
        setVoiceState("idle");
      } else {
        toast({ title: "Voice input error", description: msg, variant: "destructive" });
      }
    };

    recognition.onend = () => {
      if (consumed) return;
      consumed = true;
      listeningInProgressRef.current = false;
      setIsListening(false);
      if (latestTranscript) {
        handleVoiceTranscript(latestTranscript);
      }
    };

    return recognition;
  };

  useEffect(() => {
    if (isNativePlatform) {
      let cancelled = false;
      SpeechRecognition.available()
        .then(({ available }: { available: boolean }) => {
          if (!cancelled && !available) setVoiceSupported(false);
        })
        .catch(() => {
          if (!cancelled) setVoiceSupported(false);
        });
      return () => { cancelled = true; };
    }

    const BrowserSpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!BrowserSpeechRecognition) {
      setVoiceSupported(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startListeningSafely = () => {
    if (!voiceModeRef.current) return;
    if (voiceRequestInFlightRef.current) return;
    if (listeningInProgressRef.current) return;
    listeningInProgressRef.current = true;

    if (isNativePlatform) {
      setVoiceState("listening");
      setVoiceError(null);
      setIsListening(true);

      SpeechRecognition.forceStop({ timeout: 800 }).catch(() => {}).finally(() => {
        setTimeout(() => {
          SpeechRecognition.requestPermissions()
            .then(() =>
              SpeechRecognition.start({
                language: "en-US",
                maxResults: 1,
                partialResults: false,
                popup: false,
              })
            )
            .then((result: { matches?: string[] }) => {
              listeningInProgressRef.current = false;
              setIsListening(false);
              const transcript = result?.matches?.[0]?.trim();
              if (!transcript) {
                const msg = "No speech detected. Please try again.";
                if (voiceModeRef.current) {
                  setVoiceError(msg);
                  setVoiceState("idle");
                } else {
                  toast({ title: "Voice input error", description: msg, variant: "destructive" });
                }
                return;
              }
              handleVoiceTranscript(transcript);
            })
            .catch((err: any) => {
              listeningInProgressRef.current = false;
              setIsListening(false);
              const msg = "Could not hear you clearly. Please try again or type instead.";
              if (voiceModeRef.current) {
                setVoiceError(msg);
                setVoiceState("idle");
              } else {
                toast({ title: "Voice input error", description: msg, variant: "destructive" });
              }
            });
        }, 300);
      });
      return;
    }

    // Web: abort any leftover instance, then start a brand-new one so this
    // turn's transcript can never inherit words from a previous turn.
    try { recognitionRef.current?.abort(); } catch {}
    const recognition = createRecognition();
    if (!recognition) {
      listeningInProgressRef.current = false;
      return;
    }
    recognitionRef.current = recognition;
    try {
      setInput("");
      setVoiceState("listening");
      setVoiceError(null);
      setIsListening(true);
      recognition.start();
    } catch (err) {
      listeningInProgressRef.current = false;
      setIsListening(false);
    }
  };

  const toggleListening = () => {
    if (isNativePlatform) {
      if (isListening) {
        SpeechRecognition.stop().catch(() => {});
        setIsListening(false);
      } else {
        startListeningSafely();
      }
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    try { recognitionRef.current?.abort(); } catch {}
    const recognition = createRecognition();
    if (!recognition) return;
    recognitionRef.current = recognition;
    setInput("");
    setIsListening(true);
    recognition.start();
  };

  // `onFinished` (optional) replaces the default "start listening again" once the speech has ended or could not run -
  // navigation uses it to move to the page AFTER the confirmation has been spoken.
  const speak = (text: string, onFinished?: () => void) => {
    text = cleanForSpeech(text); // never read * # _ etc. aloud
    // Every call to speak() gets its own generation id, so only the
    // LATEST call is allowed to actually speak or react to its
    // utterance events - avoids competing/duplicate utterances.
    const myGeneration = ++speechGenerationRef.current;

    if (!ttsSupported || !voiceModeRef.current) {
      if (onFinished) onFinished();
      else if (voiceModeRef.current) startListeningSafely();
      return;
    }

    if (isNativePlatform) {
      setVoiceState("speaking");
      const estimatedMs = Math.max(1200, text.split(/\s+/).length * 380);
      lipSync.start(text, estimatedMs);
      let nativeDone = false;
      const finishNative = () => {
        if (nativeDone) return;
        nativeDone = true;
        if (speechGenerationRef.current !== myGeneration) return; // superseded
        lipSync.stop();
        if (onFinished) { onFinished(); return; }
        // short delay so the speaker tail isn't picked up as the next question
        setTimeout(() => {
          if (speechGenerationRef.current === myGeneration && voiceModeRef.current) startListeningSafely();
        }, 350);
      };
      TextToSpeech.speak({
        text,
        lang: "en-US",
        rate: 1,
        pitch: 1,
        volume: 1,
        category: "playback",
      }).then(() => finishNative()).catch(() => finishNative());
      // Fallback only if the plugin never resolves - generous so long answers aren't cut off.
      setTimeout(finishNative, Math.round(estimatedMs * 1.8) + 4000);
      return;
    }

    const doSpeak = () => {
      if (speechGenerationRef.current !== myGeneration) return; // superseded - don't speak stale text
      // Speak in short chunks so long answers are never cut off, and only open the
      // mic after the LAST chunk has really finished (see src/lib/speakChunked.ts).
      speakChunked(text, {
        voice: null,
        rate: 1,
        pitch: 1,
        isCurrent: () => speechGenerationRef.current === myGeneration,
        onUtterance: (u) => { utteranceRef.current = u; },
        onStart: () => {
          setVoiceState("speaking");
          lipSync.start(text, estimateSpeechDurationMs(text));
        },
        onBoundary: (charIndex) => lipSync.reanchor(charIndex, text.length),
        onDone: () => {
          lipSync.stop();
          if (onFinished) onFinished();
          else if (voiceModeRef.current) startListeningSafely();
        },
        onFail: () => {
          lipSync.stop();
          if (onFinished) onFinished();
          else if (voiceModeRef.current) startListeningSafely();
        },
      });
    };

    window.speechSynthesis.cancel();
    setTimeout(doSpeak, 80);
  };

  const enterVoiceMode = () => {
    if (!voiceSupported) {
      toast({ title: "Voice not supported", description: "Your browser doesn't support voice input.", variant: "destructive" });
      return;
    }
    setOpen(true);
    setVoiceError(null);
    updateVoiceMode(true);
    setTimeout(() => startListeningSafely(), 200);
  };

  const exitVoiceMode = () => {
    updateVoiceMode(false);
    setVoiceState("idle");
    setVoiceError(null);
    lipSync.stop();
    if (isNativePlatform) {
      TextToSpeech.stop().catch(() => {});
      if (isListening) SpeechRecognition.stop().catch(() => {});
    } else {
      window.speechSynthesis?.cancel();
      if (recognitionRef.current && isListening) {
        recognitionRef.current.stop();
      }
    }
    utteranceRef.current = null;
    setIsListening(false);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // While a navigation hand-off is live, keep it in step with the conversation (the destination page may re-create this widget more than once).
  useEffect(() => {
    navHandoff.sync(here, { messages, open });
  }, [messages, open, here]);

  if (!isSchoolAdmin) return null;

  const say = (text: string) => {
    setMessages((prev) => [...prev, { role: "assistant", text }]);
    if (voiceModeRef.current) speak(text);
  };

  // ---------------------------------------------------------------------
  // NAVIGATION ("Open admissions", "Take me to ...")
  // Resolved on the device from the sidebar's own menu (src/lib/schoolAdminNavigation.ts): no AI call, same for voice and
  // typing, and it can only reach pages in THIS school admin's sidebar. Anything that isn't a "go there" request - including
  // every data question - falls through to the existing assistant below, unchanged.
  // ---------------------------------------------------------------------
  const goTo = (dest: SchoolAdminDestination) => {
    if (!isSafeRoute(dest.path)) return; // defence in depth: only ever an in-app path
    // The chat card covers almost the whole screen below the `sm` breakpoint, so on phones collapse it to reveal the page.
    const keepOpen = typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
    navHandoff.start(dest.path, { messages: messagesRef.current, open: keepOpen });
    // The full-screen voice overlay would hide the page we are navigating to.
    if (voiceModeRef.current) exitVoiceMode();
    setOpen(keepOpen);
    navigate(dest.path);
  };

  const handleNavigation = (nav: Exclude<NavResolution, { kind: "none" }>, userText: string) => {
    voiceRequestInFlightRef.current = false; // nothing is "in flight" - this never leaves the device
    pendingNavRef.current = nav.kind === "clarify" ? nav.options : null;
    if (nav.kind !== "navigate") {
      say(nav.reply); // already-there / which-one / not available / not found - spoken, then the mic re-opens in voice mode
      return;
    }
    const dest = nav.destination;
    const finish = once(() => goTo(dest));
    // When typing, goTo runs in this same tick, before React re-renders - so put this exchange into the ref the hand-off reads.
    messagesRef.current = [...messagesRef.current, { role: "user", text: userText }, { role: "assistant", text: nav.reply }];
    setMessages((prev) => [...prev, { role: "assistant", text: nav.reply }]);
    if (voiceModeRef.current) {
      speak(nav.reply, finish); // say the confirmation first, then move
      setTimeout(finish, 4000); // never leave the user waiting if speech doesn't report back
    } else {
      finish();
    }
  };

  const sendMessageWithText = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);

    // Navigation first: a clear "go there" request opens the page; everything else is a question for the assistant.
    let nav: NavResolution = { kind: "none" };
    try {
      nav = resolveSchoolAdminNavigation(text, {
        currentPath: here,
        pending: pendingNavRef.current,
        // The sidebar's own per-school permission check; while it is still loading, the role-only list.
        destinations: getSchoolAdminDestinations(permsLoading ? undefined : can),
      });
    } catch {
      // A resolver problem must never break chat: treat it as a normal message.
    }
    pendingNavRef.current = null;
    if (nav.kind !== "none") {
      handleNavigation(nav, text);
      return;
    }

    setLoading(true);
    if (voiceModeRef.current) { setVoiceState("thinking"); setVoiceError(null); }
    try {
      const reply = await withTimeout(getAssistantReply(text, messages), 20000, "AI assistant");
      say(reply);
    } catch (e: any) {
      const friendly = e?.message?.includes("timed out")
        ? "That took too long to respond. Let's try again."
        : (e?.message || "Something went wrong. Please try again.");
      if (voiceModeRef.current) setVoiceError(friendly);
      toast({ title: "AI Assistant error", description: friendly, variant: "destructive" });
      say(friendly);
    } finally {
      setLoading(false);
      voiceRequestInFlightRef.current = false;
    }
  };
  sendMessageWithTextRef.current = sendMessageWithText;

  const orbStateLabel: Record<VoiceState, string> = {
    idle: "Starting...",
    listening: "Listening...",
    thinking: "Thinking...",
    speaking: "Speaking...",
  };

  // Soft glow behind the avatar, colored/animated per voice state.
  const orbClasses: Record<VoiceState, string> = {
    idle: "from-amber-400 via-orange-400 to-yellow-400 animate-pulse",
    listening: "from-amber-400 via-yellow-300 to-orange-400 animate-pulse",
    thinking: "from-orange-500 via-amber-400 to-yellow-500 animate-spin",
    speaking: "from-yellow-300 via-amber-200 to-orange-300 animate-pulse",
  };

  if (typeof document === "undefined") return null;
  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-amber-600 text-white shadow-lg hover:bg-amber-700 transition-colors"
          aria-label="Open School Admin Assistant"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {open && voiceMode && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center voice-overlay-bg">
          <button
            onClick={exitVoiceMode}
            className="absolute top-6 right-6 flex h-10 w-10 items-center justify-center rounded-full voice-overlay-btn"
            aria-label="Exit voice mode"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="relative flex h-56 w-56 items-center justify-center">
            <div
              className={`absolute inset-0 rounded-full bg-gradient-to-br blur-2xl ${orbClasses[voiceState]}`}
              style={{
                opacity: voiceState === "speaking" ? 0.55 + lipSync.intensity * 0.4 : 0.7,
                transition: "opacity 90ms ease-out",
              }}
            />

            {voiceState === "listening" && (
              <div className="absolute inset-1 rounded-full border-2 border-yellow-300/60 animate-pulse" />
            )}
            {voiceState === "thinking" && (
              <div className="absolute inset-1 rounded-full border-2 border-t-transparent border-amber-300/70 animate-spin" />
            )}
            {voiceState === "speaking" && (
              <div
                className="absolute inset-0 rounded-full border-2 border-orange-300/60"
                style={{
                  transform: `scale(${1 + lipSync.intensity * 0.06})`,
                  opacity: 0.5 + lipSync.intensity * 0.4,
                  transition: "transform 90ms ease-out, opacity 90ms ease-out",
                }}
              />
            )}

            <div
              className="relative h-48 w-48 overflow-hidden rounded-full bg-white shadow-2xl ring-4 ring-white shadow-indigo-200/60"
              style={{
                transform:
                  voiceState === "speaking"
                    ? `scale(${1.015 + lipSync.intensity * 0.02}) translateY(${-lipSync.intensity * 2}px)`
                    : "scale(1)",
                transition: "transform 90ms ease-out",
              }}
            >
              <RobotFace
                src={robotAvatar}
                viseme={lipSync.viseme}
                intensity={lipSync.intensity}
                active={voiceState === "speaking"}
              />
            </div>
          </div>

          <p className="mt-8 text-sm tracking-wide text-slate-950 font-semibold">{orbStateLabel[voiceState]}</p>

          {voiceError && (
            <p className="mt-4 max-w-md px-6 text-center text-sm font-semibold text-red-700">
              {voiceError}
            </p>
          )}

          {!voiceError && messages.length > 0 && (
            <p className="mt-4 max-w-md px-6 text-center text-sm text-slate-800">
              {messages[messages.length - 1].text}
            </p>
          )}

          <button
            onClick={() => startListeningSafely()}
            className="mt-6 rounded-full px-5 py-2 text-xs font-semibold voice-overlay-btn"
          >
            Tap to retry listening
          </button>

          <button
            onClick={exitVoiceMode}
            className="mt-3 rounded-full px-5 py-2 text-xs font-semibold voice-overlay-btn"
          >
            Switch to typing
          </button>
        </div>
      )}

      {open && !voiceMode && (
        <Card className="fixed inset-x-3 top-16 bottom-3 z-50 flex flex-col shadow-2xl sm:inset-x-auto sm:top-auto sm:bottom-5 sm:right-5 sm:h-[520px] sm:w-[360px]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-amber-600" /> APAS Agent
            </CardTitle>
            <div className="flex items-center gap-2">
              {voiceSupported && ttsSupported && (
                <button
                  onClick={enterVoiceMode}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-600 text-white shadow hover:bg-amber-700 transition-colors shrink-0"
                  aria-label="Start voice conversation"
                  title="Start voice conversation"
                >
                  <VoiceWaveIcon className="h-4 w-4" />
                </button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
            <ScrollArea className="min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block" ref={scrollRef}>
              <div className="flex flex-col gap-3 pr-2">
                {messages.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Hi! I'm your School Admin Assistant. Ask me anything, or tap the amber icon above for hands-free voice mode.
                  </p>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] min-w-0 break-words rounded-lg px-3 py-2 text-xs ${m.role === "user" ? "bg-amber-600 text-white" : "bg-muted"}`}>
                      <p>{m.text}</p>
                    </div>
                  </div>
                ))}
                {loading && <p className="text-xs text-muted-foreground">Thinking...</p>}
              </div>
            </ScrollArea>

            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessageWithText()}
                placeholder={isListening ? "Listening..." : "Ask me anything..."}
                className="h-9 text-xs"
                disabled={loading || isListening}
              />
              {voiceSupported && (
                <Button
                  size="icon"
                  variant={isListening ? "destructive" : "outline"}
                  className="h-9 w-9 shrink-0"
                  onClick={toggleListening}
                  disabled={loading}
                  aria-label={isListening ? "Stop listening" : "Speak your request"}
                >
                  {isListening ? <MicOff className="h-4 w-4 animate-pulse" /> : <Mic className="h-4 w-4" />}
                </Button>
              )}
              <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => sendMessageWithText()} disabled={loading}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}