// src/hooks/useVoiceTutor.ts
//
// Voice conversational tutor (sheet row 28): two-way speech for the AI Tutor.
//   listen()  - browser speech recognition (useSpeechRecognition); stops by itself after a short silence so the
//               student can talk naturally without pressing "stop".
//   speak()   - reads the tutor's reply aloud in sentence-sized chunks (speakChunked), in the teaching language,
//               slower for younger children. The mic never opens while the tutor is still talking.
// Audio never reaches APAS: the browser's speech service turns it into text, and only the text is sent.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { speakChunked } from "@/lib/speakChunked";
import { cleanForSpeech } from "@/lib/speechText";

const BCP47: Record<string, string> = {
  en: "en-IN", hi: "hi-IN", te: "te-IN", ta: "ta-IN", kn: "kn-IN", ml: "ml-IN", mr: "mr-IN", bn: "bn-IN",
};
const SILENCE_MS = 1800;

export type GradeBandLike = "pre_primary" | "early" | "upper_primary" | "middle" | "secondary" | null;

/** Younger children get a slower voice and a shorter voice session before a break is suggested. */
export function voiceProfileFor(band: GradeBandLike) {
  if (band === "pre_primary" || band === "early") return { rate: 0.85, sessionMinutes: 15 };
  if (band === "upper_primary") return { rate: 0.92, sessionMinutes: 25 };
  return { rate: 1, sessionMinutes: 40 };
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0];
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(base)) ?? null;
}

export function useVoiceTutor(languageCode: string) {
  const rec = useSpeechRecognition();
  const lang = BCP47[languageCode] ?? "en-IN";
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [speaking, setSpeaking] = useState(false);
  const speakSeq = useRef(0);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-stop listening after a pause in speech.
  useEffect(() => {
    if (!rec.listening) return;
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (rec.finalText || rec.interim) silenceTimer.current = setTimeout(() => rec.stop(), SILENCE_MS);
    return () => { if (silenceTimer.current) clearTimeout(silenceTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.finalText, rec.interim, rec.listening]);

  const stopSpeaking = useCallback(() => {
    speakSeq.current++;
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    setSpeaking(false);
  }, []);

  const listen = useCallback((onTranscript: (text: string) => void) => {
    stopSpeaking();
    rec.start(lang, (o) => onTranscript(o.transcript));
  }, [lang, rec, stopSpeaking]);

  const speak = useCallback((text: string, rate: number, onDone?: () => void) => {
    const clean = cleanForSpeech(text);
    if (!ttsSupported || !clean) { onDone?.(); return; }
    const seq = ++speakSeq.current;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    speakChunked(clean, {
      voice: pickVoice(lang), rate,
      isCurrent: () => speakSeq.current === seq,
      onStart: () => setSpeaking(true),
      onDone: () => { setSpeaking(false); onDone?.(); },
      onFail: () => { setSpeaking(false); onDone?.(); },
    });
  }, [lang, ttsSupported]);

  const stopAll = useCallback(() => { rec.cancel(); stopSpeaking(); }, [rec, stopSpeaking]);
  useEffect(() => () => { speakSeq.current++; try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }, []);

  return {
    supported: rec.supported && ttsSupported,
    listening: rec.listening, interim: rec.interim, finalText: rec.finalText, error: rec.error, clearError: rec.clearError,
    speaking, listen, stopListening: rec.stop, speak, stopSpeaking, stopAll,
  };
}
