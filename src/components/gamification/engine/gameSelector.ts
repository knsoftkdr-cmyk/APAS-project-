import { AgeGroupId } from './ageGroups';
import { GameDefinition, GAME_REGISTRY } from './gameRegistry';
import { isPrePrimaryClass, eligibleLittleGames, type LittleGameDef } from './littleGames';

export type GameMode = 'subject' | 'generic';

export interface SelectedGame extends GameDefinition {
  difficulty: 'easy' | 'medium' | 'hard';
  selectedIndex: number;
}

/**
 * Selects ALL eligible games for a student based on age group and subject.
 * All games use subject-aware content pools, so every game's questions
 * will match the selected subject.
 */
export function selectGamesForStudent(
  ageGroupId: AgeGroupId,
  subject: string,
  avgAccuracy?: number,
  classKey?: string
): SelectedGame[] {
  // Nursery, LKG and UKG get the picture games instead of the text-based ones.
  if (isPrePrimaryClass(classKey)) return selectLittleGames(classKey, 'surprise');
  const eligible = GAME_REGISTRY.filter(g => g.ageGroups.includes(ageGroupId));

  const difficulty: 'easy' | 'medium' | 'hard' = 
    !avgAccuracy || avgAccuracy < 50 ? 'easy' :
    avgAccuracy < 75 ? 'medium' : 'hard';

  const shuffled = [...eligible].sort(() => Math.random() - 0.5);

  return shuffled.map((g, i) => ({
    ...g,
    difficulty,
    selectedIndex: i,
  }));
}

/**
 * Selects games for generic (non-subject) mode.
 * Includes all cognitive games (memory, logic, speed, verbal) for brain training,
 * plus subject-knowledge games that will pull from mixed subjects.
 */
export function selectGamesForGeneric(
  ageGroupId: AgeGroupId,
  avgAccuracy?: number,
  classKey?: string
): SelectedGame[] {
  if (isPrePrimaryClass(classKey)) return selectLittleGames(classKey, 'surprise');
  const eligible = GAME_REGISTRY.filter(g => g.ageGroups.includes(ageGroupId));

  const difficulty: 'easy' | 'medium' | 'hard' = 
    !avgAccuracy || avgAccuracy < 50 ? 'easy' :
    avgAccuracy < 75 ? 'medium' : 'hard';

  const shuffled = [...eligible].sort(() => Math.random() - 0.5);

  return shuffled.map((g, i) => ({
    ...g,
    difficulty,
    selectedIndex: i,
  }));
}

const LITTLE_LAST_KEY = 'apas.little.lastPlayed';
const LITTLE_PER_ROUND = 5;

/**
 * Picture games for Nursery / LKG / UKG. Only games suited to the class level are ever offered.
 *  - an array of game ids : exactly those games (the child tapped them), in catalogue order
 *  - 'all'                : every game for the class
 *  - 'surprise'           : five games, the ones played least recently first, so rounds vary
 */
export function selectLittleGames(classKey: string | undefined, choice: string[] | 'all' | 'surprise'): SelectedGame[] {
  const eligible = eligibleLittleGames(classKey);
  let picked: LittleGameDef[];

  if (Array.isArray(choice)) {
    picked = eligible.filter(g => choice.includes(g.id));
  } else if (choice === 'all') {
    picked = [...eligible];
  } else {
    let last: Record<string, number> = {};
    try { last = JSON.parse(localStorage.getItem(LITTLE_LAST_KEY) || '{}'); } catch { /* storage unavailable */ }
    picked = [...eligible]
      .sort((a, b) => (last[a.id] || 0) - (last[b.id] || 0) || Math.random() - 0.5)
      .slice(0, LITTLE_PER_ROUND);
    // A counter that only ever goes up (clock time alone can tie when rounds start close together).
    let stamp = Math.max(Date.now(), ...Object.values(last), 0) + 1;
    picked.forEach(g => { last[g.id] = stamp++; });
    try { localStorage.setItem(LITTLE_LAST_KEY, JSON.stringify(last)); } catch { /* ignore */ }
    picked.sort(() => Math.random() - 0.5);
  }
  if (!picked.length) picked = eligible.slice(0, LITTLE_PER_ROUND); // never start an empty round
  return picked.map((g, i) => ({ ...g, difficulty: 'easy' as const, selectedIndex: i }));
}
