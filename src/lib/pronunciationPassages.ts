// Built-in practice texts. Other languages and levels use "New passage (AI)" or the student's own text.
import type { Level } from "@/lib/pronunciation";

export interface Passage { id: string; level: Level; text: string }

export const PASSAGES: Record<string, Passage[]> = {
  en: [
    { id: "en-b1", level: "beginner", text: "My name is Asha. I go to school every day." },
    { id: "en-b2", level: "beginner", text: "The sun is bright and the sky is blue." },
    { id: "en-b3", level: "beginner", text: "I like to eat rice and fresh fruit." },
    { id: "en-i1", level: "intermediate", text: "Every morning, my sister walks to the library to read her favourite books." },
    { id: "en-i2", level: "intermediate", text: "The weather was cloudy, but we still enjoyed our picnic by the river." },
    { id: "en-a1", level: "advanced", text: "Thoroughly prepared students often discover that practice, rather than talent, determines their success." },
    { id: "en-a2", level: "advanced", text: "The scientist carefully measured the temperature, recorded the results, and explained the unusual pattern." },
  ],
  hi: [
    { id: "hi-b1", level: "beginner", text: "मेरा नाम राधा है।" },
    { id: "hi-b2", level: "beginner", text: "आज मौसम बहुत अच्छा है।" },
  ],
  te: [
    { id: "te-b1", level: "beginner", text: "నా పేరు రాధ." },
    { id: "te-b2", level: "beginner", text: "ఈ రోజు వాతావరణం చాలా బాగుంది." },
  ],
  ta: [
    { id: "ta-b1", level: "beginner", text: "என் பெயர் ராதா." },
  ],
};

export function passagesFor(language: string, level: Level): Passage[] {
  return (PASSAGES[language] ?? []).filter((p) => p.level === level);
}
