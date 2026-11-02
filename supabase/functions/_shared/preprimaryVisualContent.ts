// supabase/functions/_shared/preprimaryVisualContent.ts
//
// Built-in PICTURE content for Nursery / LKG / UKG (age ~3-6, can barely read). Pure: no Deno / Supabase imports.
//
// Why this exists: asking an AI for "very simple" text kept producing reading tasks ("What goes on paper in a collage?").
// Little children need pictures, not sentences. Everything here is an emoji picture with at most one short word, in games
// they can play by looking: find it, match it, sort it, tap it, remember it. It is always valid, always the right level and
// needs no AI call, so the games never come up empty for these classes. The handler uses it first for level <= 0 and
// treats the AI only as a supplement.
//
// Output items are raw (include `class`) so they go through exactly the same validateItem / fingerprint / history path as AI items.

import { classLabel, type GameType } from "./gamificationQuestionModel.ts";

export type Rng = () => number;
interface Thing { e: string; w: string }
interface Cat { label: string; nm?: string; single: string; icon: string; things: Thing[] }

const t = (e: string, w: string): Thing => ({ e, w });

const CATS: Record<string, Cat> = {
  animals: { label: "Animals", single: "an animal", icon: "🐶", things: [t("🐶", "Dog"), t("🐱", "Cat"), t("🐮", "Cow"), t("🐷", "Pig"), t("🐑", "Sheep"), t("🐴", "Horse"), t("🐸", "Frog"), t("🐔", "Hen"), t("🦆", "Duck"), t("🐟", "Fish"), t("🐘", "Elephant"), t("🦁", "Lion"), t("🐵", "Monkey"), t("🐰", "Rabbit"), t("🐻", "Bear"), t("🐯", "Tiger"), t("🦓", "Zebra"), t("🐝", "Bee")] },
  fruits: { label: "Fruits", single: "a fruit", icon: "🍎", things: [t("🍎", "Apple"), t("🍌", "Banana"), t("🍇", "Grapes"), t("🍊", "Orange"), t("🥭", "Mango"), t("🍓", "Berry"), t("🍉", "Melon"), t("🍍", "Pineapple"), t("🍒", "Cherry"), t("🍋", "Lemon"), t("🍐", "Pear"), t("🍑", "Peach")] },
  veggies: { label: "Veggies", single: "a vegetable", icon: "🥕", things: [t("🥕", "Carrot"), t("🌽", "Corn"), t("🍅", "Tomato"), t("🥔", "Potato"), t("🥦", "Broccoli"), t("🥒", "Cucumber"), t("🧅", "Onion"), t("🌶️", "Chilli")] },
  vehicles: { label: "Vehicles", single: "a vehicle", icon: "🚗", things: [t("🚗", "Car"), t("🚌", "Bus"), t("🚲", "Cycle"), t("✈️", "Plane"), t("🚂", "Train"), t("🚢", "Ship"), t("🚜", "Tractor"), t("🛵", "Scooter"), t("🚑", "Ambulance"), t("🚒", "Firetruck")] },
  toys: { label: "Toys", single: "a toy", icon: "🧸", things: [t("⚽", "Ball"), t("🧸", "Teddy"), t("🎈", "Balloon"), t("🪁", "Kite"), t("🥁", "Drum"), t("🎸", "Guitar"), t("🎲", "Dice"), t("🪀", "Yo-yo")] },
  nature: { label: "Nature", nm: "nature things", single: "in nature", icon: "🌳", things: [t("🌳", "Tree"), t("🌸", "Flower"), t("🌻", "Sunflower"), t("🍃", "Leaf"), t("🌙", "Moon"), t("☀️", "Sun"), t("☁️", "Cloud"), t("🌧️", "Rain"), t("🌈", "Rainbow"), t("⛄", "Snowman")] },
  body: { label: "Body", nm: "body parts", single: "a body part", icon: "🖐️", things: [t("👀", "Eyes"), t("👂", "Ear"), t("👃", "Nose"), t("👄", "Mouth"), t("✋", "Hand"), t("🦶", "Foot")] },
  things: { label: "Things", nm: "school things", single: "a school thing", icon: "🎒", things: [t("🎒", "Bag"), t("📖", "Book"), t("✏️", "Pencil"), t("⏰", "Clock"), t("🔑", "Key"), t("🧢", "Cap"), t("👟", "Shoe"), t("🛏️", "Bed")] },
};
const CAT_KEYS = Object.keys(CATS);

