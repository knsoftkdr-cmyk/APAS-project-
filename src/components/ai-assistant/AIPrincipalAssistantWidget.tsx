import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
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

const isNativePlatform = Capacitor.isNativePlatform();

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

type VoiceState = "idle" | "listening" | "thinking" | "speaking";

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
// Calls the `principal-assistant` Supabase edge function, which derives
// the caller's identity from their auth JWT server-side (never from
// anything passed here) and answers using ONLY that Principal's own
// school's data - Admin Panel, Reports, Communication, Syllabus
// Coverage, Surveys, Academic Calendar, Timetable, Attendance, Rotation
// Schedules, Admissions, SEN, Electives, Transport, Academic Tests,
// Safeguarding, Alerts, School Intelligence, Security Center, Semester
// Engine, Report Cards, Marketplace, Exam Seating, Hall Tickets, Houses,
// School Quality Index, Competency Heatmap, Competency Definitions,
// Branch Management, and Resource Analytics.
// See supabase/functions/principal-assistant/index.ts for the full
// implementation.
async function getAssistantReply(userText: string, recentHistory: ChatMessage[]): Promise<string> {
  const { data, error } = await supabase.functions.invoke("principal-assistant", {
    body: {
      message: userText,
      history: recentHistory.slice(-6).map((m) => ({ role: m.role, text: m.text })),
    },
  });
  if (error) throw error;
  return data?.text || "I couldn't come up with an answer just now - please try again.";
}
// ---------------------------------------------------------------------

