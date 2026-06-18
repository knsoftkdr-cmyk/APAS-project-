import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ChapterSubtopic {
  id: number;
  class: string;
  subject: string;
  chapter_name: string;
  subtopic_name: string;
  sort_order: number | null;
}

/**
 * Extracts the unit number from a chapter_name string.
 * Handles formats like:
 *   "Unit 1: Numbers up to 100"  → 1
 *   "Unit 13: Recapitulation..."  → 13
 * Returns null if no unit number found.
 */
function extractUnitNumber(chapterName: string): number | null {
  const match = chapterName.match(/^Unit\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Normalises common spacing differences between tables.
 * "upto" → "up to", collapse extra spaces.
 */
function normaliseChapterName(name: string): string {
  return name
    .replace(/\bupto\b/gi, "up to")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Fetches subtopics for a given class + subject + chapter.
 *
 * Matching strategy (in order of reliability):
 *   1. Exact match after normalising spacing differences
 *   2. Match by unit number prefix (e.g. "Unit 1:") as fallback
 *
 * This ensures results are returned even when the chapter name in
 * the `chapters` table differs slightly from `chapter_subtopics`.
 */
export function useChapterSubtopics(
  className: string,    // e.g. "Class1"
  subject: string,      // e.g. "Mathematics"
  chapterName: string   // from your chapters query, e.g. "Unit 1: Numbers upto 100"
) {
  const normalisedName = normaliseChapterName(chapterName);
  const unitNumber = extractUnitNumber(chapterName);
  const enabled = !!className && !!subject && !!chapterName;

  const { data, isLoading } = useQuery<ChapterSubtopic[]>({
    queryKey: ["chapter-subtopics", className, subject, normalisedName],
    queryFn: async () => {
      // ── Strategy 1: exact match after normalisation ──────────────
      const { data: exactData, error: exactError } = await supabase
        .from("chapter_subtopics")
        .select("id, class, subject, chapter_name, subtopic_name, sort_order")
        .eq("class", className)
        .eq("subject", subject)
        .eq("chapter_name", normalisedName)
        .order("sort_order", { ascending: true });

      if (exactError) throw exactError;
      if (exactData && exactData.length > 0) return exactData as ChapterSubtopic[];

      // ── Strategy 2: match by unit number prefix ───────────────────
      // Fallback when names differ more significantly
      if (unitNumber !== null) {
        const prefix = `Unit ${unitNumber}:`;
        const { data: prefixData, error: prefixError } = await supabase
          .from("chapter_subtopics")
          .select("id, class, subject, chapter_name, subtopic_name, sort_order")
          .eq("class", className)
          .eq("subject", subject)
          .like("chapter_name", `${prefix}%`)
          .order("sort_order", { ascending: true });

        if (prefixError) throw prefixError;
        return (prefixData ?? []) as ChapterSubtopic[];
      }

      return [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  return {
    subtopics: data ?? [],
    isLoading: enabled && isLoading,
    hasSubtopics: (data ?? []).length > 0,
  };
}