const SHAPES: Thing[] = [t("⭕", "Circle"), t("🟦", "Square"), t("🔺", "Triangle"), t("⭐", "Star"), t("❤️", "Heart"), t("🔷", "Diamond")];
const COLORS: (Thing & { items: Thing[] })[] = [
  { e: "🔴", w: "Red", items: [t("🍎", "Apple"), t("🍓", "Berry"), t("🍒", "Cherry"), t("🍅", "Tomato")] },
  { e: "🟡", w: "Yellow", items: [t("🍌", "Banana"), t("🌻", "Sunflower"), t("🍋", "Lemon"), t("🐥", "Chick")] },
  { e: "🟢", w: "Green", items: [t("🐸", "Frog"), t("🥒", "Cucumber"), t("🥦", "Broccoli"), t("🍃", "Leaf")] },
  { e: "🔵", w: "Blue", items: [t("🐳", "Whale"), t("🌊", "Wave"), t("💧", "Drop"), t("🦋", "Butterfly")] },
  { e: "🟠", w: "Orange", items: [t("🍊", "Orange"), t("🥕", "Carrot"), t("🦊", "Fox"), t("🎃", "Pumpkin")] },
  { e: "🟣", w: "Purple", items: [t("🍇", "Grapes"), t("🍆", "Brinjal"), t("🔮", "Magic")] },
];
const SOUNDS: { e: string; w: string; s: string }[] = [
  { e: "🐶", w: "Dog", s: "Woof" }, { e: "🐱", w: "Cat", s: "Meow" }, { e: "🐮", w: "Cow", s: "Moo" }, { e: "🐑", w: "Sheep", s: "Baa" },
  { e: "🐸", w: "Frog", s: "Ribbit" }, { e: "🦆", w: "Duck", s: "Quack" }, { e: "🐷", w: "Pig", s: "Oink" }, { e: "🐴", w: "Horse", s: "Neigh" },
];
const LETTERS: [string, string, string][] = [
  ["A", "🍎", "Apple"], ["B", "⚽", "Ball"], ["C", "🐱", "Cat"], ["D", "🐶", "Dog"], ["E", "🥚", "Egg"], ["F", "🐟", "Fish"], ["G", "🍇", "Grapes"],
  ["H", "🎩", "Hat"], ["K", "🪁", "Kite"], ["L", "🦁", "Lion"], ["M", "🌙", "Moon"], ["O", "🍊", "Orange"], ["P", "🐷", "Pig"], ["R", "🐰", "Rabbit"],
  ["S", "☀️", "Sun"], ["T", "🌳", "Tree"], ["U", "☂️", "Umbrella"], ["V", "🚐", "Van"], ["Z", "🦓", "Zebra"],
];
// word, picture, clue (the clue never contains the word)
const WORDS3: [string, string, string][] = [
  ["CAT", "🐱", "Says meow"], ["DOG", "🐶", "Says woof"], ["SUN", "☀️", "Shines in the sky"], ["BUS", "🚌", "Kids ride it to school"], ["HEN", "🐔", "Lays eggs"],
  ["PIG", "🐷", "Says oink"], ["COW", "🐮", "Gives us milk"], ["BEE", "🐝", "Makes honey"], ["EGG", "🥚", "Hens lay it"], ["HAT", "🎩", "Goes on your head"],
  ["CUP", "☕", "You drink from it"], ["BED", "🛏️", "You sleep on it"], ["CAR", "🚗", "Goes beep beep"], ["KEY", "🔑", "Opens a door"], ["BAT", "🦇", "Flies at night"],
  ["FOX", "🦊", "Orange and sneaky"], ["BOX", "📦", "Put things in it"], ["PEN", "🖊️", "You write with it"], ["BAG", "🎒", "Carry books in it"], ["JAM", "🍓", "Sweet, goes on bread"],
  ["PAN", "🍳", "You cook in it"], ["POT", "🍲", "Cook soup in it"], ["MAP", "🗺️", "Shows places"], ["TAP", "🚰", "Water comes out"], ["BUN", "🍞", "Soft bread"],
  ["WEB", "🕸️", "A spider makes it"], ["ANT", "🐜", "A tiny insect"], ["OWL", "🦉", "Hoots at night"], ["LEG", "🦵", "You walk with it"], ["ICE", "🧊", "Very cold water"],
  ["TOY", "🧸", "Fun to play with"], ["JET", "✈️", "A very fast plane"], ["VAN", "🚐", "A small bus"], ["GEM", "💎", "A shiny stone"], ["LOG", "🪵", "Piece of a tree"],
];
const WORDS_UP: [string, string, string][] = [
  ["FISH", "🐟", "Swims in water"], ["DUCK", "🦆", "Says quack"], ["FROG", "🐸", "Jumps and says ribbit"], ["STAR", "⭐", "Twinkles at night"], ["MOON", "🌙", "Glows at night"],
  ["TREE", "🌳", "Has leaves and a trunk"], ["BIRD", "🐦", "Flies in the sky"], ["BOOK", "📖", "You read it"], ["BALL", "⚽", "You kick or throw it"], ["CAKE", "🎂", "Eat it on birthdays"],
  ["LION", "🦁", "King of the jungle"], ["MILK", "🥛", "White drink from cows"], ["HAND", "✋", "You wave with it"], ["APPLE", "🍎", "Red fruit"], ["HORSE", "🐴", "Says neigh"],
  ["ZEBRA", "🦓", "Black and white stripes"], ["MANGO", "🥭", "King of fruits"], ["CLOCK", "⏰", "Tells the time"],
];

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────

