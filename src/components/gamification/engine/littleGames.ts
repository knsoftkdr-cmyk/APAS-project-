import type { AgeGroupId } from "./ageGroups";
import type { GameDefinition, GameCategory } from "./gameRegistry";

/**
 * Picture games for Nursery, LKG and UKG. Kept apart from GAME_REGISTRY on purpose: the text-based games
 * there need reading, so those classes get these instead (see gameSelector.ts).
 */
export const LITTLE_CLASSES = ["nursery", "lkg", "ukg"] as const;
export const normaliseClass = (c?: string | null) => (c ?? "").toString().trim().toLowerCase().replace(/[\s_-]+/g, "");
export const isPrePrimaryClass = (c?: string | null) => (LITTLE_CLASSES as readonly string[]).includes(normaliseClass(c));
/** 0 = Nursery, 1 = LKG, 2 = UKG */
export const littleLevel = (c?: string | null) => Math.max(0, (LITTLE_CLASSES as readonly string[]).indexOf(normaliseClass(c)));
export const isLittleGame = (id?: string | null) => !!id && id.startsWith("little-");

export interface LittleGameDef extends GameDefinition { minLevel: number }

const ALL: AgeGroupId[] = ["early_learners", "explorers", "thinkers", "advanced"];
const rec = <T,>(v: T): Record<AgeGroupId, T> => ({ early_learners: v, explorers: v, thinkers: v, advanced: v });
const def = (id: string, name: string, icon: string, dimension: string, color: string, category: GameCategory,
  subjects: string[] | "all", minLevel: number, objective: string, rules: string[]): LittleGameDef => ({
  id: `little-${id}`, name, icon, dimension, color, category, ageGroups: ALL, subjects, timeLimit: rec(120), objective, rules: rec(rules),
  scoring: "Stars for every round!", weight: 0.1, minLevel,
});

export const LITTLE_GAMES: LittleGameDef[] = [
  def("balloons", "Pop the Balloons", "🎈", "Colours, Numbers & Letters", "#FF6B6B", "speed", ["Maths", "English"], 0, "Pop the right balloons!", ["Listen to what to pop", "Tap the matching balloons", "Try again if it wobbles!"]),
  def("sounds", "Who Says Moo?", "🐮", "Animals & Listening", "#22C55E", "verbal", ["Science", "English"], 0, "Listen and tap the animal.", ["Listen to the animal sound", "Tap the animal that says it", "Tap the speaker to hear it again"]),
  def("monster", "Feed the Monster", "👾", "Counting", "#A855F7", "logic", ["Maths"], 0, "Feed the monster the right number!", ["The monster says how many it wants", "Tap one at a time to feed it", "Count along out loud!"]),
  def("missing", "What's Missing?", "🔍", "Memory", "#38BDF8", "memory", "all", 0, "Remember the pictures.", ["Look at the pictures", "They will hide", "Tap what disappeared"]),
  def("odd", "Odd One Out", "🧩", "Thinking", "#F59E0B", "logic", "all", 0, "Find the one that is different.", ["Look at all the pictures", "One is different", "Tap it!"]),
  def("basket", "Fill the Basket", "🧺", "Sorting", "#14B8A6", "logic", ["Science", "General Knowledge"], 1, "Sort each picture into its basket.", ["Look at the picture", "Which group does it belong to?", "Tap the right basket"]),
  def("pattern", "Pattern Train", "🚂", "Patterns", "#EC4899", "logic", ["Maths"], 1, "Finish the pattern.", ["Look at the pattern", "What comes next?", "Tap the answer"]),
  def("letters", "Letter Sound Hunt", "🔤", "First Sounds", "#6366F1", "verbal", ["English"], 1, "Find the picture that starts with the letter.", ["Listen to the letter", "Think of the first sound", "Tap the matching picture"]),
  def("bigsmall", "Big & Small", "🐘", "Sizes", "#F97316", "logic", ["Maths"], 0, "Tap the big or small one.", ["Listen: big, small or middle", "Tap the right size"]),
  def("shapes", "Shape Hunt", "🔶", "Shapes", "#0EA5E9", "logic", ["Maths", "General Knowledge"], 0, "Find the shape.", ["Listen to the shape name", "Tap that shape"]),
  def("count", "Count & Tap", "🔢", "Counting", "#84CC16", "logic", ["Maths"], 0, "Count the pictures.", ["Count the pictures", "Tap the right number"]),
  def("pairs", "Peekaboo Pairs", "🃏", "Memory", "#38BDF8", "memory", "all", 0, "Find matching pairs.", ["Tap a card to flip it", "Find two that match", "No hurry!"]),
  def("more", "More or Fewer?", "⚖️", "Comparing", "#E11D48", "logic", ["Maths"], 1, "Which group has more or fewer?", ["Look at both groups", "Listen: more or fewer?", "Tap the right group"]),
  def("nextnum", "Number Neighbours", "➡️", "Number Order", "#7C3AED", "logic", ["Maths"], 1, "Find the next or the one before.", ["Look at the number", "Which comes after or before?", "Tap the answer"]),
  def("paint", "Color Magic", "🎨", "Painting & Colours", "#FF8A1F", "memory", ["Art"], 0, "Paint the picture the same colours!", ["Look at the finished picture", "Pick a colour", "Tap a part to paint it"]),
];

/** Every game this class can play (Nursery 10, LKG and UKG 15), in catalogue order. */
export const eligibleLittleGames = (classKey?: string | null): LittleGameDef[] => LITTLE_GAMES.filter(g => g.minLevel <= littleLevel(classKey));

const SUBJECT_HINTS: Record<string, RegExp> = {
  Maths: /math/i, English: /english|rhyme/i, Science: /evs|awareness|science/i, "General Knowledge": /evs|awareness|general/i, Art: /art|craft/i,
};
/**
 * The subject to report when a child plays exactly one game, taken from that game's subject and matched to the student's own
 * subject list (so reports still show real subjects). Several games, "Surprise Me" or "All games" report as "General".
 */
export function littleSubjectForGames(games: { subjects: string[] | "all" }[], subjects: string[]): string {
  if (games.length !== 1 || !Array.isArray(games[0].subjects)) return "General";
  for (const tag of games[0].subjects) {
    const re = SUBJECT_HINTS[tag];
    const hit = re && subjects.find(x => re.test(x));
    if (hit) return hit;
  }
  return "General";
}
