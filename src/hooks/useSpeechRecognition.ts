// src/hooks/useSpeechRecognition.ts
//
// Thin wrapper over the browser's Web Speech API (SpeechRecognition) for Pronunciation Assessment.
// Works in Chrome and Edge (and some Safari versions); Firefox has no support. The audio is handled by the
// browser's own speech service - APAS only receives the resulting text, never the recording.
import { useCallback, useEffect, useRef, useState } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecognition = any;

export interface SpeechOutcome {
  transcript: string;
  /** Average recogniser confidence 0-1, or null if the browser didn't report one. */
  confidence: number | null;
  /** Seconds from the first spoken sound to the last recognised word, or null if unknown. */
  durationSeconds: number | null;
}

export type SpeechErrorKind = "blocked" | "no_speech" | "no_mic" | "language" | "network" | "other";

const ERROR_TEXT: Record<SpeechErrorKind, string> = {
  blocked: "The microphone is blocked. Allow microphone access for this site in your browser, then try again.",
  no_speech: "We didn't hear anything. Move closer to the microphone and try again.",
  no_mic: "No microphone was found. Connect one and try again.",
  language: "This browser can't recognise that language. Try Chrome or Edge, or pick another language.",
  network: "The speech service couldn't be reached. Check your internet connection and try again.",
  other: "Speech recognition stopped unexpectedly. Please try again.",
};

function ctor(): AnyRecognition | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as AnyRecognition | null;
}

export const isSpeechRecognitionSupported = () => ctor() !== null;

function mapError(code: string): SpeechErrorKind {
  switch (code) {
    case "not-allowed": case "service-not-allowed": return "blocked";
    case "no-speech": return "no_speech";
    case "audio-capture": return "no_mic";
    case "language-not-supported": return "language";
    case "network": return "network";
    default: return "other";
  }
}

export function useSpeechRecognition() {
  const supported = isSpeechRecognitionSupported();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<AnyRecognition | null>(null);
  const finalsRef = useRef<string[]>([]);
  const confRef = useRef<number[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const lastResultAtRef = useRef<number | null>(null);
  const errorRef = useRef<SpeechErrorKind | null>(null);
  const onDoneRef = useRef<((o: SpeechOutcome) => void) | null>(null);

  const start = useCallback((lang: string, onDone: (o: SpeechOutcome) => void) => {
    const Ctor = ctor();
    if (!Ctor) { setError("Speech recognition isn't available in this browser. Please use Chrome or Edge."); return; }
    try { recRef.current?.abort(); } catch { /* nothing running */ }

    finalsRef.current = []; confRef.current = [];
    startedAtRef.current = null; lastResultAtRef.current = null; errorRef.current = null;
    onDoneRef.current = onDone;
    setError(null); setInterim(""); setFinalText("");

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onspeechstart = () => { if (startedAtRef.current === null) startedAtRef.current = performance.now(); };
    rec.onresult = (e: AnyRecognition) => {
      const now = performance.now();
      if (startedAtRef.current === null) startedAtRef.current = now;
      lastResultAtRef.current = now;
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const alt = res[0];
        if (res.isFinal) {
          finalsRef.current[i] = String(alt.transcript ?? "").trim();
          if (typeof alt.confidence === "number" && alt.confidence > 0) confRef.current.push(alt.confidence);
        } else {
          interimText += alt.transcript;
        }
      }
      setFinalText(finalsRef.current.filter(Boolean).join(" "));
      setInterim(interimText.trim());
    };
    rec.onerror = (e: AnyRecognition) => {
      if (e?.error === "aborted") return;
      const kind = mapError(String(e?.error ?? ""));
      errorRef.current = kind;
      setError(ERROR_TEXT[kind]);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      const transcript = finalsRef.current.filter(Boolean).join(" ").trim();
      const confs = confRef.current;
      const started = startedAtRef.current, last = lastResultAtRef.current;
      const cb = onDoneRef.current;
      onDoneRef.current = null;
      if (!cb || errorRef.current) return;     // an error was already shown; don't score nothing
      if (!transcript) { setError(ERROR_TEXT.no_speech); return; }
      cb({
        transcript,
        confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
        durationSeconds: started !== null && last !== null && last > started ? (last - started) / 1000 : null,
      });
    };

    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setError(ERROR_TEXT.other); }
  }, []);

  const stop = useCallback(() => { try { recRef.current?.stop(); } catch { /* already stopped */ } }, []);
  const cancel = useCallback(() => {
    onDoneRef.current = null;
    try { recRef.current?.abort(); } catch { /* already stopped */ }
    setListening(false); setInterim("");
  }, []);

  useEffect(() => () => { onDoneRef.current = null; try { recRef.current?.abort(); } catch { /* ignore */ } }, []);

  return { supported, listening, interim, finalText, error, start, stop, cancel, clearError: () => setError(null) };
}