const pick = <T,>(xs: T[], rng: Rng): T => xs[Math.floor(rng() * xs.length)];
const shuf = <T,>(xs: T[], rng: Rng): T[] => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sample = <T,>(xs: T[], n: number, rng: Rng): T[] => shuf(xs, rng).slice(0, n);
const label = (th: Thing) => `${th.e} ${th.w}`;
const allThings = () => CAT_KEYS.flatMap((k) => CATS[k].things.map((x) => ({ ...x, cat: k })));
const others = (catKey: string) => CAT_KEYS.filter((k) => k !== catKey);

function withAnswer(options: string[], correct: string, rng: Rng) {
  const opts = shuf(options, rng);
  return { options: opts, correctIndex: opts.indexOf(correct) };
}

type Theme = "maths" | "english" | "art" | "evs" | null;
export function themeOf(subject: string): Theme {
  const s = subject.toLowerCase();
  if (/math|number|count/.test(s)) return "maths";
  if (/english|phonic|alphabet|letter|language|rhyme|story/.test(s)) return "english";
  if (/art|craft|draw|colou?r|paint/.test(s)) return "art";
  if (/evs|environment|science|nature|general|world|animal|plant/.test(s)) return "evs";
  return null;
}

// ── quick quiz ─────────────────────────────────────────────────────────────────────────────────────

type QuizKind = "find" | "color" | "count" | "sound" | "odd" | "shape" | "letter" | "add";

