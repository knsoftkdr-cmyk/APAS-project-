import { AgeGroupId } from './ageGroups';
import { GameDefinition, GAME_REGISTRY } from './gameRegistry';

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
  avgAccuracy?: number
): SelectedGame[] {
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
  avgAccuracy?: number
): SelectedGame[] {
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
