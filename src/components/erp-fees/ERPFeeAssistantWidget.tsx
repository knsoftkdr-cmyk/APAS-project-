import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, X, Send, Mic, MicOff, Wallet } from "lucide-react";
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb";

type ActionConfirm =
  | { action: "resend_receipt"; fee_id: string; student_name: string }
  | { action: "add_fee"; student_id: string; student_name: string; class_grade: string | null; section: string | null; amount: number; category: string; due_date: string | null }
  | { action: "record_payment"; fee_id: string; student_name: string; amount: number; amount_due: number; current_paid: number; due_date: string | null }
  | { action: "delete_fee"; fee_id: string; student_name: string; amount_due: number; due_date: string | null };

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface ERPFeeAssistantWidgetProps {
  schoolId?: string;
  onNavigate: (tab: string) => void;
  isFeesTab?: boolean;
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

function deriveStatus(due: number, paid: number, dueDate: string | null): string {
  if (paid >= due) return "paid";
  if (dueDate && new Date(dueDate) < new Date()) return "overdue";
  return "pending";
}

export function ERPFeeAssistantWidget({ schoolId, onNavigate, isFeesTab = true }: ERPFeeAssistantWidgetProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionConfirm | null>(null);
  const [actingOn, setActingOn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const pendingActionRef = useRef<ActionConfirm | null>(null);
  const updatePendingAction = (a: ActionConfirm | null) => {
    pendingActionRef.current = a;
    setPendingAction(a);
  };

  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  const listeningWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultHandledRef = useRef(false);
  const finalTranscriptRef = useRef("");
  const hadErrorRef = useRef(false);

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

  const sendMessageWithTextRef = useRef<(overrideText?: string) => Promise<void>>(async () => {});

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
      console.error("SpeechRecognition error:", event.error);
      if (event.error === "aborted") return;
      if (voiceModeRef.current && event.error === "no-speech") {
        setTimeout(() => startListeningSafely(), 400);
        return;
      }
      hadErrorRef.current = true;
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
      if (listeningWatchdogRef.current) { clearTimeout(listeningWatchdogRef.current); listeningWatchdogRef.current = null; }
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

  const forSpeech = (text: string): string => {
    return text.replace(/\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{4,}\b/g, (token) =>
      token.split("").join(" ")
    );
  };

  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!ttsSupported) return;
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
    if (!ttsSupported || !voiceModeRef.current) {
      if (voiceModeRef.current) startListeningSafely();
      return;
    }
    const doSpeak = () => {
      const utterance = new SpeechSynthesisUtterance(forSpeech(text));
      utteranceRef.current = utterance;
      if (preferredVoiceRef.current) utterance.voice = preferredVoiceRef.current;
      utterance.rate = 0.97;
      utterance.pitch = 1.02;
      utterance.volume = 1;
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

  const runAction = async (confirm: ActionConfirm) => {
    if (!schoolId) return;
    setActingOn(true);
    try {
      if (confirm.action === "resend_receipt") {
        const { error } = await supabase.functions.invoke("resend-fee-receipt", {
          body: { fee_payment_id: confirm.fee_id },
        });
        if (error) throw error;
        say(`Done — receipt resent to ${confirm.student_name}'s registered contact.`);
        toast({ title: "Receipt resent", description: `Emailed to ${confirm.student_name}'s registered contact` });
      } else if (confirm.action === "add_fee") {
        const { data: sessionData } = await supabase.auth.getSession();
        const categoryColumnMap: Record<string, string> = {
          course: "course_amount",
          transport: "transport_amount",
          uniform: "uniform_amount",
          material: "material_amount",
          exam: "exam_amount",
          other: "other_amount",
        };
        const breakdown: Record<string, number> = {
          course_amount: 0,
          transport_amount: 0,
          other_amount: 0,
          uniform_amount: 0,
          material_amount: 0,
          exam_amount: 0,
        };
        const targetColumn = categoryColumnMap[confirm.category] || "other_amount";
        breakdown[targetColumn] = confirm.amount;
        const { error } = await supabase.from("fee_payments" as any).insert({
          school_id: schoolId,
          student_id: confirm.student_id,
          student_name: confirm.student_name,
          class_grade: confirm.class_grade,
          section: confirm.section,
          amount_due: confirm.amount,
          amount_paid: 0,
          ...breakdown,
          due_date: confirm.due_date,
          status: deriveStatus(confirm.amount, 0, confirm.due_date),
          created_by: sessionData.session?.user.id,
        });
        if (error) throw error;
        say(`Done — added a ${confirm.category === "other" ? "" : confirm.category + " "}fee of ₹${confirm.amount.toLocaleString("en-IN")} for ${confirm.student_name}.`);
        toast({ title: "Fee added", description: `₹${confirm.amount.toLocaleString("en-IN")} for ${confirm.student_name}` });
      } else if (confirm.action === "record_payment") {
        const newPaid = Math.min(confirm.current_paid + confirm.amount, confirm.amount_due);
        const newStatus = deriveStatus(confirm.amount_due, newPaid, confirm.due_date);
        const { error } = await supabase
          .from("fee_payments" as any)
          .update({ amount_paid: newPaid, status: newStatus })
          .eq("id", confirm.fee_id);
        if (error) throw error;
        const balance = Math.max(confirm.amount_due - newPaid, 0);
        say(`Done — recorded ₹${confirm.amount.toLocaleString("en-IN")} for ${confirm.student_name}. Remaining balance is ₹${balance.toLocaleString("en-IN")}.`);
        toast({ title: "Payment recorded", description: `${confirm.student_name}: ₹${confirm.amount.toLocaleString("en-IN")}` });
      } else if (confirm.action === "delete_fee") {
        const { error } = await supabase.from("fee_payments" as any).delete().eq("id", confirm.fee_id);
        if (error) throw error;
        say(`Done — deleted the fee record for ${confirm.student_name}.`);
        toast({ title: "Fee record deleted", description: confirm.student_name });
      }
    } catch (e: any) {
      toast({ title: "Action failed", description: e?.message || "Could not complete that action.", variant: "destructive" });
      say("That didn't go through — please try it directly from the Fee Records tab.");
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
    if (!text || loadingRef.current || !schoolId) return;
    loadingRef.current = true;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);

    if (pendingActionRef.current) {
      if (CONFIRM_WORDS.test(text)) {
        const action = pendingActionRef.current;
        if (voiceModeRef.current) setVoiceState("thinking");
        await runAction(action);
        loadingRef.current = false;
        return;
      }
      if (CANCEL_WORDS.test(text)) {
        cancelPendingAction();
        loadingRef.current = false;
        return;
      }
    }

    setLoading(true);
    if (voiceModeRef.current) { setVoiceState("thinking"); setVoiceError(null); }
    try {
      const { data, error } = await withTimeout(
        supabase.functions.invoke("erp-fee-assistant", { body: { message: text, school_id: schoolId } }),
        20000,
        "Fee assistant"
      );
      if (error) throw error;

      if (data?.type === "navigate" && data?.target_tab) {
        say(data.text || `Opening ${data.target_tab}...`);
        onNavigate(data.target_tab);
      } else if (data?.type === "action_confirm") {
        updatePendingAction(data as ActionConfirm);
        say(data.text);
      } else {
        say(data?.text || "I'm not sure how to help with that.");
      }
    } catch (e: any) {
      const friendly = e?.message?.includes("timed out")
        ? "That took too long to respond. Let's try again."
        : (e?.message || "Something went wrong. Please try again.");
      if (voiceModeRef.current) setVoiceError(friendly);
      toast({ title: "Fee assistant error", description: friendly, variant: "destructive" });
      say(friendly);
    } finally {
      loadingRef.current = false;
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

  if (!isFeesTab && !open) return null;

  return (
    <>
      {!open && isFeesTab && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition-colors"
          aria-label="Open APAS Fee Agent"
        >
          <Wallet className="h-6 w-6" />
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

          <div className="h-64 w-64">
            <VoicePoweredOrb
              enableVoiceControl={voiceState === "listening" || voiceState === "speaking"}
              hue={voiceState === "speaking" ? 300 : voiceState === "thinking" ? 260 : 0}
              voiceSensitivity={1.5}
              maxRotationSpeed={1.2}
              maxHoverIntensity={0.8}
              className="rounded-full overflow-hidden"
            />
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
                    Try: "How many fees are pending?", "Add a fee of 5000 for Varun Gupta", "Record a payment of 3000 for Varun", "Delete Varun's fee record", "Total collected this month", or "Resend receipt for Aditya." Or tap the blue icon above for hands-free voice mode.
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
                placeholder={isListening ? "Listening..." : "Ask about fees, dues, students..."}
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