function quizKinds(level: number, theme: Theme): QuizKind[] {
  const base: QuizKind[] = ["find", "color", "count", "sound", "odd", "shape"];
  if (level >= -2) base.push("letter");
  if (level >= -1) base.push("add");
  const heavy: Record<string, QuizKind[]> = {
    maths: ["count", "count", "count", "shape", "shape", ...(level >= -1 ? (["add", "add", "add"] as QuizKind[]) : [])],
    english: level >= -2 ? ["letter", "letter", "letter", "letter", "find", "find", "sound"] : ["find", "find", "find", "sound", "sound"],
    art: ["color", "color", "color", "color", "color", "color", "color", "shape", "shape", "shape"],
    evs: ["find", "find", "sound", "sound", "odd", "odd", "odd", "color"],
  };
  return [...base, ...(theme ? heavy[theme] : [])];
}

function quizItem(level: number, theme: Theme, rng: Rng) {
  const kind = pick(quizKinds(level, theme), rng);
  const cap = level === -3 ? 5 : 10;
  switch (kind) {
    case "find": {
      const k = pick(CAT_KEYS, rng);
      const target = pick(CATS[k].things, rng);
      // Nursery: distractors come from other groups (easy to tell apart); UKG: from the same group.
      const pool = level === -1 ? CATS[k].things.filter((x) => x.e !== target.e) : others(k).flatMap((o) => CATS[o].things);
      const opts = [target, ...sample(pool, 3, rng)].map(label);
      const q = pick([`Find the ${target.w}! ${target.e}`, `Which one is the ${target.w}? ${target.e}`, `Where is the ${target.w}? ${target.e}`], rng);
      return { question: q, ...withAnswer(opts, label(target), rng) };
    }
    case "color": {
      const c = pick(COLORS, rng);
      const th = pick(c.items, rng);
      const opts = sample(COLORS, 3, rng).filter((x) => x.w !== c.w).slice(0, 3);
      while (opts.length < 3) { const x = pick(COLORS, rng); if (x.w !== c.w && !opts.some((o) => o.w === x.w)) opts.push(x); }
      return { question: `What colour is the ${th.e}?`, ...withAnswer([c, ...opts].map(label), label(c), rng) };
    }
    case "count": {
      const th = pick(allThings(), rng);
      const n = 1 + Math.floor(rng() * cap);
      const nums = new Set<number>([n]);
      while (nums.size < 4) nums.add(1 + Math.floor(rng() * Math.max(cap, 4)));
      return { question: `How many? ${th.e.repeat(n)}`, ...withAnswer([...nums].map(String), String(n), rng) };
    }
    case "sound": {
      const s = pick(SOUNDS, rng);
      const opts = [s, ...sample(SOUNDS.filter((x) => x.w !== s.w), 3, rng)].map((x) => label(x));
      return { question: pick([`Who says ${s.s}? 🔊`, `Which one says ${s.s}? 🔊`], rng), ...withAnswer(opts, label(s), rng) };
    }
    case "odd": {
      const k = pick(CAT_KEYS, rng);
      const inCat = sample(CATS[k].things, 3, rng);
      const odd = pick(others(k).flatMap((o) => CATS[o].things), rng);
      const hint = sample(CATS[k].things, 2, rng).map((x) => x.e).join("");
      return { question: `Which is NOT ${CATS[k].single}? ${hint}`, ...withAnswer([...inCat, odd].map(label), label(odd), rng) };
    }
    case "shape": {
      const s = pick(SHAPES, rng);
      const opts = [s, ...sample(SHAPES.filter((x) => x.w !== s.w), 3, rng)].map(label);
      return { question: pick([`Find the ${s.w}! ${s.e}`, `Which one is a ${s.w}? ${s.e}`], rng), ...withAnswer(opts, label(s), rng) };
    }
    case "letter": {
      const [ch, e, w] = pick(LETTERS, rng);
      const opts = [ch, ...sample(LETTERS.filter((l) => l[0] !== ch).map((l) => l[0]), 3, rng)];
      return { question: pick([`Which letter starts ${w}? ${e}`, `${e} ${w} starts with?`], rng), ...withAnswer(opts, ch, rng) };
    }
    default: { // add (UKG): pictures to count, answers within 10
      const th = pick(allThings(), rng);
      const a = 1 + Math.floor(rng() * 5), b = 1 + Math.floor(rng() * 5);
      const nums = new Set<number>([a + b]);
      while (nums.size < 4) nums.add(1 + Math.floor(rng() * 10));
      return { question: `${th.e.repeat(a)} + ${th.e.repeat(b)} = ?`, ...withAnswer([...nums].map(String), String(a + b), rng) };
    }
  }
}

