import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import { createPortal } from "react-dom";
import robotAvatar from "@/assets/ai-assistant-robot.png";
import { useLipSync, estimateSpeechDurationMs } from "@/hooks/useLipSync";
import { RobotFace } from "@/components/ai-assistant/RobotFace";
const isNativePlatform = Capacitor.isNativePlatform();

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface KnownIntent {
  class_level?: string;
  section?: string;
  subject_query?: string;
  subject_label?: string;
  topic_query?: string;
  periods?: number;
  duration_minutes?: number;
}

type AwaitingSlot = "class" | "section" | "subject" | "chapter" | null;
type VoiceState = "idle" | "listening" | "thinking" | "speaking";

function classLabelFor(classLevel: string) {
  return classLevel.match(/^\d+$/) ? `Class ${classLevel}` : classLevel.charAt(0).toUpperCase() + classLevel.slice(1);
}

function normalizeClassLevel(text: string): string {
  let stripped = text.trim().replace(/^(class|grade|std\.?|standard)\s+/i, "").trim();
  // "4th" / "1st" / "2nd" / "3rd" -> "4" / "1" / "2" / "3"
  stripped = stripped.replace(/^(\d+)\s*(st|nd|rd|th)$/i, "$1");
  return stripped || text.trim();
}

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
// backend AI call hangs or a key/model rotation takes too long.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export function AILessonAssistantWidget() {
  const { isTeacher, profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [known, setKnown] = useState<KnownIntent>({});
  const [awaiting, setAwaiting] = useState<AwaitingSlot>(null);
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);
  const [chapterOptions, setChapterOptions] = useState<string[]>([]);
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

  const knownRef = useRef<KnownIntent>({});
  const awaitingRef = useRef<AwaitingSlot>(null);
  const chapterOptionsRef = useRef<string[]>([]);
  // Speech-recognition callbacks are wired up once (effect deps: []) but
  // call sendMessageWithText, which is declared later in this component
  // and recreated every render. Calling it through a ref (set right after
  // its declaration, below) means those callbacks never depend on
  // closure/declaration order - avoids TDZ errors under Vite's Fast
  // Refresh, where a stale closure can otherwise point at a torn-down
  // module scope.
  const sendMessageWithTextRef = useRef<(overrideText?: string) => void>(() => {});
  const voiceRequestInFlightRef = useRef(false);
  const listeningInProgressRef = useRef(false);
  // Incremented on every speak() call - see speak() for why.
  const speechGenerationRef = useRef(0);
  const updateKnown = (k: KnownIntent) => {
    knownRef.current = k;
    setKnown(k);
  };
  const updateAwaiting = (a: AwaitingSlot) => {
    awaitingRef.current = a;
    setAwaiting(a);
  };
  const updateChapterOptions = (opts: string[]) => {
    chapterOptionsRef.current = opts;
    setChapterOptions(opts);
  };
  const updateVoiceMode = (v: boolean) => {
    voiceModeRef.current = v;
    setVoiceMode(v);
  };

  const handleVoiceTranscript = (transcript: string) => {
    const text = transcript.trim();
    if (!text) return;

    // Ignore duplicate recognition results firing close together.
    if (voiceRequestInFlightRef.current) {
      console.debug("[voice] duplicate transcript ignored:", text);
      return;
    }
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
  // recognition results/session state around in some browsers, which was
  // causing transcripts to accumulate across turns ("hello" -> "hello how
  // are you" -> ...). A fresh instance per turn guarantees a clean session.
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
    // sentences short after just the first word/phrase. Instead we
    // accumulate every result this session reports, and only act once
    // on the session's natural end (onend), which is when continuous=false
    // actually stops listening after you finish speaking.
    let consumed = false;
    let latestTranscript = "";

    recognition.onresult = (event: any) => {
      let combined = "";
      for (let i = 0; i < event.results.length; i++) {
        combined += event.results[i][0]?.transcript ?? "";
      }
      latestTranscript = combined.trim();
      console.debug("[voice] transcript so far:", latestTranscript);
    };

    recognition.onerror = (event: any) => {
      if (consumed) return;
      consumed = true;
      listeningInProgressRef.current = false;
      setIsListening(false);
      console.error("SpeechRecognition error:", event.error);
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
        console.debug("[voice] final transcript:", latestTranscript);
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
    // Real recognition instances are created fresh per turn by
    // createRecognition() (called from startListeningSafely /
    // toggleListening) - reusing one instance across turns is what caused
    // transcripts to accumulate, so we don't create one here anymore.
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
      console.error("[voice] failed to start recognition:", err);
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
    // Every call to speak() gets its own generation id. If two speak()
    // calls happen close together (e.g. the widget mounted twice - React
    // StrictMode double-invoking in dev, or the widget rendered in two
    // places), both would otherwise call speechSynthesis.cancel() to
    // clear the queue before speaking, endlessly cancelling each other's
    // utterance and producing a burst of "interrupted" errors. With this
    // guard, only the LATEST call is allowed to actually speak or react
    // to its utterance events; every earlier/stale call quietly no-ops
    // instead of fighting for the speech queue.
    const myGeneration = ++speechGenerationRef.current;

    if (!ttsSupported || !voiceModeRef.current) {
      // Voice mode active but TTS unsupported/unavailable - don't leave the UI
      // stuck on "thinking" with no way forward, resume listening immediately.
      if (voiceModeRef.current) startListeningSafely();
      return;
    }

    if (isNativePlatform) {
      setVoiceState("speaking");
      const estimatedMs = Math.max(1200, text.split(/\s+/).length * 380);
      // Native TTS gives us no audio stream or word events, so drive the
      // mouth off the same estimated duration already used to schedule
      // when to resume listening - keeps them in lockstep.
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
      console.debug("[voice] speaking:", text);
      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onstart = () => {
        if (speechGenerationRef.current !== myGeneration) return;
        console.debug("[voice] tts started");
        setVoiceState("speaking");
        // Browsers never expose speechSynthesis audio to the Web Audio
        // API, so we schedule mouth movement against an estimated
        // duration and correct drift live via onboundary below.
        lipSync.start(text, estimateSpeechDurationMs(text));
      };
      utterance.onboundary = (event: SpeechSynthesisEvent) => {
        if (speechGenerationRef.current !== myGeneration) return;
        // Fires per-word (in browsers that support it) with the real
        // character offset - use it to keep the mouth locked to the
        // actual voice instead of drifting from the estimate.
        lipSync.reanchor(event.charIndex ?? 0, text.length);
      };
      utterance.onend = () => {
        if (speechGenerationRef.current !== myGeneration) return;
        console.debug("[voice] tts ended");
        utteranceRef.current = null;
        lipSync.stop();
        if (voiceModeRef.current) startListeningSafely();
      };
      utterance.onerror = (e: any) => {
        console.error("[voice] tts error:", e);
        // A stale/superseded call's utterance was cancelled by a newer
        // speak() - that's expected and not a real failure, so it must
        // not touch state or restart listening.
        if (speechGenerationRef.current !== myGeneration) return;
        utteranceRef.current = null;
        lipSync.stop();
        // "interrupted"/"canceled" mean something else deliberately cut
        // this utterance off (a newer speak() call, or exitVoiceMode).
        // Whatever caused that already handles resuming listening itself.
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
          console.warn("[voice] tts appears stuck, forcing recovery");
          utteranceRef.current = null;
          lipSync.stop();
          startListeningSafely();
        }
      }, 15000);
    };

    // Cancel once, synchronously, and do not chase it with retries - the
    // generation guard above is what actually prevents duplicate/competing
    // callers from fighting over the queue, so a retry loop here is no
    // longer needed and was part of what caused the error burst.
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

  if (!isTeacher) return null;

  const say = (text: string) => {
    setMessages((prev) => [...prev, { role: "assistant", text }]);
    if (voiceModeRef.current) speak(text);
  };

  const fetchSubjects = async (classLevel: string): Promise<string[]> => {
    if (!profile?.school_id) return [];
    const { data } = await supabase
      .from("books")
      .select("subject")
      .eq("class_name", classLabelFor(classLevel))
      .eq("school_id", profile.school_id)
      .eq("is_active", true);
    const unique = Array.from(new Set((data || []).map((b: any) => b.subject as string)));
    return unique;
  };

  const fetchChapters = async (classLevel: string, subjectLabel: string): Promise<string[]> => {
    if (!profile?.school_id) return [];
    const { data: books } = await supabase
      .from("books").select("id")
      .eq("class_name", classLabelFor(classLevel))
      .eq("subject", subjectLabel)
      .eq("school_id", profile.school_id)
      .eq("is_active", true);
    if (!books?.length) return [];
    const { data: units } = await supabase
      .from("units").select("id, unit_name")
      .in("book_id", books.map((b: any) => b.id))
      .eq("is_active", true);
    if (!units?.length) return [];
    const { data: chapters } = await supabase
      .from("curriculum_chapters").select("chapter_name, unit_id")
      .in("unit_id", units.map((u: any) => u.id))
      .eq("is_active", true);
    return (chapters || []).map((c: any) => {
      const unit = units.find((u: any) => u.id === c.unit_id);
      return `${unit?.unit_name ?? ""}: ${c.chapter_name}`;
    });
  };

  const SUBJECT_ALIASES: Record<string, string> = {
    maths: "mathematics", math: "mathematics", "e v s": "environmental science",
    evs: "environmental science", eng: "english", sci: "science",
    ss: "social studies", social: "social studies", phy: "physics",
    phys: "physics", chem: "chemistry", bio: "biology", "comp sci": "computer science",
    cs: "computer science", tel: "telugu", hin: "hindi",
  };

  const matchOne = (query: string, options: string[]): string | null => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const aliased = SUBJECT_ALIASES[q] || q;
    let hit = options.find((o) => o.toLowerCase() === aliased || o.toLowerCase() === q);
    if (hit) return hit;
    hit = options.find((o) => o.toLowerCase().includes(aliased) || aliased.includes(o.toLowerCase()) || o.toLowerCase().includes(q) || q.includes(o.toLowerCase()));
    if (hit) return hit;
    const prefixLen = Math.min(4, q.length);
    if (prefixLen >= 3) {
      const qPrefix = q.slice(0, prefixLen);
      hit = options.find((o) => o.toLowerCase().startsWith(qPrefix));
      if (hit) return hit;
    }
    return null;
  };

  const advance = async (updatedIn: KnownIntent) => {
    let updated = updatedIn;

    if (!updated.class_level) {
      updateKnown(updated);
      updateAwaiting("class");
      say("What class/grade is this lesson for?");
      return;
    }
    if (!updated.section) {
      updateKnown(updated);
      updateAwaiting("section");
      say("Which section?");
      return;
    }
    if (!updated.subject_label) {
      const opts = await fetchSubjects(updated.class_level);
      setSubjectOptions(opts);
      const matched = updated.subject_query ? matchOne(updated.subject_query, opts) : null;
      if (matched) {
        updated = { ...updated, subject_label: matched };
      } else {
        updateKnown(updated);
        updateAwaiting("subject");
        say(`Which subject is this for? Available: ${opts.join(", ") || "none found for this class"}.`);
        return;
      }
    }
    if (!updated.topic_query) {
      const opts = await fetchChapters(updated.class_level, updated.subject_label!);
      updateChapterOptions(opts);
      updateKnown(updated);
      updateAwaiting("chapter");
      say(`Which chapter/topic? Available: ${opts.join(", ") || "none found"}.`);
      return;
    } else {
      const opts = chapterOptionsRef.current.length ? chapterOptionsRef.current : await fetchChapters(updated.class_level, updated.subject_label!);
      updateChapterOptions(opts);
      const matched = matchOne(updated.topic_query, opts);
      if (!matched) {
        updateKnown(updated);
        updateAwaiting("chapter");
        say(`I couldn't match "${updated.topic_query}" to a chapter. Available: ${opts.join(", ") || "none found"}.`);
        return;
      }
      updated = { ...updated, topic_query: matched };
    }

    updateKnown(updated);
    updateAwaiting(null);
    say(`Got it! Generating the lesson plan for ${classLabelFor(updated.class_level)}-${updated.section}, ${updated.subject_label}, "${updated.topic_query}"...`);

    const params = new URLSearchParams();
    params.set("class", updated.class_level);
    params.set("section", updated.section!);

    setTimeout(() => {
      exitVoiceMode();
      setOpen(false);
      navigate(`/curative?${params.toString()}`, {
        state: {
          intent: {
            subject_query: updated.subject_label,
            topic_query: updated.topic_query,
            periods: updated.periods,
            duration_minutes: updated.duration_minutes,
          },
        },
      });
    }, 600);
  };

  const sendMessageWithText = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);
    if (voiceModeRef.current) { setVoiceState("thinking"); setVoiceError(null); }
    try {
      const currentAwaiting = awaitingRef.current;
      if (currentAwaiting) {
        const updated = { ...knownRef.current };
        if (currentAwaiting === "class") updated.class_level = normalizeClassLevel(text);
        if (currentAwaiting === "section") updated.section = text.replace(/^section\s*/i, "").trim();
        if (currentAwaiting === "subject") updated.subject_query = text;
        if (currentAwaiting === "chapter") updated.topic_query = text;
        await advance(updated);
      } else {
        // Timeout guard: the backend rotates across several API keys/models on
        // failure, which can otherwise leave the orb stuck on "Thinking..."
        // for a long time with no feedback.
        const { data, error } = await withTimeout(
          supabase.functions.invoke("extract-lesson-intent", { body: { message: text } }),
          20000,
          "AI assistant"
        );
        if (error) throw error;
        if (data?.isLessonRequest) {
          const intent = data.intent || {};
          const currentKnown = knownRef.current;
          const updated: KnownIntent = {
            ...currentKnown,
            class_level: currentKnown.class_level || (intent.class_level ? normalizeClassLevel(String(intent.class_level)) : undefined),
            section: currentKnown.section || intent.section,
            subject_query: currentKnown.subject_query || intent.subject_query,
            topic_query: currentKnown.topic_query || intent.topic_query,
            periods: currentKnown.periods || intent.periods,
            duration_minutes: currentKnown.duration_minutes || intent.duration_minutes,
          };
          await advance(updated);
        } else {
          say(data?.chatReply || "I can help you create a lesson plan - try something like \"Create a lesson plan on Fractions for Class 5, Section A, 45 minutes.\"");
        }
      }
    } catch (e: any) {
      console.error("[voice] sendMessageWithText error:", e);
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
    idle: "from-blue-400 via-indigo-400 to-purple-400 animate-pulse",
    listening: "from-blue-400 via-cyan-300 to-indigo-400 animate-pulse",
    thinking: "from-indigo-500 via-purple-400 to-blue-500 animate-spin",
    speaking: "from-sky-300 via-blue-200 to-indigo-300 animate-pulse",
  };

  if (typeof document === "undefined") return null;
  return (
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

          <div className="relative flex h-56 w-56 items-center justify-center">
            {/* Ambient glow behind the avatar, colored per voice state and
                pulsing in brightness while speaking, driven by the same
                lip-sync intensity that drives the mouth - so the whole
                avatar reads as "alive" while talking, not just the mouth. */}
            <div
              className={`absolute inset-0 rounded-full bg-gradient-to-br blur-2xl ${orbClasses[voiceState]}`}
              style={{
                opacity: voiceState === "speaking" ? 0.55 + lipSync.intensity * 0.4 : 0.7,
                transition: "opacity 90ms ease-out",
              }}
            />

            {/* State ring */}
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

            {/* Robot avatar - the whole figure gets a gentle "talking" bob
                and scale while speaking, and its mouth is replaced with a
                real speech-synced overlay (see RobotFace / useLipSync). */}
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
                    Try: "Create a lesson plan on Fractions for Class 5, Section A, 45 minutes." Or tap the blue icon above for hands-free voice mode.
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
                placeholder={isListening ? "Listening..." : "Ask APAS to create a lesson..."}
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