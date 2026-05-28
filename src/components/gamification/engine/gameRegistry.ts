import { AgeGroupId } from './ageGroups';

export type GameCategory = 'memory' | 'logic' | 'subject' | 'speed' | 'verbal';

export interface GameDefinition {
  id: string;
  name: string;
  icon: string;
  dimension: string;
  color: string;
  category: GameCategory;
  ageGroups: AgeGroupId[];
  subjects: string[] | 'all';
  timeLimit: Record<AgeGroupId, number>;
  objective: string;
  rules: Record<AgeGroupId, string[]>;
  scoring: string;
  weight: number;
}

export const GAME_REGISTRY: GameDefinition[] = [
  // ─── MEMORY GAMES ───
  {
    id: 'visual-memory',
    name: 'Visual Memory',
    icon: '👁️',
    dimension: 'Visual Memory',
    color: '#FF6B6B',
    category: 'memory',
    ageGroups: ['early_learners', 'explorers', 'thinkers', 'advanced'],
    subjects: 'all',
    timeLimit: { early_learners: 90, explorers: 75, thinkers: 60, advanced: 60 },
    objective: 'Remember what you see and answer questions about it.',
    rules: {
      early_learners: ['Look at the colorful items carefully', 'Remember what you see', 'Answer questions about what was shown'],
      explorers: ['Memorize the items and their positions', 'Items disappear after a few seconds', 'Recall details accurately'],
      thinkers: ['Memorize items and positions', 'Items disappear quickly', 'Recall details accurately'],
      advanced: ['Memorize items and positions', 'Items disappear quickly', 'Recall details accurately'],
    },
    scoring: '+10 correct | +0 wrong',
    weight: 0.20,
  },
  {
    id: 'match-pairs',
    name: 'Match Pairs',
    icon: '🃏',
    dimension: 'Working Memory',
    color: '#38BDF8',
    category: 'memory',
    ageGroups: ['early_learners', 'explorers', 'thinkers', 'advanced'],
    subjects: 'all',
    timeLimit: { early_learners: 120, explorers: 90, thinkers: 75, advanced: 60 },
    objective: 'Find matching pairs by flipping cards.',
    rules: {
      early_learners: ['Tap a card to flip it', 'Find two matching cards', 'Try to remember where cards are'],
      explorers: ['Flip cards to find matches', 'Remember positions to be faster', 'Fewer flips = higher score'],
      thinkers: ['Find all pairs as fast as possible', 'Penalties for extra flips', 'Speed and accuracy both matter'],
      advanced: ['Find all pairs as fast as possible', 'Penalties for extra flips', 'Speed and accuracy both matter'],
    },
    scoring: '+15 match | -2 miss',
    weight: 0.20,
  },
  // ─── LOGIC/REASONING GAMES ───
  {
    id: 'category-sort',
    name: 'Category Sort',
    icon: '📦',
    dimension: 'Classification & Logic',
    color: '#22C55E',
    category: 'logic',
    ageGroups: ['early_learners', 'explorers', 'thinkers', 'advanced'],
    subjects: 'all',
    timeLimit: { early_learners: 90, explorers: 75, thinkers: 60, advanced: 50 },
    objective: 'Sort items into the correct categories.',
    rules: {
      early_learners: ['Read the category names', 'Drag items to the right group', 'No penalties!'],
      explorers: ['Sort items into 2 categories', 'Rules change periodically', 'Be quick and accurate'],
      thinkers: ['Complex categorization rules', 'Rules change every 15 seconds', 'Penalties for wrong sorts'],
      advanced: ['Multi-criteria sorting', 'Rapid rule changes', 'Full penalty system'],
    },
    scoring: '+10 correct | -5 wrong',
    weight: 0.20,
  },
  // ─── VERBAL GAMES ───
  {
    id: 'word-scramble',
    name: 'Word Scramble',
    icon: '🔤',
    dimension: 'Vocabulary & Spelling',
    color: '#EC4899',
    category: 'verbal',
    ageGroups: ['early_learners', 'explorers', 'thinkers', 'advanced'],
    subjects: 'all',
    timeLimit: { early_learners: 120, explorers: 90, thinkers: 75, advanced: 60 },
    objective: 'Unscramble the letters to form the correct word.',
    rules: {
      early_learners: ['Letters are mixed up', 'Tap letters in the right order', 'Hints available!'],
      explorers: ['Unscramble subject-related words', 'Tap letters to spell the word', 'Speed bonus for fast answers'],
      thinkers: ['Complex vocabulary words', 'No hints available', 'Timed per word'],
      advanced: ['Complex vocabulary words', 'No hints available', 'Timed per word'],
    },
    scoring: '+15 correct | +5 speed bonus',
    weight: 0.15,
  },
  // ─── SUBJECT-SPECIFIC GAMES ───
  {
    id: 'quick-quiz',
    name: 'Quick Quiz',
    icon: '❓',
    dimension: 'Subject Knowledge',
    color: '#6366F1',
    category: 'subject',
    ageGroups: ['early_learners', 'explorers', 'thinkers', 'advanced'],
    subjects: 'all',
    timeLimit: { early_learners: 120, explorers: 90, thinkers: 75, advanced: 60 },
    objective: 'Answer rapid-fire questions on your subject.',
    rules: {
      early_learners: ['Read the question carefully', 'Pick the right answer', 'No rush, take your time!'],
      explorers: ['Answer questions quickly', '4 options per question', 'Timer per question'],
      thinkers: ['Rapid-fire subject questions', 'Strict time per question', 'Penalties for wrong answers'],
      advanced: ['Complex subject questions', 'Very limited time', 'Full penalty system'],
    },
    scoring: '+15 correct | -5 wrong',
    weight: 0.25,
  },
  // ─── SPEED GAMES ───
  {
    id: 'speed-tap',
    name: 'Speed Tap',
    icon: '👆',
    dimension: 'Reaction Speed',
    color: '#EF4444',
    category: 'speed',
    ageGroups: ['early_learners', 'explorers', 'thinkers', 'advanced'],
    subjects: 'all',
    timeLimit: { early_learners: 60, explorers: 50, thinkers: 45, advanced: 40 },
    objective: 'Tap the correct items as fast as possible!',
    rules: {
      early_learners: ['Tap the items that match the rule', 'Ignore the wrong ones', 'Be quick!'],
      explorers: ['Tap only matching items', 'Items appear and disappear fast', 'Don\'t tap wrong items'],
      thinkers: ['Rapid item appearances', 'Complex matching rules', 'Penalties for wrong taps'],
      advanced: ['Extremely fast items', 'Multi-criteria matching', 'Heavy penalties'],
    },
    scoring: '+10 correct | -8 wrong tap',
    weight: 0.15,
  },
];

export function getGamesForAgeGroup(ageGroupId: AgeGroupId): GameDefinition[] {
  return GAME_REGISTRY.filter(g => g.ageGroups.includes(ageGroupId));
}

export function getGamesForSubject(subject: string, ageGroupId: AgeGroupId): GameDefinition[] {
  const normalizedSubject = subject.toLowerCase().trim();
  return GAME_REGISTRY.filter(g => {
    if (!g.ageGroups.includes(ageGroupId)) return false;
    if (g.subjects === 'all') return true;
    return g.subjects.some(s => s.toLowerCase() === normalizedSubject || normalizedSubject.includes(s.toLowerCase()));
  });
}