// ── the other five games ───────────────────────────────────────────────────────────────────────────

function wordItem(level: number, rng: Rng) {
  const [word, e, clue] = pick(level === -1 ? [...WORDS3, ...WORDS_UP] : WORDS3, rng);
  return { word, hint: `${e} ${clue}` };
}

function pairItem(rng: Rng) {
  const r = rng();
  if (r < 0.1) { const s = pick(SOUNDS, rng); return { a: s.e, b: s.s }; }
  if (r < 0.2) { const c = pick(COLORS, rng); const th = pick(c.items, rng); return { a: th.e, b: c.w }; }
  const th = pick(allThings(), rng);
  return { a: th.e, b: th.w };
}

function sortItem(rng: Rng) {
  const [k1, k2] = sample(CAT_KEYS, 2, rng);
  const a = CATS[k1], b = CATS[k2];
  const hint = [pick(a.things, rng).e, pick(b.things, rng).e].join("");
  return {
    rule: `Sort the ${a.nm ?? a.label.toLowerCase()} and ${b.nm ?? b.label.toLowerCase()}! ${hint}`,
    leftLabel: `${a.icon} ${a.label}`, rightLabel: `${b.icon} ${b.label}`,
    leftItems: sample(a.things, 4, rng).map((x) => x.e), rightItems: sample(b.things, 4, rng).map((x) => x.e),
  };
}

function speedItem(rng: Rng) {
  const k = pick(CAT_KEYS, rng);
  const c = CATS[k];
  const targets = sample(c.things, 5, rng).map((x) => x.e);
  const distractors = sample(others(k).flatMap((o) => CATS[o].things), 5, rng).map((x) => x.e);
  const ex = targets.slice(0, 2).join("");
  return { instruction: `${pick(["Tap all the", "Find all the", "Quick! Tap the"], rng)} ${c.nm ?? c.label.toLowerCase()}! ${ex}`, targets, distractors };
}

function visualItem(level: number, rng: Rng) {
  const n = level === -3 ? 3 : 4;
  const pool = shuf(allThings(), rng);
  const items = pool.slice(0, n);
  const rest = pool.slice(n);
  const seen = pick(items, rng);
  const q1opts = [seen.e, ...rest.slice(0, 3).map((x) => x.e)];
  const nums = new Set<number>([n]);
  while (nums.size < 4) nums.add(1 + Math.floor(rng() * 6));
  return {
    items: items.map((x) => x.e),
    questions: [
      { question: "Which one did you see? 👀", ...withAnswer(q1opts, seen.e, rng) },
      { question: "How many did you see? 👀", ...withAnswer([...nums].map(String), String(n), rng) },
    ],
  };
}

/**
 * `n` raw picture items for a game, tagged with the student's class (so they pass the same validation as AI items).
 * Duplicates are possible; callers dedupe by fingerprint. `subject` only nudges Quick Quiz towards matching question types.
 */
export function generateVisualItems(
  gameType: GameType, ctx: { classKey: string; level: number }, subject: string, n: number, rng: Rng = Math.random,
): Record<string, unknown>[] {
  const theme = themeOf(subject);
  const cls = classLabel(ctx.classKey);
  const make = (): Record<string, unknown> => {
    switch (gameType) {
      case "quick-quiz": return quizItem(ctx.level, theme, rng);
      case "word-scramble": return wordItem(ctx.level, rng);
      case "match-pairs": return pairItem(rng);
      case "category-sort": return sortItem(rng);
      case "speed-tap": return speedItem(rng);
      case "visual-memory": return visualItem(ctx.level, rng);
    }
  };
  return Array.from({ length: n }, () => ({ class: cls, ...make() }));
}
