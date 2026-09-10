import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, X, Send, Mic, MicOff, Bus } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { SpeechRecognition } from "@capgo/capacitor-speech-recognition";
import { useLipSync, estimateSpeechDurationMs } from "@/hooks/useLipSync";
import { RobotFace } from "@/components/ai-assistant/RobotFace";
import robotAvatar from "@/assets/ai-assistant-robot.png";

const isNativePlatform = Capacitor.isNativePlatform();

interface ActionConfirm {
  action: "update_vehicle_status";
  vehicle_id: string;
  vehicle_registration: string;
  new_status: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface ERPTransportAssistantWidgetProps {
  schoolId?: string;
  onNavigate: (tab: string) => void;
  isTransportTab?: boolean;
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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

const CONFIRM_WORDS = /^(yes|yeah|yep|confirm|do it|go ahead|sure|okay|ok)\b/i;
const CANCEL_WORDS = /^(no|nope|cancel|dont|don't|stop)\b/i;

export function ERPTransportAssistantWidget({ schoolId, onNavigate, isTransportTab = true }: ERPTransportAssistantWidgetProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionConfirm | null>(null);
  const [actingOn, setActingOn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const pendingActionRef = useRef<ActionConfirm | null>(null);
  const updatePendingAction = (a: ActionConfirm | null) => {
    pendingActionRef.current = a;
    setPendingAction(a);
  };

  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  const noSpeechRetryRef = useRef(0);
  // Guards against a single utterance firing onresult more than once (a
  // documented quirk in some browsers even with continuous=false) - only
  // the recognition session's natural end (onend) is allowed to actually
  // send the message, and only once per session.
  const resultHandledRef = useRef(false);
  const finalTranscriptRef = useRef("");
  const hadErrorRef = useRef(false);

  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const ttsSupported = isNativePlatform || (typeof window !== "undefined" && "speechSynthesis" in window);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Speech-synced mouth animation - see src/hooks/useLipSync.ts. Shape comes
  // from a timing schedule built from the spoken text; on the web it's kept
  // locked to the real voice via SpeechSynthesisUtterance's boundary event.
  const lipSync = useLipSync();
  // Guards against overlapping speak() calls fighting over the speech
  // queue / lip-sync clock - only the latest call is allowed to act.
  const speechGenerationRef = useRef(0);

  const updateVoiceMode = (v: boolean) => {
    voiceModeRef.current = v;
    setVoiceMode(v);
  };

  const sendMessageWithTextRef = useRef<(overrideText?: string) => Promise<void>>(async () => {});

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
      return () => {
        cancelled = true;
      };
    }

    const BrowserSpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!BrowserSpeechRecognition) {
      setVoiceSupported(false);
      return;
    }
    const recognition = new BrowserSpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      clearTimeout(listeningTimeoutRef.current);
      noSpeechRetryRef.current = 0;
      // Accumulate every result this session reports instead of acting on
      // the first one - some browsers fire onresult more than once for a
      // single utterance, and reacting to each firing sent (and spoke) the
      // same answer multiple times.
      let combined = "";
      for (let i = 0; i < event.results.length; i++) {
        combined += event.results[i][0]?.transcript ?? "";
      }
      finalTranscriptRef.current = combined.trim();
      setInput(finalTranscriptRef.current);
      // Reset the "stop soon" timer each time new speech comes in, then
      // let the session end naturally - onend below is what actually
      // triggers sendMessage, exactly once.
      listeningTimeoutRef.current = setTimeout(() => {
        try { recognitionRef.current?.stop(); } catch {}
      }, 1500);
    };
    recognition.onerror = (event: any) => {
      clearTimeout(listeningTimeoutRef.current);
      setIsListening(false);
      hadErrorRef.current = true;
      console.error("SpeechRecognition error:", event.error);
      if (event.error === "aborted") return;

      if (event.error === "no-speech") {
        if (voiceModeRef.current || noSpeechRetryRef.current < 1) {
          noSpeechRetryRef.current += 1;
          setTimeout(() => startListeningSafely(), 400);
          return;
        }
        noSpeechRetryRef.current = 0;
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
      clearTimeout(listeningTimeoutRef.current);
      setIsListening(false);
      const transcript = finalTranscriptRef.current;
      finalTranscriptRef.current = "";
      if (!resultHandledRef.current && !hadErrorRef.current && transcript) {
        resultHandledRef.current = true;
        if (voiceModeRef.current) { setVoiceState("thinking"); setVoiceError(null); }
        setTimeout(() => sendMessageWithTextRef.current(transcript), 100);
      }
      hadErrorRef.current = false;
    };
    recognitionRef.current = recognition;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listeningTimeoutRef = useRef<any>(null);

const startListeningSafely = () => {
    if (isNativePlatform) {
      setVoiceState("listening");
      setVoiceError(null);
      setIsListening(true);

      SpeechRecognition.forceStop({ timeout: 800 }).catch(() => {}).finally(() => {
        setTimeout(() => {
          clearTimeout(listeningTimeoutRef.current);
          listeningTimeoutRef.current = setTimeout(() => {
            SpeechRecognition.forceStop({ timeout: 800 }).catch(() => {});
          }, 8000);

          SpeechRecognition.requestPermissions()
            .then(() =>
              SpeechRecognition.start({
                language: "en-US",
                maxResults: 1,
                partialResults: false,
                popup: true,
              })
            )
            .then((result: { matches?: string[] }) => {
              clearTimeout(listeningTimeoutRef.current);
              setIsListening(false);
              const transcript = result?.matches?.[0];
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
              noSpeechRetryRef.current = 0;
              setInput(transcript);
              if (voiceModeRef.current) {
                setVoiceState("thinking");
                setVoiceError(null);
              }
              setTimeout(() => sendMessageWithTextRef.current(transcript), 100);
            })
            .catch((err: any) => {
              clearTimeout(listeningTimeoutRef.current);
              setIsListening(false);
              console.error("SpeechRecognition error:", err);
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

    if (!recognitionRef.current) return;
    try {
      setVoiceState("listening");
      setVoiceError(null);
      setIsListening(true);
      resultHandledRef.current = false;
      hadErrorRef.current = false;
      finalTranscriptRef.current = "";
      recognitionRef.current.start();
      clearTimeout(listeningTimeoutRef.current);
      listeningTimeoutRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch {}
        }
      }, 8000);
    } catch {
      // already started - ignore
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
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setIsListening(true);
      resultHandledRef.current = false;
      hadErrorRef.current = false;
      finalTranscriptRef.current = "";
      recognitionRef.current.start();
    }
  };

  const forSpeech = (text: string): string => {
    // Space out alphanumeric codes (e.g. vehicle registrations) so TTS reads
    // them character-by-character instead of as one garbled number.
    return text.replace(/\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{4,}\b/g, (token) =>
      token.split("").join(" ")
    );
  };

  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!ttsSupported || isNativePlatform) return;
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      const priorityNames = [
        "Google US English",
        "Samantha",
        "Microsoft Aria Online (Natural)",
        "Microsoft Jenny Online (Natural)",
        "Microsoft Guy Online (Natural)",
      ];
      let chosen: SpeechSynthesisVoice | undefined;
      for (const name of priorityNames) {
        chosen = voices.find((v) => v.name === name);
        if (chosen) break;
      }
      if (!chosen) {
        chosen = voices.find((v) => /natural|neural/i.test(v.name) && v.lang.startsWith("en"));
      }
      if (!chosen) {
        chosen = voices.find((v) => v.lang === "en-US" && v.localService);
      }
      if (!chosen) {
        chosen = voices.find((v) => v.lang.startsWith("en"));
      }
      preferredVoiceRef.current = chosen || null;
    };
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speak = (text: string) => {
    const myGeneration = ++speechGenerationRef.current;

    if (!ttsSupported || !voiceModeRef.current) {
      if (voiceModeRef.current) startListeningSafely();
      return;
    }

if (isNativePlatform) {
  setVoiceState("speaking");
  const spokenText = forSpeech(text);
  const estimatedMs = Math.max(1200, spokenText.split(/\s+/).length * 380);
  // Native TTS gives no audio stream or word events, so the mouth is
  // driven off the same estimated duration used to schedule when to
  // resume listening - keeps them in lockstep.
  lipSync.start(spokenText, estimatedMs);

  TextToSpeech.speak({
    text: spokenText,
    lang: "en-US",
    rate: 0.97,
    pitch: 1.02,
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
      if (speechGenerationRef.current !== myGeneration) return; // superseded
      const spokenText = forSpeech(text);
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utteranceRef.current = utterance;
      if (preferredVoiceRef.current) utterance.voice = preferredVoiceRef.current;
      utterance.rate = 0.97;
      utterance.pitch = 1.02;
      utterance.volume = 1;
      utterance.onstart = () => {
        if (speechGenerationRef.current !== myGeneration) return;
        setVoiceState("speaking");
        // Browsers never expose speechSynthesis audio to the Web Audio API,
        // so mouth movement is scheduled against an estimated duration and
        // corrected live via onboundary below.
        lipSync.start(spokenText, estimateSpeechDurationMs(spokenText));
      };
      utterance.onboundary = (event: SpeechSynthesisEvent) => {
        if (speechGenerationRef.current !== myGeneration) return;
        lipSync.reanchor(event.charIndex ?? 0, spokenText.length);
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
    } else {
      window.speechSynthesis?.cancel();
    }
    utteranceRef.current = null;
    if (isNativePlatform) {
      if (isListening) SpeechRecognition.stop().catch(() => {});
    } else if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const say = (text: string) => {
    setMessages((prev) => [...prev, { role: "assistant", text }]);
    if (voiceModeRef.current) speak(text);
  };

  const runAction = async (confirm: ActionConfirm) => {
    if (!schoolId) return;
    setActingOn(true);
    try {
      if (confirm.action === "update_vehicle_status") {
        const { error } = await supabase
          .from("vehicles")
          .update({ status: confirm.new_status })
          .eq("id", confirm.vehicle_id)
          .eq("school_id", schoolId);
        if (error) throw error;
        say(`Done — ${confirm.vehicle_registration} is now marked ${confirm.new_status}.`);
        toast({ title: "Vehicle updated", description: `${confirm.vehicle_registration} to ${confirm.new_status}` });
      }
    } catch (e: any) {
      toast({ title: "Action failed", description: e?.message || "Could not update the vehicle.", variant: "destructive" });
      say("That didn't go through — please try updating it directly from the Vehicles tab.");
    } finally {
      setActingOn(false);
      updatePendingAction(null);
    }
  };

  const cancelPendingAction = () => {
    updatePendingAction(null);
    say("Okay, cancelled.");
  };

  const sendMessageWithText = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading || !schoolId) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);

    if (pendingActionRef.current) {
      if (CONFIRM_WORDS.test(text)) {
        const action = pendingActionRef.current;
        if (voiceModeRef.current) setVoiceState("thinking");
        await runAction(action);
        return;
      }
      if (CANCEL_WORDS.test(text)) {
        cancelPendingAction();
        return;
      }
    }

    setLoading(true);
    if (voiceModeRef.current) { setVoiceState("thinking"); setVoiceError(null); }
    try {
      const { data, error } = await withTimeout(
        supabase.functions.invoke("erp-transport-assistant", { body: { message: text, school_id: schoolId } }),
        20000,
        "Transport assistant"
      );
      if (error) throw error;

      if (data?.type === "navigate" && data?.target_tab) {
        say(data.text || `Opening ${data.target_tab}...`);
        onNavigate(data.target_tab);
      } else if (data?.type === "action_confirm") {
        updatePendingAction({
          action: data.action,
          vehicle_id: data.vehicle_id,
          vehicle_registration: data.vehicle_registration,
          new_status: data.new_status,
        });
        say(data.text);
      } else {
        say(data?.text || "I'm not sure how to help with that.");
      }
    } catch (e: any) {
      const friendly = e?.message?.includes("timed out")
        ? "That took too long to respond. Let's try again."
        : (e?.message || "Something went wrong. Please try again.");
      if (voiceModeRef.current) setVoiceError(friendly);
      toast({ title: "Transport assistant error", description: friendly, variant: "destructive" });
      say(friendly);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    sendMessageWithTextRef.current = sendMessageWithText;
  });

  const orbStateLabel: Record<VoiceState, string> = {
    idle: "Starting...",
    listening: "Listening...",
    thinking: "Thinking...",
    speaking: "Speaking...",
  };

  const orbClasses: Record<VoiceState, string> = {
    idle: "from-blue-400 via-indigo-400 to-purple-400 animate-pulse",
    listening: "from-blue-400 via-cyan-300 to-indigo-400 animate-pulse",
    thinking: "from-indigo-500 via-purple-400 to-blue-500 animate-spin",
    speaking: "from-sky-300 via-blue-200 to-indigo-300 animate-bounce",
  };

  if (!isTransportTab && !open) return null;

  return (
    <>
      {!open && isTransportTab && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition-colors"
          aria-label="Open APAS Agent"
        >
          <Bus className="h-6 w-6" />
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

          <div className="relative flex h-64 w-64 items-center justify-center">
            {/* Ambient glow behind the avatar, colored per voice state and
                pulsing in brightness while speaking, driven by the same
                lip-sync intensity that drives the mouth. */}
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
              <div className="absolute inset-1 rounded-full border-2 border-t-transparent border-indigo-300/70 animate-spin" />
            )}
            {voiceState === "speaking" && (
              <div
                className="absolute inset-0 rounded-full border-2 border-sky-300/60"
                style={{
                  transform: `scale(${1 + lipSync.intensity * 0.06})`,
                  opacity: 0.5 + lipSync.intensity * 0.4,
                  transition: "transform 90ms ease-out, opacity 90ms ease-out",
                }}
              />
            )}

            {/* Robot avatar - gets a gentle "talking" bob and scale while
                speaking, and its mouth is replaced with a real speech-synced
                overlay (see RobotFace / useLipSync). */}
            <div
              className="relative h-56 w-56 overflow-hidden rounded-full bg-white shadow-2xl ring-4 ring-white/10"
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

          {pendingAction && (
            <div className="mt-4 flex gap-3">
              <Button size="sm" disabled={actingOn} onClick={() => runAction(pendingAction)}>Confirm</Button>
              <Button size="sm" variant="outline" disabled={actingOn} onClick={cancelPendingAction}>Cancel</Button>
            </div>
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
        <Card className="fixed inset-x-3 top-16 bottom-3 z-50 flex flex-col shadow-2xl sm:inset-x-auto sm:top-auto sm:bottom-5 sm:right-5 sm:h-[520px] sm:w-[380px]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-blue-600" /> APAS Agent
            </CardTitle>
            <div className="flex items-center gap-2">
              {voiceSupported && ttsSupported && (
                <button
                  onClick={enterVoiceMode}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white shadow hover:bg-blue-700 transition-colors shrink-0"
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
                    Try: "How many vehicles need attention?", "Where does Route 3 pick up?", "Show me the drivers tab", or "Which student is Aditya on?" Or tap the blue icon above for hands-free voice mode.
                  </p>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${m.role === "user" ? "bg-blue-600 text-white" : "bg-muted"}`}>
                      <p>{m.text}</p>
                    </div>
                  </div>
                ))}
                {loading && <p className="text-xs text-muted-foreground">Thinking...</p>}
              </div>
            </ScrollArea>

            {pendingAction && (
              <div className="flex gap-1.5">
                <Button size="sm" className="h-7 text-xs" disabled={actingOn} onClick={() => runAction(pendingAction)}>
                  Confirm
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actingOn} onClick={cancelPendingAction}>
                  Cancel
                </Button>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessageWithText()}
                placeholder={isListening ? "Listening..." : "Ask about fleet, drivers, routes..."}
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