export function AIPrincipalAssistantWidget() {
  const { profile } = useAuth();
  const isPrincipal = profile?.role === "principal";
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

  const speak = (text: string) => {
    // Every call to speak() gets its own generation id, so only the
    // LATEST call is allowed to actually speak or react to its
    // utterance events - avoids competing/duplicate utterances.
    const myGeneration = ++speechGenerationRef.current;

    if (!ttsSupported || !voiceModeRef.current) {
      if (voiceModeRef.current) startListeningSafely();
      return;
    }

    if (isNativePlatform) {
      setVoiceState("speaking");
      const estimatedMs = Math.max(1200, text.split(/\s+/).length * 380);
      lipSync.start(text, estimatedMs);
      TextToSpeech.speak({
        text,
        lang: "en-US",
        rate: 1,
        pitch: 1,
        volume: 1,
        category: "playback",
      }).catch(() => {});
      setTimeout(() => {
        if (speechGenerationRef.current !== myGeneration) return; // superseded
        lipSync.stop();
        if (voiceModeRef.current) startListeningSafely();
      }, estimatedMs);
      return;
    }

    const doSpeak = () => {
      if (speechGenerationRef.current !== myGeneration) return; // superseded - don't speak stale text
      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onstart = () => {
        if (speechGenerationRef.current !== myGeneration) return;
        setVoiceState("speaking");
        lipSync.start(text, estimateSpeechDurationMs(text));
      };
      utterance.onboundary = (event: SpeechSynthesisEvent) => {
        if (speechGenerationRef.current !== myGeneration) return;
        lipSync.reanchor(event.charIndex ?? 0, text.length);
      };
      utterance.onend = () => {
        if (speechGenerationRef.current !== myGeneration) return;
        utteranceRef.current = null;
        lipSync.stop();
        if (voiceModeRef.current) startListeningSafely();
      };
      utterance.onerror = (e: any) => {
        if (speechGenerationRef.current !== myGeneration) return;
        utteranceRef.current = null;
        lipSync.stop();
        if (e?.error === "interrupted" || e?.error === "canceled") return;
        if (voiceModeRef.current) startListeningSafely();
      };
      window.speechSynthesis.speak(utterance);
      setTimeout(() => {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      }, 60);
      // Safety net: if the browser never fires onstart/onend at all (silent
      // TTS failure), don't let the orb (or the mouth) sit stuck forever.
      setTimeout(() => {
        if (speechGenerationRef.current === myGeneration && utteranceRef.current === utterance && voiceModeRef.current) {
          utteranceRef.current = null;
          lipSync.stop();
          startListeningSafely();
        }
      }, 15000);
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

  if (!isPrincipal) return null;

  const say = (text: string) => {
    setMessages((prev) => [...prev, { role: "assistant", text }]);
    if (voiceModeRef.current) speak(text);
  };

  const sendMessageWithText = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
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
    idle: "from-sky-400 via-blue-400 to-cyan-400 animate-pulse",
    listening: "from-sky-400 via-cyan-300 to-blue-400 animate-pulse",
    thinking: "from-blue-500 via-sky-400 to-cyan-500 animate-spin",
    speaking: "from-cyan-300 via-sky-200 to-blue-300 animate-pulse",
  };

  if (typeof document === "undefined") return null;
  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-sky-600 text-white shadow-lg hover:bg-sky-700 transition-colors"
          aria-label="Open Principal Assistant"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {open && voiceMode && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black">
          <button
            onClick={exitVoiceMode}
            className="absolute top-6 right-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
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
              <div className="absolute inset-1 rounded-full border-2 border-cyan-300/60 animate-pulse" />
            )}
            {voiceState === "thinking" && (
              <div className="absolute inset-1 rounded-full border-2 border-t-transparent border-sky-300/70 animate-spin" />
            )}
            {voiceState === "speaking" && (
              <div
                className="absolute inset-0 rounded-full border-2 border-blue-300/60"
                style={{
                  transform: `scale(${1 + lipSync.intensity * 0.06})`,
                  opacity: 0.5 + lipSync.intensity * 0.4,
                  transition: "transform 90ms ease-out, opacity 90ms ease-out",
                }}
              />
            )}

            <div
              className="relative h-48 w-48 overflow-hidden rounded-full bg-white shadow-2xl ring-4 ring-white/10"
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

          <p className="mt-8 text-sm font-medium tracking-wide text-white/70">{orbStateLabel[voiceState]}</p>

          {voiceError && (
            <p className="mt-4 max-w-md px-6 text-center text-xs text-red-400">
              {voiceError}
            </p>
          )}

          {!voiceError && messages.length > 0 && (
            <p className="mt-4 max-w-md px-6 text-center text-xs text-white/40">
              {messages[messages.length - 1].text}
            </p>
          )}

          <button
            onClick={() => startListeningSafely()}
            className="mt-6 rounded-full border border-white/20 px-5 py-2 text-xs text-white/70 hover:bg-white/10 transition-colors"
          >
            Tap to retry listening
          </button>

          <button
            onClick={exitVoiceMode}
            className="mt-3 rounded-full border border-white/20 px-5 py-2 text-xs text-white/70 hover:bg-white/10 transition-colors"
          >
            Switch to typing
          </button>
        </div>
      )}

      {open && !voiceMode && (
        <Card className="fixed inset-x-3 top-16 bottom-3 z-50 flex flex-col shadow-2xl sm:inset-x-auto sm:top-auto sm:bottom-5 sm:right-5 sm:h-[520px] sm:w-[360px]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-sky-600" /> APAS Agent
            </CardTitle>
            <div className="flex items-center gap-2">
              {voiceSupported && ttsSupported && (
                <button
                  onClick={enterVoiceMode}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-white shadow hover:bg-sky-700 transition-colors shrink-0"
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
            <ScrollArea className="flex-1 pr-2" ref={scrollRef}>
              <div className="flex flex-col gap-3">
                {messages.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Hi! I'm your Principal Assistant. Ask me about Reports, Attendance, Admissions, Transport, Safeguarding, School Quality Index, and more - or tap the blue icon above for hands-free voice mode.
                  </p>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${m.role === "user" ? "bg-sky-600 text-white" : "bg-muted"}`}>
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
