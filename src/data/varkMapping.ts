// VARK Learning Style scoring from dedicated VARK questionnaire responses
// Each VARK question answer is a modality letter: "V", "A", "R", or "K"

export interface VarkScores {
  visual: number;
  auditory: number;
  readWrite: number;
  kinesthetic: number;
  dominant: "Visual" | "Auditory" | "Read/Write" | "Kinesthetic";
  notSureCount: number;
  totalQuestions: number;
}

/**
 * Derive VARK scores from dedicated VARK questionnaire responses.
 * Each response value is the modality letter ("V", "A", "R", "K").
 * If no VARK responses exist, falls back to the old derived method.
 */
export function deriveVarkScores(
  ageGroup: number,
  responses: Record<string, number>,
  varkResponses?: Record<string, string>
): VarkScores {
  // Use dedicated VARK responses if available
  if (varkResponses && Object.keys(varkResponses).length > 0) {
    return scoreFromVarkResponses(varkResponses);
  }

  // Fallback: derive from assessment questions (legacy)
  return deriveFromAssessment(ageGroup, responses);
}

function scoreFromVarkResponses(varkResponses: Record<string, string>): VarkScores {
  const counts = { V: 0, A: 0, R: 0, K: 0 };
  const total = Object.keys(varkResponses).length;
  let notSureCount = 0;

  for (const modality of Object.values(varkResponses)) {
    if (modality === "N") {
      notSureCount++;
    } else if (modality in counts) {
      counts[modality as keyof typeof counts]++;
    }
  }

  const toPercent = (c: number) => (total > 0 ? Math.round((c / total) * 100) : 0);

  const visual = toPercent(counts.V);
  const auditory = toPercent(counts.A);
  const readWrite = toPercent(counts.R);
  const kinesthetic = toPercent(counts.K);

  const max = Math.max(visual, auditory, readWrite, kinesthetic);
  let dominant: VarkScores["dominant"] = "Visual";
  if (max === kinesthetic) dominant = "Kinesthetic";
  if (max === readWrite) dominant = "Read/Write";
  if (max === auditory) dominant = "Auditory";
  if (max === visual) dominant = "Visual";

  return { visual, auditory, readWrite, kinesthetic, dominant, notSureCount, totalQuestions: total };
}

// Legacy fallback — derive VARK from the 30-question assessment responses
interface VarkMapping {
  visual: number[];
  auditory: number[];
  readWrite: number[];
  kinesthetic: number[];
}

const VARK_MAPPINGS: Record<number, VarkMapping> = {
  3: {
    visual: [4, 8, 9, 10, 26],
    auditory: [2, 11, 20, 22, 23],
    readWrite: [3, 24, 25, 27],
    kinesthetic: [6, 12, 16, 17, 18, 19, 21],
  },
  5: {
    visual: [7, 8, 18, 20, 30],
    auditory: [1, 2, 9, 10, 28],
    readWrite: [3, 4, 16, 22, 27],
    kinesthetic: [5, 6, 11, 12, 13, 17],
  },
  10: {
    visual: [7, 21, 27],
    auditory: [12, 14, 17, 22],
    readWrite: [1, 4, 6, 9, 16, 28],
    kinesthetic: [5, 8, 11, 13, 24],
  },
  15: {
    visual: [11, 20, 22],
    auditory: [2, 8, 23, 29],
    readWrite: [1, 10, 12, 18, 27],
    kinesthetic: [4, 6, 17, 19, 21],
  },
};

function deriveFromAssessment(ageGroup: number, responses: Record<string, number>): VarkScores {
  const mapping = VARK_MAPPINGS[ageGroup];
  if (!mapping) {
    return { visual: 50, auditory: 50, readWrite: 50, kinesthetic: 50, dominant: "Visual", notSureCount: 0, totalQuestions: 0 };
  }

  const maxPerQuestion = ageGroup <= 5 ? 4 : 5;

  const calcPercentage = (questionIds: number[]) => {
    const total = questionIds.reduce((sum, qId) => sum + (responses[String(qId)] || 0), 0);
    const max = questionIds.length * maxPerQuestion;
    return max > 0 ? Math.round((total / max) * 100) : 0;
  };

  const visual = calcPercentage(mapping.visual);
  const auditory = calcPercentage(mapping.auditory);
  const readWrite = calcPercentage(mapping.readWrite);
  const kinesthetic = calcPercentage(mapping.kinesthetic);

  const max = Math.max(visual, auditory, readWrite, kinesthetic);
  let dominant: VarkScores["dominant"] = "Visual";
  if (max === kinesthetic) dominant = "Kinesthetic";
  if (max === readWrite) dominant = "Read/Write";
  if (max === auditory) dominant = "Auditory";
  if (max === visual) dominant = "Visual";

  return { visual, auditory, readWrite, kinesthetic, dominant, notSureCount: 0, totalQuestions: 0 };
}
