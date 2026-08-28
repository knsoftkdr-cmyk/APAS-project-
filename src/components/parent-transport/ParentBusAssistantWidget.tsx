import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, X, Send, Mic, MicOff } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface ParentBusAssistantWidgetProps {
  studentName?: string | null;
  studentId: string | null;
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

export function ParentBusAssistantWidget({ studentId, studentName }: ParentBusAssistantWidgetProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const resultHandledRef = useRef(false);
  const finalTranscriptRef = useRef("");
  const hadErrorRef = useRef(false);

  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  const listeningWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const updateVoiceMode = (v: boolean) => {
    voiceModeRef.current = v;
    setVoiceMode(v);
  };

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceSupported(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      let combined = "";
      for (let i = 0; i < event.results.length; i++) {
        combined += event.results[i][0].transcript;
      }
      combined = combined.trim();
      finalTranscriptRef.current = combined;
      setInput(combined);
      if (listeningWatchdogRef.current) { clearTimeout(listeningWatchdogRef.current); listeningWatchdogRef.current = null; }
      listeningWatchdogRef.current = setTimeout(() => {
        try { recognitionRef.current?.stop(); } catch {}
      }, 1500);
    };
    recognition.onerror = (event: any) => {
      if (listeningWatchdogRef.current) { clearTimeout(listeningWatchdogRef.current); listeningWatchdogRef.current = null; }
      setIsListening(false);
      if (event.error === "aborted") return;
      if (voiceModeRef.current && event.error === "no-speech") {
        setTimeout(() => startListeningSafely(), 400);
        return;
      }
      hadErrorRef.current = true;
      const messagesMap: Record<string, string> = {
        "no-speech": "No speech detected. Please try again.",
        "not-allowed": "Microphone access was denied. Check the site permissions and allow microphone access.",
        "audio-capture": "No microphone found. Please check your microphone is connected.",
        "network": "Voice recognition needs an internet connection.",
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
      if (listeningWatchdogRef.current) { clearTimeout(listeningWatchdogRef.current); listeningWatchdogRef.current = null; }
      setIsListening(false);
      const transcript = finalTranscriptRef.current;
      finalTranscriptRef.current = "";
      if (!resultHandledRef.current && !hadErrorRef.current && transcript) {
        resultHandledRef.current = true;
        if (voiceModeRef.current) { setVoiceState("thinking"); setVoiceError(null); }
        setTimeout(() => sendMessageWithText(transcript), 100);
      }
      hadErrorRef.current = false;
    };
    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.abort(); } catch {}
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startListeningSafely = () => {
    if (!recognitionRef.current) return;
    try {
      setVoiceState("listening");
      setVoiceError(null);
      setIsListening(true);
      recognitionRef.current.start();
      resultHandledRef.current = false;
      hadErrorRef.current = false;
      finalTranscriptRef.current = "";
      if (listeningWatchdogRef.current) clearTimeout(listeningWatchdogRef.current);
      listeningWatchdogRef.current = setTimeout(() => {
        try { recognitionRef.current?.stop(); } catch {}
        setIsListening(false);
        if (voiceModeRef.current) {
          setVoiceError("Didn't catch that in time - the mic seems stuck. Tap to try again or switch to typing.");
          setVoiceState("idle");
        }
      }, 8000);
    } catch (err: any) {
      if (err?.name === "InvalidStateError") {
        try { recognitionRef.current.stop(); } catch {}
        setTimeout(() => startListeningSafely(), 150);
      }
    }
  };

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setIsListening(true);
      recognitionRef.current.start();
      resultHandledRef.current = false;
      hadErrorRef.current = false;
      finalTranscriptRef.current = "";
    }
  };

  const speak = (text: string) => {
    if (!ttsSupported || !voiceModeRef.current) {
      if (voiceModeRef.current) startListeningSafely();
      return;
    }
    const doSpeak = () => {
      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onstart = () => setVoiceState("speaking");
      utterance.onend = () => {
        utteranceRef.current = null;
        if (voiceModeRef.current) startListeningSafely();
      };
      utterance.onerror = () => {
        utteranceRef.current = null;
        if (voiceModeRef.current) startListeningSafely();
      };
      window.speechSynthesis.speak(utterance);
      setTimeout(() => {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      }, 60);
      setTimeout(() => {
        if (utteranceRef.current === utterance && voiceModeRef.current) {
          utteranceRef.current = null;
          startListeningSafely();
        }
      }, 15000);
    };
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
      setTimeout(doSpeak, 80);
    } else {
      doSpeak();
    }
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
    if (listeningWatchdogRef.current) { clearTimeout(listeningWatchdogRef.current); listeningWatchdogRef.current = null; }
    updateVoiceMode(false);
    setVoiceState("idle");
    setVoiceError(null);
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    if (recognitionRef.current && isListening) {
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

  const sendMessageWithText = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loadingRef.current || !studentId) return;
    loadingRef.current = true;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);
    if (voiceModeRef.current) { setVoiceState("thinking"); setVoiceError(null); }
    try {
      const { data, error } = await withTimeout(
        supabase.functions.invoke("parent-assistant", { body: { message: text, student_id: studentId, student_name: studentName, history: messages.slice(-6).map((m) => ({ role: m.role, text: m.text })) } }),
        20000,
        "Bus assistant"
      );
      if (error) throw error;
      say(data?.text || "I'm not sure how to help with that.");
    } catch (e: any) {
      const friendly = e?.message?.includes("timed out")
        ? "That took too long to respond. Let's try again."
        : (e?.message || "Something went wrong. Please try again.");
      if (voiceModeRef.current) setVoiceError(friendly);
      toast({ title: "Bus assistant error", description: friendly, variant: "destructive" });
      say(friendly);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  if (!studentId || typeof document === "undefined") return null;

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

  return createPortal(
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition-colors"
          aria-label="Open APAS Agent"
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

          <div className={`h-56 w-56 rounded-full bg-gradient-to-br shadow-2xl ${orbClasses[voiceState]}`} />

          <p className="mt-8 text-sm font-medium tracking-wide text-white/70">{orbStateLabel[voiceState]}</p>

          {voiceError && (
            <p className="mt-4 max-w-md px-6 text-center text-xs text-red-400">{voiceError}</p>
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
        <Card className="fixed bottom-5 right-5 z-50 flex h-[520px] w-[380px] flex-col shadow-2xl">
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
                    Try: "Where's the bus?", "When will it arrive?", "Is it running late?", or "What's the driver's number?" Tap the blue icon above for hands-free voice mode.
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

            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessageWithText()}
                placeholder={isListening ? "Listening..." : "Ask about the bus..."}
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
    </>,
    document.body
  );
}
