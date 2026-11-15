import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  generateFlashcards, getCatalog, getOverview, getStudyQueue, rateFlashcard, reportFlashcard,
  type FlashcardCatalog, type FlashcardOverview, type StudyQueue,
} from "@/lib/flashcards";

// AI Auto Flashcards hooks. Rating a card also reschedules Daily Review (a Difficult card can bring its
// concept's MCQ review forward), so those caches are invalidated too.

export function useFlashcardOverview(enabled = true) {
  return useQuery<FlashcardOverview>({
    queryKey: ["flashcard-overview"],
    queryFn: getOverview,
    staleTime: 30 * 1000,
    enabled,
    retry: (count, err) => (err as { code?: string })?.code !== "persistence_unavailable" && count < 1,
  });
}

export function useFlashcardCatalog(subject?: string) {
  return useQuery<FlashcardCatalog>({
    queryKey: ["flashcard-catalog", subject ?? "subjects"],
    queryFn: () => getCatalog(subject),
    staleTime: 60 * 1000,
  });
}

export function useGenerateFlashcards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: generateFlashcards,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flashcard-overview"] });
      qc.invalidateQueries({ queryKey: ["flashcard-catalog"] });
      qc.invalidateQueries({ queryKey: ["flashcard-study"] });
    },
  });
}

/** The queue for one study session. Fetched on demand (not cached) so a session always starts from fresh due dates. */
export function useStartStudy() {
  return useMutation<StudyQueue, Error, Parameters<typeof getStudyQueue>[0]>({ mutationFn: (args) => getStudyQueue(args) });
}

export function useRateFlashcard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rateFlashcard,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["flashcard-overview"] });
      if (res.daily_review_pulled) {
        qc.invalidateQueries({ queryKey: ["due-reviews"] });
        qc.invalidateQueries({ queryKey: ["review-forecast"] });
      }
    },
  });
}

export function useReportFlashcard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: reportFlashcard,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flashcard-overview"] }),
  });
}
