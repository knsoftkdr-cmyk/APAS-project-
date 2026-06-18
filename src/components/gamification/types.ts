export interface GameResult {
  gameIndex: number;
  gameName: string;
  rawScore: number;
  maxScore: number;
  accuracy: number;
  avgResponseTime: number;
  questionsAttempted: number;
  questionsCorrect: number;
  timeUsed: number;
  timeLimit: number;
}

export interface GameProps {
  onComplete: (result: GameResult) => void;
  studentName: string;
}

export const GAME_CONFIG = [
  {
    name: "Pattern Flash",
    icon: "🔷",
    dimension: "Working Memory",
    color: "#38BDF8",
    timeLimit: 60,
    objective: "Memorize the glowing tiles and tap them back from memory.",
    rules: [
      "Tiles will light up briefly — memorize their positions",
      "Click the same tiles after they disappear",
      "Difficulty increases with more tiles each round",
    ],
    scoring: "+10 per correct tile | -5 per wrong click",
    weight: 0.25,
  },
  {
    name: "Number Balance",
    icon: "🔢",
    dimension: "Numerical Reasoning",
    color: "#A855F7",
    timeLimit: 90,
    objective: "Judge which side of the scale is heavier.",
    rules: [
      "Compare numbers on both sides of the scale",
      "Watch for multipliers (×2) on individual items",
      "Select LEFT, RIGHT, or EQUAL quickly",
    ],
    scoring: "+15 correct | -5 wrong",
    weight: 0.20,
  },
  {
    name: "Word Proof",
    icon: "🔤",
    dimension: "Verbal & Attention",
    color: "#84CC16",
    timeLimit: 120,
    objective: "Spot and click the spelling/grammar mistakes in the text.",
    rules: [
      "Read the paragraph carefully for errors",
      "Click on misspelled or grammatically wrong words",
      "Avoid clicking correct words — false positives cost points",
    ],
    scoring: "+10 per error found | -8 per false positive",
    weight: 0.20,
  },
  {
    name: "Shape Sequence",
    icon: "🔷",
    dimension: "Pattern Recognition",
    color: "#F59E0B",
    timeLimit: 60,
    objective: "Find the missing shape or number in the series.",
    rules: [
      "Observe the pattern in the sequence",
      "Select the correct next element from 4 options",
      "No penalty for wrong answers — but speed matters",
    ],
    scoring: "+20 correct | 0 wrong",
    weight: 0.20,
  },
  {
    name: "Rapid Sort",
    icon: "⚡",
    dimension: "Processing Speed",
    color: "#F472B6",
    timeLimit: 90,
    objective: "Sort falling items left or right based on the given rule.",
    rules: [
      "Read the sorting rule at the top of the screen",
      "Swipe or click LEFT/RIGHT to sort each item",
      "Rules change every 20 seconds — stay alert!",
    ],
    scoring: "+8 correct | -4 wrong | -2 missed",
    weight: 0.15,
  },
];

export const TIER_BADGES = [
  { min: 0, max: 39, label: "Developing", emoji: "🥉" },
  { min: 40, max: 64, label: "Competent", emoji: "🥈" },
  { min: 65, max: 84, label: "Proficient", emoji: "🥇" },
  { min: 85, max: 100, label: "Advanced", emoji: "🏆" },
];

export const COGNITIVE_BADGES: Record<number, string> = {
  0: "Memory Master 🧠",
  1: "Number Ninja 🔢",
  2: "Word Wizard 📝",
  3: "Pattern Pro 🔷",
  4: "Speed Demon ⚡",
};

export type GamePhase =
  | "WELCOME"
  | "TERMS"
  | "PRE_GAME"
  | "COUNTDOWN"
  | "PLAYING"
  | "POST_GAME"
  | "RESULTS";
