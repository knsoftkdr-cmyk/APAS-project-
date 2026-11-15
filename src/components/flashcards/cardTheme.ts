import type { CardType } from "@/lib/flashcards";

export const CARD_THEME: Record<CardType, { emoji: string; front: string; back: string; chip: string }> = {
  definition: { emoji: "📘", front: "from-sky-100 to-blue-50 border-sky-300", back: "from-sky-500 to-blue-600", chip: "bg-sky-200 text-sky-900" },
  concept: { emoji: "💡", front: "from-violet-100 to-fuchsia-50 border-violet-300", back: "from-violet-500 to-fuchsia-600", chip: "bg-violet-200 text-violet-900" },
  fact: { emoji: "⭐", front: "from-amber-100 to-yellow-50 border-amber-300", back: "from-amber-500 to-orange-500", chip: "bg-amber-200 text-amber-900" },
  qa: { emoji: "❓", front: "from-emerald-100 to-green-50 border-emerald-300", back: "from-emerald-500 to-teal-600", chip: "bg-emerald-200 text-emerald-900" },
};
